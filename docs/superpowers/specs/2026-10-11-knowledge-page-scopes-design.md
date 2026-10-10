# 知识库页三分类设计（个人 / 部门 / 公共）

日期：2026-10-11 · 状态：已批准（聊天设计评审通过）

## 背景与目标

知识库页左侧导航目前只渲染本地知识库和用户自建自由分组。参考 ima.copilot 的知识库侧栏（固定分类 + 折叠分区），把导航改为三个固定分区：

- **个人知识库**：现有本地库（自由分组原样保留，嵌套在个人分区内）
- **部门知识库**：来自 WeKnora 的部门共享库
- **公共知识库**：来自 WeKnora 的公共共享库

混合数据来源：个人 = 本地库，部门/公共 = 网关实时查询 WeKnora。本次不做 WeKnora 文档级浏览（点击只读提示），留待下一迭代。

## 现有基建（复用，不新建）

| 能力 | 位置 | 说明 |
|------|------|------|
| WeKnora 库列表 | `gateway/weknora.py` `list_kbs()` | `GET {weknora_base_url}/api/v1/knowledge-bases`，管理 token 鉴权，返回 `[{id, name}]` |
| 部门库命名约定 | `gateway/chat.py` `DEPT_KB_RE` | `^\d{3}-` 前缀 = 部门库 |
| 客户端→网关通道 | `src/main/marketplace/gatewaySkills.ts` | `loadEnterpriseSettings()` → `net.fetch(serverUrl + path, { 'X-Client-Token': token })` |
| 客户端配置链 | `src/main/enterprise/applyEnterpriseConfig.ts` | 本次**不动** `kb_entries`（它只管检索范围） |
| 对话内检索 | `gateway/mcp_weknora.py` | `weknora_search` MCP 工具已存在，点击共享库的"去对话检索"依赖它 |

## 方案

### 网关：1 个新 client 端点

`GET /knowledge/api/kbs`（X-Client-Token 鉴权，语义同 marketplace client 端点）：

- 实时调用 `weknora.list_kbs()`，按 `DEPT_KB_RE` 分类
- 响应：`{"kbs": [{"id": str, "name": str, "scope": "dept" | "public"}]}`
- WeKnora 不可达：返回 `{"kbs": []}`（200，不报错——客户端按空展示，分区留空）
- 部门/公共划分依据命名约定而非管理配置；后续如需显式指定，再扩展 `kb_entries`

### 客户端主进程：1 个 service + IPC

新模块 `src/main/features/knowledge/sharedKbs.ts`（与 `KnowledgeService.ts` 同目录，模式照抄 `gatewaySkills.ts`）：

- `loadEnterpriseSettings()` 未启用 → 返回空数组，不发请求
- `net.fetch` + zod schema 校验响应；网关不可达/响应非法 → 空数组 + 日志
- 通过 IPC（`src/shared/ipc/schemas/knowledge` 下新增通道）暴露给 renderer

### 渲染层：导航区三固定分区

`BaseNavigator` 系列组件改为 ima 式 Accordion：

| 分区 | 内容 | 头部按钮 |
|------|------|----------|
| 个人知识库 | 本地库；自由分组嵌套保留（现 UI 原样，外层加固定标题） | + 新建本地库 |
| 部门知识库 | 网关 `scope='dept'` | 无 |
| 公共知识库 | 网关 `scope='public'` | 无 |

- 三个分区的折叠状态为内存态（组件局部 state，展开为默认），不持久化；个人分区内部自由分组沿用现有 Accordion 折叠逻辑
- 选中 WeKnora 库：右侧详情区显示只读说明（"来自 WeKnora 的共享库，可在对话中直接检索"）+ "去对话"按钮——打开聊天页并定位到企业置顶知识助手；找不到置顶助手时按钮隐藏、仅显示说明文案
- 本地库的交互（选中/重命名/删除/移动分组/侧边栏置顶）完全不变

### i18n

`knowledge.scope.personal / department / public` 等key，zh-cn 与 en-us 同步。

## 非目标（本次不做）

- WeKnora 库内文档列表/预览（需网关再加文档端点）
- 从客户端创建/编辑 WeKnora 库（管理员在 WeKnora 侧管理）
- `kb_entries` 扩展为显式两组（命名约定不够用时再说）
- 本地库数据模型改动或迁移

## 测试

- 网关 pytest：新端点分类逻辑（`^\d{3}-` → dept，其余 → public）、鉴权、WeKnora 不可达降级
- 客户端 vitest：service 校验/降级、IPC 通道、导航三分区渲染、现有 `buildKnowledgeBaseGroupSections` 行为回归

## 改动清单（预估）

- 网关：`app.py` 挂路由 + 新路由模块（~2 文件）
- 主进程：新 service + IPC schema 注册（~2-3 文件）
- renderer：导航组件改造（~3-4 文件）
- i18n：zh-cn / en-us
- 测试：网关 pytest + 客户端 vitest
