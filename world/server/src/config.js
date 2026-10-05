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

/** 附近聊天半径（米，PRD §5） */
export const NEAR_RADIUS = 8

/** 单条聊天文本长度上限 */
export const MAX_CHAT_LEN = 500

/** 昵称长度区间（1-20） */
export const NICKNAME_MAX_LEN = 20

/** 出生点（init.world.spawn） */
export const SPAWN = { x: 0, z: 0 }

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
