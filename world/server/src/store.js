// 存储层：world.sqlite3（profiles 档案 + lastseen 心跳），node:sqlite 内建驱动
// v2：profiles 增 color（外观配色档位 0..7，可空——旧档案迁移时为 null，前端回退部门色）
import fs from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'

export class Store {
  constructor(dbPath) {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true })
    this.dbPath = dbPath
    this.db = new DatabaseSync(dbPath)
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS profiles (
        cid        TEXT PRIMARY KEY,
        nickname   TEXT NOT NULL,
        dept       TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS lastseen (
        cid TEXT PRIMARY KEY,
        ts  INTEGER NOT NULL
      );
    `)
    this.migrate()
    this.qGetProfile = this.db.prepare('SELECT nickname, dept, color FROM profiles WHERE cid = ?')
    this.qUpsertProfile = this.db.prepare(`
      INSERT INTO profiles (cid, nickname, dept, color, updated_at) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(cid) DO UPDATE SET
        nickname = excluded.nickname, dept = excluded.dept, color = excluded.color, updated_at = excluded.updated_at
    `)
    this.qTouch = this.db.prepare(`
      INSERT INTO lastseen (cid, ts) VALUES (?, ?)
      ON CONFLICT(cid) DO UPDATE SET ts = excluded.ts
    `)
    this.qAlive = this.db.prepare('SELECT cid FROM lastseen WHERE ts > ?')
  }

  /** 旧库升级：profiles 补 color 列（已存在则跳过） */
  migrate() {
    const cols = this.db.prepare(`PRAGMA table_info(profiles)`).all().map((c) => c.name)
    if (!cols.includes('color')) {
      this.db.exec('ALTER TABLE profiles ADD COLUMN color INTEGER')
    }
  }

  getProfile(cid) {
    const row = this.qGetProfile.get(cid)
    if (!row) return null
    return { nickname: row.nickname, dept: row.dept, color: row.color ?? null }
  }

  /** color：0..7 整数或 null（未选） */
  upsertProfile(cid, nickname, dept, color, now = Date.now()) {
    this.qUpsertProfile.run(cid, nickname, dept, color ?? null, now)
  }

  /** 客户端心跳：刷新在线时间戳（ts 可注入，供测试使用）。v2 仅作管理端统计，不驱动场景 */
  touchHeartbeat(cid, ts = Date.now()) {
    this.qTouch.run(cid, ts)
  }

  /** 心跳窗口内仍在线的 cid 列表（客户端开着但未必打开页面） */
  heartbeatAliveCids(windowMs, now = Date.now()) {
    return this.qAlive.all(now - windowMs).map((r) => r.cid)
  }

  close() {
    this.db.close()
  }
}
