// 聊天 UI（PRD §5 / 任务 W1b）：
//  - near 消息 → 头顶气泡（仅与自己的距离 ≤ NEAR_M 时显示，超出自动隐藏）
//  - all  消息 → 右侧「全体频道」列表
//  - Enter 聚焦输入框、Enter 发送、Esc 失焦；范围可切换（附近/全体）

import * as THREE from 'three'

export const NEAR_M = 8

const BUBBLE_LIFE = 6.5 // 气泡停留秒数
const MAX_LINES = 4

interface Bubble {
  sprite: THREE.Sprite
  mat: THREE.SpriteMaterial
  tex: THREE.CanvasTexture
  until: number
  offsetY: number
}

export class ChatUI {
  onSend: ((text: string, scope: 'near' | 'all') => void) | null = null

  private readonly panel: HTMLElement
  private readonly bar: HTMLElement
  private readonly list: HTMLElement
  private readonly input: HTMLInputElement
  private scope: 'near' | 'all' = 'near'
  private readonly bubbles = new Map<THREE.Object3D, Bubble>()
  private readonly bubbleGroup = new THREE.Group()

  constructor() {
    this.panel = byId('chat-panel')
    this.bar = byId('chat-bar')
    this.list = byId('chat-list')
    this.input = byId('chat-input') as HTMLInputElement
    this.bubbleGroup.renderOrder = 10

    this.input.addEventListener('keydown', (e) => {
      e.stopPropagation()
      if (e.key === 'Enter') {
        const text = this.input.value.trim()
        if (text) {
          this.input.value = ''
          this.onSend?.(text, this.scope)
        }
      } else if (e.key === 'Escape') {
        this.input.blur()
      }
    })

    for (const btn of Array.from(byId('chat-scope').querySelectorAll('button'))) {
      btn.addEventListener('click', () => {
        this.scope = (btn as HTMLElement).dataset.scope === 'all' ? 'all' : 'near'
        for (const b of Array.from(byId('chat-scope').querySelectorAll('button'))) b.classList.toggle('on', b === btn)
        this.input.placeholder =
          this.scope === 'near' ? '和身边的同事聊聊…（Enter 发送）' : '对全院广播一句话…（Enter 发送）'
        this.focusInput()
      })
    }
  }

  addToScene(scene: THREE.Scene): void {
    scene.add(this.bubbleGroup)
  }

  setEnabled(v: boolean): void {
    this.panel.hidden = !v
    this.bar.hidden = !v
    if (!v) this.input.blur()
  }

  isTyping(): boolean {
    return document.activeElement === this.input
  }

  focusInput(): void {
    this.input.focus()
  }

  /** 全体频道消息进侧栏 */
  addListMessage(name: string, dept: string, text: string, mine: boolean): void {
    const empty = this.list.querySelector('.empty')
    if (empty) empty.remove()
    const row = document.createElement('div')
    row.className = 'msg' + (mine ? ' me' : '')
    const who = document.createElement('span')
    who.className = 'who'
    who.textContent = name
    if (dept) {
      const d = document.createElement('span')
      d.className = 'dept'
      d.textContent = dept
      who.appendChild(d)
    }
    const txt = document.createElement('span')
    txt.textContent = text
    row.append(who, txt)
    this.list.appendChild(row)
    while (this.list.children.length > 200) this.list.firstChild?.remove()
    this.list.scrollTop = this.list.scrollHeight
  }

  clearList(): void {
    this.list.innerHTML = '<div class="empty">还没有消息，说点什么吧。</div>'
  }

  /** 头顶气泡（同一化身新气泡替换旧的） */
  addBubble(holder: THREE.Object3D, text: string, offsetY: number, now: number): void {
    const prev = this.bubbles.get(holder)
    if (prev) this.removeBubble(holder, prev)
    const tex = bubbleTexture(text)
    const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false })
    const sprite = new THREE.Sprite(mat)
    sprite.scale.set(Math.min(5.4, tex.image.width / 100), Math.min(2.2, tex.image.height / 100), 1)
    this.bubbleGroup.add(sprite)
    this.bubbles.set(holder, { sprite, mat, tex, until: now + BUBBLE_LIFE, offsetY })
  }

  /** 每帧：按距离显隐 + 到期淡出移除 */
  update(now: number, selfPos: THREE.Vector3): void {
    const v = new THREE.Vector3()
    for (const [holder, b] of this.bubbles) {
      if (!holder.parent) {
        this.removeBubble(holder, b)
        continue
      }
      holder.getWorldPosition(v)
      v.y += b.offsetY
      b.sprite.position.copy(v)
      const dist = Math.hypot(v.x - selfPos.x, v.z - selfPos.z)
      const left = b.until - now
      if (left <= 0) {
        this.removeBubble(holder, b)
        continue
      }
      const vis = dist <= NEAR_M + 0.5
      b.mat.opacity = vis ? Math.min(1, left / 1.2) : 0
      b.sprite.visible = vis
    }
  }

  private removeBubble(holder: THREE.Object3D, b: Bubble): void {
    this.bubbleGroup.remove(b.sprite)
    b.mat.dispose()
    b.tex.dispose()
    this.bubbles.delete(holder)
  }
}

function bubbleTexture(text: string): THREE.CanvasTexture {
  // 简单按字符折行（中文为主），最多 4 行
  const perLine = 14
  const chars = Array.from(text.slice(0, 120))
  const lines: string[] = []
  for (let i = 0; i < chars.length && lines.length < MAX_LINES; i += perLine) {
    lines.push(chars.slice(i, i + perLine).join(''))
  }
  if (chars.length > perLine * MAX_LINES) lines[MAX_LINES - 1] = lines[MAX_LINES - 1].slice(0, perLine - 1) + '…'
  const maxLen = Math.max(...lines.map((l) => Array.from(l).length))
  const w = Math.max(120, maxLen * 26 + 44)
  const h = lines.length * 34 + 26
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')!
  const r = 14
  roundRect(ctx, 3, 3, w - 6, h - 6, r)
  ctx.fillStyle = 'rgba(255,255,255,0.94)'
  ctx.fill()
  ctx.strokeStyle = 'rgba(20,30,50,0.12)'
  ctx.lineWidth = 2
  ctx.stroke()
  ctx.fillStyle = '#1f2937'
  ctx.font = '400 24px "PingFang SC", "Microsoft YaHei", sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  lines.forEach((line, i) => ctx.fillText(line, w / 2, 20 + i * 34))
  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}

function byId(id: string): HTMLElement {
  const el = document.getElementById(id)
  if (!el) throw new Error(`missing #${id}`)
  return el
}
