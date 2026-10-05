// 通用工具：token 常量时间比较、JSON body 读取
import crypto from 'node:crypto'

/**
 * GATEWAY_TOKEN 语义（PRD §3「鉴权复用 GATEWAY_TOKEN 语义」）：
 * - 期望值为空 → 放行（本地开发）
 * - 否则使用 crypto.timingSafeEqual 常量时间比较，避免时序侧信道
 */
export function tokenOk(provided, expected) {
  if (!expected) return true
  if (typeof provided !== 'string' || provided.length === 0) return false
  const a = Buffer.from(provided, 'utf8')
  const b = Buffer.from(expected, 'utf8')
  if (a.length !== b.length) {
    // 长度不同时仍执行一次比较，抹平长度分支的时序差异
    crypto.timingSafeEqual(b, b)
    return false
  }
  return crypto.timingSafeEqual(a, b)
}

/** 读取请求体并 JSON.parse；超过 limit 返回 'too_large'，非法 JSON 返回 null */
export async function readJsonBody(req, limit = 16 * 1024) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > limit) return 'too_large'
    chunks.push(chunk)
  }
  if (size === 0) return null
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    return null
  }
}

export function isFiniteNumber(v) {
  return typeof v === 'number' && Number.isFinite(v)
}
