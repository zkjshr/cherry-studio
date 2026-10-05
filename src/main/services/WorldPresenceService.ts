/**
 * Little World (小世界) presence — client identity + liveness heartbeat.
 *
 * PRD D8: 客户端开着即在线 — presence comes from this service's heartbeat,
 * not from entering the 3D scene. The world service marks a client offline
 * after a 90s heartbeat window; the 30s cadence here keeps a long-lived
 * client comfortably inside it.
 *
 * - `cid`: a UUID minted once and persisted to `userData/world-presence.json`
 *   (atomic write, same durability pattern as `enterpriseSettings`). It is
 *   the world-side identity for profiles, position sessions and presence,
 *   passed to the webview as `?cid=`.
 * - Heartbeat: from `onAllReady`, every 30s while a world URL is configured
 *   (the `enterprise.world_url` preference, re-read per beat so a gateway
 *   publish takes effect without a restart). POST `{worldUrl}/api/heartbeat`
 *   with `X-Client-Token` + `{cid}`. Failures are warn-logged and recorded on
 *   the info snapshot — never thrown, never retried faster than the cadence
 *   (no retry storm), and a beat that runs long cannot pile up behind itself.
 */

import { randomUUID } from 'node:crypto'
import fs from 'node:fs'

import { net } from 'electron'

import { application } from '@application'
import { loggerService } from '@logger'
import { BaseService, DependsOn, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'
import { loadEnterpriseSettings } from '@main/enterprise/enterpriseSettings'
import { loadEnterpriseWorldUrl } from '@main/enterprise/worldUrl'
import { atomicWriteFile } from '@main/utils/file'
import { AbsoluteFilePathSchema, type AbsoluteFilePath } from '@shared/types/file'
import type { WorldPresenceConfig, WorldPresenceInfo } from '@shared/types/world'

const logger = loggerService.withContext('WorldPresenceService')

/** Heartbeat cadence; the world's offline window is 90s (PRD §4). */
const HEARTBEAT_INTERVAL_MS = 30_000
/** Per-beat abort so an unreachable world cannot hold the loop. */
const HEARTBEAT_TIMEOUT_MS = 10_000

const PRESENCE_FILE_NAME = 'world-presence.json'

interface PersistedPresence {
  cid?: unknown
}

export function getPresenceFilePath(): string {
  return application.getPath('app.userdata', PRESENCE_FILE_NAME)
}

function toAbsoluteFilePath(path: string): AbsoluteFilePath {
  return AbsoluteFilePathSchema.parse(path)
}

/** Parse the presence file; `null` for absent/corrupt/non-object content. */
export function parsePresenceFile(raw: string | null): { cid: string } | null {
  if (raw === null) return null
  try {
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null
    const record = parsed as PersistedPresence
    return typeof record.cid === 'string' && record.cid ? { cid: record.cid } : null
  } catch {
    return null
  }
}

@Injectable('WorldPresenceService')
@ServicePhase(Phase.WhenReady)
@DependsOn(['DbService'])
export class WorldPresenceService extends BaseService {
  /** Cached identity — loaded lazily on first access, stable for the process. */
  private cid: string | null = null
  private lastHeartbeatAt: string | null = null
  private lastError: string | null = null
  /** Overlap guard: a slow beat is skipped, never queued (no pile-up). */
  private beatInFlight = false

  /**
   * One persistent client identity. The file is best-effort: a read or write
   * failure mints a fresh uuid rather than failing boot — a lost cid only
   * means the world sees the client as a new arrival (profiles are re-filled
   * once per identity), never a broken app.
   */
  public getCid(): string {
    if (this.cid) return this.cid

    let stored: { cid: string } | null = null
    try {
      stored = parsePresenceFile(fs.readFileSync(getPresenceFilePath(), 'utf-8'))
    } catch {
      stored = null // absent (normal first run) or unreadable
    }
    this.cid = stored?.cid ?? randomUUID()
    if (!stored) {
      void this.persistCid()
    }
    return this.cid
  }

  private async persistCid(): Promise<void> {
    try {
      await atomicWriteFile(toAbsoluteFilePath(getPresenceFilePath()), JSON.stringify({ cid: this.getCid() }, null, 2))
    } catch (error) {
      logger.warn('Failed to persist Little World cid; a new one will be minted next boot', error as Error)
    }
  }

  protected async onAllReady(): Promise<void> {
    // First beat right away (client is "online" from boot), then the cadence.
    // registerInterval catches sync throws; the beat itself never rejects.
    void this.beat()
    this.registerInterval(() => this.beat(), HEARTBEAT_INTERVAL_MS)
  }

  /** Renderer entry point (`World_GetConfig`): the webview bootstrap payload. */
  public getConfig(): WorldPresenceConfig {
    const url = loadEnterpriseWorldUrl()
    const settings = loadEnterpriseSettings()
    return {
      enabled: url !== null,
      url,
      cid: this.getCid(),
      // 一期 world 与网关共用同一令牌（PRD：鉴权复用 GATEWAY_TOKEN 语义）；
      // 企业配置未启用时无令牌可取，world 侧按未鉴权处理。
      token: settings.status === 'enabled' ? settings.token : ''
    }
  }

  /** Presence snapshot for diagnostics / settings display. */
  public getPresenceInfo(): WorldPresenceInfo {
    return {
      cid: this.getCid(),
      worldUrl: loadEnterpriseWorldUrl(),
      lastHeartbeatAt: this.lastHeartbeatAt,
      lastError: this.lastError
    }
  }

  /** One heartbeat round. Never throws — failures land on `lastError` + warn log. */
  private async beat(): Promise<void> {
    if (this.beatInFlight) return
    this.beatInFlight = true
    try {
      const worldUrl = loadEnterpriseWorldUrl()
      if (!worldUrl) {
        // 未部署：不发心跳；残留的失败态一并清掉，恢复配置后从干净状态开始
        this.lastHeartbeatAt = null
        this.lastError = null
        return
      }

      const settings = loadEnterpriseSettings()
      const token = settings.status === 'enabled' ? settings.token : ''
      const response = await net.fetch(`${worldUrl}/api/heartbeat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Client-Token': token },
        body: JSON.stringify({ cid: this.getCid() }),
        signal: AbortSignal.timeout(HEARTBEAT_TIMEOUT_MS)
      })
      if (!response.ok) {
        throw new Error(`heartbeat rejected: HTTP ${response.status}`)
      }
      this.lastHeartbeatAt = new Date().toISOString()
      this.lastError = null
    } catch (error) {
      // 静默降级：warn 即可，30s 周期自然重试，不做指数退避/加速重试
      this.lastError = error instanceof Error ? error.message : String(error)
      logger.warn('Little World heartbeat failed', error as Error)
    } finally {
      this.beatInFlight = false
    }
  }
}
