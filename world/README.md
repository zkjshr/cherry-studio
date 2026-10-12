# 小世界（Little World）服务

Three.js 3D 海岛展馆（v2）的服务端：WS 房间、三通道聊天、小房子、表情转发、身份档案、
客户端心跳统计、前端静态托管。对应设计：`tjad-docs/superpowers/specs/2026-10-05-little-world-v2.md`
（契约增补见 `world/shared-contract.md`）。v1 园区找人 PRD 已被 v2 取代。

```
world/
├── server/          # 本服务（纯 Node ESM，无构建步骤；唯一依赖 ws，SQLite 用内建 node:sqlite）
│   ├── src/         # index 入口 / room 房间 / store 存储 / static 静态 / config 契约常量
│   └── tests/       # node:test 套件（28 项）+ smoke.mjs e2e 冒烟
├── data/            # world.sqlite3（运行时生成，已 gitignore）
├── frontend/        # Three.js 海岛前端（island/avatar/chat/emotes/minimap/net/profile）
└── README.md
```

## 运行

```bash
# 要求 node >= 22.5（node:sqlite 内建）；本仓库环境为 node 24（/opt/homebrew/opt/node@24/bin）
cd world/server
npm install          # 安装 ws（幂等）
npm start            # 默认 :8788

npm test             # node --test "tests/*.test.mjs"（28 项：token/上限/聊天/小房子/表情/档案/health/静态）
npm run smoke        # e2e 冒烟（临时库 + 临时端口）
```

> 注：本机 homebrew node@24 对 `node --test <目录>` 的目录参数形式存在回归，测试命令使用 glob 形式，功能等价。

## 环境变量

| 变量 | 默认 | 说明 |
|---|---|---|
| `PORT` | `8788` | HTTP/WS 监听端口（部署在网关旁） |
| `WORLD_DB_PATH` | `world/server/data/world.sqlite3` | SQLite 路径（profiles + lastseen） |
| `WORLD_FRONTEND_DIST` | `world/frontend/dist` | 静态托管目录；缺失时 `/` 返回「frontend not built」占位页 |
| `GATEWAY_TOKEN` | 空 | 鉴权 token；**空 = 放行**（本地开发）。非空时校验常量时间比较 |

## 对外契约（v2 §12，锁死接口）

| 接口 | 方向 | 说明 |
|---|---|---|
| `GET /` | 客户端 | Three.js 海岛应用（`?cid=` 注入身份）；dist 缺失时回占位页 |
| `WS /ws?cid=&token=` | 双向 | token 走 `GATEWAY_TOKEN` 语义；缺 cid → 握手 400；token 错 → 401 |
| `POST /api/heartbeat`（头 `X-Client-Token`，体 `{cid}`） | 请求 | → `204`；**仅作管理端统计（clients）**，不再驱动场景表现 |
| `POST /api/profile`（体 `{cid, nickname, dept, color?}`） | 请求 | → `200 {ok:true}` 持久化；非法 → `400`。nickname 1-20 字；dept 9 枚举；color 0..7（非法 → null） |
| `GET /api/health` | 请求 | → `{ok, online, clients}`：**online = 场景内人数（打开页面）**，clients = 心跳客户端数 |

### WS 消息（v2）

客户端 → 服务端：`{join}` `{pos x,z,ry,anim}` `{chat scope:'near'|'all'|'room'}` `{house id|null}` `{emote emoji}`。
服务端 → 客户端：`{init}` `{players 全量10Hz，仅场景内}` `{chat}` `{emote}` `{house_ok}` `{house_full}` `{leave}`。
字段形状见 `shared-contract.md`；非法消息一律静默忽略。

### 在线语义（v2 修订，替代 v1 D8）

- **在线（对外公示）= 打开场景页面的人数**（活跃 WS 会话 = health.online）
- 心跳客户端数（health.clients）只进管理端统计；**坐班小人已废弃**，players 不含未开页面者
- 无档案者 init.self.nickname 为空 → 前端弹身份填写框（昵称+部门+配色）

### 上限（D5 保留）

单房间 50 人：第 51 个 WS 握手后立即以 **close code `4000` / reason `room_full`** 关闭。
小房子每间 ≤6 人（HOUSE_CAPACITY），满员对请求者回 `house_full`。

## 部署（对应 M3）

```bash
# 66.12 上（网关旁）
PORT=8788 GATEWAY_TOKEN=<与网关一致的token> node world/server/src/index.js
# systemd/pm2 托管；Nginx 需支持 WS 升级：
#   location /ws { proxy_pass http://127.0.0.1:8788; proxy_http_version 1.1;
#                  proxy_set_header Upgrade $http_upgrade; proxy_set_header Connection "upgrade"; }
```

## 设计取舍备注

- SQLite 用 node 内建 `node:sqlite`（DatabaseSync），零原生依赖；profiles 旧库自动补 color 列（ALTER TABLE）。
- `/api/profile` 不校验 `GATEWAY_TOKEN`（webview 内表单提交，webview 不持有网关 token）。
- anim 字段接受 ≤16 字符字符串；动作名（wave/clap/dance）即随 pos 同步，服务端不感知语义。
- EKP 内容拉取、题库/积分/排行榜、管理后台为 M2 范围，本服务尚未实现。
