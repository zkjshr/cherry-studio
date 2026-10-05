// 测试辅助：临时库 + 临时端口启动服务，以及 WS 客户端小工具
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import WebSocket from 'ws'

import { createWorldServer } from '../../src/index.js'

export function tempDbPath() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'world-test-'))
  return path.join(dir, 'test.sqlite3')
}

export function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'world-test-'))
}

export async function startTestServer(overrides = {}) {
  const app = createWorldServer({
    port: 0,
    dbPath: overrides.dbPath ?? tempDbPath(),
    frontendDist: overrides.frontendDist ?? path.join(tempDir(), 'no-such-dist'),
    gatewayToken: overrides.gatewayToken ?? ''
  })
  await app.listen(0)
  const { port } = app.server.address()
  return {
    app,
    port,
    base: `http://127.0.0.1:${port}`,
    wsBase: `ws://127.0.0.1:${port}/ws`,
    async close() {
      await app.close()
    }
  }
}

/** 打开 WS 连接，resolve 于 open；失败 reject */
export function wsConnect(url, { timeoutMs = 3000 } = {}) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url)
    const timer = setTimeout(() => {
      ws.terminate()
      reject(new Error(`ws open timeout: ${url}`))
    }, timeoutMs)
    ws.once('open', () => {
      clearTimeout(timer)
      resolve(ws)
    })
    ws.once('error', (err) => {
      clearTimeout(timer)
      reject(err)
    })
  })
}

/** 等待下一条指定 type 的服务端消息 */
export function wsNext(ws, type, { timeoutMs = 3000 } = {}) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      ws.removeListener('message', onMessage)
      reject(new Error(`timeout waiting message type=${type}`))
    }, timeoutMs)
    const onMessage = (raw) => {
      let msg
      try {
        msg = JSON.parse(raw.toString('utf8'))
      } catch {
        return
      }
      if (msg?.type !== type) return
      clearTimeout(timer)
      ws.removeListener('message', onMessage)
      resolve(msg)
    }
    ws.on('message', onMessage)
  })
}

/** 等待连接关闭，返回 { code, reason } */
export function wsCloseInfo(ws, { timeoutMs = 3000 } = {}) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout waiting close')), timeoutMs)
    ws.once('close', (code, reason) => {
      clearTimeout(timer)
      resolve({ code, reason: reason.toString('utf8') })
    })
  })
}

/** 期待握手失败（HTTP 错误响应），返回状态码 */
export function wsRejectCode(url, { timeoutMs = 3000 } = {}) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url)
    const timer = setTimeout(() => {
      ws.terminate()
      reject(new Error('timeout waiting handshake rejection'))
    }, timeoutMs)
    ws.once('error', (err) => {
      clearTimeout(timer)
      const m = /Unexpected server response: (\d+)/.exec(err.message)
      resolve(m ? Number(m[1]) : err.message)
    })
    ws.once('open', () => {
      clearTimeout(timer)
      ws.close()
      reject(new Error('expected handshake rejection but connection opened'))
    })
  })
}

/** 加入房间并等待 init，返回 { ws, init } */
export async function joinPlayer(wsBase, cid, { token = '' } = {}) {
  const url = `${wsBase}?cid=${encodeURIComponent(cid)}${token ? `&token=${encodeURIComponent(token)}` : ''}`
  const ws = await wsConnect(url)
  ws.send(JSON.stringify({ type: 'join' }))
  const init = await wsNext(ws, 'init')
  return { ws, init }
}
