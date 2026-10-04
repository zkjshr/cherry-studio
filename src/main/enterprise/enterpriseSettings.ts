/**
 * Enterprise settings — configuration source and on-disk state for the
 * enterprise config pipeline.
 *
 * Layout under `application.getPath('cherry.config')` (= `~/.cherrystudio/config`):
 * - `enterprise.json`     — deployment config `{ enabled, serverUrl, token }`
 * - `enterprise.state.json` — sync state `{ lastAppliedVersion, lastSyncedAt, lastError }`
 * - `enterprise.cache.json` — last fetched server config (degraded-boot fallback)
 *
 * Environment overrides `CHERRY_ENTERPRISE_SERVER_URL` / `CHERRY_ENTERPRISE_TOKEN`
 * (dev convenience) take precedence over the file's values.
 *
 * All JSON writes go through the atomic-write family (`atomicWriteFile`:
 * tmp + fsync + rename + dir fsync), the same durability pattern the
 * BootConfigService uses for `boot-config.json`.
 */

import fs from 'node:fs'

import { application } from '@application'
import { loggerService } from '@logger'
import { atomicWriteFile } from '@main/utils/file'
import { AbsoluteFilePathSchema, type AbsoluteFilePath } from '@shared/types/file'

import type { EnterpriseClientConfig } from './enterpriseConfigTypes'
import { validateEnterpriseConfigPayload } from './enterpriseConfigTypes'

const logger = loggerService.withContext('EnterpriseSettings')

/** Bridge the plain path strings from `application.getPath` to the fs layer's branded type. */
function toAbsoluteFilePath(path: string): AbsoluteFilePath {
  return AbsoluteFilePathSchema.parse(path)
}

/** Deployment config read from `enterprise.json`. */
export interface EnterpriseSettingsConfig {
  enabled: boolean
  serverUrl: string
  token: string
}

/** Sync state persisted to `enterprise.state.json`. */
export interface EnterpriseSyncState {
  lastAppliedVersion: number | null
  lastSyncedAt: string | null
  lastError: string | null
}

export const DEFAULT_ENTERPRISE_SYNC_STATE: EnterpriseSyncState = {
  lastAppliedVersion: null,
  lastSyncedAt: null,
  lastError: null
}

export type ResolvedEnterpriseSettings =
  | { status: 'enabled'; serverUrl: string; token: string }
  | { status: 'disabled'; reason: string }

const CONFIG_FILE_NAME = 'enterprise.json'
const STATE_FILE_NAME = 'enterprise.state.json'
const CACHE_FILE_NAME = 'enterprise.cache.json'
/** 打包内置的部署默认值（resources/ 随 asar 分发）；用户文件不存在时兜底，使安装包开箱即用。 */
const DEFAULT_CONFIG_RESOURCE = 'enterprise.default.json'

const ENV_SERVER_URL = 'CHERRY_ENTERPRISE_SERVER_URL'
const ENV_TOKEN = 'CHERRY_ENTERPRISE_TOKEN'

export function getEnterpriseConfigFilePath(): string {
  return application.getPath('cherry.config', CONFIG_FILE_NAME)
}

export function getEnterpriseStateFilePath(): string {
  return application.getPath('cherry.config', STATE_FILE_NAME)
}

export function getEnterpriseCacheFilePath(): string {
  return application.getPath('cherry.config', CACHE_FILE_NAME)
}

/** Cheap existence probe for the cache file — no parse, no validation. */
export function enterpriseCacheExists(): boolean {
  try {
    return fs.existsSync(getEnterpriseCacheFilePath())
  } catch {
    return false
  }
}

/**
 * Read `enterprise.json`, apply the env overrides, and classify the result.
 * Priority: env overrides > user file > bundled default (`resources/enterprise.default.json`,
 * enterprise builds ship one so installs work out of the box). A missing user file without a
 * bundled default, unparsable JSON, or `enabled: false` yields `disabled` (the service then
 * idles silently — this is the normal case for consumer builds).
 */
export function loadEnterpriseSettings(): ResolvedEnterpriseSettings {
  const filePath = getEnterpriseConfigFilePath()

  let raw: string | null = null
  let rawIsBundled = false
  try {
    raw = fs.readFileSync(filePath, 'utf-8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      return { status: 'disabled', reason: `failed to read ${filePath}: ${String(error)}` }
    }
    // 用户未建配置文件时回退打包默认值；企业用户手工创建 enterprise.json 即完全接管
    raw = readBundledDefaultConfig()
    rawIsBundled = raw !== null
  }

  let fileConfig: Partial<EnterpriseSettingsConfig> = {}
  if (raw !== null) {
    const source = rawIsBundled ? `bundled ${DEFAULT_CONFIG_RESOURCE}` : CONFIG_FILE_NAME
    try {
      const parsed: unknown = JSON.parse(raw)
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        return { status: 'disabled', reason: `${source} root is not an object` }
      }
      fileConfig = parsed as Partial<EnterpriseSettingsConfig>
    } catch (error) {
      return { status: 'disabled', reason: `${source} is not valid JSON: ${String(error)}` }
    }
  }

  // Env overrides win over file values (dev workflow: no file needed when both
  // env vars are present; `enabled` otherwise comes from the file only).
  const envServerUrl = process.env[ENV_SERVER_URL]?.trim()
  const envToken = process.env[ENV_TOKEN]?.trim()
  const serverUrl = envServerUrl || (typeof fileConfig.serverUrl === 'string' ? fileConfig.serverUrl.trim() : '')
  const token = envToken || (typeof fileConfig.token === 'string' ? fileConfig.token.trim() : '')
  const enabled = raw !== null ? fileConfig.enabled === true : Boolean(envServerUrl && envToken)

  if (!enabled) {
    return {
      status: 'disabled',
      reason:
        raw === null
          ? 'config file not found'
          : rawIsBundled
            ? 'disabled in bundled default config'
            : 'enabled is false in config file'
    }
  }
  if (!serverUrl || !token) {
    return { status: 'disabled', reason: 'serverUrl/token missing (neither file nor env override provides them)' }
  }

  return { status: 'enabled', serverUrl: serverUrl.replace(/\/+$/, ''), token }
}

/** 读打包默认配置；缺失或读不了返回 null（消费版构建没有该文件的正常情况）。 */
function readBundledDefaultConfig(): string | null {
  try {
    return fs.readFileSync(application.getPath('app.root.resources', DEFAULT_CONFIG_RESOURCE), 'utf-8')
  } catch {
    return null
  }
}

/** Read `enterprise.state.json`; any absence/corruption falls back to defaults. */
export function loadEnterpriseState(): EnterpriseSyncState {
  try {
    const raw = fs.readFileSync(getEnterpriseStateFilePath(), 'utf-8')
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return { ...DEFAULT_ENTERPRISE_SYNC_STATE }
    }
    const record = parsed as Record<string, unknown>
    return {
      lastAppliedVersion: typeof record.lastAppliedVersion === 'number' ? record.lastAppliedVersion : null,
      lastSyncedAt: typeof record.lastSyncedAt === 'string' ? record.lastSyncedAt : null,
      lastError: typeof record.lastError === 'string' ? record.lastError : null
    }
  } catch {
    return { ...DEFAULT_ENTERPRISE_SYNC_STATE }
  }
}

/** Persist sync state with an atomic write. Throws so callers can decide (log vs record). */
export async function saveEnterpriseState(state: EnterpriseSyncState): Promise<void> {
  await atomicWriteFile(toAbsoluteFilePath(getEnterpriseStateFilePath()), JSON.stringify(state, null, 2))
}

/**
 * Best-effort state save for non-critical paths (304 touch, degraded paths):
 * failures are logged, never thrown.
 */
export async function saveEnterpriseStateSafe(state: EnterpriseSyncState): Promise<void> {
  try {
    await saveEnterpriseState(state)
  } catch (error) {
    logger.warn('Failed to persist enterprise sync state', error as Error)
  }
}

/**
 * Persist the fetched server config to `enterprise.cache.json` (atomic write).
 * The cache is the degraded-boot fallback: when the server is unreachable on a
 * later boot, the cached config is applied instead.
 */
export async function saveEnterpriseCache(config: EnterpriseClientConfig): Promise<void> {
  await atomicWriteFile(toAbsoluteFilePath(getEnterpriseCacheFilePath()), JSON.stringify(config, null, 2))
}

/** Read + validate `enterprise.cache.json`; returns null when absent or unusable. */
export function loadEnterpriseCache(): EnterpriseClientConfig | null {
  try {
    const raw = fs.readFileSync(getEnterpriseCacheFilePath(), 'utf-8')
    return validateEnterpriseConfigPayload(JSON.parse(raw))
  } catch {
    return null
  }
}
