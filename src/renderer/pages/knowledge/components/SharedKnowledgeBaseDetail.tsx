import { useTranslation } from 'react-i18next'

import { EmptyState } from '@cherrystudio/ui'

import { useKnowledgePage } from '../KnowledgePageProvider'

/**
 * WeKnora 共享库（部门/公共）只读详情：库不可在客户端增删文档，说明文案 +
 * 可选"去对话检索"（跳企业置顶知识话题；无置顶话题时按钮隐藏）。
 */
const SharedKnowledgeBaseDetail = () => {
  const { t } = useTranslation()
  const { selectedSharedKb, chatTopicId } = useKnowledgePage()

  if (!selectedSharedKb) {
    return null
  }

  return (
    <main data-ui="knowledge.content" className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      <EmptyState
        illustration="book"
        title={selectedSharedKb.name}
        description={t(
          selectedSharedKb.scope === 'dept'
            ? 'knowledge.shared.description.department'
            : 'knowledge.shared.description.public'
        )}
        {...(chatTopicId
          ? {
              actionLabel: t('knowledge.shared.open_chat'),
              onAction: () => window.open(`/app/chat?topicId=${encodeURIComponent(chatTopicId)}`, '_self')
            }
          : {})}
      />
    </main>
  )
}

export default SharedKnowledgeBaseDetail
