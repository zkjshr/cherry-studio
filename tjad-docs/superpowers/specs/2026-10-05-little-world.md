# 小世界（Little World）PRD —— Three.js 3D 多人园区

- 日期：2026-10-05；状态：决策已确认（9 项，见 §2），进入实施
- 关联：企业版 PRD（2026-10-03-cherry-enterprise-prd.md）§9 明确"迷你元宇宙不在一期"——本 PRD 即该能力的立项
- 仓库：cherry-studio（enterprise 分支，单一开发仓库）

## 1. 一句话

在 TJADKnows Desktop 侧栏新增一级入口「小世界」：以虚拟设计院园区为场景的 Three.js 3D 多人交互空间——同事化身（lowpoly 小人）在对应部门区域活动，支持文字聊天，客户端开着即算在线。

## 2. 已确认决策（2026-10-05 用户逐条拍板）

| # | 决策 |
|---|---|
| D1 | 运行形态：**独立 Web 服务 + 客户端 webview 入口**；Three.js 前端 + WebSocket 房间服务部署在网关旁（同服务器） |
| D2 | 场景：**虚拟设计院园区**——楼层/区域对应部门，化身在部门区域活动，「去某部门找人」有空间语义；**要做园区周边环境和停车位** |
| D3 | 一期交互：位置同步 + 文字聊天（附近/全体）；语音、共享物件后置 |
| D4 | 身份：**未来强制企业微信扫码登录**（从企微取身份和部门）；**单点登录接入前用一次性填写的身份**（昵称+部门，填写后持久化） |
| D5 | 规模：**同时在线最多 50 人**（单房间，无分区） |
| D6 | 化身：**lowpoly 小人**风格 |
| D7 | 入口：侧栏一级菜单「小世界」，在「市场」下方；**设置里可开关**（和其他模块一致，默认展示） |
| D8 | 在线语义：**客户端开着即在线**（上班时间长驻）——不进入场景也在线，在线状态来自客户端心跳而非进入场景 |

## 3. 架构

```
客户端（cherry-studio enterprise）
├─ 主进程 WorldPresenceService：开机即连，30s 心跳 → world 服务（X-Client-Token + cid）
│    cid = 主进程持久化的 uuid（userData），通过 URL 参数传给 webview
├─ 侧栏「小世界」（市场下方，设置可开关）：webview 打开 {world_url}/?cid={cid}
└─ webview（Three.js 前端）：场景渲染 + 玩家 WS 会话 + 文字聊天

world 服务（独立 Node 服务，网关旁 :8788，gateway 旁新目录 world/）
├─ 静态托管 Three.js 前端（/）
├─ WS /ws?cid=&token=：场景会话（位置同步 10Hz、聊天、在场名单）
├─ POST /api/heartbeat（X-Client-Token + cid）：客户端在线心跳，90s 窗口
├─ POST /api/profile（cid, nickname, dept）：首次填写身份，服务端按 cid 持久化
└─ 存储 world.sqlite3（profiles、lastSeen）；鉴权复用 GATEWAY_TOKEN 语义
```

**在线状态模型**（D8 的落地）：
- 在线 = 心跳 90s 内有效（客户端主进程保活）
- 在场景 = 存在活跃 WS 会话
- 场景内表现：**在场景者** = 走动的 lowpoly 化身；**在线但不在场景者** = 坐在自己部门工位上的浅色小人（低头办公姿态，走近可打招呼聊天）——"长驻在线"的空间化表达

## 4. 世界服务契约（前后端/客户端三方的锁死接口）

- `GET /`：Three.js 应用（`?cid=` 参数注入客户端身份）
- `WS /ws?cid=&token=`：客户端消息 `{type:'join'}`、`{type:'pos', x,z,ry,anim}`、`{type:'chat', scope:'near'|'all', text}`；服务端消息 `{type:'init', self, players, world}`、`{type:'players', players}`（全量 10Hz）、`{type:'chat', from, scope, text}`、`{type:'leave', cid}`
- `POST /api/heartbeat`：头 X-Client-Token，体 {cid} → 204；90s 无心跳视为离线
- `POST /api/profile`：{cid, nickname, dept} → 持久化；部门选项：建筑/结构/机电/规划/景观/室内/职能部门/信息化中心/其他
- 单房间 50 人上限：超员 WS 拒绝（code=room_full），前端提示稍后再试
- `world_url` 下发：gateway admin_settings 新增 `world_url` 键 → 组合配置顶层 `world_url` 字段 → 客户端 Enterprise_GetState 快照透出（未配置时侧栏项隐藏）

## 5. 场景设计（v1）

- 园区：地面/道路/绿化/停车场（带停车位线与几辆 lowpoly 车）；主楼体量 + 各部门开放式区域（工位桌椅、部门标牌），「去某部门找人」= 走到对应区域
- 化身：lowpoly 小人（分色区分部门），头顶名字牌（Sprite）；WASD/方向键移动 + 点击寻路（v1 可只做 WASD）
- 聊天：头顶气泡（near 范围 ~8m）+ 侧栏消息列表（全体频道）；Enter 聚焦输入
- 美术基调：明快白天，flat-shading lowpoly，无需贴图依赖（纯顶点色/材质色）

## 6. 里程碑

| 阶段 | 内容 | 出口 |
|---|---|---|
| W1 | world 服务（WS/心跳/档案/静态托管）+ Three.js 前端骨架（园区地面+化身移动+位置同步+名牌）+ 客户端入口（侧栏/设置开关/webview/心跳/world_url 契约） | 两台客户端同时进入互见移动，心跳在线名单出数 |
| W2 | 主楼与部门区域+工位坐姿化身（在线不在场者）+ 文字聊天（near/all）+ 停车场与周边环境 | 找人语义可用：看到某同事在哪个部门、走近聊天 |
| W3 | 部署 world 服务到 66.12:8788 + Nginx/直连验证 + 内测发包（tjad.5）+ 指南 | 内测可用；企微扫码登录留接口（profile 来源可切换） |

## 7. 明确不做（一期）

语音、共享物件/白板、多房间/分区、移动端、室内精细楼层导航（用开放区域表达部门）、企微扫码登录（留 profile 切换接口）、世界内编辑器。
