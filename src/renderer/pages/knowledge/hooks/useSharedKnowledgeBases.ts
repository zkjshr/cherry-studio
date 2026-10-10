import useSWR from 'swr'

import { ipcApi } from '@renderer/ipc'
import type { SharedKnowledgeBasesPayload } from '@shared/data/types/knowledge'

export const SHARED_KNOWLEDGE_BASES_CACHE_KEY = 'knowledge.list_shared_kbs'

const EMPTY_SHARED_KNOWLEDGE_BASES: SharedKnowledgeBasesPayload = { kbs: [], chatTopicId: null }

/**
 * 企业共享知识库目录（网关 /knowledge/api/kbs 下发，客户端只读）。失败已在主进程
 * 降级为空目录，这里不再重试；目录由管理员维护，客户端只读即可。
 */
export const useSharedKnowledgeBases = () => {
  const query = useSWR<SharedKnowledgeBasesPayload>(
    SHARED_KNOWLEDGE_BASES_CACHE_KEY,
    () => ipcApi.request('knowledge.list_shared_kbs'),
    { shouldRetryOnError: false }
  )

  return { payload: query.data ?? EMPTY_SHARED_KNOWLEDGE_BASES, isLoading: query.isLoading }
}
