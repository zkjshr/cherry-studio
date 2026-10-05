// 存储层：world.sqlite3（profiles 档案 + lastseen 心跳），node:sqlite 内建驱动
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
    this.qGetProfile = this.db.prepare('SELECT nickname, dept FROM profiles WHERE cid = ?')
    this.qUpsertProfile = this.db.prepare(`
      INSERT INTO profiles (cid, nickname, dept, updated_at) VALUES (?, ?, ?, ?)
      ON CONFLICT(cid) DO UPDATE SET nickname = excluded.nickname, dept = excluded.dept, updated_at = excluded.updated_at
    `)
    this.qTouch = this.db.prepare(`
      INSERT INTO lastseen (cid, ts) VALUES (?, ?)
      ON CONFLICT(cid) DO UPDATE SET ts = excluded.ts
    `)
    this.qAlive = this.db.prepare('SELECT cid FROM lastseen WHERE ts > ?')
  }

  getProfile(cid) {
    const row = this.qGetProfile.get(cid)
    return row ? { nickname: row.nickname, dept: row.dept } : null
  }

  upsertProfile(cid, nickname, dept, now = Date.now()) {
    this.qUpsertProfile.run(cid, nickname, dept, now)
  }

  /** 客户端心跳：刷新在线时间戳（ts 可注入，供测试使用） */
  touchHeartbeat(cid, ts = Date.now()) {
    this.qTouch.run(cid, ts)
  }

  /** 心跳窗口内仍在线的 cid 列表（D8：客户端开着即在线） */
  heartbeatAliveCids(windowMs, now = Date.now()) {
    return this.qAlive.all(now - windowMs).map((r) => r.cid)
  }

  close() {
    this.db.close()
  }
}
