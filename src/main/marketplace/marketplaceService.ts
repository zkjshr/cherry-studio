/**
 * Marketplace service (E5) — the enterprise gateway as the official plugin market.
 *
 * Browsing: `getCatalog` / `getPluginDetail` fetch from
 * `{serverUrl}/marketplace/api/*` using the SAME enterprise settings
 * (`loadEnterpriseSettings`) and `X-Client-Token` semantics as the config
 * pipeline. Enterprise disabled → `{ source: 'none' }`, never a throw.
 * Gateway-relative icons are resolved MAIN-side into data: URLs (the files
 * endpoint is token-gated, which a plain renderer `<img>` cannot speak);
 * absolute http(s) icons pass through untouched.
 *
 * Installing: each manifest component lands through the app's EXISTING
 * per-type stores, idempotently per component:
 * - skills    → skill zips downloaded to a temp file, then
 *               `skillService.installFromMarketplaceZip` runs the SAME zip
 *               pipeline as `installFromZip` but registers the skill with
 *               source `marketplace` and the gateway file URL as provenance
 *               (stable URL ⇒ idempotent reinstall, source-owned uninstall;
 *               the URL is mirrored into the installed.json refs so uninstall
 *               can tell our folder from a public-marketplace copy);
 * - mcp       → mcpServerService create / update ONLY when the existing row's
 *               `registryUrl` provenance matches this plugin (user-created or
 *               foreign servers are never hijacked — the component lands under
 *               a disambiguated `<name> [市场 <pluginId>]` name instead;
 *               `installSource` stays inside the existing CHECK enum, 'manual',
 *               the gateway plugin URL lives in `registryUrl`);
 * - assistant → assistantDataService create / update-by-name, EXCEPT rows in
 *               the `enterprise.managed_assistant_ids` preference list, which
 *               are skipped outright (never overwritten, never recorded, never
 *               archived at uninstall);
 * - minapp    → miniAppService create / update-by-appId
 *               (`market-<pluginId>-<componentId>`).
 *
 * The plugin-level record persists to
 * `{userData}/Data/marketplace/installed.json` via the atomic-write family
 * (same durability pattern as enterpriseSettings). Uninstall reverses by
 * refs; per-component failures are reported, never fatal to the batch. A
 * failed component KEEPS its ref (and the record) so a retry can finish the
 * job; the record is only deleted once every ref was removed or skipped.
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
import { loadManagedAssistantIds } from '@main/enterprise/managedAssistants'
import { atomicWriteFile } from '@main/utils/file'
import { DataApiError, ErrorCode } from '@shared/data/api/errors'
import type { Assistant } from '@shared/data/types/assistant'
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
import { MARKET_SKIP_REASONS, MARKETPLACE_PLUGIN_ID_REGEX } from '@shared/types/marketplace'

import {
  buildPluginFileUrl,
  buildPluginRegistryUrl,
  buildMarketMinAppId,
  buildMarketMcpName,
  emptyMarketRefs,
  encodeIconDataUrl,
  installedRecordFileSchema,
  installedRecordSchemaVersion,
  isHttpUrl,
  isMarketplacePluginId,
  marketRefsIsEmpty,
  mergeInstalledRecord,
  parseCatalogResponse,
  parseMarketplaceManifest,
  removeInstalledRecord,
  replaceInstalledRecord
} from './types'

const logger = loggerService.withContext('MarketplaceService')

const CATALOG_PATH = '/marketplace/api/catalog'
const PLUGIN_DETAIL_PATH = '/marketplace/api/plugins'
const FETCH_TIMEOUT_MS = 15_000
const ASSISTANT_SEARCH_PAGE_SIZE = 50

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

/** Bounded icon cache: key `<pluginId>:<icon path>` → data: URL. */
const ICON_CACHE_MAX_ENTRIES = 200
const iconDataUrlCache = new Map<string, string>()

function rememberIconDataUrl(key: string, value: string): void {
  iconDataUrlCache.delete(key)
  iconDataUrlCache.set(key, value)
  while (iconDataUrlCache.size > ICON_CACHE_MAX_ENTRIES) {
    const oldest = iconDataUrlCache.keys().next().value
    if (oldest === undefined) break
    iconDataUrlCache.delete(oldest)
  }
}

/**
 * Resolve a plugin icon to a URL the renderer can load:
 * - empty → undefined (placeholder icon);
 * - absolute http(s) → unchanged (public CDN icons need no token);
 * - gateway-relative → fetched MAIN-side with the client token and returned
 *   as a data: URL, because the files endpoint rejects unauthenticated
 *   requests that a plain `<img src>` would issue. Any failure degrades to
 *   undefined — a broken icon must never fail the catalog.
 */
async function resolveIconUrl(
  serverUrl: string,
  token: string,
  pluginId: string,
  icon: string
): Promise<string | undefined> {
  if (!icon) return undefined
  if (isHttpUrl(icon)) return icon

  const cacheKey = `${pluginId}:${icon}`
  const cached = iconDataUrlCache.get(cacheKey)
  if (cached) return cached

  try {
    const response = await net.fetch(buildPluginFileUrl(serverUrl, pluginId, icon), {
      headers: { 'X-Client-Token': token },
      redirect: 'follow',
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS)
    })
    if (!response.ok) {
      throw new Error(`icon fetch failed: HTTP ${response.status}`)
    }
    const bytes = new Uint8Array(await response.arrayBuffer())
    const dataUrl = encodeIconDataUrl(response.headers.get('content-type'), icon, bytes)
    if (!dataUrl) {
      throw new Error(`icon "${icon}" is empty, oversized, or not a supported image type`)
    }
    rememberIconDataUrl(cacheKey, dataUrl)
    return dataUrl
  } catch (error) {
    logger.warn('Marketplace icon resolution failed; using the placeholder icon', {
      pluginId,
      icon,
      error: error instanceof Error ? error.message : String(error)
    })
    return undefined
  }
}

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
    // Icons are resolved main-side (data: URLs / absolute URLs): the renderer
    // never learns the serverUrl and never needs the client token.
    const plugins = await Promise.all(
      catalog.plugins.map(async (plugin) => ({
        ...plugin,
        iconUrl: await resolveIconUrl(settings.serverUrl, settings.token, plugin.id, plugin.icon)
      }))
    )
    return { ...catalog, plugins }
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
  return {
    ...manifest,
    iconUrl: await resolveIconUrl(serverUrl, token, manifest.id, manifest.icon)
  }
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
        // Mirror the origin into the record so uninstall can prove the live
        // folder is OUR install (and not a public-marketplace copy that
        // happens to share the folder name).
        refs.skillSourceUrls[installed.folderName] = fileUrl
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
      // Reinstall of OUR row: provenance (registryUrl) must match THIS plugin —
      // a same-named user/enterprise/foreign-plugin server is never hijacked.
      if (existing && existing.registryUrl === context.registryUrl) {
        mcpServerService.update(existing.id, config)
        if (!refs.mcpIds.includes(existing.id)) refs.mcpIds.push(existing.id)
        results.push({ kind: 'mcp_server', target: entry.name, status: 'updated' })
        continue
      }
      // Name is taken by a row this plugin doesn't own (or free): only adopt
      // the plain name when it is free, otherwise store under a stable
      // disambiguated name so the foreign row keeps its configuration.
      const storageName = existing ? buildMarketMcpName(entry.name, context.pluginId) : entry.name
      const existingMarketRow = existing ? mcpServerService.findByIdOrName(storageName) : undefined
      if (existingMarketRow && existingMarketRow.registryUrl === context.registryUrl) {
        mcpServerService.update(existingMarketRow.id, { ...config, name: storageName })
        if (!refs.mcpIds.includes(existingMarketRow.id)) refs.mcpIds.push(existingMarketRow.id)
        results.push({ kind: 'mcp_server', target: storageName, status: 'updated' })
      } else if (existingMarketRow) {
        // The disambiguated slot is itself occupied by a foreign row — fail
        // this component instead of piling up duplicate-named rows.
        throw new Error(`mcp server name "${storageName}" is already used by another server`)
      } else {
        const created = mcpServerService.create({
          ...config,
          name: storageName,
          installSource: 'manual',
          isActive: false
        })
        refs.mcpIds.push(created.id)
        results.push({ kind: 'mcp_server', target: storageName, status: 'installed' })
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

/**
 * Exact-name assistant lookup that survives pagination: `search` narrows
 * server-side, but an exact match may sit beyond page 1, so walk pages until
 * found or exhausted (same page-until-found contract as
 * `applyEnterpriseConfig.listAllAssistantsByName`).
 */
async function findAssistantByName(name: string): Promise<Assistant | undefined> {
  const limit = ASSISTANT_SEARCH_PAGE_SIZE
  let page = 1
  for (;;) {
    const { items, total } = assistantDataService.list({ search: name, page, limit })
    const exact = items.find((assistant) => assistant.name === name)
    if (exact) return exact
    if (items.length === 0 || page * limit >= total) return undefined
    page++
  }
}

async function installAssistantComponents(
  context: InstallContext,
  manifest: MarketPluginManifest,
  refs: MarketInstalledRefs
): Promise<MarketComponentResult[]> {
  const results: MarketComponentResult[] = []
  // Snapshot the managed list once per install batch: enterprise-managed
  // assistants are read-only for the user — a name match must never overwrite
  // their prompt, be recorded in refs, or be archived at uninstall.
  const managedAssistantIds = new Set(loadManagedAssistantIds())
  for (const entry of manifest.assistants) {
    try {
      const existing = await findAssistantByName(entry.name)
      if (existing && managedAssistantIds.has(existing.id)) {
        logger.warn('Skipping marketplace assistant component: managed by enterprise', {
          pluginId: context.pluginId,
          assistant: entry.name
        })
        results.push({
          kind: 'assistant',
          target: entry.name,
          status: 'skipped',
          reason: MARKET_SKIP_REASONS.managedByEnterprise
        })
        continue
      }
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

    const refs: MarketInstalledRefs = emptyMarketRefs()
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
        refs,
        schemaVersion: installedRecordSchemaVersion()
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
        } else if (
          record.refs.skillSourceUrls?.[folderName] &&
          skill.sourceUrl !== record.refs.skillSourceUrls[folderName]
        ) {
          // Same folder name, different origin (e.g. a public-marketplace copy
          // installed over ours): the recorded gateway URL is the ownership
          // proof — never delete a folder we did not install.
          logger.warn('Skipping marketplace uninstall of a foreign-origin skill', {
            folderName,
            expected: record.refs.skillSourceUrls[folderName],
            actual: skill.sourceUrl
          })
          results.push({
            kind: 'skill',
            target: folderName,
            status: 'skipped',
            reason: MARKET_SKIP_REASONS.foreignOrigin
          })
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

    // Enterprise-managed assistants are read-only for the user: uninstalling a
    // market plugin must never archive one. Snapshotted once per batch.
    const managedAssistantIds = new Set(loadManagedAssistantIds())
    for (const assistantId of record.refs.assistantIds) {
      if (managedAssistantIds.has(assistantId)) {
        logger.warn('Skipping marketplace uninstall of managed assistant', { pluginId, assistantId })
        results.push({
          kind: 'assistant',
          target: assistantId,
          status: 'skipped',
          reason: MARKET_SKIP_REASONS.managedByEnterprise
        })
        continue
      }
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

    // Refs whose component was removed or skipped are pruned; failed ones stay
    // recorded so a retry can finish the job. The record itself only
    // disappears once EVERY ref was removed/skipped.
    const settled = new Set(
      results.filter((result) => result.status !== 'failed').map((result) => `${result.kind}:${result.target}`)
    )
    const survivingRefs: MarketInstalledRefs = {
      skillFolderNames: record.refs.skillFolderNames.filter((name) => !settled.has(`skill:${name}`)),
      skillSourceUrls: Object.fromEntries(
        Object.entries(record.refs.skillSourceUrls ?? {}).filter(([folderName]) => !settled.has(`skill:${folderName}`))
      ),
      mcpIds: record.refs.mcpIds.filter((id) => !settled.has(`mcp_server:${id}`)),
      assistantIds: record.refs.assistantIds.filter((id) => !settled.has(`assistant:${id}`)),
      minappAppIds: record.refs.minappAppIds.filter((appId) => !settled.has(`minapp:${appId}`))
    }

    const anyFailed = results.some((result) => result.status === 'failed')
    if (anyFailed) {
      await saveInstalledRecords(replaceInstalledRecord(records, pluginId, { ...record, refs: survivingRefs }))
    } else {
      await saveInstalledRecords(removeInstalledRecord(records, pluginId))
    }

    const ok = !anyFailed
    logger.info('Marketplace plugin uninstall finished', {
      pluginId,
      ok,
      results: results.map((result) => `${result.kind}:${result.target}:${result.status}`)
    })
    return { pluginId, results, ok }
  })
}
