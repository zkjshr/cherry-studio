import { and, eq } from 'drizzle-orm'

import { preferenceTable } from '@data/db/schemas/preference'

import type { DbType, ISeeder } from '../../types'

/**
 * 工作区会话默认分组改为「按工作目录」（2026-10）。
 *
 * 只迁移仍停留在旧默认值 'agent' 的行——用户明确选过 time/workdir 的不动；
 * 被迁移后仍可随时在界面里切换回去。
 */
const PREFERENCE_UPGRADE = {
  scope: 'default',
  key: 'agent.session.display_mode',
  legacyDefault: 'agent',
  nextDefault: 'workdir'
} as const

export class AgentSessionDisplayModeSeeder implements ISeeder {
  readonly name = 'agentSessionDisplayModeWorkdir'
  readonly description = 'Switch the default agent session grouping from agent to working directory'
  readonly version = '1'

  run(db: DbType): void {
    const current = db
      .select({ value: preferenceTable.value })
      .from(preferenceTable)
      .where(and(eq(preferenceTable.scope, PREFERENCE_UPGRADE.scope), eq(preferenceTable.key, PREFERENCE_UPGRADE.key)))
      .get()
    // 无行 = 从未改过，读取时走 schema 新默认（workdir），无需写入。
    if (!current || current.value !== PREFERENCE_UPGRADE.legacyDefault) return

    db.transaction((tx) => {
      tx.update(preferenceTable)
        .set({ value: PREFERENCE_UPGRADE.nextDefault })
        .where(
          and(
            eq(preferenceTable.scope, PREFERENCE_UPGRADE.scope),
            eq(preferenceTable.key, PREFERENCE_UPGRADE.key),
            eq(preferenceTable.value, PREFERENCE_UPGRADE.legacyDefault)
          )
        )
        .run()
    })
  }
}
