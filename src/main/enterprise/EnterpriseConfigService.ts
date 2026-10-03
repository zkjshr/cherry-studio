import { and, eq, like } from 'drizzle-orm'
import { net } from 'electron'

import { application } from '@application'
import { preferenceTable } from '@data/db/schemas/preference'
import { userProviderTable } from '@data/db/schemas/userProvider'
import { mcpServerService } from '@data/services/McpServerService'
import { loggerService } from '@logger'
import { BaseService, DependsOn, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'
import { applyEnterpriseConfig } from '@main/enterprise/applyEnterpriseConfig'
import { validateEnterpriseConfigPayload, type EnterpriseClientConfig } from '@main/enterprise/enterpriseConfigTypes'
import type { EnterpriseSyncState } from '@main/enterprise/enterpriseSettings'
import {
  enterpriseCacheExists,
  loadEnterpriseCache,
  loadEnterpriseSettings,
  loadEnterpriseState,
  saveEnterpriseCache,
  saveEnterpriseState,
  saveEnterpriseStateSafe
} from '@main/enterprise/enterpriseSettings'
import { decideSyncAction } from '@main/enterprise/syncDecider'
import type { EnterpriseStateSnapshot } from '@shared/types/enterprise'
import {
  ENTERPRISE_MANAGED_ASSISTANT_IDS_KEY,
  ENTERPRISE_PROVIDER_PREFIX,
  filterEnterpriseMcpServerNames,
  isEnterpriseProviderId
} from '@shared/utils/enterprise'

const logger = loggerService.withContext('EnterpriseConfigService')

const SYNC_TIMEOUT_MS = 10_000
const CLIENT_CONFIG_PATH = '/api/client/config'
const PREFERENCE_SCOPE_DEFAULT = 'default'

@Injectable('EnterpriseConfigService')
@ServicePhase(Phase.WhenReady)
@DependsOn(['DbService'])
export class EnterpriseConfigService extends BaseService {
  /** Whether a config (remote or cached) has been applied during this boot. */
  private appliedThisBoot = false
  /** Aborted via registerDisposable when the service stops mid-sync. */
  private inFlightSync: AbortController | null = null
  /** Shared in-flight sync promise — concurrent callers (boot + renderer) await the same round. */
  private syncPromise: Promise<void> | null = null

  protected async onInit(): Promise<void> {
    this.registerDisposable(() => {
      this.inFlightSync?.abort()
      this.inFlightSync = null
    })
  }

  protected async onAllReady(): Promise<void> {
    // Fire-and-forget: a sync failure must never block or fail boot. syncOnce
    // itself is defensive, but this outer catch is the last resort.
    this.syncOnce().catch((error: unknown) => {
      logger.error('Enterprise config sync failed unexpectedly', error as Error)
    })
  }

  /**
   * One sync round: fetch the server config (ETag-guarded), decide the action,
   * and apply it. Never throws — every branch is recorded to the state file
   * and/or the log instead.
   *
   * In-flight dedup: when a sync is already running (e.g. the boot round while
   * the renderer asks for a manual one), callers share that round instead of
   * starting a second concurrent fetch.
   */
  public syncOnce(): Promise<void> {
    if (!this.syncPromise) {
      this.syncPromise = this.runSyncOnce().finally(() => {
        this.syncPromise = null
      })
    }
    return this.syncPromise
  }

  /** Assemble the renderer-facing snapshot: sync state + managed resource lists. */
  public async getState(): Promise<EnterpriseStateSnapshot> {
    const settings = loadEnterpriseSettings()
    const state = loadEnterpriseState()

    return {
      enabled: settings.status === 'enabled',
      lastAppliedVersion: state.lastAppliedVersion,
      lastSyncedAt: state.lastSyncedAt,
      lastError: state.lastError,
      managedProviderIds: this.listManagedProviderIds(),
      managedAssistantIds: this.listManagedAssistantIds(),
      managedMcpNames: filterEnterpriseMcpServerNames(mcpServerService.list({}).items.map((server) => server.name))
    }
  }

  private async runSyncOnce(): Promise<void> {
    const settings = loadEnterpriseSettings()
    if (settings.status === 'disabled') {
      logger.info(`Enterprise config sync idle: ${settings.reason}`)
      return
    }

    const state = loadEnterpriseState()

    let response: Response | null = null
    try {
      const controller = new AbortController()
      this.inFlightSync = controller
      response = await net.fetch(`${settings.serverUrl}${CLIENT_CONFIG_PATH}`, {
        headers: {
          'X-Client-Token': settings.token,
          ...(state.lastAppliedVersion !== null ? { 'If-None-Match': `"${state.lastAppliedVersion}"` } : {})
        },
        redirect: 'follow',
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(SYNC_TIMEOUT_MS)])
      })
    } catch (error) {
      logger.warn('Enterprise config fetch failed', error as Error)
      await saveEnterpriseStateSafe({
        ...state,
        lastError: `fetch failed: ${(error as Error).message}`
      })
    } finally {
      this.inFlightSync = null
    }

    const action = decideSyncAction({
      httpStatus: response?.status ?? null,
      etagVersion: parseEtagVersion(response?.headers.get('etag') ?? null),
      lastAppliedVersion: state.lastAppliedVersion,
      hasCache: enterpriseCacheExists(),
      appliedThisBoot: this.appliedThisBoot
    })

    switch (action) {
      case 'apply_remote':
        await this.applyRemoteConfig(response!, state.lastAppliedVersion)
        return
      case 'touch': {
        logger.info('Enterprise config unchanged (304)')
        await saveEnterpriseStateSafe({ ...state, lastSyncedAt: new Date().toISOString() })
        return
      }
      case 'apply_cache':
        await this.applyCachedConfig(state)
        return
      case 'idle':
        logger.warn('Enterprise config server unreachable and no fresh apply is possible', {
          httpStatus: response?.status ?? null
        })
        await saveEnterpriseStateSafe({
          ...state,
          lastError: `server unreachable (status ${response?.status ?? 'network'})`
        })
    }
  }

  /** 200 path: validate → cache on disk → apply → record state. */
  private async applyRemoteConfig(response: Response, previousVersion: number | null): Promise<void> {
    const syncedAt = new Date().toISOString()

    let config: EnterpriseClientConfig
    try {
      config = validateEnterpriseConfigPayload(await response.json())
    } catch (error) {
      logger.error('Enterprise config payload rejected', error as Error)
      await saveEnterpriseStateSafe({
        lastAppliedVersion: previousVersion,
        lastSyncedAt: syncedAt,
        lastError: `invalid payload: ${(error as Error).message}`
      })
      return
    }

    // Cache BEFORE applying: a failed apply still leaves the payload available
    // for the degraded path on the next boot.
    try {
      await saveEnterpriseCache(config)
    } catch (error) {
      logger.warn('Failed to persist enterprise config cache', error as Error)
    }

    try {
      const result = await applyEnterpriseConfig(config)
      this.appliedThisBoot = true
      await saveEnterpriseState({ lastAppliedVersion: config.config_version, lastSyncedAt: syncedAt, lastError: null })
      logger.info('Enterprise config synced and applied', { configVersion: config.config_version, ...result })
    } catch (error) {
      logger.error('Enterprise config apply failed', error as Error)
      await saveEnterpriseStateSafe({
        lastAppliedVersion: previousVersion,
        lastSyncedAt: syncedAt,
        lastError: `apply failed: ${(error as Error).message}`
      })
    }
  }

  /** Degraded path: server unreachable but nothing applied yet this boot and a cache exists. */
  private async applyCachedConfig(state: EnterpriseSyncState): Promise<void> {
    const cached = loadEnterpriseCache()
    if (!cached) {
      logger.warn('Enterprise config cache vanished between check and read; skipping degraded apply')
      return
    }

    try {
      const result = await applyEnterpriseConfig(cached)
      this.appliedThisBoot = true
      // 实际生效的是缓存里的版本；沿用 state 旧值会让下次 If-None-Match 倒退、白拉一次 200
      await saveEnterpriseStateSafe({
        lastAppliedVersion: cached.config_version,
        lastSyncedAt: new Date().toISOString(),
        lastError: null
      })
      logger.warn('Enterprise config applied from cache (degraded; server unreachable)', {
        configVersion: cached.config_version,
        ...result
      })
    } catch (error) {
      logger.error('Enterprise cached config apply failed', error as Error)
      await saveEnterpriseStateSafe({
        ...state,
        lastError: `cached apply failed: ${(error as Error).message}`
      })
    }
  }

  /** Provider ids currently stored in the `enterprise-` namespace. */
  private listManagedProviderIds(): string[] {
    const db = application.get('DbService').getDb()
    const rows = db
      .select({ providerId: userProviderTable.providerId })
      .from(userProviderTable)
      .where(like(userProviderTable.providerId, `${ENTERPRISE_PROVIDER_PREFIX}%`))
      .all()
    // LIKE is case-insensitive for ASCII in SQLite — re-filter for exactness.
    return rows.map((row) => row.providerId).filter(isEnterpriseProviderId)
  }

  /** Assistant UUIDs recorded by the last apply (`managed: true` entries). */
  private listManagedAssistantIds(): string[] {
    const db = application.get('DbService').getDb()
    const [row] = db
      .select({ value: preferenceTable.value })
      .from(preferenceTable)
      .where(and(eq(preferenceTable.scope, PREFERENCE_SCOPE_DEFAULT), eq(preferenceTable.key, ENTERPRISE_MANAGED_ASSISTANT_IDS_KEY)))
      .limit(1)
      .all()
    if (!Array.isArray(row?.value)) return []
    return row.value.filter((id): id is string => typeof id === 'string')
  }
}

/** Parse a numeric `"<version>"` ETag header; null when absent or non-numeric. */
function parseEtagVersion(etag: string | null): number | null {
  if (!etag) return null
  const value = Number(etag.replace(/^"|"$/g, ''))
  return Number.isFinite(value) && value >= 1 ? value : null
}
