/**
 * Marketplace types + pure helpers (E5).
 *
 * Everything here is pure: no Electron, no `@application`, no services — so
 * the manifest validation, URL building, and installed-record merge logic are
 * unit-testable without mocks. The gateway contract mirrors
 * `gateway/marketplace.py` (see the E5 plan): `GET /marketplace/api/catalog`
 * returns summary cards, `GET /marketplace/api/plugins/{id}` returns the full
 * manifest, and files (skill zips / icons) are served from
 * `/marketplace/api/plugins/{id}/files/{path}`.
 */

import * as z from 'zod'

import {
  type MarketCatalogPlugin,
  type MarketCatalogResult,
  type MarketInstalledRecord,
  type MarketInstalledRefs,
  type MarketPluginManifest,
  MARKETPLACE_PLUGIN_ID_REGEX
} from '@shared/types/marketplace'

// ---------------------------------------------------------------------------
// Zod schemas — gateway payloads are untrusted input
// ---------------------------------------------------------------------------

const pluginIdSchema = z.string().regex(MARKETPLACE_PLUGIN_ID_REGEX)

const catalogComponentsSchema = z.object({
  skills: z.number().int().nonnegative(),
  mcp_servers: z.number().int().nonnegative(),
  assistants: z.number().int().nonnegative(),
  minapps: z.number().int().nonnegative()
})

const catalogPluginSchema = z.object({
  id: pluginIdSchema,
  name: z.string().min(1),
  version: z.string().catch(''),
  description: z.string().catch(''),
  category: z.string().catch(''),
  featured: z.boolean().catch(false),
  icon: z.string().catch(''),
  components: catalogComponentsSchema
})

export const marketplaceCatalogResponseSchema = z.object({
  // Required: the gateway always sends the array, so a missing one means the
  // payload is not a marketplace response (parse failure → source 'error')
  // rather than a legitimately empty catalog.
  plugins: z.array(catalogPluginSchema),
  warnings: z.array(z.string()).catch([])
})

const manifestSkillSchema = z.object({
  name: z.string().min(1),
  zip: z.string().min(1),
  description: z.string().optional()
})

const manifestMcpServerSchema = z.object({
  name: z.string().min(1),
  type: z.enum(['sse', 'streamableHttp', 'stdio']),
  base_url: z.string().optional(),
  headers: z.record(z.string(), z.string()).optional(),
  command: z.string().optional(),
  args: z.array(z.string()).optional(),
  env: z.record(z.string(), z.string()).optional(),
  description: z.string().optional()
})

const manifestAssistantSchema = z.object({
  name: z.string().min(1),
  prompt: z.string().optional(),
  emoji: z.string().optional(),
  description: z.string().optional()
})

const manifestMinappSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  url: z.string().min(1)
})

export const marketplaceManifestSchema = z.object({
  id: pluginIdSchema,
  name: z.string().min(1),
  version: z.string().catch(''),
  description: z.string().catch(''),
  category: z.string().catch(''),
  icon: z.string().catch(''),
  // Component arrays are strict on purpose: the manifest drives installs, so a
  // malformed entry must fail the parse (and abort the install) instead of
  // being silently dropped — the install record would otherwise omit
  // components the user believes were installed.
  skills: z.array(manifestSkillSchema).default([]),
  mcp_servers: z.array(manifestMcpServerSchema).default([]),
  assistants: z.array(manifestAssistantSchema).default([]),
  minapps: z.array(manifestMinappSchema).default([])
})

const installedRefsSchema = z.object({
  skillFolderNames: z.array(z.string()).catch([]),
  mcpIds: z.array(z.string()).catch([]),
  assistantIds: z.array(z.string()).catch([]),
  minappAppIds: z.array(z.string()).catch([])
})

export const installedRecordSchema = z.object({
  pluginId: pluginIdSchema,
  name: z.string().default(''),
  version: z.string().catch(''),
  installedAt: z.string().catch(''),
  refs: installedRefsSchema
})

export const installedRecordFileSchema = z.array(installedRecordSchema)

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

export function isMarketplacePluginId(id: string): boolean {
  return MARKETPLACE_PLUGIN_ID_REGEX.test(id)
}

/** Validate a raw catalog payload; returns null when the payload is not usable. */
export function parseCatalogResponse(raw: unknown): MarketCatalogResult | null {
  const parsed = marketplaceCatalogResponseSchema.safeParse(raw)
  if (!parsed.success) return null
  return { source: 'gateway', plugins: parsed.data.plugins, warnings: parsed.data.warnings }
}

/** Validate a raw plugin manifest; returns null when the payload is not a usable plugin. */
export function parseMarketplaceManifest(raw: unknown): MarketPluginManifest | null {
  const parsed = marketplaceManifestSchema.safeParse(raw)
  if (!parsed.success) return null
  return parsed.data
}

/** URL of a file inside a plugin directory (skill zips, icons) on the gateway. */
export function buildPluginFileUrl(serverUrl: string, pluginId: string, filePath: string): string {
  return `${serverUrl}/marketplace/api/plugins/${encodeURIComponent(pluginId)}/files/${encodeURI(filePath)}`
}

/** Provenance URL recorded for a plugin's components (the detail endpoint). */
export function buildPluginRegistryUrl(serverUrl: string, pluginId: string): string {
  return `${serverUrl}/marketplace/api/plugins/${encodeURIComponent(pluginId)}`
}

/**
 * Resolve a catalog icon to a loadable URL: absolute http(s) passes through,
 * anything else (gateway-relative path) goes through the files endpoint.
 */
export function resolveCatalogIconUrl(serverUrl: string, plugin: Pick<MarketCatalogPlugin, 'id' | 'icon'>): string {
  if (!plugin.icon) return ''
  if (/^https?:\/\//i.test(plugin.icon)) return plugin.icon
  return buildPluginFileUrl(serverUrl, plugin.id, plugin.icon)
}

/**
 * Mini app appId for a marketplace component: `market-<pluginId>-<id>`.
 * Both parts are sanitized to the `mini_app` appId charset
 * (`^[A-Za-z0-9_-]+$`), so arbitrary manifest ids stay installable.
 */
export function buildMarketMinAppId(pluginId: string, entryId: string): string {
  const sanitize = (value: string) => value.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 64)
  return `market-${sanitize(pluginId)}-${sanitize(entryId)}`
}

export function emptyMarketRefs(): MarketInstalledRefs {
  return { skillFolderNames: [], mcpIds: [], assistantIds: [], minappAppIds: [] }
}

/** Union of two ref sets, order-stable (first occurrence wins). */
export function unionMarketRefs(a: MarketInstalledRefs, b: MarketInstalledRefs): MarketInstalledRefs {
  return {
    skillFolderNames: [...new Set([...a.skillFolderNames, ...b.skillFolderNames])],
    mcpIds: [...new Set([...a.mcpIds, ...b.mcpIds])],
    assistantIds: [...new Set([...a.assistantIds, ...b.assistantIds])],
    minappAppIds: [...new Set([...a.minappAppIds, ...b.minappAppIds])]
  }
}

export function marketRefsIsEmpty(refs: MarketInstalledRefs): boolean {
  return (
    refs.skillFolderNames.length === 0 &&
    refs.mcpIds.length === 0 &&
    refs.assistantIds.length === 0 &&
    refs.minappAppIds.length === 0
  )
}

/**
 * Idempotently merge a fresh install record into the persisted list: the
 * entry with the same pluginId is replaced in place, with refs UNIONed so a
 * partially-failed reinstall never orphans a previously installed component.
 */
export function mergeInstalledRecord(
  records: MarketInstalledRecord[],
  next: MarketInstalledRecord
): MarketInstalledRecord[] {
  const existingIndex = records.findIndex((record) => record.pluginId === next.pluginId)
  if (existingIndex === -1) return [...records, next]
  const existing = records[existingIndex]
  const merged: MarketInstalledRecord = {
    ...next,
    installedAt: next.installedAt || existing.installedAt,
    refs: unionMarketRefs(existing.refs, next.refs)
  }
  return records.map((record, index) => (index === existingIndex ? merged : record))
}

/** Remove a plugin's install record; returns the list unchanged when absent. */
export function removeInstalledRecord(records: MarketInstalledRecord[], pluginId: string): MarketInstalledRecord[] {
  return records.filter((record) => record.pluginId !== pluginId)
}
