import fs from 'node:fs'

import { net } from 'electron'

import { MAX_SKILL_SIZE } from '@main/ai/skills/skillArchive'
import { buildPluginFileUrl } from '@main/marketplace/types'
import { MARKETPLACE_PLUGIN_ID_REGEX } from '@shared/types/marketplace'

/**
 * Single-skill downloads from the enterprise gateway — the install source behind
 * `gateway:{pluginId}/{skillName}` handles. Deliberately a leaf module: the skill
 * installer (skillRemoteSource) imports it, and going through marketplaceService
 * would close a marketplaceService → SkillService → skillRemoteSource cycle.
 */

const PLUGIN_DETAIL_PATH = '/marketplace/api/plugins'
const FETCH_TIMEOUT_MS = 15_000

/** Gateway skill names are plugin-directory-style segments. */
const GATEWAY_SKILL_NAME_REGEX = /^[A-Za-z0-9_-]+$/

interface GatewayManifestSkill {
  name: string
  zip: string
}

/**
 * Minimal manifest probe: only the skills array matters here. The full manifest
 * schema lives in marketplaceService — re-validating narrowly keeps this module
 * a leaf (importing it would close the cycle described above).
 */
function readManifestSkills(payload: unknown): GatewayManifestSkill[] {
  if (!payload || typeof payload !== 'object') return []
  const skills = (payload as { skills?: unknown }).skills
  if (!Array.isArray(skills)) return []
  return skills.flatMap((entry) => {
    if (!entry || typeof entry !== 'object') return []
    const { name, zip } = entry as { name?: unknown; zip?: unknown }
    if (typeof name !== 'string' || typeof zip !== 'string' || !name || !zip) return []
    return [{ name, zip }]
  })
}

/**
 * Download one published skill zip from its gateway plugin pack.
 * The manifest round-trip both resolves the skill's zip path and proves the
 * skill actually belongs to the plugin named in the install handle — it runs
 * BEFORE `openTempDir`, so a rejected handle never writes to disk.
 */
export async function downloadGatewaySkillZip(
  pluginId: string,
  skillName: string,
  openTempDir: () => Promise<string>
): Promise<{ zipPath: string; fileUrl: string }> {
  if (!MARKETPLACE_PLUGIN_ID_REGEX.test(pluginId)) {
    throw new Error(`invalid marketplace plugin id: ${pluginId}`)
  }
  if (!GATEWAY_SKILL_NAME_REGEX.test(skillName)) {
    throw new Error(`invalid gateway skill name: ${skillName}`)
  }

  const { loadEnterpriseSettings } = await import('@main/enterprise/enterpriseSettings')
  const settings = loadEnterpriseSettings()
  if (settings.status !== 'enabled') {
    throw new Error(`marketplace disabled: ${settings.reason}`)
  }
  const { serverUrl, token } = settings

  const manifestResp = await net.fetch(`${serverUrl}${PLUGIN_DETAIL_PATH}/${encodeURIComponent(pluginId)}`, {
    headers: { 'X-Client-Token': token },
    redirect: 'follow',
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS)
  })
  if (!manifestResp.ok) {
    throw new Error(`gateway manifest failed: HTTP ${manifestResp.status} for ${pluginId}`)
  }
  const skills = readManifestSkills(await manifestResp.json())
  const entry = skills.find((skill) => skill.name === skillName)
  if (!entry) {
    throw new Error(`gateway plugin "${pluginId}" does not publish a skill named "${skillName}"`)
  }

  // Manifest resolved — only now is anything allowed to touch the disk.
  const destDir = await openTempDir()
  const fileUrl = buildPluginFileUrl(serverUrl, pluginId, entry.zip)
  const zipResp = await net.fetch(fileUrl, {
    headers: { 'X-Client-Token': token },
    redirect: 'follow',
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS)
  })
  if (!zipResp.ok) {
    throw new Error(`gateway skill download failed: HTTP ${zipResp.status} for ${entry.zip}`)
  }
  const advertisedSize = Number(zipResp.headers.get('content-length') ?? NaN)
  if (Number.isFinite(advertisedSize) && advertisedSize > MAX_SKILL_SIZE) {
    await zipResp.body?.cancel()
    throw new Error(
      `gateway skill "${entry.zip}" advertises ${advertisedSize} bytes, over the ${MAX_SKILL_SIZE}-byte limit`
    )
  }

  const zipPath = `${destDir}/skill.zip`
  const handle = await fs.promises.open(zipPath, 'w')
  try {
    let received = 0
    for await (const chunk of zipResp.body as unknown as AsyncIterable<Uint8Array>) {
      received += chunk.byteLength
      if (received > MAX_SKILL_SIZE) {
        throw new Error(`gateway skill "${entry.zip}" exceeds the ${MAX_SKILL_SIZE}-byte limit`)
      }
      for (let offset = 0; offset < chunk.byteLength;) {
        offset += (await handle.write(chunk, offset)).bytesWritten
      }
    }
  } finally {
    await handle.close()
  }

  return { zipPath, fileUrl }
}
