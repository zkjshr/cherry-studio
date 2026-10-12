import { useNavigate } from '@tanstack/react-router'
import { Puzzle, Building2, Flame, Search, Star, Loader2, CircleAlert } from 'lucide-react'
import type { FC } from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Badge, Button, EmptyState, Spinner, Tooltip } from '@cherrystudio/ui'
import { useSkillCatalog, useSkillInstall } from '@renderer/hooks/useSkills'
import { toast } from '@renderer/services/toast'
import { fetchSkillhubShowcase, searchSkillhub } from '@renderer/utils/skillSearch'
import { cn } from '@renderer/utils/style'
import type { SkillSearchResult } from '@shared/types/skill'
import { parseSkillSourceUrl } from '@shared/utils/skillMarketplace'

import { PluginIcon, StoreSection } from './shared'

/** 榜单一次渲染的条数上限——hot 榜全量有 100 条，直接铺满会淹没页面。 */
const SHOWCASE_VISIBLE_LIMIT = 20

/** 搜索框停连时间；与 SkillMarketplaceDialog 的手感保持一致。 */
const SEARCH_DEBOUNCE_MS = 300

const downloadsFormat = new Intl.NumberFormat(undefined, { notation: 'compact' })

/**
 * 技能卡片的最小结构：SkillHub 搜索结果（SkillSearchResult）与公司内部市场的
 * 展开条目都满足。installSource 是统一安装管线的句柄（skillhub:… / gateway:…）。
 */
interface SkillCardData {
  name: string
  description: string | null
  author: string | null
  iconUrl: string | null
  downloads: number
  installSource: string
}

/** 公司网关技能的落库溯源 URL：…/plugins/{pluginId}/files/{zipPath}。 */
const GATEWAY_SOURCE_URL_REGEX = /\/plugins\/([A-Za-z0-9_-]+)\/files\/([^/]+\.zip)$/

/**
 * 是否来自市场安装（公司源 gateway: 或外部源 skillhub/clawhub/...）。内置、系统、
 * 本地导入/agent 编写的技能都不是市场安装——市场页不展示它们（设置页保留全部）。
 */
export function isMarketInstalledSkill(entry: { sourceUrl: string | null }): boolean {
  if (!entry.sourceUrl) return false
  return parseSkillSourceUrl(entry.sourceUrl) !== null || GATEWAY_SOURCE_URL_REGEX.test(entry.sourceUrl)
}

/** 插件市场 tab 内的技能区块；query 是页面搜索框输入（与插件目录共用），空串表示回退到榜单视图。 */
interface SkillsBlockProps {
  query: string
  /** 页面刷新按钮的计数；每次自增触发外部榜单重拉。 */
  refreshKey: number
}

/**
 * 外部源技能一行（SkillHub 与公司内部市场共用）：图标 + 名称 + 描述 + 下载量，尾部
 * 安装胶囊。已安装的卡片可点击，与本机所有技能一样进入自带的技能详情页（统一详情
 * 入口）；未安装的不可点。
 */
const ExternalSkillCard: FC<{
  result: SkillCardData
  installed: boolean
  installing: boolean
  installedSkillId?: string
  onInstall: (result: SkillCardData) => void
  onOpen: (skillId: string) => void
}> = ({ result, installed, installing, installedSkillId, onInstall, onOpen }) => {
  const { t } = useTranslation()
  const clickable = installed && Boolean(installedSkillId)
  return (
    <div
      role={clickable ? 'button' : undefined}
      tabIndex={clickable ? 0 : undefined}
      data-ui="market.skills.external-card"
      className={cn(
        'flex min-w-0 items-center gap-3 rounded-xl px-2 py-2.5',
        clickable &&
          'cursor-pointer transition-colors hover:bg-accent focus-visible:bg-accent focus-visible:outline-none'
      )}
      onClick={() => {
        if (clickable && installedSkillId) onOpen(installedSkillId)
      }}
      onKeyDown={(event) => {
        if (!clickable || !installedSkillId) return
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          onOpen(installedSkillId)
        }
      }}>
      <PluginIcon iconUrl={result.iconUrl ?? undefined} size={40} className="shrink-0" />
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-1.5">
          <span className="min-w-0 truncate text-sm font-semibold">{result.name}</span>
          {installed && (
            <Badge variant="outline" className="shrink-0 text-[11px] font-normal text-emerald-600">
              {t('market.installedBadge')}
            </Badge>
          )}
        </div>
        {result.description && (
          <div className="mt-0.5 truncate text-xs text-muted-foreground">{result.description}</div>
        )}
        {result.downloads > 0 && (
          <div className="mt-1">
            <span className="shrink-0 text-[11px] text-muted-foreground" data-ui="market.skills.downloads">
              {t('market.skills.downloads', { downloads: downloadsFormat.format(result.downloads) })}
            </span>
          </div>
        )}
      </div>
      {!installed && (
        <Button
          variant="secondary"
          size="sm"
          className="shrink-0 rounded-full"
          disabled={installing}
          data-ui="market.skills.install"
          onClick={(event) => {
            event.stopPropagation()
            onInstall(result)
          }}>
          {installing ? <Loader2 className="size-3.5 animate-spin" /> : null}
          {t(installing ? 'market.installing' : 'market.install')}
        </Button>
      )}
    </div>
  )
}

const SkillsBlock: FC<SkillsBlockProps> = ({ query, refreshKey }) => {
  const { t } = useTranslation()
  const { data: localSkills } = useSkillCatalog()
  const { install, isInstalling } = useSkillInstall()
  const navigate = useNavigate()

  const [hot, setHot] = useState<SkillSearchResult[]>([])
  const [featured, setFeatured] = useState<SkillSearchResult[]>([])
  const [showcaseLoading, setShowcaseLoading] = useState(true)
  const [showcaseFailed, setShowcaseFailed] = useState(false)
  // 公司内部源：网关目录里各插件包的技能展开成单技能卡片；null = 网关不可达/企业未启用，
  // 此时整个分区隐藏（网关的连接错误已由插件目录区展示，不在这里重复报警）。
  const [internalSkills, setInternalSkills] = useState<SkillCardData[] | null>(null)
  const [searchResults, setSearchResults] = useState<SkillSearchResult[]>([])
  const [searchLoading, setSearchLoading] = useState(false)
  const [searchFailed, setSearchFailed] = useState(false)
  const searchRequestRef = useRef(0)

  const loadInternalSkills = useCallback(async () => {
    try {
      const catalog = await window.api.market.getCatalog()
      if (catalog.source !== 'gateway') {
        setInternalSkills(null)
        return
      }
      const packs = catalog.plugins.filter((plugin) => plugin.components.skills > 0)
      const manifests = await Promise.all(packs.map((pack) => window.api.market.getPluginDetail(pack.id)))
      const cards: SkillCardData[] = manifests.flatMap((manifest, index) => {
        const pack = packs[index]
        return manifest.skills.map((skill) => ({
          name: skill.name,
          description: skill.description ?? null,
          author: pack.department ?? pack.author ?? null,
          iconUrl: pack.iconUrl ?? null,
          downloads: 0,
          installSource: `gateway:${manifest.id}/${skill.name}`
        }))
      })
      setInternalSkills(cards)
    } catch {
      setInternalSkills(null)
    }
  }, [])

  useEffect(() => {
    void loadInternalSkills()
  }, [loadInternalSkills, refreshKey])

  const loadShowcase = useCallback(async () => {
    setShowcaseLoading(true)
    setShowcaseFailed(false)
    try {
      const [hotResults, featuredResults] = await Promise.all([
        fetchSkillhubShowcase('hot'),
        fetchSkillhubShowcase('featured')
      ])
      setHot(hotResults)
      setFeatured(featuredResults)
    } catch {
      setShowcaseFailed(true)
    } finally {
      setShowcaseLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadShowcase()
  }, [loadShowcase, refreshKey])

  // 单源搜索带防抖与过期丢弃：requestId 不匹配的响应直接忽略，避免慢响应覆盖新结果。
  useEffect(() => {
    const keyword = query.trim()
    if (!keyword) {
      searchRequestRef.current += 1
      setSearchResults([])
      setSearchLoading(false)
      setSearchFailed(false)
      return
    }
    setSearchLoading(true)
    const timer = setTimeout(() => {
      const requestId = ++searchRequestRef.current
      searchSkillhub(keyword)
        .then((results) => {
          if (requestId !== searchRequestRef.current) return
          setSearchResults(results)
          setSearchFailed(false)
        })
        .catch(() => {
          if (requestId !== searchRequestRef.current) return
          setSearchResults([])
          setSearchFailed(true)
        })
        .finally(() => {
          if (requestId === searchRequestRef.current) setSearchLoading(false)
        })
    }, SEARCH_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [query])

  const keyword = query.trim().toLowerCase()

  // 已安装判定走与远程更新同一条溯源链：sourceUrl 能解析回 installSource 才算同源，
  // 避免同名的本机/市场技能被误标。公司网关的溯源 URL（…/plugins/{id}/files/{zip}）
  // 不在 parseSkillSourceUrl 的注册表里，单独映射回 gateway:{pluginId}/{zip 基名}——
  // 与卡片侧的安装句柄约定一致（发布约定：技能名 = zip 文件基名）。映射同时记住
  // 本地 id，点击已安装卡片时用它跳转到自带的技能详情页（统一详情入口）。
  const { installedSources, installedIdBySource } = useMemo(() => {
    const sources = new Set<string>()
    const ids = new Map<string, string>()
    for (const entry of localSkills) {
      if (!entry.sourceUrl) continue
      const parsed = parseSkillSourceUrl(entry.sourceUrl)
      const gatewayMatch = parsed ? null : GATEWAY_SOURCE_URL_REGEX.exec(entry.sourceUrl)
      const handle =
        parsed?.installSource ??
        (gatewayMatch ? `gateway:${gatewayMatch[1]}/${gatewayMatch[2].replace(/\.zip$/, '')}` : null)
      if (!handle) continue
      sources.add(handle)
      if (!ids.has(handle)) ids.set(handle, entry.id)
    }
    return { installedSources: sources, installedIdBySource: ids }
  }, [localSkills])

  const handleInstall = useCallback(
    async (result: SkillCardData) => {
      const { skill, error } = await install(result.installSource)
      if (!skill) {
        const message = t('market.skills.installFailed', { name: result.name })
        toast.error(error ? `${message}: ${error}` : message)
        return
      }
      toast.success(t('market.skills.installSuccess', { name: result.name }))
      // useSkillInstall 内部已刷新技能目录，本机列表与已安装徽标随 SWR 自动更新。
    },
    [install, t]
  )

  const externalHint = (
    <p className="mb-2 text-xs leading-5 text-muted-foreground" data-ui="market.skills.hint">
      {t('market.skills.externalHint')}
    </p>
  )

  const openSkillDetails = useCallback(
    (skillId: string) => void navigate({ to: '/settings/skills/$skillId', params: { skillId } }),
    [navigate]
  )

  const renderExternalList = (items: SkillCardData[], emptyText: string) => {
    if (items.length === 0) {
      return (
        <p
          className="rounded-xl border border-dashed px-4 py-3 text-sm text-muted-foreground"
          data-ui="market.skills.empty">
          {emptyText}
        </p>
      )
    }
    return (
      <div className="grid gap-x-6 gap-y-1 sm:grid-cols-2" data-ui="market.skills.external-grid">
        {items.map((result) => (
          <ExternalSkillCard
            key={result.installSource}
            result={result}
            installed={installedSources.has(result.installSource)}
            installing={isInstalling(result.installSource)}
            installedSkillId={installedIdBySource.get(result.installSource)}
            onInstall={(target) => void handleInstall(target)}
            onOpen={openSkillDetails}
          />
        ))}
      </div>
    )
  }

  const renderShowcaseBody = (items: SkillCardData[]) => {
    if (showcaseLoading) {
      return (
        <div className="flex items-center justify-center py-12" data-ui="market.skills.loading">
          <Spinner text={t('common.loading')} className="text-muted-foreground" />
        </div>
      )
    }
    if (showcaseFailed) {
      return (
        <div className="flex items-center justify-center py-8" data-ui="market.skills.failed">
          <EmptyState
            icon={CircleAlert}
            title={t('market.skills.loadFailed')}
            actionLabel={t('market.retry')}
            onAction={() => void loadShowcase()}
            compact
          />
        </div>
      )
    }
    return renderExternalList(items, t('market.skills.empty'))
  }

  // 公司源在搜索时做客户端过滤；过滤后为空（含纯 SkillHub 关键词）则整个分区隐藏。
  const visibleInternalSkills = useMemo(() => {
    if (!internalSkills) return null
    if (!keyword) return internalSkills
    return internalSkills.filter(
      (skill) => skill.name.toLowerCase().includes(keyword) || (skill.description ?? '').toLowerCase().includes(keyword)
    )
  }, [internalSkills, keyword])

  return (
    <div className="flex flex-col gap-6" data-ui="market.skills">
      {visibleInternalSkills && visibleInternalSkills.length > 0 && (
        <StoreSection
          title={t('market.skills.internal.title')}
          icon={<Building2 size={14} className="text-muted-foreground" />}
          sectionKey="internal-skills">
          <p className="mb-2 text-xs leading-5 text-muted-foreground" data-ui="market.skills.internal-hint">
            {t('market.skills.internal.hint')}
          </p>
          {renderExternalList(visibleInternalSkills, t('market.skills.internal.empty'))}
        </StoreSection>
      )}
      {keyword ? (
        <StoreSection
          title={t('market.skills.search.title')}
          icon={<Search size={14} className="text-muted-foreground" />}
          sectionKey="skillhub-search">
          {externalHint}
          {searchLoading ? (
            <div className="flex items-center justify-center py-12" data-ui="market.skills.search-loading">
              <Spinner text={t('common.loading')} className="text-muted-foreground" />
            </div>
          ) : searchFailed ? (
            <div className="flex items-center justify-center py-8" data-ui="market.skills.search-failed">
              <EmptyState icon={CircleAlert} title={t('market.skills.searchFailed')} compact />
            </div>
          ) : (
            renderExternalList(searchResults, t('market.skills.empty'))
          )}
        </StoreSection>
      ) : (
        <>
          <StoreSection
            title={t('market.skills.hot.title')}
            icon={<Flame size={14} className="text-orange-500" />}
            sectionKey="skillhub-hot">
            {externalHint}
            {renderShowcaseBody(hot.slice(0, SHOWCASE_VISIBLE_LIMIT))}
          </StoreSection>
          {!showcaseLoading && !showcaseFailed && (
            <StoreSection
              title={t('market.skills.featured.title')}
              icon={<Star size={14} className="text-amber-500" />}
              sectionKey="skillhub-featured">
              {renderExternalList(featured.slice(0, SHOWCASE_VISIBLE_LIMIT), t('market.skills.empty'))}
            </StoreSection>
          )}
        </>
      )}
    </div>
  )
}

/**
 * 「已安装」分类里的技能图标：与已安装插件同一横条、同一形态（40px 圆角容器 +
 * 悬停名牌带 scope），点击进「设置 → 技能」详情；没有技能时返回 null、不占位。
 */
export function InstalledSkillsList() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { data: localSkills, isLoading } = useSkillCatalog()

  // 市场页只展示市场安装的技能（公司源 + 外部源）；内置/系统/本地技能留在设置页。
  const marketSkills = useMemo(() => localSkills.filter(isMarketInstalledSkill), [localSkills])
  if (isLoading || marketSkills.length === 0) return null

  return (
    <>
      {marketSkills.map((skill) => (
        <Tooltip key={skill.id} title={`${skill.name}（${t(`market.skills.scope.${skill.scope}`)}）`}>
          <button
            type="button"
            data-ui="market.installed-item"
            aria-label={skill.name}
            className="shrink-0 rounded-xl transition-transform hover:scale-105 focus-visible:outline-none"
            onClick={() => void navigate({ to: '/settings/skills/$skillId', params: { skillId: skill.id } })}>
            <span
              aria-hidden
              className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-muted text-muted-foreground">
              <Puzzle size={18} strokeWidth={1.5} />
            </span>
          </button>
        </Tooltip>
      ))}
    </>
  )
}

export default SkillsBlock
