# E2+E3 实施计划：管理后台结构化 + 客户端托管 UI + 模型路由 + WeKnora MCP

- 日期：2026-10-03；前置：E1 已完成（见 2026-10-03-e1-enterprise-config-pipeline.md）
- PRD：docs/superpowers/specs/2026-10-03-cherry-enterprise-prd.md §5 F1.3/F1.4/F2/F3/F4
- 仓库：gateway = TJADKnows/desktop（main）；client = cherry-studio（enterprise 分支）
- 目标模式：连续执行不经用户确认；每任务实现→评审→修复→提交推送

## 预检结论（2026-10-03 实测）

- WeKnora（10.137.200.58:8091）响应带 `X-Frame-Options: SAMEORIGIN` → 客户端小程序 iframe 直连必被拦，**反向代理剥离帧头为硬需求**。
- mcp SDK：v1 API（`from mcp.server.fastmcp import FastMCP`）钉版 `mcp<2`（已装 1.30.0，requirements.txt 已归位运行时段）。
- openai_compat.py 现状：RAG 编排（WeKnora 检索+ollama 生成+来源尾注）内嵌在 `/v1/chat/completions`；E2 起该端点改为纯模型代理，RAG 挪到 `/v1/kb/chat/completions`。

## 全局契约（两个仓库共同遵守）

### gateway 数据模型（同 enterprise.sqlite3，新增表）

```sql
upstreams(id TEXT PRIMARY KEY, name TEXT NOT NULL, protocol TEXT NOT NULL CHECK(protocol IN ('openai','ollama')),
          base_url TEXT NOT NULL, api_key TEXT NOT NULL DEFAULT '', enabled INTEGER NOT NULL DEFAULT 1,
          models TEXT NOT NULL DEFAULT '[]',        -- JSON: [{"id","name"?,"visible":bool}...]
          updated_at TEXT)
admin_settings(key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT)  -- value JSON；键：public_base_url / default_models / kb_entries
admin_assistants(id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, prompt TEXT DEFAULT '', emoji TEXT DEFAULT '✨',
                 description TEXT DEFAULT '', model_ref TEXT DEFAULT '',        -- "{upstream_id}/{model_id}"
                 settings TEXT DEFAULT '{}', mcp_names TEXT DEFAULT '[]', updated_at TEXT)
admin_mcp_servers(name TEXT PRIMARY KEY, type TEXT NOT NULL DEFAULT 'sse',
                  base_url TEXT DEFAULT '', headers TEXT DEFAULT '{}', is_active INTEGER DEFAULT 1, updated_at TEXT)
admin_minapps(id TEXT PRIMARY KEY, name TEXT NOT NULL, url TEXT NOT NULL, updated_at TEXT)
usage_log(id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT NOT NULL, model TEXT NOT NULL, upstream_id TEXT,
          prompt_tokens INTEGER, completion_tokens INTEGER, total_tokens INTEGER, duration_ms INTEGER, status TEXT)
```
- `config_versions` 沿用 E1（存**组合后的客户端配置**快照）；`config_draft` 废弃（结构化编辑取代"草稿"）。
- admin_settings 键语义：`public_base_url`（默认 `http://127.0.0.1:8787`，部署时改 LAN 地址）；`default_models` = `{"assistant":"{upstream_id}/{model_id}","translate":...,"quick_model":...}`；`kb_entries` = `{"recent_enabled":bool,"kb_ids":[...]}` 原样透传客户端。

### 发布组合（POST /admin/api/publish）

组合客户端配置（契约与 E1 客户端兼容，新增 mcp headers 字段）：
```json
{
  "providers": [{"id":"gateway","name":"所里模型网关","base_url":"{public_base_url}/v1",
                 "api_key":"<GATEWAY_TOKEN>","models":[{"id":"{upstream_id}/{model_id}","name":"..."}]}],
  "default_models": {"assistant":"gateway/{upstream_id}/{model_id}", ...},
  "assistants": [{"name","prompt","emoji","description","model":"gateway/{model_ref}","settings","mcp_server_ids":[mcp名称...],"managed":true}],
  "mcp_servers": [{"name","type","base_url","headers":{...},"is_active":true}],
  "minapps": [{"id","name","url"}],
  "kb_entries": {...}
}
```
- 组合校验：default_models 引用的模型必须存在且 visible；assistants.model_ref 必须存在；mcp_server_ids 必须在 mcp_servers 中；违反 → 400 带明细，不落版本。
- 仅 enabled=1 的上游进入 providers.models。
- 回滚（POST /admin/api/publish/rollback {version}）= 把历史版本快照重发为新版本（客户端可见回滚；不反解回结构化状态，文档注明）。

### 模型路由代理（/v1/chat/completions 重写）

- model 解析 `{upstream_id}/{model_id}`（首个 "/" 分隔）；未知 upstream/model → OpenAI 错误格式 404：`{"error":{"message":"model not found: ...","type":"invalid_request_error"}}`。
- openai 上游：POST `{base_url}/chat/completions`，model 换成裸 model_id，api_key 非空则 `Authorization: Bearer`；stream=SSE 透传（httpx stream），非 stream=JSON 透传。
- ollama 上游：POST `{base_url}/api/chat`（`{model, messages, stream}`）；NDJSON→OpenAI chunk 转换复用 `chat.extract_ollama_delta` 思路；非 stream 聚合为一份 OpenAI completion。
- `GET /v1/models`：`{"object":"list","data":[{"id":"{upstream_id}/{model_id}","object":"model"}...]}`（require_token 鉴权）。
- RAG 编排原样迁到 `POST /v1/kb/chat/completions`（同鉴权，原测试随迁）。
- 用量记录：每次调用写 usage_log——duration 恒记；tokens：openai 从响应/末 chunk 的 usage 抽，ollama 从末行 `prompt_eval_count`/`eval_count` 抽，抽不到记 0；status='ok'/'error'。

### 管理端 API（X-Admin-Token，全部 JSON）

- `GET/PUT/DELETE /admin/api/upstreams[/{id}]`（PUT 全量 upsert；校验 protocol/base_url/models 结构；DELETE 有 assistants.model_ref 引用时 409）
- `POST /admin/api/upstreams/{id}/test` → `{ok, latency_ms, detail}`（openai: GET {base_url}/models；ollama: GET {base_url}/api/tags；超时 5s）
- `GET/PUT /admin/api/settings`（三键整体读写；PUT 校验结构）
- `GET/PUT/DELETE /admin/api/assistants[/{id}]`、`/admin/api/mcp-servers[/{name}]`、`/admin/api/minapps[/{id}]`
- `POST /admin/api/publish` → `{version}`；`POST /admin/api/publish/rollback` `{version}` → `{version}`；`GET /admin/api/published`（latest+versions，E1 admin_get_config 演化）
- `GET /admin/api/usage/summary?days=30` → `{"days":N,"total_calls","total_tokens","by_model":[{model,calls,tokens}],"by_day":[{day,calls,tokens}]}`
- 客户端端点 `GET /api/client/config` **不变**；E1 的 PUT draft / publish-draft 端点删除（测试同步改写）

### 客户端契约变更（唯一）

- `mcp_servers[].headers`（`Record<string,string>`）透传到 McpServerService 的 headers 列（列已存在）。

---

## Task 1（gateway）：上游注册表 + 发布组合 + 模型路由代理 + 用量记录

按全局契约实现 `gateway/enterprise.py` 扩展 + `gateway/model_proxy.py`（新文件）+ app.py 挂载 + 测试改写：
1. enterprise.py：新表 DDL + upstreams/settings/assistants/mcp/minapps CRUD API + publish 组合/回滚 + usage summary + 删除 draft 端点；连接建表迁移放 `_connect()`（幂等 CREATE IF NOT EXISTS，老库自动补表）
2. model_proxy.py：`/v1/chat/completions` 重写为路由代理（stream/非 stream、openai/ollama 双协议、OpenAI 错误格式）、`/v1/models`、usage 记录
3. openai_compat.py：RAG 端点迁 `/v1/kb/chat/completions`（逻辑不动，路由与 docstring 改），删除其 `/v1/chat/completions` 与 `/v1/models`（如有）
4. 测试：respx 模拟 openai 上游（stream+非 stream+usage 抽取+错误透传）、ollama 上游（NDJSON→SSE、usage）、404 未知模型、组合校验 400 各分支、CRUD 全套、回滚、usage summary；全部 pytest 绿（现 31 条中的 draft 用例改写为结构化 publish 用例）
5. 约束：与 E1 相同的 token 语义（client=_token_matches、admin 拒空 token）；不做 Jinja2；管理页 v2 由 Task 2 做，本任务保证 API 完备即可

## Task 2（gateway）：管理页 v2（结构化五件套 UI）

`_ADMIN_HTML` 重写为标签页 SPA（vanilla JS 单文件，无构建依赖）：
- 标签：上游与模型 / 默认模型 / 助手 / MCP / 小程序 / 知识库 / 用量 / 版本；顶栏常驻：版本号 + 「发布」按钮 + token 输入行（沿用 localStorage 模式，无 prompt/alert）
- 上游 tab：表格（id/名称/协议/base_url/启用/模型数）+ 编辑表单（模型行内编辑：id/名称/可见 checkbox，增删行）+ 「测试连通」按钮显示结果
- 默认模型 tab：三个下拉（assistant/translate/quick_model），选项来自全部上游 visible 模型（`{upstream_id}/{model_id}`）
- 助手 tab：表格+表单（name/prompt/emoji/model 下拉/mcp 多选）；MCP tab：表格+表单（name/type/base_url/headers JSON/启用）；小程序 tab：表格+表单
- 知识库 tab：调 `GET /api/kbs`（X-Client-Token）列出库，勾选 → kb_entries.kb_ids；recent_enabled 开关
- 用量 tab：GET usage/summary 渲染总量 + 按模型表 + 按日条形（div 宽度百分比，无图表库）
- 版本 tab：GET published 渲染版本列表 + 「回滚」按钮（confirm→POST rollback）
- 测试：页面含各 tab 标记字符串；API 行为已在 Task 1 覆盖

## Task 3（client，cherry-studio enterprise 分支）：托管只读 + 同步入口 + headers 契约

1. **契约**：enterpriseConfigTypes.ts 的 `EnterpriseMcpServerConfig` 增加 `headers?: Record<string,string>`；applyEnterpriseConfig 透传到 mcpServerService create/update（列已存在，验证字段名）
2. **applier 记录托管助手 id**：apply 后把 managed=true 的助手 UUID 收集，随 kb_entries 一起直插 preference 键 `enterprise.managed_assistant_ids`（JSON 数组；复用现有 preference 直插 helper）
3. **IPC**：IpcChannel 增 `Enterprise_Sync` / `Enterprise_GetState`（找 src/shared 下 IpcChannel 定义处，遵循现有命名风格）；src/main/ipc.ts registerIpc 用 handleGuarded 注册：sync → enterpriseConfigService.syncOnce()（在途去重，返回 {ok, state}）；getState → {enabled, lastAppliedVersion, lastSyncedAt, lastError, managedProviderIds, managedAssistantIds, managedMcpNames}（providerIds=查询 user_provider 前缀 enterprise-；assistantIds=读 preference 键；mcpNames=查 mcp_server name 前缀 `[企业] `）
4. **设置页「企业管理」卡片**：通用/其他设置页（实现者选最不打扰的位置）加卡片：状态行（版本/时间或错误）+「立即同步」按钮（调 Enterprise_Sync，结果显示）；i18n zh-CN + en-US 两语言文件都加
5. **托管只读守卫**（按前缀判定，动作级隐藏+徽标，不做逐字段禁用）：
   - ProviderSettings 列表：providerId 前缀 `enterprise-` → 隐藏编辑/删除入口 + 「企业」徽标
   - 助手页：id ∈ managedAssistantIds → 同上
   - McpSettings 列表：name 前缀 `[企业] ` → 同上
   - 小程序管理页：appId 前缀 `enterprise-` → 同上
   - 状态获取：renderer 用 useQuery/轮询 Enterprise_GetState（现有 react-query 基建）
6. **测试**：enterprise 目录新增纯函数单测（前缀判定 helper、headers 透传映射）；vitest 绿 + typecheck 全仓零新增错误
7. 提交推送 enterprise 分支

## Task 4（gateway）：WeKnora MCP server + 反向代理嵌入

1. **MCP server** `gateway/mcp_weknora.py`：FastMCP(name="weknora")，streamable-http；app.mount 前缀 `/mcp/weknora`；ASGI 中间件校验 `X-Client-Token`（复用 _token_matches 语义：空 token 放行）后再进 MCP app；FastAPI lifespan 中运行 session manager（FastMCP v1 要求，参考其 streamable_http 文档模式）
   - 工具 `weknora_search(query, kb_ids?: list[str], recent?: bool) -> str`：kb_ids 缺省 = kb_entries.kb_ids（admin_settings），再缺省 = 全部 `^\d{3}-` 库；并发≤8、单库 6s 预算扇出 hybrid-search（复用/抽取 openai_compat._retrieve 的检索与归一逻辑为共享函数，避免复制粘贴）；输出 `N. title（kb_name）：摘要片段` 列表（截 8 条）
   - 工具 `weknora_list_kbs() -> str`：`id 名称` 列表
2. **反向代理** `gateway/weknora_proxy.py`：`/proxy/weknora/{path:path}` 全方法转发到 `WEKNORA_BASE_URL`（默认 http://10.137.200.58:8091），剥离响应头 `x-frame-options` 与含 `frame-ancestors` 的 CSP；query 原样；流式透传；client-config 里的 minapp url 用 `{public_base_url}/proxy/weknora/`（组合时若检测到 weknora 域名可自动改写？——不搞魔法，由管理员在后台填代理地址）
3. **测试**：MCP——uvicorn 随机端口 fixture 起真服务，mcp python 客户端 list_tools + 调 weknora_list_kbs（respx 拦 WeKnora HTTP）；鉴权中间件 401 路径；代理——respx 模拟上游带 x-frame-options，断言剥离与 body/query 透传
4. app.py 挂载两个新路由 + lifespan

## Task 5：端到端联调（controller 亲自做）

1. gateway 8787 起真实服务：后台建 ollama 上游（192.168.66.25:11434，若不可达用本地 mock 上游）→ 建助手/MCP/小程序/知识库 → 发布 v2 → /api/client/config 验证组合产物
2. 客户端 env 起 dev：注入验证 + 设置页企业管理卡片截图级验证（日志）+ /v1/models 可见 + 对注入模型发起 chat completion 走上游 + usage_log 出行 + usage summary 出数
3. MCP：python 客户端连 http://127.0.0.1:8787/mcp/weknora list_tools + weknora_list_kbs 真实 WeKnora
4. 代理：curl http://127.0.0.1:8787/proxy/weknora/ 断言无 x-frame-options
5. 降级/304 回归（E1 用例快速重放）
6. 台账：计划文档执行日志 + ACCEPTANCE.md + 记忆 + 推送双仓

## 全局约束

- gateway：pytest 全绿方可提交；风格对齐现有模块（中文模块 docstring、窄函数）；token 语义与 E1 一致
- client：只碰 src/main/enterprise/**、src/shared/IpcChannel*、src/main/ipc.ts、设置页/i18n 必要文件；typecheck 零新增错误；vitest 绿
- 每任务一个 commit；通过评审与修复后才推送
- 密钥红线：上游真实 api_key 只进 upstreams 表（服务端）；组合配置中一律 GATEWAY_TOKEN

---

## 执行日志（2026-10-03，goal 模式连续执行，全部完成）

**实现/评审/修复记录（每任务=实现代理→评审代理→修复）**
- Task 1 gateway 核心（fe20b0f）：结构化管理 API + 发布组合 + 模型路由代理 + 用量记录；评审 PASS（2 Minor：断流记账已修 2c33252；publish 组合锁粒度按评审意见暂缓，单管理员场景无实际影响）。
- Task 3 client 托管 UI（48caf97688）：headers 契约 + managed_assistant_ids + Enterprise_Sync/GetState IPC + 通用设置卡片 + 四面只读守卫；评审 FIX_REQUIRED（资源目录可删托管助手、MCP 详情 Save 未锁 2 Major + 3 Minor）→ 修复波 cebb2b1881 → 验证 PASS（1663 测试绿）。
- Task 4 WeKnora MCP + 代理（48ab641）：FastMCP v1 streamable-http @ /mcp/weknora + token 中间件 + kb_search 共享检索核心 + /proxy/weknora 反代；安全评审 FIX_REQUIRED（1 Major：3xx Location 指回源站使 iframe 白屏；6 Minor）→ 内联修复 fbfc917（Location 改写/逐跳头/路径重编码/流式请求体/ws scope 403 + 回归测试）。
- Task 2 管理页 v2（5554589）：单文件标签页 SPA（8 tab），webview 安全（无 prompt/alert/confirm，两段式确认），node --check + html.parser + 真 API 冒烟全过；62 pytest 绿。
- E2E 插曲修复（7ce1a45）：weknora_search query 改可选 + 空 query 引导（MCP 真连时发现）。

**端到端联调（真环境，2026-10-04 凌晨）**
- 结构化 API 灌配置（ollama 上游连通测试 39ms→发布 v1）→ 组合产物逐字段核对契约 → 客户端 v2 注入：provider enterprise-gateway+2 模型、默认模型三键、所里知识助手（managed id 落库）、[企业] WeKnora 检索（streamableHttp + X-Client-Token headers）、小程序指向 /proxy/weknora/。
- 模型路由：/v1/models 两模型；真实 ollama qwen3.5:9b 对话成功（usage 1010 tokens 记账）；未知模型 OpenAI 404 格式；usage summary 出数。
- MCP：真客户端 list_tools/调用通过；weknora_list_kbs 54 库真实返回；**hybrid-search 挂起为 WeKnora 侧 GPU 争用**（wiki 回填跑在同卡上，PRD R5 应验；health/recent 接口秒回，代码正确降级 unavailable；recent=True 路径真实命中 8 条文档）。回填结束后语义检索即恢复。
- 代理：/proxy/weknora/ 200 且无 x-frame-options。
- 已知行为：客户端版本号比对仅数值（换库/回档后需 publish 一次新版本强制刷新）；E1 旧托管行（enterprise-gw-main）留在客户端，配置不再包含时不会自动清除（二期可在 applier 里做孤儿清理）。
- 推送：gateway 69f327a..7ce1a45 → NAS main；client 78e626e..cebb2b1881 → GitHub enterprise。

**遗留（不阻塞，二期候选）**：publish 组合锁粒度；托管孤儿行清理；客户端自动更新；E4 内测发包（nsis/dmg 构建）。
