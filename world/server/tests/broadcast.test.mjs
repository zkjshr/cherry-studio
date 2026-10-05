import assert from 'node:assert/strict'
// 批量广播：pos 不即时下发，100ms tick 全量 players；leave 即时下发
import test from 'node:test'

import { Room } from '../src/room.js'
import { Store } from '../src/store.js'
import { tempDbPath } from './helpers/test-server.js'

function fakeWs() {
  return {
    readyState: 1,
    sent: [],
    send(data) {
      this.sent.push(JSON.parse(data))
    }
  }
}

function lastSent(ws, type) {
  const found = ws.sent.filter((m) => m.type === type)
  return found[found.length - 1]
}

test('pos 仅记录，等批量 tick 后全量下发 players', async () => {
  const store = new Store(tempDbPath())
  const room = new Room({ store, broadcastIntervalMs: 40 })

  const wsA = fakeWs()
  const wsB = fakeWs()
  const sessA = room.addSession(wsA, 'aaa')
  const sessB = room.addSession(wsB, 'bbb')
  room.handleJoin(sessA)
  room.handleJoin(sessB)

  room.applyPos(sessA, { x: 12.5, z: -3, ry: 1.2, anim: 'walk' })

  // 同步阶段：不因 pos 立即广播 players；init 在 join 时已同步回给各自
  assert.equal(lastSent(wsB, 'players'), undefined)
  const initA = wsA.sent.find((m) => m.type === 'init')
  assert.equal(initA.self.cid, 'aaa')
  assert.deepEqual(
    initA.players.map((p) => p.cid),
    ['bbb']
  )
  const initB = wsB.sent.find((m) => m.type === 'init')
  assert.deepEqual(
    initB.players.map((p) => p.cid),
    ['aaa']
  )

  room.start()
  try {
    await new Promise((r) => setTimeout(r, 120))
    const playersMsg = lastSent(wsB, 'players')
    assert.ok(playersMsg, 'tick 后应有 players 广播')
    const entryA = playersMsg.players.find((p) => p.cid === 'aaa')
    assert.deepEqual(
      { x: entryA.x, z: entryA.z, ry: entryA.ry, anim: entryA.anim },
      { x: 12.5, z: -3, ry: 1.2, anim: 'walk' }
    )
  } finally {
    room.stop()
  }

  // leave 即时下发（不等 tick）
  room.removeSession(sessA)
  const leaveMsg = lastSent(wsB, 'leave')
  assert.ok(leaveMsg, 'leave 应即时广播')
  assert.equal(leaveMsg.cid, 'aaa')

  store.close()
})

test('非法 pos / 未知消息类型被忽略', async () => {
  const store = new Store(tempDbPath())
  const room = new Room({ store, broadcastIntervalMs: 40 })
  const ws = fakeWs()
  const sess = room.addSession(ws, 'u1')

  assert.equal(room.applyPos(sess, { x: NaN, z: 0 }), false)
  assert.equal(room.applyPos(sess, { x: '1', z: 0 }), false)
  assert.equal(room.applyPos(sess, { x: 1 }), false) // 缺 z
  assert.equal(room.applyPos(sess, { x: 1, z: 2, anim: 'x'.repeat(17) }), false) // anim 超长
  assert.equal(room.applyPos(sess, { x: 1, z: 2 }), true) // ry/anim 默认值合法
  assert.deepEqual(
    { x: sess.pos.x, z: sess.pos.z, ry: sess.pos.ry, anim: sess.pos.anim },
    { x: 1, z: 2, ry: 0, anim: 'idle' }
  )

  room.stop()
  store.close()
})

test('50 人上限内 isFull 判断正确', () => {
  const store = new Store(tempDbPath())
  const room = new Room({ store, capacity: 3 })
  const sessions = []
  for (let i = 0; i < 3; i++) sessions.push(room.addSession(fakeWs(), `c${i}`))
  assert.equal(room.isFull(), true)
  assert.equal(room.count, 3)
  room.removeSession(sessions[0])
  assert.equal(room.isFull(), false)
  store.close()
})
