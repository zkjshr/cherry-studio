# 小世界（Little World）服务

Three.js 3D 多人园区（虚拟设计院）的服务端：WS 房间、客户端心跳在线、身份档案、前端静态托管。
对应 PRD：`tjad-docs/superpowers/specs/2026-10-05-little-world.md`（契约见 §4，下表为落地版）。

```
world/
├── server/          # 本服务（纯 Node ESM，无构建步骤；唯一依赖 ws，SQLite 用内建 node:sqlite）
│   ├── src/         # index 入口 / room 房间 / store 存储 / static 静态 / config 契约常量
│   └── tests/       # node:test 套件 + smoke.mjs e2e 冒烟
├── data/            # world.sqlite3（运行时生成，已 gitignore）
├── frontend/        # Three.js 前端（另一工作流，构建产物 dist/ 由本服务托管）
└── README.md
```

## 运行

```bash
# 要求 node >= 22.5（node:sqlite 内建）；本仓库环境为 node 24（/opt/homebrew/opt/node@24/bin）
cd world/server
npm install          # 安装 ws（幂等）
npm start            # 默认 :8788

npm test             # node --test "tests/*.test.mjs"（23 项：token/房间上限/聊天/在场合并/档案/批量广播/静态）
npm run smoke        # e2e 冒烟（临时库 + 临时端口）
```

> 注：本机 homebrew node@24 对 `node --test <目录>` 的目录参数形式存在回归（子进程按模块加载目录报 MODULE_NOT_FOUND），故测试命令使用 glob 形式 `node --test "tests/*.test.mjs"`，功能等价。

## 环境变量

| 变量 | 默认 | 说明 |
|---|---|---|
| `PORT` | `8788` | HTTP/WS 监听端口（部署在网关旁） |
| `WORLD_DB_PATH` | `world/server/data/world.sqlite3` | SQLite 路径（profiles + lastseen） |
| `WORLD_FRONTEND_DIST` | `world/frontend/dist` | 静态托管目录；缺失时 `/` 返回「frontend not built」占位页 |
| `GATEWAY_TOKEN` | 空 | 鉴权 token；**空 = 放行**（本地开发）。非空时校验常量时间比较 |

## 对外契约（PRD §4 锁死接口）

| 接口 | 方向 | 说明 |
|---|---|---|
| `GET /` | 客户端 | Three.js 应用（`?cid=` 注入身份）；dist 缺失时回占位页 |
| `WS /ws?cid=&token=` | 双向 | token 走 `GATEWAY_TOKEN` 语义；缺 cid → 握手 400；token 错 → 401 |
| `POST /api/heartbeat`（头 `X-Client-Token`，体 `{cid}`） | 请求 | → `204`；90s 无心跳视为离线；缺 cid/非法 JSON → `400`，token 错 → `401` |
| `POST /api/profile`（体 `{cid, nickname, dept}`） | 请求 | → `200 {ok:true}` 持久化；非法 → `400`。nickname 1-20 字；dept 枚举：建筑/结构/机电/规划/景观/室内/职能部门/信息化中心/其他 |
| `GET /api/health` | 请求 | → `{ok:true, online:N, inScene:M}`（online=在线名单去重 cid 数，inScene=活跃 WS 会话数） |

### WS 消息

客户端 → 服务端：

```jsonc
{ "type": "join" }
{ "type": "pos",  "x": 0, "z": 0, "ry": 0, "anim": "idle" }   // ~10Hz；仅记录，不即时转发
{ "type": "chat", "scope": "near" | "all", "text": "≤500 字" }
```

服务端 → 客户端：

```jsonc
{ "type": "init",    "self": { "cid", "nickname", "dept", "scene": true },
                     "players": [ /* 其他 WS 玩家 */ ],
                     "world": { "spawn": { "x": 0, "z": 0 } } }
{ "type": "players", "players": [ /* 全量名单，100ms 一拍 */ ] }
{ "type": "chat",    "from": { "cid", "name" }, "scope": "near" | "all", "text" } // 含发送者回显
{ "type": "leave",   "cid" }                                                   // 断开即发
```

### players 条目（在场名单合并，D8）

| 字段 | scene=true（WS 在场） | scene=false（心跳在线，坐班小人） |
|---|---|---|
| `cid` `name` `dept` | 有 | 有 |
| `x` `z` `ry` `anim` | 有（未上报 pos 时为出生点/idle） | **无**（前端安放到部门工位） |

- `name`：档案昵称；无档案 → `同事-{cid 前 4 位}`；`dept`：无档案为 `null`。
- 在线 = 心跳 90s 内；在场景 = 存在活跃 WS 会话；同一 cid 两者兼有时 WS 条目优先（不重复）。
- `near` 聊天半径 8m，以发送者最后上报位置为圆心（无位置按出生点）。

### 超员拒绝（D5）

单房间 50 人：第 51 个 WS 连接完成握手后立即以 **close code `4000` / reason `room_full`** 关闭，前端据此提示稍后再试。

## 部署（对应 W3）

```bash
# 66.12 上（网关旁）
PORT=8788 GATEWAY_TOKEN=<与网关一致的token> node world/server/src/index.js
# systemd/pm2 托管；Nginx 需支持 WS 升级：
#   location /ws { proxy_pass http://127.0.0.1:8788; proxy_http_version 1.1;
#                  proxy_set_header Upgrade $http_upgrade; proxy_set_header Connection "upgrade"; }
```

## 设计取舍备注

- SQLite 用 node 内建 `node:sqlite`（DatabaseSync），零原生依赖，node ≥22.5 即可。
- `/api/profile` 不校验 `GATEWAY_TOKEN`（PRD §4 仅对 heartbeat 标注该头；profile 由 webview 内表单提交，webview 不持有网关 token）。如后续需要，可在网关层加签。
- WS 消息上限 64KB；非 JSON、未知 type、非法 pos（非有限数/anim 超长）、非法 chat（scope 非 near/all、text 空或 >500）一律静默忽略。
