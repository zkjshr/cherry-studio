import assert from 'node:assert/strict'
// 小房子（v2 §3）：进出协议、≤6 人/间满员拒绝、房内聊天隔离、表情 8m 转发
import test from 'node:test'

import { startTestServer, joinPlayer, wsNext } from './helpers/test-server.js'

test('进入房子：houseId 进 players 广播；离开置空', async (t) => {
  const srv = await startTestServer()
  t.after(() => srv.close())

  const a = await joinPlayer(srv.wsBase, 'aaa')
  const b = await joinPlayer(srv.wsBase, 'bbb')

  const aOk = wsNext(a.ws, 'house_ok')
  a.ws.send(JSON.stringify({ type: 'house', id: 'h1' }))
  assert.equal((await aOk).id, 'h1')
  let players = await wsNext(a.ws, 'players')
  let entry = players.players.find((p) => p.cid === 'aaa')
  assert.equal(entry.houseId, 'h1')

  const bOk = wsNext(b.ws, 'house_ok')
  b.ws.send(JSON.stringify({ type: 'house', id: 'h1' }))
  assert.equal((await bOk).id, 'h1')
  players = await wsNext(b.ws, 'players')
  entry = players.players.find((p) => p.cid === 'bbb')
  assert.equal(entry.houseId, 'h1')

  const bLeave = wsNext(b.ws, 'house_ok')
  b.ws.send(JSON.stringify({ type: 'house', id: null }))
  await bLeave
  players = await wsNext(b.ws, 'players')
  entry = players.players.find((p) => p.cid === 'bbb')
  assert.equal(entry.houseId, null)

  a.ws.close()
  b.ws.close()
})

test('非法房子 id 被忽略（不进 players 变更）', async (t) => {
  const srv = await startTestServer()
  t.after(() => srv.close())

  const a = await joinPlayer(srv.wsBase, 'aaa')
  a.ws.send(JSON.stringify({ type: 'house', id: 'hack' }))
  a.ws.send(JSON.stringify({ type: 'house', id: 42 }))
  await new Promise((r) => setTimeout(r, 150))

  const players = await wsNext(a.ws, 'players') // 仅周期广播
  const entry = players.players.find((p) => p.cid === 'aaa')
  assert.equal(entry.houseId, null)
  a.ws.close()
})

test('房子满 6 人：第 7 个收到 house_full 且未进房', async (t) => {
  const srv = await startTestServer()
  t.after(() => srv.close())

  const clients = []
  const oks = []
  for (let i = 0; i < 6; i++) {
    const c = await joinPlayer(srv.wsBase, `in-${i}`)
    const ok = wsNext(c.ws, 'house_ok') // 先注册监听再发送，避免回执竞态
    c.ws.send(JSON.stringify({ type: 'house', id: 'h2' }))
    clients.push(c)
    oks.push(ok)
  }
  // 等 6 人全部进房（各自收到 house_ok 确认）
  await Promise.all(oks)

  const { ws } = await joinPlayer(srv.wsBase, 'late-7')
  const fullP = wsNext(ws, 'house_full')
  ws.send(JSON.stringify({ type: 'house', id: 'h2' }))
  const full = await fullP
  assert.equal(full.id, 'h2')

  // 未进房：players 里 late-7 的 houseId 仍为 null
  const players = await wsNext(ws, 'players')
  assert.equal(players.players.find((p) => p.cid === 'late-7').houseId, null)

  ws.close()
  for (const c of clients) c.ws.close()
})

test('房内聊天：同房互见，房外与空地者不可见；未进房发 room 被忽略', async (t) => {
  const srv = await startTestServer()
  t.after(() => srv.close())

  const a = await joinPlayer(srv.wsBase, 'in-a')
  const b = await joinPlayer(srv.wsBase, 'in-b')
  const out = await joinPlayer(srv.wsBase, 'outside')

  const aOk = wsNext(a.ws, 'house_ok')
  a.ws.send(JSON.stringify({ type: 'house', id: 'h3' }))
  await aOk
  const bOk = wsNext(b.ws, 'house_ok')
  b.ws.send(JSON.stringify({ type: 'house', id: 'h3' }))
  await bOk
  await new Promise((r) => setTimeout(r, 120))

  a.ws.send(JSON.stringify({ type: 'chat', scope: 'room', text: '屋里说话' }))

  for (const c of [a, b]) {
    const msg = await wsNext(c.ws, 'chat')
    assert.equal(msg.scope, 'room')
    assert.equal(msg.text, '屋里说话')
  }
  await assert.rejects(() => wsNext(out.ws, 'chat', { timeoutMs: 350 }), /timeout/)

  // 未进房者的 room 消息被忽略（b 收不到第二条）
  out.ws.send(JSON.stringify({ type: 'chat', scope: 'room', text: '鬼天气' }))
  await assert.rejects(() => wsNext(b.ws, 'chat', { timeoutMs: 350 }), /timeout/)

  a.ws.close()
  b.ws.close()
  out.ws.close()
})

test('表情：8m 内转发（含回显），远处不可见；非法 emoji 忽略', async (t) => {
  const srv = await startTestServer()
  t.after(() => srv.close())

  const a = await joinPlayer(srv.wsBase, 'emo-a')
  const b = await joinPlayer(srv.wsBase, 'emo-b')
  const far = await joinPlayer(srv.wsBase, 'emo-far')

  a.ws.send(JSON.stringify({ type: 'pos', x: 0, z: 0, ry: 0, anim: 'idle' }))
  b.ws.send(JSON.stringify({ type: 'pos', x: 3, z: 0, ry: 0, anim: 'idle' }))
  far.ws.send(JSON.stringify({ type: 'pos', x: 100, z: 0, ry: 0, anim: 'idle' }))
  await new Promise((r) => setTimeout(r, 150))

  a.ws.send(JSON.stringify({ type: 'emote', emoji: '🎉' }))
  for (const c of [a, b]) {
    const msg = await wsNext(c.ws, 'emote')
    assert.equal(msg.emoji, '🎉')
    assert.equal(msg.from.cid, 'emo-a')
  }
  await assert.rejects(() => wsNext(far.ws, 'emote', { timeoutMs: 350 }), /timeout/)

  a.ws.send(JSON.stringify({ type: 'emote', emoji: '' }))
  a.ws.send(JSON.stringify({ type: 'emote', emoji: 'x'.repeat(9) }))
  await new Promise((r) => setTimeout(r, 150))
  await assert.rejects(() => wsNext(b.ws, 'emote', { timeoutMs: 300 }), /timeout/)

  a.ws.close()
  b.ws.close()
  far.ws.close()
})

test('档案含 color：提交 0..7 持久化，非法置 null，players/init 透传', async (t) => {
  const srv = await startTestServer()
  t.after(() => srv.close())

  const post = (body) =>
    fetch(`${srv.base}/api/profile`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body)
    })

  assert.equal((await post({ cid: 'c1', nickname: '阿凯', dept: '建筑', color: 3 })).status, 200)
  assert.equal(srv.app.store.getProfile('c1').color, 3)

  // 非法 color → null（不报错，宽容处理）
  assert.equal((await post({ cid: 'c2', nickname: '小王', dept: '结构', color: 9 })).status, 200)
  assert.equal(srv.app.store.getProfile('c2').color, null)
  assert.equal((await post({ cid: 'c3', nickname: '小李', dept: '机电', color: 'red' })).status, 200)
  assert.equal(srv.app.store.getProfile('c3').color, null)

  // players/init 透传 color
  const { ws, init } = await joinPlayer(srv.wsBase, 'c1')
  assert.equal(init.self.color, 3)
  const players = await wsNext(ws, 'players')
  assert.equal(players.players.find((p) => p.cid === 'c1').color, 3)
  ws.close()
})
