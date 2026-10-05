import assert from 'node:assert/strict'
// 在场名单合并：WS 会话（scene=true）+ 心跳在线者（scene=false 坐班）→ 同一 players 列表；health 指标
import test from 'node:test'

import { startTestServer, joinPlayer, wsNext } from './helpers/test-server.js'

test('仅心跳在线者以 scene:false 出现在 players（坐班小人）', async (t) => {
  const srv = await startTestServer()
  t.after(() => srv.close())

  // hb-worker 只发心跳，从不进场景；ws-worker 在场景中
  await fetch(`${srv.base}/api/heartbeat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ cid: 'hb-worker' })
  })
  const { ws } = await joinPlayer(srv.wsBase, 'ws-worker')

  const players = await wsNext(ws, 'players')
  assert.equal(players.players.length, 2)

  const inScene = players.players.find((p) => p.cid === 'ws-worker')
  assert.equal(inScene.scene, true)
  assert.equal(inScene.x, 0)
  assert.equal(inScene.anim, 'idle')

  const seated = players.players.find((p) => p.cid === 'hb-worker')
  assert.equal(seated.scene, false)
  assert.equal('x' in seated, false) // 坐班者无位置字段，由前端安放到部门工位
  assert.equal(seated.name, '同事-hb-w') // 无档案 → 同事-{cid前4位}
  assert.equal(seated.dept, null)

  ws.close()
})

test('档案昵称/部门注入 players 与 health 指标', async (t) => {
  const srv = await startTestServer()
  t.after(() => srv.close())

  await srv.app.store.upsertProfile('chief', '李工', '结构')
  await fetch(`${srv.base}/api/heartbeat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ cid: 'chief' })
  })
  const { ws } = await joinPlayer(srv.wsBase, 'guest')

  const players = await wsNext(ws, 'players')
  const chief = players.players.find((p) => p.cid === 'chief')
  assert.deepEqual(
    { cid: chief.cid, name: chief.name, dept: chief.dept, scene: chief.scene },
    {
      cid: 'chief',
      name: '李工',
      dept: '结构',
      scene: false
    }
  )

  const health = await (await fetch(`${srv.base}/api/health`)).json()
  assert.equal(health.ok, true)
  assert.equal(health.online, 2) // guest(WS) + chief(心跳)
  assert.equal(health.inScene, 1) // 仅 guest 有 WS 会话

  ws.close()
})

test('同一 cid 同时有心跳与 WS 会话时不重复出现（WS 优先）', async (t) => {
  const srv = await startTestServer()
  t.after(() => srv.close())

  await fetch(`${srv.base}/api/heartbeat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ cid: 'both' })
  })
  const { ws } = await joinPlayer(srv.wsBase, 'both')

  const players = await wsNext(ws, 'players')
  const both = players.players.filter((p) => p.cid === 'both')
  assert.equal(both.length, 1)
  assert.equal(both[0].scene, true)

  ws.close()
})

test('心跳窗口过期后坐班小人消失', async (t) => {
  const srv = await startTestServer()
  t.after(() => srv.close())

  // 直接注入过期时间戳（绕过 HTTP，模拟 90s 前的心跳）
  srv.app.store.touchHeartbeat('stale-guy', Date.now() - 91_000)
  const { ws } = await joinPlayer(srv.wsBase, 'live-one')

  const players = await wsNext(ws, 'players')
  assert.equal(players.players.length, 1)
  assert.equal(players.players[0].cid, 'live-one')

  ws.close()
})
