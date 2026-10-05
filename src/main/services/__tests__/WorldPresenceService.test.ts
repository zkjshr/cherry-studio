import { mkdtempSync, existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { netFetchMock, worldUrlMock, settingsMock, presenceDir } = vi.hoisted(() => ({
  netFetchMock: vi.fn(),
  worldUrlMock: vi.fn<() => string | null>(),
  settingsMock: vi.fn(),
  presenceDir: { current: '' }
}))

// BaseService (via @main/core/lifecycle) imports ipcMain from electron at module load.
vi.mock('electron', () => ({
  net: { fetch: netFetchMock },
  ipcMain: { handle: vi.fn(), removeHandler: vi.fn(), on: vi.fn(), removeListener: vi.fn() }
}))

vi.mock('@main/enterprise/enterpriseSettings', () => ({ loadEnterpriseSettings: settingsMock }))
vi.mock('@main/enterprise/worldUrl', () => ({ loadEnterpriseWorldUrl: worldUrlMock }))

vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  const result = mockApplicationFactory()
  result.application.getPath.mockImplementation((_key: string, filename?: string) =>
    filename ? path.join(presenceDir.current, filename) : presenceDir.current
  )
  return result
})

import { BaseService } from '@main/core/lifecycle'

import { parsePresenceFile, WorldPresenceService } from '../WorldPresenceService'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

const enterpriseEnabled = (token: string) =>
  settingsMock.mockReturnValue({ status: 'enabled', serverUrl: 'http://gw.test', token })
const enterpriseDisabled = () => settingsMock.mockReturnValue({ status: 'disabled', reason: 'off' })

/** The heartbeat round is private; tests drive it through the same path onAllReady uses. */
const beat = (svc: WorldPresenceService) => (svc as unknown as { beat(): Promise<void> }).beat()

beforeEach(() => {
  BaseService.resetInstances()
  presenceDir.current = mkdtempSync(path.join(tmpdir(), 'world-presence-'))
  netFetchMock.mockReset()
  worldUrlMock.mockReset().mockReturnValue(null)
  enterpriseDisabled()
})

afterEach(() => {
  rmSync(presenceDir.current, { recursive: true, force: true })
})

describe('WorldPresenceService cid persistence', () => {
  it('mints a uuid and persists it to userData/world-presence.json', async () => {
    const svc = new WorldPresenceService()
    const cid = svc.getCid()
    expect(cid).toMatch(UUID_RE)

    const file = path.join(presenceDir.current, 'world-presence.json')
    await vi.waitFor(() => expect(existsSync(file)).toBe(true))
    expect(JSON.parse(readFileSync(file, 'utf-8'))).toEqual({ cid })
  })

  it('reloads the stored cid on the next boot instead of minting a new one', async () => {
    const cid = new WorldPresenceService().getCid()
    const file = path.join(presenceDir.current, 'world-presence.json')
    await vi.waitFor(() => expect(existsSync(file)).toBe(true))
    BaseService.resetInstances()
    expect(new WorldPresenceService().getCid()).toBe(cid)
  })

  it('recovers from a corrupt presence file with a fresh cid', () => {
    writeFileSync(path.join(presenceDir.current, 'world-presence.json'), '{ not json')
    const cid = new WorldPresenceService().getCid()
    expect(cid).toMatch(UUID_RE)
  })

  it('rejects a presence file whose cid is not a string', () => {
    expect(parsePresenceFile('{"cid":42}')).toBeNull()
    expect(parsePresenceFile('[]')).toBeNull()
    expect(parsePresenceFile(null)).toBeNull()
    expect(parsePresenceFile('{"cid":"c-1"}')).toEqual({ cid: 'c-1' })
  })
})

describe('WorldPresenceService.getConfig', () => {
  it('reports disabled with a null url when the gateway published no world_url', () => {
    const cfg = new WorldPresenceService().getConfig()
    expect(cfg).toEqual({ enabled: false, url: null, cid: expect.stringMatching(UUID_RE), token: '' })
  })

  it('passes the world url and enterprise token through when deployed', () => {
    worldUrlMock.mockReturnValue('http://w.test:8788')
    enterpriseEnabled('gw-token')
    const cfg = new WorldPresenceService().getConfig()
    expect(cfg.enabled).toBe(true)
    expect(cfg.url).toBe('http://w.test:8788')
    expect(cfg.token).toBe('gw-token')
  })

  it('carries an empty token when the enterprise source is disabled', () => {
    worldUrlMock.mockReturnValue('http://w.test:8788')
    enterpriseDisabled()
    expect(new WorldPresenceService().getConfig().token).toBe('')
  })
})

describe('WorldPresenceService heartbeat', () => {
  it('posts {cid} with X-Client-Token to {worldUrl}/api/heartbeat and records success', async () => {
    worldUrlMock.mockReturnValue('http://w.test:8788')
    enterpriseEnabled('gw-token')
    netFetchMock.mockResolvedValue({ ok: true, status: 204 })

    const svc = new WorldPresenceService()
    await beat(svc)

    expect(netFetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = netFetchMock.mock.calls[0]
    expect(url).toBe('http://w.test:8788/api/heartbeat')
    expect(init.method).toBe('POST')
    expect(init.headers['X-Client-Token']).toBe('gw-token')
    expect(JSON.parse(init.body)).toEqual({ cid: svc.getCid() })
    expect(init.signal).toBeInstanceOf(AbortSignal)

    const info = svc.getPresenceInfo()
    expect(info.lastHeartbeatAt).not.toBeNull()
    expect(info.lastError).toBeNull()
    expect(info.worldUrl).toBe('http://w.test:8788')
  })

  it('records a failure without throwing (warn-and-continue, no retry storm)', async () => {
    worldUrlMock.mockReturnValue('http://w.test:8788')
    enterpriseEnabled('gw-token')
    netFetchMock.mockRejectedValue(new Error('connect EHOSTUNREACH'))

    const svc = new WorldPresenceService()
    await expect(beat(svc)).resolves.toBeUndefined()

    const info = svc.getPresenceInfo()
    expect(info.lastError).toBe('connect EHOSTUNREACH')
    expect(info.lastHeartbeatAt).toBeNull()
  })

  it('treats a non-2xx response as a failed beat', async () => {
    worldUrlMock.mockReturnValue('http://w.test:8788')
    netFetchMock.mockResolvedValue({ ok: false, status: 401 })

    const svc = new WorldPresenceService()
    await beat(svc)
    expect(svc.getPresenceInfo().lastError).toContain('401')
  })

  it('is a no-op while no world is deployed (never fetches)', async () => {
    worldUrlMock.mockReturnValue(null)
    const svc = new WorldPresenceService()
    await beat(svc)
    expect(netFetchMock).not.toHaveBeenCalled()
    expect(svc.getPresenceInfo()).toMatchObject({ worldUrl: null, lastHeartbeatAt: null, lastError: null })
  })

  it('skips a beat while the previous one is still in flight (no pile-up)', async () => {
    worldUrlMock.mockReturnValue('http://w.test:8788')
    let release!: (v: unknown) => void
    netFetchMock.mockReturnValue(
      new Promise((resolve) => {
        release = resolve
      })
    )

    const svc = new WorldPresenceService()
    const first = beat(svc)
    await beat(svc) // overlaps the first → skipped
    expect(netFetchMock).toHaveBeenCalledTimes(1)
    release({ ok: true, status: 204 })
    await first
    expect(netFetchMock).toHaveBeenCalledTimes(1)
  })
})
