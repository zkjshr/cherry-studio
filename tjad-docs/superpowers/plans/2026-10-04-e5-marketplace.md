# E5 实施计划：客户端插件市场（企业网关为官方源）

- 日期：2026-10-04；参考 ZCode 插件市场形态（plugin.json + marketplace.json + 官方 CDN + 已装管理），仅参考不照抄
- 仓库：gateway = TJADKnows/desktop（main）；client = cherry-studio（enterprise 分支）
- 核心决策：**市场源 = 企业网关**（管理员策展、内网分发，契合 D2/D3）；公网 skills 市场继续由既有 SkillMarketplaceDialog 承担，两者并存

## 形态映射（ZCode → 本项目）

| ZCode | 本项目 v1 |
|---|---|
| plugin.json（skills/commands/agents/mcpServers 捆绑） | 插件 = `{id,name,version,description,category,icon}` + 组件清单 `skills[]/mcp_servers[]/assistants[]/minapps[]` |
| marketplace.json 官方 CDN 源 | 网关 `GET /marketplace/api/catalog`（目录扫描生成，无状态） |
| 安装到版本化缓存 + 注册表 | 组件分别落入**既有机制**：skill→SkillService zip 安装；mcp→mcpServerService.create；assistant→assistantService.create；minapp→miniAppService.create；插件级安装记录落在客户端本地 JSON |
| 已装管理（启停/更新/卸载） | 市场页"已安装"区：卸载=按记录反向删除组件；更新检测=v1 只比对版本号提示 |

## 插件包格式（gateway 目录约定）

`gateway/data/marketplace/<plugin-id>/`：
- `plugin.json`：
```json
{
  "id": "weknora-toolkit", "name": "WeKnora 工具包", "version": "1.0.0",
  "description": "...", "category": "knowledge|productivity|utilities|other",
  "icon": "relative-or-https-url",
  "skills": [{"name": "weknora-usage", "zip": "payload/weknora-usage.zip", "description": "..."}],
  "mcp_servers": [{"name": "...", "type": "sse|streamableHttp", "base_url": "...", "headers": {}, "command": "", "args": [], "env": {}}],
  "assistants": [{"name": "...", "prompt": "...", "emoji": "✨", "description": "..."}],
  "minapps": [{"id": "...", "name": "...", "url": "https://..."}]
}
```
- `payload/*.zip`：skill 包（zip 内为技能文件夹，含 SKILL.md）
- icon 支持相对路径（由网关 `/marketplace/api/plugins/<id>/icon` 或 `/files/<path>` 提供）与 https 绝对 URL

## Task 1（gateway）：市场目录与文件服务

`gateway/marketplace.py` + app.py 挂载 + 测试：
1. 目录扫描（`MARKETPLACE_DIR` 环境变量覆盖，默认 `gateway/data/marketplace/`，每次请求现扫、不缓存）：
   - `GET /marketplace/api/catalog` → `{"plugins":[{manifest 摘要 + components 计数}]}`（按 name 排序；非法 plugin.json 跳过并在 `warnings` 里列出）
   - `GET /marketplace/api/plugins/{id}` → 完整 manifest（防穿越：id 只允许 `[A-Za-z0-9_-]`）
   - `GET /marketplace/api/plugins/{id}/files/{path:path}` → 插件目录内文件下发（zip/icon 等；`..` 拒绝；Content-Type 按 zip/png/svg/json 推断）
2. 鉴权：**X-Client-Token**（复用 enterprise `_token_matches` 语义；无 token 环境放行，与客户端管线一致）
3. 管理端：`GET /admin/api/marketplace` → `{plugins:[{id,valid,error?}], dir}` 供管理员核对；上传仍走 scp（与 downloads 同范式，文档注明）
4. 测试：catalog 扫描（正常/非法 manifest/空目录）、id 防穿越、文件下发（zip 字节一致、404）、token 语义

## Task 2（client）：市场页 + 安装机制对接

### 2a. 主进程（src/main/marketplace/ 新目录）
1. `marketplaceService.ts`（lifecycle service 或纯模块 + IPC）：
   - `getCatalog()`：读 enterpriseSettings serverUrl + token（disabled 时返回 `{plugins:[], source:'none'}`），`net.fetch /marketplace/api/catalog`
   - `getPluginDetail(id)`、`installPlugin(id)`、`getInstalled()`、`uninstallPlugin(id)`
   - 安装流程（幂等）：取 manifest → 逐组件：
     - skills：下载 zip（net.fetch → tmp 文件）→ 复用 SkillService 的 zip 安装内部路径（若 `skill.install_from_zip` 只收用户路径，则新增内部调用同函数；source 记 'marketplace'，sourceUrl 记插件文件 URL）
     - mcp_servers：mcpServerService.create（installSource 用现有枚举 'manual'，registryUrl 记 `/marketplace/api/plugins/<id>` 作溯源；重装按 name 幂等 update）
     - assistants：assistantService.create（重装按 name 匹配跳过/更新）
     - minapps：miniAppService.create（appId = `market-<pluginId>-<id>`，重装幂等）
   - 安装记录：`{userData}/Data/marketplace/installed.json`（原子写，模式同 enterpriseSettings）：`[{pluginId, version, installedAt, refs:{skillFolderNames[], mcpIds[], assistantIds[], minappAppIds[]}}]`
   - 卸载：按 refs 反向删除（skill.uninstall 既有服务 / 各 service delete），再移除记录；失败组件逐项报告不中断
2. IPC：`market_get_catalog | market_get_installed | market_install | market_uninstall`（handleGuarded，遵循现有命名）+ preload 桥（照 enterprise 桥模式）
3. 测试：纯函数（manifest 解析校验、refs 记录构建、幂等合并）vitest；网络与 DB 服务不集成测

### 2b. 渲染层（市场页）
1. 路由：`src/renderer/routes/app/market.tsx`（沿用 app 下其他页写法）+ `SIDEBAR_APP_DEFINITIONS` 增加 `market` 项（图标用 lucide 现成 `Store`，名称走 i18n `sidebar.market`，zh=「市场」en="Market"，13 语言包同步）+ Launchpad tile 自动跟随
2. 页面结构（对齐 resourceCatalog 视觉）：卡片网格（icon/name/version/description/category 标签/组件计数徽标）→ 详情面板（组件清单逐项列出）→ 「安装」按钮（loading/成功/失败 toast）→ 顶部「已安装」区（列表 + 卸载两段式确认，无 confirm()）
3. 非企业模式（serverUrl 无效）：页面显示引导文案（"由企业管理员配置插件源"），不报错白屏
4. i18n 13 语言包同步新增键；企业托管项不受影响（市场装的都是用户级）

### 2c. 验收
- 网关侧放一个样例插件（Task 4 联调时造）：含 1 skill zip + 1 assistant
- 客户端：市场页可见插件 → 安装 → 技能出现在 设置→技能、助手出现在助手列表 → 已安装区可见 → 卸载后两者消失
- typecheck/eslint/vitest 全绿；不碰 enterprise 托管守卫逻辑

## Task 3（评审+修复波）：两仓各一轮 spec 评审 + 修复

## Task 4（联调+发布）：服务器造样例插件 → 客户端 dev 全流程 → 生产三包重打 tjad.4 上服务器（沿用 GHA + par_dl）→ 台账/记忆/推送

## 全局约束
- 密钥/令牌红线不变；客户端企业代码守卫不回退；所有新 IPC/路由风格对齐上游
- gateway pytest 全绿；client typecheck/eslint/vitest 全绿

---

## 执行日志（2026-10-04，当日完成）

- Task 1（gateway 8bd3d08 + 7ee4934 featured 透传）：marketplace.py 174 行 + 11 测试，74 pytest 绿。**注意：desktop 仓库已被用户移入 archive/desktop-tauri/（Tauri 应用归档），gateway 活代码随迁；生产部署不受影响，长期落位待用户定**
- Task 2（client 8707e6be45 + 修复波 78b18471b0）：第一轮代理超时留 877 行主进程代码，重派代理复用补全；入口=侧栏 knowledge 正下方（用户指定，非独立页尾）；UI 按 ZCode 风格（已装条/推荐区/分类块/详情弹层）。修复波解决评审 1C+2M+4M：托管助手守卫（市场装/卸都不碰 managed ids）、MCP 溯源隔离（registryUrl 不匹配则 `[市场 <pluginId>]` 消歧名）、图标主进程带 token 取回转 data URL（修 <img> 401）、部分失败 toast/记录保留/技能 sourceUrl 所有权/助手翻页匹配
- 验证：client vitest 89+144 绿、typecheck 0、eslint 0；gateway 74 绿
- 生产联调：marketplace.py 部署服务器重启；样例插件 weknora-toolkit（1 skill zip + 1 assistant + featured/icon）上架，catalog/detail/files 鉴权下发全通；客户端 dev 启动正常待用户点验市场页
- 上架流程（管理员）：插件目录放 ~/tjad-gateway/gateway/data/marketplace/<id>/（plugin.json + payload/），scp 即上架，/admin/api/marketplace 可核对
