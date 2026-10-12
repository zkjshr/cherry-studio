// 小地图（v2 §5）：左上角鸟瞰示意 + 玩家点位 + 点击传送。
// 静态底图一次性绘制（海/岛/广场/建筑/房子/码头），动态层只画点，200ms 一拍。

import { HOUSES, LANDMARKS, ISLAND_BOUND_R, PIER } from './island'

const WORLD_SPAN = 176 // 地图覆盖的世界宽度（米），居中于原点
const SIZE = 168 // 画布边长（px）

const WATER = '#4a8ec2'
const GRASS = '#86b95c'
const SAND = '#e5d5a1'
const PLAZA = '#d8d5cc'

const LANDMARK_COLORS: Record<string, string> = {
  news: '#7a5fa8',
  notice: '#c96f4a',
  standards: '#3d7edb',
  board: '#d8b22f',
  quiz: '#e2699f'
}

export class Minimap {
  onTeleport: ((x: number, z: number) => void) | null = null

  private readonly canvas: HTMLCanvasElement
  private readonly ctx: CanvasRenderingContext2D
  private readonly base: HTMLCanvasElement
  private readonly toWorld = WORLD_SPAN / SIZE

  constructor() {
    this.canvas = document.getElementById('minimap') as HTMLCanvasElement
    this.canvas.width = SIZE
    this.canvas.height = SIZE
    this.ctx = this.canvas.getContext('2d')!
    this.base = document.createElement('canvas')
    this.base.width = SIZE
    this.base.height = SIZE
    this.drawBase()
    this.canvas.addEventListener('click', (e) => {
      const rect = this.canvas.getBoundingClientRect()
      const px = e.clientX - rect.left
      const py = e.clientY - rect.top
      this.onTeleport?.((px - SIZE / 2) * this.toWorld, (py - SIZE / 2) * this.toWorld)
    })
  }

  setEnabled(v: boolean): void {
    this.canvas.hidden = !v
  }

  /** 每帧或定时调用：叠动态点 */
  render(self: { x: number; z: number; ry: number }, others: Array<{ x: number; z: number }>): void {
    const ctx = this.ctx
    ctx.clearRect(0, 0, SIZE, SIZE)
    ctx.drawImage(this.base, 0, 0)
    for (const o of others) {
      const [px, py] = this.proj(o.x, o.z)
      ctx.fillStyle = '#ffffff'
      ctx.beginPath()
      ctx.arc(px, py, 2.6, 0, Math.PI * 2)
      ctx.fill()
      ctx.strokeStyle = 'rgba(30,40,60,0.5)'
      ctx.lineWidth = 1
      ctx.stroke()
    }
    const [sx, sy] = this.proj(self.x, self.z)
    ctx.save()
    ctx.translate(sx, sy)
    ctx.rotate(-self.ry)
    ctx.fillStyle = '#ffd75e'
    ctx.strokeStyle = 'rgba(30,40,60,0.7)'
    ctx.beginPath()
    ctx.moveTo(0, -5.5)
    ctx.lineTo(4, 4)
    ctx.lineTo(0, 2)
    ctx.lineTo(-4, 4)
    ctx.closePath()
    ctx.fill()
    ctx.stroke()
    ctx.restore()
  }

  private proj(x: number, z: number): [number, number] {
    return [SIZE / 2 + x / this.toWorld, SIZE / 2 + z / this.toWorld]
  }

  private rect(ctx: CanvasRenderingContext2D, b: { minX: number; maxX: number; minZ: number; maxZ: number }, color: string): void {
    const [x1, y1] = this.proj(b.minX, b.minZ)
    const [x2, y2] = this.proj(b.maxX, b.maxZ)
    ctx.fillStyle = color
    ctx.fillRect(Math.min(x1, x2), Math.min(y1, y2), Math.abs(x2 - x1), Math.abs(y2 - y1))
  }

  private drawBase(): void {
    const ctx = this.base.getContext('2d')!
    ctx.fillStyle = WATER
    ctx.fillRect(0, 0, SIZE, SIZE)
    // 岛（圆）+ 沙环
    const [cx, cy] = this.proj(0, 0)
    ctx.fillStyle = SAND
    ctx.beginPath()
    ctx.arc(cx, cy, (ISLAND_BOUND_R + 8) / this.toWorld, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = GRASS
    ctx.beginPath()
    ctx.arc(cx, cy, (ISLAND_BOUND_R - 4) / this.toWorld, 0, Math.PI * 2)
    ctx.fill()
    // 码头
    this.rect(ctx, { minX: PIER.minX, maxX: PIER.maxX, minZ: 56, maxZ: PIER.maxZ }, '#c9a26a')
    // 广场
    const [px, py] = this.proj(0, 0)
    ctx.fillStyle = PLAZA
    ctx.beginPath()
    ctx.arc(px, py, 20 / this.toWorld, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = '#8a9a6a'
    ctx.beginPath()
    ctx.arc(px, py, 2.6 / this.toWorld, 0, Math.PI * 2)
    ctx.fill()
    // 建筑
    for (const l of LANDMARKS) this.rect(ctx, l.box, LANDMARK_COLORS[l.name])
    // 小房子
    for (const h of HOUSES) {
      const [hx, hy] = this.proj(h.cx, h.cz)
      ctx.fillStyle = '#b98d5a'
      ctx.fillRect(hx - 3.4, hy - 3, 6.8, 6)
      ctx.fillStyle = '#5b4632'
      ctx.font = '700 9px sans-serif'
      ctx.textAlign = 'center'
      ctx.fillText(h.name, hx, hy + 3.2)
    }
    // 边框
    ctx.strokeStyle = 'rgba(255,255,255,0.35)'
    ctx.lineWidth = 2
    ctx.strokeRect(1, 1, SIZE - 2, SIZE - 2)
  }
}
