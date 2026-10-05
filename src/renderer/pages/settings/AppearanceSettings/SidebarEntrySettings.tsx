import { arrayMove } from '@dnd-kit/sortable'
import { GripVertical } from 'lucide-react'
import type { FC } from 'react'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { Sortable, Switch } from '@cherrystudio/ui'
import { SIDEBAR_ICON_COMPONENTS } from '@renderer/components/app/sidebarIcons'
import {
  SettingDescription,
  SettingDivider,
  SettingGroup,
  SettingRow,
  SettingTitle
} from '@renderer/components/SettingsPrimitives'
import { useSidebarShortcuts } from '@renderer/hooks/useSidebarShortcuts'
import { getSidebarIconLabelKey } from '@renderer/i18n/label'
import {
  SIDEBAR_APPS,
  SIDEBAR_SHORTCUT_PROVIDER_IDS,
  createSidebarShortcutTarget,
  isSidebarAppId
} from '@renderer/utils/sidebar'
import { createSidebarShortcutId, type SidebarShortcutItem } from '@shared/data/preference/preferenceTypes'

/** 构造 core.app 置顶项（与侧栏存储形态一致）。 */
const coreAppShortcutItem = (resourceId: string): SidebarShortcutItem => {
  const target = createSidebarShortcutTarget(SIDEBAR_SHORTCUT_PROVIDER_IDS.APP, resourceId)
  return { type: 'shortcut', id: createSidebarShortcutId(target), target }
}

const isCoreAppItem = (item: SidebarShortcutItem): boolean =>
  item.type === 'shortcut' &&
  item.target.kind === 'resource' &&
  item.target.locator.providerId === SIDEBAR_SHORTCUT_PROVIDER_IDS.APP &&
  isSidebarAppId(item.target.locator.resourceId)

/**
 * 侧栏入口管理：开关驱动既有的 core.app 置顶体系（与右键固定一致）；已显示
 * 的入口支持拖拽排序——顺序直接作用于真实侧栏（替换存储列表中的 core.app 段，
 * 其他置顶项如具体助手/文件保持原位不动）。
 */
const SidebarEntrySettings: FC = () => {
  const { t } = useTranslation()
  const { shortcuts, isPinned, setPinned, reorder } = useSidebarShortcuts()

  const pinnedAppIds = useMemo(
    () => shortcuts.filter(isCoreAppItem).map((item) => item.target.locator.resourceId),
    [shortcuts]
  )
  const pinnedSet = useMemo(() => new Set(pinnedAppIds), [pinnedAppIds])
  const unpinnedAppIds = useMemo(
    () => SIDEBAR_APPS.map((app) => app.id).filter((id) => !pinnedSet.has(id)),
    [pinnedSet]
  )

  const handleSortEnd = ({ oldIndex, newIndex }: { oldIndex: number; newIndex: number }) => {
    if (oldIndex === newIndex) return
    const nextAppIds = arrayMove(pinnedAppIds, oldIndex, newIndex)
    // 按序替换存储列表里的 core.app 项，非应用置顶项原位保留。
    const appItems = nextAppIds.map(coreAppShortcutItem)
    let cursor = 0
    const nextList = shortcuts.map((item) => (isCoreAppItem(item) ? (appItems[cursor++] ?? item) : item))
    void reorder(nextList)
  }

  const renderEntryRow = (appId: string, draggable: boolean) => {
    const Icon = SIDEBAR_ICON_COMPONENTS[appId as keyof typeof SIDEBAR_ICON_COMPONENTS]
    const label = t(getSidebarIconLabelKey(appId))
    const target = createSidebarShortcutTarget(SIDEBAR_SHORTCUT_PROVIDER_IDS.APP, appId)
    return (
      <div
        key={appId}
        data-ui="settings.sidebar-entry"
        data-app={appId}
        className="flex items-center gap-3 rounded-xl px-3 py-2.5 transition-colors hover:bg-accent">
        {draggable ? (
          <span className="flex size-5 shrink-0 cursor-grab touch-none items-center justify-center rounded-md text-muted-foreground hover:text-foreground active:cursor-grabbing">
            <GripVertical className="size-3.5" />
          </span>
        ) : (
          <span className="size-5 shrink-0" aria-hidden />
        )}
        <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
          <Icon className="size-4" />
        </span>
        <span className="min-w-0 flex-1 truncate text-sm">{label}</span>
        <Switch checked={isPinned(target)} onCheckedChange={(checked) => setPinned(target, checked, label)} />
      </div>
    )
  }

  return (
    <SettingGroup data-ui="settings.sidebar-entries">
      <SettingTitle>{t('settings.sidebarEntries.title')}</SettingTitle>
      <SettingDivider />
      <SettingRow>
        <SettingDescription>{t('settings.sidebarEntries.description')}</SettingDescription>
      </SettingRow>

      <p className="mt-2 mb-1 text-xs font-medium text-muted-foreground">{t('settings.sidebarEntries.shown')}</p>
      {pinnedAppIds.length > 0 ? (
        <div className="flex flex-col gap-1.5">
          <Sortable
            items={pinnedAppIds}
            itemKey={(id) => id}
            onSortEnd={handleSortEnd}
            layout="list"
            dragHandle
            renderItem={(id, { dragging, dragHandleProps }) => (
              <div
                className={dragging ? 'opacity-40' : undefined}
                ref={dragHandleProps?.ref}
                {...dragHandleProps?.attributes}
                {...dragHandleProps?.listeners}>
                {renderEntryRow(id, true)}
              </div>
            )}
          />
        </div>
      ) : (
        <p className="rounded-xl border border-dashed px-4 py-3 text-xs text-muted-foreground">
          {t('settings.sidebarEntries.shownEmpty')}
        </p>
      )}

      <p className="mt-5 mb-1 text-xs font-medium text-muted-foreground">{t('settings.sidebarEntries.hidden')}</p>
      <div className="flex flex-col gap-1.5">{unpinnedAppIds.map((appId) => renderEntryRow(appId, false))}</div>
    </SettingGroup>
  )
}

export default SidebarEntrySettings
