/**
 * Marketplace (E5) — shared DTOs for the enterprise-gateway plugin market.
 *
 * The enterprise gateway is the official market source: admins curate plugin
 * packages (`plugin.json` + payload zips) and the client browses/installs over
 * `/marketplace/api/*`. Components land in the app's existing per-type stores
 * (skills / MCP servers / assistants / mini apps); the plugin-level install
 * record lives client-side in `{userData}/Data/marketplace/installed.json`.
 */

/** Plugin ids are gateway directory names — same whitelist the gateway enforces. */
export const MARKETPLACE_PLUGIN_ID_REGEX = /^[A-Za-z0-9_-]+$/

/** Where the catalog came from — `none` = enterprise disabled, no source to ask. */
export type MarketCatalogSource = 'gateway' | 'none' | 'error'

/** One catalog card (gateway `_summary` shape): scalar fields + per-type component counts. */
export interface MarketCatalogPlugin {
  id: string
  name: string
  version: string
  description: string
  category: string
  /** Admin-curated recommendation — rendered in the 推荐 section. */
  featured: boolean
  icon: string
  /** Absolute URL the renderer can load directly (relative `icon` resolved against the gateway). */
  iconUrl?: string
  components: {
    skills: number
    mcp_servers: number
    assistants: number
    minapps: number
  }
}

export interface MarketCatalogResult {
  source: MarketCatalogSource
  plugins: MarketCatalogPlugin[]
  /** Gateway scan warnings (invalid plugin dirs skipped server-side). */
  warnings: string[]
  /** Populated when source is 'error' — the fetch/parse failure message. */
  error?: string
}

// ---------------------------------------------------------------------------
// Plugin manifest (gateway plugin.json) — detail endpoint payload
// ---------------------------------------------------------------------------

export interface MarketManifestSkill {
  name: string
  /** Zip path relative to the plugin directory (served by the files endpoint). */
  zip: string
  description?: string
}

export interface MarketManifestMcpServer {
  name: string
  type: 'sse' | 'streamableHttp' | 'stdio'
  base_url?: string
  headers?: Record<string, string>
  command?: string
  args?: string[]
  env?: Record<string, string>
  description?: string
}

export interface MarketManifestAssistant {
  name: string
  prompt?: string
  emoji?: string
  description?: string
}

export interface MarketManifestMinapp {
  id: string
  name: string
  url: string
}

export interface MarketPluginManifest {
  id: string
  name: string
  version: string
  description: string
  category: string
  icon: string
  /** Absolute URL the renderer can load directly (relative `icon` resolved against the gateway). */
  iconUrl?: string
  skills: MarketManifestSkill[]
  mcp_servers: MarketManifestMcpServer[]
  assistants: MarketManifestAssistant[]
  minapps: MarketManifestMinapp[]
}

// ---------------------------------------------------------------------------
// Install / uninstall results
// ---------------------------------------------------------------------------

export type MarketComponentKind = 'skill' | 'mcp_server' | 'assistant' | 'minapp'

export type MarketComponentStatus = 'installed' | 'updated' | 'removed' | 'skipped' | 'failed'

export interface MarketComponentResult {
  kind: MarketComponentKind
  /** Skill name / MCP name / assistant name / minapp appId. */
  target: string
  status: MarketComponentStatus
  /** Populated when status is 'failed'. */
  error?: string
}

export interface MarketInstallResult {
  pluginId: string
  name: string
  version: string
  results: MarketComponentResult[]
  /** True when at least one component landed and the record was persisted. */
  ok: boolean
}

export interface MarketUninstallResult {
  pluginId: string
  results: MarketComponentResult[]
  ok: boolean
}

// ---------------------------------------------------------------------------
// Installed record (persisted to `{userData}/Data/marketplace/installed.json`)
// ---------------------------------------------------------------------------

export interface MarketInstalledRefs {
  skillFolderNames: string[]
  mcpIds: string[]
  assistantIds: string[]
  minappAppIds: string[]
}

export interface MarketInstalledRecord {
  pluginId: string
  /** Manifest name snapshot so the installed list renders without the catalog. */
  name: string
  version: string
  installedAt: string
  refs: MarketInstalledRefs
}
