import assert from 'node:assert/strict'
// 聊天转发：all 全员（含发送者回显）、near 半径 8m、text≤500、非法消息忽略
import test from 'node:test'

import { startTestServer, joinPlayer, wsNext } from './helpers/test-server.js'

test('scope=all：全员转发（含发送者）且 from 带展示名', async (t) => {
  const srv = await startTestServer()
  t.after(() => srv.close())

  await srv.app.store.upsertProfile('alice', '王小明', '建筑')
  const a = await joinPlayer(srv.wsBase, 'alice')
  const b = await joinPlayer(srv.wsBase, 'bob')

  a.ws.send(JSON.stringify({ type: 'chat', scope: 'all', text: '大家好' }))

  for (const { ws } of [a, b]) {
    const msg = await wsNext(ws, 'chat')
    assert.deepEqual(msg.from, { cid: 'alice', name: '王小明' })
    assert.equal(msg.scope, 'all')
    assert.equal(msg.text, '大家好')
  }
  a.ws.close()
  b.ws.close()
})

test('scope=near：8m 内可收，远处不可收；无档案者 from.name 为 同事-{cid前4}', async (t) => {
  const srv = await startTestServer()
  t.after(() => srv.close())

  const a = await joinPlayer(srv.wsBase, 'near-man') // (0,0)
  const b = await joinPlayer(srv.wsBase, 'close-by') // (1,0)
  const c = await joinPlayer(srv.wsBase, 'far-away') // (100,0)

  a.ws.send(JSON.stringify({ type: 'pos', x: 0, z: 0, ry: 0, anim: 'idle' }))
  b.ws.send(JSON.stringify({ type: 'pos', x: 1, z: 0, ry: 0, anim: 'idle' }))
  c.ws.send(JSON.stringify({ type: 'pos', x: 100, z: 0, ry: 0, anim: 'idle' }))
  await new Promise((r) => setTimeout(r, 150)) // 等一次批量广播，确保位置已生效

  a.ws.send(JSON.stringify({ type: 'chat', scope: 'near', text: '有人在吗' }))

  const gotA = await wsNext(a.ws, 'chat')
  assert.equal(gotA.from.name, '同事-near')
  assert.deepEqual(gotA.from, { cid: 'near-man', name: '同事-near' })

  const gotB = await wsNext(b.ws, 'chat')
  assert.equal(gotB.text, '有人在吗')

  // far-away 不应收到（100m > 8m）
  await assert.rejects(() => wsNext(c.ws, 'chat', { timeoutMs: 350 }), /timeout/)

  a.ws.close()
  b.ws.close()
  c.ws.close()
})

test('text 超长（>500）与非法 scope 的消息被忽略', async (t) => {
  const srv = await startTestServer()
  t.after(() => srv.close())

  const a = await joinPlayer(srv.wsBase, 'aaa')
  const b = await joinPlayer(srv.wsBase, 'bbb')

  a.ws.send(JSON.stringify({ type: 'chat', scope: 'all', text: 'x'.repeat(501) }))
  a.ws.send(JSON.stringify({ type: 'chat', scope: 'dm', text: 'hi' }))
  a.ws.send(JSON.stringify({ type: 'chat', scope: 'all', text: '' }))
  a.ws.send('not-json')

  await new Promise((r) => setTimeout(r, 200))
  // b 只可能收到 players 广播，不应收到任何 chat（无 chat 到达 → wsNext 超时即预期）
  await assert.rejects(() => wsNext(b.ws, 'chat', { timeoutMs: 300 }), /timeout/)

  // 边界：恰好 500 字可正常转发
  a.ws.send(JSON.stringify({ type: 'chat', scope: 'all', text: 'y'.repeat(500) }))
  const ok = await wsNext(b.ws, 'chat')
  assert.equal(ok.text.length, 500)

  a.ws.close()
  b.ws.close()
})
