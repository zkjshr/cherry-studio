// 小世界前端入口（v2）：启动（cid/token）→ WS init → （必要时）身份+配色填写 → 进海岛。
// 场景循环：WASD + 点击寻路 + 第三人称跟随相机；远端玩家 10Hz 全量 → 位置插值；
// 动作（1/2/3）与表情随 WS 同步；小房子进出（房内聊天）；小地图点击传送。

import * as THREE from 'three'

import './style.css'
import { Avatar, GESTURES, type GestureName } from './avatar'
import {
  COLLIDERS,
  HOUSES,
  ISLAND_BOUND_R,
  PIER,
  SPAWN,
  buildIsland,
  deptColor,
  paletteColor
} from './island'
import { ChatUI, type ChatScopeUI } from './chat'
import { EmoteFx } from './emotes'
import { WorldNet, type InitMsg, type PlayerState } from './net'
import { Minimap } from './minimap'
import { showProfileModal } from './profile'

// ---- 启动参数：cid 来自 URL（客户端 webview 注入）；直连浏览器开发时用临时 cid ----
const params = new URLSearchParams(location.search)
const token = params.get('token') ?? ''
let cid = params.get('cid') ?? ''
if (!cid) {
  cid = sessionStorage.getItem('lw_cid') ?? ''
  if (!cid) {
    cid = 'web-' + (crypto.randomUUID?.() ?? String(Date.now() + Math.random()))
    sessionStorage.setItem('lw_cid', cid)
  }
}

// ---- three 基础 ----
const renderer = new THREE.WebGLRenderer({ antialias: true })
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
renderer.setSize(window.innerWidth, window.innerHeight)
renderer.shadowMap.enabled = true
renderer.shadowMap.type = THREE.PCFSoftShadowMap
document.body.appendChild(renderer.domElement)

const scene = new THREE.Scene()
scene.background = new THREE.Color(0xa8cfee)
scene.fog = new THREE.Fog(0xa8cfee, 150, 320)

const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 700)

scene.add(new THREE.HemisphereLight(0xcfe8ff, 0x8a9a6a, 1.15))
const sun = new THREE.DirectionalLight(0xfff3d9, 2.0)
sun.position.set(60, 90, 40)
sun.castShadow = true
sun.shadow.mapSize.set(2048, 2048)
sun.shadow.camera.left = -95
sun.shadow.camera.right = 95
sun.shadow.camera.top = 95
sun.shadow.camera.bottom = -95
sun.shadow.camera.near = 20
sun.shadow.camera.far = 240
sun.shadow.bias = -0.0005
scene.add(sun)

const islandRoot = buildIsland(scene)

// ---- UI ----
const loading = document.getElementById('loading')!
const loadingText = document.getElementById('loading-text')!
const hint = document.getElementById('hint')!
const roomfull = document.getElementById('roomfull')
document.getElementById('rf-retry')?.addEventListener('click', () => location.reload())

const toastEl = document.getElementById('toast')!
let toastTimer: number | undefined
function showToast(text: string): void {
  toastEl.textContent = text
  toastEl.hidden = false
  toastEl.style.opacity = '1'
  window.clearTimeout(toastTimer)
  toastTimer = window.setTimeout(() => {
    toastEl.style.opacity = '0'
    window.setTimeout(() => (toastEl.hidden = true), 450)
  }, 2400)
}

const panelModal = document.getElementById('panel-modal')!
const pmTitle = document.getElementById('pm-title')!
const pmBody = document.getElementById('pm-body')!
document.getElementById('pm-close')?.addEventListener('click', () => (panelModal.hidden = true))
panelModal.addEventListener('click', (e) => {
  if (e.target === panelModal) panelModal.hidden = true
})

const PANEL_TEXTS: Record<string, { title: string; body: string }> = {
  news: {
    title: '新闻大厅',
    body: '院闻、动态与通知将在这里以 3D 展廊呈现（M2 接入 EKP 自动同步）。先四处逛逛，看看海岛风景吧。'
  },
  notice: {
    title: '公告堂',
    body: '院级公告将按类别重构展示，点击可跳转原文（M2 接入 EKP）。'
  },
  standards: {
    title: '规范馆',
    body: '知识库与规范库内容 M2 上架——配合每日一题，边逛边学。'
  },
  board: {
    title: '荣誉榜',
    body: '答题排行榜 M2 开榜：总榜 / 周榜 / 部门榜。先把每日一题的分攒起来！'
  },
  quiz: {
    title: '答题台',
    body: '每日一题 M2 上线：答对 +10 分，多选不全 +5 分。现在可以先试试 1/2/3 动作热热身。'
  }
}

function openPanel(name: string): void {
  const t = PANEL_TEXTS[name]
  if (!t) return
  pmTitle.textContent = t.title
  pmBody.textContent = t.body
  panelModal.hidden = false
}

const chat = new ChatUI()
chat.addToScene(scene)
chat.clearList()
chat.onSend = (text, scope) => {
  net.sendChat(text, scope)
  // 本地先显示；若服务端回显自己的消息则去重（见 onChat）
  pendingOwn.push({ scope, text, t: nowSec() })
  renderChat({ from: { cid, name: '' }, scope, text })
}

const emotes = new EmoteFx()
emotes.addToScene(scene)
emotes.bindBar((emoji) => {
  net.sendEmote(emoji)
  if (selfAvatar) emotes.spawn(selfAvatar.group, emoji, nowSec())
})

const minimap = new Minimap()
minimap.onTeleport = (x, z) => {
  if (!inWorld) return
  self.x = THREE.MathUtils.clamp(x, -ISLAND_BOUND_R, ISLAND_BOUND_R)
  self.z = THREE.MathUtils.clamp(z, -ISLAND_BOUND_R, ISLAND_BOUND_R)
  moveTarget = null
  showToast('已传送')
}

// ---- 世界状态 ----
interface Remote {
  avatar: Avatar
  tx: number
  tz: number
  tyaw: number
  anim: 'idle' | 'walk' | 'wave' | 'clap' | 'dance'
  nickname: string
  dept: string
}

const remotes = new Map<string, Remote>()
const profiles = new Map<string, { nickname: string; dept: string }>()
const pendingOwn: Array<{ scope: ChatScopeUI; text: string; t: number }> = []

let selfAvatar: Avatar | null = null
let inWorld = false
let profileShown = false
let currentHouse: string | null = null

// 自己的位置（本地权威，10Hz 上报）
const self = { x: SPAWN.x, z: SPAWN.z, yaw: Math.PI, moving: false }
let moveTarget: { x: number; z: number } | null = null
let selfGesture: GestureName | null = null

function nowSec(): number {
  return performance.now() / 1000
}

// ---- 网络处理 ----
function applyPlayers(list: PlayerState[]): void {
  if (!inWorld) return
  const seen = new Set<string>()
  for (const p of list) {
    if (!p || typeof p.cid !== 'string' || p.cid === cid) continue
    seen.add(p.cid)
    const dept = p.dept || '其他'
    profiles.set(p.cid, { nickname: p.name || '同事', dept })
    let r = remotes.get(p.cid)
    if (!r) {
      const avatar = new Avatar(
        typeof p.color === 'number' ? paletteColor(p.color) : deptColor(dept),
        p.name || '同事',
        dept
      )
      avatar.group.position.set(num(p.x), 0, num(p.z))
      avatar.group.rotation.y = num(p.ry)
      scene.add(avatar.group)
      r = {
        avatar,
        tx: num(p.x),
        tz: num(p.z),
        tyaw: num(p.ry),
        anim: animOf(p),
        nickname: p.name || '同事',
        dept
      }
      remotes.set(p.cid, r)
      continue
    }
    r.nickname = p.name || r.nickname
    r.dept = dept
    r.tx = num(p.x)
    r.tz = num(p.z)
    r.tyaw = num(p.ry)
    r.anim = animOf(p)
  }
  for (const [key, r] of remotes) {
    if (!seen.has(key)) {
      r.avatar.dispose(scene)
      remotes.delete(key)
      profiles.delete(key)
    }
  }
}

function num(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0
}

const GESTURE_SET = new Set<string>(GESTURES)

function animOf(p: PlayerState): 'idle' | 'walk' | 'wave' | 'clap' | 'dance' {
  return GESTURE_SET.has(p.anim) ? (p.anim as 'wave' | 'clap' | 'dance') : p.anim === 'walk' ? 'walk' : 'idle'
}

function resetWorld(): void {
  for (const r of remotes.values()) r.avatar.dispose(scene)
  remotes.clear()
  profiles.clear()
  if (selfAvatar) {
    selfAvatar.dispose(scene)
    selfAvatar = null
  }
  inWorld = false
  currentHouse = null
  chat.setRoomAvailable(false)
}

function enterWorld(init: InitMsg): void {
  resetWorld()
  inWorld = true
  loading.hidden = true
  if (roomfull) roomfull.hidden = true
  chat.setEnabled(true)
  emotes.setEnabled(true)
  minimap.setEnabled(true)
  hint.hidden = false
  hint.classList.remove('faded')
  window.setTimeout(() => hint.classList.add('faded'), 9000)

  const s = init.self
  self.x = typeof s.x === 'number' && Number.isFinite(s.x) ? s.x : SPAWN.x
  self.z = typeof s.z === 'number' && Number.isFinite(s.z) ? s.z : SPAWN.z
  self.yaw = Math.PI
  selfAvatar = new Avatar(
    typeof s.color === 'number' ? paletteColor(s.color) : deptColor(s.dept || '其他'),
    s.nickname || '我',
    s.dept || ''
  )
  selfAvatar.group.position.set(self.x, 0, self.z)
  selfAvatar.group.rotation.y = self.yaw
  scene.add(selfAvatar.group)
  camera.position.set(self.x, 9.5, self.z + 12.5)
  profiles.set(cid, { nickname: s.nickname || '我', dept: s.dept || '' })

  applyPlayers(init.players ?? [])
}

const net = new WorldNet({
  onInit(init) {
    const s = init.self ?? { cid: '', nickname: '', dept: null, color: null, houseId: null }
    if (!s.nickname && !profileShown) {
      profileShown = true
      loadingText.textContent = '等待填写身份…'
      showProfileModal(async (nickname, dept, color) => {
        const res = await fetch('/api/profile', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ cid, nickname, dept, color })
        })
        if (!res.ok) throw new Error(`profile ${res.status}`)
        loadingText.textContent = '正在进入小世界…'
        net.rejoin(cid, token) // 重新 init，服务端此时已有档案
      })
      return
    }
    if (!s.nickname) return // 弹窗已打开，等 rejoin 后的 init
    enterWorld(init)
  },
  onPlayers(list) {
    applyPlayers(list)
  },
  onChat(msg) {
    const mine = msg.from?.cid === cid
    if (mine) {
      const i = pendingOwn.findIndex((p) => p.scope === msg.scope && p.text === msg.text && nowSec() - p.t < 5)
      if (i >= 0) {
        pendingOwn.splice(i, 1)
        return // 自己刚发过，已本地渲染
      }
    }
    renderChat(msg)
  },
  onEmote(msg) {
    if (!inWorld) return
    const holder = msg.from?.cid === cid ? selfAvatar?.group : remotes.get(msg.from?.cid)?.avatar.group
    if (holder) emotes.spawn(holder, msg.emoji, nowSec())
  },
  onHouseOk(id) {
    currentHouse = id
    chat.setRoomAvailable(id !== null)
    const house = HOUSES.find((h) => h.id === id)
    showToast(id && house ? `已进入 ${house.name} · 房内聊天已开启` : '已离开小房子')
  },
  onHouseFull(id) {
    const house = HOUSES.find((h) => h.id === id)
    showToast(`${house ? house.name : '小屋'}满员啦（6 人上限）`)
  },
  onLeave(departed) {
    const r = remotes.get(departed)
    if (r) {
      r.avatar.dispose(scene)
      remotes.delete(departed)
      profiles.delete(departed)
    }
  },
  onStatus(status) {
    if (status === 'room_full') {
      loading.hidden = true
      if (roomfull) roomfull.hidden = false
      chat.setEnabled(false)
      emotes.setEnabled(false)
      minimap.setEnabled(false)
      return
    }
    if (!inWorld) {
      loading.hidden = false
      loadingText.textContent =
        status === 'connecting' ? '正在进入小世界…' : status === 'reconnecting' ? '连接中断，正在重连…' : '已连接'
    }
  }
})

function renderChat(msg: { from: { cid: string; name: string }; scope: ChatScopeUI; text: string }): void {
  if (!inWorld) return
  const mine = msg.from?.cid === cid
  const who = mine ? (profiles.get(cid)?.nickname ?? '我') : msg.from?.name || profiles.get(msg.from?.cid)?.nickname || '同事'
  const dept = profiles.get(msg.from?.cid)?.dept ?? ''
  if (msg.scope === 'all') {
    chat.addListMessage(who, dept, msg.text, mine)
    return
  }
  if (msg.scope === 'room') {
    chat.addListMessage(who, dept, msg.text, mine, '房间')
    return
  }
  // near：8m 内显示头顶气泡（含自己的）
  const holder = mine ? selfAvatar?.group : remotes.get(msg.from?.cid)?.avatar.group
  if (holder) chat.addBubble(holder, msg.text, 2.95, nowSec())
}

net.connect(cid, token)

// ---- 输入与移动 ----
const keys = new Set<string>()
const MOVE_KEYS = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'])

window.addEventListener('keydown', (e) => {
  if (chat.isTyping()) return
  if (e.code === 'Enter' && inWorld) {
    e.preventDefault()
    chat.focusInput()
    return
  }
  // 动作快捷键 1/2/3
  if (inWorld && ['Digit1', 'Digit2', 'Digit3'].includes(e.code)) {
    e.preventDefault()
    const g = GESTURES[Number(e.code.slice(-1)) - 1]
    if (g && selfAvatar) {
      selfGesture = g
      selfAvatar.playGesture(g)
    }
    return
  }
  if (MOVE_KEYS.has(e.code)) {
    moveTarget = null // 键盘接管
    keys.add(e.code)
    if (inWorld) e.preventDefault()
  }
})
window.addEventListener('keyup', (e) => keys.delete(e.code))
window.addEventListener('blur', () => keys.clear())

// 点击寻路 / 建筑面板：canvas 上的单击
const raycaster = new THREE.Raycaster()
const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -0.33)
const ndc = new THREE.Vector2()
const hitPoint = new THREE.Vector3()

renderer.domElement.addEventListener('pointerdown', (e) => {
  if (!inWorld || e.button !== 0) return
  ndc.set((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1)
  raycaster.setFromCamera(ndc, camera)
  const hits = raycaster.intersectObjects(islandRoot.children, true)
  if (hits.length > 0) {
    // 先看是否点了带 panel 标记的建筑
    let o: THREE.Object3D | null = hits[0].object
    while (o && o !== islandRoot) {
      if (o.userData?.panel) {
        openPanel(String(o.userData.panel))
        return
      }
      o = o.parent
    }
    hitPoint.copy(hits[0].point)
  } else if (!raycaster.ray.intersectPlane(groundPlane, hitPoint)) {
    return
  }
  // 限制在可行走范围（圆形边界内或码头走廊）
  const r = Math.hypot(hitPoint.x, hitPoint.z)
  const inPier = hitPoint.x > PIER.minX && hitPoint.x < PIER.maxX && hitPoint.z > PIER.minZ && hitPoint.z < PIER.maxZ
  if (r < ISLAND_BOUND_R || inPier) moveTarget = { x: hitPoint.x, z: hitPoint.z }
})

const SPEED = 6

function resolveCollision(): void {
  const r = 0.5
  for (const b of COLLIDERS) {
    if (self.x > b.minX - r && self.x < b.maxX + r && self.z > b.minZ - r && self.z < b.maxZ + r) {
      const dl = Math.abs(self.x - (b.minX - r))
      const dr = Math.abs(b.maxX + r - self.x)
      const dn = Math.abs(self.z - (b.minZ - r))
      const df = Math.abs(b.maxZ + r - self.z)
      const m = Math.min(dl, dr, dn, df)
      if (m === dl) self.x = b.minX - r
      else if (m === dr) self.x = b.maxX + r
      else if (m === dn) self.z = b.minZ - r
      else self.z = b.maxZ + r
    }
  }
}

function stepSelf(dt: number): void {
  if (!inWorld || !selfAvatar) return
  let dx = 0
  let dz = 0
  if (keys.has('KeyW') || keys.has('ArrowUp')) dz -= 1
  if (keys.has('KeyS') || keys.has('ArrowDown')) dz += 1
  if (keys.has('KeyA') || keys.has('ArrowLeft')) dx -= 1
  if (keys.has('KeyD') || keys.has('ArrowRight')) dx += 1
  if (dx === 0 && dz === 0 && moveTarget) {
    const tx = moveTarget.x - self.x
    const tz = moveTarget.z - self.z
    const d = Math.hypot(tx, tz)
    if (d < 0.25) {
      moveTarget = null
    } else {
      dx = tx / d
      dz = tz / d
    }
  }
  self.moving = dx !== 0 || dz !== 0
  if (self.moving) {
    const len = Math.hypot(dx, dz)
    dx /= len
    dz /= len
    self.x += dx * SPEED * dt
    self.z += dz * SPEED * dt
    const targetYaw = Math.atan2(dx, dz)
    self.yaw = lerpAngle(self.yaw, targetYaw, 1 - Math.exp(-dt * 14))
  }
  // 岛界：圆形边界（码头走廊例外）
  const inPier = self.x > PIER.minX && self.x < PIER.maxX && self.z > PIER.minZ && self.z < PIER.maxZ
  if (!inPier) {
    const r = Math.hypot(self.x, self.z)
    if (r > ISLAND_BOUND_R) {
      self.x = (self.x / r) * ISLAND_BOUND_R
      self.z = (self.z / r) * ISLAND_BOUND_R
    }
  } else {
    self.z = THREE.MathUtils.clamp(self.z, PIER.minZ, PIER.maxZ)
    self.x = THREE.MathUtils.clamp(self.x, PIER.minX, PIER.maxX)
  }
  resolveCollision()
  selfAvatar.group.position.set(self.x, 0, self.z)
  selfAvatar.group.rotation.y = self.yaw
  if (self.moving && selfGesture) {
    selfGesture = null // 走动打断动作
  }
  selfAvatar.setWalking(self.moving, dt)
}

// ---- 小房子进出检测 ----
function stepHouse(): void {
  if (!inWorld) return
  let inside: string | null = null
  for (const h of HOUSES) {
    const { interior } = h
    if (self.x > interior.minX && self.x < interior.maxX && self.z > interior.minZ && self.z < interior.maxZ) {
      inside = h.id
      break
    }
  }
  if (inside !== currentHouse) {
    if (currentHouse) {
      const prev = HOUSES.find((h) => h.id === currentHouse)
      if (prev?.roof) prev.roof.visible = true
    }
    if (inside) {
      const h = HOUSES.find((x) => x.id === inside)
      if (h?.roof) h.roof.visible = false
      net.sendHouse(inside) // 服务端确认后 onHouseOk 更新 currentHouse 与聊天通道
      return
    }
    net.sendHouse(null)
    currentHouse = null
    chat.setRoomAvailable(false)
  }
}

function lerpAngle(a: number, b: number, t: number): number {
  const d = ((b - a + Math.PI * 3) % (Math.PI * 2)) - Math.PI
  return a + d * t
}

// ---- 相机跟随（第三人称；屋内拉近） ----
const camTarget = new THREE.Vector3()

function stepCamera(dt: number): void {
  if (!selfAvatar) return
  const inHouse = currentHouse !== null
  camTarget.set(self.x, inHouse ? 7.2 : 9.5, self.z + (inHouse ? 9.2 : 12.5))
  camera.position.lerp(camTarget, 1 - Math.exp(-dt * 4.5))
  camera.lookAt(self.x, 1.4, self.z)
}

// ---- 位置上报 10Hz（动作中带动作名，远端据此播放姿态） ----
window.setInterval(() => {
  if (!inWorld) return
  let anim: 'idle' | 'walk' | 'wave' | 'clap' | 'dance' = self.moving ? 'walk' : 'idle'
  if (selfGesture && selfAvatar?.activeGesture === selfGesture) anim = selfGesture
  else selfGesture = null
  net.sendPos(self.x, self.z, self.yaw, anim)
}, 100)

// ---- 小地图刷新 ----
window.setInterval(() => {
  if (!inWorld) return
  const others = [...remotes.values()].map((r) => ({ x: r.avatar.group.position.x, z: r.avatar.group.position.z }))
  minimap.render({ x: self.x, z: self.z, ry: self.yaw }, others)
}, 200)

// ---- 主循环 ----
const clock = new THREE.Clock()

renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), 0.1)
  stepSelf(dt)
  stepHouse()

  const k = 1 - Math.exp(-dt * 10)
  for (const r of remotes.values()) {
    const g = r.avatar.group
    const dx = r.tx - g.position.x
    const dz = r.tz - g.position.z
    if (dx * dx + dz * dz > 25) {
      g.position.set(r.tx, 0, r.tz) // 传点/刚加入，直接吸附
    } else {
      g.position.x += dx * k
      g.position.z += dz * k
    }
    g.rotation.y = lerpAngle(g.rotation.y, r.tyaw, k)
    if (GESTURE_SET.has(r.anim)) {
      r.avatar.playGesture(r.anim as GestureName)
      r.avatar.setWalking(false, dt)
    } else {
      r.avatar.setWalking(r.anim === 'walk' || Math.abs(dx) + Math.abs(dz) > 0.08, dt)
    }
  }

  stepCamera(dt)
  if (selfAvatar) chat.update(nowSec(), selfAvatar.group.position)
  emotes.update(nowSec())
  renderer.render(scene, camera)
})

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight
  camera.updateProjectionMatrix()
  renderer.setSize(window.innerWidth, window.innerHeight)
})

window.addEventListener('beforeunload', () => net.close())
