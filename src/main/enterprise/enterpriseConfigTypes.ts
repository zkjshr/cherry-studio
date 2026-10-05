/**
 * Enterprise client config contract — the JSON body served by the gateway's
 * `GET /api/client/config` (with `config_version` stamped on top by the
 * server). See docs/superpowers/plans/2026-10-03-e1-enterprise-config-pipeline.md
 * (Task 1) for the serving side.
 *
 * Validation is deliberately structural and lenient: unknown extra keys are
 * preserved for future topics (E2+), while the sections E1 consumes are
 * shape-checked so a broken publish fails loudly instead of half-applying.
 */

/** Model entry under a provider. */
export interface EnterpriseProviderModelConfig {
  /** Raw API model id (sent to the upstream gateway as `model`). */
  id: string
  name?: string
  is_enabled?: boolean
}

export interface EnterpriseProviderConfig {
  /** Logical provider id — forced under the `enterprise-` namespace on apply. */
  id: string
  name?: string
  /** Upstream base URL (typically the enterprise gateway's /v1 proxy). */
  base_url?: string
  /** Gateway token — NEVER a real upstream API key (those live server-side only). */
  api_key?: string
  models?: EnterpriseProviderModelConfig[]
}

/** Default-model references. `topic_naming` has no dedicated key — the quick model carries it. */
export interface EnterpriseDefaultModelsConfig {
  assistant?: string
  translate?: string
  quick_model?: string
}

export interface EnterpriseAssistantConfig {
  name: string
  prompt?: string
  emoji?: string
  description?: string
  /** Model reference (`{providerId}/{modelId}` or `{providerId}::{modelId}`). */
  model?: string
  settings?: Record<string, unknown>
  /** Logical MCP server names (resolved against `mcp_servers[]` names on apply). */
  mcp_server_ids?: string[]
  /** E1 applies only; the no-edit guard for managed assistants lands in E2. */
  managed?: boolean
}

export interface EnterpriseMcpServerConfig {
  name: string
  type?: 'stdio' | 'sse' | 'streamableHttp' | 'inMemory'
  base_url?: string
  /** HTTP headers (e.g. auth tokens) persisted to the mcp_server headers column. */
  headers?: Record<string, string>
  is_active?: boolean
}

export interface EnterpriseMinappConfig {
  /** Logical id — stored as the sanitized appId `enterprise-{id}`. */
  id: string
  name?: string
  url: string
}

export interface EnterpriseClientConfig {
  config_version: number
  providers?: EnterpriseProviderConfig[]
  default_models?: EnterpriseDefaultModelsConfig
  assistants?: EnterpriseAssistantConfig[]
  mcp_servers?: EnterpriseMcpServerConfig[]
  minapps?: EnterpriseMinappConfig[]
  /** Knowledge-base entries — stored verbatim for E3 (WeKnora MCP) consumption. */
  kb_entries?: unknown
  /**
   * Little World (小世界) service URL. Optional top-level key: the gateway only
   * emits it when the admin configured a non-empty `world_url`; a dropped key
   * means "not deployed" and hides the client entry point.
   */
  world_url?: string
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function asStringArray(value: unknown): string[] | undefined {
  if (value === undefined) return undefined
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw new Error('expected an array of strings')
  }
  return value
}

function asOptionalObject(value: unknown, label: string): Record<string, unknown> | undefined {
  if (value === undefined) return undefined
  const record = asRecord(value)
  if (!record) throw new Error(`${label} must be an object`)
  return record
}

/**
 * Strict header map: every value must be a string — header rows feed straight
 * into HTTP requests, so a numeric/boolean value is a publish mistake that
 * should fail validation, not be coerced.
 */
function asOptionalHeaders(value: unknown, label: string): Record<string, string> | undefined {
  if (value === undefined) return undefined
  const record = asOptionalObject(value, label)
  if (!record) return undefined
  for (const [key, headerValue] of Object.entries(record)) {
    if (typeof headerValue !== 'string') throw new Error(`${label}.${key} must be a string`)
  }
  return record as Record<string, string>
}

function asArraySection(value: unknown, label: string): Record<string, unknown>[] {
  if (value === undefined) return []
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`)
  return value.map((item, index) => {
    const record = asRecord(item)
    if (!record) throw new Error(`${label}[${index}] must be an object`)
    return record
  })
}

/**
 * Validate the top-level `world_url`. Present-but-empty is normalized to
 * `undefined` (same semantics as a dropped key: not deployed); a non-empty
 * value must be an http(s) URL because it is loaded into a webview and used
 * as a heartbeat base URL. Returns `undefined` when the key is absent/empty.
 */
export function toEnterpriseWorldUrl(value: unknown): string | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'string') throw new Error('world_url must be a string')
  const trimmed = value.trim()
  if (!trimmed) return undefined
  if (!/^https?:\/\//.test(trimmed)) throw new Error('world_url must be an http(s) URL')
  return trimmed.replace(/\/+$/, '')
}

/**
 * Validate a fetched/cached payload into {@link EnterpriseClientConfig}.
 * Throws with an actionable message when the payload is not a usable config —
 * the caller records `lastError` and keeps the previous state.
 */
export function validateEnterpriseConfigPayload(payload: unknown): EnterpriseClientConfig {
  const root = asRecord(payload)
  if (!root) throw new Error('enterprise config payload must be a JSON object')

  const configVersion = root.config_version
  if (typeof configVersion !== 'number' || !Number.isFinite(configVersion) || configVersion < 1) {
    throw new Error('enterprise config payload is missing a numeric config_version >= 1')
  }

  const defaultModels = asOptionalObject(root.default_models, 'default_models')
  const defaultModelsConfig: EnterpriseDefaultModelsConfig = {}
  if (defaultModels) {
    for (const key of ['assistant', 'translate', 'quick_model'] as const) {
      const value = defaultModels[key]
      if (value !== undefined) {
        if (typeof value !== 'string' || !value.trim())
          throw new Error(`default_models.${key} must be a non-empty string`)
        defaultModelsConfig[key] = value
      }
    }
  }

  const providers = asArraySection(root.providers, 'providers').map((item, index) => {
    if (typeof item.id !== 'string' || !item.id.trim())
      throw new Error(`providers[${index}].id must be a non-empty string`)
    const models = asArraySection(item.models, `providers[${index}].models`).map((model, modelIndex) => {
      if (typeof model.id !== 'string' || !model.id.trim()) {
        throw new Error(`providers[${index}].models[${modelIndex}].id must be a non-empty string`)
      }
      return {
        id: model.id,
        ...(typeof model.name === 'string' ? { name: model.name } : {}),
        ...(typeof model.is_enabled === 'boolean' ? { is_enabled: model.is_enabled } : {})
      } satisfies EnterpriseProviderModelConfig
    })
    return {
      id: item.id,
      ...(typeof item.name === 'string' ? { name: item.name } : {}),
      ...(typeof item.base_url === 'string' ? { base_url: item.base_url } : {}),
      ...(typeof item.api_key === 'string' ? { api_key: item.api_key } : {}),
      ...(models.length > 0 ? { models } : {})
    } satisfies EnterpriseProviderConfig
  })

  const assistants = asArraySection(root.assistants, 'assistants').map((item, index) => {
    if (typeof item.name !== 'string' || !item.name.trim()) {
      throw new Error(`assistants[${index}].name must be a non-empty string`)
    }
    const settings = asOptionalObject(item.settings, `assistants[${index}].settings`)
    const mcpServerIds = asStringArray(item.mcp_server_ids)
    return {
      name: item.name,
      ...(typeof item.prompt === 'string' ? { prompt: item.prompt } : {}),
      ...(typeof item.emoji === 'string' ? { emoji: item.emoji } : {}),
      ...(typeof item.description === 'string' ? { description: item.description } : {}),
      ...(typeof item.model === 'string' ? { model: item.model } : {}),
      ...(settings ? { settings } : {}),
      ...(mcpServerIds ? { mcp_server_ids: mcpServerIds } : {}),
      ...(typeof item.managed === 'boolean' ? { managed: item.managed } : {})
    } satisfies EnterpriseAssistantConfig
  })

  const mcpServers = asArraySection(root.mcp_servers, 'mcp_servers').map((item, index) => {
    if (typeof item.name !== 'string' || !item.name.trim()) {
      throw new Error(`mcp_servers[${index}].name must be a non-empty string`)
    }
    const headers = asOptionalHeaders(item.headers, `mcp_servers[${index}].headers`)
    return {
      name: item.name,
      ...(typeof item.type === 'string' ? { type: item.type as EnterpriseMcpServerConfig['type'] } : {}),
      ...(typeof item.base_url === 'string' ? { base_url: item.base_url } : {}),
      ...(headers ? { headers } : {}),
      ...(typeof item.is_active === 'boolean' ? { is_active: item.is_active } : {})
    } satisfies EnterpriseMcpServerConfig
  })

  const minapps = asArraySection(root.minapps, 'minapps').map((item, index) => {
    if (typeof item.id !== 'string' || !item.id.trim())
      throw new Error(`minapps[${index}].id must be a non-empty string`)
    if (typeof item.url !== 'string' || !item.url.trim()) {
      throw new Error(`minapps[${index}].url must be a non-empty string`)
    }
    return {
      id: item.id,
      ...(typeof item.name === 'string' ? { name: item.name } : {}),
      url: item.url
    } satisfies EnterpriseMinappConfig
  })

  return {
    config_version: configVersion,
    ...(providers.length > 0 ? { providers } : {}),
    ...(Object.keys(defaultModelsConfig).length > 0 ? { default_models: defaultModelsConfig } : {}),
    ...(assistants.length > 0 ? { assistants } : {}),
    ...(mcpServers.length > 0 ? { mcp_servers: mcpServers } : {}),
    ...(minapps.length > 0 ? { minapps } : {}),
    ...(root.kb_entries !== undefined ? { kb_entries: root.kb_entries } : {}),
    ...(toEnterpriseWorldUrl(root.world_url) !== undefined ? { world_url: toEnterpriseWorldUrl(root.world_url) } : {})
  }
}
