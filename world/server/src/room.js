// 房间层（v2）：场景会话管理、players 全量广播、三通道聊天（near/all/room）、
// 小房子进出（≤6 人/间）、表情转发。心跳在线者不再进 players（坐班小人已废弃），
// 仅作 /api/health 的 clients 统计。
import {
  CAPACITY,
  BROADCAST_INTERVAL_MS,
  HEARTBEAT_WINDOW_MS,
  NEAR_RADIUS,
  MAX_CHAT_LEN,
  MAX_EMOTE_LEN,
  HOUSE_IDS,
  HOUSE_CAPACITY,
  SPAWN
} from './config.js'

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
    houseCapacity = HOUSE_CAPACITY,
    log = () => {}
  } = {}) {
    this.store = store
    this.capacity = capacity
    this.broadcastIntervalMs = broadcastIntervalMs
    this.heartbeatWindowMs = heartbeatWindowMs
    this.nearRadius = nearRadius
    this.houseCapacity = houseCapacity
    this.log = log
    /** @type {Map<number, {id:number, ws:{send:Function,readyState:number}, cid:string, pos:object|null, houseId:string|null, joined:boolean}>} */
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
    const session = { id: this.nextSessionId++, ws, cid, pos: null, houseId: null, joined: false }
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
        // 无档案 → 空昵称，前端据此弹出身份填写框（shared-contract §1）
        nickname: profile?.nickname ?? '',
        dept: profile?.dept ?? null,
        color: profile?.color ?? null,
        houseId: null
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

  /**
   * 客户端 {type:'house', id:'h1'|null}：进入/离开小房子。
   * 成功 → 对请求者回 {type:'house_ok', id}；满员（同房子会话数 ≥ houseCapacity）→
   * 仅对请求者回 {type:'house_full', id}，不改变成员关系。
   */
  handleHouse(session, msg) {
    const id = msg?.id
    if (id === null) {
      if (session.houseId === null) return false
      session.houseId = null
      this.log(`house-leave cid=${session.cid}`)
      this.send(session, { type: 'house_ok', id: null })
      this.broadcastPlayers()
      return true
    }
    if (typeof id !== 'string' || !HOUSE_IDS.includes(id)) return false
    if (session.houseId === id) return true
    const inHouse = [...this.sessions.values()].filter((s) => s.houseId === id).length
    if (inHouse >= this.houseCapacity) {
      this.log(`house-full cid=${session.cid} house=${id}`)
      this.send(session, { type: 'house_full', id })
      return false
    }
    session.houseId = id
    this.log(`house-join cid=${session.cid} house=${id}`)
    this.send(session, { type: 'house_ok', id })
    this.broadcastPlayers()
    return true
  }

  /**
   * 客户端 {type:'chat', scope:'near'|'all'|'room', text≤500} →
   * 转发 {type:'chat', from:{cid,name}, scope, text}（含发送者自身回显）。
   * near=8m 半径；all=全员；room=同房子会话（发送者须在房内）。
   */
  handleChat(session, msg) {
    const scope = msg?.scope
    const text = msg?.text
    if (scope !== 'near' && scope !== 'all' && scope !== 'room') return false
    if (typeof text !== 'string' || text.length === 0 || text.length > MAX_CHAT_LEN) return false
    if (scope === 'room' && session.houseId === null) return false
    const payload = {
      type: 'chat',
      from: { cid: session.cid, name: displayNameFor(session.cid, this.store.getProfile(session.cid)) },
      scope,
      text
    }
    let targets
    if (scope === 'all') targets = this.sessions.values()
    else if (scope === 'room') targets = this.sessions.values().filter((s) => s.houseId === session.houseId)
    else targets = this.nearTargets(session)
    for (const target of targets) this.send(target, payload)
    return true
  }

  /** 客户端 {type:'emote', emoji} → 8m 内转发 {type:'emote', from, emoji}（含发送者回显） */
  handleEmote(session, msg) {
    const emoji = msg?.emoji
    if (typeof emoji !== 'string' || emoji.length === 0 || emoji.length > MAX_EMOTE_LEN) return false
    const payload = {
      type: 'emote',
      from: { cid: session.cid, name: displayNameFor(session.cid, this.store.getProfile(session.cid)) },
      emoji
    }
    for (const target of this.nearTargets(session)) this.send(target, payload)
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

  /** 场景内玩家条目（v2：players 仅含打开页面的会话；坐班小人已废弃） */
  wsPlayerEntry(session) {
    const profile = this.store.getProfile(session.cid)
    const pos = session.pos ?? { x: SPAWN.x, z: SPAWN.z, ry: 0, anim: 'idle' }
    return {
      cid: session.cid,
      name: displayNameFor(session.cid, profile),
      dept: profile?.dept ?? null,
      color: profile?.color ?? null,
      houseId: session.houseId,
      x: pos.x,
      z: pos.z,
      ry: pos.ry,
      anim: pos.anim
    }
  }

  buildPlayers() {
    const players = []
    for (const s of this.sessions.values()) players.push(this.wsPlayerEntry(s))
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

  /**
   * health 指标（v2 语义）：
   * online = 场景内人数（打开页面 = 活跃 WS 会话，即对外公示的"在线人数"）
   * clients = 心跳客户端数（装了客户端但未必打开页面，仅管理端统计用）
   */
  counts() {
    return { online: this.sessions.size, clients: this.store.heartbeatAliveCids(this.heartbeatWindowMs).length }
  }
}

function isFiniteNum(v) {
  return typeof v === 'number' && Number.isFinite(v)
}
