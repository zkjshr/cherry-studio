// 表情特效（v2 §4）：快捷栏点选 → 化身头顶浮大 emoji，2 秒上浮渐隐，附近所有人可见。
// 纯客户端表现层；数据由 WS {type:'emote'} 转发（8m 半径）。

import * as THREE from 'three'

const LIFE = 2.0

interface Fx {
  sprite: THREE.Sprite
  mat: THREE.SpriteMaterial
  tex: THREE.CanvasTexture
  holder: THREE.Object3D
  born: number
  seed: number
}

export class EmoteFx {
  onSend: ((emoji: string) => void) | null = null

  private readonly group = new THREE.Group()
  private readonly fxList: Fx[] = []
  private readonly disposables: Array<{ dispose(): void }> = []

  constructor() {
    this.group.renderOrder = 11
  }

  addToScene(scene: THREE.Scene): void {
    scene.add(this.group)
  }

  /** 绑定快捷栏按钮（#emote-bar 内的 [data-emoji]） */
  bindBar(onSend: (emoji: string) => void): void {
    this.onSend = onSend
    const bar = document.getElementById('emote-bar')
    if (!bar) return
    for (const btn of Array.from(bar.querySelectorAll('button[data-emoji]'))) {
      btn.addEventListener('click', () => {
        const emoji = (btn as HTMLElement).dataset.emoji
        if (emoji) onSend(emoji)
      })
    }
  }

  setEnabled(v: boolean): void {
    const bar = document.getElementById('emote-bar')
    if (bar) bar.hidden = !v
  }

  spawn(holder: THREE.Object3D, emoji: string, now: number): void {
    const tex = emojiTexture(emoji)
    const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false })
    const sprite = new THREE.Sprite(mat)
    sprite.scale.set(1.15, 1.15, 1)
    this.group.add(sprite)
    this.fxList.push({ sprite, mat, tex, holder, born: now, seed: Math.random() })
  }

  /** 每帧：上浮 + 渐隐 + 到期回收 */
  update(now: number): void {
    const v = new THREE.Vector3()
    for (let i = this.fxList.length - 1; i >= 0; i--) {
      const f = this.fxList[i]
      const t = (now - f.born) / LIFE
      if (t >= 1 || !f.holder.parent) {
        this.group.remove(f.sprite)
        f.mat.dispose()
        f.tex.dispose()
        this.fxList.splice(i, 1)
        continue
      }
      f.holder.getWorldPosition(v)
      f.sprite.position.set(
        v.x + Math.sin(f.seed * 9 + t * 4) * 0.12,
        v.y + 2.7 + t * 1.1,
        v.z
      )
      const pop = t < 0.15 ? 0.6 + (t / 0.15) * 0.5 : 1.1
      f.sprite.scale.set(1.15 * pop, 1.15 * pop, 1)
      f.mat.opacity = t > 0.7 ? 1 - (t - 0.7) / 0.3 : 1
    }
  }

  dispose(scene: THREE.Scene): void {
    scene.remove(this.group)
    for (const f of this.fxList) {
      f.mat.dispose()
      f.tex.dispose()
    }
    this.fxList.length = 0
    for (const d of this.disposables) d.dispose()
  }
}

function emojiTexture(emoji: string): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = 128
  canvas.height = 128
  const ctx = canvas.getContext('2d')!
  ctx.font = '96px "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(emoji.slice(0, 4), 64, 70)
  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}
