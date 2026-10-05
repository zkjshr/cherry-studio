# TJADKnows 企业版 PRD —— 基于 Cherry Studio 的企业 AI 工作台

- 日期：2026-10-03
- 状态：已评审（4 项核心决策已由用户确认，见 §2）
- 前置调研：Cherry Studio 企业版官方文档 97 页已抓全，归档于 `docs/research/cherry-enterprise-docs/`
- 关联：`desktop/gateway/`（现有 FastAPI 网关，将被扩展为配置服务端）；WeKnora（10.137.200.58:8091）

---

## 1. 背景与目标

### 1.1 背景

TJADKnows 前期自研了 Tauri 桌面端（M1 检索 Launcher / M1b 收纳层 / M2 桌宠，均已交付）。2026-10-03 用户决定调整方向：**放弃自研客户端演进，改用开源 Cherry Studio（v2.1.4，Electron + React pnpm monorepo）作为客户端底座**，对标"豆包工作"形态，在其上补齐企业能力。

选 Cherry Studio 的理由：成熟的对话/助手/智能体/MCP/多模型底座（约 40 万行 TS，社区活跃），我们只需补"企业管控"这一层，不再重复造客户端。

### 1.2 调研结论（决定架构的三个事实）

1. **官方企业版全套闭源**：服务端（Docker Compose：API :3670 + Admin Web :3680 + PostgreSQL，JWT/Casdoor SSO）与客户端 fork 均不开源；开源 v2.1.4 源码中无任何私有化对接代码（已验证）。→ "纯自建服务端让开源客户端直连"不成立，客户端必须 fork。
2. **官方提供体验环境可逆向**：admin.demo.cherry-ai.com（admin/password）、api.demo.cherry-ai.com（user/password）。一期不走此路线，但保留作二期参考。
3. **官方企业版知识库是其自带 RAG**；我们的核心资产是 WeKnora（44 库、16,767 文档）。→ 自建路线必须把 WeKnora 作为一等公民接入。

### 1.3 目标（一期）

- 每台客户端**启动后自动连接管理后台，拉取并生效最新配置**（用户无需手工配置任何模型/密钥/助手/MCP）。
- 管理员在 Web 管理后台维护**核心下发五件套**：模型服务商、默认模型、助手、MCP 服务器、小程序 + WeKnora 知识库入口。
- 模型 API Key **只存服务端**，客户端一律经网关代理访问模型（零密钥落地）。

## 2. 已确认的决策

| # | 决策 | 结论 |
|---|------|------|
| D1 | 技术路线 | **B：fork 开源客户端 + 自研轻量配置服务**（不做官方协议兼容；逆向参考后置） |
| D2 | 用户体系 | **一期不做登录**，全员同配置；服务端下发统一访问令牌保护配置接口；用户/分组/配额后置二期 |
| D3 | 后台范围 | **核心下发五件套**：①模型服务商与默认模型 ②助手 ③MCP 服务器 ④小程序 ⑤WeKnora 知识库入口 |
| D4 | 密钥下发 | **统一走网关代理**：客户端只拿到网关地址+令牌，对话流量经网关转发到真实上游；API Key 永不下发 |

## 3. 用户故事

- **普通员工**：拿到安装包，装上即用——打开就是所里配好的模型、助手、知识问答；不需要知道任何 API Key。
- **管理员**：登录管理后台 Web，改一个默认模型 / 新增一个助手 / 换一个 MCP 地址，点"发布"；全员客户端在下次启动（或手动"同步配置"）后自动生效。
- **管理员（知识库）**：在后台维护 WeKnora 知识库入口清单（哪些库、什么顺序），员工客户端的"知识助手"自动可用。

## 4. 总体架构

```
┌─────────────────────────── 员工电脑 ───────────────────────────┐
│  Cherry Studio fork（企业版客户端）                              │
│  ├─ 启动 → 企业配置模块：GET config-server /api/client/config    │
│  │         （带 client token + 本地配置版本号，增量判断）          │
│  ├─ 对话/助手/智能体 ──→ 网关 /v1/chat/completions（OpenAI 兼容） │
│  ├─ MCP：WeKnora MCP server（检索/问答工具）等由配置下发           │
│  └─ 小程序（iframe）：WeKnora Web、EKP 等内网应用                 │
└────────────────────────────────────────────────────────────────┘
            │ HTTPS（内网）                    │ SSE / REST
┌───────────┴──────────────────────────────────┴───────────────┐
│  配置服务端（扩展现有 gateway，FastAPI，192.168.66.12:8787）      │
│  ├─ /api/client/config   配置下发（token 校验 + ETag/版本增量）   │
│  ├─ /v1/chat/completions 模型代理（已有，补 /v1/models + 上游路由）│
│  ├─ /admin/*             管理后台 API + 静态管理页面             │
│  └─ 配置存储：SQLite（配置版本化，发布即快照）                     │
│  └─ 上游密钥库：环境变量/本地 secret 文件，永不出网关               │
└──────────────────────────────────────────────────────────────┘
            │                          │
       大模型上游（ollama/云端 API）    WeKnora（10.137.200.58:8091，X-API-Key 仅存服务端）
```

**要点**：
- 配置服务端不是从零建：现有 gateway 已有 `/v1/chat/completions`（stream/非 stream、SSE RAG 编排、`select_kb_ids` 部门库选择），一期扩展配置存储与管理界面。
- 客户端 fork 保持**最小侵入**：企业配置模块独立目录（如 `src/enterprise/`），对上游的改动收敛为少量接入点，便于跟上游更新。

## 5. 功能需求

### F1 客户端企业配置模块（fork 改造核心）

| 项 | 需求 |
|---|---|
| F1.1 启动拉取 | 应用启动后（主进程 ready 即可，不阻塞 UI）异步拉取 `GET /api/client/config`，携带 `X-Client-Token` 与本地已生效的 `config_version`；服务端 304/200 返回 |
| F1.2 配置生效 | 拉取成功后合并进客户端状态：服务商（仅网关代理型）、默认模型、助手列表、MCP 服务器、小程序；持久化本地；**下次启动仍离线可用**（最后一份配置缓存） |
| F1.3 托管标记 | 下发的配置项带 `managed: true` 标记：客户端设置页对托管项只读（或标"由企业管理"），用户可另建个人项，但托管项不可改密钥/删除 |
| F1.4 手动同步 | 设置页提供"同步企业配置"按钮 + 同步状态（成功时间/版本号/失败原因） |
| F1.5 服务端地址配置 | 首次运行的引导：填配置服务端地址 + 访问令牌（或安装包内置默认值，内测期可直接内置）；支持修改 |
| F1.6 失败降级 | 拉取失败（离线/令牌错/服务端挂）：沿用本地最后一份有效配置，托盘/设置页提示，不阻塞使用 |

**验收**：改后台配置→发布→重启客户端（或点同步）→ 新配置生效；断网时客户端仍可用上一份配置。

### F2 管理后台（五件套）

Web 管理界面（挂在 gateway 下 `/admin/`，一期服务端渲染或轻量 SPA + 管理员口令登录）：

| 模块 | 需求 |
|---|---|
| F2.1 模型服务商 | 维护"代理型服务商"：名称、网关路由前缀（如 `gw-qwen`）、真实上游（base_url、api_key、协议类型 openai-compatible/ollama）、可用模型清单（model_id → 显示名、是否默认可见）；支持连通性测试 |
| F2.2 默认模型 | 默认助手模型 / 话题命名模型 / 翻译模型（从已配置模型中选） |
| F2.3 助手管理 | 助手 CRUD：名称、头像、提示词、绑定模型（可指定代理模型）、绑定 MCP 工具、排序与启停 |
| F2.4 MCP 服务器 | MCP server 清单：名称、传输类型（sse/http）、URL、启用；内置 WeKnora MCP server 条目 |
| F2.5 小程序 | 名称、图标、URL、打开方式（侧边栏 iframe）、启停；默认预置 WeKnora Web |
| F2.6 知识库入口 | WeKnora 库清单维护：从 WeKnora API 拉取库列表，勾选开放范围 + 排序；驱动网关 `select_kb_ids` 的默认集与"知识助手"的检索范围 |
| F2.7 发布与版本 | 配置草稿 → "发布"生成新版本号（单调递增）；保留最近 N 个版本快照，可回滚 |
| F2.8 客户端下载 | 关于页：各平台安装包下载链接（内测期指向 NAS/Gitea release） |

**验收**：非开发者能独立完成"新增一个助手并发布"全流程。

### F3 网关模型代理（扩展现有 openai_compat）

| 项 | 需求 |
|---|---|
| F3.1 多上游路由 | 按服务商路由：`/v1/chat/completions` 按 model 前缀/映射表转发到真实上游（一期上游：ollama@192.168.66.25 + 1 个云端 API）；stream 透传 |
| F3.2 模型列表 | `GET /v1/models` 返回后台配置的可见模型（客户端模型选择器数据源） |
| F3.3 令牌校验 | 客户端令牌校验（一期全局 token，二期升级用户级）；拒绝无令牌请求 |
| F3.4 用量记录 | 每次调用记录：时间、model、token 用量（上游 usage 字段）、耗时 → SQLite，供后台简单用量页（一期仅汇总展示，不做配额） |
| F3.5 RAG 编排保留 | 现有 SSE 知识库检索编排（sources 尾注等）保留为"知识助手"专用路由/参数 |

### F4 WeKnora 知识库入口（一期形态）

| 项 | 需求 |
|---|---|
| F4.1 知识助手 | 预置助手"所里知识助手"：提示词引导其通过 WeKnora MCP 工具检索后再回答，回答附来源 |
| F4.2 WeKnora MCP server | 新建 WeKnora MCP（路线第二步，本 PRD 的前置依赖之一）：工具至少含 `search(query, kb_ids?, recent?)`（标题快检+语义深检）、`list_knowledge_bases()`；鉴权走服务端环境变量 |
| F4.3 WeKnora Web 入口 | 小程序 iframe 预置 WeKnora Web（需在 WeKnora 侧配 embed 白名单，见 weknora ops 笔记） |

### F5 非功能需求

- **兼容性**：Cherry Studio（Electron）官方要求 Windows 10+ / macOS 10.15+。**原 M1 路线"支持 Win7"的约束在本路线下不再满足**——若仍有 Win7 人群，继续用旧 M1 launcher 或浏览器版入口，需在试点名单里确认 Win7 占比后再定（风险项 R1）。
- **性能**：配置拉取 < 500ms（局域网）；配置变更到全端生效 = 客户端下次启动/手动同步（一期不做推送长连接）。
- **安全**：上游 API Key 仅存服务端（环境变量/secret 文件）；管理后台口令 + 内网访问限制；客户端令牌防外泄（内测期可接受全局 token）。
- **可维护**：fork 的上游合并策略——企业代码收敛在独立目录 + 少量 hook 点，每季度跟一次上游 release。

## 6. 配置下发契约（初稿）

`GET /api/client/config`
- 请求头：`X-Client-Token: <token>`、`If-None-Match: <config_version>`
- 响应 200：

```json
{
  "config_version": 12,
  "providers": [{
    "id": "gw-qwen", "name": "所里·千问(代理)", "managed": true,
    "type": "openai-compatible",
    "base_url": "http://192.168.66.12:8787/v1",
    "api_key": "<client-token>",          // 网关令牌，非真实上游密钥
    "models": [{"id": "qwen3.5-32b", "name": "千问 3.5 32B", "visible": true}]
  }],
  "default_models": {"assistant": "gw-qwen/qwen3.5-32b", "topic_naming": "gw-qwen/qwen3.5-9b", "translate": "gw-qwen/qwen3.5-32b"},
  "assistants": [{"id": "kb-assistant", "name": "所里知识助手", "prompt": "...", "model": "gw-qwen/qwen3.5-32b", "mcp_servers": ["weknora"], "managed": true}],
  "mcp_servers": [{"id": "weknora", "name": "WeKnora 检索", "transport": "sse", "url": "http://192.168.66.12:8787/mcp/weknora", "managed": true}],
  "minapps": [{"id": "weknora-web", "name": "知识库", "url": "http://10.137.200.58:8091", "icon": "...", "managed": true}],
  "kb_entries": {"recent_enabled": true, "kb_ids": ["101-…", "103-…"]}
}
```

- 响应 304：本地版本已最新。客户端持久化最后一份 200 响应体。

## 7. 里程碑

| 阶段 | 内容 | 出口标准 |
|---|---|---|
| **E1 配置链路打通** | fork 分支建立；`/api/client/config` + SQLite 版本化存储；客户端企业配置模块（拉取/缓存/托管标记/降级）；后台最小管理页（手改 JSON 即可发布） | 改 JSON→发布→客户端重启生效；断网降级可用 |
| **E2 五件套 + 代理完善** | 后台结构化编辑五件套；网关 `/v1/models` + 多上游路由 + 用量记录；客户端托管项只读 UI | 管理员全程 UI 操作完成"新增助手+换默认模型"并全员生效 |
| **E3 WeKnora 深度接入** | WeKnora MCP server；知识助手预设；WeKnora Web 小程序（embed 白名单）；简单用量页 | 知识助手端到端问答带来源；用量页出数 |
| **E4 内测发布** | 双平台安装包构建（nsis/dmg）；下载页；10-20 人内测 | 内测反馈收集，崩溃率/同步成功率达标 |

## 8. 风险与开放问题

| # | 风险/问题 | 应对 |
|---|---|---|
| R1 | Electron 不支持 Win7；原 M1 承诺的 Win7 人群在本路线无法覆盖 | 试点名单确认 Win7 占比；必要时 Win7 用户暂用 Web 入口或保留旧 M1 launcher |
| R2 | fork 后上游演进合并成本 | 企业代码独立目录 + hook 点收敛；锁版本跟进（季度节奏） |
| R3 | 全局 token 泄漏（内测期可接受） | 令牌仅内网有效 + 网关限流；二期升级用户级令牌 |
| R4 | WeKnora MCP 依赖 WeKnora 检索 API 稳定性（hybrid-search 不支持 limit 等） | MCP server 侧做归一/截断，已有网关扇出经验可复用 |
| R5 | ollama GPU 争用（192.168.66.25 与 EKP 摘要任务共用） | 上游路由支持权重/备用模型；错峰 |
| R6 | 客户端自动更新（一期不做） | E4 观察内测更新成本，二期评估 electron-updater + 后台版本下发 |

## 9. 明确不做（一期）

- 登录/用户表/分组/配额/个人用量（二期）
- 官方企业版协议兼容（A 路线资产留存：demo 环境可随时逆向）
- 客户端自动更新推送
- 智能体（Agent）下发与技能库（等五件套稳定后评估）
- Web 版客户端
