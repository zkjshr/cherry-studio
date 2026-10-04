/**
 * Managed-assistant id list — the reader for the
 * `enterprise.managed_assistant_ids` preference row that
 * `applyEnterpriseConfig` rewrites on every apply (direct-insert JSON array
 * of assistant UUIDs, scope `default`).
 *
 * Consumers:
 * - `EnterpriseConfigService.getState` (renderer read-only guard snapshot)
 * - the marketplace service (E5): a plugin install must never overwrite an
 *   enterprise-managed assistant, and an uninstall must never archive one.
 *
 * The row persists independently of sync state, so the guard stays effective
 * even when the enterprise server is unreachable.
 */

import { and, eq } from 'drizzle-orm'

import { application } from '@application'
import { preferenceTable } from '@data/db/schemas/preference'
import { loggerService } from '@logger'
import { ENTERPRISE_MANAGED_ASSISTANT_IDS_KEY } from '@shared/utils/enterprise'

const logger = loggerService.withContext('ManagedAssistants')

const PREFERENCE_SCOPE_DEFAULT = 'default'

/**
 * Read the managed assistant UUIDs. Returns `[]` for a missing/malformed row
 * (never throws — callers use the result as a safety guard, and a broken
 * preference row must degrade to "nothing is managed", not break installs).
 */
export function loadManagedAssistantIds(): string[] {
  try {
    const db = application.get('DbService').getDb()
    const [row] = db
      .select({ value: preferenceTable.value })
      .from(preferenceTable)
      .where(
        and(
          eq(preferenceTable.scope, PREFERENCE_SCOPE_DEFAULT),
          eq(preferenceTable.key, ENTERPRISE_MANAGED_ASSISTANT_IDS_KEY)
        )
      )
      .limit(1)
      .all()
    if (!Array.isArray(row?.value)) return []
    return row.value.filter((id): id is string => typeof id === 'string')
  } catch (error) {
    logger.warn('Failed to read managed assistant ids; treating as none', error as Error)
    return []
  }
}
