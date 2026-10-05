// 房间层：会话管理、在场名单合并（WS 在场 + 心跳在线）、批量位置广播、聊天转发
import { CAPACITY, BROADCAST_INTERVAL_MS, HEARTBEAT_WINDOW_MS, NEAR_RADIUS, MAX_CHAT_LEN, SPAWN } from './config.js'

const WS_OPEN = 1

/** 无档案玩家的展示名：同事-{cid 前 4 位} */
export function displayNameFor(cid, profile) {
  return profile ? profile.nickname : `同事-${String(cid).slice(0, 4)}`
}

export class Room {
  constructor({
    store,
    capacity = CAPACITY,
    broadcastIntervalMs = BROADCAST_INTERVAL_MS,
    heartbeatWindowMs = HEARTBEAT_WINDOW_MS,
    nearRadius = NEAR_RADIUS,
    log = () => {}
  } = {}) {
    this.store = store
    this.capacity = capacity
    this.broadcastIntervalMs = broadcastIntervalMs
    this.heartbeatWindowMs = heartbeatWindowMs
    this.nearRadius = nearRadius
    this.log = log
    /** @type {Map<number, {id:number, ws:{send:Function,readyState:number}, cid:string, pos:object|null, joined:boolean}>} */
    this.sessions = new Map()
    this.nextSessionId = 1
    this.timer = null
  }

  get count() {
    return this.sessions.size
  }

  isFull() {
    return this.sessions.size >= this.capacity
  }

  addSession(ws, cid) {
    const session = { id: this.nextSessionId++, ws, cid, pos: null, joined: false }
    this.sessions.set(session.id, session)
    this.log(`join-ws cid=${cid} count=${this.sessions.size}`)
    return session
  }

  removeSession(session) {
    if (!this.sessions.delete(session.id)) return false
    this.log(`leave-ws cid=${session.cid} count=${this.sessions.size}`)
    this.broadcast({ type: 'leave', cid: session.cid })
    return true
  }

  /** 客户端 {type:'join'} → 回 init（self + 其他玩家 + 出生点） */
  handleJoin(session) {
    session.joined = true
    this.send(session, this.initPayload(session))
  }

  initPayload(session) {
    const profile = this.store.getProfile(session.cid)
    const players = []
    for (const other of this.sessions.values()) {
      if (other.id === session.id) continue
      players.push(this.wsPlayerEntry(other))
    }
    return {
      type: 'init',
      self: {
        cid: session.cid,
        nickname: displayNameFor(session.cid, profile),
        dept: profile?.dept ?? null,
        scene: true
      },
      players,
      world: { spawn: { ...SPAWN } }
    }
  }

  /** 客户端 {type:'pos', x,z,ry,anim}：仅记录，等 100ms 批量 tick 全量下发 */
  applyPos(session, msg) {
    const { x, z, ry = 0, anim = 'idle' } = msg
    if (!isFiniteNum(x) || !isFiniteNum(z) || !isFiniteNum(ry)) return false
    if (typeof anim !== 'string' || anim.length === 0 || anim.length > 16) return false
    session.pos = { x, z, ry, anim }
    return true
  }

  /** 客户端 {type:'chat', scope:'near'|'all', text≤500} → 转发 {type:'chat', from:{cid,name}, scope, text}（含发送者自身回显） */
  handleChat(session, msg) {
    const scope = msg?.scope
    const text = msg?.text
    if (scope !== 'near' && scope !== 'all') return false
    if (typeof text !== 'string' || text.length === 0 || text.length > MAX_CHAT_LEN) return false
    const payload = {
      type: 'chat',
      from: { cid: session.cid, name: displayNameFor(session.cid, this.store.getProfile(session.cid)) },
      scope,
      text
    }
    const targets = scope === 'all' ? this.sessions.values() : this.nearTargets(session)
    for (const target of targets) this.send(target, payload)
    return true
  }

  /** near：以发送者当前位置为圆心、半径 8m（无位置记录者按出生点处理） */
  nearTargets(sender) {
    const from = sender.pos ?? { x: SPAWN.x, z: SPAWN.z }
    const r2 = this.nearRadius * this.nearRadius
    const targets = []
    for (const s of this.sessions.values()) {
      const p = s.pos ?? { x: SPAWN.x, z: SPAWN.z }
      const dx = p.x - from.x
      const dz = p.z - from.z
      if (dx * dx + dz * dz <= r2) targets.push(s)
    }
    return targets
  }

  /** WS 会话玩家条目（scene=true，含位置） */
  wsPlayerEntry(session) {
    const profile = this.store.getProfile(session.cid)
    const pos = session.pos ?? { x: SPAWN.x, z: SPAWN.z, ry: 0, anim: 'idle' }
    return {
      cid: session.cid,
      name: displayNameFor(session.cid, profile),
      dept: profile?.dept ?? null,
      scene: true,
      x: pos.x,
      z: pos.z,
      ry: pos.ry,
      anim: pos.anim
    }
  }

  /** 心跳在线（不在场景）玩家条目：坐班工位小人 */
  seatedEntry(cid) {
    const profile = this.store.getProfile(cid)
    return {
      cid,
      name: displayNameFor(cid, profile),
      dept: profile?.dept ?? null,
      scene: false
    }
  }

  /**
   * 在场名单合并（D8）：WS 会话（scene=true）∪ 心跳 90s 内在线者（scene=false）。
   * 重复 cid 以 WS 会话优先（同一客户端开着 webview 时主进程也在心跳）。
   */
  buildPlayers() {
    const players = []
    const wsCids = new Set()
    for (const s of this.sessions.values()) {
      wsCids.add(s.cid)
      players.push(this.wsPlayerEntry(s))
    }
    for (const cid of this.store.heartbeatAliveCids(this.heartbeatWindowMs)) {
      if (wsCids.has(cid)) continue
      players.push(this.seatedEntry(cid))
    }
    return players
  }

  broadcastPlayers() {
    if (this.sessions.size === 0) return
    this.broadcast({ type: 'players', players: this.buildPlayers() })
  }

  broadcast(obj) {
    const data = JSON.stringify(obj)
    for (const s of this.sessions.values()) {
      if (s.ws.readyState === WS_OPEN) s.ws.send(data)
    }
  }

  send(session, obj) {
    if (session.ws.readyState === WS_OPEN) session.ws.send(JSON.stringify(obj))
  }

  start() {
    if (this.timer) return
    this.timer = setInterval(() => this.broadcastPlayers(), this.broadcastIntervalMs)
    this.timer.unref?.()
  }

  stop() {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  /** health 指标：online = 在线名单去重 cid 数（WS ∪ 心跳），inScene = 活跃 WS 会话数 */
  counts() {
    const cids = new Set(this.store.heartbeatAliveCids(this.heartbeatWindowMs))
    for (const s of this.sessions.values()) cids.add(s.cid)
    return { online: cids.size, inScene: this.sessions.size }
  }
}

function isFiniteNum(v) {
  return typeof v === 'number' && Number.isFinite(v)
}
