# 小世界 前后端共享契约备忘（v2 · 2026-10-05-little-world-v2 §12 补充）

v2 设计（海岛展馆）是锁死接口的当前事实；本文由 **前端（world/frontend）** 维护，记录前端实际依赖的
字段形状与小房子规则。前端对未知字段一律忽略，向后兼容。v1 的坐班小人/部门园区语义已废弃。

## 1. WS `/ws?cid=&token=`

### 客户端 → 服务端

| 消息 | 形状 | 说明 |
|---|---|---|
| join | `{type:'join'}` | 连接后立即发送 |
| pos | `{type:'pos', x, z, ry, anim}` | 10Hz；x/z 米（3 位小数）；ry 弧度，前方 = (sin ry, cos ry)；anim ∈ `'idle' \| 'walk' \| 'wave' \| 'clap' \| 'dance'`（动作随 pos 同步给他人） |
| chat | `{type:'chat', scope:'near'\|'all'\|'room', text}` | text ≤ 120 字（服务端上限 500）；**room = 当前小房子频道，须在房内** |
| house | `{type:'house', id:'h1'\|'h2'\|'h3'\|'h4' \| null}` | 进/出小房子；id 枚举与前端 `island.ts HOUSES` 一一对应（server config HOUSE_IDS） |
| emote | `{type:'emote', emoji}` | 表情（≤8 字符），8m 内转发 |

### 服务端 → 客户端

| 消息 | 形状 | 说明 |
|---|---|---|
| init | `{type:'init', self, players, world?}` | `self = {cid, nickname, dept, color, houseId, x?, z?}`；**nickname 为空 → 前端弹身份填写框**（昵称+部门+配色），POST /api/profile 后 rejoin 取新 init |
| players | `{type:'players', players}` | 全量 10Hz，**仅含场景内会话**（打开页面的人数；心跳客户端不再进 players）。元素：`{cid, name, dept, color, houseId, x, z, ry, anim}`；排序按会话序稳定 |
| chat | `{type:'chat', from:{cid,name}, scope, text}` | 含发送者回显；前端对自己回显做 5s 文本+scope 去重 |
| emote | `{type:'emote', from:{cid,name}, emoji}` | 8m 内转发（含回显），前端头顶浮 emoji 2s |
| house_ok | `{type:'house_ok', id: string\|null}` | 进/出房确认（前端据此更新 currentHouse/房间通道） |
| house_full | `{type:'house_full', id}` | 目标房满员（仅请求者收到），成员关系不变 |
| leave | `{type:'leave', cid}` | 玩家 WS 断开 |

### 关闭码

- **`4000`（reason `room_full`）= 房间满员**：前端停止重连，出「小世界满员」提示；其他非正常关闭按指数退避重连。

## 2. REST

- `POST /api/profile` 体 `{cid, nickname, dept, color?}` → 2xx；dept 枚举同 v1（9 项）；**color = 0..7 外观配色档位**（非法/缺省 → null，前端回退部门色）。前端走相对路径。
- `GET /api/health` → `{ok, online, clients}`；**online = 场景内人数（打开页面，对外公示的在线数）**；clients = 心跳客户端数（装了客户端未必开页面，仅管理端统计）。

## 3. 小房子确定性规则（前端拥有）

数据源：`world/frontend/src/island.ts` 的 `HOUSES`（id/name/doorSide/interior/inside）。前端按化身坐标进出
interior 判定进/出屋，发 `house` 消息；服务端只管成员关系（`session.houseId`）与房内聊天路由，不感知几何。
进屋时前端隐藏该屋顶（`house.roof.visible=false`）并拉近相机，出屋恢复；房容量 6（server HOUSE_CAPACITY）。

## 4. 化身配色（v2 §4）

`color` 0..7 ↔ 前端 `island.ts PALETTE`（红/蓝/橙/绿/青/紫/金/粉）。color=null 时回退 `deptColor(dept)`。
名牌 = 昵称 + 部门（**等级头衔前缀为 M2 预留**，`avatar.ts makeNameTexture(titlePrefix)`）。
