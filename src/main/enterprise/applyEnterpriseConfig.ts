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
 * minapps, and finally the raw preference rows (`kb_entries`, plus the
 * managed-assistant id list powering the renderer's read-only guard). After
 * default models land, first-run onboarding is marked complete — the
 * enterprise pipeline replaces that setup, so the「连接 CherryIN」dialog must
 * not appear on a fresh enterprise install.
 */

import { and, eq } from 'drizzle-orm'
import { v4 as uuidv4 } from 'uuid'

import { application } from '@application'
import { ENDPOINT_TYPE } from '@cherrystudio/provider-registry'
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
import type { McpServerType } from '@shared/data/types/mcpServer'
import type { MiniApp } from '@shared/data/types/miniApp'
import type { UniqueModelId } from '@shared/data/types/model'
import { createUniqueModelId } from '@shared/data/types/model'
import { ENTERPRISE_MANAGED_ASSISTANT_IDS_KEY } from '@shared/utils/enterprise'

import type {
  EnterpriseAssistantConfig,
  EnterpriseClientConfig,
  EnterpriseProviderConfig
} from './enterpriseConfigTypes'
import {
  computeEnterpriseOnboardingUpdates,
  computeModelReconcileDiff,
  sanitizeEnterpriseAppId,
  toEnterpriseMcpHeaders,
  toEnterpriseUniqueModelId,
  withEnterpriseMcpNamePrefix,
  withEnterprisePrefix
} from './enterpriseMappers'

const logger = loggerService.withContext('EnterpriseConfigApplier')

const PREFERENCE_SCOPE_DEFAULT = 'default'
const KB_ENTRIES_PREFERENCE_KEY = 'enterprise.kb_entries'
const ASSISTANT_LIST_PAGE_SIZE = 500

export interface ApplyEnterpriseConfigResult {
  providersApplied: number
  modelsAdded: number
  modelsRemoved: number
  defaultModelsSet: number
  onboardingCompleted: boolean
  mcpServersApplied: number
  assistantsApplied: number
  minappsApplied: number
  kbEntriesStored: boolean
  managedAssistantIdsRecorded: number
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
    onboardingCompleted: false,
    mcpServersApplied: 0,
    assistantsApplied: 0,
    minappsApplied: 0,
    kbEntriesStored: false,
    managedAssistantIdsRecorded: 0
  }

  await applyProvidersAndModels(config, result)
  await applyDefaultModels(config, result)
  result.onboardingCompleted = await ensureOnboardingCompleted()
  await applyMcpServers(config, result)
  const managedAssistantIds = await applyAssistants(config, result)
  await applyMinapps(config, result)
  await applyKbEntries(config, result)
  await applyManagedAssistantIds(managedAssistantIds, result)

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
  const currentById = new Map(modelService.list({ providerId }).map((model) => [model.apiModelId, model] as const))
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
    logger.info('Reconciled enterprise provider models', {
      providerId,
      added: toAddIds.length,
      removed: toRemoveIds.length
    })
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
    updates['feature.quick_assistant.model_id'] = resolveConfigModel(defaults.quick_model, 'default_models.quick_model')
  }

  if (Object.keys(updates).length === 0) return

  // The three rows are guaranteed to exist (cherryaiDefaultModelSeeder seeds
  // them before WhenReady services run) and `PreferenceService.setMultiple`
  // updates the in-memory cache + notifies renderers, unlike a bare DB write.
  await application.get('PreferenceService').setMultiple(updates)
  result.defaultModelsSet = Object.keys(updates).length
}

/**
 * Mark first-run onboarding complete on the enterprise pipeline's behalf.
 * Called after default models land during an apply, and by the sync service's
 * 304 'touch' branch — a config that is unchanged server-side must still
 * migrate a pre-existing local install off the「连接 CherryIN」dialog. Writes
 * only what `computeEnterpriseOnboardingUpdates` says is missing, so repeated
 * calls stay no-ops. Returns whether anything was written.
 */
export async function ensureOnboardingCompleted(): Promise<boolean> {
  const preferenceService = application.get('PreferenceService')
  const updates = computeEnterpriseOnboardingUpdates(
    preferenceService.get('app.onboarding.provider_setup.status'),
    preferenceService.get('app.privacy.policy_version')
  )
  if (!updates) return false
  await preferenceService.setMultiple(updates)
  return true
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
      mcpServerService.findByIdOrName(item.name) ??
      mcpServerService.findByIdOrName(withEnterpriseMcpNamePrefix(item.name))

    if (existing) {
      mcpServerService.update(existing.id, {
        type,
        ...(item.base_url !== undefined ? { baseUrl: item.base_url } : {}),
        // Omitted headers clear stale ones so a re-apply converges fully.
        headers: toEnterpriseMcpHeaders(item.headers) ?? {},
        isActive: item.is_active ?? true
      })
    } else {
      mcpServerService.create({
        name: withEnterpriseMcpNamePrefix(item.name),
        type,
        ...(item.base_url !== undefined ? { baseUrl: item.base_url } : {}),
        ...(item.headers !== undefined ? { headers: toEnterpriseMcpHeaders(item.headers) } : {}),
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

/**
 * Apply the assistants section and return the UUID ids of entries marked
 * `managed: true` (feeding the renderer's read-only guard via the
 * `enterprise.managed_assistant_ids` preference row).
 */
async function applyAssistants(config: EnterpriseClientConfig, result: ApplyEnterpriseConfigResult): Promise<string[]> {
  const managedAssistantIds: string[] = []
  if ((config.assistants ?? []).length === 0) return managedAssistantIds

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
      if (item.managed) managedAssistantIds.push(matched.id)
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
      if (item.managed) managedAssistantIds.push(created.id)
      assistantsByName.set(created.name, created)
    }
    result.assistantsApplied++
  }

  return managedAssistantIds
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
    mcpServerService.findByIdOrName(logicalName) ??
    mcpServerService.findByIdOrName(withEnterpriseMcpNamePrefix(logicalName))
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
// Preference rows (kb_entries + managed assistant ids)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Seeder-style direct preference-row upsert. `PreferenceService.set` rejects
 * keys outside its schema cache, so the enterprise keys bypass it; rows are
 * guaranteed to exist via seeding in the declared-key case, but enterprise
 * keys are dynamic — hence the select-then-insert-or-update in one tx.
 */
function upsertUndeclaredPreferenceRow(key: string, value: unknown): void {
  application.get('DbService').withWriteTx((tx) => {
    const filter = and(eq(preferenceTable.scope, PREFERENCE_SCOPE_DEFAULT), eq(preferenceTable.key, key))
    const [existing] = tx.select({ key: preferenceTable.key }).from(preferenceTable).where(filter).limit(1).all()
    if (existing) {
      tx.update(preferenceTable).set({ value }).where(filter).run()
    } else {
      tx.insert(preferenceTable).values({ scope: PREFERENCE_SCOPE_DEFAULT, key, value }).run()
    }
  })
}

async function applyKbEntries(config: EnterpriseClientConfig, result: ApplyEnterpriseConfigResult): Promise<void> {
  if (config.kb_entries === undefined) return

  // E3's WeKnora MCP consumes the raw row.
  upsertUndeclaredPreferenceRow(KB_ENTRIES_PREFERENCE_KEY, config.kb_entries)
  result.kbEntriesStored = true
}

/**
 * Record the managed-assistant id list for the renderer's read-only guard.
 * Replace-whole semantics: every apply rewrites the key from the current
 * config (empty array when nothing is managed), so ids of assistants the
 * config stopped managing are dropped on the next sync.
 */
async function applyManagedAssistantIds(
  managedAssistantIds: string[],
  result: ApplyEnterpriseConfigResult
): Promise<void> {
  upsertUndeclaredPreferenceRow(ENTERPRISE_MANAGED_ASSISTANT_IDS_KEY, managedAssistantIds)
  result.managedAssistantIdsRecorded = managedAssistantIds.length
}
