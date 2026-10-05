// 小世界前端入口：启动（cid/token）→ WS init → （必要时）身份填写 → 进场景。
// 场景循环：本机 WASD 移动 + 第三人称跟随相机；远端玩家 10Hz 全量 → 位置插值；
// scene=false 者按确定性规则坐在部门工位（见 campus.seatedSpot / shared-contract）。

import * as THREE from 'three'

import './style.css'
import { Avatar } from './avatar'
import { BUILDING_BOX, CAMPUS_HALF, SPAWN, buildCampus, deptColor, seatedSpot, type DeskSpot } from './campus'
import { ChatUI } from './chat'
import { WorldNet, type InitMsg, type PlayerState } from './net'
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
scene.fog = new THREE.Fog(0xa8cfee, 130, 260)

const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 400)

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

buildCampus(scene)

// ---- UI ----
const loading = document.getElementById('loading')!
const loadingText = document.getElementById('loading-text')!
const hint = document.getElementById('hint')!
const roomfull = document.getElementById('roomfull')!
document.getElementById('rf-retry')?.addEventListener('click', () => location.reload())

const chat = new ChatUI()
chat.addToScene(scene)
chat.clearList()
chat.onSend = (text, scope) => {
  net.sendChat(text, scope)
  // 本地先显示；若服务端回显自己的消息则去重（见 onChat）
  pendingOwn.push({ text, t: nowSec() })
  renderChat({ from: cid, scope, text })
}

// ---- 世界状态 ----
interface Remote {
  avatar: Avatar
  tx: number
  tz: number
  tyaw: number
  anim: 'idle' | 'walk'
  seat: DeskSpot | null
  nickname: string
  dept: string
}

const remotes = new Map<string, Remote>()
const profiles = new Map<string, { nickname: string; dept: string }>()
const pendingOwn: Array<{ text: string; t: number }> = []

let selfAvatar: Avatar | null = null
let inWorld = false
let profileShown = false

// 自己的位置（本地权威，10Hz 上报）
const self = { x: SPAWN.x, z: SPAWN.z, yaw: Math.PI, moving: false }

function nowSec(): number {
  return performance.now() / 1000
}

// ---- 网络处理 ----
function applyPlayers(list: PlayerState[]): void {
  if (!inWorld) return
  const seatCount = new Map<string, number>()
  const seen = new Set<string>()
  for (const p of list) {
    if (!p || typeof p.cid !== 'string' || p.cid === cid) continue
    seen.add(p.cid)
    const dept = p.dept || '其他'
    profiles.set(p.cid, { nickname: p.nickname || '同事', dept })
    let seat: DeskSpot | null = null
    if (!p.scene) {
      const i = seatCount.get(dept) ?? 0
      seatCount.set(dept, i + 1)
      seat = seatedSpot(dept, i)
    }
    let r = remotes.get(p.cid)
    if (!r) {
      const avatar = new Avatar(deptColor(dept), p.nickname || '同事')
      if (seat) {
        avatar.group.position.set(seat.x, 0, seat.z)
        avatar.group.rotation.y = seat.ry
        avatar.setSeated(true)
      } else {
        avatar.group.position.set(num(p.x), 0, num(p.z))
        avatar.group.rotation.y = num(p.ry)
      }
      scene.add(avatar.group)
      r = {
        avatar,
        tx: num(p.x),
        tz: num(p.z),
        tyaw: num(p.ry),
        anim: animOf(p),
        seat,
        nickname: p.nickname || '同事',
        dept
      }
      remotes.set(p.cid, r)
      continue
    }
    r.nickname = p.nickname || r.nickname
    r.dept = dept
    if (!p.scene) {
      r.tx = seat!.x
      r.tz = seat!.z
      r.tyaw = seat!.ry
      r.anim = 'idle'
      const seatChanged = !r.seat || r.seat.x !== seat!.x || r.seat.z !== seat!.z
      r.seat = seat
      if (seatChanged) {
        r.avatar.setSeated(true)
        r.avatar.group.position.set(seat!.x, 0, seat!.z)
        r.avatar.group.rotation.y = seat!.ry
      }
    } else if (r.seat) {
      r.seat = null
      r.avatar.setSeated(false)
      r.avatar.group.position.set(num(p.x), 0, num(p.z))
      r.tx = num(p.x)
      r.tz = num(p.z)
      r.tyaw = num(p.ry)
      r.anim = animOf(p)
    } else {
      r.tx = num(p.x)
      r.tz = num(p.z)
      r.tyaw = num(p.ry)
      r.anim = animOf(p)
    }
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

function animOf(p: PlayerState): 'idle' | 'walk' {
  return p.anim === 'walk' ? 'walk' : 'idle'
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
}

function enterWorld(init: InitMsg): void {
  resetWorld()
  inWorld = true
  loading.hidden = true
  roomfull.hidden = true
  chat.setEnabled(true)
  hint.hidden = false
  hint.classList.remove('faded')
  window.setTimeout(() => hint.classList.add('faded'), 8000)

  const s = init.self
  self.x = typeof s.x === 'number' && Number.isFinite(s.x) ? s.x : SPAWN.x
  self.z = typeof s.z === 'number' && Number.isFinite(s.z) ? s.z : SPAWN.z
  self.yaw = Math.PI
  selfAvatar = new Avatar(deptColor(s.dept || '其他'), s.nickname || '我')
  selfAvatar.group.position.set(self.x, 0, self.z)
  selfAvatar.group.rotation.y = self.yaw
  scene.add(selfAvatar.group)
  camera.position.set(self.x, 9.5, self.z + 12.5)
  profiles.set(cid, { nickname: s.nickname || '我', dept: s.dept || '' })

  applyPlayers(init.players ?? [])
}

const net = new WorldNet({
  onInit(init) {
    const s = init.self ?? { cid: '', nickname: '', dept: '' }
    if (!s.nickname && !profileShown) {
      profileShown = true
      loadingText.textContent = '等待填写身份…'
      showProfileModal(async (nickname, dept) => {
        const res = await fetch('/api/profile', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ cid, nickname, dept })
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
    if (msg.from === cid) {
      const i = pendingOwn.findIndex((p) => p.text === msg.text && nowSec() - p.t < 5)
      if (i >= 0) {
        pendingOwn.splice(i, 1)
        return // 自己刚发过，已本地渲染
      }
    }
    renderChat(msg)
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
      roomfull.hidden = false
      chat.setEnabled(false)
      return
    }
    if (!inWorld) {
      loading.hidden = false
      loadingText.textContent =
        status === 'connecting' ? '正在进入小世界…' : status === 'reconnecting' ? '连接中断，正在重连…' : '已连接'
    }
  }
})

function renderChat(msg: { from: string; scope: 'near' | 'all'; text: string }): void {
  if (!inWorld) return
  const mine = msg.from === cid
  const who = mine ? (profiles.get(cid)?.nickname ?? '我') : (profiles.get(msg.from)?.nickname ?? '同事')
  const dept = profiles.get(msg.from)?.dept ?? ''
  if (msg.scope === 'all') {
    chat.addListMessage(who, dept, msg.text, mine)
    return
  }
  // near：8m 内显示头顶气泡（含自己的）
  const holder = mine ? selfAvatar?.group : remotes.get(msg.from)?.avatar.group
  if (holder) {
    const seated = mine ? false : remotes.get(msg.from)!.avatar.seated
    chat.addBubble(holder, msg.text, seated ? 2.15 : 2.75, nowSec())
  }
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
  if (MOVE_KEYS.has(e.code)) {
    keys.add(e.code)
    if (inWorld) e.preventDefault()
  }
})
window.addEventListener('keyup', (e) => keys.delete(e.code))
window.addEventListener('blur', () => keys.clear())

const SPEED = 6

function stepSelf(dt: number): void {
  if (!inWorld || !selfAvatar) return
  let dx = 0
  let dz = 0
  if (keys.has('KeyW') || keys.has('ArrowUp')) dz -= 1
  if (keys.has('KeyS') || keys.has('ArrowDown')) dz += 1
  if (keys.has('KeyA') || keys.has('ArrowLeft')) dx -= 1
  if (keys.has('KeyD') || keys.has('ArrowRight')) dx += 1
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
  // 边界与主楼碰撞（AABB 外推）
  const lim = CAMPUS_HALF
  self.x = THREE.MathUtils.clamp(self.x, -lim, lim)
  self.z = THREE.MathUtils.clamp(self.z, -lim, lim)
  const r = 0.5
  const b = BUILDING_BOX
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
  selfAvatar.group.position.set(self.x, 0, self.z)
  selfAvatar.group.rotation.y = self.yaw
  selfAvatar.setWalking(self.moving, dt)
}

function lerpAngle(a: number, b: number, t: number): number {
  const d = ((b - a + Math.PI * 3) % (Math.PI * 2)) - Math.PI
  return a + d * t
}

// ---- 相机跟随（第三人称，固定偏移） ----
const camTarget = new THREE.Vector3()

function stepCamera(dt: number): void {
  if (!selfAvatar) return
  camTarget.set(self.x, 9.5, self.z + 12.5)
  camera.position.lerp(camTarget, 1 - Math.exp(-dt * 4.5))
  camera.lookAt(self.x, 1.4, self.z)
}

// ---- 位置上报 10Hz ----
window.setInterval(() => {
  if (inWorld) net.sendPos(self.x, self.z, self.yaw, self.moving ? 'walk' : 'idle')
}, 100)

// ---- 主循环 ----
const clock = new THREE.Clock()

renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), 0.1)
  stepSelf(dt)

  const k = 1 - Math.exp(-dt * 10)
  for (const r of remotes.values()) {
    if (r.seat) continue // 坐姿者位置固定
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
    r.avatar.setWalking(r.anim === 'walk' || Math.abs(dx) + Math.abs(dz) > 0.08, dt)
  }

  stepCamera(dt)
  if (selfAvatar) chat.update(nowSec(), selfAvatar.group.position)
  renderer.render(scene, camera)
})

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight
  camera.updateProjectionMatrix()
  renderer.setSize(window.innerWidth, window.innerHeight)
})

window.addEventListener('beforeunload', () => net.close())
