import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
// 静态托管：dist 缺失 → 占位页；存在 → 文件 + SPA 回退 + 穿越防护
import test from 'node:test'

import { startTestServer, tempDir } from './helpers/test-server.js'

test('dist 不存在 → 占位页 frontend not built', async (t) => {
  const srv = await startTestServer()
  t.after(() => srv.close())

  for (const p of ['/', '/some/spa/route']) {
    const res = await fetch(`${srv.base}${p}`)
    assert.equal(res.status, 200, p)
    assert.match(res.headers.get('content-type'), /text\/html/)
    const html = await res.text()
    assert.match(html, /frontend not built/)
  }

  // 带扩展名的未知文件 → 404
  const res = await fetch(`${srv.base}/no-such.js`)
  assert.equal(res.status, 404)
})

test('dist 存在 → 静态文件 + SPA 回退 + 穿越防护', async (t) => {
  const dist = tempDir()
  fs.mkdirSync(path.join(dist, 'assets'), { recursive: true })
  fs.writeFileSync(path.join(dist, 'index.html'), '<!doctype html><html><body><h1>little-world-app</h1></body></html>')
  fs.writeFileSync(path.join(dist, 'assets', 'app.js'), 'console.log("hello world");')

  const srv = await startTestServer({ frontendDist: dist })
  t.after(() => srv.close())

  const index = await fetch(`${srv.base}/`)
  assert.equal(index.status, 200)
  assert.match(await index.text(), /little-world-app/)

  const js = await fetch(`${srv.base}/assets/app.js`)
  assert.equal(js.status, 200)
  assert.match(js.headers.get('content-type'), /javascript/)
  assert.match(await js.text(), /hello world/)

  // SPA 回退：无扩展名路由 → index.html
  const spa = await fetch(`${srv.base}/scene/lobby`)
  assert.equal(spa.status, 200)
  assert.match(await spa.text(), /little-world-app/)

  // 路径穿越 → 拒绝
  const evil = await fetch(`${srv.base}/..%2f..%2f..%2fetc%2fpasswd`)
  assert.ok([403, 404].includes(evil.status))
  assert.doesNotMatch(await evil.text(), /root:/)

  // 缺失的带扩展名资源 → 404
  const missing = await fetch(`${srv.base}/assets/nope.js`)
  assert.equal(missing.status, 404)
})
