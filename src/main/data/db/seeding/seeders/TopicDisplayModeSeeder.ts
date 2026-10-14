import { and, eq } from 'drizzle-orm'

import { preferenceTable } from '@data/db/schemas/preference'

import type { DbType, ISeeder } from '../../types'

/**
 * 对话列表默认分组改为「按时间」（2026-10）。
 *
 * 只迁移仍停留在旧默认值 'assistant' 的行——与 AgentSessionDisplayModeSeeder
 * 同一取舍：无法区分"明确选过 assistant"和"停留在旧默认"，统一迁到 time，
 * 迁移后仍可随时在界面里切换回去。
 */
const PREFERENCE_UPGRADE = {
  scope: 'default',
  key: 'topic.tab.display_mode',
  legacyDefault: 'assistant',
  nextDefault: 'time'
} as const

export class TopicDisplayModeSeeder implements ISeeder {
  readonly name = 'topicDisplayModeTime'
  readonly description = 'Switch the default topic grouping from assistant to time'
  readonly version = '1'

  run(db: DbType): void {
    const current = db
      .select({ value: preferenceTable.value })
      .from(preferenceTable)
      .where(and(eq(preferenceTable.scope, PREFERENCE_UPGRADE.scope), eq(preferenceTable.key, PREFERENCE_UPGRADE.key)))
      .get()
    // 无行 = 从未改过，读取时走 schema 新默认（time），无需写入。
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
