import type { FC } from 'react'
import { useTranslation } from 'react-i18next'

import { Badge } from '@cherrystudio/ui'
import { cn } from '@renderer/utils/style'

/**
 * 「企业」 marker for enterprise-managed resources (providers, assistants,
 * MCP servers, miniapps). Display-only: the accompanying read-only guards
 * hide the edit/delete entry points separately.
 */
const EnterpriseBadge: FC<{ className?: string }> = ({ className }) => {
  const { t } = useTranslation()
  return (
    <Badge
      variant="secondary"
      className={cn('h-4 shrink-0 rounded-md border-transparent px-1.5 text-[10px] leading-none', className)}>
      {t('common.enterprise_badge')}
    </Badge>
  )
}

export default EnterpriseBadge
