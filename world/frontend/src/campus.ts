// 园区场景（PRD §5）：地面/道路/绿化/停车场/主楼 + 各部门开放式工位区。
// 纯顶点/材质色 lowpoly，明快白天，无贴图依赖（文字标牌用 canvas 纹理）。
// 本模块同时是「坐姿工位」的唯一数据源：DEPT_ZONES + seatedSpot()，
// 规则见 world/shared-contract.md —— 在线不在场(scene=false)的玩家按
// (部门, 该部门坐姿者序号) 确定性落座 deskSpots[i % len]，与服务端无交互。

import * as THREE from 'three'

/** 部门清单（与 PRD §4 /api/profile 选项一致） */
export const DEPT_LIST = ['建筑', '结构', '机电', '规划', '景观', '室内', '职能部门', '信息化中心', '其他'] as const

export const DEPT_COLORS: Readonly<Record<string, number>> = {
  建筑: 0xe2554b,
  结构: 0x3d7edb,
  机电: 0xef8f2e,
  规划: 0x3fae5c,
  景观: 0x2aa79b,
  室内: 0x9b6bd6,
  职能部门: 0xd8b22f,
  信息化中心: 0x46586e,
  其他: 0x8f9aa6
}

export function deptColor(dept: string): number {
  return DEPT_COLORS[dept] ?? DEPT_COLORS['其他']
}

/** 一个可落座的工位（avatar 站/坐点；ry 为朝向，前方 = (sin ry, cos ry)） */
export interface DeskSpot {
  x: number
  z: number
  ry: number
}

export interface DeptZone {
  dept: string
  /** 区域中心（世界坐标 x,z） */
  center: [number, number]
  /** 区域尺寸 [宽(x), 深(z)] 米 */
  extents: [number, number]
  color: number
  /** 6 个工位（2 排 × 3 列），确定性坐姿分配用 */
  deskSpots: DeskSpot[]
}

const ZONE_W = 18
const ZONE_D = 13
const NORTH_Z = -34
const SOUTH_Z = 34

function makeZone(dept: string, cx: number, cz: number, ry: number): DeptZone {
  const deskSpots: DeskSpot[] = []
  for (let r = 0; r < 2; r++)
    for (let c = 0; c < 3; c++) deskSpots.push({ x: cx + (c - 1) * 4.4, z: cz + (r - 0.5) * 3.4, ry })
  return { dept, center: [cx, cz], extents: [ZONE_W, ZONE_D], color: deptColor(dept), deskSpots }
}

/** 北排（主楼北侧）面朝主楼(+Z)；南排面朝主楼(−Z) */
export const DEPT_ZONES: Readonly<Record<string, DeptZone>> = Object.fromEntries([
  ...(
    [
      ['建筑', -56],
      ['结构', -28],
      ['机电', 0],
      ['规划', 28],
      ['景观', 56]
    ] as Array<[string, number]>
  ).map(([d, x]) => [d, makeZone(d, x, NORTH_Z, 0)]),
  ...(
    [
      ['室内', -42],
      ['职能部门', -14],
      ['信息化中心', 14],
      ['其他', 42]
    ] as Array<[string, number]>
  ).map(([d, x]) => [d, makeZone(d, x, SOUTH_Z, Math.PI)])
])

/**
 * 坐姿确定性落座：某部门第 i 个 scene=false 玩家 → deskSpots[i % len]。
 * i 为服务端 players 数组中该部门坐姿者的出现序号（要求服务端排序稳定，如按入房序）。
 */
export function seatedSpot(dept: string, index: number): DeskSpot {
  const zone = DEPT_ZONES[dept] ?? DEPT_ZONES['其他']
  return zone.deskSpots[index % zone.deskSpots.length]
}

/** 主楼 AABB（行走碰撞用） */
export const BUILDING_BOX = { minX: -20, maxX: 20, minZ: -12, maxZ: 12 }
/** 玩家可活动范围（世界坐标绝对值上限） */
export const CAMPUS_HALF = 72
/** 自己出生点（主楼南侧广场） */
export const SPAWN = { x: 0, z: 16 }

// ---------------------------------------------------------------------------
// 静态场景搭建
// ---------------------------------------------------------------------------

const matCache = new Map<number, THREE.MeshLambertMaterial>()
function mat(color: number): THREE.MeshLambertMaterial {
  let m = matCache.get(color)
  if (!m) {
    m = new THREE.MeshLambertMaterial({ color, flatShading: true })
    matCache.set(color, m)
  }
  return m
}

function box(
  parent: THREE.Object3D,
  w: number,
  h: number,
  d: number,
  color: number,
  x: number,
  y: number,
  z: number,
  ry = 0
): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(color))
  mesh.position.set(x, y, z)
  mesh.rotation.y = ry
  mesh.castShadow = true
  mesh.receiveShadow = true
  parent.add(mesh)
  return mesh
}

function canvasTexture(
  draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void,
  w: number,
  h: number
): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')!
  draw(ctx, w, h)
  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.anisotropy = 4
  return tex
}

function hex(color: number): string {
  return '#' + color.toString(16).padStart(6, '0')
}

/** 部门标牌：立杆 + 文字面板 */
function makeSign(parent: THREE.Object3D, text: string, color: number, x: number, z: number, ry: number): void {
  box(parent, 0.12, 2.7, 0.12, 0x5b6470, x, 1.35, z)
  const tex = canvasTexture(
    (ctx, w, h) => {
      ctx.fillStyle = '#f7f8fa'
      ctx.fillRect(0, 0, w, h)
      ctx.fillStyle = hex(color)
      ctx.fillRect(0, 0, 26, h)
      ctx.fillStyle = '#243247'
      ctx.font = '700 64px "PingFang SC", "Microsoft YaHei", sans-serif'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(text, w / 2 + 8, h / 2 + 4)
    },
    512,
    128
  )
  const panel = new THREE.Mesh(new THREE.PlaneGeometry(2.7, 0.68), new THREE.MeshBasicMaterial({ map: tex }))
  panel.position.set(x, 2.35, z)
  panel.rotation.y = ry
  parent.add(panel)
}

/** 一套工位：椅（即 DeskSpot 落座点）+ 桌 + 显示器，朝向 spot.ry 前方 */
function makeDeskSet(parent: THREE.Object3D, spot: DeskSpot): void {
  const fx = Math.sin(spot.ry)
  const fz = Math.cos(spot.ry)
  const rx = Math.cos(spot.ry)
  const rz = -Math.sin(spot.ry)
  const put = (m: THREE.Mesh, dx: number, dz: number, y: number): THREE.Mesh => {
    m.position.set(spot.x + dx, y, spot.z + dz)
    return m
  }

  // 椅子（落座点）
  put(box(parent, 0.46, 0.06, 0.46, 0x4a5568, 0, 0, 0), 0, 0, 0.46).rotation.y = spot.ry
  put(box(parent, 0.07, 0.44, 0.07, 0x39404d, 0, 0, 0), 0, 0, 0.23).rotation.y = spot.ry
  const back = box(parent, 0.46, 0.5, 0.06, 0x4a5568, 0, 0, 0)
  back.rotation.y = spot.ry
  put(back, -fx * 0.2, -fz * 0.2, 0.86)

  // 桌（在落座点前方 0.85m）
  const dcx = fx * 0.85
  const dcz = fz * 0.85
  const top = box(parent, 1.35, 0.06, 0.68, 0xc9a26a, 0, 0, 0)
  top.rotation.y = spot.ry
  put(top, dcx, dcz, 0.74)
  for (const s of [-1, 1]) {
    const leg = box(parent, 0.06, 0.72, 0.6, 0x9a7b50, 0, 0, 0)
    leg.rotation.y = spot.ry
    put(leg, dcx + rx * 0.62 * s, dcz + rz * 0.62 * s, 0.36)
  }
  // 显示器
  const stand = box(parent, 0.08, 0.16, 0.08, 0x39404d, 0, 0, 0)
  put(stand, dcx, dcz, 0.85)
  const screen = box(parent, 0.56, 0.34, 0.05, 0x2b3a4e, 0, 0, 0)
  screen.rotation.y = spot.ry
  put(screen, dcx, dcz, 1.08)
}

function mulberry32(seed: number): () => number {
  return () => {
    seed |= 0
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** 搭建整个静态园区，返回场景根组 */
export function buildCampus(scene: THREE.Scene): THREE.Group {
  const root = new THREE.Group()
  scene.add(root)

  // 地面（草坪）
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(150, 150), mat(0x86b95c))
  ground.rotation.x = -Math.PI / 2
  ground.receiveShadow = true
  root.add(ground)

  // 道路：主楼南北两条横路 + 东西两条纵路 + 停车场支路
  const roadColor = 0x9aa0a6
  box(root, 150, 0.06, 8, roadColor, 0, 0.03, -22)
  box(root, 150, 0.06, 8, roadColor, 0, 0.03, 22)
  box(root, 8, 0.06, 150, roadColor, -68, 0.03, 0)
  box(root, 8, 0.06, 150, roadColor, 68, 0.03, 0)
  box(root, 6, 0.06, 22, roadColor, 50, 0.035, 33)
  // 中央道路虚线
  for (let i = -70; i <= 70; i += 6) {
    box(root, 2.6, 0.062, 0.25, 0xe8e6df, i + 1.2, 0.036, -22)
    box(root, 2.6, 0.062, 0.25, 0xe8e6df, i + 1.2, 0.036, 22)
  }

  // 主楼
  box(root, 40, 16, 24, 0xe8e4da, 0, 8, 0)
  box(root, 42, 0.7, 26, 0xb9b4a9, 0, 16.35, 0)
  box(root, 6, 1.2, 4, 0x8f969e, 8, 16.9, -4)
  for (const y of [4, 8, 12]) {
    box(root, 36, 1.5, 0.3, 0x7fb2d9, 0, y, 12.15)
    box(root, 36, 1.5, 0.3, 0x7fb2d9, 0, y, -12.15)
    box(root, 0.3, 1.5, 20, 0x7fb2d9, 20.15, y, 0)
    box(root, 0.3, 1.5, 20, 0x7fb2d9, -20.15, y, 0)
  }
  box(root, 6, 4.5, 1, 0x5b87a8, 0, 2.25, 12.5) // 入口玻璃
  box(root, 8, 0.4, 2.4, 0xc9c5ba, 0, 0.2, 13.9) // 台阶
  // 主楼名牌
  const bTex = canvasTexture(
    (ctx, w, h) => {
      ctx.fillStyle = '#22405f'
      ctx.fillRect(0, 0, w, h)
      ctx.fillStyle = '#ffffff'
      ctx.font = '700 96px "PingFang SC", "Microsoft YaHei", sans-serif'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText('TJAD · 虚拟设计院', w / 2, h / 2 + 6)
    },
    1024,
    160
  )
  const bSign = new THREE.Mesh(new THREE.PlaneGeometry(9, 1.5), new THREE.MeshBasicMaterial({ map: bTex }))
  bSign.position.set(0, 14.2, 12.35)
  root.add(bSign)

  // 部门开放区：地坪 + 部门色边条 + 标牌 + 工位
  for (const zone of Object.values(DEPT_ZONES)) {
    const [cx, cz] = zone.center
    const north = cz < 0
    box(root, ZONE_W, 0.08, ZONE_D, 0xd8d5cc, cx, 0.04, cz)
    const stripe = box(
      root,
      ZONE_W,
      0.1,
      0.7,
      zone.color,
      cx,
      0.05,
      cz + (north ? ZONE_D / 2 - 0.4 : -(ZONE_D / 2 - 0.4))
    )
    stripe.castShadow = false
    const signZ = cz + (north ? ZONE_D / 2 + 1 : -(ZONE_D / 2 + 1))
    makeSign(root, zone.dept, zone.color, cx - ZONE_W / 2 + 1.2, signZ, north ? 0 : Math.PI)
    for (const spot of zone.deskSpots) makeDeskSet(root, spot)
  }

  // 停车场：沥青面 + 白线车位（两排各 10）+ 几辆 lowpoly 车
  box(root, 36, 0.07, 18, 0x6f7479, 52, 0.036, 53)
  for (const rowZ of [47.7, 58.3]) {
    for (let i = 0; i <= 10; i++) {
      const line = box(root, 0.14, 0.075, 5, 0xe8e6df, 36 + i * 3.2, 0.04, rowZ)
      line.castShadow = false
    }
  }
  makeCar(root, 36 + 2 * 3.2 + 1.6, 47.7, 0, 0xd94f3d)
  makeCar(root, 36 + 6 * 3.2 + 1.6, 47.7, 0, 0x4f7fd9)
  makeCar(root, 36 + 8 * 3.2 + 1.6, 58.3, Math.PI, 0xe8e8e8)

  // 入口小广场
  const plaza = box(root, 12, 0.05, 9, 0xc9c5ba, 0, 0.028, 16.5)
  plaza.castShadow = false

  // 绿化：行道树随机散布（避开道路/楼/区域/停车场）
  const rng = mulberry32(20261005)
  const greens = [0x4e9e4e, 0x63b35a, 0x3f8f5f]
  let placed = 0
  for (let tries = 0; tries < 400 && placed < 70; tries++) {
    const x = (rng() * 2 - 1) * 72
    const z = (rng() * 2 - 1) * 72
    if (!treeOk(x, z)) continue
    const s = 0.8 + rng() * 0.6
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.24, 1.2, 6), mat(0x7a5230))
    trunk.position.set(x, 0.6 * s, z)
    trunk.scale.setScalar(s)
    trunk.castShadow = true
    root.add(trunk)
    const crown = new THREE.Mesh(new THREE.IcosahedronGeometry(1.1, 0), mat(greens[Math.floor(rng() * greens.length)]))
    crown.position.set(x, (1.8 + rng() * 0.5) * s, z)
    crown.scale.setScalar(s)
    crown.castShadow = true
    root.add(crown)
    placed++
  }
  return root
}

function treeOk(x: number, z: number): boolean {
  if (Math.abs(x + 68) < 6.5 || Math.abs(x - 68) < 6.5) return false // 纵路
  if (Math.abs(z + 22) < 6.5 || Math.abs(z - 22) < 6.5) return false // 横路
  if (x > 44 && x < 56 && z > 20 && z < 64) return false // 支路+停车场
  if (x > 32 && x < 72 && z > 42 && z < 64) return false // 停车场
  if (x > -24 && x < 24 && z > -16 && z < 16) return false // 主楼+入口
  if (x > -7 && x < 7 && z > 11 && z < 22) return false // 广场
  for (const zone of Object.values(DEPT_ZONES)) {
    const [cx, cz] = zone.center
    if (Math.abs(x - cx) < zone.extents[0] / 2 + 2 && Math.abs(z - cz) < zone.extents[1] / 2 + 2) return false
  }
  return true
}

function makeCar(parent: THREE.Object3D, x: number, z: number, ry: number, color: number): void {
  const g = new THREE.Group()
  const fx = Math.sin(ry)
  const fz = Math.cos(ry)
  const body = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.55, 3.9), mat(color))
  body.position.y = 0.55
  body.castShadow = true
  g.add(body)
  const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.5, 1.9), mat(0x9fd4e8))
  cabin.position.set(-fx * 0.3, 1.05, -fz * 0.3)
  cabin.rotation.y = ry
  cabin.castShadow = true
  g.add(cabin)
  const wheelGeo = new THREE.CylinderGeometry(0.32, 0.32, 0.25, 8)
  wheelGeo.rotateZ(Math.PI / 2)
  for (const [sx, sz] of [
    [-1, -1],
    [1, -1],
    [-1, 1],
    [1, 1]
  ] as Array<[number, number]>) {
    const wheel = new THREE.Mesh(wheelGeo, mat(0x22262b))
    wheel.position.set(sx * 0.85, 0.32, sz * 1.25)
    g.add(wheel)
  }
  g.position.set(x, 0, z)
  g.rotation.y = ry
  parent.add(g)
}
