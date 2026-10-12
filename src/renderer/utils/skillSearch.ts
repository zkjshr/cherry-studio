import { loggerService } from '@logger'
import type { SkillSearchResult } from '@shared/types/skill'
import {
  normalizeSkillhub,
  normalizeSkillhubShowcase,
  searchSkillMarketplaces,
  SKILL_SEARCH_FAILED_ERROR as SHARED_SKILL_SEARCH_FAILED_ERROR
} from '@shared/utils/skillMarketplace'

const logger = loggerService.withContext('skillSearch')

const REQUEST_TIMEOUT_MS = 15_000
export const SKILL_SEARCH_FAILED_ERROR = SHARED_SKILL_SEARCH_FAILED_ERROR

// ===========================================================================
// Fetch helpers
// ===========================================================================

async function fetchWithTimeout(url: string, init?: RequestInit): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  try {
    return await fetch(url, { ...init, signal: controller.signal })
  } finally {
    clearTimeout(timer)
  }
}

async function fetchJson(url: string): Promise<unknown> {
  const resp = await fetchWithTimeout(url)
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
  return resp.json()
}

// ===========================================================================
// Public API
// ===========================================================================

/**
 * Search all 4 skill registries.
 * Preserves partial success, but rejects when every source fails.
 */
export async function searchSkills(query: string): Promise<SkillSearchResult[]> {
  return searchSkillMarketplaces(query, fetchJson, (source, error) => {
    logger.warn(`${source} search failed`, {
      error: error instanceof Error ? error.message : String(error)
    })
  })
}

// ===========================================================================
// skillhub.cn direct endpoints (showcase rankings + single-source search)
// ===========================================================================

export type SkillhubShowcaseSection = 'hot' | 'featured' | 'newest' | 'recommended'

/**
 * skillhub.cn showcase ranking, normalized to the shared search result shape.
 * Separate from `searchSkills`: the market page renders these lists directly as
 * SkillHub-branded sections instead of mixing every registry together.
 */
export async function fetchSkillhubShowcase(section: SkillhubShowcaseSection): Promise<SkillSearchResult[]> {
  const json = await fetchJson(`https://api.skillhub.cn/api/v1/showcase/${section}`)
  return normalizeSkillhubShowcase(json)
}

/** skillhub.cn-only search, for the market page's skills tab search box. */
export async function searchSkillhub(query: string): Promise<SkillSearchResult[]> {
  const url = new URL('https://api.skillhub.cn/api/v1/search')
  url.searchParams.set('q', query.trim())
  url.searchParams.set('page_size', '20')
  const json = await fetchJson(url.toString())
  return normalizeSkillhub(json)
}
