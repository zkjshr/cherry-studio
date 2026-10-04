/**
 * Marketplace service behavior tests (E5 fix wave) — the guard rails around
 * install/uninstall: enterprise-managed assistants are never overwritten or
 * archived, MCP rows are only adopted when the registryUrl provenance matches,
 * relative catalog icons are fetched main-side into data: URLs, and a failed
 * uninstall keeps the record (with pruned refs) so a retry is possible.
 */

import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { DataApiError, DataApiErrorFactory, ErrorCode } from '@shared/data/api/errors'
import type { MarketInstalledRecord } from '@shared/types/marketplace'
import { MARKET_SKIP_REASONS } from '@shared/types/marketplace'

const mocks = vi.hoisted(() => {
  return {
    dirs: { userData: '', temp: '' },
    managedAssistantIds: [] as string[],
    fetch: vi.fn<(url: string, init?: { headers?: Record<string, string> }) => Promise<Response>>(),
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    assistantDataService: {
      list: vi.fn<
        (query: { search?: string; page: number; limit: number }) => {
          items: Array<{ id: string; name: string }>
          total: number
          page: number
        }
      >(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn()
    },
    mcpServerService: {
      findByIdOrName: vi.fn<(key: string) => { id: string; registryUrl: string | null } | undefined>(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn()
    },
    miniAppService: {
      getByAppId: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn()
    },
    skillService: {
      installFromMarketplaceZip: vi.fn(),
      getByFolderName: vi.fn(),
      uninstall: vi.fn()
    },
    atomicWriteFile: vi.fn(async (target: unknown, data: string) => {
      await fs.promises.writeFile(String(target), data, 'utf-8')
    })
  }
})

vi.mock('@application', () => ({
  application: {
    getPath: vi.fn((key: string) => {
      if (key === 'app.userdata.data') return mocks.dirs.userData
      if (key === 'app.temp') return mocks.dirs.temp
      throw new Error(`unexpected getPath key: ${key}`)
    })
  }
}))

vi.mock('electron', () => ({
  net: { fetch: mocks.fetch }
}))

vi.mock('@logger', () => ({
  loggerService: { withContext: () => mocks.logger }
}))

vi.mock('@main/enterprise/enterpriseSettings', () => ({
  loadEnterpriseSettings: () => ({ status: 'enabled' as const, serverUrl: GATEWAY, token: TOKEN })
}))

vi.mock('@main/enterprise/managedAssistants', () => ({
  loadManagedAssistantIds: () => mocks.managedAssistantIds
}))

vi.mock('@data/services/AssistantService', () => ({
  assistantDataService: mocks.assistantDataService
}))

vi.mock('@data/services/McpServerService', () => ({
  mcpServerService: mocks.mcpServerService
}))

vi.mock('@data/services/MiniAppService', () => ({
  miniAppService: mocks.miniAppService
}))

vi.mock('@main/ai/skills/SkillService', () => ({
  skillService: mocks.skillService
}))

vi.mock('@main/ai/skills/skillArchive', () => ({
  MAX_SKILL_SIZE: 50 * 1024 * 1024
}))

vi.mock('@main/utils/file', () => ({
  atomicWriteFile: mocks.atomicWriteFile
}))

import * as marketplaceService from '../marketplaceService'

const GATEWAY = 'http://gw:8787'
const TOKEN = 'client-token'
const PLUGIN_ID = 'p1'
const REGISTRY_URL = `${GATEWAY}/marketplace/api/plugins/${PLUGIN_ID}`
const ICON_DATA_URL_PREFIX = 'data:image/png;base64,'

function jsonResponse(payload: unknown): Response {
  return new Response(JSON.stringify(payload), { status: 200, headers: { 'content-type': 'application/json' } })
}

function bytesResponse(bytes: Uint8Array, contentType: string): Response {
  return new Response(bytes as unknown as BodyInit, {
    status: 200,
    headers: { 'content-type': contentType }
  })
}

const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
const ZIP_BYTES = new Uint8Array([0x50, 0x4b, 0x03, 0x04])

const catalogPayload = {
  plugins: [
    {
      id: PLUGIN_ID,
      name: 'P1',
      version: '1.0.0',
      description: 'demo',
      category: 'knowledge',
      featured: true,
      icon: 'icon.png',
      components: { skills: 0, mcp_servers: 0, assistants: 0, minapps: 0 }
    },
    {
      id: 'p2',
      name: 'P2',
      version: '2.0.0',
      description: 'demo',
      category: 'utilities',
      featured: false,
      icon: 'https://cdn.example.com/i.png',
      components: { skills: 0, mcp_servers: 0, assistants: 0, minapps: 0 }
    }
  ],
  warnings: []
}

const manifestPayload = {
  id: PLUGIN_ID,
  name: 'P1',
  version: '1.0.0',
  description: 'demo',
  category: 'knowledge',
  icon: 'icon.png',
  skills: [{ name: 'weknora-usage', zip: 'payload/weknora-usage.zip' }],
  mcp_servers: [{ name: 'weknora', type: 'sse', base_url: 'http://10.0.0.1:8080' }],
  assistants: [{ name: '知识助手', prompt: 'market prompt' }],
  minapps: []
}

function routeGatewayFetch(): void {
  mocks.fetch.mockImplementation(async (url: string) => {
    if (url === `${GATEWAY}/marketplace/api/catalog`) return jsonResponse(catalogPayload)
    if (url === `${GATEWAY}/marketplace/api/plugins/${PLUGIN_ID}`) return jsonResponse(manifestPayload)
    if (url === `${GATEWAY}/marketplace/api/plugins/${PLUGIN_ID}/files/icon.png`) {
      return bytesResponse(PNG_BYTES, 'image/png')
    }
    if (url === `${GATEWAY}/marketplace/api/plugins/${PLUGIN_ID}/files/payload/weknora-usage.zip`) {
      return bytesResponse(ZIP_BYTES, 'application/zip')
    }
    throw new Error(`unexpected fetch: ${url}`)
  })
}

function installedFilePath(): string {
  return path.join(mocks.dirs.userData, 'marketplace', 'installed.json')
}

function readInstalledRecords(): MarketInstalledRecord[] {
  return JSON.parse(fs.readFileSync(installedFilePath(), 'utf-8')) as MarketInstalledRecord[]
}

function writeInstalledRecords(records: unknown): void {
  fs.mkdirSync(path.dirname(installedFilePath()), { recursive: true })
  fs.writeFileSync(installedFilePath(), JSON.stringify(records, null, 2), 'utf-8')
}

/** Assistant list mock: pages of 50, `total` drives the walk. */
function mockAssistantPages(pages: Array<Array<{ id: string; name: string }>>, total: number): void {
  mocks.assistantDataService.list.mockImplementation((query: { page: number; limit: number }) => ({
    items: pages[query.page - 1] ?? [],
    total,
    page: query.page
  }))
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.dirs.userData = fs.mkdtempSync(path.join(os.tmpdir(), 'market-userdata-'))
  mocks.dirs.temp = fs.mkdtempSync(path.join(os.tmpdir(), 'market-temp-'))
  mocks.managedAssistantIds = []
  mocks.atomicWriteFile.mockImplementation(async (target: unknown, data: string) => {
    await fs.promises.writeFile(String(target), data, 'utf-8')
  })
})

afterEach(() => {
  fs.rmSync(mocks.dirs.userData, { recursive: true, force: true })
  fs.rmSync(mocks.dirs.temp, { recursive: true, force: true })
})

describe('getCatalog icon resolution', () => {
  it('returns data: URLs for gateway-relative icons and passes absolute icons through', async () => {
    routeGatewayFetch()
    const result = await marketplaceService.getCatalog()
    expect(result.source).toBe('gateway')
    expect(result.plugins[0].iconUrl?.startsWith(ICON_DATA_URL_PREFIX)).toBe(true)
    expect(result.plugins[1].iconUrl).toBe('https://cdn.example.com/i.png')
    // The token travels with the main-side bytes fetch.
    const iconCall = mocks.fetch.mock.calls.find(([url]) => String(url).endsWith('/files/icon.png'))
    expect(iconCall?.[1]?.headers).toMatchObject({ 'X-Client-Token': TOKEN })
  })

  it('serves repeated catalog fetches from the bounded icon cache', async () => {
    // Unique plugin id: the icon cache is module-level by design.
    const pluginId = 'icons-cache-p'
    mocks.fetch.mockImplementation(async (url: string) => {
      if (url === `${GATEWAY}/marketplace/api/catalog`) {
        return jsonResponse({
          plugins: [
            {
              id: pluginId,
              name: 'Icons',
              version: '1.0.0',
              description: '',
              category: 'utilities',
              featured: false,
              icon: 'icon.png',
              components: { skills: 0, mcp_servers: 0, assistants: 0, minapps: 0 }
            }
          ],
          warnings: []
        })
      }
      if (url === `${GATEWAY}/marketplace/api/plugins/${pluginId}/files/icon.png`) {
        return bytesResponse(PNG_BYTES, 'image/png')
      }
      throw new Error(`unexpected fetch: ${url}`)
    })
    await marketplaceService.getCatalog()
    expect(mocks.fetch.mock.calls.filter(([url]) => String(url).endsWith('/files/icon.png'))).toHaveLength(1)
    await marketplaceService.getCatalog()
    expect(mocks.fetch.mock.calls.filter(([url]) => String(url).endsWith('/files/icon.png'))).toHaveLength(1)
  })

  it('degrades to the placeholder icon (undefined) when the token-gated fetch fails', async () => {
    // Unique plugin id: the icon cache is module-level by design.
    const pluginId = 'icons-fail-p'
    mocks.fetch.mockImplementation(async (url: string) => {
      if (url === `${GATEWAY}/marketplace/api/catalog`) {
        return jsonResponse({
          plugins: [
            {
              id: pluginId,
              name: 'Broken icon',
              version: '1.0.0',
              description: '',
              category: 'utilities',
              featured: false,
              icon: 'icon.png',
              components: { skills: 0, mcp_servers: 0, assistants: 0, minapps: 0 }
            },
            { ...catalogPayload.plugins[1] }
          ],
          warnings: []
        })
      }
      if (url === `${GATEWAY}/marketplace/api/plugins/${pluginId}/files/icon.png`) {
        // The 401 the renderer's <img> would have hit.
        return new Response('unauthorized', { status: 401 })
      }
      throw new Error(`unexpected fetch: ${url}`)
    })
    const result = await marketplaceService.getCatalog()
    expect(result.source).toBe('gateway')
    expect(result.plugins[0].iconUrl).toBeUndefined()
    expect(result.plugins[1].iconUrl).toBe('https://cdn.example.com/i.png')
  })
})

describe('installPlugin — managed assistant guard', () => {
  it('skips a name-matched MANAGED assistant: never updated, never recorded', async () => {
    routeGatewayFetch()
    mocks.managedAssistantIds = ['managed-1']
    mockAssistantPages([[{ id: 'managed-1', name: '知识助手' }]], 1)
    mocks.mcpServerService.findByIdOrName.mockReturnValue(undefined)
    mocks.mcpServerService.create.mockReturnValue({ id: 'mcp-new' })
    mocks.skillService.installFromMarketplaceZip.mockResolvedValue({
      folderName: 'weknora-usage',
      name: 'weknora-usage'
    })

    const result = await marketplaceService.installPlugin(PLUGIN_ID)
    expect(result.ok).toBe(true)
    expect(result.results).toContainEqual({
      kind: 'assistant',
      target: '知识助手',
      status: 'skipped',
      reason: MARKET_SKIP_REASONS.managedByEnterprise
    })
    expect(mocks.assistantDataService.update).not.toHaveBeenCalled()
    expect(mocks.assistantDataService.create).not.toHaveBeenCalled()

    const [record] = readInstalledRecords()
    expect(record.refs.assistantIds).toEqual([])
    // Everything else still lands.
    expect(record.refs.mcpIds).toEqual(['mcp-new'])
    expect(record.refs.skillSourceUrls).toEqual({
      'weknora-usage': `${GATEWAY}/marketplace/api/plugins/${PLUGIN_ID}/files/payload/weknora-usage.zip`
    })
  })

  it('still updates an UNMANAGED name match and records its id', async () => {
    routeGatewayFetch()
    mocks.managedAssistantIds = []
    mockAssistantPages([[{ id: 'user-1', name: '知识助手' }]], 1)
    mocks.mcpServerService.findByIdOrName.mockReturnValue(undefined)
    mocks.skillService.installFromMarketplaceZip.mockResolvedValue({
      folderName: 'weknora-usage',
      name: 'weknora-usage'
    })

    const result = await marketplaceService.installPlugin(PLUGIN_ID)
    expect(mocks.assistantDataService.update).toHaveBeenCalledWith('user-1', { prompt: 'market prompt' })
    expect(result.results).toContainEqual({ kind: 'assistant', target: '知识助手', status: 'updated' })
    expect(readInstalledRecords()[0].refs.assistantIds).toEqual(['user-1'])
  })

  it('finds an exact-name assistant beyond page 1 of the paginated list', async () => {
    routeGatewayFetch()
    const filler = Array.from({ length: 50 }, (_, index) => ({ id: `filler-${index}`, name: `助手 ${index}` }))
    mockAssistantPages([filler, [{ id: 'assistant-60', name: '知识助手' }]], 60)
    mocks.mcpServerService.findByIdOrName.mockReturnValue(undefined)
    mocks.skillService.installFromMarketplaceZip.mockResolvedValue({
      folderName: 'weknora-usage',
      name: 'weknora-usage'
    })

    await marketplaceService.installPlugin(PLUGIN_ID)
    expect(mocks.assistantDataService.list).toHaveBeenCalledWith({ search: '知识助手', page: 1, limit: 50 })
    expect(mocks.assistantDataService.list).toHaveBeenCalledWith({ search: '知识助手', page: 2, limit: 50 })
    expect(mocks.assistantDataService.update).toHaveBeenCalledWith('assistant-60', { prompt: 'market prompt' })
  })
})

describe('installPlugin — MCP provenance', () => {
  beforeEach(() => {
    routeGatewayFetch()
    mockAssistantPages([[]], 0)
    mocks.skillService.installFromMarketplaceZip.mockResolvedValue({
      folderName: 'weknora-usage',
      name: 'weknora-usage'
    })
  })

  it('updates an existing row only when its registryUrl provenance matches this plugin', async () => {
    mocks.mcpServerService.findByIdOrName.mockImplementation((key: string) =>
      key === 'weknora' ? { id: 'mcp-ours', registryUrl: REGISTRY_URL } : undefined
    )
    const result = await marketplaceService.installPlugin(PLUGIN_ID)
    expect(mocks.mcpServerService.update).toHaveBeenCalledWith('mcp-ours', expect.objectContaining({ name: 'weknora' }))
    expect(mocks.mcpServerService.create).not.toHaveBeenCalled()
    expect(result.results).toContainEqual({ kind: 'mcp_server', target: 'weknora', status: 'updated' })
  })

  it('never hijacks a foreign row: the component lands under a disambiguated name', async () => {
    mocks.mcpServerService.findByIdOrName.mockImplementation((key: string) => {
      if (key === 'weknora') return { id: 'user-row', registryUrl: null }
      return undefined
    })
    mocks.mcpServerService.create.mockReturnValue({ id: 'mcp-disambiguated' })

    const result = await marketplaceService.installPlugin(PLUGIN_ID)
    expect(mocks.mcpServerService.update).not.toHaveBeenCalled()
    expect(mocks.mcpServerService.create).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'weknora [市场 p1]',
        registryUrl: REGISTRY_URL,
        installSource: 'manual',
        isActive: false
      })
    )
    expect(result.results).toContainEqual({ kind: 'mcp_server', target: 'weknora [市场 p1]', status: 'installed' })
    expect(readInstalledRecords()[0].refs.mcpIds).toEqual(['mcp-disambiguated'])
  })

  it('re-installs onto its own previous disambiguated row instead of duplicating it', async () => {
    mocks.mcpServerService.findByIdOrName.mockImplementation((key: string) => {
      if (key === 'weknora') return { id: 'user-row', registryUrl: null }
      if (key === 'weknora [市场 p1]') return { id: 'mkt-previous', registryUrl: REGISTRY_URL }
      return undefined
    })
    const result = await marketplaceService.installPlugin(PLUGIN_ID)
    expect(mocks.mcpServerService.update).toHaveBeenCalledWith(
      'mkt-previous',
      expect.objectContaining({ name: 'weknora [市场 p1]' })
    )
    expect(mocks.mcpServerService.create).not.toHaveBeenCalled()
    expect(result.results).toContainEqual({ kind: 'mcp_server', target: 'weknora [市场 p1]', status: 'updated' })
  })
})

describe('uninstallPlugin', () => {
  function seedRecord(refs: Partial<MarketInstalledRecord['refs']>, schemaVersion?: number): void {
    writeInstalledRecords([
      {
        pluginId: PLUGIN_ID,
        name: 'P1',
        version: '1.0.0',
        installedAt: 't1',
        ...(schemaVersion !== undefined ? { schemaVersion } : {}),
        refs: {
          skillFolderNames: [],
          skillSourceUrls: {},
          mcpIds: [],
          assistantIds: [],
          minappAppIds: [],
          ...refs
        }
      }
    ])
  }

  it('skips managed assistants — never deletes them — and still removes the rest', async () => {
    seedRecord({ assistantIds: ['managed-1', 'free-1'] })
    mocks.managedAssistantIds = ['managed-1']

    const result = await marketplaceService.uninstallPlugin(PLUGIN_ID)
    expect(mocks.assistantDataService.delete).toHaveBeenCalledTimes(1)
    expect(mocks.assistantDataService.delete).toHaveBeenCalledWith('free-1')
    expect(result.results).toContainEqual({
      kind: 'assistant',
      target: 'managed-1',
      status: 'skipped',
      reason: MARKET_SKIP_REASONS.managedByEnterprise
    })
    expect(result.ok).toBe(true)
    // Everything removed/skipped → the record goes away.
    expect(readInstalledRecords()).toEqual([])
  })

  it('keeps the record with failed refs pruned of successes, so a retry can finish', async () => {
    seedRecord({ skillFolderNames: ['s1'], mcpIds: ['m1', 'm2'] })
    mocks.skillService.getByFolderName.mockResolvedValue({ id: 'skill-1', source: 'marketplace', sourceUrl: null })
    mocks.mcpServerService.delete.mockImplementation((id: string) => {
      if (id === 'm2') throw new Error('sqlite busy')
    })

    const result = await marketplaceService.uninstallPlugin(PLUGIN_ID)
    expect(result.ok).toBe(false)
    expect(result.results).toContainEqual({ kind: 'skill', target: 's1', status: 'removed' })
    expect(result.results).toContainEqual({ kind: 'mcp_server', target: 'm2', status: 'failed', error: 'sqlite busy' })

    const [record] = readInstalledRecords()
    expect(record.pluginId).toBe(PLUGIN_ID)
    expect(record.refs.skillFolderNames).toEqual([])
    expect(record.refs.mcpIds).toEqual(['m2'])
  })

  it('deletes the record once every ref is removed or skipped', async () => {
    seedRecord({ minappAppIds: ['market-p1-console'] })
    const result = await marketplaceService.uninstallPlugin(PLUGIN_ID)
    expect(result.ok).toBe(true)
    expect(readInstalledRecords()).toEqual([])
  })

  it('reports skipped for refs whose row already vanished', async () => {
    seedRecord({ mcpIds: ['gone'] })
    mocks.mcpServerService.delete.mockImplementation(() => {
      throw DataApiErrorFactory.create(ErrorCode.NOT_FOUND, 'mcp server not found')
    })
    const result = await marketplaceService.uninstallPlugin(PLUGIN_ID)
    expect(result.ok).toBe(true)
    expect(result.results).toContainEqual({ kind: 'mcp_server', target: 'gone', status: 'skipped' })
    expect(readInstalledRecords()).toEqual([])
  })
})

describe('uninstallPlugin — skill origin guard', () => {
  const MARKET_SOURCE_URL = `${GATEWAY}/marketplace/api/plugins/${PLUGIN_ID}/files/payload/weknora-usage.zip`

  it('refuses to delete a marketplace skill whose sourceUrl differs from the recorded origin', async () => {
    writeInstalledRecords([
      {
        pluginId: PLUGIN_ID,
        name: 'P1',
        version: '1.0.0',
        installedAt: 't1',
        schemaVersion: 2,
        refs: {
          skillFolderNames: ['weknora-usage'],
          skillSourceUrls: { 'weknora-usage': MARKET_SOURCE_URL },
          mcpIds: [],
          assistantIds: [],
          minappAppIds: []
        }
      }
    ])
    // A public-marketplace copy took over the folder name.
    mocks.skillService.getByFolderName.mockResolvedValue({
      id: 'skill-1',
      source: 'marketplace',
      sourceUrl: 'https://skills.sh/weknora-usage'
    })

    const result = await marketplaceService.uninstallPlugin(PLUGIN_ID)
    expect(mocks.skillService.uninstall).not.toHaveBeenCalled()
    expect(result.results).toContainEqual({
      kind: 'skill',
      target: 'weknora-usage',
      status: 'skipped',
      reason: MARKET_SKIP_REASONS.foreignOrigin
    })
    expect(readInstalledRecords()).toEqual([])
  })

  it('deletes when the recorded origin matches, and falls back to source-only checks for v1 records', async () => {
    // v2 record with matching provenance.
    writeInstalledRecords([
      {
        pluginId: PLUGIN_ID,
        name: 'P1',
        version: '1.0.0',
        installedAt: 't1',
        schemaVersion: 2,
        refs: {
          skillFolderNames: ['weknora-usage'],
          skillSourceUrls: { 'weknora-usage': MARKET_SOURCE_URL },
          mcpIds: [],
          assistantIds: [],
          minappAppIds: []
        }
      }
    ])
    mocks.skillService.getByFolderName.mockResolvedValue({
      id: 'skill-1',
      source: 'marketplace',
      sourceUrl: MARKET_SOURCE_URL
    })
    const matched = await marketplaceService.uninstallPlugin(PLUGIN_ID)
    expect(mocks.skillService.uninstall).toHaveBeenCalledWith('skill-1')
    expect(matched.ok).toBe(true)

    // v1 record (no recorded provenance) keeps the legacy behavior.
    vi.clearAllMocks()
    writeInstalledRecords([
      {
        pluginId: PLUGIN_ID,
        name: 'P1',
        version: '1.0.0',
        installedAt: 't1',
        refs: {
          skillFolderNames: ['weknora-usage'],
          skillSourceUrls: {},
          mcpIds: [],
          assistantIds: [],
          minappAppIds: []
        }
      }
    ])
    mocks.skillService.getByFolderName.mockResolvedValue({ id: 'skill-1', source: 'marketplace', sourceUrl: null })
    const legacy = await marketplaceService.uninstallPlugin(PLUGIN_ID)
    expect(mocks.skillService.uninstall).toHaveBeenCalledWith('skill-1')
    expect(legacy.ok).toBe(true)
  })
})

describe('installPlugin — failure semantics', () => {
  it('throws when nothing succeeded, leaving no record behind', async () => {
    routeGatewayFetch()
    mockAssistantPages([[]], 0)
    mocks.skillService.installFromMarketplaceZip.mockRejectedValue(new Error('zip boom'))
    mocks.mcpServerService.findByIdOrName.mockReturnValue(undefined)
    mocks.mcpServerService.create.mockImplementation(() => {
      throw new Error('create boom')
    })
    mocks.assistantDataService.create.mockImplementation(() => {
      throw new Error('create boom')
    })

    await expect(marketplaceService.installPlugin(PLUGIN_ID)).rejects.toThrow('install failed: zip boom')
    expect(fs.existsSync(installedFilePath())).toBe(false)
  })

  it('stamps v2 records with skill provenance for partial installs', async () => {
    routeGatewayFetch()
    mockAssistantPages([[]], 0)
    mocks.skillService.installFromMarketplaceZip.mockRejectedValue(new Error('zip boom'))
    mocks.mcpServerService.findByIdOrName.mockReturnValue(undefined)
    mocks.mcpServerService.create.mockReturnValue({ id: 'mcp-new' })
    mocks.assistantDataService.create.mockReturnValue({ id: 'assistant-new' })

    const result = await marketplaceService.installPlugin(PLUGIN_ID)
    expect(result.ok).toBe(true)
    const [record] = readInstalledRecords()
    expect(record.schemaVersion).toBe(2)
    expect(record.refs.mcpIds).toEqual(['mcp-new'])
    expect(record.refs.skillFolderNames).toEqual([])
  })
})

describe('DataApiError not-found normalization', () => {
  it('treats DataApiError NOT_FOUND as a skip, not a failure', () => {
    const error = DataApiErrorFactory.create(ErrorCode.NOT_FOUND, 'missing')
    expect(error).toBeInstanceOf(DataApiError)
    expect(error.code).toBe(ErrorCode.NOT_FOUND)
  })
})
