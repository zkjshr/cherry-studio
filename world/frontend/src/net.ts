// WS 会话层 —— 对齐 PRD §4 锁死契约（详见 world/shared-contract.md）。
// 客户端 → {join} {pos} {chat}；服务端 → {init} {players} {chat} {leave}。
// 断线自动重连；关闭码 4000（room_full）不重连，交由 UI 出满员提示。

export interface PlayerState {
  cid: string
  nickname: string
  dept: string
  x: number
  z: number
  ry: number
  anim: 'idle' | 'walk'
  /** true=在场景走动；false=在线但不在场景（前端渲染为坐在部门工位） */
  scene: boolean
}

export interface ChatMsg {
  from: string
  scope: 'near' | 'all'
  text: string
}

export interface InitMsg {
  type: 'init'
  self: { cid: string; nickname: string; dept: string; x?: number; z?: number }
  players: PlayerState[]
  world?: Record<string, unknown>
}

export type NetStatus = 'connecting' | 'open' | 'reconnecting' | 'room_full'

export interface NetHandlers {
  onInit(init: InitMsg): void
  onPlayers(players: PlayerState[]): void
  onChat(msg: ChatMsg): void
  onLeave(cid: string): void
  onStatus(status: NetStatus, detail?: string): void
}

const RETRY_BASE_MS = 900
const RETRY_MAX_MS = 8000

export class WorldNet {
  private ws: WebSocket | null = null
  private retry = 0
  private retryTimer: number | undefined
  private closedByUs = false
  private everOpened = false

  constructor(private readonly h: NetHandlers) {}

  connect(cid: string, token: string): void {
    this.closedByUs = false
    clearTimeout(this.retryTimer)
    const proto = location.protocol === 'https:' ? 'wss' : 'ws'
    const url = `${proto}//${location.host}/ws?cid=${encodeURIComponent(cid)}&token=${encodeURIComponent(token)}`
    this.h.onStatus(this.everOpened ? 'reconnecting' : 'connecting')
    const ws = new WebSocket(url)
    this.ws = ws

    ws.onopen = () => {
      this.everOpened = true
      this.retry = 0
      this.sendRaw({ type: 'join' })
      this.h.onStatus('open')
    }

    ws.onmessage = (ev) => {
      let m: any
      try {
        m = JSON.parse(ev.data as string)
      } catch {
        return
      }
      switch (m?.type) {
        case 'init':
          this.h.onInit({
            type: 'init',
            self: m.self ?? { cid: '', nickname: '', dept: '' },
            players: Array.isArray(m.players) ? m.players : [],
            world: m.world
          })
          break
        case 'players':
          if (Array.isArray(m.players)) this.h.onPlayers(m.players)
          break
        case 'chat':
          if (typeof m.text === 'string')
            this.h.onChat({ from: String(m.from ?? ''), scope: m.scope === 'all' ? 'all' : 'near', text: m.text })
          break
        case 'leave':
          if (typeof m.cid === 'string') this.h.onLeave(m.cid)
          break
      }
    }

    ws.onclose = (ev) => {
      if (this.ws !== ws) return
      this.ws = null
      if (this.closedByUs) return
      // 满员：服务端以 4000 关闭（reason 兼容 room_full 字样）
      if (ev.code === 4000 || /room_full/i.test(ev.reason || '')) {
        this.h.onStatus('room_full')
        return
      }
      const delay = Math.min(RETRY_MAX_MS, RETRY_BASE_MS * Math.pow(1.8, this.retry++))
      this.h.onStatus('reconnecting', `${delay}`)
      this.retryTimer = window.setTimeout(() => this.connect(cid, token), delay)
    }
  }

  /** 重新入场景（例如档案填写后）：断开旧会话再连 */
  rejoin(cid: string, token: string): void {
    this.close()
    this.everOpened = false
    this.retry = 0
    this.connect(cid, token)
  }

  sendPos(x: number, z: number, ry: number, anim: 'idle' | 'walk'): void {
    this.sendRaw({ type: 'pos', x: round3(x), z: round3(z), ry: round3(ry), anim })
  }

  sendChat(text: string, scope: 'near' | 'all'): void {
    this.sendRaw({ type: 'chat', scope, text })
  }

  close(): void {
    this.closedByUs = true
    clearTimeout(this.retryTimer)
    if (this.ws) {
      try {
        this.ws.close(1000)
      } catch {
        /* noop */
      }
      this.ws = null
    }
  }

  private sendRaw(obj: unknown): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(obj))
  }
}

function round3(v: number): number {
  return Math.round(v * 1000) / 1000
}
