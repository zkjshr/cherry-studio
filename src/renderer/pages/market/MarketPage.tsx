import { CircleAlert, Loader2, PackageOpen, Sparkles, Star, Store } from 'lucide-react'
import type { FC } from 'react'
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Badge, Button, Dialog, DialogContent, DialogHeader, DialogTitle, EmptyState, Spinner } from '@cherrystudio/ui'
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
        <div key={group.key} className="flex flex-col gap-1.5">
          <h4 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{t(group.key)}</h4>
          <ul className="flex flex-col gap-1">
            {group.items.map((item) => (
              <li key={item.name} className="flex items-baseline gap-2 text-sm">
                <span className="font-medium">{item.name}</span>
                {item.detail && <span className="truncate text-xs text-muted-foreground">{item.detail}</span>}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  )
}

const MarketPage: FC = () => {
  const { t } = useTranslation()
  const [catalog, setCatalog] = useState<MarketCatalogResult | null>(null)
  const [loading, setLoading] = useState(true)
  const [installed, setInstalled] = useState<MarketInstalledRecord[]>([])
  const [detail, setDetail] = useState<{ open: boolean; loading: boolean; manifest: MarketPluginManifest | null }>({
    open: false,
    loading: false,
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

  const openDetail = useCallback(async (plugin: MarketCatalogPlugin) => {
    setDetail({ open: true, loading: true, manifest: null })
    setJustInstalled(null)
    try {
      const manifest = await window.api.market.getPluginDetail(plugin.id)
      setDetail({ open: true, loading: false, manifest })
    } catch {
      setDetail({ open: true, loading: false, manifest: null })
    }
  }, [])

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
                  onOpen={(entry) => void openDetail(entry)}
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
                  onOpen={(entry) => void openDetail(entry)}
                />
              ))}
            </div>
          </CategorySection>
        ))}
      </>
    )
  }

  const detailPluginId = detail.manifest?.id
  const detailInstalled = detailPluginId ? installedIds.has(detailPluginId) : false
  const detailInstallSucceeded = detailPluginId !== null && detailPluginId === justInstalled

  return (
    <div data-ui="market.view" className="relative flex h-full min-h-0 flex-1 flex-col text-foreground">
      <Navbar>
        <NavbarCenter className="border-r-0">{t('market.title')}</NavbarCenter>
      </Navbar>

      <Scrollbar className="min-h-0 flex-1">
        <div className="mx-auto flex w-full max-w-5xl flex-col gap-8 p-6">
          {installed.length > 0 && (
            <section className="flex flex-col gap-3" data-ui="market.installed">
              <h3 className="text-sm font-medium text-foreground">{t('market.installed.title')}</h3>
              <div className="flex flex-wrap gap-2">
                {installed.map((record) => (
                  <InstalledChip key={record.pluginId} record={record} onUninstalled={() => void refreshInstalled()} />
                ))}
              </div>
            </section>
          )}
          {renderCatalogBody()}
        </div>
      </Scrollbar>

      <Dialog open={detail.open} onOpenChange={(open) => setDetail((state) => ({ ...state, open }))}>
        <DialogContent size="lg" className="flex flex-col gap-4" data-ui="market.detail">
          <DialogHeader>
            <DialogTitle>{t('market.detail.title')}</DialogTitle>
          </DialogHeader>
          {detail.loading ? (
            <div className="flex items-center justify-center py-12">
              <Spinner text={t('common.loading')} className="text-muted-foreground" />
            </div>
          ) : !detail.manifest ? (
            <div className="flex items-center justify-center py-12 text-sm text-muted-foreground">
              {t('market.detail.loadFailed')}
            </div>
          ) : (
            <div className="flex min-h-0 flex-col gap-4 overflow-y-auto">
              <div className="flex items-start gap-3">
                <PluginIcon iconUrl={detail.manifest.iconUrl} size={44} />
                <div className="flex min-w-0 flex-col gap-0.5">
                  <div className="flex items-center gap-2">
                    <span className="text-base font-medium">{detail.manifest.name}</span>
                    <span className="text-xs text-muted-foreground">v{detail.manifest.version || '-'}</span>
                    {detailInstalled && (
                      <Badge variant="outline" className="text-[11px] font-normal text-emerald-600">
                        {t('market.installedBadge')}
                      </Badge>
                    )}
                  </div>
                  {detail.manifest.description && (
                    <p className="text-xs leading-relaxed text-muted-foreground">{detail.manifest.description}</p>
                  )}
                </div>
              </div>

              <div className="flex flex-col gap-2">
                <h4 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                  {t('market.detail.components')}
                </h4>
                <DetailComponentsList manifest={detail.manifest} />
              </div>

              <div className="flex items-center gap-2">
                <Button
                  disabled={detailInstalled || installing}
                  onClick={() => detail.manifest && void handleInstall(detail.manifest.id)}>
                  {installing ? (
                    <>
                      <Loader2 className="mr-1 size-3.5 animate-spin" />
                      {t('market.installing')}
                    </>
                  ) : detailInstalled ? (
                    detailInstallSucceeded ? (
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
        </DialogContent>
      </Dialog>
    </div>
  )
}

export default MarketPage
