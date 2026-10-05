#!/usr/bin/env node
// e2e 冒烟：临时库 + 临时端口，验证 join/init → chat → heartbeat → profile → health 全链路
// 运行：node tests/smoke.mjs（或 npm run smoke）
import assert from 'node:assert/strict'

import { startTestServer, joinPlayer, wsNext } from './helpers/test-server.js'

const steps = []
const step = (name, fn) => steps.push({ name, fn })

step('ws join → init（self/players/world.spawn）', async ({ srv }) => {
  const { ws, init } = await joinPlayer(srv.wsBase, 'smoke-1')
  assert.equal(init.self.cid, 'smoke-1')
  assert.equal(init.self.scene, true)
  assert.deepEqual(init.world.spawn, { x: 0, z: 0 })
  return { ws }
})

step('第二位玩家加入并互见（players 全量广播）', async ({ srv, state }) => {
  const { ws } = await joinPlayer(srv.wsBase, 'smoke-2')
  state.ws2 = ws
  ws.send(JSON.stringify({ type: 'pos', x: 3, z: 4, ry: 0.5, anim: 'walk' }))
  const players = await wsNext(state.ws, 'players')
  const other = players.players.find((p) => p.cid === 'smoke-2')
  assert.ok(other, 'players 应含 smoke-2')
  assert.equal(other.x, 3)
  assert.equal(other.scene, true)
})

step('chat scope=all 转发', async ({ state }) => {
  state.ws.send(JSON.stringify({ type: 'chat', scope: 'all', text: '冒烟测试消息' }))
  const msg = await wsNext(state.ws2, 'chat')
  assert.equal(msg.text, '冒烟测试消息')
  assert.equal(msg.from.cid, 'smoke-1')
})

step('POST /api/heartbeat → 204', async ({ srv }) => {
  const res = await fetch(`${srv.base}/api/heartbeat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ cid: 'smoke-hb' })
  })
  assert.equal(res.status, 204)
})

step('POST /api/profile → 200', async ({ srv }) => {
  const res = await fetch(`${srv.base}/api/profile`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ cid: 'smoke-hb', nickname: '冒烟工', dept: '机电' })
  })
  assert.equal(res.status, 200)
  assert.deepEqual(srv.app.store.getProfile('smoke-hb'), { nickname: '冒烟工', dept: '机电' })
})

step('GET /api/health → ok / online / inScene', async ({ srv }) => {
  const health = await (await fetch(`${srv.base}/api/health`)).json()
  assert.equal(health.ok, true)
  assert.ok(health.online >= 3, `online=${health.online}`)
  assert.equal(health.inScene, 2)
})

step('GET / → 静态托管（占位页）', async ({ srv }) => {
  const html = await (await fetch(`${srv.base}/`)).text()
  assert.match(html, /小世界/)
})

let failed = 0
const srv = await startTestServer()
const state = {}
try {
  for (const { name, fn } of steps) {
    try {
      const ret = await fn({ srv, state })
      Object.assign(state, ret)
      console.log(`  ok  ${name}`)
    } catch (err) {
      failed++
      console.error(`FAIL  ${name}\n      ${err?.stack || err}`)
      break
    }
  }
} finally {
  state.ws?.close?.()
  state.ws2?.close?.()
  await srv.close()
}

if (failed) {
  console.error(`\nSMOKE FAILED（${failed} 项）`)
  process.exit(1)
}
console.log('\nSMOKE PASSED：join/init、players 批量广播、chat 转发、heartbeat、profile、health、静态托管 全部通过')
