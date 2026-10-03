import dayjs from 'dayjs'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@cherrystudio/ui'
import {
  SettingDescription,
  SettingDivider,
  SettingGroup,
  SettingRow,
  SettingRowTitle,
  SettingTitle
} from '@renderer/components/SettingsPrimitives'
import { useEnterpriseState } from '@renderer/hooks/useEnterpriseState'
import { toast } from '@renderer/services/toast'
import { formatErrorMessage } from '@renderer/utils/error'

/**
 * 「企业管理」 card — shows the enterprise config sync state and offers a
 * manual sync. Mounted at the bottom of GeneralSettings; hidden surfaces
 * (providers/assistants/MCP/miniapps guards) read the same state via
 * `useEnterpriseState`.
 */
const EnterpriseSettingsCard = () => {
  const { t } = useTranslation()
  const { enterpriseState, isLoading, mutate } = useEnterpriseState()
  const [syncing, setSyncing] = useState(false)

  const handleSync = async () => {
    setSyncing(true)
    try {
      const result = await window.api.enterprise.sync()
      // The sync result already carries a fresh snapshot — write it instead of re-querying.
      await mutate(result.state, { revalidate: false })
      if (result.ok) {
        toast.success(t('settings.enterprise.sync_success'))
      } else {
        toast.error(`${t('settings.enterprise.sync_failed')}${result.error ? `: ${result.error}` : ''}`)
      }
    } catch (error) {
      toast.error(formatErrorMessage(error))
    } finally {
      setSyncing(false)
    }
  }

  const renderStatusLine = () => {
    if (!enterpriseState) return isLoading ? t('common.loading') : t('settings.enterprise.not_enabled')
    if (!enterpriseState.enabled) return t('settings.enterprise.not_enabled')
    if (enterpriseState.lastError) {
      return `${t('settings.enterprise.sync_failed')}: ${enterpriseState.lastError}`
    }
    if (enterpriseState.lastAppliedVersion !== null) {
      return t('settings.enterprise.synced_at', {
        version: enterpriseState.lastAppliedVersion,
        time: enterpriseState.lastSyncedAt ? dayjs(enterpriseState.lastSyncedAt).format('YYYY-MM-DD HH:mm') : '—'
      })
    }
    return t('settings.enterprise.not_synced')
  }

  return (
    <SettingGroup>
      <SettingTitle>{t('settings.enterprise.title')}</SettingTitle>
      <SettingDivider />
      <SettingRow id="setting-general-enterprise-sync" className="scroll-mt-6 items-start gap-6">
        <div className="min-w-0 flex-1">
          <SettingRowTitle className="gap-1">{t('settings.enterprise.sync_status')}</SettingRowTitle>
          <SettingDescription className="mt-1.5 break-all leading-5">{renderStatusLine()}</SettingDescription>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={syncing}
          className="shrink-0"
          onClick={() => void handleSync()}>
          {syncing ? t('settings.enterprise.syncing') : t('settings.enterprise.sync_now')}
        </Button>
      </SettingRow>
    </SettingGroup>
  )
}

export default EnterpriseSettingsCard
