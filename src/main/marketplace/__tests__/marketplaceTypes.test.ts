import { describe, expect, it } from 'vitest'

import {
  buildMarketMinAppId,
  buildPluginFileUrl,
  buildPluginRegistryUrl,
  emptyMarketRefs,
  installedRecordFileSchema,
  isMarketplacePluginId,
  marketRefsIsEmpty,
  marketplaceCatalogResponseSchema,
  marketplaceManifestSchema,
  mergeInstalledRecord,
  parseCatalogResponse,
  parseMarketplaceManifest,
  removeInstalledRecord,
  resolveCatalogIconUrl,
  unionMarketRefs
} from '../types'

const validManifest = {
  id: 'weknora-toolkit',
  name: 'WeKnora 工具包',
  version: '1.0.0',
  description: 'demo',
  category: 'knowledge',
  icon: 'icon.png',
  skills: [{ name: 'weknora-usage', zip: 'payload/weknora-usage.zip', description: 'how-to' }],
  mcp_servers: [{ name: 'weknora', type: 'sse', base_url: 'http://10.0.0.1:8080' }],
  assistants: [{ name: '知识助手', prompt: 'p', emoji: '✨' }],
  minapps: [{ id: 'console', name: 'Console', url: 'https://console.example.com' }]
}

describe('marketplaceManifestSchema', () => {
  it('accepts a full plugin manifest', () => {
    const parsed = marketplaceManifestSchema.safeParse(validManifest)
    expect(parsed.success).toBe(true)
    if (parsed.success) {
      expect(parsed.data.skills).toHaveLength(1)
      expect(parsed.data.mcp_servers[0].type).toBe('sse')
    }
  })

  it('coerces a summary-only manifest (components default to empty arrays)', () => {
    const parsed = marketplaceManifestSchema.safeParse({
      id: 'minimal',
      name: 'Minimal',
      components: { skills: 0, mcp_servers: 0, assistants: 0, minapps: 0 }
    })
    expect(parsed.success).toBe(true)
    if (parsed.success) {
      expect(parsed.data.skills).toEqual([])
      expect(parsed.data.mcp_servers).toEqual([])
      expect(parsed.data.assistants).toEqual([])
      expect(parsed.data.minapps).toEqual([])
    }
  })

  it('rejects a manifest whose id breaks the plugin id whitelist', () => {
    expect(marketplaceManifestSchema.safeParse({ ...validManifest, id: '../escape' }).success).toBe(false)
  })

  it('rejects a manifest with no name', () => {
    expect(marketplaceManifestSchema.safeParse({ ...validManifest, name: '' }).success).toBe(false)
  })

  it('rejects an mcp_server whose type is outside the enum', () => {
    expect(
      marketplaceManifestSchema.safeParse({ ...validManifest, mcp_servers: [{ name: 'x', type: 'grpc' }] }).success
    ).toBe(false)
  })
})

describe('marketplaceCatalogResponseSchema', () => {
  it('accepts a catalog of summary cards and warnings', () => {
    const parsed = parseCatalogResponse({
      plugins: [
        {
          id: 'a',
          name: 'A',
          version: '1.0.0',
          description: '',
          category: 'other',
          icon: '',
          components: { skills: 1, mcp_servers: 0, assistants: 2, minapps: 0 }
        }
      ],
      warnings: ['b/plugin.json invalid']
    })
    expect(parsed).not.toBeNull()
    expect(parsed?.source).toBe('gateway')
    expect(parsed?.plugins[0].components.assistants).toBe(2)
  })

  it('returns null for a payload without plugins', () => {
    expect(parseCatalogResponse({ nope: true })).toBeNull()
  })

  it('returns null for a negative component count', () => {
    expect(
      marketplaceCatalogResponseSchema.safeParse({
        plugins: [{ id: 'a', name: 'A', components: { skills: -1, mcp_servers: 0, assistants: 0, minapps: 0 } }]
      }).success
    ).toBe(false)
  })
})

describe('url builders', () => {
  it('builds plugin file urls without double-encoding the path separators', () => {
    expect(buildPluginFileUrl('http://g:8787', 'p1', 'payload/skill.zip')).toBe(
      'http://g:8787/marketplace/api/plugins/p1/files/payload/skill.zip'
    )
  })

  it('builds the registry (provenance) url', () => {
    expect(buildPluginRegistryUrl('http://g:8787', 'p1')).toBe('http://g:8787/marketplace/api/plugins/p1')
  })

  it('resolves absolute http icons as-is and gateway-relative icons through the files endpoint', () => {
    expect(resolveCatalogIconUrl('http://g:8787', { id: 'p1', icon: 'https://cdn.example.com/i.png' })).toBe(
      'https://cdn.example.com/i.png'
    )
    expect(resolveCatalogIconUrl('http://g:8787', { id: 'p1', icon: 'icon.png' })).toBe(
      'http://g:8787/marketplace/api/plugins/p1/files/icon.png'
    )
    expect(resolveCatalogIconUrl('http://g:8787', { id: 'p1', icon: '' })).toBe('')
  })
})

describe('buildMarketMinAppId', () => {
  it('prefixes market- and keeps the mini app appId charset', () => {
    expect(buildMarketMinAppId('weknora-toolkit', 'console')).toBe('market-weknora-toolkit-console')
  })

  it('sanitizes illegal characters in either part', () => {
    expect(buildMarketMinAppId('a.b/c', 'd:e')).toBe('market-a_b_c-d_e')
  })

  it('caps each part so the result stays a valid appId', () => {
    const appId = buildMarketMinAppId('x'.repeat(200), 'y'.repeat(200))
    expect(appId).toMatch(/^[A-Za-z0-9_-]+$/)
    expect(appId.length).toBeLessThan(200)
  })
})

describe('installed record merge', () => {
  const baseRefs = emptyMarketRefs()

  it('appends a record for a new plugin', () => {
    const next = { pluginId: 'p1', name: 'P1', version: '1.0.0', installedAt: 't1', refs: { ...baseRefs } }
    expect(mergeInstalledRecord([], next)).toEqual([next])
  })

  it('replaces in place and unions refs on reinstall', () => {
    const existing = {
      pluginId: 'p1',
      name: 'P1',
      version: '1.0.0',
      installedAt: 'old',
      refs: { skillFolderNames: ['s1'], mcpIds: ['m1'], assistantIds: [], minappAppIds: [] }
    }
    const next = {
      pluginId: 'p1',
      name: 'P1',
      version: '1.1.0',
      installedAt: 'new',
      refs: { skillFolderNames: ['s2'], mcpIds: ['m1'], assistantIds: ['a1'], minappAppIds: [] }
    }
    const merged = mergeInstalledRecord([existing], next)
    expect(merged).toHaveLength(1)
    expect(merged[0].version).toBe('1.1.0')
    // Reinstall refreshes the install timestamp.
    expect(merged[0].installedAt).toBe('new')
    expect(merged[0].refs.skillFolderNames).toEqual(['s1', 's2'])
    expect(merged[0].refs.mcpIds).toEqual(['m1'])
    expect(merged[0].refs.assistantIds).toEqual(['a1'])
  })

  it('dedupes refs so a partial reinstall never duplicates entries', () => {
    const a = { skillFolderNames: ['s1'], mcpIds: [], assistantIds: [], minappAppIds: [] }
    const b = { skillFolderNames: ['s1', 's2'], mcpIds: [], assistantIds: [], minappAppIds: [] }
    expect(unionMarketRefs(a, b).skillFolderNames).toEqual(['s1', 's2'])
  })

  it('reports emptiness only when every ref list is empty', () => {
    expect(marketRefsIsEmpty(baseRefs)).toBe(true)
    expect(marketRefsIsEmpty({ ...baseRefs, mcpIds: ['m1'] })).toBe(false)
  })

  it('removes only the matching plugin record', () => {
    const records = [
      { pluginId: 'p1', name: '', version: '', installedAt: '', refs: baseRefs },
      { pluginId: 'p2', name: '', version: '', installedAt: '', refs: baseRefs }
    ]
    const next = removeInstalledRecord(records, 'p1')
    expect(next.map((record) => record.pluginId)).toEqual(['p2'])
    expect(removeInstalledRecord(records, 'missing')).toHaveLength(2)
  })

  it('tolerates a legacy file missing optional fields via the schema defaults', () => {
    const parsed = installedRecordFileSchema.safeParse([
      { pluginId: 'p1', refs: { skillFolderNames: ['s1'], mcpIds: [], assistantIds: [], minappAppIds: [] } }
    ])
    expect(parsed.success).toBe(true)
    if (parsed.success) {
      expect(parsed.data[0].name).toBe('')
      expect(parsed.data[0].version).toBe('')
    }
  })
})

describe('isMarketplacePluginId', () => {
  it('accepts gateway directory names and rejects traversal', () => {
    expect(isMarketplacePluginId('weknora-toolkit_1')).toBe(true)
    expect(isMarketplacePluginId('../etc')).toBe(false)
    expect(isMarketplacePluginId('a b')).toBe(false)
    expect(isMarketplacePluginId('')).toBe(false)
  })
})

describe('parseMarketplaceManifest', () => {
  it('returns null for non-object payloads', () => {
    expect(parseMarketplaceManifest(null)).toBeNull()
    expect(parseMarketplaceManifest('nope')).toBeNull()
  })

  it('parses a valid manifest', () => {
    expect(parseMarketplaceManifest(validManifest)?.id).toBe('weknora-toolkit')
  })
})
