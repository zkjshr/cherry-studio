/**
 * Enterprise sync state snapshot — the payload served over the
 * `Enterprise_GetState` IPC channel and consumed by the renderer's
 * 「企业管理」 card and read-only guards.
 */

export interface EnterpriseStateSnapshot {
  /** Whether an enterprise config source (file or env) is currently enabled. */
  enabled: boolean
  lastAppliedVersion: number | null
  lastSyncedAt: string | null
  lastError: string | null
  /** provider ids in the `enterprise-` namespace currently in the database. */
  managedProviderIds: string[]
  /** Assistant UUIDs applied from `managed: true` config entries. */
  managedAssistantIds: string[]
  /** MCP server storage names carrying the `[企业] ` prefix. */
  managedMcpNames: string[]
}

/** Result of a renderer-triggered `Enterprise_Sync` invocation. */
export interface EnterpriseSyncResult {
  ok: boolean
  state: EnterpriseStateSnapshot
  /** Present when the sync itself failed unexpectedly (syncOnce is defensive, this is the last resort). */
  error?: string
}
