import { describe, expect, it } from 'vitest'

import {
  ENTERPRISE_MCP_NAME_PREFIX,
  ENTERPRISE_PROVIDER_PREFIX,
  filterEnterpriseMcpServerNames,
  isEnterpriseMcpServerName,
  isEnterpriseMiniAppId,
  isEnterpriseProviderId
} from '@shared/utils/enterprise'

import { toEnterpriseMcpHeaders } from '../enterpriseMappers'
import { validateEnterpriseConfigPayload } from '../enterpriseConfigTypes'

describe('enterprise namespace predicates', () => {
  it('matches provider ids with the enterprise prefix', () => {
    expect(ENTERPRISE_PROVIDER_PREFIX).toBe('enterprise-')
    expect(isEnterpriseProviderId('enterprise-gateway')).toBe(true)
    expect(isEnterpriseProviderId('enterprise-')).toBe(true)
    expect(isEnterpriseProviderId('gateway')).toBe(false)
    // The prefix must lead — a suffix match is a user-owned row.
    expect(isEnterpriseProviderId('my-enterprise-gateway')).toBe(false)
  })

  it('matches miniapp appIds with the enterprise prefix', () => {
    expect(isEnterpriseMiniAppId('enterprise-weknora-web')).toBe(true)
    expect(isEnterpriseMiniAppId('wechat')).toBe(false)
    expect(isEnterpriseMiniAppId('')).toBe(false)
  })

  it('matches MCP server storage names with the display prefix', () => {
    expect(ENTERPRISE_MCP_NAME_PREFIX).toBe('[企业] ')
    expect(isEnterpriseMcpServerName('[企业] weknora')).toBe(true)
    expect(isEnterpriseMcpServerName('weknora')).toBe(false)
    // No prefix, no badge — even when the name mentions the marker elsewhere.
    expect(isEnterpriseMcpServerName('my [企业] server')).toBe(false)
  })

  it('filters a mixed MCP name list down to the enterprise rows', () => {
    expect(filterEnterpriseMcpServerNames(['[企业] weknora', 'user-mcp', '[企业] ops'])).toEqual([
      '[企业] weknora',
      '[企业] ops'
    ])
    expect(filterEnterpriseMcpServerNames([])).toEqual([])
  })
})

describe('mcp_servers headers contract', () => {
  const baseConfig = {
    config_version: 1,
    mcp_servers: [{ name: 'weknora', type: 'sse', base_url: 'http://gw/mcp' }]
  }

  it('accepts and preserves a valid header map', () => {
    const config = validateEnterpriseConfigPayload({
      ...baseConfig,
      mcp_servers: [{ ...baseConfig.mcp_servers[0], headers: { 'X-Client-Token': 'abc' } }]
    })
    expect(config.mcp_servers?.[0].headers).toEqual({ 'X-Client-Token': 'abc' })
  })

  it('omits headers when the config does not carry them', () => {
    const config = validateEnterpriseConfigPayload({ ...baseConfig })
    expect(config.mcp_servers?.[0].headers).toBeUndefined()
  })

  it('rejects non-string header values (they feed raw HTTP requests)', () => {
    expect(() =>
      validateEnterpriseConfigPayload({
        ...baseConfig,
        mcp_servers: [{ ...baseConfig.mcp_servers[0], headers: { retries: 3 } }]
      })
    ).toThrow('mcp_servers[0].headers.retries must be a string')
  })

  it('rejects a non-object headers value', () => {
    expect(() =>
      validateEnterpriseConfigPayload({
        ...baseConfig,
        mcp_servers: [{ ...baseConfig.mcp_servers[0], headers: ['a'] }]
      })
    ).toThrow('mcp_servers[0].headers must be an object')
  })
})

describe('toEnterpriseMcpHeaders', () => {
  it('passes the config header map through verbatim', () => {
    const headers = { Authorization: 'Bearer tok', 'X-Client-Token': 'abc' }
    const mapped = toEnterpriseMcpHeaders(headers)
    expect(mapped).toEqual(headers)
    // A copy, not the caller's object — mutating the result must not leak back.
    expect(mapped).not.toBe(headers)
  })

  it('keeps undefined undefined so the caller can choose "leave unchanged"', () => {
    expect(toEnterpriseMcpHeaders(undefined)).toBeUndefined()
  })

  it('preserves an explicitly empty map (a deliberate clear)', () => {
    expect(toEnterpriseMcpHeaders({})).toEqual({})
  })
})
