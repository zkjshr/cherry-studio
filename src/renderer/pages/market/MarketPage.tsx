import { ArrowLeft, CircleAlert, ExternalLink, Loader2, PackageOpen, Sparkles, Star, Store, User } from 'lucide-react'
import type { FC } from 'react'
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Badge, Button, EmptyState, Spinner } from '@cherrystudio/ui'
import { Navbar, NavbarCenter } from '@renderer/components/Navbar'
import Scrollbar from '@renderer/components/Scrollbar'
import { toast } from '@renderer/services/toast'
import { cn } from '@renderer/utils/style'
import type {
  MarketCatalogPlugin,
  MarketCatalogResult,
  MarketInstalledRecord,
  MarketManifestSkill,
  MarketPluginManifest
} from '@shared/types/marketplace'

/** The manifest categories the UI has localized names for; anything else falls into `other`. */
const KNOWN_CATEGORY_KEYS = ['knowledge', 'productivity', 'utilities'] as const

/** Seconds before an armed uninstall confirm disarms itself. */
const UNINSTALL_CONFIRM_RESET_SECONDS = 3

/** Page-level navigation: the market grid or a drill-in plugin detail. */
type MarketView = { page: 'grid' } | { page: 'detail'; id: string }

const ComponentCountBadges: FC<{ plugin: Pick<MarketCatalogPlugin, 'components'> }> = ({ plugin }) => {
  const { t } = useTranslation()
  const entries = [
    { count: plugin.components.skills, key: 'market.component.skill' },
    { count: plugin.components.mcp_servers, key: 'market.component.mcp_server' },
    { count: plugin.components.assistants, key: 'market.component.assistant' },
    { count: plugin.components.minapps, key: 'market.component.minapp' }
  ].filter((entry) => entry.count > 0)
  if (entries.length === 0) return null
  return (
    <div className="flex flex-wrap items-center gap-1" data-ui="market.card.counts">
      {entries.map((entry) => (
        <Badge key={entry.key} variant="secondary" className="text-[11px] font-normal">
          {entry.count} {t(entry.key)}
        </Badge>
      ))}
    </div>
  )
}

const PluginIcon: FC<{ iconUrl?: string; size?: number; className?: string }> = ({ iconUrl, size = 36, className }) =>
  iconUrl ? (
    <img
      src={iconUrl}
      alt=""
      width={size}
      height={size}
      loading="lazy"
      draggable={false}
      className={cn('rounded-lg object-contain', className)}
    />
  ) : (
    <span
      style={{ width: size, height: size }}
      className={cn('flex items-center justify-center rounded-lg bg-muted text-muted-foreground', className)}>
      <Store size={size * 0.5} strokeWidth={1.5} />
    </span>
  )

/** One installed plugin chip in the top strip. Uninstall uses an inline two-stage confirm. */
const InstalledChip: FC<{ record: MarketInstalledRecord; onUninstalled: () => void }> = ({ record, onUninstalled }) => {
  const { t } = useTranslation()
  const [expanded, setExpanded] = useState(false)
  const [armed, setArmed] = useState(false)
  const [busy, setBusy] = useState(false)
  const disarmTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(
    () => () => {
      if (disarmTimer.current) clearTimeout(disarmTimer.current)
    },
    []
  )

  const disarm = useCallback(() => {
    if (disarmTimer.current) clearTimeout(disarmTimer.current)
    disarmTimer.current = null
    setArmed(false)
  }, [])

  const handleUninstallClick = useCallback(async () => {
    // Two-stage: first click arms, second click (or re-arm after timeout) executes.
    if (!armed) {
      setArmed(true)
      disarmTimer.current = setTimeout(disarm, UNINSTALL_CONFIRM_RESET_SECONDS * 1000)
      return
    }
    disarm()
    setBusy(true)
    try {
      const result = await window.api.market.uninstall(record.pluginId)
      if (result.ok) {
        toast.success(t('market.uninstallSuccess', { name: record.name }))
        onUninstalled()
      } else {
        const failed = result.results.find((entry) => entry.status === 'failed')
        toast.error(failed?.error ? `${t('market.uninstallFailed')}: ${failed.error}` : t('market.uninstallFailed'))
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('market.uninstallFailed'))
    } finally {
      setBusy(false)
    }
  }, [armed, disarm, onUninstalled, record.name, record.pluginId, t])

  return (
    <div
      data-ui="market.installed-chip"
      className={cn(
        'flex min-w-0 items-center gap-2 rounded-xl border bg-card px-3 py-2 transition-colors',
        expanded ? 'border-primary/40' : 'cursor-pointer hover:border-primary/40'
      )}
      onClick={() => !expanded && setExpanded(true)}>
      <PluginIcon size={24} />
      <div className="flex min-w-0 flex-col">
        <span className="truncate text-[13px] font-medium">{record.name || record.pluginId}</span>
        <span className="text-[11px] text-muted-foreground">v{record.version || '-'}</span>
      </div>
      {expanded && (
        <div className="flex items-center gap-1" onClick={(event) => event.stopPropagation()}>
          <Button variant={armed ? 'destructive' : 'ghost'} size="sm" disabled={busy} onClick={handleUninstallClick}>
            {busy ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              t(armed ? 'market.uninstallConfirm' : 'market.uninstall')
            )}
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setExpanded(false)}>
            {t('common.cancel')}
          </Button>
        </div>
      )}
    </div>
  )
}

const PluginCard: FC<{
  plugin: MarketCatalogPlugin
  installed: boolean
  onOpen: (plugin: MarketCatalogPlugin) => void
}> = ({ plugin, installed, onOpen }) => {
  const { t } = useTranslation()
  return (
    <button
      type="button"
      data-ui="market.card"
      onClick={() => onOpen(plugin)}
      className="flex w-full cursor-pointer flex-col gap-2 rounded-xl border bg-card p-4 text-left transition-colors hover:border-primary/40">
      <div className="flex items-start gap-3">
        <PluginIcon iconUrl={plugin.iconUrl} size={40} />
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <div className="flex items-center gap-1.5">
            <span className="truncate text-sm font-medium">{plugin.name}</span>
            {installed && (
              <Badge variant="outline" className="shrink-0 text-[11px] font-normal text-emerald-600">
                {t('market.installedBadge')}
              </Badge>
            )}
          </div>
          <span className="text-[11px] text-muted-foreground">v{plugin.version || '-'}</span>
        </div>
      </div>
      {plugin.description && (
        <p className="line-clamp-2 min-h-[2.4em] text-xs leading-relaxed text-muted-foreground">{plugin.description}</p>
      )}
      <ComponentCountBadges plugin={plugin} />
    </button>
  )
}

const CategorySection: FC<{
  titleKey: string
  icon?: React.ReactNode
  children: React.ReactNode
}> = ({ titleKey, icon, children }) => {
  const { t } = useTranslation()
  return (
    <section className="flex flex-col gap-3" data-ui="market.category">
      <h3 className="flex items-center gap-1.5 text-sm font-medium text-foreground">
        {icon}
        {t(titleKey)}
      </h3>
      {children}
    </section>
  )
}

/** Group non-featured plugins by category; unknown categories collapse into `other`. */
function groupByCategory(plugins: MarketCatalogPlugin[]): Array<{ key: string; plugins: MarketCatalogPlugin[] }> {
  const ordered: Array<{ key: string; plugins: MarketCatalogPlugin[] }> = KNOWN_CATEGORY_KEYS.map((key) => ({
    key: `market.categories.${key}`,
    plugins: []
  }))
  const other = { key: 'market.categories.other', plugins: [] }
  const index = new Map(ordered.map((group) => [group.key, group]))
  for (const plugin of plugins) {
    const groupKey = KNOWN_CATEGORY_KEYS.includes(plugin.category as (typeof KNOWN_CATEGORY_KEYS)[number])
      ? `market.categories.${plugin.category}`
      : other.key
    ;(index.get(groupKey) ?? other).plugins.push(plugin)
  }
  return [...ordered, other].filter((group) => group.plugins.length > 0)
}

/** Localized label for a known category; unknown values render as-is. */
function categoryLabel(category: string, t: (key: string) => string): string {
  const key = `market.categories.${category}`
  return KNOWN_CATEGORY_KEYS.includes(category as (typeof KNOWN_CATEGORY_KEYS)[number]) ? t(key) : category
}

/**
 * One component group rendered as a bordered card section: group title with a
 * count badge, then one row per component (name + detail line).
 */
const DetailComponentsList: FC<{ manifest: MarketPluginManifest }> = ({ manifest }) => {
  const { t } = useTranslation()
  const groups = [
    {
      key: 'market.component.skill',
      items: manifest.skills.map((skill: MarketManifestSkill) => ({
        name: skill.name,
        detail: skill.description ?? ''
      }))
    },
    {
      key: 'market.component.mcp_server',
      items: manifest.mcp_servers.map((server) => ({
        name: server.name,
        detail: [server.type, server.base_url].filter(Boolean).join(' · ')
      }))
    },
    {
      key: 'market.component.assistant',
      items: manifest.assistants.map((assistant) => ({
        name: assistant.name,
        detail: assistant.description ?? ''
      }))
    },
    {
      key: 'market.component.minapp',
      items: manifest.minapps.map((minapp) => ({ name: minapp.name, detail: minapp.url }))
    }
  ].filter((group) => group.items.length > 0)

  if (groups.length === 0) {
    return <p className="text-xs text-muted-foreground">{t('market.detail.noComponents')}</p>
  }

  return (
    <div className="flex flex-col gap-4" data-ui="market.detail.components">
      {groups.map((group) => (
        <div
          key={group.key}
          data-ui="market.detail.component-group"
          className="flex flex-col gap-3 rounded-xl border bg-card p-4">
          <div className="flex items-center gap-2">
            <h4 className="text-sm font-medium">{t(group.key)}</h4>
            <Badge variant="secondary" className="text-[11px] font-normal">
              {group.items.length}
            </Badge>
          </div>
          <ul className="flex flex-col gap-2.5">
            {group.items.map((item) => (
              <li key={item.name} className="flex min-w-0 flex-col gap-0.5">
                <span className="text-sm font-medium">{item.name}</span>
                {item.detail && (
                  <span className="text-xs leading-relaxed break-all text-muted-foreground">{item.detail}</span>
                )}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  )
}

const ExternalLinkChip: FC<{ href: string; label: string }> = ({ href, label }) => (
  <a
    href={href}
    target="_blank"
    rel="noopener noreferrer"
    className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground">
    <ExternalLink size={11} />
    {label}
  </a>
)

interface DetailViewProps {
  manifest: MarketPluginManifest | null
  loading: boolean
  failed: boolean
  installed: boolean
  installSucceeded: boolean
  installing: boolean
  onInstall: () => void
  onBack: () => void
  onRetry: () => void
}

/** Page-level plugin detail: header, full description, component cards, sticky action bar. */
const DetailView: FC<DetailViewProps> = ({
  manifest,
  loading,
  failed,
  installed,
  installSucceeded,
  installing,
  onInstall,
  onBack,
  onRetry
}) => {
  const { t } = useTranslation()
  const ready = !loading && !failed && manifest !== null

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-ui="market.detail">
      <Scrollbar className="min-h-0 flex-1">
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 p-6">
          <div data-ui="market.detail.back-row">
            <Button
              variant="ghost"
              size="sm"
              className="-ml-2 gap-1.5 text-muted-foreground"
              onClick={onBack}
              data-ui="market.detail.back">
              <ArrowLeft size={16} />
              {t('market.detail.back')}
            </Button>
          </div>

          {loading ? (
            <div className="flex flex-1 items-center justify-center py-24" data-ui="market.detail.loading">
              <Spinner text={t('common.loading')} className="text-muted-foreground" />
            </div>
          ) : failed || !manifest ? (
            <div className="flex flex-1 items-center justify-center py-20" data-ui="market.detail.failed">
              <EmptyState
                icon={CircleAlert}
                title={t('market.detail.loadFailed')}
                actionLabel={t('market.retry')}
                onAction={onRetry}
                compact
              />
            </div>
          ) : (
            <>
              <header className="flex items-start gap-4" data-ui="market.detail.header">
                <PluginIcon iconUrl={manifest.iconUrl} size={56} className="shrink-0" />
                <div className="flex min-w-0 flex-1 flex-col gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-xl font-semibold">{manifest.name}</h2>
                    <Badge variant="secondary" className="text-[11px] font-normal">
                      v{manifest.version || '-'}
                    </Badge>
                    {installed && (
                      <Badge variant="outline" className="text-[11px] font-normal text-emerald-600">
                        {t('market.installedBadge')}
                      </Badge>
                    )}
                  </div>
                  {(manifest.category || manifest.author) && (
                    <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      {manifest.category && (
                        <Badge variant="outline" className="text-[11px] font-normal">
                          {categoryLabel(manifest.category, t)}
                        </Badge>
                      )}
                      {manifest.author && (
                        <span className="inline-flex items-center gap-1" data-ui="market.detail.author">
                          <User size={12} />
                          {t('market.detail.author')}: {manifest.author}
                        </span>
                      )}
                      {manifest.homepage && (
                        <ExternalLinkChip href={manifest.homepage} label={t('market.detail.homepage')} />
                      )}
                      {manifest.repository && (
                        <ExternalLinkChip href={manifest.repository} label={t('market.detail.viewRepo')} />
                      )}
                    </div>
                  )}
                  {manifest.keywords && manifest.keywords.length > 0 && (
                    <div className="flex flex-wrap items-center gap-1" data-ui="market.detail.keywords">
                      {manifest.keywords.map((keyword) => (
                        <Badge
                          key={keyword}
                          variant="secondary"
                          className="text-[11px] font-normal text-muted-foreground">
                          {keyword}
                        </Badge>
                      ))}
                    </div>
                  )}
                </div>
              </header>

              {manifest.description && (
                <section className="text-sm leading-relaxed whitespace-pre-wrap" data-ui="market.detail.description">
                  {manifest.description}
                </section>
              )}

              <section className="flex flex-col gap-3">
                <h3 className="text-sm font-medium">{t('market.detail.components')}</h3>
                <DetailComponentsList manifest={manifest} />
              </section>
            </>
          )}
        </div>
      </Scrollbar>

      {ready && manifest && (
        <div className="border-t bg-background" data-ui="market.detail.actions">
          <div className="mx-auto flex w-full max-w-3xl items-center gap-3 p-4">
            <Button className="min-w-28" disabled={installed || installing} onClick={onInstall}>
              {installing ? (
                <>
                  <Loader2 className="mr-1 size-3.5 animate-spin" />
                  {t('market.installing')}
                </>
              ) : installed ? (
                installSucceeded ? (
                  <>
                    <Sparkles className="mr-1 size-3.5" />
                    {t('market.installSuccess')}
                  </>
                ) : (
                  t('market.installedBadge')
                )
              ) : (
                t('market.install')
              )}
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}

const MarketPage: FC = () => {
  const { t } = useTranslation()
  const [catalog, setCatalog] = useState<MarketCatalogResult | null>(null)
  const [loading, setLoading] = useState(true)
  const [installed, setInstalled] = useState<MarketInstalledRecord[]>([])
  const [view, setView] = useState<MarketView>({ page: 'grid' })
  const [detail, setDetail] = useState<{ loading: boolean; failed: boolean; manifest: MarketPluginManifest | null }>({
    loading: false,
    failed: false,
    manifest: null
  })
  const [installing, setInstalling] = useState(false)
  const [justInstalled, setJustInstalled] = useState<string | null>(null)

  const installedIds = useMemo(() => new Set(installed.map((record) => record.pluginId)), [installed])
  const featured = useMemo(() => catalog?.plugins.filter((plugin) => plugin.featured) ?? [], [catalog])
  const rest = useMemo(() => catalog?.plugins.filter((plugin) => !plugin.featured) ?? [], [catalog])
  const categories = useMemo(() => groupByCategory(rest), [rest])

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

  const loadManifest = useCallback(async (pluginId: string) => {
    setDetail({ loading: true, failed: false, manifest: null })
    try {
      const manifest = await window.api.market.getPluginDetail(pluginId)
      setDetail({ loading: false, failed: false, manifest })
    } catch {
      setDetail({ loading: false, failed: true, manifest: null })
    }
  }, [])

  const openDetail = useCallback(
    (plugin: MarketCatalogPlugin) => {
      setJustInstalled(null)
      setView({ page: 'detail', id: plugin.id })
      void loadManifest(plugin.id)
    },
    [loadManifest]
  )

  const backToGrid = useCallback(() => setView({ page: 'grid' }), [])

  const handleInstall = useCallback(
    async (pluginId: string) => {
      setInstalling(true)
      try {
        const result = await window.api.market.install(pluginId)
        // Partial success is still a persisted install — tell the user WHICH
        // components failed instead of celebrating a clean install.
        const failed = result.results.filter((entry) => entry.status === 'failed')
        if (failed.length > 0) {
          toast.warning(t('market.installPartial', { names: failed.map((entry) => entry.target).join(', ') }))
        } else {
          toast.success(t('market.installSuccess'))
        }
        setJustInstalled(pluginId)
        await refreshInstalled()
      } catch (error) {
        toast.error(error instanceof Error ? error.message : t('market.installFailed'))
      } finally {
        setInstalling(false)
      }
    },
    [refreshInstalled, t]
  )

  const renderCatalogBody = () => {
    if (loading) {
      return (
        <div className="flex flex-1 items-center justify-center py-20" data-ui="market.loading">
          <Spinner text={t('common.loading')} className="text-muted-foreground" />
        </div>
      )
    }
    if (catalog?.source === 'none') {
      return (
        <div className="flex flex-1 items-center justify-center py-16" data-ui="market.non-enterprise">
          <EmptyState
            icon={Store}
            title={t('market.nonEnterprise.title')}
            description={t('market.nonEnterprise.description')}
            compact
          />
        </div>
      )
    }
    if (catalog?.source === 'error') {
      return (
        <div className="flex flex-1 items-center justify-center py-16" data-ui="market.error">
          <EmptyState
            icon={CircleAlert}
            title={t('market.error.title')}
            description={t('market.error.description')}
            actionLabel={t('market.retry')}
            onAction={() => void loadCatalog()}
            compact
          />
        </div>
      )
    }
    if (!catalog || catalog.plugins.length === 0) {
      return (
        <div className="flex flex-1 items-center justify-center py-16" data-ui="market.empty">
          <EmptyState
            icon={PackageOpen}
            title={t('market.empty.title')}
            description={t('market.empty.description')}
            actionLabel={t('market.retry')}
            onAction={() => void loadCatalog()}
            compact
          />
        </div>
      )
    }
    return (
      <>
        {featured.length > 0 && (
          <CategorySection titleKey="market.featured" icon={<Star size={14} className="text-amber-500" />}>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3" data-ui="market.featured-grid">
              {featured.map((plugin) => (
                <PluginCard
                  key={plugin.id}
                  plugin={plugin}
                  installed={installedIds.has(plugin.id)}
                  onOpen={openDetail}
                />
              ))}
            </div>
          </CategorySection>
        )}
        {categories.map((group) => (
          <CategorySection key={group.key} titleKey={group.key}>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3" data-ui="market.category-grid">
              {group.plugins.map((plugin) => (
                <PluginCard
                  key={plugin.id}
                  plugin={plugin}
                  installed={installedIds.has(plugin.id)}
                  onOpen={openDetail}
                />
              ))}
            </div>
          </CategorySection>
        ))}
      </>
    )
  }

  const detailPluginId = view.page === 'detail' ? view.id : null
  const detailInstalled = detail.manifest ? installedIds.has(detail.manifest.id) : false
  const detailInstallSucceeded = detail.manifest !== null && detail.manifest.id === justInstalled

  return (
    <div data-ui="market.view" className="relative flex h-full min-h-0 flex-1 flex-col text-foreground">
      <Navbar>
        <NavbarCenter className="border-r-0">{t('market.title')}</NavbarCenter>
      </Navbar>

      {view.page === 'grid' ? (
        <Scrollbar className="min-h-0 flex-1">
          <div className="mx-auto flex w-full max-w-5xl flex-col gap-8 p-6">
            {installed.length > 0 && (
              <section className="flex flex-col gap-3" data-ui="market.installed">
                <h3 className="text-sm font-medium text-foreground">{t('market.installed.title')}</h3>
                <div className="flex flex-wrap gap-2">
                  {installed.map((record) => (
                    <InstalledChip
                      key={record.pluginId}
                      record={record}
                      onUninstalled={() => void refreshInstalled()}
                    />
                  ))}
                </div>
              </section>
            )}
            {renderCatalogBody()}
          </div>
        </Scrollbar>
      ) : (
        <DetailView
          manifest={detail.manifest}
          loading={detail.loading}
          failed={detail.failed}
          installed={detailInstalled}
          installSucceeded={detailInstallSucceeded}
          installing={installing}
          onInstall={() => detail.manifest && void handleInstall(detail.manifest.id)}
          onBack={backToGrid}
          onRetry={() => detailPluginId && void loadManifest(detailPluginId)}
        />
      )}
    </div>
  )
}

export default MarketPage
