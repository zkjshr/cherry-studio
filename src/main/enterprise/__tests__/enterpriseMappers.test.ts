import { describe, expect, it } from 'vitest'

import { LATEST_PRIVACY_POLICY_VERSION } from '@shared/utils/constants'

import {
  computeEnterpriseOnboardingUpdates,
  computeModelReconcileDiff,
  parseEnterpriseModelRef,
  sanitizeEnterpriseAppId,
  toEnterpriseUniqueModelId,
  withEnterpriseMcpNamePrefix,
  withEnterprisePrefix
} from '../enterpriseMappers'

describe('withEnterprisePrefix', () => {
  it('prefixes a bare provider id', () => {
    expect(withEnterprisePrefix('gateway')).toBe('enterprise-gateway')
  })

  it('is idempotent — an already-prefixed id is not double-prefixed', () => {
    expect(withEnterprisePrefix('enterprise-gateway')).toBe('enterprise-gateway')
  })

  it('trims surrounding whitespace before prefixing', () => {
    expect(withEnterprisePrefix('  gateway  ')).toBe('enterprise-gateway')
  })

  it('returns an empty string for a blank id', () => {
    expect(withEnterprisePrefix('   ')).toBe('')
  })
})

describe('sanitizeEnterpriseAppId', () => {
  it('prefixes and keeps legal characters untouched', () => {
    expect(sanitizeEnterpriseAppId('kb-portal_1')).toBe('enterprise-kb-portal_1')
  })

  it('replaces characters outside [A-Za-z0-9_-] with dashes', () => {
    expect(sanitizeEnterpriseAppId('ops portal')).toBe('enterprise-ops-portal')
    // prefix dash + one dash per non-legal char
    expect(sanitizeEnterpriseAppId('中文')).toBe('enterprise---')
  })

  it('is idempotent — sanitized ids pass through unchanged', () => {
    const once = sanitizeEnterpriseAppId('ops portal')
    expect(sanitizeEnterpriseAppId(once)).toBe(once)
  })

  it('returns an empty string for a blank id', () => {
    expect(sanitizeEnterpriseAppId('   ')).toBe('')
  })
})

describe('withEnterpriseMcpNamePrefix', () => {
  it('namespaces the storage name to avoid colliding with user servers', () => {
    expect(withEnterpriseMcpNamePrefix('weknora')).toBe('[企业] weknora')
  })
})

describe('parseEnterpriseModelRef', () => {
  it('parses the slash-separated config style and forces the provider prefix', () => {
    expect(parseEnterpriseModelRef('gateway/gpt-x')).toEqual({
      providerId: 'enterprise-gateway',
      modelId: 'gpt-x'
    })
  })

  it('parses the UniqueModelId style', () => {
    expect(parseEnterpriseModelRef('gateway::gpt-x')).toEqual({
      providerId: 'enterprise-gateway',
      modelId: 'gpt-x'
    })
  })

  it('splits slash refs at the FIRST slash so model ids may contain slashes', () => {
    expect(parseEnterpriseModelRef('gateway/openai/gpt-x')).toEqual({
      providerId: 'enterprise-gateway',
      modelId: 'openai/gpt-x'
    })
  })

  it('accepts an already-prefixed provider id', () => {
    expect(parseEnterpriseModelRef('enterprise-gateway/gpt-x')?.providerId).toBe('enterprise-gateway')
  })

  it('returns null for malformed refs', () => {
    expect(parseEnterpriseModelRef('no-separator')).toBeNull()
    expect(parseEnterpriseModelRef('/model-only')).toBeNull()
    expect(parseEnterpriseModelRef('gateway/')).toBeNull()
    expect(parseEnterpriseModelRef('')).toBeNull()
  })
})

describe('toEnterpriseUniqueModelId', () => {
  it('builds the UniqueModelId used as the user_model PK and preference value', () => {
    expect(toEnterpriseUniqueModelId('gateway/gpt-x')).toBe('enterprise-gateway::gpt-x')
  })

  it('returns null when the modelId carries a reserved route character', () => {
    expect(toEnterpriseUniqueModelId('gateway/gpt-x#fragment')).toBeNull()
    expect(toEnterpriseUniqueModelId('gateway/gpt-x?filter=1')).toBeNull()
  })
})

describe('computeModelReconcileDiff', () => {
  it('computes additions and removals from the desired set', () => {
    const diff = computeModelReconcileDiff(['a', 'b', 'c'], ['b', 'c', 'd'])
    expect(diff).toEqual({ toAddIds: ['d'], toRemoveIds: ['a'] })
  })

  it('yields an empty diff for equal sets — repeated applies never duplicate rows', () => {
    const desired = ['m1', 'm2']
    expect(computeModelReconcileDiff(desired, desired)).toEqual({ toAddIds: [], toRemoveIds: [] })
  })

  it('marks every current model for removal when the config stops listing models', () => {
    expect(computeModelReconcileDiff(['m1', 'm2'], [])).toEqual({ toAddIds: [], toRemoveIds: ['m1', 'm2'] })
  })

  it('marks every desired model for addition on a fresh provider', () => {
    expect(computeModelReconcileDiff([], ['m1'])).toEqual({ toAddIds: ['m1'], toRemoveIds: [] })
  })

  it('ignores duplicates within the desired list (set semantics)', () => {
    expect(computeModelReconcileDiff(['m1'], ['m1', 'm1'])).toEqual({ toAddIds: [], toRemoveIds: [] })
  })
})

describe('computeEnterpriseOnboardingUpdates', () => {
  it('completes setup and fills the privacy version on a fresh install (pending + empty)', () => {
    expect(computeEnterpriseOnboardingUpdates('pending', '')).toEqual({
      'app.onboarding.provider_setup.status': 'completed',
      'app.privacy.policy_version': LATEST_PRIVACY_POLICY_VERSION
    })
  })

  it('treats an unexpected status value as not yet settled (DB rows can be corrupt)', () => {
    expect(computeEnterpriseOnboardingUpdates(undefined, undefined)).toEqual({
      'app.onboarding.provider_setup.status': 'completed',
      'app.privacy.policy_version': LATEST_PRIVACY_POLICY_VERSION
    })
  })

  it('keeps a status the user already settled', () => {
    expect(computeEnterpriseOnboardingUpdates('skipped', '')).toEqual({
      'app.privacy.policy_version': LATEST_PRIVACY_POLICY_VERSION
    })
  })

  it('keeps a recorded privacy version so a future policy bump still surfaces the update gate', () => {
    expect(computeEnterpriseOnboardingUpdates('pending', '20250101')).toEqual({
      'app.onboarding.provider_setup.status': 'completed'
    })
  })

  it('returns null when nothing needs writing — repeated applies stay no-ops', () => {
    expect(computeEnterpriseOnboardingUpdates('completed', LATEST_PRIVACY_POLICY_VERSION)).toBeNull()
  })
})
