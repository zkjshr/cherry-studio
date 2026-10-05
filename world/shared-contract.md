# 小世界 前后端共享契约备忘（PRD 2026-10-05-little-world §4 补充）

PRD §4 是锁死接口；本文由 **前端（world/frontend）** 维护，记录前端实际依赖的字段形状与
坐姿工位规则，world/server / 客户端实现时以此对齐。前端对未知字段一律忽略，向后兼容。

## 1. WS `/ws?cid=&token=`

### 客户端 → 服务端

| 消息 | 形状 | 说明 |
|---|---|---|
| join | `{type:'join'}` | 连接后立即发送 |
| pos | `{type:'pos', x, z, ry, anim}` | 10Hz；x/z 米（保留 3 位小数）；ry 弧度，**前方 = (sin ry, cos ry)，ry=0 面朝 +Z**；anim ∈ `'idle' \| 'walk'` |
| chat | `{type:'chat', scope:'near'\|'all', text}` | text ≤ 120 字 |

### 服务端 → 客户端

| 消息 | 形状 | 说明 |
|---|---|---|
| init | `{type:'init', self, players, world?}` | `self = {cid, nickname, dept, x?, z?}`；**nickname 为空 → 前端弹身份填写框**，POST /api/profile 成功后断开重连（rejoin）取新 init |
| players | `{type:'players', players}` | 全量 10Hz。元素：`{cid, nickname, dept, x, z, ry, anim, scene}`；`scene:true`=在场景（走动化身），`scene:false`=在线但不在场景（前端渲染为坐在部门工位，见下）。**要求排序稳定（如按入房序）**，坐姿工位序号依赖数组顺序 |
| chat | `{type:'chat', from, scope, text}` | `from` = 发送者 cid。**需广播给包含发送者在内的所有人**（前端对自己回显做了 5s 文本去重，未回显也不受影响——前端发送时已本地渲染） |
| leave | `{type:'leave', cid}` | 玩家 WS 断开 |

### 关闭码

- **`4000`（reason 可带 `room_full`）= 房间满员**：前端停止自动重连，出「园区满员」友好提示；其他非正常关闭按指数退避自动重连。

## 2. REST

- `POST /api/profile` 体 `{cid, nickname, dept}` → 2xx 即成功；dept ∈ 建筑/结构/机电/规划/景观/室内/职能部门/信息化中心/其他。前端走相对路径（dev 由 vite 代理到 ：8788）。

## 3. 坐姿工位确定性规则（前端拥有，服务端无需实现）

数据源：`world/frontend/src/campus.ts` 的 `DEPT_ZONES`（每部门一个 zone：`{center:[x,z], extents:[w,d], color, deskSpots[6]}`）。

规则：对每个部门 d，取当次 `players` 数组中 **scene=false 且 dept=d 的玩家，按数组出现顺序** 编号 i=0,1,2…，其坐姿位姿 = `DEPT_ZONES[d].deskSpots[i % 6]`（`{x, z, ry}`，坐者面朝桌面）。同一次会话内数组顺序稳定 ⇒ 座位稳定；玩家离线/起身会引起后续序号平移（可接受，v1 不做座位预留）。

前端据此完全本地渲染坐姿小人（低头办公姿态），服务端只透传 `scene:false`，不感知座位。
