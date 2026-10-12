import { useNavigate } from '@tanstack/react-router'
import { ArrowLeft, Briefcase, Loader2, PackageOpen, RefreshCw, Settings2, Trash2 } from 'lucide-react'
import type { FC } from 'react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  EmptyState,
  SegmentedControl,
  Spinner,
  Tooltip
} from '@cherrystudio/ui'
import { Navbar, NavbarCenter } from '@renderer/components/Navbar'
import Scrollbar from '@renderer/components/Scrollbar'
import { useQuery } from '@renderer/data/hooks/useDataApi'
import { useAssistantMutations } from '@renderer/hooks/resourceCatalog'
import {
  toCreateAssistantDtoFromCatalogPreset,
  useAssistantCatalogPresets,
  type AssistantCatalogPreset
} from '@renderer/hooks/useAssistantCatalogPresets'
import { useSkillCatalog } from '@renderer/hooks/useSkills'
import { toast } from '@renderer/services/toast'
import { cn } from '@renderer/utils/style'
import type { MarketCatalogPlugin, MarketCatalogResult, MarketInstalledRecord } from '@shared/types/marketplace'

import { MarketSearchInput, PluginIcon } from './shared'
import SkillsBlock, { isMarketInstalledSkill, InstalledSkillsList } from './SkillsBlock'

/** 人才市场一次渲染的行数；「加载更多」逐批放出（全部预设约 780 个）。 */
const TALENT_PAGE_SIZE = 40

/**
 * 扩展页 = 两类技能源：公司源（网关目录展开的技能，SkillsBlock 公司分区）与
 * 外部源（SkillHub）。插件包本身不再作为卡片展示——包只是网关侧的发布容器，
 * 其技能以公司源技能呈现；已安装的包在管理视图（齿轮）中统一卸载。
 */
type MarketTab = 'plugins' | 'talent'

/** Page-level navigation: the skills market or the installed-plugins manager. */
type MarketView = { page: 'grid' } | { page: 'manage' }

/** 人才市场一行：预设智能体（与「添加助手」同源）+ 雇佣按钮。 */
const TalentCard: FC<{
  preset: AssistantCatalogPreset
  hired: boolean
  hiring: boolean
  onHire: (preset: AssistantCatalogPreset) => void
  onOpen: (preset: AssistantCatalogPreset) => void
}> = ({ preset, hired, hiring, onHire, onOpen }) => {
  const { t } = useTranslation()
  return (
    <div
      role="button"
      tabIndex={0}
      data-ui="market.talent.card"
      className="flex min-w-0 cursor-pointer items-center gap-3 rounded-xl px-2 py-2.5 transition-colors hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"
      onClick={() => onOpen(preset)}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          onOpen(preset)
        }
      }}>
      <span
        aria-hidden
        className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-muted text-lg select-none">
        {preset.emoji?.trim() || '🤖'}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-1.5">
          <span className="min-w-0 truncate text-sm font-semibold">{preset.name}</span>
        </div>
        {preset.description && (
          <div className="mt-0.5 truncate text-xs text-muted-foreground">{preset.description}</div>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        {hired ? (
          <Badge variant="outline" className="text-[11px] font-normal text-emerald-600">
            {t('market.talent.hired')}
          </Badge>
        ) : (
          <Button
            variant="secondary"
            size="sm"
            className="rounded-full"
            disabled={hiring}
            data-ui="market.talent.hire"
            onClick={(event) => {
              event.stopPropagation()
              onHire(preset)
            }}>
            {hiring ? <Loader2 className="size-3.5 animate-spin" /> : <Briefcase className="size-3.5" />}
            {t('market.talent.hire')}
          </Button>
        )}
      </div>
    </div>
  )
}

/** Component counts derived from an install record's refs, for the manage rows. */
function installedComponentCounts(record: MarketInstalledRecord): Array<{ count: number; key: string }> {
  return [
    { count: record.refs.skillFolderNames.length, key: 'market.component.skill' },
    { count: record.refs.mcpIds.length, key: 'market.component.mcp_server' },
    { count: record.refs.assistantIds.length, key: 'market.component.assistant' },
    { count: record.refs.minappAppIds.length, key: 'market.component.minapp' }
  ].filter((entry) => entry.count > 0)
}

/** installedAt is a plain ISO string; corrupt values render as '-' instead of Invalid Date. */
function formatInstalledAt(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '-' : date.toLocaleDateString()
}

interface ManageViewProps {
  records: MarketInstalledRecord[]
  catalogById: Map<string, MarketCatalogPlugin>
  onBack: () => void
  onBrowse: () => void
  onOpen: () => void
  onRequestUninstall: (target: { id: string; name: string }) => void
}

/** Page-level installed-plugins manager (ZCode 管理已安装): rows with version, install date, component badges, uninstall. */
const ManageView: FC<ManageViewProps> = ({ records, catalogById, onBack, onBrowse, onOpen, onRequestUninstall }) => {
  const { t } = useTranslation()

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-ui="market.manage">
      <Scrollbar className="min-h-0 flex-1">
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 p-6">
          <div data-ui="market.manage.back-row">
            <Button
              variant="ghost"
              size="sm"
              className="-ml-2 gap-1.5 text-muted-foreground"
              onClick={onBack}
              data-ui="market.manage.back">
              <ArrowLeft size={16} />
              {t('market.manage.back')}
            </Button>
          </div>

          {records.length === 0 ? (
            <div className="flex flex-1 items-center justify-center py-20">
              <EmptyState
                icon={PackageOpen}
                title={t('market.manage.empty.title')}
                description={t('market.manage.empty.description')}
                actionLabel={t('market.manage.browse')}
                onAction={onBrowse}
                compact
              />
            </div>
          ) : (
            <>
              <header className="flex items-center gap-2" data-ui="market.manage.header">
                <h1 className="text-2xl font-semibold tracking-tight">{t('market.manage.title')}</h1>
                <Badge variant="secondary" className="text-[11px] font-normal">
                  {records.length}
                </Badge>
              </header>

              <div className="flex flex-col gap-1" data-ui="market.manage.list">
                {records.map((record) => {
                  const inCatalog = catalogById.has(record.pluginId)
                  // 展示名优先取网关目录的最新字段——本地记录可能是旧版 plugin.json 的快照。
                  const displayName = catalogById.get(record.pluginId)?.name ?? record.name ?? record.pluginId
                  return (
                    <div
                      key={record.pluginId}
                      role={inCatalog ? 'button' : undefined}
                      tabIndex={inCatalog ? 0 : undefined}
                      data-ui="market.manage.row"
                      className={cn(
                        'flex min-w-0 items-center gap-3 rounded-xl px-2 py-3 transition-colors',
                        inCatalog && 'cursor-pointer hover:bg-accent focus-visible:bg-accent focus-visible:outline-none'
                      )}
                      onClick={() => inCatalog && onOpen()}
                      onKeyDown={(event) => {
                        if (!inCatalog) return
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault()
                          onOpen()
                        }
                      }}>
                      <PluginIcon iconUrl={catalogById.get(record.pluginId)?.iconUrl} size={40} className="shrink-0" />
                      <div className="min-w-0 flex-1">
                        <div className="flex min-w-0 items-center gap-1.5">
                          <span className="min-w-0 truncate text-sm font-semibold">{displayName}</span>
                          <Badge variant="secondary" className="shrink-0 text-[11px] font-normal">
                            v{catalogById.get(record.pluginId)?.version ?? record.version ?? '-'}
                          </Badge>
                        </div>
                        <div className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                          <span className="shrink-0 whitespace-nowrap">
                            {t('market.manage.installedAt')}: {formatInstalledAt(record.installedAt)}
                          </span>
                          {installedComponentCounts(record).map((entry) => (
                            <Badge key={entry.key} variant="outline" className="shrink-0 text-[11px] font-normal">
                              {entry.count} {t(entry.key)}
                            </Badge>
                          ))}
                        </div>
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="shrink-0 gap-1 text-destructive hover:text-destructive"
                        data-ui="market.manage.uninstall"
                        onClick={(event) => {
                          event.stopPropagation()
                          onRequestUninstall({ id: record.pluginId, name: displayName })
                        }}>
                        <Trash2 className="size-3.5" />
                        {t('market.uninstall')}
                      </Button>
                    </div>
                  )
                })}
              </div>
            </>
          )}
        </div>
      </Scrollbar>
    </div>
  )
}

const MarketPage: FC = () => {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [catalog, setCatalog] = useState<MarketCatalogResult | null>(null)
  const [loading, setLoading] = useState(true)
  const [installed, setInstalled] = useState<MarketInstalledRecord[]>([])
  const [view, setView] = useState<MarketView>({ page: 'grid' })
  const [query, setQuery] = useState('')
  const [activeTab, setActiveTab] = useState<MarketTab>('plugins')
  const [talentVisible, setTalentVisible] = useState(TALENT_PAGE_SIZE)
  // SkillsBlock 的公司源/外部榜单随此计数变化重新拉取（页面刷新按钮触发）。
  const [skillsRefreshKey, setSkillsRefreshKey] = useState(0)
  const { data: localSkills } = useSkillCatalog()
  const [hiringPresetId, setHiringPresetId] = useState<string | null>(null)
  const [uninstallTarget, setUninstallTarget] = useState<{ id: string; name: string } | null>(null)
  const [uninstalling, setUninstalling] = useState(false)

  const catalogById = useMemo(() => new Map((catalog?.plugins ?? []).map((plugin) => [plugin.id, plugin])), [catalog])
  // 人才市场：与「添加助手」选择器同源的预设目录；已存在同名助手即视为已雇佣。
  const { isLoading: talentLoading, presets: talentPresets } = useAssistantCatalogPresets({
    enabled: activeTab === 'talent'
  })
  const { data: assistantsData } = useQuery('/assistants', {
    query: { limit: 500 },
    enabled: activeTab === 'talent'
  })
  const { createAssistant } = useAssistantMutations()
  const hiredNames = useMemo(
    () => new Set((assistantsData?.items ?? []).map((assistant) => assistant.name)),
    [assistantsData]
  )
  const talentFiltered = useMemo(() => {
    const list = talentPresets ?? []
    if (!query.trim()) return list
    const k = query.trim().toLowerCase()
    return list.filter(
      (preset) => preset.name.toLowerCase().includes(k) || (preset.description ?? '').toLowerCase().includes(k)
    )
  }, [talentPresets, query])

  const refreshInstalled = useCallback(async () => {
    try {
      setInstalled(await window.api.market.getInstalled())
    } catch {
      // The strip is additive — a failed read leaves it empty rather than blocking the page.
      setInstalled([])
    }
  }, [])

  const loadCatalog = useCallback(async () => {
    setLoading(true)
    try {
      setCatalog(await window.api.market.getCatalog())
    } catch {
      setCatalog({ source: 'error', plugins: [], warnings: [], error: 'unreachable' })
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadCatalog()
    void refreshInstalled()
  }, [loadCatalog, refreshInstalled])

  const handleRefresh = useCallback(() => {
    void loadCatalog()
    void refreshInstalled()
    setSkillsRefreshKey((key) => key + 1)
  }, [loadCatalog, refreshInstalled])

  // 已安装的包统一去自带的技能管理面。
  const openInstalledPack = useCallback(() => void navigate({ to: '/settings/skills' }), [navigate])

  const backToGrid = useCallback(() => setView({ page: 'grid' }), [])

  const confirmUninstall = useCallback(async () => {
    if (!uninstallTarget) return
    setUninstalling(true)
    try {
      const result = await window.api.market.uninstall(uninstallTarget.id)
      if (result.ok) {
        toast.success(t('market.uninstallSuccess', { name: uninstallTarget.name }))
        setUninstallTarget(null)
        await refreshInstalled()
      } else {
        // Keep the dialog open with the error visible — the record stays installed.
        const failed = result.results.find((entry) => entry.status === 'failed')
        toast.error(failed?.error ? `${t('market.uninstallFailed')}: ${failed.error}` : t('market.uninstallFailed'))
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('market.uninstallFailed'))
    } finally {
      setUninstalling(false)
    }
  }, [refreshInstalled, t, uninstallTarget])

  const handleHire = useCallback(
    async (preset: AssistantCatalogPreset) => {
      setHiringPresetId(preset.id)
      try {
        await createAssistant(toCreateAssistantDtoFromCatalogPreset(preset))
        toast.success(t('market.talent.hireSuccess', { name: preset.name }))
      } catch (error) {
        toast.error(error instanceof Error ? error.message : t('market.talent.hireFailed'))
      } finally {
        setHiringPresetId(null)
      }
    },
    [createAssistant, t]
  )

  const openTalentPreset = useCallback((preset: AssistantCatalogPreset) => {
    toast.info(preset.description || preset.name)
  }, [])

  // 已安装分类 = 市场安装的技能（公司源 + 外部源）+ 已安装的包（齿轮进入管理）。
  // 内置/系统/本地技能不进市场，留在设置页。
  const marketSkillCount = useMemo(() => localSkills.filter(isMarketInstalledSkill).length, [localSkills])
  const showInstalledSection = installed.length > 0 || marketSkillCount > 0

  return (
    <div data-ui="market.view" className="relative flex h-full min-h-0 flex-1 flex-col text-foreground">
      <Navbar>
        <NavbarCenter className="border-r-0">{t('market.title')}</NavbarCenter>
      </Navbar>

      {view.page === 'grid' ? (
        <Scrollbar className="min-h-0 flex-1">
          <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 p-6">
            <div className="flex flex-col gap-2">
              <h1 className="text-2xl font-semibold tracking-tight" data-ui="market.page-title">
                {t('market.pageTitle')}
              </h1>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <p className="min-w-0 flex-1 text-sm leading-6 text-muted-foreground" data-ui="market.subtitle">
                  {t('market.subtitle')}
                </p>
                <Tooltip title={t('market.refresh')}>
                  <Button
                    variant="outline"
                    size="icon"
                    aria-label={t('market.refresh')}
                    data-ui="market.refresh"
                    disabled={loading}
                    onClick={handleRefresh}>
                    <RefreshCw className={cn('size-4', loading && 'animate-spin')} />
                  </Button>
                </Tooltip>
              </div>
            </div>

            <MarketSearchInput value={query} onChange={setQuery} placeholder={t('market.searchPlaceholder')} />

            <SegmentedControl
              value={activeTab}
              onValueChange={setActiveTab}
              options={[
                { value: 'plugins', label: t('market.tab.plugins') },
                { value: 'talent', label: t('market.tab.talent') }
              ]}
              data-ui="market.tab"
            />

            {activeTab === 'plugins' && showInstalledSection && (
              <section className="flex flex-col" data-ui="market.installed">
                <div className="flex items-center justify-between border-b pb-2">
                  <h2 className="text-base font-semibold text-foreground">{t('market.installed.title')}</h2>
                  {installed.length > 0 && (
                    <Tooltip title={t('market.manageInstalled')}>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={t('market.manageInstalled')}
                        data-ui="market.installed-manage"
                        onClick={() => setView({ page: 'manage' })}>
                        <Settings2 className="size-4" />
                      </Button>
                    </Tooltip>
                  )}
                </div>
                <div
                  className="mt-1 flex items-center gap-3 overflow-x-auto px-2 pt-2 pb-1 sm:-mx-2"
                  data-ui="market.installed-strip">
                  <InstalledSkillsList />
                </div>
              </section>
            )}

            {activeTab === 'plugins' && <SkillsBlock query={query} refreshKey={skillsRefreshKey} />}
            {activeTab === 'talent' && (
              <div className="flex flex-col gap-2" data-ui="market.talent.list">
                {talentLoading ? (
                  <div className="flex items-center justify-center py-20" data-ui="market.talent.loading">
                    <Spinner text={t('common.loading')} className="text-muted-foreground" />
                  </div>
                ) : talentFiltered.length === 0 ? (
                  <div className="flex items-center justify-center py-16" data-ui="market.talent.empty">
                    <EmptyState
                      icon={Briefcase}
                      title={t('market.talent.empty.title')}
                      description={t('market.talent.empty.description')}
                      compact
                    />
                  </div>
                ) : (
                  <>
                    <div className="grid gap-x-6 gap-y-1 sm:grid-cols-2">
                      {talentFiltered.slice(0, talentVisible).map((preset) => (
                        <TalentCard
                          key={preset.id}
                          preset={preset}
                          hired={hiredNames.has(preset.name)}
                          hiring={hiringPresetId === preset.id}
                          onHire={(target) => void handleHire(target)}
                          onOpen={openTalentPreset}
                        />
                      ))}
                    </div>
                    {talentFiltered.length > talentVisible && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="mt-2 self-center"
                        onClick={() => setTalentVisible((count) => count + TALENT_PAGE_SIZE)}
                        data-ui="market.talent.more">
                        {t('market.talent.loadMore', { count: talentFiltered.length - talentVisible })}
                      </Button>
                    )}
                  </>
                )}
              </div>
            )}
          </div>
        </Scrollbar>
      ) : (
        <ManageView
          records={installed}
          catalogById={catalogById}
          onBack={backToGrid}
          onBrowse={backToGrid}
          onOpen={openInstalledPack}
          onRequestUninstall={setUninstallTarget}
        />
      )}

      <Dialog
        open={uninstallTarget !== null}
        onOpenChange={(open) => !open && !uninstalling && setUninstallTarget(null)}>
        <DialogContent size="sm" showCloseButton={false} data-ui="market.uninstall-dialog">
          <DialogHeader>
            <DialogTitle>{t('market.uninstallConfirmTitle')}</DialogTitle>
            <DialogDescription>
              {t('market.uninstallConfirmDescription', { name: uninstallTarget?.name ?? '' })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" disabled={uninstalling} onClick={() => setUninstallTarget(null)}>
              {t('common.cancel')}
            </Button>
            <Button variant="destructive" disabled={uninstalling} onClick={() => void confirmUninstall()}>
              {uninstalling ? <Loader2 className="mr-1 size-3.5 animate-spin" /> : null}
              {t('market.uninstallConfirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

export default MarketPage
