import useSWR from 'swr'

import type { EnterpriseStateSnapshot } from '@shared/types/enterprise'

/**
 * Enterprise sync state (managed resource lists + sync status) fetched over
 * the legacy `Enterprise_GetState` IPC channel. Shared by the 「企业管理」
 * settings card and the read-only guards; `mutate` re-reads after a manual
 * sync.
 */
export const ENTERPRISE_STATE_CACHE_KEY = 'enterprise-state'

export function useEnterpriseState(options: { enabled?: boolean } = {}) {
  const query = useSWR<EnterpriseStateSnapshot>(
    options.enabled === false ? null : ENTERPRISE_STATE_CACHE_KEY,
    () => window.api.enterprise.getState(),
    { shouldRetryOnError: false }
  )

  return {
    ...query,
    enterpriseState: query.data
  }
}
