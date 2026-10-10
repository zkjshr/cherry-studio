# 知识库页三分类（个人/部门/公共）实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 知识库页左侧导航改为 ima 式三个固定分区——个人知识库（本地库 + 自由分组原样保留）、部门知识库与公共知识库（网关实时查 WeKnora 按 `^\d{3}-` 命名约定分类）；点击共享库显示只读说明 + 可选"去对话检索"。

**Architecture:** 网关新增一个 X-Client-Token 鉴权的 client 端点转发 WeKnora 库列表并分类；客户端主进程照抄 `gatewaySkills.ts` 模式取数并经 IPC 暴露；renderer 在 `KnowledgePageProvider` 增加共享库选中状态（绕开本地库自动选中 effect），导航区渲染三个固定分区，详情区按选中类型分流。

**Tech Stack:** FastAPI + respx（网关）；Electron `net.fetch` + zod + IPC（主进程）；React + vitest + testing-library（renderer）。

**Spec:** `docs/superpowers/specs/2026-10-11-knowledge-page-scopes-design.md`

## Global Constraints

- 工作分支：`enterprise`（ cherry-studio 仓库，`/Users/zhangkaijian/Documents/TJADKnowsLocal/cherry-studio`）。工作区有大量他人未提交改动——**每次 commit 只 add 本任务明确列出的文件**，绝不 `git add -A`。
- 网关测试跑法：`cd gateway && python -m pytest tests/test_knowledge.py -v`（pytest.ini 已设 `pythonpath = .`、`asyncio_mode = auto`）。
- 客户端测试跑法（仓库根）：`pnpm vitest run <文件路径>`；类型检查 `pnpm typecheck`（若脚本名不同，用 `pnpm run` 列出后选 typecheck 类脚本）。
- 部门/公共划分只依赖命名约定 `^\d{3}-`（`gateway/chat.py` 的 `DEPT_KB_RE`），不新增管理配置。
- 网关/客户端所有降级路径（WeKnora 不可达、企业配置未启用、响应非法）一律返回空列表，UI 照常渲染、不弹错。
- 文案：三个分区名 zh-cn 为 个人知识库 / 部门知识库 / 公共知识库；i18n key 前缀 `knowledge.scope.*` 与 `knowledge.shared.*`，zh-cn 与 en-us 同步添加。
- 不动 `kb_entries`、不做 WeKnora 文档级浏览、不改本地库数据模型。

---

### Task 1: 网关端点 `GET /knowledge/api/kbs`

**Files:**
- Create: `gateway/knowledge.py`
- Modify: `gateway/app.py`（import 区 + include_router 处，参照 marketplace_router 两行）
- Test: `gateway/tests/test_knowledge.py`

**Interfaces:**
- Consumes: `gateway/weknora.list_kbs(client) -> list[dict]`（元素 `{id: str, name: str}`）；`gateway/chat.DEPT_KB_RE`（`re.compile(r"^\d{3}-")`）；`gateway/enterprise._token_matches(token) -> bool`
- Produces: `gateway.knowledge.router`（APIRouter，挂在 `/knowledge/api/kbs`）；响应 `{"kbs": [{"id": str, "name": str, "scope": "dept" | "public"}]}`，WeKnora 不可达时 `{"kbs": []}`

- [ ] **Step 1: 写失败测试**

创建 `gateway/tests/test_knowledge.py`：

```python
"""共享知识库目录端点测试：^\d{3}- 部门库命名约定分类、X-Client-Token 鉴权、
WeKnora 不可达降级为空列表。"""
import httpx
import respx
from fastapi.testclient import TestClient

from gateway.app import app
from gateway.config import settings

client = TestClient(app)
CLIENT = {"X-Client-Token": "test-token"}
settings.gateway_token = "test-token"


def _mock_kbs(payload: list[dict]) -> None:
    settings.weknora_base_url = "http://wk.test"
    respx.get("http://wk.test/api/v1/knowledge-bases").mock(
        return_value=httpx.Response(200, json={"data": payload}))


@respx.mock
def test_kbs_classified_by_dept_prefix():
    _mock_kbs([
        {"id": "1", "name": "101-结构所规范库"},
        {"id": "2", "name": "通用设计资料"},
        {"id": "3", "name": "021-岩一院图集"},
    ])
    resp = client.get("/knowledge/api/kbs", headers=CLIENT)
    assert resp.status_code == 200
    assert resp.json() == {"kbs": [
        {"id": "1", "name": "101-结构所规范库", "scope": "dept"},
        {"id": "2", "name": "通用设计资料", "scope": "public"},
        {"id": "3", "name": "021-岩一院图集", "scope": "dept"},
    ]}


@respx.mock
def test_kbs_empty_upstream():
    _mock_kbs([])
    resp = client.get("/knowledge/api/kbs", headers=CLIENT)
    assert resp.status_code == 200
    assert resp.json() == {"kbs": []}


@respx.mock
def test_kbs_weknora_unreachable_returns_empty():
    settings.weknora_base_url = "http://wk.test"
    respx.get("http://wk.test/api/v1/knowledge-bases").mock(
        side_effect=httpx.ConnectError("down"))
    resp = client.get("/knowledge/api/kbs", headers=CLIENT)
    assert resp.status_code == 200
    assert resp.json() == {"kbs": []}


def test_kbs_requires_client_token():
    assert client.get("/knowledge/api/kbs").status_code == 401
    assert client.get("/knowledge/api/kbs", headers={"X-Client-Token": "wrong"}).status_code == 401
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd /Users/zhangkaijian/Documents/TJADKnowsLocal/cherry-studio/gateway && python -m pytest tests/test_knowledge.py -v`
Expected: FAIL/ERROR——`/knowledge/api/kbs` 404（路由不存在）。

- [ ] **Step 3: 实现 `gateway/knowledge.py`**

```python
"""共享知识库目录端点：把 WeKnora 库列表按部门/公共分类下发给客户端。

部门/公共的划分沿用 chat.py 的命名约定（^\\d{3}- 前缀 = 部门库），与检索选库
(select_kb_ids) 同一语义——不在管理端另设配置，WeKnora 侧改名即时生效。
鉴权同 marketplace client 端点（X-Client-Token，复用 enterprise._token_matches）；
WeKnora 不可达降级为空列表——客户端据此把两个共享分区留空，不报错。
"""
import httpx
from fastapi import APIRouter, Depends, Header, HTTPException

from gateway import weknora
from gateway.chat import DEPT_KB_RE
from gateway.enterprise import _token_matches

router = APIRouter()


def _require_client_token(x_client_token: str = Header(default="")) -> None:
    if not _token_matches(x_client_token):
        raise HTTPException(status_code=401, detail="unauthorized")


@router.get("/knowledge/api/kbs", dependencies=[Depends(_require_client_token)])
async def client_kbs() -> dict:
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(10.0, read=60.0)) as client:
            kbs = await weknora.list_kbs(client)
    except httpx.HTTPError:
        return {"kbs": []}
    return {
        "kbs": [
            {
                "id": kb["id"],
                "name": kb["name"],
                "scope": "dept" if DEPT_KB_RE.match(kb.get("name") or "") else "public"
            }
            for kb in kbs
        ]
    }
```

- [ ] **Step 4: 挂路由——修改 `gateway/app.py`**

在 marketplace_router 的 import 旁加一行（保持字母序就近）：

```python
from gateway.knowledge import router as knowledge_router
```

在 `app.include_router(marketplace_router)` 之后加：

```python
app.include_router(knowledge_router)
```

- [ ] **Step 5: 跑测试确认通过**

Run: `cd /Users/zhangkaijian/Documents/TJADKnowsLocal/cherry-studio/gateway && python -m pytest tests/test_knowledge.py -v`
Expected: 4 passed

- [ ] **Step 6: 回归网关全量测试**

Run: `cd /Users/zhangkaijian/Documents/TJADKnowsLocal/cherry-studio/gateway && python -m pytest tests/ -v`
Expected: 全部通过（新增 4 个 + 原有）。注意 `test_model_proxy.py` 等文件在工作区已有未提交改动，若有失败先确认是否为存量失败（`git stash` 对照或看失败用例是否与本任务文件相关），存量失败不要修，报告即可。

- [ ] **Step 7: Commit**

```bash
cd /Users/zhangkaijian/Documents/TJADKnowsLocal/cherry-studio
git add gateway/knowledge.py gateway/app.py gateway/tests/test_knowledge.py
git commit -m "feat(gateway): 共享知识库目录端点 /knowledge/api/kbs（按 ^\\d{3}- 分类部门/公共）"
```

---

### Task 2: 共享类型 + IPC 通道 + 主进程 service

**Files:**
- Modify: `src/shared/data/types/knowledge.ts`（文件末尾追加共享库 zod schema 与类型）
- Modify: `src/shared/ipc/schemas/knowledge.ts`（`knowledgeRequestSchemas` 末尾加一条路由）
- Create: `src/main/features/knowledge/sharedKbs.ts`
- Modify: `src/main/ipc/handlers/knowledge.ts`
- Test: `src/main/features/knowledge/__tests__/sharedKbs.test.ts`；扩展 `src/main/ipc/handlers/__tests__/knowledge.test.ts`

**Interfaces:**
- Consumes: `loadEnterpriseSettings(): { status: 'enabled'; serverUrl: string; token: string } | { status: 'disabled'; reason: string }`（`@main/enterprise/enterpriseSettings`）；`application.get('DbService').getDb()`（drizzle sqlite 实例）；`preferenceTable`（`@data/db/schemas/preference`）
- Produces:
  - `SharedKnowledgeBase = { id: string; name: string; scope: 'dept' | 'public' }`（zod: `SharedKnowledgeBaseSchema`）
  - `SharedKnowledgeBasesPayload = { kbs: SharedKnowledgeBase[]; chatTopicId: string | null }`（zod: `SharedKnowledgeBasesPayloadSchema`，schema 均从 `@shared/data/types/knowledge` 导出）
  - IPC 路由 `'knowledge.list_shared_kbs'`：input `z.void()`，output `SharedKnowledgeBasesPayloadSchema`
  - `listSharedKnowledgeBases(): Promise<SharedKnowledgeBasesPayload>`——企业配置未启用/网关失败/响应非法 → `{ kbs: [], chatTopicId: null }`

- [ ] **Step 1: 写失败的 service 测试**

创建 `src/main/features/knowledge/__tests__/sharedKbs.test.ts`：

```typescript
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { listSharedKnowledgeBases } from '../sharedKbs'

const mockFetch = vi.fn()
const mockGetDb = vi.fn()

vi.mock('electron', () => ({ net: { fetch: (url: string, init?: RequestInit) => mockFetch(url, init) } }))
vi.mock('@logger', () => ({ loggerService: { withContext: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }) } }))
vi.mock('@main/enterprise/enterpriseSettings', () => ({
  loadEnterpriseSettings: vi.fn()
}))
vi.mock('@application', () => ({ application: { get: () => ({ getDb: mockGetDb }) } }))

import { loadEnterpriseSettings } from '@main/enterprise/enterpriseSettings'

const mockLoadEnterpriseSettings = vi.mocked(loadEnterpriseSettings)

function mockPreferenceRows(rows: Record<string, unknown>) {
  const db = {
    select: () => ({
      from: () => ({
        where: () => ({ limit: () => ({ all: () => rows }) })
      })
    })
  }
  mockGetDb.mockReturnValue(db)
}

beforeEach(() => {
  mockFetch.mockReset()
  mockGetDb.mockReset()
  mockLoadEnterpriseSettings.mockReset()
})

describe('listSharedKnowledgeBases', () => {
  it('returns empty payload when enterprise is disabled', async () => {
    mockLoadEnterpriseSettings.mockReturnValue({ status: 'disabled', reason: 'no config' })
    await expect(listSharedKnowledgeBases()).resolves.toEqual({ kbs: [], chatTopicId: null })
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('fetches, validates and returns kbs plus the pinned knowledge topic id', async () => {
    mockLoadEnterpriseSettings.mockReturnValue({ status: 'enabled', serverUrl: 'http://gw.test', token: 't' })
    mockFetch.mockResolvedValue(new Response(JSON.stringify({
      kbs: [
        { id: '1', name: '101-结构所规范库', scope: 'dept' },
        { id: '2', name: '通用设计资料', scope: 'public' }
      ]
    }), { status: 200 }))
    // 模拟 preference 行查询：按 key 返回对应 value（行对象带 key/value 字段）
    mockGetDb.mockImplementation(() => ({
      select: () => ({
        from: () => ({
          where: () => ({
            limit: () => ({
              all: () => [
                { key: 'enterprise.managed_assistant_ids', value: ['a1', 'a2'] },
                { key: 'enterprise.pinned_topics', value: { a2: { topicId: 'topic-9' } } }
              ]
            })
          })
        })
      })
    }))
    await expect(listSharedKnowledgeBases()).resolves.toEqual({
      kbs: [
        { id: '1', name: '101-结构所规范库', scope: 'dept' },
        { id: '2', name: '通用设计资料', scope: 'public' }
      ],
      chatTopicId: 'topic-9'
    })
  })

  it('returns null chatTopicId when no managed assistant has a pinned topic', async () => {
    mockLoadEnterpriseSettings.mockReturnValue({ status: 'enabled', serverUrl: 'http://gw.test', token: 't' })
    mockFetch.mockResolvedValue(new Response(JSON.stringify({ kbs: [] }), { status: 200 }))
    mockGetDb.mockImplementation(() => ({
      select: () => ({
        from: () => ({
          where: () => ({ limit: () => ({ all: () => [] }) })
        })
      })
    }))
    await expect(listSharedKnowledgeBases()).resolves.toEqual({ kbs: [], chatTopicId: null })
  })

  it('degrades to empty payload on gateway http error', async () => {
    mockLoadEnterpriseSettings.mockReturnValue({ status: 'enabled', serverUrl: 'http://gw.test', token: 't' })
    mockFetch.mockResolvedValue(new Response('boom', { status: 500 }))
    await expect(listSharedKnowledgeBases()).resolves.toEqual({ kbs: [], chatTopicId: null })
  })

  it('degrades to empty payload on invalid payload shape', async () => {
    mockLoadEnterpriseSettings.mockReturnValue({ status: 'enabled', serverUrl: 'http://gw.test', token: 't' })
    mockFetch.mockResolvedValue(new Response(JSON.stringify({ kbs: [{ id: '1' }] }), { status: 200 }))
    await expect(listSharedKnowledgeBases()).resolves.toEqual({ kbs: [], chatTopicId: null })
  })
})
```

注意：preference 行查询的实现若按"每个 key 查一次"写（见 Step 3），此 mock 的 `all()` 直接返回两行即可与 `where` 无关——mock 只需与实现的最小调用面匹配；若实现改为按 key 过滤后取第一行，测试断言的是最终返回值，不锁定中间形态。

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm vitest run src/main/features/knowledge/__tests__/sharedKbs.test.ts`
Expected: FAIL——模块 `../sharedKbs` 不存在。

- [ ] **Step 3: 实现 service**

创建 `src/main/features/knowledge/sharedKbs.ts`：

```typescript
import { and, eq } from 'drizzle-orm'
import { net } from 'electron'
import * as z from 'zod'

import { application } from '@application'
import { preferenceTable } from '@data/db/schemas/preference'
import { loggerService } from '@logger'
import {
  ENTERPRISE_MANAGED_ASSISTANT_IDS_KEY,
  ENTERPRISE_PINNED_TOPICS_READ_KEY
} from '@main/enterprise/enterpriseKeys'
import { loadEnterpriseSettings } from '@main/enterprise/enterpriseSettings'
import { SharedKnowledgeBasesPayloadSchema, type SharedKnowledgeBasesPayload } from '@shared/data/types/knowledge'

const logger = loggerService.withContext('sharedKbs')

const FETCH_TIMEOUT_MS = 15_000
const PREFERENCE_SCOPE_DEFAULT = 'default'
const EMPTY_PAYLOAD: SharedKnowledgeBasesPayload = { kbs: [], chatTopicId: null }

/**
 * 部门/公共知识库目录 + 置顶知识话题。企业侧共享库来自网关
 * `/knowledge/api/kbs`（分类在网关侧按 ^\d{3}- 命名约定完成）；
 * chatTopicId 取第一个配置了置顶话题的受管助手——详情页"去对话检索"
 * 跳 `/app/chat?topicId=` 用。一切失败静默降级为空 payload。
 */
export async function listSharedKnowledgeBases(): Promise<SharedKnowledgeBasesPayload> {
  const settings = loadEnterpriseSettings()
  if (settings.status !== 'enabled') {
    return EMPTY_PAYLOAD
  }

  let payload: SharedKnowledgeBasesPayload
  try {
    const resp = await net.fetch(`${settings.serverUrl}/knowledge/api/kbs`, {
      headers: { 'X-Client-Token': settings.token },
      redirect: 'follow',
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS)
    })
    if (!resp.ok) {
      logger.warn('Shared knowledge bases fetch failed', { status: resp.status })
      return EMPTY_PAYLOAD
    }
    payload = SharedKnowledgeBasesPayloadSchema.parse(await resp.json())
  } catch (error) {
    logger.warn('Shared knowledge bases fetch failed', { error: String(error) })
    return EMPTY_PAYLOAD
  }

  return { ...payload, chatTopicId: findPinnedManagedTopicId() }
}

/** 第一个有置顶话题的受管助手的话题 id；无受管助手/无置顶话题时 null。 */
function findPinnedManagedTopicId(): string | null {
  const managedIds = readUndeclaredPreferenceRow(ENTERPRISE_MANAGED_ASSISTANT_IDS_KEY)
  const pinnedTopics = readUndeclaredPreferenceRow(ENTERPRISE_PINNED_TOPICS_READ_KEY)
  if (!Array.isArray(managedIds) || typeof pinnedTopics !== 'object' || pinnedTopics === null) {
    return null
  }
  for (const assistantId of managedIds) {
    if (typeof assistantId !== 'string') continue
    const entry = (pinnedTopics as Record<string, { topicId?: unknown }>)[assistantId]
    if (entry && typeof entry.topicId === 'string') {
      return entry.topicId
    }
  }
  return null
}

function readUndeclaredPreferenceRow(key: string): unknown {
  try {
    const db = application.get('DbService').getDb()
    const [row] = db
      .select({ value: preferenceTable.value })
      .from(preferenceTable)
      .where(and(eq(preferenceTable.scope, PREFERENCE_SCOPE_DEFAULT), eq(preferenceTable.key, key)))
      .limit(1)
      .all()
    return row?.value
  } catch (error) {
    logger.warn('Failed to read enterprise preference row', { key, error: String(error) })
    return undefined
  }
}
```

**注意两个落地细节：**
1. `ENTERPRISE_MANAGED_ASSISTANT_IDS_KEY` 已存在于 `@shared/utils/enterprise`（值为 `'enterprise.managed_assistant_ids'`），直接从那里 import，不要新建 `enterpriseKeys` 模块——上面 import 里的 `ENTERPRISE_PINNED_TOPICS_READ_KEY` 同理：`enterprise.pinned_topics` 键目前是 `applyEnterpriseConfig.ts` 的私有常量，把该常量 `export`（改 `const ENTERPRISE_PINNED_TOPICS_KEY` 为 `export const`），sharedKbs 从 `@main/enterprise/applyEnterpriseConfig` import 它；若引出循环依赖（applyEnterpriseConfig 不 import sharedKbs，应当不会），再下沉到 `@shared/utils/enterprise`。
2. zod schema（Step 4）加进 `@shared/data/types/knowledge.ts`。

- [ ] **Step 4: 加共享类型 zod schema——修改 `src/shared/data/types/knowledge.ts`**

在文件末尾追加（跟随该文件现有的 schema+类型导出风格）：

```typescript
// ── 企业共享知识库（网关 /knowledge/api/kbs 下发，客户端只读） ──

export const SharedKnowledgeBaseSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  scope: z.enum(['dept', 'public'])
})
export type SharedKnowledgeBase = z.infer<typeof SharedKnowledgeBaseSchema>

export const SharedKnowledgeBasesPayloadSchema = z.object({
  kbs: z.array(SharedKnowledgeBaseSchema),
  /** 第一个有置顶话题的受管助手的话题 id；详情页"去对话检索"用。 */
  chatTopicId: z.string().nullable()
})
export type SharedKnowledgeBasesPayload = z.infer<typeof SharedKnowledgeBasesPayloadSchema>
```

（若该文件没有 `import * as z from 'zod'` 则按文件现有导入风格补上。）

- [ ] **Step 5: 加 IPC 路由——修改 `src/shared/ipc/schemas/knowledge.ts`**

`knowledgeRequestSchemas` 对象末尾（`'knowledge.list_item_chunks'` 之后）加：

```typescript
  // 企业共享知识库目录（WeKnora 部门/公共库）+ 置顶知识话题 id，客户端只读。
  'knowledge.list_shared_kbs': defineRoute({ input: z.void(), output: SharedKnowledgeBasesPayloadSchema })
```

并在顶部 import 中加 `SharedKnowledgeBasesPayloadSchema`（来自 `@shared/data/types/knowledge`，与现有 import 合并）。

- [ ] **Step 6: 注册 handler——修改 `src/main/ipc/handlers/knowledge.ts`**

顶部加 import：

```typescript
import { listSharedKnowledgeBases } from '@main/features/knowledge/sharedKbs'
```

`knowledgeHandlers` 对象末尾加：

```typescript
  'knowledge.list_shared_kbs': async () => listSharedKnowledgeBases()
```

`ipcHandlers.ts` 已 `...knowledgeHandlers` 展开，无需改动。

- [ ] **Step 7: 扩展 handler 测试——`src/main/ipc/handlers/__tests__/knowledge.test.ts`**

在该测试文件中照既有 mock 风格加 `vi.mock('@main/features/knowledge/sharedKbs', () => ({ listSharedKnowledgeBases: vi.fn() }))`，并加一个用例（放入既有 describe）：

```typescript
  it('list_shared_kbs delegates to the shared kbs service', async () => {
    const { listSharedKnowledgeBases } = await import('@main/features/knowledge/sharedKbs')
    const payload = { kbs: [{ id: '1', name: '101-结构所规范库', scope: 'dept' as const }], chatTopicId: null }
    vi.mocked(listSharedKnowledgeBases).mockResolvedValue(payload)
    await expect(knowledgeHandlers['knowledge.list_shared_kbs']({}, ctx)).resolves.toEqual(payload)
  })
```

（`ctx` 与该文件既有用例的取法一致；若该文件 handler 调用不带 ctx，则去掉。）

- [ ] **Step 8: 跑测试确认通过**

Run: `pnpm vitest run src/main/features/knowledge/__tests__/sharedKbs.test.ts src/main/ipc/handlers/__tests__/knowledge.test.ts`
Expected: 全部通过（新文件 5 个用例 + 既有 + 新增 1 个）。

- [ ] **Step 9: 类型检查**

Run: `pnpm typecheck`（脚本名以 `pnpm run` 实际输出为准）
Expected: 无新增错误（存量告警不算）。

- [ ] **Step 10: Commit**

```bash
cd /Users/zhangkaijian/Documents/TJADKnowsLocal/cherry-studio
git add src/shared/data/types/knowledge.ts src/shared/ipc/schemas/knowledge.ts src/main/features/knowledge/sharedKbs.ts src/main/features/knowledge/__tests__/sharedKbs.test.ts src/main/ipc/handlers/knowledge.ts src/main/ipc/handlers/__tests__/knowledge.test.ts
git commit -m "feat(knowledge): 共享知识库 IPC 通道（网关取数 + 置顶知识话题解析，失败静默降级）"
```

---

### Task 3: renderer——hook + Provider + 导航三分区

**Files:**
- Create: `src/renderer/pages/knowledge/hooks/useSharedKnowledgeBases.ts`
- Create: `src/renderer/pages/knowledge/components/navigator/SharedKnowledgeSection.tsx`
- Modify: `src/renderer/pages/knowledge/components/navigator/BaseNavigator.tsx`
- Modify: `src/renderer/pages/knowledge/components/navigator/BaseNavigatorContent.tsx`
- Modify: `src/renderer/pages/knowledge/components/navigator/types.ts`（props 类型）
- Modify: `src/renderer/pages/knowledge/KnowledgePageProvider.tsx`
- Modify: `src/renderer/pages/knowledge/sections/KnowledgePageNavigatorSection.tsx`
- Modify: `src/renderer/i18n/locales/zh-cn.json`、`en-us.json`
- Test: 扩展 `src/renderer/pages/knowledge/components/__tests__/BaseNavigator.test.tsx`

**Interfaces:**
- Consumes: `'knowledge.list_shared_kbs'` IPC（Task 2）；`useKnowledgePage()` 上下文
- Produces（Provider context 新增字段，Task 4 消费）:
  - `sharedKbs: SharedKnowledgeBase[]`、`isSharedKbsLoading: boolean`、`chatTopicId: string | null`
  - `selectedSharedKbId: string | null`、`selectedSharedKb: SharedKnowledgeBase | undefined`
  - `selectSharedKb: (kbId: string) => void`（选中共享库并清除本地库选中；`selectBase` 反向清除共享选中）

- [ ] **Step 1: 加 i18n key**

`src/renderer/i18n/locales/zh-cn.json`（按字母序插入 knowledge 区段）：

```json
  "knowledge.scope.department": "部门知识库",
  "knowledge.scope.personal": "个人知识库",
  "knowledge.scope.public": "公共知识库",
```

`en-us.json` 同位置：

```json
  "knowledge.scope.department": "Department Knowledge Bases",
  "knowledge.scope.personal": "Personal Knowledge Bases",
  "knowledge.scope.public": "Public Knowledge Bases",
```

（实际插入位置跟随各文件 knowledge.* 键的现有排序。）

- [ ] **Step 2: 写失败的 hook + navigator 测试**

先在 `BaseNavigator.test.tsx` 末尾追加 describe（复用该文件既有 mock 与 props 构造辅助；新增 props 给默认值 `sharedKbs: []`、`selectedSharedKbId: null`、`onSelectSharedKb: vi.fn()`，并更新该文件中所有既有 `renderBaseNavigator` 辅助函数签名）：

```typescript
  describe('fixed scope sections', () => {
    const basePropsWithShared = (over: Partial<ComponentProps<typeof BaseNavigatorComponent>>) => ({
      ...baseProps, // 该文件既有的最小 props 辅助；无则按既有用例构造
      sharedKbs: [
        { id: 'k1', name: '101-结构所规范库', scope: 'dept' as const },
        { id: 'k2', name: '通用设计资料', scope: 'public' as const }
      ],
      selectedSharedKbId: null,
      onSelectSharedKb: vi.fn(),
      ...over
    })

    it('renders the three fixed scope section headers', () => {
      render(<BaseNavigatorComponent {...basePropsWithShared({})} />)
      expect(screen.getByText('个人知识库')).toBeInTheDocument()
      expect(screen.getByText('部门知识库')).toBeInTheDocument()
      expect(screen.getByText('公共知识库')).toBeInTheDocument()
    })

    it('renders shared kbs under their scope and selects on click', () => {
      const onSelectSharedKb = vi.fn()
      render(<BaseNavigatorComponent {...basePropsWithShared({ onSelectSharedKb })} />)
      const deptSection = screen.getByText('部门知识库').closest('[data-ui="knowledge.scope-section"]')!
      expect(within(deptSection).getByText('101-结构所规范库')).toBeInTheDocument()
      const publicSection = screen.getByText('公共知识库').closest('[data-ui="knowledge.scope-section"]')!
      expect(within(publicSection).getByText('通用设计资料')).toBeInTheDocument()
      fireEvent.click(screen.getByText('101-结构所规范库'))
      expect(onSelectSharedKb).toHaveBeenCalledWith('k1')
    })

    it('highlights the selected shared kb and clears selection via onSelectBase', () => {
      const onSelectBase = vi.fn()
      render(
        <BaseNavigatorComponent
          {...basePropsWithShared({ selectedSharedKbId: 'k2', onSelectBase })}
        />
      )
      const publicSection = screen.getByText('公共知识库').closest('[data-ui="knowledge.scope-section"]')!
      const selectedRow = within(publicSection).getByText('通用设计资料').closest('button')!
      expect(selectedRow.getAttribute('data-selected')).toBe('true')
      fireEvent.click(screen.getAllByText(/.+/)[0]) // 点任一本地库行 → onSelectBase 被调
      expect(onSelectBase).toHaveBeenCalled()
    })
  })
```

注：`data-ui="knowledge.scope-section"` 与 `data-selected` 是本任务给新组件定的测试钩子；测试文案断言用中文硬编码（该文件既有用例风格是直接断言文案，i18n 在测试环境返回 key 时改为断言 key——以跑出的实际行为为准，二选一保持一致）。若该文件 i18n mock 返回 key 而非中文，把断言换成 `'knowledge.scope.personal'` 等 key。

- [ ] **Step 3: 跑测试确认失败**

Run: `pnpm vitest run src/renderer/pages/knowledge/components/__tests__/BaseNavigator.test.tsx`
Expected: FAIL——组件无新增 props/分区。

- [ ] **Step 4: 实现共享分区组件**

创建 `src/renderer/pages/knowledge/components/navigator/SharedKnowledgeSection.tsx`：

```tsx
import { ChevronDown, ChevronRight, Database } from 'lucide-react'
import type { ReactNode } from 'react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { cn } from '@renderer/utils/style'
import type { SharedKnowledgeBase } from '@shared/data/types/knowledge'

interface SharedKnowledgeSectionProps {
  scope: 'personal' | 'dept' | 'public'
  /** dept/public 分区的共享库行；personal 分区不传（内容走 children）。 */
  kbs?: SharedKnowledgeBase[]
  selectedSharedKbId?: string | null
  onSelectSharedKb?: (kbId: string) => void
  /** 仅个人分区：头部 + 按钮（新建本地库），行为与原 HeaderItem 一致。 */
  onCreate?: () => void
  /** 仅个人分区：既有分组折叠列表原样嵌套。 */
  children?: ReactNode
}

/**
 * ima 式固定分类分区头：可折叠 + 右侧 + 按钮（仅个人分区）。部门/公共库为
 * 管理员在 WeKnora 侧维护的只读目录，行无右键菜单。
 */
const SharedKnowledgeSection = ({
  scope,
  kbs,
  selectedSharedKbId,
  onSelectSharedKb,
  onCreate,
  children
}: SharedKnowledgeSectionProps) => {
  const { t } = useTranslation()
  const [isOpen, setIsOpen] = useState(true)
  const label = t(`knowledge.scope.${scope}`)

  return (
    <section data-ui="knowledge.scope-section" className="space-y-1">
      <div className="flex items-center gap-1 px-2 py-1">
        <button
          type="button"
          aria-expanded={isOpen}
          aria-label={label}
          onClick={() => setIsOpen((open) => !open)}
          className="flex min-w-0 flex-1 items-center gap-1 rounded text-muted-foreground hover:text-foreground">
          {isOpen ? <ChevronDown className="size-3.5 shrink-0" /> : <ChevronRight className="size-3.5 shrink-0" />}
          <span className="truncate text-xs font-medium">{label}</span>
        </button>
        {onCreate ? (
          <button
            type="button"
            aria-label={t('knowledge.add.title')}
            onClick={onCreate}
            className="rounded p-0.5 text-muted-foreground hover:text-foreground">
            +
          </button>
        ) : null}
      </div>

      {isOpen ? (
        <>
          {children}
          {(kbs ?? []).map((kb) => {
            const selected = kb.id === selectedSharedKbId
            return (
              <button
                key={kb.id}
                type="button"
                data-selected={selected}
                onClick={() => onSelectSharedKb?.(kb.id)}
                className={cn(
                  'flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm',
                  selected ? 'bg-accent text-foreground' : 'text-muted-foreground hover:bg-accent/50'
                )}>
                <Database className="size-4 shrink-0" />
                <span className="truncate">{kb.name}</span>
              </button>
            )
          })}
        </>
      ) : null}
    </section>
  )
}

export default SharedKnowledgeSection
```

- [ ] **Step 5: 接入 BaseNavigator / BaseNavigatorContent / NavigatorSection**

1. `BaseNavigator.tsx`：props 增加 `sharedKbs: SharedKnowledgeBase[]`、`selectedSharedKbId: string | null`、`onSelectSharedKb: (kbId: string) => void`。布局改为：保留顶部 `ResourceList.HeaderItem` 之外，`BaseNavigatorContent` 的渲染体改为三个 `SharedKnowledgeSection`——

```tsx
        <BaseNavigatorContent
          {.../* 既有 props 原样 */}
          sharedKbs={sharedKbs}
          selectedSharedKbId={selectedSharedKbId}
          onSelectSharedKb={onSelectSharedKb}
        />
```

2. `BaseNavigatorContent.tsx`：把现有"flat 或 Accordion"整体包进个人分区，再渲染部门/公共两个分区：

```tsx
    <Scrollbar className="min-h-0 flex-1 overflow-x-hidden pt-1 pb-3">
      <SharedKnowledgeSection scope="personal" onCreate={() => onCreateBaseInGroup?.()}>
        {/* 既有 isLoading / 空态 / flatSection / Accordion 分支，原样内嵌 */}
      </SharedKnowledgeSection>

      <SharedKnowledgeSection
        scope="dept"
        kbs={sharedKbs.filter((kb) => kb.scope === 'dept')}
        selectedSharedKbId={selectedSharedKbId}
        onSelectSharedKb={onSelectSharedKb}
      />
      <SharedKnowledgeSection
        scope="public"
        kbs={sharedKbs.filter((kb) => kb.scope === 'public')}
        selectedSharedKbId={selectedSharedKbId}
        onSelectSharedKb={onSelectSharedKb}
      />
    </Scrollbar>
```

注意：顶部既有 `ResourceList.HeaderItem`（+ 新建知识库）**删除**——新建入口移到个人分区头（避免出现两个 +）；`onCreateBaseInGroup` 透传为个人分区的 `onCreate`（原语义 `onCreateBase()` 无参调用）。
3. `navigator/types.ts`：`BaseNavigatorContentProps` 与 `BaseNavigatorProps` 同步加三个字段（`sharedKbs`、`selectedSharedKbId`、`onSelectSharedKb`）。
4. `KnowledgePageNavigatorSection.tsx`：从 `useKnowledgePage()` 取 `sharedKbs, selectedSharedKbId, selectSharedKb` 并传入 `BaseNavigator`。

- [ ] **Step 6: 实现 hook——创建 `src/renderer/pages/knowledge/hooks/useSharedKnowledgeBases.ts`**

```typescript
import useSWR from 'swr'

import { ipcApi } from '@renderer/ipc'
import type { SharedKnowledgeBasesPayload } from '@shared/data/types/knowledge'

const FALLBACK: SharedKnowledgeBasesPayload = { kbs: [], chatTopicId: null }

/** 企业共享知识库目录（网关实时查询，客户端只读）；失败已在主进程降级为空。 */
export const useSharedKnowledgeBases = () => {
  const { data, isLoading } = useSWR('knowledge.list_shared_kbs', () => ipcApi.request('knowledge.list_shared_kbs'), {
    fallbackData: FALLBACK,
    revalidateOnFocus: false,
    revalidateIfStale: false
  })
  return { payload: data ?? FALLBACK, isLoading }
}
```

- [ ] **Step 7: Provider 集成——修改 `KnowledgePageProvider.tsx`**

1. 顶部引入 `useSharedKnowledgeBases` 与 `SharedKnowledgeBase` 类型。
2. Provider 内加：

```typescript
  const { payload: sharedPayload } = useSharedKnowledgeBases()
  const sharedKbs = sharedPayload.kbs
  const chatTopicId = sharedPayload.chatTopicId
  const [selectedSharedKbId, setSelectedSharedKbId] = useState<string | null>(null)
  const selectedSharedKb = useMemo(
    () => sharedKbs.find((kb) => kb.id === selectedSharedKbId),
    [sharedKbs, selectedSharedKbId]
  )
```

3. `selectBase` 回调开头加 `setSelectedSharedKbId(null)`；新增：

```typescript
  const selectSharedKb = useCallback(
    (kbId: string) => {
      resetBaseNavigation()
      setSelectedItemId(null)
      setSelectedSharedKbId(kbId)
      // 释放本地库路由选中：详情区按 selectedSharedKb 分流（Task 4）
      if (selectedBaseId) {
        onBaseIdChange()
      }
    },
    [resetBaseNavigation, selectedBaseId, onBaseIdChange]
  )
```

4. **自动选中 effect 加共享守卫**：`useEffect(() => { if (isLoading || basesError) return ... }` 改为 `if (isLoading || basesError || selectedSharedKbId) return`，依赖数组加 `selectedSharedKbId`——否则选中共享库后会被弹回第一个本地库。
5. Context value 与 `KnowledgePageContextValue` 接口加：`sharedKbs, chatTopicId, selectedSharedKbId, selectedSharedKb, selectSharedKb`（`isSharedKbsLoading` 如 UI 需要 loading 态再透出）。

- [ ] **Step 8: 跑测试确认通过 + 回归**

Run: `pnpm vitest run src/renderer/pages/knowledge/`
Expected: BaseNavigator 新用例通过；既有 KnowledgePage.test.tsx / KnowledgeBaseRow.test.tsx 等全部通过。若既有用例因头部按钮挪位失败（`knowledge.add.title` 的 + 入口断言），按新位置修断言。

- [ ] **Step 9: Commit**

```bash
cd /Users/zhangkaijian/Documents/TJADKnowsLocal/cherry-studio
git add src/renderer/pages/knowledge/hooks/useSharedKnowledgeBases.ts src/renderer/pages/knowledge/components/navigator/SharedKnowledgeSection.tsx src/renderer/pages/knowledge/components/navigator/BaseNavigator.tsx src/renderer/pages/knowledge/components/navigator/BaseNavigatorContent.tsx src/renderer/pages/knowledge/components/navigator/types.ts src/renderer/pages/knowledge/KnowledgePageProvider.tsx src/renderer/pages/knowledge/sections/KnowledgePageNavigatorSection.tsx src/renderer/i18n/locales/zh-cn.json src/renderer/i18n/locales/en-us.json src/renderer/pages/knowledge/components/__tests__/BaseNavigator.test.tsx
git commit -m "feat(knowledge): 知识库导航三分区（个人/部门/公共），共享库来自网关只读目录"
```

---

### Task 4: 共享库只读详情 + 页面分流

**Files:**
- Create: `src/renderer/pages/knowledge/components/SharedKnowledgeBaseDetail.tsx`
- Modify: `src/renderer/pages/knowledge/sections/KnowledgePageDetailSection.tsx`（顶部分流）
- Modify: `src/renderer/pages/knowledge/KnowledgePage.tsx`（空态条件 + 详情分流）
- Modify: `src/renderer/i18n/locales/zh-cn.json`、`en-us.json`
- Test: `src/renderer/pages/knowledge/components/__tests__/SharedKnowledgeBaseDetail.test.tsx`；扩展 `src/renderer/pages/knowledge/__tests__/KnowledgePage.test.tsx`

**Interfaces:**
- Consumes: Provider 的 `selectedSharedKb`、`chatTopicId`（Task 3）
- Produces: `SharedKnowledgeBaseDetail` 组件（无 props，全走 context）

- [ ] **Step 1: 加 i18n key**

zh-cn.json：

```json
  "knowledge.shared.description.department": "这是所里 WeKnora 的部门共享知识库，内容由部门维护；可在对话中直接检索本库内容。",
  "knowledge.shared.description.public": "这是所里 WeKnora 的公共共享知识库，面向全所开放；可在对话中直接检索本库内容。",
  "knowledge.shared.open_chat": "去对话检索",
```

en-us.json：

```json
  "knowledge.shared.description.department": "A department-shared WeKnora knowledge base, maintained by the department. Its content is searchable in chats.",
  "knowledge.shared.description.public": "A public WeKnora knowledge base open to the whole institute. Its content is searchable in chats.",
  "knowledge.shared.open_chat": "Search in Chat",
```

- [ ] **Step 2: 写失败测试**

创建 `src/renderer/pages/knowledge/components/__tests__/SharedKnowledgeBaseDetail.test.tsx`（mock `../KnowledgePageProvider` 的 `useKnowledgePage`，风格同 DetailHeader.test.tsx）：

```tsx
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import SharedKnowledgeBaseDetail from '../SharedKnowledgeBaseDetail'
import { useKnowledgePage } from '../../KnowledgePageProvider'

vi.mock('../../KnowledgePageProvider', () => ({ useKnowledgePage: vi.fn() }))
vi.mock('@renderer/i18n', () => ({ t: (key: string) => key }))
// EmptyState 走 @cherrystudio/ui，按 BaseNavigator.test.tsx 的既有 mock 方式处理

const mockUseKnowledgePage = vi.mocked(useKnowledgePage)

const baseContext = {
  selectedSharedKb: { id: 'k1', name: '101-结构所规范库', scope: 'dept' as const },
  chatTopicId: 'topic-9'
}

it('renders the shared kb name and department description', () => {
  mockUseKnowledgePage.mockReturnValue(baseContext as never)
  render(<SharedKnowledgeBaseDetail />)
  expect(screen.getByText('101-结构所规范库')).toBeInTheDocument()
  expect(screen.getByText('knowledge.shared.description.department')).toBeInTheDocument()
})

it('hides the chat action when no pinned topic exists', () => {
  mockUseKnowledgePage.mockReturnValue({ ...baseContext, chatTopicId: null } as never)
  render(<SharedKnowledgeBaseDetail />)
  expect(screen.queryByText('knowledge.shared.open_chat')).not.toBeInTheDocument()
})

it('navigates to the pinned topic chat on action', () => {
  mockUseKnowledgePage.mockReturnValue(baseContext as never)
  const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null)
  render(<SharedKnowledgeBaseDetail />)
  fireEvent.click(screen.getByText('knowledge.shared.open_chat'))
  expect(openSpy).toHaveBeenCalledWith('/app/chat?topicId=topic-9', '_self')
  openSpy.mockRestore()
})
```

（i18n mock 的具体形态以 DetailHeader.test.tsx 既有写法为准；window.open 若组件实现用别的导航方式，断言随之调整。）

- [ ] **Step 3: 跑测试确认失败**

Run: `pnpm vitest run src/renderer/pages/knowledge/components/__tests__/SharedKnowledgeBaseDetail.test.tsx`
Expected: FAIL——组件不存在。

- [ ] **Step 4: 实现组件**

创建 `src/renderer/pages/knowledge/components/SharedKnowledgeBaseDetail.tsx`：

```tsx
import { useTranslation } from 'react-i18next'

import { EmptyState } from '@cherrystudio/ui'

import { useKnowledgePage } from '../KnowledgePageProvider'

/**
 * WeKnora 共享库（部门/公共）只读详情：库不可在客户端增删文档，说明文案 +
 * 可选"去对话检索"（跳企业置顶知识话题；无置顶话题时按钮隐藏）。
 */
const SharedKnowledgeBaseDetail = () => {
  const { t } = useTranslation()
  const { selectedSharedKb, chatTopicId } = useKnowledgePage()

  if (!selectedSharedKb) {
    return null
  }

  return (
    <main data-ui="knowledge.content" className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      <EmptyState
        illustration="book"
        title={selectedSharedKb.name}
        description={t(
          selectedSharedKb.scope === 'dept'
            ? 'knowledge.shared.description.department'
            : 'knowledge.shared.description.public'
        )}
        {...(chatTopicId
          ? {
              actionLabel: t('knowledge.shared.open_chat'),
              onAction: () => window.open(`/app/chat?topicId=${encodeURIComponent(chatTopicId)}`, '_self')
            }
          : {})}
      />
    </main>
  )
}

export default SharedKnowledgeBaseDetail
```

- [ ] **Step 5: 页面分流——修改 `KnowledgePage.tsx` 与 `KnowledgePageDetailSection.tsx`**

`KnowledgePage.tsx`：

```tsx
  const { bases, filePreview, isLoading, selectedBase, selectedSharedKb, sharedKbs } = useKnowledgePage()

  // 无本地库且无共享库才进全屏空态；有共享库时导航三分区仍然可用
  if (!isLoading && bases.length === 0 && sharedKbs.length === 0) {
    return <KnowledgePageEmptyStateSection />
  }

  ...
      {selectedSharedKb ? (
        <SharedKnowledgeBaseDetail />
      ) : selectedBase ? (
        <KnowledgePageDetailSection />
      ) : (
        ...既有 loading 占位
      )}
```

import `SharedKnowledgeBaseDetail`（lazy 与否跟随既有 DetailSection 的做法——它本身轻量，直接 import 即可）。

`KnowledgePageDetailSection.tsx`：把既有的 `if (!selectedBase) { return null }` 改为（保持在所有 hooks 之后，遵守 hooks 顺序规则；共享库选中时页面层已分流到 SharedKnowledgeBaseDetail，本组件直接不渲染）：

```tsx
  if (!selectedBase || selectedSharedKb) {
    return null
  }
```

（`selectedSharedKb` 从本文件既有的 `useKnowledgePage()` 解构中补取。）

- [ ] **Step 6: 扩展 KnowledgePage.test.tsx**

在既有 harness 中 mock 新 hook 模块：

```typescript
const mockUseSharedKnowledgeBases = vi.fn()
vi.mock('../hooks/useSharedKnowledgeBases', () => ({
  useSharedKnowledgeBases: () => mockUseSharedKnowledgeBases()
}))
```

beforeEach 默认 `mockUseSharedKnowledgeBases.mockReturnValue({ payload: { kbs: [], chatTopicId: null }, isLoading: false })`（否则既有用例会因新 hook 挂掉）。加两个用例：

```typescript
  it('still renders the navigator when only shared kbs exist', async () => {
    mockUseKnowledgeBases.mockReturnValue({ bases: [], isLoading: false, error: null })
    mockUseSharedKnowledgeBases.mockReturnValue({
      payload: { kbs: [{ id: 'k1', name: '101-结构所规范库', scope: 'dept' }], chatTopicId: null },
      isLoading: false
    })
    render(<RoutedKnowledgePage />)
    expect(await screen.findByText('部门知识库')).toBeInTheDocument()
  })

  it('renders the shared detail panel when a shared kb is selected', async () => {
    mockUseKnowledgeBases.mockReturnValue({ bases: [], isLoading: false, error: null })
    mockUseSharedKnowledgeBases.mockReturnValue({
      payload: { kbs: [{ id: 'k1', name: '101-结构所规范库', scope: 'dept' }], chatTopicId: 'topic-9' },
      isLoading: false
    })
    render(<RoutedKnowledgePage />)
    fireEvent.click(await screen.findByText('101-结构所规范库'))
    expect(await screen.findByText('knowledge.shared.description.department')).toBeInTheDocument()
  })
```

（断言文案 vs i18n key 与 Task 3 同一取齐原则。）

- [ ] **Step 7: 全量回归 + 类型检查**

Run: `pnpm vitest run src/renderer/pages/knowledge/ && pnpm typecheck`
Expected: 全部通过，无新增类型错误。

- [ ] **Step 8: Commit**

```bash
cd /Users/zhangkaijian/Documents/TJADKnowsLocal/cherry-studio
git add src/renderer/pages/knowledge/components/SharedKnowledgeBaseDetail.tsx src/renderer/pages/knowledge/components/__tests__/SharedKnowledgeBaseDetail.test.tsx src/renderer/pages/knowledge/sections/KnowledgePageDetailSection.tsx src/renderer/pages/knowledge/KnowledgePage.tsx src/renderer/pages/knowledge/__tests__/KnowledgePage.test.tsx src/renderer/i18n/locales/zh-cn.json src/renderer/i18n/locales/en-us.json
git commit -m "feat(knowledge): 共享库只读详情与页面分流，去对话检索入口"
```

---

## 收尾验证（人工/自动）

1. `cd gateway && python -m pytest tests/ -v` 全绿。
2. `pnpm vitest run src/renderer/pages/knowledge/ src/main/features/knowledge/ src/main/ipc/handlers/__tests__/knowledge.test.ts` 全绿；`pnpm typecheck` 无新增错误。
3. 手工冒烟（可选，dev 环境）：企业配置启用 + 网关运行时，知识库页应看到三个分区；WeKnora 可达时部门/公共分区有库；断网/停网关时两个共享分区为空、页面不报错。
