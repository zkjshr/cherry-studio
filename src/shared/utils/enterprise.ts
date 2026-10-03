/**
 * Enterprise resource namespace — the single source of truth for the prefixes
 * that mark enterprise-managed rows (providers, MCP servers, miniapps) plus
 * the predicate helpers built on them.
 *
 * Shared between the main process (config applier, state snapshot) and the
 * renderer (read-only guards + 「企业」 badges), so both sides can never drift.
 */

/** Forced provider-id namespace for every enterprise-managed provider row. */
export const ENTERPRISE_PROVIDER_PREFIX = 'enterprise-'

/** Forced appId namespace for enterprise-managed miniapps (same prefix rule). */
export const ENTERPRISE_MINIAPP_PREFIX = 'enterprise-'

/** Display/storage name prefix for an enterprise MCP server, avoiding user-server collisions. */
export const ENTERPRISE_MCP_NAME_PREFIX = '[企业] '

/** Preference key (scope `default`) holding the managed assistant UUID list. */
export const ENTERPRISE_MANAGED_ASSISTANT_IDS_KEY = 'enterprise.managed_assistant_ids'

/**
 * Read-only predicates — deliberately type-tolerant (`typeof` guard) because
 * they run against DB-backed rows that may be corrupt at runtime (e.g. a
 * non-string name crashing an MCP card must fall through as "not managed",
 * never throw past the ErrorBoundary).
 */

/** True when the provider id lives in the enterprise namespace. */
export function isEnterpriseProviderId(providerId: string): boolean {
  return typeof providerId === 'string' && providerId.startsWith(ENTERPRISE_PROVIDER_PREFIX)
}

/** True when the miniapp appId lives in the enterprise namespace. */
export function isEnterpriseMiniAppId(appId: string): boolean {
  return typeof appId === 'string' && appId.startsWith(ENTERPRISE_MINIAPP_PREFIX)
}

/** True when the MCP server storage name carries the enterprise prefix. */
export function isEnterpriseMcpServerName(name: string): boolean {
  return typeof name === 'string' && name.startsWith(ENTERPRISE_MCP_NAME_PREFIX)
}

/** Keep only the MCP server names that live in the enterprise namespace. */
export function filterEnterpriseMcpServerNames(names: readonly string[]): string[] {
  return names.filter(isEnterpriseMcpServerName)
}
