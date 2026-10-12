import type { MouseEvent as ReactMouseEvent } from 'react'
import { useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import {
  buildKnowledgeBaseGroupSections,
  DEFAULT_KNOWLEDGE_GROUP_LABEL_KEY
} from '@renderer/pages/knowledge/utils/group'
import type { KnowledgeBaseListItem } from '@shared/data/api/schemas/knowledges'
import type { Group } from '@shared/data/types/group'
import type { KnowledgeBase, SharedKnowledgeBase } from '@shared/data/types/knowledge'

import BaseNavigatorContent from './BaseNavigatorContent'
import BaseNavigatorResizeHandle from './BaseNavigatorResizeHandle'

interface BaseNavigatorProps {
  bases: KnowledgeBaseListItem[]
  groups: Group[]
  isLoading: boolean
  width: number
  selectedBaseId: string
  onSelectBase: (baseId: string) => void
  onCreateGroup: (baseId: string) => void
  onCreateBase: (groupId?: string) => void
  onMoveBase: (baseId: string, groupId: string | null) => Promise<void> | void
  onRenameBase: (base: Pick<KnowledgeBase, 'id' | 'name'>) => void
  onRenameGroup: (group: Pick<Group, 'id' | 'name'>) => void
  onDeleteGroup: (groupId: string) => Promise<void> | void
  onDeleteBase: (baseId: string) => Promise<void> | void
  sharedKbs: SharedKnowledgeBase[]
  selectedSharedKbId: string | null
  onSelectSharedKb: (kbId: string) => void
  onResizeStart: (event: ReactMouseEvent<HTMLDivElement>) => void
}

const BaseNavigator = ({
  bases,
  groups,
  isLoading,
  width,
  selectedBaseId,
  onSelectBase,
  onCreateGroup,
  onCreateBase,
  onMoveBase,
  onRenameBase,
  onRenameGroup,
  onDeleteGroup,
  onDeleteBase,
  sharedKbs,
  selectedSharedKbId,
  onSelectSharedKb,
  onResizeStart
}: BaseNavigatorProps) => {
  const { t } = useTranslation()

  const knowledgeBaseGroupSections = useMemo(() => buildKnowledgeBaseGroupSections(bases, groups, ''), [bases, groups])

  const groupById = useMemo(() => {
    return new Map(groups.map((group) => [group.id, group]))
  }, [groups])

  const getGroupLabel = useCallback(
    (groupId: string | null) => {
      if (groupId == null) {
        return t(DEFAULT_KNOWLEDGE_GROUP_LABEL_KEY)
      }

      return groupById.get(groupId)?.name ?? groupId
    },
    [groupById, t]
  )

  return (
    <div data-ui="knowledge.navigation" style={{ width }} className="relative h-full min-h-0 shrink-0">
      {/* `p-1.5` and the padding-free rows below match the assistant and agent rails'
          `ResourceList.Frame`, so the three sidebars indent identically. The create
          action now lives in the personal scope section's header (SharedKnowledgeSection). */}
      <aside className="flex size-full min-h-0 flex-col border-r-[0.5px] border-border p-1.5">
        <BaseNavigatorContent
          isLoading={isLoading}
          sections={knowledgeBaseGroupSections}
          groups={groups}
          groupById={groupById}
          selectedBaseId={selectedBaseId}
          getGroupLabel={getGroupLabel}
          onSelectBase={onSelectBase}
          onMoveBase={onMoveBase}
          onRenameBase={onRenameBase}
          onRenameGroup={onRenameGroup}
          onCreateBaseInGroup={onCreateBase}
          onCreateGroup={onCreateGroup}
          onDeleteGroup={onDeleteGroup}
          onDeleteBase={onDeleteBase}
          sharedKbs={sharedKbs}
          selectedSharedKbId={selectedSharedKbId}
          onSelectSharedKb={onSelectSharedKb}
        />
      </aside>

      <BaseNavigatorResizeHandle onResizeStart={onResizeStart} />
    </div>
  )
}

export default BaseNavigator
