/**
 * Marketplace service (E5) — the enterprise gateway as the official plugin market.
 *
 * Browsing: `getCatalog` / `getPluginDetail` fetch from
 * `{serverUrl}/marketplace/api/*` using the SAME enterprise settings
 * (`loadEnterpriseSettings`) and `X-Client-Token` semantics as the config
 * pipeline. Enterprise disabled → `{ source: 'none' }`, never a throw.
 *
 * Installing: each manifest component lands through the app's EXISTING
 * per-type stores, idempotently per component:
 * - skills    → skill zips downloaded to a temp file, then
 *               `skillService.installFromMarketplaceZip` runs the SAME zip
 *               pipeline as `installFromZip` but registers the skill with
 *               source `marketplace` and the gateway file URL as provenance
 *               (stable URL ⇒ idempotent reinstall, source-owned uninstall);
 * - mcp       → mcpServerService create / update-by-name (`installSource`
 *               stays inside the existing CHECK enum, 'manual'; the gateway
 *               plugin URL is recorded in `registryUrl` for provenance);
 * - assistant → assistantDataService create / update-by-name;
 * - minapp    → miniAppService create / update-by-appId
 *               (`market-<pluginId>-<componentId>`).
 *
 * The plugin-level record persists to
 * `{userData}/Data/marketplace/installed.json` via the atomic-write family
 * (same durability pattern as enterpriseSettings). Uninstall reverses by
 * refs; per-component failures are reported, never fatal to the batch.
 */

import * as fs from 'node:fs'
import * as path from 'node:path'

import { net } from 'electron'

import { application } from '@application'
import { assistantDataService } from '@data/services/AssistantService'
import { mcpServerService } from '@data/services/McpServerService'
import { miniAppService } from '@data/services/MiniAppService'
import { loggerService } from '@logger'
import { MAX_SKILL_SIZE } from '@main/ai/skills/skillArchive'
import { skillService } from '@main/ai/skills/SkillService'
import { atomicWriteFile } from '@main/utils/file'
import { DataApiError, ErrorCode } from '@shared/data/api/errors'
import { AbsoluteFilePathSchema } from '@shared/types/file'
import type {
  MarketCatalogResult,
  MarketComponentResult,
  MarketInstalledRecord,
  MarketInstalledRefs,
  MarketInstallResult,
  MarketPluginManifest,
  MarketUninstallResult
} from '@shared/types/marketplace'
import { MARKETPLACE_PLUGIN_ID_REGEX } from '@shared/types/marketplace'

import {
  buildPluginFileUrl,
  buildPluginRegistryUrl,
  buildMarketMinAppId,
  installedRecordFileSchema,
  isMarketplacePluginId,
  marketRefsIsEmpty,
  mergeInstalledRecord,
  parseCatalogResponse,
  parseMarketplaceManifest,
  removeInstalledRecord,
  resolveCatalogIconUrl
} from './types'

const logger = loggerService.withContext('MarketplaceService')

const CATALOG_PATH = '/marketplace/api/catalog'
const PLUGIN_DETAIL_PATH = '/marketplace/api/plugins'
const FETCH_TIMEOUT_MS = 15_000

/** Local record layout: `{userData}/Data/marketplace/installed.json`. */
function getInstalledFilePath(): string {
  return path.join(application.getPath('app.userdata.data'), 'marketplace', 'installed.json')
}

/** Bridge the plain path strings from `application.getPath` to the fs layer's branded type. */
function toAbsoluteFilePath(value: string) {
  return AbsoluteFilePathSchema.parse(value)
}

/** Serializes install/uninstall so two concurrent batches can't interleave refs writes. */
let mutationChain: Promise<unknown> = Promise.resolve()

function runExclusive<T>(task: () => Promise<T>): Promise<T> {
  const next = mutationChain.then(task, task)
  mutationChain = next.catch(() => undefined)
  return next
}

// ---------------------------------------------------------------------------
// Gateway access
// ---------------------------------------------------------------------------

async function requireEnabledSettings(): Promise<{ serverUrl: string; token: string }> {
  const { loadEnterpriseSettings } = await import('@main/enterprise/enterpriseSettings')
  const settings = loadEnterpriseSettings()
  if (settings.status !== 'enabled') {
    throw new Error(`marketplace disabled: ${settings.reason}`)
  }
  return { serverUrl: settings.serverUrl, token: settings.token }
}

async function fetchGatewayJson(serverUrl: string, token: string, urlPath: string): Promise<unknown> {
  const response = await net.fetch(`${serverUrl}${urlPath}`, {
    headers: { 'X-Client-Token': token },
    redirect: 'follow',
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS)
  })
  if (!response.ok) {
    throw new Error(`gateway returned HTTP ${response.status} for ${urlPath}`)
  }
  return response.json()
}

// ---------------------------------------------------------------------------
// Installed records ({userData}/Data/marketplace/installed.json)
// ---------------------------------------------------------------------------

function loadInstalledRecords(): MarketInstalledRecord[] {
  try {
    const raw = fs.readFileSync(getInstalledFilePath(), 'utf-8')
    const parsed = installedRecordFileSchema.safeParse(JSON.parse(raw))
    if (parsed.success) return parsed.data
    logger.warn('Marketplace installed.json is malformed; treating as empty', {
      issues: parsed.error.issues.slice(0, 3)
    })
    return []
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      logger.warn('Failed to read marketplace installed.json; treating as empty', error as Error)
    }
    return []
  }
}

async function saveInstalledRecords(records: MarketInstalledRecord[]): Promise<void> {
  const filePath = getInstalledFilePath()
  await fs.promises.mkdir(path.dirname(filePath), { recursive: true })
  await atomicWriteFile(toAbsoluteFilePath(filePath), JSON.stringify(records, null, 2))
}

export function getInstalled(): MarketInstalledRecord[] {
  return loadInstalledRecords()
}

// ---------------------------------------------------------------------------
// Catalog + detail
// ---------------------------------------------------------------------------

export async function getCatalog(): Promise<MarketCatalogResult> {
  const { loadEnterpriseSettings } = await import('@main/enterprise/enterpriseSettings')
  const settings = loadEnterpriseSettings()
  if (settings.status !== 'enabled') {
    return { source: 'none', plugins: [], warnings: [] }
  }
  try {
    const payload = await fetchGatewayJson(settings.serverUrl, settings.token, CATALOG_PATH)
    const catalog = parseCatalogResponse(payload)
    if (!catalog) {
      throw new Error('catalog payload is not a valid marketplace response')
    }
    // Icons are resolved main-side: the renderer never learns the serverUrl.
    return {
      ...catalog,
      plugins: catalog.plugins.map((plugin) => ({
        ...plugin,
        iconUrl: resolveCatalogIconUrl(settings.serverUrl, plugin) || undefined
      }))
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    logger.warn('Marketplace catalog fetch failed', { error: message })
    return { source: 'error', plugins: [], warnings: [], error: message }
  }
}

export async function getPluginDetail(pluginId: string): Promise<MarketPluginManifest> {
  if (!isMarketplacePluginId(pluginId)) {
    throw new Error(`invalid marketplace plugin id: ${pluginId}`)
  }
  const { serverUrl, token } = await requireEnabledSettings()
  const payload = await fetchGatewayJson(serverUrl, token, `${PLUGIN_DETAIL_PATH}/${pluginId}`)
  const manifest = parseMarketplaceManifest(payload)
  if (!manifest) {
    throw new Error(`plugin "${pluginId}" manifest failed validation`)
  }
  return { ...manifest, iconUrl: resolveCatalogIconUrl(serverUrl, manifest) || undefined }
}

// ---------------------------------------------------------------------------
// Install
// ---------------------------------------------------------------------------

interface InstallContext {
  serverUrl: string
  token: string
  pluginId: string
  registryUrl: string
}

async function downloadPluginFile(context: InstallContext, filePath: string): Promise<string> {
  const url = buildPluginFileUrl(context.serverUrl, context.pluginId, filePath)
  const response = await net.fetch(url, {
    headers: { 'X-Client-Token': context.token },
    redirect: 'follow',
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS)
  })
  if (!response.ok) {
    throw new Error(`file download failed: HTTP ${response.status} for ${filePath}`)
  }
  const advertisedSize = Number(response.headers.get('content-length') ?? NaN)
  if (Number.isFinite(advertisedSize) && advertisedSize > MAX_SKILL_SIZE) {
    await response.body?.cancel()
    throw new Error(`file "${filePath}" advertises ${advertisedSize} bytes, over the ${MAX_SKILL_SIZE}-byte limit`)
  }

  const tempDir = await fs.promises.mkdtemp(path.join(application.getPath('app.temp'), 'marketplace-'))
  const zipPath = path.join(tempDir, path.basename(filePath))
  const handle = await fs.promises.open(zipPath, 'w')
  try {
    let received = 0
    for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
      received += chunk.byteLength
      if (received > MAX_SKILL_SIZE) {
        throw new Error(`file "${filePath}" exceeds the ${MAX_SKILL_SIZE}-byte limit`)
      }
      for (let offset = 0; offset < chunk.byteLength;) {
        offset += (await handle.write(chunk, offset)).bytesWritten
      }
    }
  } catch (error) {
    await fs.promises.rm(tempDir, { recursive: true, force: true }).catch(() => undefined)
    await handle.close()
    throw error
  }
  await handle.close()
  return zipPath
}

async function installSkillComponents(
  context: InstallContext,
  manifest: MarketPluginManifest,
  refs: MarketInstalledRefs
): Promise<MarketComponentResult[]> {
  const results: MarketComponentResult[] = []
  for (const entry of manifest.skills) {
    const fileUrl = buildPluginFileUrl(context.serverUrl, context.pluginId, entry.zip)
    try {
      const zipPath = await downloadPluginFile(context, entry.zip)
      try {
        const installed = await skillService.installFromMarketplaceZip({ zipFilePath: zipPath, sourceUrl: fileUrl })
        if (!refs.skillFolderNames.includes(installed.folderName)) {
          refs.skillFolderNames.push(installed.folderName)
        }
        results.push({ kind: 'skill', target: installed.name, status: 'installed' })
      } finally {
        await fs.promises.rm(path.dirname(zipPath), { recursive: true, force: true }).catch(() => undefined)
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      logger.warn('Marketplace skill component failed', {
        pluginId: context.pluginId,
        skill: entry.name,
        error: message
      })
      results.push({ kind: 'skill', target: entry.name, status: 'failed', error: message })
    }
  }
  return results
}

async function installMcpComponents(
  context: InstallContext,
  manifest: MarketPluginManifest,
  refs: MarketInstalledRefs
): Promise<MarketComponentResult[]> {
  const results: MarketComponentResult[] = []
  for (const entry of manifest.mcp_servers) {
    try {
      const config = {
        name: entry.name,
        type: entry.type,
        ...(entry.description ? { description: entry.description } : {}),
        ...(entry.base_url ? { baseUrl: entry.base_url } : {}),
        ...(entry.command ? { command: entry.command } : {}),
        ...(entry.args ? { args: entry.args } : {}),
        ...(entry.env ? { env: entry.env } : {}),
        ...(entry.headers ? { headers: entry.headers } : {}),
        registryUrl: context.registryUrl
      }
      const existing = mcpServerService.findByIdOrName(entry.name)
      if (existing) {
        // Reinstall: idempotent update by name. installSource is left as-is
        // (the enum has no marketplace member; provenance lives in registryUrl).
        mcpServerService.update(existing.id, config)
        if (!refs.mcpIds.includes(existing.id)) refs.mcpIds.push(existing.id)
        results.push({ kind: 'mcp_server', target: entry.name, status: 'updated' })
      } else {
        const created = mcpServerService.create({
          ...config,
          installSource: 'manual',
          isActive: false
        })
        refs.mcpIds.push(created.id)
        results.push({ kind: 'mcp_server', target: entry.name, status: 'installed' })
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      logger.warn('Marketplace MCP component failed', {
        pluginId: context.pluginId,
        server: entry.name,
        error: message
      })
      results.push({ kind: 'mcp_server', target: entry.name, status: 'failed', error: message })
    }
  }
  return results
}

async function installAssistantComponents(
  context: InstallContext,
  manifest: MarketPluginManifest,
  refs: MarketInstalledRefs
): Promise<MarketComponentResult[]> {
  const results: MarketComponentResult[] = []
  for (const entry of manifest.assistants) {
    try {
      const found = assistantDataService.list({ search: entry.name, page: 1, limit: 50 })
      const existing = found.items.find((assistant) => assistant.name === entry.name)
      const fields = {
        ...(entry.prompt !== undefined ? { prompt: entry.prompt } : {}),
        ...(entry.emoji !== undefined ? { emoji: entry.emoji } : {}),
        ...(entry.description !== undefined ? { description: entry.description } : {})
      }
      if (existing) {
        if (Object.keys(fields).length > 0) {
          assistantDataService.update(existing.id, fields)
        }
        if (!refs.assistantIds.includes(existing.id)) refs.assistantIds.push(existing.id)
        results.push({ kind: 'assistant', target: entry.name, status: 'updated' })
      } else {
        const created = assistantDataService.create({ name: entry.name, ...fields })
        refs.assistantIds.push(created.id)
        results.push({ kind: 'assistant', target: entry.name, status: 'installed' })
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      logger.warn('Marketplace assistant component failed', {
        pluginId: context.pluginId,
        assistant: entry.name,
        error: message
      })
      results.push({ kind: 'assistant', target: entry.name, status: 'failed', error: message })
    }
  }
  return results
}

async function installMinappComponents(
  context: InstallContext,
  manifest: MarketPluginManifest,
  refs: MarketInstalledRefs
): Promise<MarketComponentResult[]> {
  const results: MarketComponentResult[] = []
  for (const entry of manifest.minapps) {
    const appId = buildMarketMinAppId(context.pluginId, entry.id)
    try {
      try {
        miniAppService.getByAppId(appId)
        miniAppService.update(appId, { name: entry.name, url: entry.url })
        if (!refs.minappAppIds.includes(appId)) refs.minappAppIds.push(appId)
        results.push({ kind: 'minapp', target: appId, status: 'updated' })
      } catch (error) {
        if (!isNotFoundError(error)) throw error
        miniAppService.create({ appId, name: entry.name, url: entry.url })
        refs.minappAppIds.push(appId)
        results.push({ kind: 'minapp', target: appId, status: 'installed' })
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      logger.warn('Marketplace minapp component failed', { pluginId: context.pluginId, appId, error: message })
      results.push({ kind: 'minapp', target: appId, status: 'failed', error: message })
    }
  }
  return results
}

/** DataApiError NOT_FOUND (mini apps) or the equivalent "not found" message text. */
function isNotFoundError(error: unknown): boolean {
  if (error instanceof DataApiError && error.code === ErrorCode.NOT_FOUND) return true
  return error instanceof Error && error.message.includes('not found')
}

/**
 * Install every component of a plugin. Per-component failures are collected,
 * not fatal: whatever succeeded is recorded so uninstall stays complete. When
 * nothing succeeded, the whole install reports failure.
 */
export async function installPlugin(pluginId: string): Promise<MarketInstallResult> {
  return runExclusive(async () => {
    if (!isMarketplacePluginId(pluginId)) {
      throw new Error(`invalid marketplace plugin id: ${pluginId}`)
    }
    const manifest = await getPluginDetail(pluginId)
    const { serverUrl, token } = await requireEnabledSettings()
    const context: InstallContext = {
      serverUrl,
      token,
      pluginId,
      registryUrl: buildPluginRegistryUrl(serverUrl, pluginId)
    }

    const refs: MarketInstalledRefs = { skillFolderNames: [], mcpIds: [], assistantIds: [], minappAppIds: [] }
    const results: MarketComponentResult[] = [
      ...(await installSkillComponents(context, manifest, refs)),
      ...(await installMcpComponents(context, manifest, refs)),
      ...(await installAssistantComponents(context, manifest, refs)),
      ...(await installMinappComponents(context, manifest, refs))
    ]

    const anyFailed = results.some((result) => result.status === 'failed')
    const anySucceeded = results.some((result) => result.status === 'installed' || result.status === 'updated')
    const emptyBefore = marketRefsIsEmpty(refs)

    if (anySucceeded || (!anyFailed && emptyBefore)) {
      const record: MarketInstalledRecord = {
        pluginId,
        name: manifest.name,
        version: manifest.version,
        installedAt: new Date().toISOString(),
        refs
      }
      await saveInstalledRecords(mergeInstalledRecord(loadInstalledRecords(), record))
    }

    if (!anySucceeded && anyFailed) {
      const firstError = results.find((result) => result.status === 'failed')?.error
      throw new Error(firstError ? `install failed: ${firstError}` : 'install failed')
    }

    logger.info('Marketplace plugin install finished', {
      pluginId,
      version: manifest.version,
      results: results.map((result) => `${result.kind}:${result.target}:${result.status}`)
    })
    return { pluginId, name: manifest.name, version: manifest.version, results, ok: true }
  })
}

// ---------------------------------------------------------------------------
// Uninstall
// ---------------------------------------------------------------------------

export async function uninstallPlugin(pluginId: string): Promise<MarketUninstallResult> {
  return runExclusive(async () => {
    if (!MARKETPLACE_PLUGIN_ID_REGEX.test(pluginId)) {
      throw new Error(`invalid marketplace plugin id: ${pluginId}`)
    }
    const records = loadInstalledRecords()
    const record = records.find((entry) => entry.pluginId === pluginId)
    if (!record) {
      throw new Error(`plugin is not installed: ${pluginId}`)
    }

    const results: MarketComponentResult[] = []
    for (const folderName of record.refs.skillFolderNames) {
      try {
        const skill = await skillService.getByFolderName(folderName)
        if (!skill) {
          results.push({ kind: 'skill', target: folderName, status: 'skipped' })
        } else if (skill.source !== 'marketplace') {
          // The folder was taken over by a non-marketplace install — leave it alone.
          logger.warn('Skipping marketplace uninstall of non-marketplace skill', { folderName, source: skill.source })
          results.push({ kind: 'skill', target: folderName, status: 'skipped' })
        } else {
          await skillService.uninstall(skill.id)
          results.push({ kind: 'skill', target: folderName, status: 'removed' })
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        logger.warn('Marketplace skill uninstall failed', { pluginId, folderName, error: message })
        results.push({ kind: 'skill', target: folderName, status: 'failed', error: message })
      }
    }

    for (const mcpId of record.refs.mcpIds) {
      try {
        mcpServerService.delete(mcpId)
        results.push({ kind: 'mcp_server', target: mcpId, status: 'removed' })
      } catch (error) {
        if (isNotFoundError(error)) {
          results.push({ kind: 'mcp_server', target: mcpId, status: 'skipped' })
          continue
        }
        const message = error instanceof Error ? error.message : String(error)
        logger.warn('Marketplace MCP uninstall failed', { pluginId, mcpId, error: message })
        results.push({ kind: 'mcp_server', target: mcpId, status: 'failed', error: message })
      }
    }

    for (const assistantId of record.refs.assistantIds) {
      try {
        assistantDataService.delete(assistantId)
        results.push({ kind: 'assistant', target: assistantId, status: 'removed' })
      } catch (error) {
        if (isNotFoundError(error)) {
          results.push({ kind: 'assistant', target: assistantId, status: 'skipped' })
          continue
        }
        const message = error instanceof Error ? error.message : String(error)
        logger.warn('Marketplace assistant uninstall failed', { pluginId, assistantId, error: message })
        results.push({ kind: 'assistant', target: assistantId, status: 'failed', error: message })
      }
    }

    for (const appId of record.refs.minappAppIds) {
      try {
        miniAppService.delete(appId)
        results.push({ kind: 'minapp', target: appId, status: 'removed' })
      } catch (error) {
        if (isNotFoundError(error)) {
          results.push({ kind: 'minapp', target: appId, status: 'skipped' })
          continue
        }
        const message = error instanceof Error ? error.message : String(error)
        logger.warn('Marketplace minapp uninstall failed', { pluginId, appId, error: message })
        results.push({ kind: 'minapp', target: appId, status: 'failed', error: message })
      }
    }

    await saveInstalledRecords(removeInstalledRecord(records, pluginId))

    const ok = !results.some((result) => result.status === 'failed')
    logger.info('Marketplace plugin uninstall finished', {
      pluginId,
      ok,
      results: results.map((result) => `${result.kind}:${result.target}:${result.status}`)
    })
    return { pluginId, results, ok }
  })
}
