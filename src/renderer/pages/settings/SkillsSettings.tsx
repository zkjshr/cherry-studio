import { useNavigate } from '@tanstack/react-router'
import { Store } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button, Tabs, TabsContent, TabsList, TabsTrigger } from '@cherrystudio/ui'
import { ResourceCatalogView } from '@renderer/components/resourceCatalog/catalog'
import { SettingsContentBody } from '@renderer/components/SettingsPrimitives'
import { useSkillLauncher } from '@renderer/hooks/useSkillLauncher'
import type { ResourceItem } from '@renderer/types/resourceCatalog'

export function SkillsSettings() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const launchSkill = useSkillLauncher()
  const [scope, setScope] = useState('all')
  const filterResource = (resource: ResourceItem) =>
    scope === 'all' || (resource.type === 'skill' && resource.raw.scope === scope)

  return (
    <SettingsContentBody className="min-h-0 flex-1 overflow-hidden pt-4" innerClassName="flex min-h-0 flex-1 flex-col">
      <Tabs value={scope} onValueChange={setScope} variant="underline" className="min-h-0 flex-1">
        <TabsContent value={scope} className="mt-0 flex min-h-0 flex-1 flex-col">
          <ResourceCatalogView
            resourceType="skill"
            variant="settings"
            title={t('settings.skills.title')}
            className="min-h-0 flex-1"
            onOpenSkill={(skill) => void navigate({ to: '/settings/skills/$skillId', params: { skillId: skill.id } })}
            onLaunchSkill={launchSkill}
            filterResource={filterResource}
            allowColumnToggle
            toolbarFooter={
              <div className="flex min-w-0 flex-1 items-center gap-3">
                <TabsList className="shrink-0" aria-label={t('settings.skills.title')}>
                  <TabsTrigger value="all">{t('common.all')}</TabsTrigger>
                  <TabsTrigger value="system">{t('settings.skills.tabs.system')}</TabsTrigger>
                  <TabsTrigger value="builtin">{t('settings.skills.tabs.builtin')}</TabsTrigger>
                </TabsList>
                <Button
                  variant="outline"
                  size="sm"
                  className="ml-auto shrink-0 gap-1.5"
                  data-ui="settings.skills.browse-market"
                  onClick={() => void navigate({ to: '/app/market' })}>
                  <Store size={13} />
                  {t('settings.skills.browseMarket')}
                </Button>
              </div>
            }
          />
        </TabsContent>
      </Tabs>
    </SettingsContentBody>
  )
}
