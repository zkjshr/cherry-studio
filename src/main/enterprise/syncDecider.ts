/**
 * Pure decision core for the enterprise config sync loop.
 *
 * `EnterpriseConfigService.syncOnce()` performs the HTTP round-trip and then
 * asks this function what to do. Keeping the branch logic here (no I/O, no
 * Electron) lets every sync branch be unit tested in isolation — the service
 * only maps the decision to its side effects.
 */

/** Actions the sync service maps to side effects. */
export type SyncAction = 'apply_remote' | 'touch' | 'apply_cache' | 'idle'

export interface SyncDecisionInput {
  /**
   * HTTP status of the `/api/client/config` response, or null when the request
   * itself failed (network error, timeout, abort).
   */
  httpStatus: number | null
  /**
   * `ETag` version echoed by the server (parsed from the header), null when
   * absent. Informational — version agreement is the server's 200/304 call;
   * carried so callers can log/annotate the decision.
   */
  etagVersion: number | null
  /** Version recorded as applied in `enterprise.state.json`, null before the first apply. */
  lastAppliedVersion: number | null
  /** Whether a validated `enterprise.cache.json` exists on disk. */
  hasCache: boolean
  /** Whether a config (remote or cached) has already been applied during this boot. */
  appliedThisBoot: boolean
}

/**
 * Decide the action for one sync attempt.
 *
 * - 200 → `apply_remote`: server has a newer (or any) config; always applied
 *   because `applyEnterpriseConfig` is idempotent and re-applying repairs drift.
 * - 304 → `touch`: server confirms the applied version is current; only the
 *   sync timestamp moves.
 * - Anything else (network failure, timeout, 4xx/5xx) → `apply_cache` when the
 *   config has not been applied yet this boot and a cache exists (degraded
 *   boot path); otherwise `idle` — a re-apply from cache would add nothing.
 */
export function decideSyncAction(input: SyncDecisionInput): SyncAction {
  if (input.httpStatus === 200) return 'apply_remote'
  if (input.httpStatus === 304) return 'touch'
  if (!input.appliedThisBoot && input.hasCache) return 'apply_cache'
  return 'idle'
}
