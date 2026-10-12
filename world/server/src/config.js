// 小世界服务配置与契约常量（PRD 2026-10-05-little-world §4）
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const serverRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

/** 部门枚举（PRD §4 profile 契约） */
export const DEPTS = ['建筑', '结构', '机电', '规划', '景观', '室内', '职能部门', '信息化中心', '其他']

/** 单房间同时在线上限（D5） */
export const CAPACITY = 50

/** 位置批量广播周期（客户端 10Hz 上报，服务端 10Hz 全量下发） */
export const BROADCAST_INTERVAL_MS = 100

/** 心跳有效窗口：90s 无心跳视为离线（D8 / PRD §4） */
export const HEARTBEAT_WINDOW_MS = 90_000

/** 附近聊天半径（米，v2 §5） */
export const NEAR_RADIUS = 8

/** 单条聊天文本长度上限 */
export const MAX_CHAT_LEN = 500

/** 昵称长度区间（1-20） */
export const NICKNAME_MAX_LEN = 20

/** 出生点（init.world.spawn）：中央广场南侧，第一眼看到广场三馆与海平线 */
export const SPAWN = { x: 0, z: 26 }

/** 小房子 id 枚举（前端 island.ts 的 HOUSES 一一对应；v2 §3） */
export const HOUSE_IDS = ['h1', 'h2', 'h3', 'h4']

/** 每间小房子容量（v2 §3：≤6 人/间） */
export const HOUSE_CAPACITY = 6

/** 表情字符长度上限（UTF-16 码元） */
export const MAX_EMOTE_LEN = 8

/** 外观配色档位数量（0..PALETTE_SIZE-1；前端 island.ts PALETTE 一一对应） */
export const PALETTE_SIZE = 8

export function loadConfig(env = process.env) {
  return {
    port: toInt(env.PORT, 8788),
    // 默认 world/data/world.sqlite3（已 gitignore），可用 WORLD_DB_PATH 覆盖
    dbPath: env.WORLD_DB_PATH || path.resolve(serverRoot, '..', 'data', 'world.sqlite3'),
    // 静态托管 Three.js 前端目录；缺失时回退占位页
    frontendDist: env.WORLD_FRONTEND_DIST || path.resolve(serverRoot, '..', 'frontend', 'dist'),
    // 鉴权复用网关 token 语义；为空 = 不校验（本地开发默认）
    gatewayToken: env.GATEWAY_TOKEN || ''
  }
}

function toInt(v, fallback) {
  const n = Number.parseInt(v ?? '', 10)
  return Number.isFinite(n) && n > 0 ? n : fallback
}
