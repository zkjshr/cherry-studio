import { eq, inArray, isNull, and } from 'drizzle-orm'

import { agentTable } from '@data/db/schemas/agent'
import { assistantTable } from '@data/db/schemas/assistant'

import type { DbType, ISeeder } from '../../types'

/**
 * 品牌改名一次性迁移（2026-10）：内置默认助手「Cherry 助手 / Cherry Assistant」
 * 与内置智能体「Cherry 小助手 / Cherry Assistant」统一更名为「TJAD 百事通」。
 *
 * 只改仍叫旧名的行——用户自己改过名的（不等于旧名）一律不动。种子器与
 * agent.json 模板里的新名只对全新安装生效，存量库靠这里对齐。
 */
const LEGACY_ASSISTANT_NAMES = ['Cherry 助手', 'Cherry Assistant'] as const
const LEGACY_AGENT_NAMES = ['Cherry 小助手', 'Cherry Assistant'] as const
const NEW_BRAND_NAME = 'TJAD 百事通'

export class TJADBrandRenameSeeder implements ISeeder {
  readonly name = 'tjadBrandRename'
  readonly description = 'Rename legacy Cherry-branded builtin assistant/agent rows to TJAD 百事通'
  readonly executionPolicy = 'run-on-change' as const
  readonly version = '1'

  run(db: DbType): void {
    db.transaction((tx) => {
      tx.update(assistantTable)
        .set({ name: NEW_BRAND_NAME })
        .where(and(isNull(assistantTable.deletedAt), inArray(assistantTable.name, [...LEGACY_ASSISTANT_NAMES])))
        .run()

      // builtin_role 存在 configuration JSON 里，先按旧名选出、JS 过滤角色后按 id 更名。
      const legacyAgents = tx
        .select({ id: agentTable.id, configuration: agentTable.configuration })
        .from(agentTable)
        .where(and(isNull(agentTable.deletedAt), inArray(agentTable.name, [...LEGACY_AGENT_NAMES])))
        .all()
      for (const agent of legacyAgents) {
        if (agent.configuration?.builtin_role !== 'assistant') continue
        tx.update(agentTable).set({ name: NEW_BRAND_NAME }).where(eq(agentTable.id, agent.id)).run()
      }
    })
  }
}
