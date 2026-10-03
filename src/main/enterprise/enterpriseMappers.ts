/**
 * Pure mapping helpers for the enterprise config pipeline.
 *
 * Everything here is side-effect free so the id-normalization and diff rules
 * can be unit tested without touching the database (see `__tests__`). The
 * applier (`applyEnterpriseConfig.ts`) composes these with the data services.
 */

import { createUniqueModelId, type UniqueModelId } from '@shared/data/types/model'
import {
  ENTERPRISE_MCP_NAME_PREFIX,
  ENTERPRISE_PROVIDER_PREFIX,
  filterEnterpriseMcpServerNames,
  isEnterpriseMcpServerName,
  isEnterpriseMiniAppId,
  isEnterpriseProviderId
} from '@shared/utils/enterprise'

/** Forced provider-id namespace for every enterprise-managed provider row. */
export { ENTERPRISE_MCP_NAME_PREFIX, ENTERPRISE_PROVIDER_PREFIX }

export {
  filterEnterpriseMcpServerNames,
  isEnterpriseMcpServerName,
  isEnterpriseMiniAppId,
  isEnterpriseProviderId
}

/** Legal appId characters — mirrors `MINI_APP_ID_REGEX` in @shared/data/api/schemas/miniApps. */
const MINI_APP_ID_REGEX = /^[A-Za-z0-9_-]+$/
const MINI_APP_ID_ILLEGAL_CHARS = /[^A-Za-z0-9_-]/g

/**
 * Normalize a config provider id into the enterprise namespace.
 *
 * Idempotent: an id that already carries the prefix passes through unchanged,
 * so repeated applies never produce `enterprise-enterprise-x`.
 */
export function withEnterprisePrefix(rawId: string): string {
  const id = rawId.trim()
  if (id.length === 0) return ''
  return id.startsWith(ENTERPRISE_PROVIDER_PREFIX) ? id : `${ENTERPRISE_PROVIDER_PREFIX}${id}`
}

/**
 * Build a legal miniapp appId for an enterprise entry: `enterprise-{id}` with
 * every character outside `[A-Za-z0-9_-]` replaced by `-` (the storage layer
 * rejects any other character). Idempotent for already-sanitized ids.
 *
 * Returns an empty string when nothing usable remains (caller decides whether
 * that is fatal).
 */
export function sanitizeEnterpriseAppId(rawId: string): string {
  const prefixed = withEnterprisePrefix(rawId)
  const sanitized = prefixed.replace(MINI_APP_ID_ILLEGAL_CHARS, '-')
  if (MINI_APP_ID_REGEX.test(sanitized)) return sanitized
  return ''
}

/** Display/storage name for an enterprise MCP server, namespaced to avoid colliding with user servers. */
export function withEnterpriseMcpNamePrefix(name: string): string {
  return `${ENTERPRISE_MCP_NAME_PREFIX}${name}`
}

/**
 * Map config `mcp_servers[].headers` onto the `mcp_server.headers` DTO field.
 * Passes the validated map through verbatim; `undefined` stays `undefined`
 * (caller decides between "leave unchanged" and an explicit `{}` clear).
 */
export function toEnterpriseMcpHeaders(headers: Record<string, string> | undefined): Record<string, string> | undefined {
  if (headers === undefined) return undefined
  return { ...headers }
}

/**
 * Parse a config model reference into `{ providerId, modelId }` with the
 * provider id forced into the enterprise namespace.
 *
 * Accepted shapes (gateway contract keeps `::` legal but awkward in JSON, so
 * both spellings are tolerated):
 * - `"{providerId}::{modelId}"` (UniqueModelId style)
 * - `"{providerId}/{modelId}"` (config style, split at the FIRST slash)
 *
 * Returns null for malformed refs (missing separator, empty parts).
 */
export function parseEnterpriseModelRef(ref: string): { providerId: string; modelId: string } | null {
  const trimmed = ref.trim()
  const separatorIndex = trimmed.includes('::') ? trimmed.indexOf('::') : trimmed.indexOf('/')
  if (separatorIndex <= 0) return null

  const rawProviderId = trimmed.slice(0, separatorIndex)
  const modelId = trimmed.slice(separatorIndex + (trimmed.startsWith('::', separatorIndex) ? 2 : 1)).trim()
  const providerId = withEnterprisePrefix(rawProviderId)
  if (providerId.length === 0 || modelId.length === 0) return null
  return { providerId, modelId }
}

/**
 * Resolve a config model reference to the UniqueModelId of the enterprise
 * model row created for it (`{enterprise-providerId}::{modelId}`).
 * Returns null when the ref is malformed or the modelId carries a reserved
 * route character (`createUniqueModelId` rejects those) — caller decides
 * whether that is fatal.
 */
export function toEnterpriseUniqueModelId(ref: string): UniqueModelId | null {
  const parsed = parseEnterpriseModelRef(ref)
  if (!parsed) return null
  try {
    return createUniqueModelId(parsed.providerId, parsed.modelId)
  } catch {
    return null
  }
}

export interface ModelReconcileDiff {
  /** Desired model ids absent from the current provider row set. */
  toAddIds: string[]
  /** Current model ids that the desired set no longer lists. */
  toRemoveIds: string[]
}

/**
 * Diff the current `user_model` ids of one provider against the desired
 * config set. Empty diff on equal sets — this is what makes a repeated apply
 * a no-op instead of a unique-constraint violation on re-insert.
 */
export function computeModelReconcileDiff(
  currentModelIds: readonly string[],
  desiredModelIds: readonly string[]
): ModelReconcileDiff {
  const currentSet = new Set(currentModelIds)
  const desiredSet = new Set(desiredModelIds)

  return {
    toAddIds: desiredModelIds.filter((id) => !currentSet.has(id)),
    toRemoveIds: currentModelIds.filter((id) => !desiredSet.has(id))
  }
}
