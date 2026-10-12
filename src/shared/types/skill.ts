/**
 * Skill types shared between main and renderer processes.
 *
 * Zod schemas serve as both runtime validators and TypeScript type source.
 */

import * as z from 'zod'

// ============================================================================
// Search source registries
// ============================================================================

export const SkillSearchSourceSchema = z.enum([
  'claude-plugins.dev',
  'skills.sh',
  'clawhub.ai',
  'skillhub.cn',
  'github'
])
export type SkillSearchSource = z.infer<typeof SkillSearchSourceSchema>

// ============================================================================
// API response schemas — claude-plugins.dev
// ============================================================================

export const ClaudePluginsSkillItemSchema = z.object({
  id: z.string(),
  name: z.string(),
  namespace: z.string(),
  sourceUrl: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  version: z.string().nullable().optional(),
  author: z.string().nullable().optional(),
  stars: z.number().optional(),
  installs: z.number().optional(),
  metadata: z
    .object({
      repoOwner: z.string().optional(),
      repoName: z.string().optional(),
      directoryPath: z.string().optional(),
      rawFileUrl: z.string().optional()
    })
    .nullable()
    .optional(),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional()
})
export type ClaudePluginsSkillItem = z.infer<typeof ClaudePluginsSkillItemSchema>

export const ClaudePluginsSearchResponseSchema = z.object({
  skills: z.array(ClaudePluginsSkillItemSchema),
  total: z.number().optional(),
  limit: z.number().optional(),
  offset: z.number().optional()
})

// ============================================================================
// API response schemas — skills.sh
// ============================================================================

export const SkillsShSearchItemSchema = z.object({
  id: z.string(), // "owner/repo/skill-name"
  skillId: z.string(),
  name: z.string(),
  installs: z.number(),
  source: z.string() // "owner/repo"
})
export type SkillsShSearchItem = z.infer<typeof SkillsShSearchItemSchema>

export const SkillsShSearchResponseSchema = z.object({
  query: z.string(),
  skills: z.array(SkillsShSearchItemSchema),
  count: z.number()
})

// ============================================================================
// API response schemas — clawhub.ai
// ============================================================================

export const ClawhubSearchItemSchema = z.object({
  score: z.number(),
  slug: z.string(),
  displayName: z.string(),
  summary: z.string(),
  version: z.string().nullable(),
  updatedAt: z.number(),
  ownerHandle: z.string().optional()
})
export type ClawhubSearchItem = z.infer<typeof ClawhubSearchItemSchema>

export const ClawhubSearchResponseSchema = z.object({
  results: z.array(ClawhubSearchItemSchema)
})

export const ClawhubSkillDetailSchema = z.object({
  skill: z.object({
    slug: z.string(),
    displayName: z.string(),
    summary: z.string(),
    tags: z.record(z.string(), z.string()).optional(),
    stats: z
      .object({
        downloads: z.number().default(0),
        stars: z.number().default(0),
        installsAllTime: z.number().default(0)
      })
      .optional()
  }),
  owner: z
    .object({
      handle: z.string(),
      displayName: z.string(),
      image: z.string().nullable()
    })
    .nullable(),
  moderation: z
    .object({
      isSuspicious: z.boolean(),
      isMalwareBlocked: z.boolean(),
      verdict: z.string()
    })
    .nullable()
})
export type ClawhubSkillDetail = z.infer<typeof ClawhubSkillDetailSchema>

// ============================================================================
// API response schemas — skillhub.cn
// ============================================================================

/**
 * skillhub.cn search/showcase item. The search API serves `icon_url` while the
 * showcase APIs serve `iconUrl`; both stay optional so one schema covers both.
 * Unknown fields are stripped — the platform adds moderation/claim metadata we
 * deliberately do not rely on.
 */
export const SkillhubSkillItemSchema = z.object({
  slug: z.string(),
  name: z.string(),
  displayName: z.string().nullish(),
  description: z.string().nullish(),
  description_zh: z.string().nullish(),
  summary: z.string().nullish(),
  version: z.string().nullish(),
  author: z.string().nullish(),
  owner_name: z.string().nullish(),
  downloads: z.number().nullish(),
  installs: z.number().nullish(),
  stars: z.number().nullish(),
  category: z.string().nullish(),
  homepage: z.string().nullish(),
  icon_url: z.string().nullish(),
  iconUrl: z.string().nullish(),
  namespace: z
    .object({
      handle: z.string().nullish(),
      publicSlug: z.string().nullish()
    })
    .nullish()
})
export type SkillhubSkillItem = z.infer<typeof SkillhubSkillItemSchema>

export const SkillhubSearchResponseSchema = z.object({
  results: z.array(SkillhubSkillItemSchema)
})

export const SkillhubShowcaseResponseSchema = z.object({
  section: z.string(),
  skills: z.array(SkillhubSkillItemSchema)
})

// ============================================================================
// Unified skill search result (normalized across all sources)
// ============================================================================

export const SkillSearchResultSchema = z.object({
  slug: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  author: z.string().nullable(),
  stars: z.number().default(0),
  downloads: z.number().default(0),
  sourceRegistry: SkillSearchSourceSchema,
  sourceUrl: z.string().nullable().default(null), // URL to the skill's page on the registry
  iconUrl: z.string().nullable().default(null), // registry-hosted icon for market cards
  installSource: z.string() // opaque handle passed to install IPC
})
export type SkillSearchResult = z.infer<typeof SkillSearchResultSchema>

// ============================================================================
// Installed skill (returned from DB via IPC)
// ============================================================================

export const InstalledSkillSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  folderName: z.string(),
  source: z.string(),
  sourceUrl: z.string().nullable(),
  namespace: z.string().nullable(),
  author: z.string().nullable(),
  version: z.string().nullable(),
  sourceTags: z.array(z.string()).default([]),
  contentHash: z.string(),
  isGlobalEnabled: z.boolean(),
  isEnabled: z.boolean(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime()
})
export type InstalledSkill = z.infer<typeof InstalledSkillSchema>

export const SkillRemoteUpdateCheckSchema = z.discriminatedUnion('state', [
  z.strictObject({
    state: z.literal('unsupported'),
    reason: z.enum(['not_remote', 'missing_provenance'])
  }),
  z.strictObject({
    state: z.literal('up_to_date'),
    localChanges: z.boolean(),
    remoteVersion: z.string().nullable()
  }),
  z.strictObject({
    state: z.literal('available'),
    localChanges: z.boolean(),
    remoteVersion: z.string().nullable(),
    revision: z.string().min(1)
  })
])
export type SkillRemoteUpdateCheck = z.infer<typeof SkillRemoteUpdateCheckSchema>

// ============================================================================
// IPC option types
// ============================================================================

export interface SkillInstallOptions {
  installSource: string
}

export interface SkillToggleOptions {
  skillId: string
  agentId: string
  isEnabled: boolean
}

export interface SkillInstallFromZipOptions {
  zipFilePath: string
}

/** Marketplace (E5) zip install: provenance comes from the enterprise gateway. */
export interface SkillInstallFromMarketplaceZipOptions {
  zipFilePath: string
  /** Gateway file URL (`/marketplace/api/plugins/{id}/files/...`) recorded as provenance. */
  sourceUrl: string
}

export interface SkillInstallFromDirectoryOptions {
  directoryPath: string
}

export interface SkillImportSystemOptions {
  directoryPath: string
}

export type SkillResult<T> = { success: true; data: T } | { success: false; error: unknown }

// ============================================================================
// Workspace skill metadata (from .claude/skills)
// ============================================================================

export interface LocalSkill {
  name: string
  description?: string
  filename: string
}

export interface SystemSkillPlacement {
  sourceId: string
  sourceName: string
  directoryPath: string
}

export type SystemSkillStatus = 'available' | 'registered' | 'conflict'

/** A skill found in a known system-level CLI skill directory. */
export interface SystemSkillCandidate {
  id: string
  name: string
  description?: string
  filename: string
  directoryPath: string
  placements: SystemSkillPlacement[]
  status: SystemSkillStatus
  registeredSkillId?: string
}

/** Installed catalog entry enriched by the filesystem-owned skill workflow. */
export type SkillCatalogEntry = InstalledSkill & { scope: 'system' | 'builtin' | 'local' }
