/**
 * Little World (小世界) URL reader — the accessor for the
 * `enterprise.world_url` preference row that `applyEnterpriseConfig`
 * rewrites on every apply (see the gateway's `world_url` contract: present
 * and non-empty in the client config = deployed, dropped key = not).
 *
 * Consumers:
 * - `EnterpriseConfigService.getState` (renderer snapshot → sidebar/page gating)
 * - `WorldPresenceService` (heartbeat target; re-read per beat so an apply
 *   takes effect without a restart)
 *
 * The row persists independently of sync state, so a configured world URL
 * keeps working (or stays hidden) even when the enterprise server is
 * unreachable.
 */

import { and, eq } from 'drizzle-orm'

import { application } from '@application'
import { preferenceTable } from '@data/db/schemas/preference'
import { loggerService } from '@logger'
import { ENTERPRISE_WORLD_URL_KEY } from '@shared/utils/enterprise'

const logger = loggerService.withContext('EnterpriseWorldUrl')

const PREFERENCE_SCOPE_DEFAULT = 'default'

/**
 * Read the configured Little World URL. Returns `null` for a missing, empty,
 * or malformed row (never throws — a broken preference row must degrade to
 * "world not deployed", not break the snapshot or the heartbeat loop).
 */
export function loadEnterpriseWorldUrl(): string | null {
  try {
    const db = application.get('DbService').getDb()
    const [row] = db
      .select({ value: preferenceTable.value })
      .from(preferenceTable)
      .where(
        and(eq(preferenceTable.scope, PREFERENCE_SCOPE_DEFAULT), eq(preferenceTable.key, ENTERPRISE_WORLD_URL_KEY))
      )
      .limit(1)
      .all()
    return typeof row?.value === 'string' && row.value.trim() ? row.value : null
  } catch (error) {
    logger.warn('Failed to read enterprise world_url; treating as not deployed', error as Error)
    return null
  }
}
