/**
 * Little World (小世界) presence — shared between the main-process
 * WorldPresenceService (heartbeat + identity) and the renderer's world page
 * (webview bootstrap over the `World_GetConfig` IPC channel).
 */

/** Payload of the `World_GetConfig` IPC channel. */
export interface WorldPresenceConfig {
  /** Whether a world service is deployed (gateway published a `world_url`). */
  enabled: boolean
  /** World service base URL (trailing slash stripped); `null` when not deployed. */
  url: string | null
  /** Persistent client identity (uuid in userData), passed to the world as `?cid=`. */
  cid: string
  /**
   * Gateway client token sent as `X-Client-Token`. Phase 1 note: the world
   * service deliberately reuses the gateway token (GATEWAY_TOKEN 语义)，so the
   * same credential authenticates heartbeats and WS sessions; a dedicated
   * world token can replace this without changing callers.
   */
  token: string
}

/** Last-known presence state, for diagnostics and the settings card. */
export interface WorldPresenceInfo {
  cid: string
  worldUrl: string | null
  /** ISO timestamp of the last accepted heartbeat; `null` when none yet. */
  lastHeartbeatAt: string | null
  /** Message of the last failed heartbeat; `null` when the last beat succeeded. */
  lastError: string | null
}
