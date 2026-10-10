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
 * Preference key (scope `default`) holding the enterprise pinned-topic mapping
 * (`assistantId -> { topicId }`) — the conversation the gateway ships with a
 * managed assistant, to be created and pinned by the enterprise config applier.
 *
 * NOTE: this branch has NO writer for this row yet — the writer lives in the
 * enterprise pinned-topic pipeline (applyEnterpriseConfig 的置顶话题链路，落地于
 * 后续改动). Until that lands the row never exists, so the reader
 * (`findPinnedManagedTopicId` in main's sharedKbs service) always returns null,
 * `chatTopicId` stays null, and the shared-KB detail page hides its「去对话检索」
 * action (forward-compatible degradation). The key is declared here so the
 * future writer and the reader cannot drift on the row's name or shape (same
 * pattern as `ENTERPRISE_WORLD_URL_KEY`).
 */
export const ENTERPRISE_PINNED_TOPICS_KEY = 'enterprise.pinned_topics'

/**
 * Preference key (scope `default`) holding the Little World (小世界) service URL.
 * Written by `applyEnterpriseConfig` from the config's top-level `world_url`
 * (empty string = not deployed); read by the state snapshot and the
 * WorldPresenceService heartbeat. Shared so main's writer and readers cannot
 * drift from the gateway's `world_url` contract.
 */
export const ENTERPRISE_WORLD_URL_KEY = 'enterprise.world_url'

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
