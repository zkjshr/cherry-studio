import { describe, expect, it } from 'vitest'

import { decideSyncAction, type SyncDecisionInput } from '../syncDecider'

function baseInput(overrides: Partial<SyncDecisionInput> = {}): SyncDecisionInput {
  return {
    httpStatus: 200,
    etagVersion: 3,
    lastAppliedVersion: 2,
    hasCache: true,
    appliedThisBoot: false,
    ...overrides
  }
}

describe('decideSyncAction', () => {
  it('returns apply_remote on HTTP 200', () => {
    expect(decideSyncAction(baseInput())).toBe('apply_remote')
  })

  it('returns apply_remote on 200 even when the version is unchanged (re-apply repairs drift)', () => {
    expect(decideSyncAction(baseInput({ etagVersion: 2, lastAppliedVersion: 2 }))).toBe('apply_remote')
  })

  it('returns touch on HTTP 304', () => {
    expect(decideSyncAction(baseInput({ httpStatus: 304, etagVersion: 2, lastAppliedVersion: 2 }))).toBe('touch')
  })

  it('degrades to apply_cache on network failure when nothing applied yet and a cache exists', () => {
    expect(decideSyncAction(baseInput({ httpStatus: null }))).toBe('apply_cache')
  })

  it('degrades to apply_cache on 5xx under the same conditions', () => {
    expect(decideSyncAction(baseInput({ httpStatus: 503 }))).toBe('apply_cache')
  })

  it('degrades to apply_cache on 4xx under the same conditions', () => {
    expect(decideSyncAction(baseInput({ httpStatus: 401 }))).toBe('apply_cache')
  })

  it('stays idle on failure when no cache exists', () => {
    expect(decideSyncAction(baseInput({ httpStatus: null, hasCache: false }))).toBe('idle')
  })

  it('stays idle on failure when the config was already applied this boot', () => {
    expect(decideSyncAction(baseInput({ httpStatus: 500, appliedThisBoot: true }))).toBe('idle')
  })

  it('stays idle on failure when both the cache is missing and the boot already applied', () => {
    expect(
      decideSyncAction(baseInput({ httpStatus: null, hasCache: false, appliedThisBoot: true, lastAppliedVersion: 7 }))
    ).toBe('idle')
  })
})
