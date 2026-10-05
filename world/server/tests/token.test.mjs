import assert from 'node:assert/strict'
// GATEWAY_TOKEN 语义：空 = 放行；非空 = 常量时间比较（HTTP 头 X-Client-Token / WS query token）
import test from 'node:test'

import { startTestServer, wsConnect, wsRejectCode, joinPlayer } from './helpers/test-server.js'

test('未配置 GATEWAY_TOKEN（空）→ 全部放行', async (t) => {
  const srv = await startTestServer({ gatewayToken: '' })
  t.after(() => srv.close())

  const res = await fetch(`${srv.base}/api/heartbeat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ cid: 'anon' })
  })
  assert.equal(res.status, 204)

  const { ws, init } = await joinPlayer(srv.wsBase, 'u1')
  assert.equal(init.self.cid, 'u1')
  ws.close()
})

test('配置 GATEWAY_TOKEN 后：HTTP 心跳校验 X-Client-Token', async (t) => {
  const srv = await startTestServer({ gatewayToken: 'sekret' })
  t.after(() => srv.close())
  const url = `${srv.base}/api/heartbeat`
  const body = JSON.stringify({ cid: 'u1' })

  const noHeader = await fetch(url, { method: 'POST', body })
  assert.equal(noHeader.status, 401)

  const wrong = await fetch(url, { method: 'POST', headers: { 'x-client-token': 'wrong' }, body })
  assert.equal(wrong.status, 401)

  const right = await fetch(url, { method: 'POST', headers: { 'x-client-token': 'sekret' }, body })
  assert.equal(right.status, 204)
})

test('配置 GATEWAY_TOKEN 后：WS query token 校验', async (t) => {
  const srv = await startTestServer({ gatewayToken: 'sekret' })
  t.after(() => srv.close())

  const badCode = await wsRejectCode(`${srv.wsBase}?cid=u1&token=nope`)
  assert.equal(badCode, 401)

  const noTokenCode = await wsRejectCode(`${srv.wsBase}?cid=u1`)
  assert.equal(noTokenCode, 401)

  // 正确 token 可正常加入
  const { ws, init } = await joinPlayer(srv.wsBase, 'u1', { token: 'sekret' })
  assert.equal(init.self.cid, 'u1')
  ws.close()
})

test('缺少 cid 的 WS 握手被拒绝（400）', async (t) => {
  const srv = await startTestServer()
  t.after(() => srv.close())
  const code = await wsRejectCode(srv.wsBase)
  assert.equal(code, 400)
})

test('WS 连接保活后进程可正常收发（无 token 阻塞）', async (t) => {
  const srv = await startTestServer({ gatewayToken: 'x' })
  t.after(() => srv.close())
  const ws = await wsConnect(`${srv.wsBase}?cid=u9&token=x`)
  ws.send(JSON.stringify({ type: 'join' }))
  await new Promise((r) => setTimeout(r, 50))
  ws.close()
})
