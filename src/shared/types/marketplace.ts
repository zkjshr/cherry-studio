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
  /**
   * Optional presentation fields — the gateway serves `plugin.json` as-is on
   * the detail endpoint, so any of these may be present. All optional; the
   * detail header renders each only when populated.
   */
  author?: string
  /** Plugin homepage (absolute URL) — rendered as an external-link chip. */
  homepage?: string
  /** Source repository (absolute URL) — rendered as an external-link chip. */
  repository?: string
  /** Free-form tags from the manifest, rendered next to the category tag. */
  keywords?: string[]
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

/**
 * Stable (non-localized) reason strings for `status: 'skipped'` outcomes —
 * renderers may map them to localized copy; the strings themselves are the
 * contract.
 */
export const MARKET_SKIP_REASONS = {
  /** The target row is enterprise-managed (read-only for the user): never updated, never archived. */
  managedByEnterprise: 'managed by enterprise',
  /** The folder exists but belongs to a different origin (e.g. a public-marketplace copy). */
  foreignOrigin: 'owned by a different install source'
} as const

export interface MarketComponentResult {
  kind: MarketComponentKind
  /** Skill name / MCP name / assistant name / minapp appId. */
  target: string
  status: MarketComponentStatus
  /** Populated when status is 'failed'. */
  error?: string
  /** Populated when status is 'skipped' — one of {@link MARKET_SKIP_REASONS}. */
  reason?: string
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
  /**
   * Provenance per skill folder (v2 records): the gateway file URL the skill
   * was installed from, keyed by folder name. Uninstall compares it against
   * the live skill's `sourceUrl` so a same-named folder from a different
   * origin (e.g. a public-marketplace copy) is never deleted. Absent in v1
   * records — those fall back to source-only ownership checks.
   */
  skillSourceUrls: Record<string, string>
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
  /**
   * On-disk record layout version. 1 = the E5 v1 shape (no `skillSourceUrls`),
   * 2 = adds `skillSourceUrls`. Parsing stays tolerant either way.
   */
  schemaVersion?: number
}

/** Current {@link MarketInstalledRecord.schemaVersion} written by this build. */
export const MARKET_INSTALLED_RECORD_SCHEMA_VERSION = 2
