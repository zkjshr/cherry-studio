import {
  ArrowLeft,
  Briefcase,
  Building2,
  CircleAlert,
  ExternalLink,
  Loader2,
  MoreHorizontal,
  PackageOpen,
  RefreshCw,
  Search,
  Settings2,
  Sparkles,
  Star,
  Store,
  Trash2,
  User,
  X
} from 'lucide-react'
import type { FC } from 'react'
import React, { useCallback, useEffect, useMemo, useState } from 'react'
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  EmptyState,
  Input,
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

/** Collapsed category groups show this many cards; the rest waits behind the 展开 row. */
const CATEGORY_VISIBLE_LIMIT = 6

/** 拓展页的两个分区：插件市场（企业网关目录）与人才市场（预设智能体）。 */
type MarketTab = 'plugins' | 'talent'

/** 人才市场一次渲染的行数；「加载更多」逐批放出（全部预设约 780 个）。 */
const TALENT_PAGE_SIZE = 40

/** Page-level navigation: the market grid, a drill-in plugin detail, or the installed-plugins manager. */
type MarketView = { page: 'grid' } | { page: 'detail'; id: string } | { page: 'manage' }

/**
 * ZCode 风格插件头像：外层是主题色的圆角容器（半透明装饰圈），图形按 2/3
 * 尺寸居中——无论有无图标都保持同一个容器形态，避免图片加载失败时跳变。
 * 加载失败回退 Blocks 风格的 Store 线条图标。
 */
const PluginIcon: FC<{ iconUrl?: string; size?: number; className?: string }> = ({ iconUrl, size = 36, className }) => {
  const [failed, setFailed] = useState(false)
  const showImage = Boolean(iconUrl) && !failed
  const graphicSize = Math.round((size * 2) / 3)
  return (
    <span
      data-ui="market.plugin-icon"
      aria-hidden="true"
      style={{ width: size, height: size }}
      className={cn(
        'flex shrink-0 select-none items-center justify-center rounded-xl bg-muted',
        !showImage && 'text-muted-foreground',
        className
      )}>
      {showImage ? (
        <img
          src={iconUrl}
          alt=""
          width={graphicSize}
          height={graphicSize}
          loading="lazy"
          draggable={false}
          className="object-contain"
          onError={() => setFailed(true)}
        />
      ) : (
        <Store size={Math.round(size * 0.42)} strokeWidth={1.5} />
      )}
    </span>
  )
}

/** ZCode 风格搜索框：左侧放大镜、右侧清空按钮。 */
const MarketSearchInput: FC<{
  value: string
  onChange: (value: string) => void
  placeholder: string
}> = ({ value, onChange, placeholder }) => (
  <div className="relative" data-ui="market.search">
    <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
    <Input
      type="search"
      value={value}
      onChange={(event) => onChange(event.target.value)}
      placeholder={placeholder}
      className="h-9 rounded-xl pr-9 pl-9 [&::-webkit-search-cancel-button]:appearance-none"
    />
    {value && (
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="clear"
        className="absolute top-1/2 right-1 -translate-y-1/2 rounded-full text-muted-foreground"
        onClick={() => onChange('')}>
        <X className="size-3.5" />
      </Button>
    )}
  </div>
)

/**
 * 卡片/详情的展示胶囊：部门、作者（两个独立胶囊）。逐项按 plugin.json 是否
 * 提供决定显隐（空串视为未提供），避免占位空胶囊。下载热度仅管理端可见，
 * 客户端不展示。
 */
const PluginMetadataTags: FC<{ department?: string; author?: string }> = ({ department, author }) => {
  if (!department && !author) return null
  const chipClass =
    'inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] text-muted-foreground'
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-1" data-ui="market.plugin-tags">
      {department && (
        <span className={chipClass} data-ui="market.plugin-tag.department">
          <Building2 size={10} />
          {department}
        </span>
      )}
      {author && (
        <span className={chipClass} data-ui="market.plugin-tag.author">
          <User size={10} />
          {author}
        </span>
      )}
    </div>
  )
}

/**
 * ZCode 风格分节标题：h2 + 一条分隔线，内容另起。
 * 与散落边框卡不同，分节靠这条线维持长列表的视觉节奏。
 */
const StoreSection: FC<{ title: string; icon?: React.ReactNode; children: React.ReactNode; sectionKey?: string }> = ({
  title,
  icon,
  children,
  sectionKey
}) => (
  <section className="flex flex-col" data-ui="market.section" data-section={sectionKey}>
    <div className="flex items-center gap-1.5 pb-2">
      {icon}
      <h2 className="text-base font-semibold text-foreground">{title}</h2>
    </div>
    <div aria-hidden className="h-px bg-border" />
    <div className="mt-2">{children}</div>
  </section>
)

/** ZCode 风格横向卡片（双列网格单元）：图标 + 名称 + 单行描述，尾部安装胶囊或「…」菜单。 */
const MarketCard: FC<{
  plugin: MarketCatalogPlugin
  installed: boolean
  installing: boolean
  onOpen: (plugin: MarketCatalogPlugin) => void
  onInstall: (pluginId: string) => void
  onRequestUninstall: (plugin: MarketCatalogPlugin) => void
}> = ({ plugin, installed, installing, onOpen, onInstall, onRequestUninstall }) => {
  const { t } = useTranslation()
  return (
    <div
      role="button"
      tabIndex={0}
      data-ui="market.card"
      className="flex min-w-0 cursor-pointer items-center gap-3 rounded-xl px-2 py-2.5 transition-colors hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"
      onClick={() => onOpen(plugin)}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          onOpen(plugin)
        }
      }}>
      <PluginIcon iconUrl={plugin.iconUrl} size={40} className="shrink-0" />
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-1.5">
          <span className="min-w-0 truncate text-sm font-semibold">{plugin.name}</span>
          {installed && (
            <Badge variant="outline" className="shrink-0 text-[11px] font-normal text-emerald-600">
              {t('market.installedBadge')}
            </Badge>
          )}
        </div>
        {plugin.description && (
          <div className="mt-0.5 truncate text-xs text-muted-foreground">{plugin.description}</div>
        )}
        <div className="mt-1">
          <PluginMetadataTags department={plugin.department} author={plugin.author} />
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        {installed ? (
          <DropdownMenu modal={false}>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={t('market.actions')}
                data-ui="market.card.menu"
                onClick={(event) => event.stopPropagation()}>
                <MoreHorizontal className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" onClick={(event) => event.stopPropagation()}>
              <DropdownMenuItem
                variant="destructive"
                onSelect={(event) => {
                  // Radix 把菜单 portal 到卡片外，事件本就冒泡不到卡片；内联渲染的
                  // 场景（测试桩）里这句防止点菜单项误触发卡片的详情跳转。
                  event.stopPropagation()
                  onRequestUninstall(plugin)
                }}>
                <Trash2 />
                {t('market.uninstall')}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : (
          <Button
            variant="secondary"
            size="sm"
            className="rounded-full"
            disabled={installing}
            data-ui="market.card.install"
            onClick={(event) => {
              event.stopPropagation()
              onInstall(plugin.id)
            }}>
            {installing ? <Loader2 className="size-3.5 animate-spin" /> : null}
            {t(installing ? 'market.installing' : 'market.install')}
          </Button>
        )}
      </div>
    </div>
  )
}

/** 双列卡片网格：行距收到 gap-y-1，让横向卡片像列表条目一样密排。 */
const CardGrid: FC<{
  items: MarketCatalogPlugin[]
  installedIds: Set<string>
  installingId: string | null
  onOpen: (plugin: MarketCatalogPlugin) => void
  onInstall: (pluginId: string) => void
  onRequestUninstall: (plugin: MarketCatalogPlugin) => void
}> = ({ items, installedIds, installingId, onOpen, onInstall, onRequestUninstall }) => (
  <div className="grid gap-x-6 gap-y-1 sm:grid-cols-2" data-ui="market.grid">
    {items.map((plugin) => (
      <MarketCard
        key={plugin.id}
        plugin={plugin}
        installed={installedIds.has(plugin.id)}
        installing={installingId === plugin.id}
        onOpen={onOpen}
        onInstall={onInstall}
        onRequestUninstall={onRequestUninstall}
      />
    ))}
  </div>
)

/**
 * 分组折叠：默认完整展开；超过 {@link CATEGORY_VISIBLE_LIMIT} 后收起为前 N 张 +
 * 一条「展开」行（带被隐藏插件的迷你图标），展开后提供「收起」。
 */
const CollapsibleGroup: FC<{
  groupKey: string
  items: MarketCatalogPlugin[]
  expanded: boolean
  onToggle: (key: string) => void
  installedIds: Set<string>
  installingId: string | null
  onOpen: (plugin: MarketCatalogPlugin) => void
  onInstall: (pluginId: string) => void
  onRequestUninstall: (plugin: MarketCatalogPlugin) => void
}> = ({ groupKey, items, expanded, onToggle, installedIds, installingId, onOpen, onInstall, onRequestUninstall }) => {
  const { t } = useTranslation()
  const visible = expanded ? items : items.slice(0, CATEGORY_VISIBLE_LIMIT)
  const hidden = expanded ? [] : items.slice(CATEGORY_VISIBLE_LIMIT)
  return (
    <div>
      <CardGrid
        items={visible}
        installedIds={installedIds}
        installingId={installingId}
        onOpen={onOpen}
        onInstall={onInstall}
        onRequestUninstall={onRequestUninstall}
      />
      {hidden.length > 0 ? (
        <button
          type="button"
          data-ui="market.group-toggle"
          data-group-key={groupKey}
          className="mt-2 flex w-full min-w-0 items-center gap-2 rounded-xl px-2 py-2 text-left text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          onClick={() => onToggle(groupKey)}>
          <span className="flex shrink-0 items-center gap-1.5" aria-hidden>
            {hidden.slice(0, 3).map((plugin) => (
              <PluginIcon key={plugin.id} iconUrl={plugin.iconUrl} size={20} />
            ))}
          </span>
          <span className="min-w-0 truncate">{t('market.viewMore', { count: hidden.length })}</span>
        </button>
      ) : expanded && items.length > CATEGORY_VISIBLE_LIMIT ? (
        <button
          type="button"
          data-ui="market.group-toggle"
          data-group-key={groupKey}
          className="mt-2 rounded-xl px-2 py-2 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          onClick={() => onToggle(groupKey)}>
          {t('market.showLess')}
        </button>
      ) : null}
    </div>
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
                  {(manifest.category ||
                    manifest.author ||
                    manifest.department ||
                    manifest.homepage ||
                    manifest.repository) && (
                    <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      {manifest.category && (
                        <Badge variant="outline" className="text-[11px] font-normal">
                          {categoryLabel(manifest.category, t)}
                        </Badge>
                      )}
                      <PluginMetadataTags department={manifest.department} author={manifest.author} />
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
  onOpen: (pluginId: string) => void
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
                      onClick={() => inCatalog && onOpen(record.pluginId)}
                      onKeyDown={(event) => {
                        if (!inCatalog) return
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault()
                          onOpen(record.pluginId)
                        }
                      }}>
                      <PluginIcon iconUrl={catalogById.get(record.pluginId)?.iconUrl} size={40} className="shrink-0" />
                      <div className="min-w-0 flex-1">
                        <div className="flex min-w-0 items-center gap-1.5">
                          <span className="min-w-0 truncate text-sm font-semibold">
                            {record.name || record.pluginId}
                          </span>
                          <Badge variant="secondary" className="shrink-0 text-[11px] font-normal">
                            v{record.version || '-'}
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
                          onRequestUninstall({ id: record.pluginId, name: record.name || record.pluginId })
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
  const [catalog, setCatalog] = useState<MarketCatalogResult | null>(null)
  const [loading, setLoading] = useState(true)
  const [installed, setInstalled] = useState<MarketInstalledRecord[]>([])
  const [view, setView] = useState<MarketView>({ page: 'grid' })
  const [detail, setDetail] = useState<{ loading: boolean; failed: boolean; manifest: MarketPluginManifest | null }>({
    loading: false,
    failed: false,
    manifest: null
  })
  const [installingId, setInstallingId] = useState<string | null>(null)
  const [justInstalled, setJustInstalled] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({})
  const [activeTab, setActiveTab] = useState<MarketTab>('plugins')
  const [talentVisible, setTalentVisible] = useState(TALENT_PAGE_SIZE)
  const [hiringPresetId, setHiringPresetId] = useState<string | null>(null)
  const [uninstallTarget, setUninstallTarget] = useState<{ id: string; name: string } | null>(null)
  const [uninstalling, setUninstalling] = useState(false)

  const installedIds = useMemo(() => new Set(installed.map((record) => record.pluginId)), [installed])
  const catalogById = useMemo(() => new Map((catalog?.plugins ?? []).map((plugin) => [plugin.id, plugin])), [catalog])
  const featured = useMemo(() => catalog?.plugins.filter((plugin) => plugin.featured) ?? [], [catalog])
  const rest = useMemo(() => catalog?.plugins.filter((plugin) => !plugin.featured) ?? [], [catalog])
  const categories = useMemo(() => groupByCategory(rest), [rest])
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

  const keyword = query.trim().toLowerCase()
  const searchResults = useMemo(() => {
    if (!keyword) return []
    return (catalog?.plugins ?? []).filter(
      (plugin) =>
        plugin.name.toLowerCase().includes(keyword) ||
        plugin.id.toLowerCase().includes(keyword) ||
        (plugin.description ?? '').toLowerCase().includes(keyword)
    )
  }, [catalog, keyword])

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

  const openDetailById = useCallback(
    (pluginId: string) => {
      setJustInstalled(null)
      setView({ page: 'detail', id: pluginId })
      void loadManifest(pluginId)
    },
    [loadManifest]
  )

  const openDetail = useCallback((plugin: MarketCatalogPlugin) => openDetailById(plugin.id), [openDetailById])

  const backToGrid = useCallback(() => setView({ page: 'grid' }), [])

  const handleInstall = useCallback(
    async (pluginId: string) => {
      setInstallingId(pluginId)
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
        setInstallingId(null)
      }
    },
    [refreshInstalled, t]
  )

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

  const toggleGroup = useCallback((key: string) => {
    setCollapsedGroups((current) => ({ ...current, [key]: !(current[key] ?? false) }))
  }, [])

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
            onAction={handleRefresh}
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
            onAction={handleRefresh}
            compact
          />
        </div>
      )
    }
    if (keyword) {
      return (
        <StoreSection title={t('market.searchResults', { count: searchResults.length })} sectionKey="search">
          {searchResults.length === 0 ? (
            <p
              className="rounded-xl border border-dashed px-4 py-3 text-sm text-muted-foreground"
              data-ui="market.search-empty">
              {t('market.searchEmpty')}
            </p>
          ) : (
            <CardGrid
              items={searchResults}
              installedIds={installedIds}
              installingId={installingId}
              onOpen={openDetail}
              onInstall={handleInstall}
              onRequestUninstall={(plugin) => setUninstallTarget({ id: plugin.id, name: plugin.name })}
            />
          )}
        </StoreSection>
      )
    }
    return (
      <>
        {featured.length > 0 && (
          <StoreSection
            title={t('market.featured')}
            icon={<Star size={14} className="text-amber-500" />}
            sectionKey="featured">
            <CardGrid
              items={featured}
              installedIds={installedIds}
              installingId={installingId}
              onOpen={openDetail}
              onInstall={handleInstall}
              onRequestUninstall={(plugin) => setUninstallTarget({ id: plugin.id, name: plugin.name })}
            />
          </StoreSection>
        )}
        {categories.map((group) => (
          <StoreSection key={group.key} title={t(group.key)} sectionKey={group.key}>
            <CollapsibleGroup
              groupKey={group.key}
              items={group.plugins}
              expanded={!(collapsedGroups[group.key] ?? false)}
              onToggle={toggleGroup}
              installedIds={installedIds}
              installingId={installingId}
              onOpen={openDetail}
              onInstall={handleInstall}
              onRequestUninstall={(plugin) => setUninstallTarget({ id: plugin.id, name: plugin.name })}
            />
          </StoreSection>
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

            {activeTab === 'plugins' && installed.length > 0 && (
              <section className="flex flex-col" data-ui="market.installed">
                <div className="flex items-center justify-between border-b pb-2">
                  <h2 className="text-base font-semibold text-foreground">{t('market.installed.title')}</h2>
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
                </div>
                <div
                  className="mt-1 flex items-center gap-3 overflow-x-auto px-2 pt-2 pb-1 sm:-mx-2"
                  data-ui="market.installed-strip">
                  {installed.map((record) => (
                    <Tooltip key={record.pluginId} title={record.name || record.pluginId}>
                      <button
                        type="button"
                        data-ui="market.installed-item"
                        aria-label={record.name || record.pluginId}
                        className="shrink-0 rounded-xl transition-transform hover:scale-105 focus-visible:outline-none"
                        onClick={() => openDetailById(record.pluginId)}>
                        <PluginIcon iconUrl={catalogById.get(record.pluginId)?.iconUrl} size={40} />
                      </button>
                    </Tooltip>
                  ))}
                </div>
              </section>
            )}

            {activeTab === 'plugins' ? (
              renderCatalogBody()
            ) : (
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
      ) : view.page === 'manage' ? (
        <ManageView
          records={installed}
          catalogById={catalogById}
          onBack={backToGrid}
          onBrowse={backToGrid}
          onOpen={openDetailById}
          onRequestUninstall={setUninstallTarget}
        />
      ) : (
        <DetailView
          manifest={detail.manifest}
          loading={detail.loading}
          failed={detail.failed}
          installed={detailInstalled}
          installSucceeded={detailInstallSucceeded}
          installing={installingId === detailPluginId}
          onInstall={() => detailPluginId && void handleInstall(detailPluginId)}
          onBack={backToGrid}
          onRetry={() => detailPluginId && void loadManifest(detailPluginId)}
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
