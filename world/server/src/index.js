// 小世界服务入口：HTTP（静态 + API）+ WS 房间（PRD 2026-10-05-little-world §4）
import http from 'node:http'

import { WebSocketServer } from 'ws'

import { loadConfig, DEPTS, NICKNAME_MAX_LEN } from './config.js'
import { Room } from './room.js'
import { makeStaticHandler } from './static.js'
import { Store } from './store.js'
import { tokenOk, readJsonBody } from './util.js'

const WS_MAX_PAYLOAD = 64 * 1024

export function createWorldServer(config = loadConfig(), { log = defaultLog } = {}) {
  const store = new Store(config.dbPath)
  const room = new Room({ store, log })
  const serveStatic = makeStaticHandler(config.frontendDist)

  const server = http.createServer((req, res) => {
    handleRequest(req, res).catch((err) => {
      log(`http-error ${err?.stack || err}`, 'error')
      if (!res.headersSent) res.writeHead(500, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'internal_error' }))
    })
  })

  const wss = new WebSocketServer({ noServer: true, maxPayload: WS_MAX_PAYLOAD })

  // WS /ws?cid=&token=
  server.on('upgrade', (req, socket, head) => {
    let url
    try {
      url = new URL(req.url, 'http://localhost')
    } catch {
      socket.destroy()
      return
    }
    if (url.pathname !== '/ws') {
      socket.destroy()
      return
    }
    if (!tokenOk(url.searchParams.get('token') ?? '', config.gatewayToken)) {
      socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\nContent-Length: 0\r\n\r\n')
      socket.destroy()
      return
    }
    const cid = url.searchParams.get('cid') ?? ''
    if (!cid || cid.length > 128) {
      socket.write('HTTP/1.1 400 Bad Request\r\nConnection: close\r\nContent-Length: 0\r\n\r\n')
      socket.destroy()
      return
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      // 单房间 50 人上限：超员完成握手后立即以 4000/room_full 关闭，前端可读 close code
      if (room.isFull()) {
        log(`room-full reject cid=${cid}`)
        ws.close(4000, 'room_full')
        return
      }
      const session = room.addSession(ws, cid)
      ws.on('message', (raw) => {
        let msg
        try {
          msg = JSON.parse(raw.toString('utf8'))
        } catch {
          return // 非 JSON 消息忽略
        }
        if (!msg || typeof msg !== 'object') return
        switch (msg.type) {
          case 'join':
            room.handleJoin(session)
            break
          case 'pos':
            room.applyPos(session, msg)
            break
          case 'chat':
            room.handleChat(session, msg)
            break
          default:
            break // 未知类型忽略
        }
      })
      ws.on('close', () => room.removeSession(session))
      ws.on('error', (err) => log(`ws-error cid=${cid} ${err?.message}`, 'error'))
    })
  })

  async function handleRequest(req, res) {
    const { pathname } = new URL(req.url, 'http://localhost')

    if (pathname === '/api/health') {
      if (req.method !== 'GET' && req.method !== 'HEAD') return sendJson(res, 405, { error: 'method_not_allowed' })
      return sendJson(res, 200, { ok: true, ...room.counts() })
    }

    if (pathname === '/api/heartbeat') {
      if (req.method !== 'POST') return sendJson(res, 405, { error: 'method_not_allowed' })
      if (!tokenOk(req.headers['x-client-token'] ?? '', config.gatewayToken)) {
        return sendJson(res, 401, { error: 'unauthorized' })
      }
      const body = await readJsonBody(req)
      if (body === 'too_large') return sendJson(res, 413, { error: 'payload_too_large' })
      const cid = typeof body?.cid === 'string' ? body.cid.trim() : ''
      if (!cid || cid.length > 128) return sendJson(res, 400, { error: 'invalid_cid' })
      store.touchHeartbeat(cid)
      res.writeHead(204)
      res.end()
      return
    }

    if (pathname === '/api/profile') {
      if (req.method !== 'POST') return sendJson(res, 405, { error: 'method_not_allowed' })
      const body = await readJsonBody(req)
      if (body === 'too_large') return sendJson(res, 413, { error: 'payload_too_large' })
      const cid = typeof body?.cid === 'string' ? body.cid.trim() : ''
      const nickname = typeof body?.nickname === 'string' ? body.nickname.trim() : ''
      const dept = body?.dept
      if (!cid || cid.length > 128) return sendJson(res, 400, { error: 'invalid_cid' })
      if (nickname.length === 0 || nickname.length > NICKNAME_MAX_LEN) {
        return sendJson(res, 400, { error: 'invalid_nickname' })
      }
      if (!DEPTS.includes(dept)) return sendJson(res, 400, { error: 'invalid_dept' })
      store.upsertProfile(cid, nickname, dept)
      log(`profile cid=${cid} dept=${dept}`)
      return sendJson(res, 200, { ok: true })
    }

    if (pathname.startsWith('/api/')) return sendJson(res, 404, { error: 'not_found' })

    // 静态托管 Three.js 前端（/）
    serveStatic(req, res)
  }

  const app = {
    server,
    wss,
    room,
    store,
    config,
    listen(port = config.port) {
      return new Promise((resolve, reject) => {
        server.once('error', reject)
        server.listen(port, () => {
          server.removeListener('error', reject)
          room.start() // 100ms 批量 players 广播
          resolve(app)
        })
      })
    },
    async close() {
      room.stop()
      for (const ws of wss.clients) ws.terminate()
      await new Promise((resolve) => server.close(resolve))
      server.closeAllConnections?.()
      store.close()
    }
  }
  return app
}

function sendJson(res, status, obj) {
  const data = Buffer.from(JSON.stringify(obj), 'utf8')
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': data.length })
  res.end(data)
}

function defaultLog(message, level = 'info') {
  const line = `[world] ${new Date().toISOString()} ${message}`
  if (level === 'error') console.error(line)
  else console.log(line)
}

const isMain = process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href
if (isMain) {
  const config = loadConfig()
  const app = createWorldServer(config)
  app.listen().then(() => {
    defaultLog(
      `小世界服务已启动 :${config.port} db=${config.dbPath} dist=${config.frontendDist} token=${config.gatewayToken ? '已启用' : '未启用(放行)'}`
    )
  })
  const shutdown = (signal) => {
    defaultLog(`收到 ${signal}，关闭中…`)
    app.close().then(() => process.exit(0))
  }
  process.on('SIGINT', () => shutdown('SIGINT'))
  process.on('SIGTERM', () => shutdown('SIGTERM'))
}
