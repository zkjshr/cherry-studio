// Lowpoly 小人化身（PRD D6）：头/身体/四肢拼装，部门色着色，头顶名字牌（Sprite）。
// 支持行走摆动（含轻微上下 bob）与「坐姿办公」姿态（在线不在场者）。
// 朝向约定：ry=0 时面朝 +Z，前方 = (sin ry, cos ry)——与服务端转发的 ry 及 deskSpot.ry 一致。

import * as THREE from 'three'

const SKIN = 0xe8b78c
const HAIR = 0x2f2a26
const PANTS = 0x39465a

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
  seated = false

  constructor(color: number, nickname: string) {
    const lam = (c: number) => {
      const m = new THREE.MeshLambertMaterial({ color: c, flatShading: true })
      this.disposables.push(m)
      return m
    }
    const mDept = lam(color)
    const mSkin = lam(SKIN)
    const mHair = lam(HAIR)
    const mPants = lam(PANTS)

    const torso = new THREE.Mesh(geoTorso, mDept)
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
    this.armL = limb(mDept, -0.32, 1.4)
    this.armR = limb(mDept, 0.32, 1.4)
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

    // 名字牌
    const nameTex = makeNameTexture(nickname)
    this.disposables.push(nameTex)
    const sm = new THREE.SpriteMaterial({ map: nameTex, depthWrite: false })
    this.disposables.push(sm)
    this.nameSprite = new THREE.Sprite(sm)
    this.nameSprite.scale.set(1.9, 0.53, 1)
    this.nameSprite.position.y = 2.2
    this.group.add(this.nameSprite)
  }

  /** 坐姿（工位办公）与起身。世界坐标/朝向由调用方设置在 group 上。 */
  setSeated(v: boolean): void {
    this.seated = v
    if (v) {
      this.legL.rotation.x = -1.45
      this.legR.rotation.x = -1.45
      this.armL.rotation.x = -0.9
      this.armR.rotation.x = -0.9
      this.head.rotation.x = 0.32 // 低头办公
      this.body.position.y = -0.34
      this.nameSprite.position.y = 1.75
      this.walkBlend = 0
    } else {
      this.legL.rotation.x = 0
      this.legR.rotation.x = 0
      this.armL.rotation.x = 0
      this.armR.rotation.x = 0
      this.head.rotation.x = 0
      this.body.position.y = 0
      this.nameSprite.position.y = 2.2
      this.phase = 0
    }
  }

  /** 每帧调用：walking 时四肢摆动 + 身体微 bob；坐姿时忽略 */
  setWalking(walking: boolean, dt: number): void {
    if (this.seated) return
    this.walkBlend += ((walking ? 1 : 0) - this.walkBlend) * Math.min(1, dt * 10)
    if (walking) this.phase += dt * 9
    const s = Math.sin(this.phase) * this.walkBlend
    this.legL.rotation.x = s * 0.55
    this.legR.rotation.x = -s * 0.55
    this.armL.rotation.x = -s * 0.4
    this.armR.rotation.x = s * 0.4
    this.body.position.y = Math.abs(Math.sin(this.phase)) * 0.05 * this.walkBlend
  }

  dispose(scene: THREE.Scene): void {
    scene.remove(this.group)
    for (const d of this.disposables) d.dispose()
  }
}

function makeNameTexture(nickname: string): THREE.CanvasTexture {
  const label = (nickname || '同事').slice(0, 12)
  const w = 256
  const h = 72
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
  let size = 34
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  do {
    ctx.font = `600 ${size}px "PingFang SC", "Microsoft YaHei", sans-serif`
    size -= 2
  } while (ctx.measureText(label).width > w - 36 && size > 16)
  ctx.fillStyle = '#ffffff'
  ctx.fillText(label, w / 2, h / 2 + 2)
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
