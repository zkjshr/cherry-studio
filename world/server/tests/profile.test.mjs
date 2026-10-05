import assert from 'node:assert/strict'
// 档案接口：{cid, nickname(1-20), dept 枚举} → 200 持久化；非法 → 400
import test from 'node:test'

import { DEPTS } from '../src/config.js'
import { startTestServer } from './helpers/test-server.js'

function post(base, body) {
  return fetch(`${base}/api/profile`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  })
}

test('合法档案 → 200 且按 cid 持久化（可更新）', async (t) => {
  const srv = await startTestServer()
  t.after(() => srv.close())

  const res = await post(srv.base, { cid: 'u001', nickname: '张三丰', dept: '建筑' })
  assert.equal(res.status, 200)
  assert.deepEqual(await res.json(), { ok: true })
  assert.deepEqual(srv.app.store.getProfile('u001'), { nickname: '张三丰', dept: '建筑' })

  // 再次提交覆盖
  await post(srv.base, { cid: 'u001', nickname: '张工', dept: '结构' })
  assert.deepEqual(srv.app.store.getProfile('u001'), { nickname: '张工', dept: '结构' })

  // 每个部门枚举值都合法
  for (const dept of DEPTS) {
    const r = await post(srv.base, { cid: `dept-${dept}`, nickname: 'x', dept })
    assert.equal(r.status, 200, `dept=${dept}`)
  }
})

test('非法输入 → 400', async (t) => {
  const srv = await startTestServer()
  t.after(() => srv.close())
  const cases = [
    { cid: '', nickname: 'a', dept: '建筑' }, // cid 缺失
    { nickname: 'a', dept: '建筑' }, // cid 缺失
    { cid: 'u1', nickname: '', dept: '建筑' }, // 昵称空
    { cid: 'u1', nickname: '   ', dept: '建筑' }, // 昵称全空白
    { cid: 'u1', nickname: '长'.repeat(21), dept: '建筑' }, // >20
    { cid: 'u1', nickname: 42, dept: '建筑' }, // 非字符串
    { cid: 'u1', nickname: 'ok', dept: '财务部' }, // 非枚举
    { cid: 'u1', nickname: 'ok' }, // 缺 dept
    { cid: 'u1', nickname: 'ok', dept: '建筑', extra: true } // 多余字段不影响 → 反例：应 200
  ]
  for (const [i, body] of cases.entries()) {
    const res = await post(srv.base, body)
    const expect = i === cases.length - 1 ? 200 : 400
    assert.equal(res.status, expect, `case#${i} ${JSON.stringify(body)} → ${res.status}`)
  }

  // 边界：恰好 20 字合法
  const r20 = await post(srv.base, { cid: 'u20', nickname: '名'.repeat(20), dept: '其他' })
  assert.equal(r20.status, 200)
})

test('非法 JSON / 超大请求体 → 400/413', async (t) => {
  const srv = await startTestServer()
  t.after(() => srv.close())

  const bad = await fetch(`${srv.base}/api/profile`, { method: 'POST', body: '{oops' })
  assert.equal(bad.status, 400)

  const big = await fetch(`${srv.base}/api/profile`, {
    method: 'POST',
    body: JSON.stringify({ cid: 'u1', nickname: 'x'.repeat(20_000), dept: '建筑' })
  })
  assert.ok([400, 413].includes(big.status))
})

test('heartbeat：204 + cid 持久化；缺 cid → 400', async (t) => {
  const srv = await startTestServer()
  t.after(() => srv.close())

  const ok = await fetch(`${srv.base}/api/heartbeat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ cid: 'hb-1' })
  })
  assert.equal(ok.status, 204)
  assert.deepEqual(await srv.app.store.heartbeatAliveCids(90_000), ['hb-1'])

  const missing = await fetch(`${srv.base}/api/heartbeat`, { method: 'POST', body: '{}' })
  assert.equal(missing.status, 400)

  const badJson = await fetch(`${srv.base}/api/heartbeat`, { method: 'POST', body: 'nope' })
  assert.equal(badJson.status, 400)
})
