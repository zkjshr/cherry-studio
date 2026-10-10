import { ChevronDown, Database, Plus } from 'lucide-react'
import type { ReactNode } from 'react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@cherrystudio/ui'
import { cn } from '@cherrystudio/ui/lib/utils'
import type { SharedKnowledgeBase } from '@shared/data/types/knowledge'

interface SharedKnowledgeSectionProps {
  scope: 'personal' | 'dept' | 'public'
  /** dept/public 分区的只读共享库行；个人分区不传（内容走 children）。 */
  kbs?: SharedKnowledgeBase[]
  selectedSharedKbId?: string | null
  onSelectSharedKb?: (kbId: string) => void
  /** 仅个人分区：头部 + 按钮（新建本地库），行为与原顶部 HeaderItem 一致。 */
  onCreate?: () => void
  /** 仅个人分区：既有的分组折叠列表原样嵌套。 */
  children?: ReactNode
}

/** 网关的 scope 枚举值（dept）与 i18n key（department）不同名，显式映射。 */
const SCOPE_LABEL_KEYS = {
  personal: 'knowledge.scope.personal',
  dept: 'knowledge.scope.department',
  public: 'knowledge.scope.public'
} as const

/**
 * ima 式固定分类分区头：可折叠 + 右侧 + 按钮（仅个人分区）。行高、留白与文字
 * 样式对齐 BaseNavigatorSectionTrigger / KnowledgeBaseRow，让三条侧栏读起来是
 * 一族。部门/公共库是管理员在网关侧维护的只读目录，行无右键菜单。
 */
const SharedKnowledgeSection = ({
  scope,
  kbs,
  selectedSharedKbId,
  onSelectSharedKb,
  onCreate,
  children
}: SharedKnowledgeSectionProps) => {
  const { t } = useTranslation()
  const [isOpen, setIsOpen] = useState(true)
  const label = t(SCOPE_LABEL_KEYS[scope])

  return (
    <section data-ui="knowledge.scope-section" className="space-y-1">
      <div className="flex h-8 w-full items-center gap-1 rounded-[10px] px-2 transition-colors hover:bg-muted">
        <button
          type="button"
          aria-expanded={isOpen}
          aria-label={label}
          onClick={() => setIsOpen((open) => !open)}
          className="flex min-h-0 min-w-0 flex-1 items-center gap-1.5 rounded-md text-left text-sm font-normal text-muted-foreground">
          <ChevronDown
            className={cn(
              'size-3.5 shrink-0 text-muted-foreground motion-safe:duration-[150ms] motion-safe:ease-[cubic-bezier(0.25,1,0.5,1)] motion-reduce:transition-none',
              !isOpen && '-rotate-90'
            )}
          />
          <span className="min-w-0 truncate">{label}</span>
        </button>

        {onCreate ? (
          <div className="ml-0.5 flex size-6 shrink-0 items-center justify-center">
            <Button
              type="button"
              variant="ghost"
              size="icon-navbar"
              aria-label={t('knowledge.add.title')}
              className="text-muted-foreground! hover:bg-muted hover:text-foreground!"
              onClick={onCreate}>
              <Plus className="size-3.5" />
            </Button>
          </div>
        ) : null}
      </div>

      {isOpen ? (
        <>
          {children}
          {(kbs ?? []).map((kb) => {
            const selected = kb.id === selectedSharedKbId
            return (
              <button
                key={kb.id}
                type="button"
                data-selected={selected}
                onClick={() => onSelectSharedKb?.(kb.id)}
                className={cn(
                  'flex h-8 w-full items-center gap-1 rounded-md px-2.5 transition-colors',
                  selected ? 'bg-muted text-foreground' : 'hover:bg-muted'
                )}>
                <Database className="size-4 shrink-0 text-muted-foreground" />
                <span className="min-w-0 truncate text-sm leading-5 font-normal text-foreground">{kb.name}</span>
              </button>
            )
          })}
        </>
      ) : null}
    </section>
  )
}

export default SharedKnowledgeSection
