// Lowpoly 小人化身（v2 §4）：头/身体/四肢拼装，外观配色着色，头顶名牌（昵称+部门，
// 等级头衔前缀预留）。支持行走摆动（含轻微上下 bob）与动作姿态（挥手/鼓掌/跳舞，
// 快捷键 1/2/3；随 pos.anim 同步给他人）。
// 朝向约定：ry=0 时面朝 +Z，前方 = (sin ry, cos ry)。

import * as THREE from 'three'

const SKIN = 0xe8b78c
const HAIR = 0x2f2a26
const PANTS = 0x39465a

/** 动作时长（秒）；与 anim 字段同步：'wave' | 'clap' | 'dance' */
export const GESTURES = ['wave', 'clap', 'dance'] as const
export type GestureName = (typeof GESTURES)[number]
export const GESTURE_SEC = 2.6

// 共享几何（顶点在创建时平移，使四肢可绕髋/肩旋转）
const geoTorso = new THREE.BoxGeometry(0.46, 0.62, 0.26)
const geoHead = new THREE.BoxGeometry(0.3, 0.3, 0.28)
const geoHair = new THREE.BoxGeometry(0.32, 0.09, 0.3)
const geoArm = new THREE.BoxGeometry(0.13, 0.58, 0.15)
geoArm.translate(0, -0.29, 0)
const geoLeg = new THREE.BoxGeometry(0.16, 0.8, 0.18)
geoLeg.translate(0, -0.4, 0)

export class Avatar {
  readonly group = new THREE.Group()

  private readonly body = new THREE.Group()
  private readonly legL: THREE.Group
  private readonly legR: THREE.Group
  private readonly armL: THREE.Group
  private readonly armR: THREE.Group
  private readonly head: THREE.Mesh
  private readonly nameSprite: THREE.Sprite
  private readonly disposables: Array<{ dispose(): void }> = []

  private phase = 0
  private walkBlend = 0
  private gesture: GestureName | null = null
  private gestureLeft = 0

  constructor(color: number, nickname: string, dept = '') {
    const lam = (c: number) => {
      const m = new THREE.MeshLambertMaterial({ color: c, flatShading: true })
      this.disposables.push(m)
      return m
    }
    const mBody = lam(color)
    const mSkin = lam(SKIN)
    const mHair = lam(HAIR)
    const mPants = lam(PANTS)

    const torso = new THREE.Mesh(geoTorso, mBody)
    torso.position.y = 1.12
    torso.castShadow = true

    this.head = new THREE.Mesh(geoHead, mSkin)
    this.head.position.y = 1.62
    this.head.castShadow = true
    const hair = new THREE.Mesh(geoHair, mHair)
    hair.position.set(0, 0.15, -0.01)
    this.head.add(hair)

    const limb = (m: THREE.Material, x: number, y: number) => {
      const pivot = new THREE.Group()
      pivot.position.set(x, y, 0)
      pivot.add(new THREE.Mesh(geoArm, m))
      this.body.add(pivot)
      return pivot
    }
    this.armL = limb(mBody, -0.32, 1.4)
    this.armR = limb(mBody, 0.32, 1.4)
    const leg = (x: number) => {
      const pivot = new THREE.Group()
      pivot.position.set(x, 0.8, 0)
      const mesh = new THREE.Mesh(geoLeg, mPants)
      mesh.castShadow = true
      pivot.add(mesh)
      this.body.add(pivot)
      return pivot
    }
    this.legL = leg(-0.12)
    this.legR = leg(0.12)

    this.body.add(torso, this.head)
    this.group.add(this.body)

    // 名字牌（昵称 + 部门；titlePrefix 预留等级头衔，M2 填充）
    const nameTex = makeNameTexture(nickname, dept, '')
    this.disposables.push(nameTex)
    const sm = new THREE.SpriteMaterial({ map: nameTex, depthWrite: false })
    this.disposables.push(sm)
    this.nameSprite = new THREE.Sprite(sm)
    this.nameSprite.scale.set(2.1, 0.62, 1)
    this.nameSprite.position.y = 2.3
    this.group.add(this.nameSprite)
  }

  /** 播放动作（同名动作播放中则不重启动）；远端同款由 pos.anim 触发 */
  playGesture(name: GestureName): void {
    if (this.gesture === name && this.gestureLeft > 0) return
    this.gesture = name
    this.gestureLeft = GESTURE_SEC
    this.walkBlend = 0
  }

  get activeGesture(): GestureName | null {
    return this.gestureLeft > 0 ? this.gesture : null
  }

  /** 每帧调用：动作姿态优先，其次行走摆动 */
  setWalking(walking: boolean, dt: number): void {
    if (this.gestureLeft > 0 && this.gesture) {
      this.gestureLeft -= dt
      this.phase += dt * 7
      this.applyGesture(this.gesture)
      if (this.gestureLeft <= 0) this.resetPose()
      return
    }
    this.walkBlend += ((walking ? 1 : 0) - this.walkBlend) * Math.min(1, dt * 10)
    if (walking) this.phase += dt * 9
    const s = Math.sin(this.phase) * this.walkBlend
    this.legL.rotation.x = s * 0.55
    this.legR.rotation.x = -s * 0.55
    this.armL.rotation.x = -s * 0.4
    this.armR.rotation.x = s * 0.4
    this.body.position.y = Math.abs(Math.sin(this.phase)) * 0.05 * this.walkBlend
    this.body.rotation.z = 0
  }

  private applyGesture(name: GestureName): void {
    const t = this.phase
    switch (name) {
      case 'wave': {
        this.armR.rotation.x = 0
        this.armR.rotation.z = -2.6 + Math.sin(t * 2.2) * 0.35 // 右臂上举摆动
        this.armL.rotation.x = 0
        this.body.rotation.z = 0
        this.body.position.y = 0
        break
      }
      case 'clap': {
        const c = Math.abs(Math.sin(t * 2.6)) * 0.55
        this.armL.rotation.x = -1.15
        this.armR.rotation.x = -1.15
        this.armL.rotation.z = -c
        this.armR.rotation.z = c
        this.body.position.y = Math.abs(Math.sin(t * 2.6)) * 0.04
        this.body.rotation.z = 0
        break
      }
      case 'dance': {
        this.armL.rotation.x = -2.4 + Math.sin(t) * 0.5
        this.armR.rotation.x = -2.4 - Math.sin(t) * 0.5
        this.armL.rotation.z = 0.35
        this.armR.rotation.z = -0.35
        this.body.rotation.z = Math.sin(t) * 0.16
        this.body.position.y = Math.abs(Math.sin(t * 2)) * 0.08
        this.legL.rotation.x = Math.sin(t) * 0.3
        this.legR.rotation.x = -Math.sin(t) * 0.3
        break
      }
    }
  }

  private resetPose(): void {
    this.legL.rotation.set(0, 0, 0)
    this.legR.rotation.set(0, 0, 0)
    this.armL.rotation.set(0, 0, 0)
    this.armR.rotation.set(0, 0, 0)
    this.body.rotation.z = 0
    this.body.position.y = 0
    this.phase = 0
  }

  dispose(scene: THREE.Scene): void {
    scene.remove(this.group)
    for (const d of this.disposables) d.dispose()
  }
}

function makeNameTexture(nickname: string, dept: string, titlePrefix: string): THREE.CanvasTexture {
  const label = `${titlePrefix}${(nickname || '同事').slice(0, 12)}`
  const w = 256
  const h = 96
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')!
  roundRect(ctx, 4, 4, w - 8, h - 8, 17)
  ctx.fillStyle = 'rgba(17, 24, 38, 0.62)'
  ctx.fill()
  ctx.strokeStyle = 'rgba(255,255,255,0.18)'
  ctx.lineWidth = 2
  ctx.stroke()
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  let size = 32
  do {
    ctx.font = `600 ${size}px "PingFang SC", "Microsoft YaHei", sans-serif`
    size -= 2
  } while (ctx.measureText(label).width > w - 36 && size > 16)
  ctx.fillStyle = '#ffffff'
  ctx.fillText(label, w / 2, dept ? h / 2 - 10 : h / 2 + 2)
  if (dept) {
    ctx.font = '400 22px "PingFang SC", "Microsoft YaHei", sans-serif'
    ctx.fillStyle = '#aebfd8'
    ctx.fillText(dept.slice(0, 8), w / 2, h / 2 + 20)
  }
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
