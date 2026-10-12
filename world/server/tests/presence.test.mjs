import assert from 'node:assert/strict'
// v2 在场名单：players 仅含场景内 WS 会话（打开页面的人数）；
// 心跳客户端不再渲染坐班小人，仅计入 health.clients
import test from 'node:test'

import { startTestServer, joinPlayer, wsNext } from './helpers/test-server.js'

test('players 仅含场景内会话；心跳者不再出现（坐班小人已废弃）', async (t) => {
  const srv = await startTestServer()
  t.after(() => srv.close())

  await fetch(`${srv.base}/api/heartbeat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ cid: 'hb-worker' })
  })
  const { ws } = await joinPlayer(srv.wsBase, 'ws-worker')

  const players = await wsNext(ws, 'players')
  assert.equal(players.players.length, 1)
  const p = players.players[0]
  assert.equal(p.cid, 'ws-worker')
  assert.equal(p.x, 0)
  assert.equal(p.anim, 'idle')
  assert.equal(p.houseId, null)
  assert.equal(p.name, '同事-ws-w') // 无档案 → 同事-{cid前4位}

  ws.close()
})

test('health：online=场景内人数（打开页面），clients=心跳客户端数', async (t) => {
  const srv = await startTestServer()
  t.after(() => srv.close())

  await srv.app.store.upsertProfile('chief', '李工', '结构')
  await fetch(`${srv.base}/api/heartbeat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ cid: 'chief' })
  })
  const a = await joinPlayer(srv.wsBase, 'guest-a')
  const b = await joinPlayer(srv.wsBase, 'guest-b')

  const health = await (await fetch(`${srv.base}/api/health`)).json()
  assert.equal(health.ok, true)
  assert.equal(health.online, 2) // 打开页面的两个 WS 会话
  assert.equal(health.clients, 1) // 仅 chief 心跳着客户端

  // players 全量且只含场景会话（心跳的 chief 不在 players）
  const players = await wsNext(a.ws, 'players')
  const cids = players.players.map((p) => p.cid).sort()
  assert.deepEqual(cids, ['guest-a', 'guest-b'])
  a.ws.close()
  b.ws.close()
})

test('心跳窗口过期的客户端不计入 clients', async (t) => {
  const srv = await startTestServer()
  t.after(() => srv.close())

  srv.app.store.touchHeartbeat('stale-guy', Date.now() - 91_000)
  const { ws } = await joinPlayer(srv.wsBase, 'live-one')

  const health = await (await fetch(`${srv.base}/api/health`)).json()
  assert.equal(health.clients, 0)
  assert.equal(health.online, 1)

  ws.close()
})
