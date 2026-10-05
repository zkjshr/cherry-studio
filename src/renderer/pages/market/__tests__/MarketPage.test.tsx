// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { toast } from '@renderer/services/toast'
import type {
  MarketCatalogResult,
  MarketInstallResult,
  MarketInstalledRecord,
  MarketPluginManifest,
  MarketUninstallResult
} from '@shared/types/marketplace'

import MarketPage from '../MarketPage'

/**
 * t() stays key-based (like most page suites) but echoes interpolation args so
 * the partial-install toast can be asserted to carry the failed names.
 */
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      options && 'names' in options ? `${key}:${options.names}` : key
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

const marketApi = {
  getCatalog: vi.fn<() => Promise<MarketCatalogResult>>(),
  getPluginDetail: vi.fn<(pluginId: string) => Promise<MarketPluginManifest>>(),
  getInstalled: vi.fn<() => Promise<MarketInstalledRecord[]>>(),
  install: vi.fn<(pluginId: string) => Promise<MarketInstallResult>>(),
  uninstall: vi.fn<(pluginId: string) => Promise<MarketUninstallResult>>()
}

const catalogEntry = {
  id: 'p1',
  name: 'P1',
  version: '1.0.0',
  description: 'demo plugin',
  category: 'knowledge',
  featured: false,
  icon: 'icon.png',
  iconUrl: 'data:image/png;base64,iVBORw==',
  components: { skills: 0, mcp_servers: 2, assistants: 1, minapps: 0 }
}

const manifest = {
  id: 'p1',
  name: 'P1',
  version: '1.0.0',
  description: 'demo plugin',
  category: 'knowledge',
  icon: 'icon.png',
  iconUrl: 'data:image/png;base64,iVBORw==',
  skills: [],
  mcp_servers: [
    { name: 'ServerA', type: 'sse' as const },
    { name: 'ServerB', type: 'sse' as const }
  ],
  assistants: [{ name: '助手' }],
  minapps: []
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
  marketApi.getPluginDetail.mockResolvedValue(manifest)
  marketApi.getInstalled.mockResolvedValue([])
})

async function openDetailAndInstall(): Promise<void> {
  render(<MarketPage />)
  fireEvent.click(await screen.findByText('P1'))
  const installButton = await screen.findByRole('button', { name: 'market.install' })
  fireEvent.click(installButton)
  await waitFor(() => expect(marketApi.install).toHaveBeenCalledWith('p1'))
}

describe('MarketPage detail drill-in', () => {
  it('opens a page-level detail with header metadata and returns to the grid', async () => {
    marketApi.getPluginDetail.mockResolvedValue({
      ...manifest,
      description: '第一段介绍\n第二段介绍',
      author: '知开始',
      homepage: 'https://example.com',
      repository: 'https://github.com/example/p1',
      keywords: ['rag', 'kb']
    })
    render(<MarketPage />)
    fireEvent.click(await screen.findByText('P1'))
    // Page-level view: the grid card is replaced by a detail page with the
    // plugin name as heading, metadata chips, full description and an install
    // action in the sticky bar.
    expect(await screen.findByRole('heading', { name: 'P1' })).toBeInTheDocument()
    expect(screen.getByText(/第一段介绍/)).toBeInTheDocument()
    expect(screen.getByText(/market\.detail\.author/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'market.detail.homepage' })).toHaveAttribute('href', 'https://example.com')
    expect(screen.getByRole('link', { name: 'market.detail.viewRepo' })).toHaveAttribute(
      'href',
      'https://github.com/example/p1'
    )
    expect(screen.getByText('rag')).toBeInTheDocument()
    expect(screen.getByText('kb')).toBeInTheDocument()
    // Component groups render as bordered cards with count badges.
    expect(screen.getByText('market.component.mcp_server')).toBeInTheDocument()
    expect(screen.getByText('2')).toBeInTheDocument()
    expect(screen.getByText('market.component.assistant')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'market.install' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'market.detail.back' }))
    // Back on the grid: the detail heading is gone and the catalog card is back.
    expect(screen.queryByRole('heading', { name: 'P1' })).not.toBeInTheDocument()
    expect(await screen.findByText('P1', { selector: '[data-ui="market.card"] span' })).toBeInTheDocument()
  })

  it('shows a retryable failure state when the manifest fetch fails', async () => {
    marketApi.getPluginDetail.mockRejectedValueOnce(new Error('boom'))
    render(<MarketPage />)
    fireEvent.click(await screen.findByText('P1'))
    expect(await screen.findByText('market.detail.loadFailed')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'market.retry' }))
    expect(await screen.findByRole('heading', { name: 'P1' })).toBeInTheDocument()
    expect(marketApi.getPluginDetail).toHaveBeenCalledTimes(2)
  })

  it('disables the install action when the plugin is already installed', async () => {
    marketApi.getInstalled.mockResolvedValue([installedRecord()])
    render(<MarketPage />)
    fireEvent.click(await screen.findByText('P1', { selector: '[data-ui="market.card"] span' }))
    const installButton = await screen.findByRole('button', { name: 'market.installedBadge' })
    expect(installButton).toBeDisabled()
  })
})

describe('MarketPage install toasts', () => {
  it('shows the success toast only when every component installed', async () => {
    marketApi.install.mockResolvedValue({
      pluginId: 'p1',
      name: 'P1',
      version: '1.0.0',
      results: [
        { kind: 'mcp_server', target: 'ServerA', status: 'installed' },
        { kind: 'mcp_server', target: 'ServerB', status: 'installed' },
        { kind: 'assistant', target: '助手', status: 'installed' }
      ],
      ok: true
    })
    await openDetailAndInstall()
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('market.installSuccess'))
    expect(toast.warning).not.toHaveBeenCalled()
    // The install triggers a refresh of the installed strip.
    await waitFor(() => expect(marketApi.getInstalled).toHaveBeenCalledTimes(2))
  })

  it('warns with the failed component names on a partial install', async () => {
    marketApi.install.mockResolvedValue({
      pluginId: 'p1',
      name: 'P1',
      version: '1.0.0',
      results: [
        { kind: 'mcp_server', target: 'ServerA', status: 'installed' },
        { kind: 'mcp_server', target: 'ServerB', status: 'failed', error: 'boom' },
        { kind: 'assistant', target: '助手', status: 'skipped' }
      ],
      ok: true
    })
    await openDetailAndInstall()
    await waitFor(() => expect(toast.warning).toHaveBeenCalledWith('market.installPartial:ServerB'))
    expect(toast.success).not.toHaveBeenCalled()
  })
})

describe('MarketPage uninstall', () => {
  it('uninstalls via the card menu confirm dialog and surfaces component failures', async () => {
    const user = userEvent.setup()
    marketApi.getInstalled.mockResolvedValue([installedRecord()])
    marketApi.uninstall.mockResolvedValue({
      pluginId: 'p1',
      results: [
        { kind: 'mcp_server', target: 'm1', status: 'removed' },
        { kind: 'mcp_server', target: 'm2', status: 'failed', error: 'sqlite busy' }
      ],
      ok: false
    })
    render(<MarketPage />)
    // Installed card shows the「…」menu; the item is a plain button under the UI stub.
    await user.click(await screen.findByRole('button', { name: 'market.actions' }))
    await user.click(await screen.findByRole('button', { name: 'market.uninstall' }))
    // Confirm dialog: description then the destructive confirm button.
    expect(await screen.findByText('market.uninstallConfirmDescription')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'market.uninstallConfirm' }))
    await waitFor(() => expect(marketApi.uninstall).toHaveBeenCalledWith('p1'))
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(expect.stringContaining('sqlite busy')))
    // Failure keeps the record installed — the strip icon survives and no refresh happened.
    expect(screen.getByRole('button', { name: 'P1' })).toBeInTheDocument()
    expect(marketApi.getInstalled).toHaveBeenCalledTimes(1)
  })

  it('closes the dialog and refreshes the strip after a successful uninstall', async () => {
    const user = userEvent.setup()
    marketApi.getInstalled.mockResolvedValue([installedRecord()])
    marketApi.uninstall.mockResolvedValue({
      pluginId: 'p1',
      results: [{ kind: 'mcp_server', target: 'm1', status: 'removed' }],
      ok: true
    })
    render(<MarketPage />)
    await user.click(await screen.findByRole('button', { name: 'market.actions' }))
    await user.click(await screen.findByRole('button', { name: 'market.uninstall' }))
    fireEvent.click(await screen.findByRole('button', { name: 'market.uninstallConfirm' }))
    await waitFor(() => expect(marketApi.uninstall).toHaveBeenCalledWith('p1'))
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('market.uninstallSuccess'))
    // The dialog is gone and the strip re-read.
    await waitFor(() => expect(screen.queryByText('market.uninstallConfirmTitle')).not.toBeInTheDocument())
    expect(marketApi.getInstalled).toHaveBeenCalledTimes(2)
  })
})

describe('MarketPage search', () => {
  it('narrows the grid to matching plugins while the query is set', async () => {
    marketApi.getCatalog.mockResolvedValue({
      source: 'gateway',
      plugins: [catalogEntry, { ...catalogEntry, id: 'p2', name: 'P2', description: '知识检索增强' }],
      warnings: []
    })
    render(<MarketPage />)
    expect(await screen.findByText('P1', { selector: '[data-ui="market.card"] span' })).toBeInTheDocument()
    const search = screen.getByPlaceholderText('market.searchPlaceholder')
    fireEvent.change(search, { target: { value: 'p2' } })
    expect(await screen.findByText('P2', { selector: '[data-ui="market.card"] span' })).toBeInTheDocument()
    expect(screen.queryByText('P1', { selector: '[data-ui="market.card"] span' })).not.toBeInTheDocument()
  })
})

describe('MarketPage category collapse', () => {
  it('shows all cards by default, 收起 caps the group at six, 展开 restores', async () => {
    marketApi.getCatalog.mockResolvedValue({
      source: 'gateway',
      plugins: Array.from({ length: 8 }, (_, index) => ({
        ...catalogEntry,
        id: `p${index}`,
        name: `P${index}`,
        category: 'utilities'
      })),
      warnings: []
    })
    render(<MarketPage />)
    await screen.findByText('P0', { selector: '[data-ui="market.card"] span' })
    // ZCode 行为：默认完整展开，超过六个出现「收起」。
    expect(document.querySelectorAll('[data-ui="market.card"]').length).toBe(8)
    fireEvent.click(screen.getByText('market.showLess'))
    expect(document.querySelectorAll('[data-ui="market.card"]').length).toBe(6)
    expect(screen.getByText('market.viewMore')).toBeInTheDocument()
    fireEvent.click(screen.getByText('market.viewMore'))
    expect(document.querySelectorAll('[data-ui="market.card"]').length).toBe(8)
  })
})
