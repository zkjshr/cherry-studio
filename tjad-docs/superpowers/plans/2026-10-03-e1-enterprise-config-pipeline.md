# E1 实施计划：企业配置链路打通（Cherry Studio fork + gateway 配置服务）

- 日期：2026-10-03
- PRD：docs/superpowers/specs/2026-10-03-cherry-enterprise-prd.md（决策 D1-D4 已确认）
- 仓库：客户端 = /Volumes/MacSSD/Library/VibeCoding/cherry-studio（branch `enterprise`，remote origin=zkjshr fork）；服务端 = /Volumes/MacSSD/Library/VibeCoding/TJADKnows/desktop（branch main）
- 出口标准：管理端改 JSON→发布→客户端重启后配置生效；断网/服务端不可达时客户端用本地缓存照常生效；gateway pytest 全绿

## 探索结论（实现必须遵守的事实）

客户端 v2.1.4（`enterprise` 分支）为 SQLite 架构（better-sqlite3 + Drizzle，主进程持有 `<userData>/Data/cherrystudio.sqlite`），**无 Redux**。五种资源的主进程服务（均在 `src/main/data/`）：

- Provider：`services/ProviderService.ts` 单例 `providerService` — `batchUpsertTx`（insert-only，已存在 providerId 会被过滤）、`replaceApiKeys(providerId, keys)`；表 `user_provider`（PK providerId 字符串，`endpointConfigs` JSON 含 baseUrl，`apiKeys` JSON）
- Model：`services/ModelService.ts` 单例 `modelService` — `reconcileForProvider(providerId, {toAdd, toRemove})` 单事务增删；表 `user_model`（PK `"{providerId}::{modelId}"`）
- 默认模型：`preference` 表三键（`src/shared/data/preference/preferenceSchemas.ts`）：`chat.default_model_id`、`feature.translate.model_id`、`feature.quick_assistant.model_id`；**话题命名无独立键，复用 quick model**。写入走 `PreferenceService.set/setMultiple`（或 seeder 式 `preferenceTable` 直插）
- Assistant：`services/AssistantService.ts` — `create(CreateAssistantDto)`（name/prompt/emoji/description/modelId/settings/mcpServerIds/knowledgeBaseIds）、`update(id, dto)`、`delete`；DTO 白名单 `src/shared/data/api/schemas/assistants.ts:40-52`
- MCP：`services/McpServerService.ts` 单例 `mcpServerService` — `create(dto)`（name + type: 'sse'|'streamableHttp' + baseUrl + isActive）、`createMany`、`findByIdOrName`、`update`
- Minapp：`services/MiniAppService.ts` — `create({appId, name, url, logo?})`（appId 字符串 PK 有正则约束）、`update(appId, dto)`、`getByAppId`

启动注入先例：`src/main/data/db/seeding/seederRegistry.ts`（seeder 数组，按 `hashObject(payload)` 判版本，"刷新 preset 字段、保留用户字段"）。网络请求先例：`src/main/services/AppUpdaterService.ts` 的 `fetchReleaseHistory()`——`net.fetch(url, {headers, signal: AbortSignal.timeout(10_000)})`，HTTP 状态+大小校验，`catch → logger.warn → null`。启动钩子：lifecycle service（`@Injectable` + `@ServicePhase(Phase.WhenReady)`，注册进 `src/main/core/application/serviceRegistry.ts` 的 serviceList），`onAllReady()` 内 fire-and-forget。userData 配置目录：`application.getPath('cherry.config')`（= `~/.cherrystudio/config`）。

---

## Task 1: gateway 企业配置存储与下发 API（desktop/ 仓库）

新建 `desktop/gateway/enterprise.py` + app.py 挂路由 + `desktop/gateway/tests/test_enterprise.py`。

1. **存储**（SQLite，`desktop/gateway/data/enterprise.sqlite3`，目录不存在则建）：
   - `config_draft(id INTEGER PK CHECK(id=1), content TEXT NOT NULL, updated_at TEXT)`
   - `config_versions(version INTEGER PRIMARY KEY AUTOINCREMENT, content TEXT NOT NULL, published_at TEXT)`
   - 函数：`get_draft() -> dict|None`、`save_draft(content: str)`（校验 JSON 且为 object，否则 raise ValueError）、`publish() -> tuple[int, dict]`（draft 为空报错；返回新版本号+内容）、`get_latest() -> tuple[int, dict]|None`、`list_versions() -> list[tuple[int, str]]`
   - 模块级单例 + 线程锁（uvicorn 默认单进程可接受）；`init_db()` 幂等
2. **客户端下发** `GET /api/client/config`：
   - 校验请求头 `X-Client-Token` 等于配置 token（沿用现有 GATEWAY_TOKEN 环境变量读取方式），失败 401
   - 无版本 → 404 `{"detail": "no config published"}`
   - 请求头 `If-None-Match: "<version>"`（带引号）等于最新版本 → 304 空体
   - 否则 200：body = `{**latest_content, "config_version": version}`，响应头 `ETag: "<version>"`、`Cache-Control: no-cache`
3. **管理端 API**（全部校验请求头 `X-Admin-Token` = 同一 token，失败 401）：
   - `GET /admin/api/config` → `{draft, latest: {version, published_at, content}|null, versions: [...]}`
   - `PUT /admin/api/config/draft`，body 为 JSON object → 存草稿，返回 `{saved: true}`
   - `POST /admin/api/config/publish` → 草稿转新版本，返回 `{version: N}`
4. **管理页** `GET /admin`：单文件内联 HTML（无构建依赖）：textarea + 「加载草稿」「保存草稿」「发布」按钮 + 当前版本显示；JS fetch 带从 `localStorage` 取的 token（首次弹 prompt）；非 2xx 时 alert 错误信息
5. **测试**（pytest，风格对齐 `tests/test_openai_compat.py`，用 httpx AsyncClient/TestClient 直接调 app，不上网）：
   - 无 token 401（client 与 admin 各一）
   - 空发布 400；存草稿→发布→GET 拿到带 config_version 的内容；再次 GET 带 If-None-Match 得 304
   - 草稿存非法 JSON/非 object → 400（经 API 层转译，不 500）
   - 测试间隔离：fixture 里对临时 DB 文件参数化（enterprise.py 的存储路径支持环境变量 `ENTERPRISE_DB_PATH` 覆盖）

## Task 2: 客户端 EnterpriseConfigService（cherry-studio 仓库，enterprise 分支）

新建 `src/main/enterprise/`（独立目录，收敛企业代码）：

1. **配置源** `enterpriseSettings.ts`：读 `application.getPath('cherry.config')/enterprise.json`：`{ enabled: boolean, serverUrl: string, token: string }`；环境变量 `CHERRY_ENTERPRISE_SERVER_URL` / `CHERRY_ENTERPRISE_TOKEN` 可覆盖（dev 用）。文件缺失或 enabled=false → 服务静默闲置（logger.info 一次）。状态（lastAppliedVersion、lastSyncedAt、lastError）持久化到同目录 `enterprise.state.json`（原子写，模式照抄 BootConfigService / `createAtomicWriteStream`）
2. **服务** `EnterpriseConfigService.ts`：`@Injectable('EnterpriseConfigService')` + `@ServicePhase(Phase.WhenReady)`（参考 AppUpdaterService 装饰器与 registerDisposable 清理写法）；`onAllReady()` 内 fire-and-forget 调 `syncOnce()`
3. **syncOnce() 逻辑**：
   - `net.fetch(`${serverUrl}/api/client/config`, { headers: { 'X-Client-Token': token, 'If-None-Match': `"${lastAppliedVersion}"` }, signal: AbortSignal.timeout(10_000) })`
   - 200：校验 JSON 有数值型 `config_version` 且 ≥1 → 原子写缓存 `enterprise.cache.json` → 调 applyEnterpriseConfig（Task 3）→ 成功后更新 state（version/syncedAt，清 lastError）；apply 抛错 → state 记 lastError，缓存已落盘
   - 304：只更新 lastSyncedAt
   - 网络错/超时/5xx：logger.warn + state.lastError；**降级**：若本 boot 尚未应用过配置且缓存文件存在 → 用缓存 apply（标记 appliedFrom: 'cache'）
   - 所有分支绝不抛出到 onAllReady（fire-and-forget 外层 catch logger.error）
4. **注册**：serviceRegistry.ts 的 serviceList 增加 EnterpriseConfigService（放在 AppUpdaterService 附近即可，不依赖其他新服务）
5. **测试**：把决策逻辑抽纯函数 `src/main/enterprise/syncDecider.ts`（输入 {httpStatus, etagVersion, lastAppliedVersion, hasCache, appliedThisBoot} → 输出动作 'apply_remote'|'touch'|'apply_cache'|'idle'），vitest 单测覆盖各分支；放 `src/main/enterprise/__tests__/`

## Task 3: 客户端配置应用器 applyEnterpriseConfig（cherry-studio 仓库）

`src/main/enterprise/applyEnterpriseConfig.ts`，输入 config JSON，幂等可重入：

1. **Providers**：对 `providers[]` 每项：providerId 强制前缀 `enterprise-`（`enterprise-{id}`）；已存在（providerService 查询接口）则 update endpointConfigs.baseUrl 为下发 base_url、`replaceApiKeys` 为下发 api_key（即网关令牌）、isEnabled=true；不存在则 create。**模型**：汇总该项 `models[]` → `modelService.reconcileForProvider(providerId, {toAdd: [...], toRemove: [该 provider 下不在下发清单里的模型]})`（modelId/name/isEnabled 映射）；自建模型行字段按 CreateModelInput 必填集补全
2. **默认模型**：`default_models.assistant/translate/quick_model`（配置契约里 topic_naming 由 quick_model 承载）→ `preferenceService.setMultiple` 写 `chat.default_model_id` / `feature.translate.model_id` / `feature.quick_assistant.model_id`，值格式 `{providerId}::{modelId}` 的 UniqueModelId（与库内 user_model PK 一致；实现时以读取现有 preference 值的实际格式为准，先读一条现有值样本再写）
3. **Assistants**：对 `assistants[]`：按 name 精确匹配已有助手（先 list 全量过滤），命中 → update（prompt/modelId/settings/mcpServerIds），未命中 → create（emoji 缺省 ✨）；配置项带 `managed: true` 时 E1 只做"应用"，禁改守卫留 E2
4. **MCP**：对 `mcp_servers[]`：`findByIdOrName(name)` 命中 → update（type/baseUrl/isActive），未命中 → create（type 用 'streamableHttp' 或配置指定，name 用 `[企业] {name}` 前缀避免撞名）
5. **Minapps**：对 `minapps[]`：appId = `enterprise-{id}`；`getByAppId` 命中 → update url/name/status='enabled'，未命中 → create（校验 appId 正则约束，不合法字符替换为 '-'）
6. **kb_entries**：`preferenceService.set('enterprise.kb_entries', {...})` 原样存储（E3 的 WeKnora MCP 消费，E1 仅落库）
7. **顺序**：providers+models 先行（外键依赖），然后 default_models，再 assistants（依赖 modelId FK 与 mcp id）、mcp、minapps；单服务调用天然事务，失败即抛、由 Task 2 记 lastError
8. **测试**：映射逻辑抽纯函数（providerId/modelId/UniqueModelId/appId 归一与 diff 计算），vitest 覆盖：前缀幂等（重复 apply 不产生重复行）、模型 reconcile diff 正确、非法 appId 清洗

## Task 4: 端到端联调（双仓库，人工可复现脚本）

1. gateway：置 `ENTERPRISE_DB_PATH=/tmp/e1test.sqlite3`，起 uvicorn；用 curl/脚本：PUT 草稿（含 1 个代理 provider 指向本机 gateway /v1、1 助手、1 sse MCP、1 minapp、kb_entries）→ publish → GET /api/client/config 验证 200/304
2. 客户端：`pnpm dev`（electron），env 设 `CHERRY_ENTERPRISE_SERVER_URL=http://127.0.0.1:8787` `CHERRY_ENTERPRISE_TOKEN=<gateway token>`；启动后检查 `~/Library/Application Support/CherryStudio/Data/cherrystudio.sqlite`（dev profile 路径以 CS_DEV_USER_DATA_SUFFIX 实际为准）：user_provider 有 `enterprise-*` 行、user_model 有对应模型、preference 三键已写、assistant/mcp_server/mini_app 就位；主进程日志无 enterprise 错误
3. 降级：停 gateway → 重启客户端 → 配置仍生效（来自 cache），日志出现降级路径记录
4. 台账：执行记录追加到本文件末尾「执行日志」节；ACC 验收条目写 desktop/docs/ACCEPTANCE.md（服务端部分）

## 全局约束

- 客户端所有企业代码只进 `src/main/enterprise/` + 两处注册点（serviceRegistry、必要的环境变量常量），不散改上游文件
- 客户端 TypeScript 风格对齐现有代码（禁 any 滥用、logger 用统一 logger、错误处理照 AppUpdaterService）
- gateway 测试命令：`cd desktop && python -m pytest tests/ -q`；客户端类型检查：`pnpm typecheck`（至少对 src/main 无新增错误）；enterprise 单测：`pnpm vitest run src/main/enterprise`
- 密钥红线：真实上游 API Key 只存 gateway 服务端（.env），配置下发内容里 provider.api_key 一律是网关令牌

---

## 执行日志（2026-10-03，SDD 两波完成）

**实现 wave（并行双子代理）**
- Task 1（gateway，commit b77d857）：enterprise.py（SQLite 草稿/版本存储，259 行）+ 路由挂载 + 管理页 + 8 用例。偏差：测试命令实为 `gateway/.venv/bin/python -m pytest gateway/tests/ -q`；空 GATEWAY_TOKEN 行为对齐现有 auth.py。
- Task 2+3（client，commit c4486dc）：src/main/enterprise/ 九文件 + serviceRegistry 注册。关键核实：默认模型偏好值为纯字符串 UniqueModelId；appId 正则 `^[A-Za-z0-9_-]+$`；ProviderService.create 硬编码 isEnabled:false 需补 update；MiniAppService.getByAppId 抛 NOT_FOUND 需按 DataApiError.code 捕获。偏差：kb_entries 因 PreferenceService.set 对未声明键抛错改直插 preference 表（计划已预留）；apply 顺序 MCP 先于 assistants（FK 依赖）；MCP 幂等匹配逻辑名+前缀名双查。vitest 30/30，typecheck 全仓零错误。

**评审 wave（双评审代理）**：网关 1 Major（NaN/Infinity 草稿可通过→客户端端点 500）+3 Minor；客户端 1 Major（reconcile toRemove 传裸 modelId，模型下架永不生效）+2 Minor（fetch 失败不落 lastError、降级应用记旧版本号）。

**修复 wave（controller 直修）**
- gateway 9f14cb5：save_draft 入库前 `json.dumps(allow_nan=False)` 重序列化；token 比较 secrets.compare_digest；admin 空 token 直接拒绝（不随 auth.py 放行）；If-None-Match 支持列表/*/W/ 弱形式。回归测试 +2（NaN 拒绝且不可发布、304 列表形式）。pytest 31 passed。
- client 78e626e：toRemove 映射 createUniqueModelId(providerId, modelId)；fetch catch 与 idle 分支落盘 lastError；降级应用记录 cached.config_version。vitest 30/30，typecheck 零错误。

**Task 4 端到端联调（全部通过）**
- gateway 8797 + /tmp/e1test.sqlite3：PUT 草稿→publish v1→GET 200（ETag "1"+config_version 合并）→If-None-Match 304。
- 客户端 `pnpm dev`（env CHERRY_ENTERPRISE_SERVER_URL/TOKEN）：EnterpriseConfigService 注册进 lifecycle（69 服务，Phase.WhenReady）；200 路径注入 provider enterprise-gw-main（enabled+api key 1 条）、模型 enterprise-gw-main::test-model、3 个默认模型偏好键、kb_entries、助手 E2E知识助手（modelId FK 正确）、MCP [企业] WeKnora（sse active）、minapp enterprise-weknora-web——sqlite 全量核实通过；渲染层已在消费注入模型（GET /models/enterprise-gw-main::test-model → 200）。
- 二次启动：If-None-Match 命中 → "Enterprise config unchanged (304)"，无重复 apply（幂等）。
- 降级：杀网关后重启客户端 → ERR_CONNECTION_REFUSED 捕获 → "applied from cache (degraded)"，五件套照常生效。
- 教训：macOS 上 pkill -f 匹配 --user-data-dir 漏杀主进程会吃单实例锁（"Another instance holds the lock; exiting"），需 pkill -9 -f "cherry-studio/node_modules/.pnpm/electron" 全清。
- 已推送：desktop main → 9f14cb5（NAS Gitea）；cherry-studio enterprise → 78e626e38f（GitHub fork zkjshr）。
