import assert from 'node:assert/strict'
// 单房间 50 人上限：第 51 个连接被拒（close 4000 / room_full），腾位后可再加入
import test from 'node:test'

import { CAPACITY } from '../src/config.js'
import { startTestServer, joinPlayer, wsConnect, wsCloseInfo } from './helpers/test-server.js'

test('房间满 50 人后第 51 个连接收到 close 4000 room_full', async (t) => {
  const srv = await startTestServer()
  t.after(() => srv.close())

  const clients = []
  t.after(() => {
    for (const c of clients) c.ws?.terminate()
  })

  for (let i = 0; i < CAPACITY; i++) {
    const { ws } = await joinPlayer(srv.wsBase, `cid-${String(i).padStart(2, '0')}`)
    clients.push({ ws })
  }
  assert.equal(srv.app.room.count, CAPACITY)

  const overflow = await wsConnect(`${srv.wsBase}?cid=cid-overflow`)
  const closed = wsCloseInfo(overflow)
  overflow.send(JSON.stringify({ type: 'join' }))
  const info = await closed
  assert.equal(info.code, 4000)
  assert.equal(info.reason, 'room_full')
  assert.equal(srv.app.room.count, CAPACITY)

  // 腾出 1 个位置后可再加入
  clients[0].ws.close()
  await new Promise((r) => setTimeout(r, 50))
  assert.equal(srv.app.room.count, CAPACITY - 1)

  const { ws, init } = await joinPlayer(srv.wsBase, 'cid-late')
  assert.equal(init.self.cid, 'cid-late')
  ws.close()
})

test('init.players 只含其他玩家（不含自己）', async (t) => {
  const srv = await startTestServer()
  t.after(() => srv.close())

  const a = await joinPlayer(srv.wsBase, 'aaa')
  const b = await joinPlayer(srv.wsBase, 'bbb')

  assert.deepEqual(a.init.players, [])
  assert.equal(b.init.players.length, 1)
  assert.equal(b.init.players[0].cid, 'aaa')
  assert.equal(b.init.self.cid, 'bbb')
  assert.deepEqual(b.init.world.spawn, { x: 0, z: 0 })

  a.ws.close()
  b.ws.close()
})
