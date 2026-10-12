// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { toast } from '@renderer/services/toast'
import type { MarketCatalogResult, MarketInstalledRecord, MarketUninstallResult } from '@shared/types/marketplace'

import MarketPage from '../MarketPage'

/**
 * The market page renders two skill sources only (company gateway expansion via
 * SkillsBlock + external SkillHub). Plugin packs are a publishing container, not
 * a displayed category — the grid/detail/pack-install UI is gone; installed packs
 * are managed through the manage view reached from the strip gear.
 */

/**
 * t() stays key-based (like most page suites) but echoes interpolation args so
 * the uninstall toast can be asserted to carry the name.
 */
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      options && 'name' in options ? `${key}:${options.name}` : key
  })
}))

vi.mock('@renderer/components/Navbar', () => ({
  Navbar: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  NavbarCenter: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>
}))

vi.mock('@renderer/components/Scrollbar', () => ({
  default: ({ children, ...rest }: { children?: React.ReactNode } & Record<string, unknown>) => (
    <div {...rest}>{children}</div>
  )
}))

// SkillsBlock 随插件市场 tab 一起挂载：其技能目录/安装走主进程 IPC、榜单走外网、
// 返回设置走 router——这些不在本套件的关注点内，全部桩掉。
vi.mock('@renderer/hooks/useSkills', () => ({
  useSkillCatalog: () => ({ data: [], isLoading: false }),
  useSkillInstall: () => ({
    install: vi.fn(async () => ({ skill: null })),
    isInstalling: () => false
  })
}))
vi.mock('@renderer/utils/skillSearch', () => ({
  fetchSkillhubShowcase: vi.fn(async () => []),
  searchSkillhub: vi.fn(async () => [])
}))
const { mockNavigate } = vi.hoisted(() => ({ mockNavigate: vi.fn() }))
vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => mockNavigate
}))

const marketApi = {
  getCatalog: vi.fn<() => Promise<MarketCatalogResult>>(),
  getPluginDetail: vi.fn<(pluginId: string) => Promise<unknown>>(),
  getInstalled: vi.fn<() => Promise<MarketInstalledRecord[]>>(),
  uninstall: vi.fn<(pluginId: string) => Promise<MarketUninstallResult>>()
}

const catalogEntry = {
  id: 'p1',
  name: 'P1',
  version: '1.0.0',
  description: 'demo plugin',
  category: 'knowledge',
  featured: true,
  icon: 'icon.png',
  iconUrl: 'data:image/png;base64,iVBORw==',
  components: { skills: 0, mcp_servers: 2, assistants: 1, minapps: 0 }
}

function installedRecord(overrides: Partial<MarketInstalledRecord> = {}): MarketInstalledRecord {
  return {
    pluginId: 'p1',
    name: 'P1',
    version: '1.0.0',
    installedAt: 't1',
    schemaVersion: 2,
    refs: { skillFolderNames: [], skillSourceUrls: {}, mcpIds: [], assistantIds: [], minappAppIds: [] },
    ...overrides
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  ;(window as unknown as { api: unknown }).api = { market: marketApi }
  marketApi.getCatalog.mockResolvedValue({ source: 'gateway', plugins: [catalogEntry], warnings: [] })
  marketApi.getInstalled.mockResolvedValue([])
})

describe('MarketPage plugins tab — two skill sources only', () => {
  it('never renders plugin pack cards, even for catalog entries', async () => {
    render(<MarketPage />)
    // Catalog loads (the SkillsBlock company expansion consumes it)…
    await waitFor(() => expect(marketApi.getCatalog).toHaveBeenCalled())
    // …but no pack card/detail grid exists anymore.
    expect(document.querySelector('[data-ui="market.card"]')).toBeNull()
    expect(document.querySelector('[data-ui="market.grid"]')).toBeNull()
    // The manifest detail endpoint is never used by the page itself.
    expect(marketApi.getPluginDetail).not.toHaveBeenCalled()
  })
})

describe('MarketPage manage view', () => {
  it('opens from the strip gear, lists records with component badges, and returns to the grid', async () => {
    marketApi.getInstalled.mockResolvedValue([
      installedRecord({
        refs: {
          skillFolderNames: ['s1', 's2'],
          skillSourceUrls: {},
          mcpIds: ['m1'],
          assistantIds: ['a1'],
          minappAppIds: []
        }
      })
    ])
    render(<MarketPage />)
    fireEvent.click(await screen.findByRole('button', { name: 'market.manageInstalled' }))
    // Row metadata: heading with count badge, install date label, component badges.
    expect(await screen.findByRole('heading', { name: /market\.manage\.title/ })).toBeInTheDocument()
    expect(screen.getByText(/market\.manage\.installedAt/)).toBeInTheDocument()
    expect(screen.getByText('2 market.component.skill')).toBeInTheDocument()
    expect(screen.getByText('1 market.component.mcp_server')).toBeInTheDocument()
    expect(screen.getByText('1 market.component.assistant')).toBeInTheDocument()
    expect(screen.queryByText('market.component.minapp')).not.toBeInTheDocument()
    // Row click routes to the native skills page — installed packs leave the market UI.
    fireEvent.click(screen.getByRole('button', { name: /P1/ }))
    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith({ to: '/settings/skills' }))
  })

  it('uninstalls from the manage row through the confirm dialog', async () => {
    marketApi.getInstalled.mockResolvedValue([installedRecord()])
    marketApi.uninstall.mockResolvedValue({
      pluginId: 'p1',
      results: [{ kind: 'skill', target: 'writer', status: 'removed' }],
      ok: true
    })
    render(<MarketPage />)
    fireEvent.click(await screen.findByRole('button', { name: 'market.manageInstalled' }))
    fireEvent.click(await screen.findByRole('button', { name: 'market.uninstall' }))
    fireEvent.click(await screen.findByRole('button', { name: 'market.uninstallConfirm' }))
    await waitFor(() => expect(marketApi.uninstall).toHaveBeenCalledWith('p1'))
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('market.uninstallSuccess:P1'))
    // The strip refreshes after a successful uninstall.
    await waitFor(() => expect(marketApi.getInstalled).toHaveBeenCalledTimes(2))
  })

  it('shows the empty state after the last plugin is uninstalled', async () => {
    marketApi.uninstall.mockResolvedValue({ pluginId: 'p1', results: [], ok: true })
    // First read populates the manage list; the post-uninstall refresh returns empty.
    let installedReads = 0
    marketApi.getInstalled.mockImplementation(async () => {
      installedReads += 1
      return installedReads === 1 ? [installedRecord()] : []
    })
    render(<MarketPage />)
    await waitFor(() => expect(marketApi.getInstalled).toHaveBeenCalled())
    fireEvent.click(await screen.findByRole('button', { name: 'market.manageInstalled' }))
    fireEvent.click(await screen.findByRole('button', { name: 'market.uninstall' }))
    fireEvent.click(await screen.findByRole('button', { name: 'market.uninstallConfirm' }))
    await waitFor(() => expect(screen.getByText('market.manage.empty.title')).toBeInTheDocument())
    expect(screen.queryByRole('button', { name: 'market.manageInstalled' })).not.toBeInTheDocument()
  })
})
