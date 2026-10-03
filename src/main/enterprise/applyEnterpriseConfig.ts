/**
 * Enterprise config applier — maps a fetched enterprise config onto the local
 * SQLite data via the main-process data services.
 *
 * Contract (E1):
 * - Idempotent and re-entrant: every section converges to the config's state,
 *   so a repeated apply (same version re-sent, or cache re-applied after a
 *   sync failure) produces no duplicate rows and no spurious diffs.
 * - Fail fast: a single service call throwing aborts the whole apply; the
 *   sync service records `lastError` and the cache (already on disk) is
 *   retried on the next boot.
 *
 * Apply order respects foreign keys: providers+models first, then default
 * models, then MCP servers (assistants reference their ids), then assistants,
 * minapps, and finally the raw `kb_entries` preference row.
 */

import { and, eq } from 'drizzle-orm'
import { v4 as uuidv4 } from 'uuid'

import { ENDPOINT_TYPE } from '@cherrystudio/provider-registry'
import { application } from '@application'
import { preferenceTable } from '@data/db/schemas/preference'
import { assistantDataService } from '@data/services/AssistantService'
import { mcpServerService } from '@data/services/McpServerService'
import { miniAppService } from '@data/services/MiniAppService'
import { modelService } from '@data/services/ModelService'
import { providerService } from '@data/services/ProviderService'
import { loggerService } from '@logger'
import { DataApiError, ErrorCode } from '@shared/data/api/errors'
import type { CreateModelDto } from '@shared/data/api/schemas/models'
import { DEFAULT_ASSISTANT_SETTINGS, type Assistant, type AssistantSettings } from '@shared/data/types/assistant'
import type { UniqueModelId } from '@shared/data/types/model'
import { createUniqueModelId } from '@shared/data/types/model'
import type { MiniApp } from '@shared/data/types/miniApp'
import type { McpServerType } from '@shared/data/types/mcpServer'

import type {
  EnterpriseAssistantConfig,
  EnterpriseClientConfig,
  EnterpriseProviderConfig
} from './enterpriseConfigTypes'
import {
  computeModelReconcileDiff,
  sanitizeEnterpriseAppId,
  toEnterpriseUniqueModelId,
  withEnterpriseMcpNamePrefix,
  withEnterprisePrefix
} from './enterpriseMappers'

const logger = loggerService.withContext('EnterpriseConfigApplier')

const KB_ENTRIES_PREFERENCE_SCOPE = 'default'
const KB_ENTRIES_PREFERENCE_KEY = 'enterprise.kb_entries'
const ASSISTANT_LIST_PAGE_SIZE = 500

export interface ApplyEnterpriseConfigResult {
  providersApplied: number
  modelsAdded: number
  modelsRemoved: number
  defaultModelsSet: number
  mcpServersApplied: number
  assistantsApplied: number
  minappsApplied: number
  kbEntriesStored: boolean
}

/**
 * Apply a validated enterprise config. Throws on the first section failure —
 * callers (`EnterpriseConfigService`) own the error recording.
 */
export async function applyEnterpriseConfig(config: EnterpriseClientConfig): Promise<ApplyEnterpriseConfigResult> {
  const result: ApplyEnterpriseConfigResult = {
    providersApplied: 0,
    modelsAdded: 0,
    modelsRemoved: 0,
    defaultModelsSet: 0,
    mcpServersApplied: 0,
    assistantsApplied: 0,
    minappsApplied: 0,
    kbEntriesStored: false
  }

  await applyProvidersAndModels(config, result)
  await applyDefaultModels(config, result)
  await applyMcpServers(config, result)
  await applyAssistants(config, result)
  await applyMinapps(config, result)
  await applyKbEntries(config, result)

  logger.info('Enterprise config applied', { configVersion: config.config_version, ...result })
  return result
}

// ─────────────────────────────────────────────────────────────────────────────
// Providers + models
// ─────────────────────────────────────────────────────────────────────────────

async function applyProvidersAndModels(
  config: EnterpriseClientConfig,
  result: ApplyEnterpriseConfigResult
): Promise<void> {
  for (const item of config.providers ?? []) {
    applyProviderAndModels(item)
    result.providersApplied++
  }
}

function applyProviderAndModels(item: EnterpriseProviderConfig): void {
  const rawId = item.id.trim()
  const providerId = withEnterprisePrefix(rawId)
  if (rawId.length === 0) {
    throw new Error('enterprise provider id is empty after normalization')
  }

  const endpointConfigs = item.base_url
    ? { [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]: { baseUrl: item.base_url } }
    : undefined

  if (!providerService.isAvailableByProviderId(providerId)) {
    providerService.create({
      providerId,
      name: item.name ?? item.id,
      ...(endpointConfigs ? { endpointConfigs } : {}),
      defaultChatEndpoint: ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS
    })
    // `create` persists rows disabled by design (user opts in via the UI);
    // an enterprise-managed provider must serve requests immediately.
    providerService.update(providerId, { isEnabled: true })
  } else if (endpointConfigs) {
    providerService.update(providerId, { endpointConfigs, isEnabled: true })
  } else {
    providerService.update(providerId, { isEnabled: true })
  }

  if (item.api_key) {
    // Wholesale replacement keeps re-applies deterministic; the key value is
    // the gateway token, never a real upstream credential.
    providerService.replaceApiKeys(providerId, [{ id: uuidv4(), key: item.api_key, isEnabled: true }])
  }

  reconcileProviderModels(providerId, item)
}

function reconcileProviderModels(providerId: string, item: EnterpriseProviderConfig): void {
  const desired = (item.models ?? []).map((model) => ({
    modelId: model.id,
    name: model.name ?? model.id,
    isEnabled: model.is_enabled ?? true
  }))
  const desiredById = new Map(desired.map((model) => [model.modelId, model]))

  const currentModels = modelService.list({ providerId })
  const currentModelIds = currentModels
    .map((model) => model.apiModelId)
    .filter((id): id is string => typeof id === 'string')
  const { toAddIds, toRemoveIds } = computeModelReconcileDiff(
    currentModelIds,
    desired.map((model) => model.modelId)
  )

  if (toAddIds.length > 0 || toRemoveIds.length > 0) {
    const toAdd: { dto: CreateModelDto }[] = toAddIds.map((modelId) => ({
      dto: { providerId, modelId, name: desiredById.get(modelId)?.name }
    }))
    // reconcileForProvider 匹配 user_model.id（UniqueModelId），toRemove 必须带 providerId 前缀
    const toRemove = toRemoveIds.map((modelId) => createUniqueModelId(providerId, modelId))
    modelService.reconcileForProvider(providerId, { toAdd, toRemove })
  }

  // Converge status/display fields for models the config continues to list
  // (covers both freshly created rows and ones already present).
  const currentById = new Map(
    modelService.list({ providerId }).map((model) => [model.apiModelId, model] as const)
  )
  for (const [modelId, target] of desiredById) {
    const current = currentById.get(modelId)
    if (!current) continue
    const patch: { name?: string; isEnabled?: boolean } = {}
    if (target.name && current.name !== target.name) patch.name = target.name
    if (current.isEnabled !== target.isEnabled) patch.isEnabled = target.isEnabled
    if (Object.keys(patch).length > 0) {
      modelService.update(providerId, modelId, patch)
    }
  }

  if (toAddIds.length > 0 || toRemoveIds.length > 0) {
    logger.info('Reconciled enterprise provider models', { providerId, added: toAddIds.length, removed: toRemoveIds.length })
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Default models
// ─────────────────────────────────────────────────────────────────────────────

async function applyDefaultModels(config: EnterpriseClientConfig, result: ApplyEnterpriseConfigResult): Promise<void> {
  const defaults = config.default_models
  if (!defaults) return

  const updates: Partial<{
    'chat.default_model_id': UniqueModelId | null
    'feature.translate.model_id': UniqueModelId | null
    'feature.quick_assistant.model_id': UniqueModelId | null
  }> = {}

  if (defaults.assistant !== undefined) {
    updates['chat.default_model_id'] = resolveConfigModel(defaults.assistant, 'default_models.assistant')
  }
  if (defaults.translate !== undefined) {
    updates['feature.translate.model_id'] = resolveConfigModel(defaults.translate, 'default_models.translate')
  }
  if (defaults.quick_model !== undefined) {
    updates['feature.quick_assistant.model_id'] = resolveConfigModel(
      defaults.quick_model,
      'default_models.quick_model'
    )
  }

  if (Object.keys(updates).length === 0) return

  // The three rows are guaranteed to exist (cherryaiDefaultModelSeeder seeds
  // them before WhenReady services run) and `PreferenceService.setMultiple`
  // updates the in-memory cache + notifies renderers, unlike a bare DB write.
  await application.get('PreferenceService').setMultiple(updates)
  result.defaultModelsSet = Object.keys(updates).length
}

/** Resolve a config model reference and require the model row to exist (fail fast on misconfiguration). */
function resolveConfigModel(ref: string, field: string): UniqueModelId {
  const uniqueModelId = toEnterpriseUniqueModelId(ref)
  if (!uniqueModelId) {
    throw new Error(`${field}: invalid model reference '${ref}' (expected "{providerId}/{modelId}")`)
  }
  const separatorIndex = uniqueModelId.indexOf('::')
  const providerId = uniqueModelId.slice(0, separatorIndex)
  const modelId = uniqueModelId.slice(separatorIndex + 2)
  modelService.getByKey(providerId, modelId) // throws NOT_FOUND when missing
  return uniqueModelId
}

// ─────────────────────────────────────────────────────────────────────────────
// MCP servers
// ─────────────────────────────────────────────────────────────────────────────

async function applyMcpServers(config: EnterpriseClientConfig, result: ApplyEnterpriseConfigResult): Promise<void> {
  for (const item of config.mcp_servers ?? []) {
    const type = (item.type ?? 'streamableHttp') as McpServerType
    if (!MCP_SERVER_TYPES.includes(type)) {
      throw new Error(`mcp_servers.${item.name}: unknown type '${item.type}'`)
    }

    // Match the logical name first, then the namespaced storage name so a
    // repeated apply UPDATES the `[企业] …` row instead of duplicating it.
    const existing =
      mcpServerService.findByIdOrName(item.name) ?? mcpServerService.findByIdOrName(withEnterpriseMcpNamePrefix(item.name))

    if (existing) {
      mcpServerService.update(existing.id, {
        type,
        ...(item.base_url !== undefined ? { baseUrl: item.base_url } : {}),
        isActive: item.is_active ?? true
      })
    } else {
      mcpServerService.create({
        name: withEnterpriseMcpNamePrefix(item.name),
        type,
        ...(item.base_url !== undefined ? { baseUrl: item.base_url } : {}),
        isActive: item.is_active ?? true
      })
    }
    result.mcpServersApplied++
  }
}

const MCP_SERVER_TYPES: readonly McpServerType[] = ['stdio', 'sse', 'streamableHttp', 'inMemory']

// ─────────────────────────────────────────────────────────────────────────────
// Assistants
// ─────────────────────────────────────────────────────────────────────────────

async function applyAssistants(config: EnterpriseClientConfig, result: ApplyEnterpriseConfigResult): Promise<void> {
  if ((config.assistants ?? []).length === 0) return

  const assistantsByName = await listAllAssistantsByName()

  for (const item of config.assistants ?? []) {
    const settings = mergeAssistantSettings(item)
    const modelId = item.model !== undefined ? resolveConfigModel(item.model, `assistants.${item.model}`) : undefined
    const mcpServerIds = item.mcp_server_ids?.map((name) => resolveMcpServerId(name, item.name))

    const matched = assistantsByName.get(item.name)
    if (matched) {
      assistantDataService.update(matched.id, {
        ...(item.prompt !== undefined ? { prompt: item.prompt } : {}),
        ...(item.emoji !== undefined ? { emoji: item.emoji } : {}),
        ...(item.description !== undefined ? { description: item.description } : {}),
        ...(modelId !== undefined ? { modelId } : {}),
        ...(item.settings !== undefined ? { settings } : {}),
        ...(mcpServerIds !== undefined ? { mcpServerIds } : {})
      })
    } else {
      const created = assistantDataService.create({
        name: item.name,
        prompt: item.prompt ?? '',
        emoji: item.emoji ?? '✨',
        ...(item.description !== undefined ? { description: item.description } : {}),
        ...(modelId !== undefined ? { modelId } : {}),
        ...(item.settings !== undefined ? { settings } : {}),
        ...(mcpServerIds !== undefined ? { mcpServerIds } : {})
      })
      assistantsByName.set(created.name, created)
    }
    result.assistantsApplied++
  }
}

async function listAllAssistantsByName(): Promise<Map<string, Assistant>> {
  const byName = new Map<string, Assistant>()
  let page = 1
  for (;;) {
    const { items, total } = assistantDataService.list({ page, limit: ASSISTANT_LIST_PAGE_SIZE })
    for (const assistant of items) byName.set(assistant.name, assistant)
    if (items.length === 0 || byName.size >= total) break
    page++
  }
  return byName
}

function mergeAssistantSettings(item: EnterpriseAssistantConfig): AssistantSettings | undefined {
  if (item.settings === undefined) return undefined
  return { ...DEFAULT_ASSISTANT_SETTINGS, ...item.settings } as AssistantSettings
}

function resolveMcpServerId(logicalName: string, assistantName: string): string {
  const server =
    mcpServerService.findByIdOrName(logicalName) ?? mcpServerService.findByIdOrName(withEnterpriseMcpNamePrefix(logicalName))
  if (!server) {
    throw new Error(`assistants.${assistantName}: references unknown mcp server '${logicalName}'`)
  }
  return server.id
}

// ─────────────────────────────────────────────────────────────────────────────
// Miniapps
// ─────────────────────────────────────────────────────────────────────────────

async function applyMinapps(config: EnterpriseClientConfig, result: ApplyEnterpriseConfigResult): Promise<void> {
  for (const item of config.minapps ?? []) {
    const appId = sanitizeEnterpriseAppId(item.id)
    if (!appId) {
      throw new Error(`minapps.${item.id}: appId is empty after sanitization`)
    }

    const existing = findMiniAppByAppId(appId)
    if (existing) {
      miniAppService.update(appId, {
        ...(item.name !== undefined ? { name: item.name } : {}),
        url: item.url,
        status: 'enabled'
      })
    } else {
      miniAppService.create({ appId, name: item.name ?? appId, url: item.url })
    }
    result.minappsApplied++
  }
}

/** `getByAppId` throws NOT_FOUND for absent rows — normalize that to null here. */
function findMiniAppByAppId(appId: string): MiniApp | null {
  try {
    return miniAppService.getByAppId(appId)
  } catch (error) {
    if (error instanceof DataApiError && error.code === ErrorCode.NOT_FOUND) return null
    throw error
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// kb_entries
// ─────────────────────────────────────────────────────────────────────────────

async function applyKbEntries(config: EnterpriseClientConfig, result: ApplyEnterpriseConfigResult): Promise<void> {
  if (config.kb_entries === undefined) return

  // `enterprise.kb_entries` is not a declared preference key, and
  // `PreferenceService.set` rejects keys outside its schema cache — store it
  // seeder-style (direct preference-row upsert, same pattern as
  // cherryaiDefaultModelSeeder). E3's WeKnora MCP consumes the raw row.
  application.get('DbService').withWriteTx((tx) => {
    const filter = and(
      eq(preferenceTable.scope, KB_ENTRIES_PREFERENCE_SCOPE),
      eq(preferenceTable.key, KB_ENTRIES_PREFERENCE_KEY)
    )
    const [existing] = tx.select({ key: preferenceTable.key }).from(preferenceTable).where(filter).limit(1).all()
    if (existing) {
      tx.update(preferenceTable).set({ value: config.kb_entries }).where(filter).run()
    } else {
      tx.insert(preferenceTable)
        .values({ scope: KB_ENTRIES_PREFERENCE_SCOPE, key: KB_ENTRIES_PREFERENCE_KEY, value: config.kb_entries })
        .run()
    }
  })
  result.kbEntriesStored = true
}
