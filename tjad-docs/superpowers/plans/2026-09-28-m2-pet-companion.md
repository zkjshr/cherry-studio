# M2 桌宠主入口（Pet Companion）实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 桌宠成为主交互入口：常驻透明桌宠 + 流式知识库对话（SSE RAG）+ 右键功能菜单；organizer 挂起（配置开关）；Windows 10/11 优先。

**Architecture:** 网关新增 SSE 端点 `/api/chat/stream`（hybrid-search 检索 → status/sources 事件 → ollama NDJSON 流转发为 delta → done/error）；Tauri 新增 `pet` 透明置顶窗口（动态穿透 set_ignore_cursor_events、拖拽位置记忆、PetSkin 帧动画状态机）；对话面板自绘消费 SSE（思考区逐行 → 折叠，回答逐 delta，来源 chips）。配置扩展 petEnabled/petX/petY/organizerEnabled。

**Tech Stack:** 既有 Tauri 2 + Vue 3 + FastAPI；网关 SSE 用 sse-starlette（或原生 StreamingResponse text/event-stream——用原生，避免新依赖）；前端 SSE 用 `fetch + ReadableStream`（不用 EventSource——需带 Authorization 头）。

**Spec:** `docs/superpowers/specs/2026-09-28-m2-pet-companion-design.md`

## Global Constraints

- Windows 10/11 优先；**解除 Win7/Chromium 109 约束**：vite `build.target` 升级为 `"es2022"`（保底兼容）；既有 `@supports` 毛玻璃降级保留。
- API key 只在网关 env（OLLAMA_BASE_URL 默认 `http://192.168.66.25:11434`、OLLAMA_MODEL 默认 `qwen2.5:14b`——当前唯一已加载且实测可用；**注意该服务器响应极慢：单句 113s，GPU 疑被争用**；网关首 token 超时 180s，整体 300s）。
- SSE 事件契约（五类，`event:` + JSON `data:`）：`status {text}` / `sources {sources:[{id,kb_id,kb_name,title}]≤8}` / `delta {text}` / `done {partial}` / `error {message}`。
- organizerEnabled=false（默认）时不注册 Alt+D、托盘无"整理模式"项、不创建 organizer 窗口；代码全保留。
- 提交中文祈使句；每任务 cargo/npm/pytest 相应全绿。
- 前端 SSE 消费必须带 `Authorization: Bearer` 头（fetch ReadableStream），abort 传播（关面板即取消网关→ollama）。

---

### Task 1: 网关 SSE 聊天端点（检索+ollama 流式编排）

**Files:**
- Modify: `desktop/gateway/weknora.py`（+chat 检索复用无需新函数——直接复用 kb_hybrid_search）
- Create: `desktop/gateway/chat.py`（编排逻辑，纯函数可测部分独立）
- Modify: `desktop/gateway/app.py`（+`GET /api/chat/stream`）
- Test: `desktop/gateway/tests/test_chat.py`

**Interfaces:**
- Consumes: `weknora.kb_hybrid_search(client, kb_id, q, limit) -> list[dict]`（既有，返回含 knowledge_id/knowledge_title/score 的平铺映射——注意它已映射为 {id,kb_id,...} 归一形态）、`weknora.list_kbs(client)`。
- Produces:
  - `chat.py`: `build_prompt(query: str, chunks: list[dict], history: list[dict]) -> list[dict]`（messages 数组：system 提示 + history + 检索块+query 的 user 消息）；`parse_sse_chunk(buf: str) -> list[tuple[str, str]]`（解析一段 SSE 原始文本为 (event, data) 列表——供前端与网关测试共用语义基线，网关侧用于自测事件流）；`extract_ollama_delta(line: str) -> str | None`（解析一行 ollama NDJSON 的 message.content，done 行返回 None）。
  - `app.py`: `GET /api/chat/stream?q=&history=<urlencoded JSON>&kb_ids=a,b`（Bearer；kb_ids 空=全部库——复用 list_kbs 全量扇出**只取前 12 个库**，避免 54 库扇出雪崩）。

- [ ] **Step 1: 失败测试 test_chat.py**

```python
import json

from gateway.chat import build_prompt, extract_ollama_delta


def test_build_prompt_contains_chunks_and_history():
    msgs = build_prompt(
        "资质通知",
        [{"title": "关于资质的通知", "content": "正文摘要A", "kb_name": "103-科技质量部"}],
        [{"role": "user", "content": "之前问过什么"}, {"role": "assistant", "content": "之前答过什么"}],
    )
    assert msgs[0]["role"] == "system" and "知识助手" in msgs[0]["content"]
    assert any("关于资质的通知" in m["content"] for m in msgs)
    assert msgs[-1]["role"] == "user" and "资质通知" in msgs[-1]["content"]
    # history 在 system 之后、检索 user 之前
    assert msgs[1]["content"] == "之前问过什么" and msgs[2]["content"] == "之前答过什么"


def test_extract_ollama_delta():
    assert extract_ollama_delta('{"message":{"content":"你好"}}') == "你好"
    assert extract_ollama_delta('{"done":true,"message":{"content":""}}') is None
    assert extract_ollama_delta("not json") is None
```

- [ ] **Step 2: 跑失败** — `.venv/bin/python -m pytest tests/test_chat.py -v`，FAIL（模块不存在）
- [ ] **Step 3: 实现 chat.py**

```python
"""对话编排：检索块 → prompt 组装 → SSE 事件语义。"""
import json

SYSTEM_PROMPT = (
    "你是 TJAD 企业知识助手。基于下面提供的资料片段回答用户问题；"
    "答案用中文、简洁分点；资料不足以回答时明确说明。不要编造来源。"
)


def build_prompt(query: str, chunks: list[dict], history: list[dict]) -> list[dict]:
    parts = [f"【{c.get('kb_name') or '知识库'}】{c.get('title')}\n{c.get('content', '')[:600]}" for c in chunks]
    context = "\n\n".join(parts)
    msgs = [{"role": "system", "content": SYSTEM_PROMPT}]
    msgs.extend({"role": h["role"], "content": h["content"]} for h in history[:4])
    msgs.append({"role": "user", "content": f"参考资料：\n{context}\n\n问题：{query}"})
    return msgs


def extract_ollama_delta(line: str) -> str | None:
    try:
        d = json.loads(line)
    except (json.JSONDecodeError, ValueError):
        return None
    if d.get("done"):
        return None
    return (d.get("message") or {}).get("content") or None


def parse_sse_chunk(buf: str) -> list[tuple[str, str]]:
    """把一段 SSE 文本解析为 (event, data-json字符串) 列表。"""
    out: list[tuple[str, str]] = []
    for block in buf.split("\n\n"):
        event, data = "message", ""
        for ln in block.splitlines():
            if ln.startswith("event:"):
                event = ln[6:].strip()
            elif ln.startswith("data:"):
                data = ln[5:].strip()
        if block.strip():
            out.append((event, data))
    return out
```

- [ ] **Step 4: app.py 加 SSE 端点**

```python
import json as _json
from fastapi.responses import StreamingResponse
from gateway import chat as chat_mod
from gateway.config import settings as gw_settings
import os

OLLAMA_BASE = os.environ.get("OLLAMA_BASE_URL", "http://192.168.66.25:11434")
OLLAMA_MODEL = os.environ.get("OLLAMA_MODEL", "qwen2.5:14b")
CHAT_TOP_KB = 12  # 全库模式下最多扇出库数，防 54 库雪崩


@app.get("/api/chat/stream", dependencies=[Depends(require_token)])
async def chat_stream(q: str = Query(min_length=1), history: str = Query(default=""), kb_ids: str = Query(default="")) -> StreamingResponse:
    try:
        hist = _json.loads(history) if history else []
    except ValueError:
        hist = []

    async def gen():
        sse = lambda event, payload: f"event: {event}\ndata: {_json.dumps(payload, ensure_ascii=False)}\n\n"
        async with httpx.AsyncClient(timeout=httpx.Timeout(10.0, read=300.0)) as client:
            # 1) 确定库列表
            try:
                all_kbs = await weknora.list_kbs(client)
            except httpx.HTTPError:
                all_kbs = []
            ids = [s for s in kb_ids.split(",") if s] or [k["id"] for k in all_kbs[:CHAT_TOP_KB]]
            kb_names = {k["id"]: k["name"] for k in all_kbs}
            yield sse("status", {"text": f"正在检索 {len(ids)} 个部门知识库…"})
            # 2) 检索（复用 deep 的并发/预算语义，简化为顺序 gather+wait_for）
            chunks: list[dict] = []
            import asyncio as _aio
            sem = _aio.Semaphore(8)

            async def one(kb_id: str):
                async with sem:
                    try:
                        rs = await _aio.wait_for(weknora.kb_hybrid_search(client, kb_id, q, 3), timeout=3.0)
                        for r in rs:
                            r["kb_name"] = kb_names.get(kb_id, r.get("kb_name") or "")
                        return rs
                    except (httpx.HTTPError, _aio.TimeoutError):
                        return []

            results = await _aio.gather(*(one(k) for k in ids))
            for rs in results:
                chunks.extend(rs)
            chunks.sort(key=lambda c: c.get("score") or 0, reverse=True)
            chunks = chunks[:8]
            # 去重来源（同 knowledge_id 取最高分）
            seen: set[str] = set()
            sources = []
            for c in chunks:
                if c["id"] not in seen:
                    seen.add(c["id"])
                    sources.append({"id": c["id"], "kb_id": c["kb_id"], "kb_name": c.get("kb_name") or "", "title": c.get("title") or ""})
            yield sse("status", {"text": f"命中 {len(sources)} 篇相关文档，正在阅读…"})
            if sources:
                yield sse("sources", {"sources": sources[:8]})
            if not chunks:
                yield sse("delta", {"text": "知识库暂时没有检索到相关内容。"})
                yield sse("done", {"partial": True})
                return
            # 3) ollama 流式
            messages = chat_mod.build_prompt(q, chunks, hist)
            partial = False
            try:
                async with client.stream(
                    "POST", f"{OLLAMA_BASE}/api/chat",
                    json={"model": OLLAMA_MODEL, "stream": True, "messages": messages},
                ) as resp:
                    resp.raise_for_status()
                    async for line in resp.aiter_lines():
                        delta = chat_mod.extract_ollama_delta(line)
                        if delta:
                            yield sse("delta", {"text": delta})
            except (httpx.HTTPError, _aio.TimeoutError) as e:
                partial = True
                yield sse("delta", {"text": f"\n（生成服务暂不可用：{type(e).__name__}，以上为检索到的相关文档，可点击下方来源查看）"})
            yield sse("done", {"partial": partial})

    return StreamingResponse(gen(), media_type="text/event-stream", headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})
```

（导入注意：app.py 顶部已有 asyncio as 无——直接 `import asyncio` 已存在则复用；os/_json/chat_mod 按需加。）

- [ ] **Step 5: 测试通过 + 真实冒烟** — pytest 全绿后，起网关 `curl -N -H "Authorization: Bearer dev-smoke" "http://127.0.0.1:8787/api/chat/stream?q=%E8%B5%84%E8%B4%A8"` 观察：status→sources→delta 逐个到达（ollama 慢，首个 delta 可能 1-2 分钟，curl 加 `-m 300`）；把事件序列摘要记入报告。
- [ ] **Step 6: Commit** — `git add gateway && git commit -m "feat: 网关流式对话端点（检索+ollama SSE 编排）"`

---

### Task 2: pet 窗口与动态穿透、拖拽位置记忆

**Files:**
- Modify: `desktop/src-tauri/src/lib.rs`（AppConfig +petEnabled/petX/petY/organizerEnabled；setup 建 pet 窗口；organizer 挂起逻辑）、`desktop/src-tauri/src/settings_cmd.rs`（字段）、`desktop/src-tauri/src/tray.rs`（托盘 +显示/隐藏桌宠、organizer 项条件化）
- Create: `desktop/src-tauri/src/pet.rs`（窗口与命令）
- Modify: `desktop/src/settings/store.ts`（+4 字段）
- Test: `desktop/src-tauri/src/pet.rs` 内纯函数单测

**Interfaces:**
- Produces:
  - AppConfig 新字段（serde camelCase + default）：`pet_enabled: bool=true`、`pet_x: Option<i32>=None`、`pet_y: Option<i32>=None`、`organizer_enabled: bool=false`。
  - `pet.rs`: `pub fn ensure_pet_window(app: &AppHandle) -> tauri::Result<()>`（不存在则建：200x240 透明无边框置顶 skip_taskbar，位置 pet_x/y 或默认主屏右下 (width-260, height-320)，URL `pet.html`）；`#[tauri::command] pub fn set_pet_interactive(app, interactive: bool)`（切 `set_ignore_cursor_events(!interactive)`）；`#[tauri::command] pub fn save_pet_position(x: i32, y: i32)`（写 config.json，经 settings_cmd 的写函数或直接读写）；`#[tauri::command] pub fn toggle_pet(app)`（托盘用，show/hide）；`#[tauri::command] pub fn pet_menu_action(app, action: String)`（分发 search/settings/organizer/quit——organizer 仅 organizer_enabled）。
  - lib.rs setup：petEnabled 时 ensure_pet_window（默认 true）；**organizer 挂起**：`organizer_enabled=false` 时跳过 organizer 热键注册（set_organizer_hotkey 调用处包 if）且托盘不显示整理模式项；`hide_organizer` 等命令保留。

- [ ] **Step 1: pet.rs 纯函数与命令**（含单测：默认位置计算 `pub fn default_pet_pos(screen: (i32,i32,i32,i32)) -> (i32,i32)` = `(w-260, h-320)`，测试断言）
- [ ] **Step 2: AppConfig 四字段 + store.ts 同步**（serde default；旧 config.json 兼容；store.test 加默认值断言用例）
- [ ] **Step 3: lib.rs/tray.rs 接线**（setup 条件建窗；托盘菜单加"显示/隐藏桌宠"项 + "整理模式"项按 organizerEnabled 构建菜单——菜单需按配置重建：最简做法是 build_tray 读配置决定是否含整理模式项，启动时配置已就绪）
- [ ] **Step 4: 前端入口** `desktop/pet.html` + `desktop/src/pet/main.ts`（挂 PetApp.vue 占位：一个透明 div 上放宠物占位图（程序绘制圆形+眼睛，PetSkin 抽象）+ mouseenter/mouseleave invoke set_pet_interactive + mousedown/mousemove/mouseup 拖拽（拖拽用 `getCurrentWindow().startDragging()`——Tauri 原生拖动，mouseup 后用 `window.outerPosition()` invoke save_pet_position）+ contextmenu 自绘菜单（四项，organizerEnabled 由 loadConfig 得）+ click 切换对话面板（Task 4 实装，本任务 console.log 占位）
- [ ] **Step 5: vite.config.ts 加第四入口 pet**；验证：cargo test/clippy、npm test/build、dev 冒烟（宠物出现右下角、可拖拽、穿透生效：宠物外点击落到下层、重启位置记忆）
- [ ] **Step 6: Commit** — `git commit -m "feat: 桌宠窗口与动态穿透拖拽（organizer 可配置挂起）"`

---

### Task 3: PetSkin 帧动画状态机

**Files:**
- Create: `desktop/src/pet/PetSkin.vue`、`desktop/src/pet/state.ts`
- Modify: `desktop/src/pet/PetApp.vue`（用 PetSkin 替换占位图）
- Test: `desktop/src/pet/__tests__/state.test.ts`

**Interfaces:**
- Produces: `state.ts`: `type PetState = "idle" | "thinking" | "talking" | "dragged"`；`pub fn nextFrame(state: PetState, frame: number, fps: number): number`（帧推进（frame+1）%framesOf(state)；framesOf: idle=4/thinking=4/talking=2/dragged=1；fps: idle=3/thinking=8/talking=6/dragged=0）；PetSkin.vue props `{state: PetState}`，内部 setInterval 按 fps 换帧；**素材策略**：v1 程序绘制——每帧为一个 `<canvas>` 或纯 CSS 形态（圆形身体+眼睛+状态差异：thinking 头顶"…"点点、talking 嘴部开合、idle 眨眼、dragged 压扁）；接口预留 `frames` 数组 props（未来换图片素材只需替换渲染函数）。

- [ ] **Step 1: state.test.ts 失败测试**（nextFrame 推进/回绕/fps 表/非法 state 抛错）
- [ ] **Step 2: 实现 state.ts + PetSkin.vue**（requestAnimationFrame 或 setInterval；thinking 期"…"点动画用帧驱动）
- [ ] **Step 3: npm test/build 绿 + dev 冒烟（各状态肉眼确认：临时按钮切 state）**
- [ ] **Step 4: Commit** — `git commit -m "feat: 桌宠皮肤状态机与程序绘制动画"`

---

### Task 4: 对话面板（SSE 消费）

**Files:**
- Create: `desktop/src/pet/ChatPanel.vue`、`desktop/src/pet/sse.ts`、`desktop/src/pet/chat.ts`
- Modify: `desktop/src/pet/PetApp.vue`（点击宠物切面板显隐；面板打开时宠物隐藏或缩小钉在面板边）
- Test: `desktop/src/pet/__tests__/chat.test.ts`、`desktop/src/pet/__tests__/sse.test.ts`

**Interfaces:**
- Consumes: 网关 `/api/chat/stream`（Task 1 契约）、`open_knowledge`（经 runAction）、cfg（loadConfig 的 gatewayUrl/gatewayToken/weknoraWebUrl）。
- Produces:
  - `sse.ts`: `export async function streamChat(url: string, token: string, q: string, history: {role:string;content:string}[], kbIds: string[], onEvent: (event: string, data: any) => void, signal?: AbortSignal): Promise<void>`（fetch POST？不——**GET**（网关端点是 GET）；拼 query：`?q=&history=<encodeURIComponent(JSON)>&kb_ids=`；ReadableStream 逐 chunk 用 TextDecoder 累积、按 `\n\n` 切块、`parseSSE`（本地实现，与网关 chat.parse_sse_chunk 同语义）回调 onEvent；abort 传播 fetch）。
  - `chat.ts`: `export interface PetMessage { role: "user" | "assistant"; content: string; statusLines?: string[]; sources?: {id,kb_id,kb_name,title}[]; partial?: boolean; error?: string }`；`export function appendEvent(msg: PetMessage, event: string, data: any): PetMessage`（纯函数：status→push statusLines；sources→set sources；delta→content+=text；done→partial；error→error 字段——供单测）。
  - ChatPanel.vue：消息列表（user 右/assistant 左毛玻璃气泡；assistant 气泡内：思考区（statusLines 逐行小字，流完成后折叠为"已检索 N 篇▾"可展开）→ 回答区（content，流式中有闪烁光标）→ 来源 chips（点击 runAction({kb_id,...} 形态 KnowledgeHit, weknoraWebUrl)））；底部 input+发送；流式中 Enter 忽略；错误气泡带"重试"。

- [ ] **Step 1: chat.test.ts 失败测试**（appendEvent 五事件语义：status push/delta 拼接/sources 替换/double done 幂等/error 设置）
- [ ] **Step 2: sse.test.ts**（parseSSE 本地实现：多事件块解析/跨 chunk 粘包——传入含半块 buffer 断言只回调完整事件）
- [ ] **Step 3: 实现 chat.ts + sse.ts**（注意 fetch GET + headers Authorization + signal）
- [ ] **Step 4: ChatPanel.vue + PetApp.vue 接线**（面板 320x440 毛玻璃，显示时 invoke set_pet_interactive(true) 保持可交互；关闭恢复）
- [ ] **Step 5: 全测 + dev 冒烟**（对本地网关真实流式对话一次，记录事件到达时序截图/文本进报告）
- [ ] **Step 6: Commit** — `git commit -m "feat: 桌宠对话面板（SSE 流式思考与来源）"`

---

### Task 5: 状态机联动与托盘/菜单整合

**Files:**
- Modify: `desktop/src/pet/PetApp.vue`（发送→thinking；首个 delta→talking；done/error→idle；拖拽→dragged）、`desktop/src-tauri/src/pet.rs`（pet_menu_action 分发）、`desktop/src-tauri/src/tray.rs`（"显示/隐藏桌宠"菜单项）、`desktop/src/settings/Settings.vue`（+桌宠开关/整理模式开关两 checkbox）
- Test: 既有测试保持 + Settings store 断言

**Interfaces:**
- Consumes: Task 2-4 全部。
- Produces: 完整联动的桌宠（发送即 thinking 动画+思考行；delta 到达切 talking；面板关闭/错误回 idle）；托盘可开关桌宠；设置页两个新开关（petEnabled/organizerEnabled，改动重启生效提示已有）。

- [ ] **Step 1: 状态联动接线**（PetApp 内 computed/监听 chat 状态）
- [ ] **Step 2: pet_menu_action 分发实现**（search→show_launcher_cmd 同款逻辑；settings→tray::open_settings；organizer→tray::toggle_organizer（仅 enabled）；quit→app.exit(0)）
- [ ] **Step 3: 托盘 + 设置页两开关**
- [ ] **Step 4: 全测 + dev 冒烟（菜单四项/托盘开关/设置开关重启生效）**
- [ ] **Step 5: Commit** — `git commit -m "feat: 桌宠状态联动与菜单托盘设置整合"`

---

### Task 6: Windows 优先收尾（构建配置+验收）

**Files:**
- Modify: `desktop/vite.config.ts`（target 升 es2022）、`desktop/docs/ACCEPTANCE.md`（M2 段）
- Verify: mac 打包冒烟 + Windows 待办清单

- [ ] **Step 1: vite target 升级** `build.target = "es2022"`（移除 chrome109），npm run build 确认（顺带确认现有代码无 109-only 特性依赖被新 target 破坏——升级只会更宽松）
- [ ] **Step 2: mac 打包态冒烟**（`npm run tauri build` + .app 运行：宠物出现/拖拽/穿透/对话流式/菜单；性能：pet+panel 常驻内存记录）
- [ ] **Step 3: ACCEPTANCE.md M2 段**（本机已验证：流式对话全链路（真实网关+ollama，记录首 token 延迟）、拖拽/穿透/位置记忆、菜单托盘、organizer 挂起生效；待 Windows：nsis 构建（无 Win 机——挂 GitHub Actions 或用户自建）、Everything、真机穿透行为；已知边界：ollama 单句 113s（GPU 争用疑云——开放项交用户），首 token 180s 超时）
- [ ] **Step 4: Commit** — `git commit -m "chore: M2 构建升级与验收记录"`

---

## Self-Review 记录

- **Spec 覆盖**：§2 SSE 五事件（T1）、§3 窗口/穿透/拖拽/菜单（T2/T5）、PetSkin 状态机（T3）、对话面板两段式+chips（T4）、organizerEnabled 挂起（T2）、§4 降级表（T1 降级路径/T4 错误气泡）、§5 验收（T6）。缺口自查：spec"点击宠物⇄面板"在 T4；"面板打开保持可交互" T4 Step4；素材 CC0 下载→v1 程序绘制（PetSkin frames 接口预留），与 spec"若无合适素材则程序绘制"一致。
- **占位符扫描**：无 TBD；T1 真实冒烟与 T4 dev 冒烟给了明确观察点。
- **类型一致性**：SSE 事件名五处一致（网关/chat.ts/ChatPanel/测试）；PetMessage 字段与 appendEvent 语义对齐；AppConfig 四字段 Rust 蛇形 serde camelCase ↔ store.ts camelCase；`streamChat` 为 GET（与网关端点一致——T1 契约注明）。
