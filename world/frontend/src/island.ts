// 海岛场景（v2 §3）：lowpoly 海岛 —— 中央广场（喷泉）+ 三馆一屏一台 + 四栋可进入小房子
// + 码头/棕榈/绿化/路灯。纯材质色 flatShading，无贴图依赖（文字标牌用 canvas 纹理）。
// 本模块同时是碰撞体（COLLIDERS）、小房子（HOUSES）与化身配色（PALETTE）的唯一数据源。
// 取代 v1 的 campus.ts（部门园区/工位语义已废弃）。

import * as THREE from 'three'

/** 部门清单（与 /api/profile 选项一致；档案仍需要部门，用于题库匹配与名牌） */
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

/** 化身外观配色档位（8 档，与 /api/profile color 0..7 一一对应；v2 §4） */
export const PALETTE = [0xe2554b, 0x3d7edb, 0xef8f2e, 0x3fae5c, 0x2aa79b, 0x9b6bd6, 0xd8b22f, 0xe2699f] as const

export function paletteColor(i: number | null | undefined): number {
  return typeof i === 'number' && i >= 0 && i < PALETTE.length ? PALETTE[i] : DEPT_COLORS['其他']
}

/** 出生点：广场南侧，第一眼 = 喷泉 + 三馆 + 海平线 */
export const SPAWN = { x: 0, z: 26 }

/** 可行走圆形边界半径（米；码头走廊例外） */
export const ISLAND_BOUND_R = 72

/** 码头走廊（进入后允许越过圆形边界走到海面上） */
export const PIER = { minX: -2.4, maxX: 2.4, minZ: 56, maxZ: 79.5 }

/** AABB 碰撞体（建筑外墙/小房子墙段/台座；玩家半径 0.5 由 main.ts 处理） */
export interface Box {
  minX: number
  maxX: number
  minZ: number
  maxZ: number
}

/** 小房子定义（服务端 HOUSE_IDS 一一对应） */
export interface House {
  id: string
  name: string
  cx: number
  cz: number
  /** 门朝向：'n' = 门在北侧（-Z，适合广场以南的房子）；'s' = 门在南侧（+Z） */
  doorSide: 'n' | 's'
  /** 室内可站立区域（进入判定 + 聊天归属） */
  interior: Box
  /** 进屋出生位（朝向门） */
  inside: { x: number; z: number; ry: number }
  roof: THREE.Group | null
}

export const HOUSES: House[] = [
  { id: 'h1', name: '松屋', cx: -44, cz: 26, doorSide: 'n', interior: { minX: 0, maxX: 0, minZ: 0, maxZ: 0 }, inside: { x: 0, z: 0, ry: 0 }, roof: null },
  { id: 'h2', name: '杏屋', cx: 44, cz: 26, doorSide: 'n', interior: { minX: 0, maxX: 0, minZ: 0, maxZ: 0 }, inside: { x: 0, z: 0, ry: 0 }, roof: null },
  { id: 'h3', name: '湖蓝屋', cx: -52, cz: -20, doorSide: 's', interior: { minX: 0, maxX: 0, minZ: 0, maxZ: 0 }, inside: { x: 0, z: 0, ry: Math.PI }, roof: null },
  { id: 'h4', name: '金穗屋', cx: 52, cz: -20, doorSide: 's', interior: { minX: 0, maxX: 0, minZ: 0, maxZ: 0 }, inside: { x: 0, z: 0, ry: Math.PI }, roof: null }
]

/** 建筑/台座碰撞与占位（userData.panel 供点击交互） */
export interface Landmark {
  name: 'news' | 'notice' | 'standards' | 'board' | 'quiz'
  label: string
  box: Box
}

export const LANDMARKS: Landmark[] = [
  { name: 'news', label: '新闻大厅', box: { minX: -15.4, maxX: 15.4, minZ: -41.4, maxZ: -26.6 } },
  { name: 'notice', label: '公告堂', box: { minX: -43.4, maxX: -24.6, minZ: -7.4, maxZ: 11.4 } },
  { name: 'standards', label: '规范馆', box: { minX: 27.6, maxX: 40.4, minZ: -3.4, maxZ: 7.4 } },
  { name: 'board', label: '排行榜', box: { minX: -22, maxX: -14, minZ: -24, maxZ: -20 } },
  { name: 'quiz', label: '答题台', box: { minX: 14, maxX: 22, minZ: -24, maxZ: -20 } }
]

/** 全部碰撞体（建筑 + 小房子墙段；运行时填充） */
export const COLLIDERS: Box[] = [...LANDMARKS.map((l) => l.box)]

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

function cylinder(
  parent: THREE.Object3D,
  rt: number,
  rb: number,
  h: number,
  seg: number,
  color: number,
  x: number,
  y: number,
  z: number
): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), mat(color))
  mesh.position.set(x, y, z)
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

/** number 色值 → '#rrggbb'（UI 配色块用） */
export function hex(color: number): string {
  return '#' + color.toString(16).padStart(6, '0')
}

/** 建筑招牌：色条 + 文字 */
function makeSign(parent: THREE.Object3D, text: string, color: number, w: number, x: number, y: number, z: number, ry = 0): void {
  const tex = canvasTexture(
    (ctx, cw, ch) => {
      ctx.fillStyle = '#f7f8fa'
      ctx.fillRect(0, 0, cw, ch)
      ctx.fillStyle = hex(color)
      ctx.fillRect(0, 0, 26, ch)
      ctx.fillStyle = '#243247'
      ctx.font = '700 64px "PingFang SC", "Microsoft YaHei", sans-serif'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(text, cw / 2 + 8, ch / 2 + 4)
    },
    512,
    128
  )
  const panel = new THREE.Mesh(new THREE.PlaneGeometry(w, w / 4), new THREE.MeshBasicMaterial({ map: tex }))
  panel.position.set(x, y, z)
  panel.rotation.y = ry
  parent.add(panel)
}

/** 角度→半径噪声（同一函数驱动草地/沙滩轮廓，保证沙滩环露出均匀） */
function islandRadius(angle: number): number {
  return (
    82 +
    3.5 * Math.sin(angle * 3 + 1.2) +
    2.4 * Math.sin(angle * 5 + 4.1) +
    1.6 * Math.cos(angle * 8 + 0.6)
  )
}

/** 噪声圆盘（lowpoly 地形的基础件）；scale=1 → 完整岛轮廓，inflate 外扩沙滩环 */
function noisyDisc(scale: number, y: number, color: number, inflate = 0, segments = 72): THREE.Mesh {
  const geo = new THREE.CircleGeometry(1, segments)
  const pos = geo.attributes.position as THREE.BufferAttribute
  for (let i = 1; i < pos.count; i++) {
    const a = Math.atan2(pos.getY(i), pos.getX(i))
    const r = islandRadius(a) * scale + inflate
    pos.setX(i, Math.cos(a) * r)
    pos.setY(i, Math.sin(a) * r)
  }
  geo.computeVertexNormals()
  const mesh = new THREE.Mesh(geo, mat(color))
  mesh.rotation.x = -Math.PI / 2
  mesh.position.y = y
  mesh.receiveShadow = true
  return mesh
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

// ---- 新闻大厅（北侧主建筑） ----
function buildNewsHall(parent: THREE.Object3D): void {
  const g = new THREE.Group()
  g.userData.panel = 'news'
  // 主体 + 基座 + 檐口
  box(g, 30, 0.6, 14, 0xb9b4a9, 0, 0.6, -34)
  box(g, 28, 8, 12.4, 0xe8e4da, 0, 4.9, -34)
  box(g, 30.5, 0.9, 14, 0xc9c5ba, 0, 9.4, -34)
  box(g, 29, 0.7, 12.6, 0x7a8ba0, 0, 10.1, -34)
  // 正面柱廊（6 根）
  for (let i = 0; i < 6; i++) cylinder(g, 0.55, 0.65, 7.6, 8, 0xf2eee4, -12.5 + i * 5, 4.5, -27.6)
  // 正面大横屏（占位：新闻大厅，M2 接 EKP 后换动态内容）
  const tex = canvasTexture(
    (ctx, w, h) => {
      const grad = ctx.createLinearGradient(0, 0, w, h)
      grad.addColorStop(0, '#1d3a5f')
      grad.addColorStop(1, '#2b5b8f')
      ctx.fillStyle = grad
      ctx.fillRect(0, 0, w, h)
      ctx.fillStyle = '#8fc1ff'
      ctx.font = '700 92px "PingFang SC", "Microsoft YaHei", sans-serif'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText('新闻大厅', w / 2, h / 2 - 20)
      ctx.fillStyle = '#5f7ea6'
      ctx.font = '400 44px "PingFang SC", sans-serif'
      ctx.fillText('院闻 · 动态 · 通知', w / 2, h / 2 + 62)
    },
    1024,
    256
  )
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(16, 4), new THREE.MeshBasicMaterial({ map: tex }))
  screen.position.set(0, 6.6, -26.85)
  g.add(screen)
  box(g, 16.6, 4.6, 0.35, 0x39404d, 0, 6.6, -27.15)
  // 入口
  box(g, 5, 4.2, 1, 0x5b87a8, 0, 2.7, -27.8)
  // 山墙顶饰
  box(g, 2.4, 1.2, 2.4, 0xe2554b, 0, 10.9, -34)
  parent.add(g)
}

// ---- 公告堂（西侧圆厅 + 锥顶） ----
function buildNoticeHall(parent: THREE.Object3D): void {
  const g = new THREE.Group()
  g.userData.panel = 'notice'
  cylinder(g, 9, 9.6, 5.5, 20, 0xf0e7d8, -34, 3.05, 2)
  cylinder(g, 10.4, 10.4, 0.6, 20, 0xc9c5ba, -34, 5.8, 2)
  const roof = new THREE.Mesh(new THREE.ConeGeometry(10.6, 4, 20), mat(0xc96f4a))
  roof.position.set(-34, 8.1, 2)
  roof.castShadow = true
  g.add(roof)
  cylinder(g, 0.3, 0.3, 1.6, 6, 0xd8b22f, -34, 10.6, 2)
  // 门 + 环窗
  box(g, 3, 3.6, 0.8, 0x5b87a8, -34, 2.1, 11.5)
  for (let i = 0; i < 6; i++) {
    const a = Math.PI * (0.25 + i * 0.1)
    const wx = -34 + Math.cos(a) * 9.35
    const wz = 2 - Math.sin(a) * 9.35
    const win = box(g, 1.2, 1.6, 0.2, 0x7fb2d9, wx, 3.4, wz)
    win.rotation.y = -a + Math.PI / 2
  }
  makeSign(g, '公告堂', 0xc96f4a, 5.4, -34, 4.6, 11.2)
  parent.add(g)
}

// ---- 规范馆（东侧阶梯塔楼） ----
function buildStandardsHall(parent: THREE.Object3D): void {
  const g = new THREE.Group()
  g.userData.panel = 'standards'
  box(g, 12, 0.6, 10, 0xb9b4a9, 34, 0.6, 2)
  box(g, 11, 6, 9, 0xdfe6ec, 34, 3.9, 2)
  box(g, 9, 5, 7.4, 0xd3dde6, 34, 9.2, 2)
  box(g, 6.4, 3.6, 5.4, 0xc7d4de, 34, 13.4, 2)
  box(g, 0.5, 2.6, 0.5, 0x8f969e, 34, 16.2, 2)
  box(g, 0.24, 1.2, 0.24, 0xe2554b, 34, 17.8, 2)
  // 窄竖窗阵列
  for (let i = 0; i < 4; i++) {
    box(g, 0.9, 3.4, 0.2, 0x7fb2d9, 30.4 + i * 2.4, 4.2, 6.6)
    box(g, 0.9, 2.6, 0.2, 0x7fb2d9, 31.2 + i * 1.9, 9.4, 5.8)
  }
  box(g, 2.6, 3.4, 0.8, 0x5b87a8, 34, 2.3, 6.6)
  makeSign(g, '规范馆', 0x3d7edb, 5.4, 34, 6.4, 6.8)
  parent.add(g)
}

// ---- 排行榜大屏 ----
function buildBoard(parent: THREE.Object3D): void {
  const g = new THREE.Group()
  g.userData.panel = 'board'
  box(g, 8, 0.8, 2.4, 0xb9b4a9, -18, 0.7, -22)
  box(g, 0.5, 4.4, 0.5, 0x5b6470, -21.2, 3.2, -22.6)
  box(g, 0.5, 4.4, 0.5, 0x5b6470, -14.8, 3.2, -22.6)
  const tex = canvasTexture(
    (ctx, w, h) => {
      ctx.fillStyle = '#101b2d'
      ctx.fillRect(0, 0, w, h)
      ctx.strokeStyle = '#d8b22f'
      ctx.lineWidth = 10
      ctx.strokeRect(8, 8, w - 16, h - 16)
      ctx.fillStyle = '#f4d06f'
      ctx.font = '700 88px "PingFang SC", "Microsoft YaHei", sans-serif'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText('荣誉榜', w / 2, h / 2 - 26)
      ctx.fillStyle = '#6f7f99'
      ctx.font = '400 40px "PingFang SC", sans-serif'
      ctx.fillText('答题排行 · 即将开榜', w / 2, h / 2 + 58)
    },
    512,
    256
  )
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(7.2, 3.6), new THREE.MeshBasicMaterial({ map: tex }))
  screen.position.set(-18, 3.6, -21.55)
  screen.rotation.y = 0
  g.add(screen)
  parent.add(g)
}

// ---- 答题台 ----
function buildQuizStand(parent: THREE.Object3D): void {
  const g = new THREE.Group()
  g.userData.panel = 'quiz'
  box(g, 6, 0.5, 5, 0xc9c5ba, 18, 0.55, -22)
  for (const [px, pz] of [
    [-2.4, -1.8],
    [2.4, -1.8],
    [-2.4, 1.8],
    [2.4, 1.8]
  ] as Array<[number, number]>) {
    cylinder(g, 0.14, 0.14, 3, 6, 0xf2eee4, 18 + px, 2.2, -22 + pz)
  }
  const awning = new THREE.Mesh(new THREE.ConeGeometry(4.4, 1.5, 4), mat(0xe2699f))
  awning.position.set(18, 4.1, -22)
  awning.rotation.y = Math.PI / 4
  awning.castShadow = true
  g.add(awning)
  box(g, 2.6, 1.1, 0.8, 0xc9a26a, 18, 1.35, -21)
  makeSign(g, '每日一题', 0xe2699f, 4.6, 18, 3.1, -19.9)
  parent.add(g)
}

// ---- 小房子（可进入；屋顶单独成组，进屋时隐藏） ----
const HOUSE_WALL_H = 3
const HOUSE_ROOF_COLORS = [0x3fae5c, 0xd8b22f, 0x4f7fd9, 0xc96f4a]
const HOUSE_WALL_COLORS = [0xf0e7d8, 0xe8d9c0, 0xdce8f0, 0xe4ead9]

function buildHouse(parent: THREE.Object3D, house: House, index: number): void {
  const { cx, cz, doorSide } = house
  const W = 8
  const D = 7
  const T = 0.5
  const g = new THREE.Group()
  g.position.set(cx, 0, cz)

  // 地板（顶面略高于草地 0.3，避免被草地盖住）
  box(g, W, 0.24, D, 0xc9a26a, 0, 0.36, 0)
  // 墙：后墙、左右墙、前墙（留 1.8m 门洞）
  const doorW = 1.8
  const segW = (W - doorW) / 2
  const doorZ = doorSide === 'n' ? -D / 2 : D / 2
  const backZ = doorSide === 'n' ? D / 2 : -D / 2
  box(g, W, HOUSE_WALL_H, T, HOUSE_WALL_COLORS[index % 4], 0, 0.24 + HOUSE_WALL_H / 2, backZ)
  box(g, T, HOUSE_WALL_H, D, HOUSE_WALL_COLORS[index % 4], -W / 2 + T / 2, 0.24 + HOUSE_WALL_H / 2, 0)
  box(g, T, HOUSE_WALL_H, D, HOUSE_WALL_COLORS[index % 4], W / 2 - T / 2, 0.24 + HOUSE_WALL_H / 2, 0)
  box(g, segW, HOUSE_WALL_H, T, HOUSE_WALL_COLORS[index % 4], -(doorW / 2 + segW / 2), 0.24 + HOUSE_WALL_H / 2, doorZ)
  box(g, segW, HOUSE_WALL_H, T, HOUSE_WALL_COLORS[index % 4], doorW / 2 + segW / 2, 0.24 + HOUSE_WALL_H / 2, doorZ)
  box(g, doorW, 0.7, T, HOUSE_WALL_COLORS[index % 4], 0, 0.24 + HOUSE_WALL_H - 0.35, doorZ) // 门楣

  // 窗（后墙两扇）
  const winZ = backZ + (doorSide === 'n' ? -0.06 : 0.06)
  box(g, 1.3, 1.1, 0.14, 0x7fb2d9, -2.1, 1.9, winZ)
  box(g, 1.3, 1.1, 0.14, 0x7fb2d9, 2.1, 1.9, winZ)

  // 屋顶（独立组：进屋隐藏）：人字坡两片 + 屋脊 + 山墙封板
  const roof = new THREE.Group()
  const pitch = 2.3
  const oh = 0.5
  const tilt = Math.atan2(pitch, D / 2)
  const slabLen = Math.hypot(pitch, D / 2 + oh)
  const yc = 0.24 + HOUSE_WALL_H + pitch / 2
  const zc = (D / 2 + oh) / 2
  const slabGeo = new THREE.BoxGeometry(W + 1.2, 0.22, slabLen)
  const slabN = new THREE.Mesh(slabGeo, mat(HOUSE_ROOF_COLORS[index % 4]))
  slabN.position.set(0, yc, -zc)
  slabN.rotation.x = -tilt
  slabN.castShadow = true
  const slabS = new THREE.Mesh(slabGeo, mat(HOUSE_ROOF_COLORS[index % 4]))
  slabS.position.set(0, yc, zc)
  slabS.rotation.x = tilt
  slabS.castShadow = true
  roof.add(slabN, slabS)
  box(roof, W + 1.2, 0.26, 0.6, 0x8a5a34, 0, 0.24 + HOUSE_WALL_H + pitch + 0.03, 0)
  // 山墙封板（三角）
  const gShape = new THREE.Shape()
  gShape.moveTo(-D / 2, 0)
  gShape.lineTo(D / 2, 0)
  gShape.lineTo(0, pitch - 0.1)
  gShape.closePath()
  const gGeo = new THREE.ExtrudeGeometry(gShape, { depth: 0.3, bevelEnabled: false })
  for (const gx of [W / 2 - 0.25, -(W / 2 - 0.25)]) {
    const gable = new THREE.Mesh(gGeo, mat(HOUSE_WALL_COLORS[index % 4]))
    gable.rotation.y = Math.PI / 2
    gable.position.set(gx, 0.24 + HOUSE_WALL_H, 0)
    gable.castShadow = true
    roof.add(gable)
  }
  g.add(roof)
  house.roof = roof

  // 屋内家具：桌 + 凳 + 地毯（随地板抬升 +0.22）
  box(g, 1.6, 0.08, 0.9, 0xb98d5a, -2.2, 1.07, backZ * 0.45)
  box(g, 0.1, 0.75, 0.1, 0x8a5a34, -2.9, 0.83, backZ * 0.45)
  box(g, 0.1, 0.75, 0.1, 0x8a5a34, -1.5, 0.83, backZ * 0.45)
  box(g, 0.5, 0.5, 0.5, 0x9b6bd6, 2.4, 0.71, backZ * 0.5)
  const rug = box(g, 2.6, 0.05, 1.8, 0xe2699f, 0.6, 0.5, 0)
  rug.castShadow = false

  // 门牌
  makeSign(g, house.name, HOUSE_ROOF_COLORS[index % 4], 2.6, 0, 2.35, doorZ + (doorSide === 'n' ? 0.12 : -0.12), doorSide === 'n' ? 0 : Math.PI)

  parent.add(g)

  // 碰撞体（世界坐标）：后墙/左右墙/前墙两段
  const hw = W / 2
  const hd = D / 2
  COLLIDERS.push(
    { minX: cx - hw, maxX: cx + hw, minZ: cz + backZ - T / 2, maxZ: cz + backZ + T / 2 },
    { minX: cx - hw, maxX: cx - hw + T, minZ: cz - hd, maxZ: cz + hd },
    { minX: cx + hw - T, maxX: cx + hw, minZ: cz - hd, maxZ: cz + hd },
    { minX: cx - hw, maxX: cx - doorW / 2, minZ: cz + doorZ - T / 2, maxZ: cz + doorZ + T / 2 },
    { minX: cx + doorW / 2, maxX: cx + hw, minZ: cz + doorZ - T / 2, maxZ: cz + doorZ + T / 2 }
  )
  // 室内区域 + 进屋出生位（面朝门）
  house.interior = {
    minX: cx - hw + 0.8,
    maxX: cx + hw - 0.8,
    minZ: cz - hd + 0.8,
    maxZ: cz + hd - 0.8
  }
  house.inside = { x: cx, z: cz + doorZ * 0.45, ry: doorSide === 'n' ? Math.PI : 0 }
}

// ---- 棕榈 / 树 / 石 / 花 / 路灯 / 小船 ----
function makePalm(parent: THREE.Object3D, x: number, z: number, s: number, rng: () => number): void {
  const g = new THREE.Group()
  const lean = rng() * 0.35
  for (let i = 0; i < 3; i++) {
    const seg = cylinder(g, 0.14 - i * 0.02, 0.18 - i * 0.02, 1.3, 6, 0x9a7b50, Math.sin(lean) * i * 0.35, 0.65 + i * 1.2, 0)
    seg.rotation.z = -lean * 0.5
  }
  const topX = Math.sin(lean) * 0.7
  const topY = 3.6
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + rng()
    const frond = box(g, 2.2, 0.06, 0.5, 0x3f9f5f, topX + Math.cos(a) * 1.0, topY + 0.25, Math.sin(a) * 1.0)
    frond.rotation.y = -a
    frond.rotation.z = -0.5
  }
  box(g, 0.3, 0.3, 0.3, 0x8a5a34, topX, topY + 0.1, 0)
  g.position.set(x, 0, z)
  g.scale.setScalar(s)
  parent.add(g)
}

function makeTree(parent: THREE.Object3D, x: number, z: number, s: number, rng: () => number): void {
  const greens = [0x4e9e4e, 0x63b35a, 0x3f8f5f]
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.24, 1.2, 6), mat(0x7a5230))
  trunk.position.set(x, 0.6 * s, z)
  trunk.scale.setScalar(s)
  trunk.castShadow = true
  parent.add(trunk)
  const crown = new THREE.Mesh(new THREE.IcosahedronGeometry(1.1, 0), mat(greens[Math.floor(rng() * greens.length)]))
  crown.position.set(x, (1.8 + rng() * 0.5) * s, z)
  crown.scale.setScalar(s)
  crown.castShadow = true
  parent.add(crown)
}

function makeLamp(parent: THREE.Object3D, x: number, z: number): void {
  const g = new THREE.Group()
  cylinder(g, 0.08, 0.11, 3.4, 6, 0x46586e, 0, 1.7, 0)
  box(g, 0.7, 0.08, 0.08, 0x46586e, 0.28, 3.4, 0)
  const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.2, 8, 6), new THREE.MeshBasicMaterial({ color: 0xfff3b0 }))
  bulb.position.set(0.58, 3.32, 0)
  g.add(bulb)
  g.position.set(x, 0, z)
  parent.add(g)
}

function makeBoat(parent: THREE.Object3D, x: number, z: number, ry: number, color: number): void {
  const g = new THREE.Group()
  const hull = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 0.5, 3.6, 6), mat(color))
  hull.rotation.z = Math.PI / 2
  hull.rotation.y = Math.PI / 2
  hull.position.y = 0.35
  hull.castShadow = true
  g.add(hull)
  box(g, 1.3, 0.3, 1.1, 0xf2eee4, 0, 0.62, 0.4)
  cylinder(g, 0.05, 0.06, 2.2, 6, 0x8a5a34, 0, 1.5, -0.9)
  const sail = new THREE.Mesh(new THREE.ConeGeometry(0.9, 1.6, 3), mat(0xf2eee4))
  sail.position.set(0, 1.9, -0.75)
  sail.rotation.x = Math.PI
  g.add(sail)
  g.position.set(x, 0, z)
  g.rotation.y = ry
  parent.add(g)
}

function inAnyBox(x: number, z: number, boxes: Box[], margin = 0): boolean {
  for (const b of boxes) {
    if (x > b.minX - margin && x < b.maxX + margin && z > b.minZ - margin && z < b.maxZ + margin) return true
  }
  return false
}

/** 搭建整座海岛，返回场景根组 */
export function buildIsland(scene: THREE.Scene): THREE.Group {
  const root = new THREE.Group()
  scene.add(root)

  // 海面（低poly 起伏）
  const seaGeo = new THREE.PlaneGeometry(620, 620, 46, 46)
  const seaPos = seaGeo.attributes.position as THREE.BufferAttribute
  const rngSea = mulberry32(7)
  for (let i = 0; i < seaPos.count; i++) {
    seaPos.setZ(i, (rngSea() - 0.5) * 0.5)
  }
  seaGeo.computeVertexNormals()
  const sea = new THREE.Mesh(seaGeo, mat(0x4a8ec2))
  sea.rotation.x = -Math.PI / 2
  sea.position.y = -0.42
  root.add(sea)

  // 沙滩环 + 草地岛体（同一轮廓函数，沙滩略大一圈）
  root.add(noisyDisc(1, 0.1, 0xe5d5a1, 7))
  root.add(noisyDisc(1, 0.3, 0x86b95c))

  // 中央广场：石板圆 + 双环 + 喷泉
  const plaza = new THREE.Mesh(new THREE.CircleGeometry(20, 48), mat(0xd8d5cc))
  plaza.rotation.x = -Math.PI / 2
  plaza.position.y = 0.34
  plaza.receiveShadow = true
  root.add(plaza)
  for (const [rIn, rOut, c] of [
    [17.2, 18.2, 0xc9c5ba],
    [10.5, 11.1, 0xc9c5ba],
    [3.1, 3.7, 0xb9b4a9]
  ] as Array<[number, number, number]>) {
    const ring = new THREE.Mesh(new THREE.RingGeometry(rIn, rOut, 48), mat(c))
    ring.rotation.x = -Math.PI / 2
    ring.position.y = 0.36
    root.add(ring)
  }
  // 喷泉
  cylinder(root, 2.4, 2.7, 0.7, 18, 0xb9b4a9, 0, 0.68, 0)
  const water = new THREE.Mesh(new THREE.CircleGeometry(2.1, 18), mat(0x6fb7d9))
  water.rotation.x = -Math.PI / 2
  water.position.y = 0.92
  root.add(water)
  cylinder(root, 0.32, 0.42, 1.7, 8, 0xd8d5cc, 0, 1.6, 0)
  const orb = new THREE.Mesh(new THREE.IcosahedronGeometry(0.45, 0), mat(0x8fc1ff))
  orb.position.set(0, 2.6, 0)
  orb.castShadow = true
  root.add(orb)

  // 建筑
  buildNewsHall(root)
  buildNoticeHall(root)
  buildStandardsHall(root)
  buildBoard(root)
  buildQuizStand(root)

  // 小房子
  HOUSES.forEach((h, i) => buildHouse(root, h, i))

  // 码头（木板与地面齐平 + 系船柱）
  for (let i = 0; i < 7; i++) {
    box(root, 4.6, 0.2, 3.4, i % 2 ? 0xc9a26a : 0xbd955e, 0, 0.36, 58.4 + i * 3.3)
  }
  for (const side of [-2.1, 2.1]) {
    for (let i = 0; i < 4; i++) cylinder(root, 0.13, 0.15, 0.8, 6, 0x8a5a34, side, 0.4, 59 + i * 6.4)
  }
  makeBoat(root, 5.2, 70, 0.5, 0xd94f3d)
  makeBoat(root, -5.4, 73.5, -0.4, 0x4f7fd9)

  // 路径：广场 → 三馆/答题/榜单/码头/房屋
  const pathC = 0xd9cdb0
  const path = (x1: number, z1: number, x2: number, z2: number, w = 2.6): void => {
    const dx = x2 - x1
    const dz = z2 - z1
    const len = Math.hypot(dx, dz)
    const p = box(root, w, 0.04, len, pathC, (x1 + x2) / 2, 0.335, (z1 + z2) / 2)
    p.rotation.y = Math.atan2(dx, dz)
    p.castShadow = false
  }
  path(0, -20, 0, -27) // 新闻大厅
  path(-20, 2, -24.6, 2) // 公告堂
  path(20, 2, 27.6, 2) // 规范馆
  path(-11, -14, -18, -20.4) // 排行榜
  path(11, -14, 18, -20.4) // 答题台
  path(0, 20, 0, 58, 3) // 码头
  for (const h of HOUSES) path(Math.sign(h.cx) * 15, h.cz > 0 ? 15 : -14, h.cx + (h.cz > 0 ? 0 : 0), h.cz + (h.doorSide === 'n' ? -4.2 : 4.2))

  // 绿化：树/灌木/花/岩石/棕榈（确定性随机，避开建筑/路径/广场）
  const rng = mulberry32(20261005)
  const blocked: Box[] = [
    ...COLLIDERS,
    { minX: -21, maxX: 21, minZ: -21, maxZ: 21 }, // 广场
    { minX: -3.4, maxX: 3.4, minZ: 20, maxZ: 60 }, // 主路+码头引道
    { minX: -70, maxX: 70, minZ: -70, maxZ: 70 } // 占位：下面用半径判定
  ]
  const palmsAt: Array<[number, number]> = []
  for (let i = 0; i < 14; i++) {
    const a = (i / 14) * Math.PI * 2 + rng() * 0.3
    palmsAt.push([Math.cos(a) * (islandRadius(a) - 6), Math.sin(a) * (islandRadius(a) - 6)])
  }
  let placed = 0
  for (let tries = 0; tries < 900 && placed < 90; tries++) {
    const a = rng() * Math.PI * 2
    const r = 24 + rng() * 50
    const x = Math.cos(a) * r
    const z = Math.sin(a) * r
    if (Math.hypot(x, z) > islandRadius(Math.atan2(z, x)) - 5) continue
    if (Math.hypot(x, z) < 23) continue
    if (inAnyBox(x, z, blocked, 2.5)) continue
    if (inAnyBox(x, z, HOUSES.map((h) => ({ minX: h.cx - 7, maxX: h.cx + 7, minZ: h.cz - 6, maxZ: h.cz + 6 })), 2)) continue
    if (pathNear(x, z)) continue
    const kind = rng()
    if (kind < 0.62) makeTree(root, x, z, 0.8 + rng() * 0.7, rng)
    else if (kind < 0.78) makePalm(root, x, z, 0.7 + rng() * 0.5, rng)
    else if (kind < 0.9) {
      const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(0.5 + rng() * 0.7, 0), mat(0x9aa0a6))
      rock.position.set(x, 0.3, z)
      rock.rotation.set(rng(), rng(), rng())
      rock.castShadow = true
      root.add(rock)
    } else {
      const flower = new THREE.Mesh(new THREE.SphereGeometry(0.16, 6, 5), mat([0xe2699f, 0xf4d06f, 0xe2554b][Math.floor(rng() * 3)]))
      flower.position.set(x, 0.42, z)
      root.add(flower)
    }
    placed++
  }
  for (const [px, pz] of palmsAt) makePalm(root, px, pz, 0.85 + rng() * 0.4, rng)

  // 广场环路灯 + 房屋前灯
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + Math.PI / 8
    makeLamp(root, Math.cos(a) * 23, Math.sin(a) * 23)
  }
  for (const h of HOUSES) {
    const doorZ = h.cz + (h.doorSide === 'n' ? -4.6 : 4.6)
    makeLamp(root, h.cx - 5.2, doorZ)
  }

  return root

  function pathNear(x: number, z: number): boolean {
    // 主路 + 各路径走廊粗判
    if (Math.abs(x) < 3 && z > 18 && z < 60) return true
    if (Math.hypot(x - 0, z + 23.5) < 3 && z < -18) return true
    if (Math.abs(z - 2) < 3.4 && ((x > 18 && x < 29) || (x > -29 && x < -18))) return true
    if (Math.hypot(x - (HOUSES[0].cx), z - HOUSES[0].cz) < 10 && z > 12) return true
    if (Math.hypot(x - HOUSES[1].cx, z - HOUSES[1].cz) < 10 && z > 12) return true
    return false
  }
}
