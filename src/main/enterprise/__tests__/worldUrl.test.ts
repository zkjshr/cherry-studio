import { beforeEach, describe, expect, it, vi } from 'vitest'

const { dbMock } = vi.hoisted(() => ({
  dbMock: { current: { getDb: (): unknown => undefined } }
}))

vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  return mockApplicationFactory({
    // Stable indirection: the factory snapshots this object once at import,
    // the tests swap `dbMock.current` per case.
    DbService: { getDb: () => dbMock.current.getDb() }
  })
})

import { validateEnterpriseConfigPayload, toEnterpriseWorldUrl } from '../enterpriseConfigTypes'
import { loadEnterpriseWorldUrl } from '../worldUrl'

/** A drizzle-ish select chain resolving to `rows`. */
function dbReturning(rows: unknown[]) {
  const all = vi.fn(() => rows)
  const limit = vi.fn(() => ({ all }))
  const where = vi.fn(() => ({ limit }))
  const from = vi.fn(() => ({ where }))
  const select = vi.fn(() => ({ from }))
  return {
    getDb: () => ({ select }),
    spies: { select, from, where, limit, all }
  }
}

beforeEach(() => {
  dbMock.current = { getDb: () => undefined } as unknown as { getDb: () => unknown }
})

describe('toEnterpriseWorldUrl', () => {
  it('treats absent and blank values as not deployed', () => {
    expect(toEnterpriseWorldUrl(undefined)).toBeUndefined()
    expect(toEnterpriseWorldUrl('')).toBeUndefined()
    expect(toEnterpriseWorldUrl('   ')).toBeUndefined()
  })

  it('keeps a valid http(s) URL and strips trailing slashes', () => {
    expect(toEnterpriseWorldUrl('http://66.12:8788')).toBe('http://66.12:8788')
    expect(toEnterpriseWorldUrl('https://world.tjad.cn///')).toBe('https://world.tjad.cn')
  })

  it('rejects non-strings and non-http(s) schemes (webview + heartbeat base URL)', () => {
    expect(() => toEnterpriseWorldUrl(42)).toThrow('world_url must be a string')
    expect(() => toEnterpriseWorldUrl('ftp://world.test')).toThrow('world_url must be an http(s) URL')
    expect(() => toEnterpriseWorldUrl('javascript:alert(1)')).toThrow('world_url must be an http(s) URL')
  })
})

describe('validateEnterpriseConfigPayload world_url passthrough', () => {
  const base = { config_version: 1 }

  it('keeps a configured world_url (normalized)', () => {
    const config = validateEnterpriseConfigPayload({ ...base, world_url: 'http://w.test:8788/' })
    expect(config.world_url).toBe('http://w.test:8788')
  })

  it('drops a blank world_url — same semantics as a missing key', () => {
    const config = validateEnterpriseConfigPayload({ ...base, world_url: '  ' })
    expect('world_url' in config).toBe(false)
  })

  it('omits the key when the gateway did not send one', () => {
    const config = validateEnterpriseConfigPayload({ ...base })
    expect('world_url' in config).toBe(false)
  })

  it('rejects a malformed world_url so a broken publish fails loudly', () => {
    expect(() => validateEnterpriseConfigPayload({ ...base, world_url: 'not-a-url' })).toThrow(
      'world_url must be an http(s) URL'
    )
  })
})

describe('loadEnterpriseWorldUrl', () => {
  it('reads the stored URL row', () => {
    dbMock.current = dbReturning([{ value: 'http://w.test:8788' }]) as unknown as { getDb: () => unknown }
    expect(loadEnterpriseWorldUrl()).toBe('http://w.test:8788')
  })

  it('returns null for a missing, empty, or malformed row', () => {
    dbMock.current = dbReturning([]) as unknown as { getDb: () => unknown }
    expect(loadEnterpriseWorldUrl()).toBeNull()

    dbMock.current = dbReturning([{ value: '' }]) as unknown as { getDb: () => unknown }
    expect(loadEnterpriseWorldUrl()).toBeNull()

    dbMock.current = dbReturning([{ value: 42 }]) as unknown as { getDb: () => unknown }
    expect(loadEnterpriseWorldUrl()).toBeNull()

    dbMock.current = dbReturning([{}]) as unknown as { getDb: () => unknown }
    expect(loadEnterpriseWorldUrl()).toBeNull()
  })

  it('degrades to null when the preference row cannot be read (never throws)', () => {
    dbMock.current = {
      getDb: () => {
        throw new Error('db gone')
      }
    }
    expect(loadEnterpriseWorldUrl()).toBeNull()
  })
})
