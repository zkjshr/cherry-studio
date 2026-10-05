# M1b Mac 风格收纳层（Stacks/Dock/Widgets）实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 M1a 检索 Launcher 之上构建 Mac 风格收纳层：透明覆盖层"整理模式"内提供 Stacks 文件归堆、底部 Dock、角落 Widgets（时钟/日历 + WeKnora 知识库速览），桌面文件变更实时反映。

**Architecture:** 新增 `organizer` webview 窗口（透明、最大化、装饰无边框、启动隐藏、热键呼出）。Rust 侧新增桌面/自定义文件夹扫描与 notify 文件监听（变更 emit 事件，前端防抖重扫 + 30s 对账）；归堆规则引擎为 TS 纯函数；Dock 最近使用记 localStorage；WeKnora 速览走网关新增 `/api/recent`（代理 WeKnora `GET /search?recent=true`）。规则/文件夹/热键配置扩展进 AppConfig。

**Tech Stack:** 既有 Tauri 2 + Vue 3 + FastAPI 栈；新增 `dirs`（桌面路径）、`notify`（文件监听）两个 Rust crate，前端无新依赖。

**Spec:** `docs/superpowers/specs/2026-09-27-m1-launcher-design.md` §8 视觉语言、§9 收纳层（用户已确认三件套全套并入 M1；v1 透明覆盖层不动原生图标；壁纸层深度集成是 v2 非目标）。

## Global Constraints

- 沿用 M1a 全部约束：前端 `target: "chrome109"`；毛玻璃必须带 `@supports` 降级；提交信息中文祈使句；客户端无 WeKnora API key；平台差异 `#[cfg(windows)]` 隔离。
- 收纳层常驻内存预算：两窗口合计 <150MB（超预算减 widget 刷新频率）。
- 扫描 500+ 文件桌面 <2s；`fs-changed` 后重扫防抖 500ms；对账周期 30s。
- **交互解释（对本计划的绑定解释）**：spec §9 "失焦点击穿透"实现为——覆盖层是普通可交互窗口，**点击空白背景或失焦即收起**；不实现鼠标钩子级穿透（风险/收益不匹配，联调后再评估）。此解释写入 ACCEPTANCE.md。
- **明确不做（M1b）**：OS 级拖出（拖到 Explorer/Finder）、拖拽入库（M3 ai-action）、堆栈手动重排（堆栈由规则派生）；堆栈内操作 = 打开 / 显示所在文件夹（Cmd/Ctrl+Enter 或右键菜单后续任务）。
- 改配置后需重启生效的既有边界对新增配置项同样适用，ACCEPTANCE.md 需注明。

---

### Task 1: 网关 /api/recent（WeKnora 最近文档）

**Files:**
- Modify: `desktop/gateway/weknora.py`, `desktop/gateway/app.py`
- Test: `desktop/gateway/tests/test_api.py`（追加）

**Interfaces:**
- Produces: `GET /api/recent?limit=30`（Bearer 鉴权）→ `{"results":[同 instant 的 KnowledgeHit 结构],"partial":false}`。WeKnora 侧调 `GET /api/v1/search?recent=true&limit=N&keyword=`（recent 浏览模式，keyword 可为空）。

- [ ] **Step 1: 失败测试（追加到 test_api.py）**

```python
@respx.mock
def test_recent_proxies_recent_mode():
    from gateway.config import settings as s
    s.weknora_base_url = "http://wk.test"
    route = respx.get("http://wk.test/api/v1/search").mock(return_value=httpx.Response(200, json={
        "success": True, "data": [{"id": "r1", "knowledge_base_id": "kb1", "knowledge_base_name": "101-市场运营部", "title": "最新通知", "file_name": "n.md"}], "has_more": False, "total": 1}))
    resp = client.get("/api/recent?limit=30", headers=AUTH)
    assert resp.status_code == 200
    assert resp.json()["results"][0]["title"] == "最新通知"
    assert "recent=true" in str(route.calls.last.request.url) and "limit=30" in str(route.calls.last.request.url)
```

- [ ] **Step 2: 跑测试确认失败** — `cd desktop/gateway && .venv/bin/python -m pytest tests/test_api.py::test_recent_proxies_recent_mode -v`，Expected: FAIL (404)

- [ ] **Step 3: 实现**

`weknora.py` 追加：

```python
async def recent_knowledge(client: httpx.AsyncClient, limit: int) -> list[dict]:
    resp = await client.get(
        f"{settings.weknora_base_url}/api/v1/search",
        params={"recent": "true", "keyword": "", "limit": limit, "offset": 0},
        headers=_headers(),
    )
    resp.raise_for_status()
    out = []
    for k in resp.json().get("data") or []:
        out.append({
            "id": k.get("id"),
            "kb_id": k.get("knowledge_base_id"),
            "kb_name": k.get("knowledge_base_name") or k.get("knowledgeBaseName") or "",
            "title": k.get("title") or k.get("file_name") or "",
            "file_name": k.get("file_name") or "",
            "score": None,
        })
    return out
```

`app.py` 追加端点：

```python
@app.get("/api/recent", dependencies=[Depends(require_token)])
async def recent(limit: int = Query(default=30, le=50)) -> dict:
    async with httpx.AsyncClient(timeout=weknora.TIMEOUT) as client:
        try:
            return {"results": await weknora.recent_knowledge(client, limit), "partial": False}
        except httpx.HTTPError as e:
            raise HTTPException(status_code=502, detail=f"weknora unreachable: {e}")
```

- [ ] **Step 4: 全量测试** — `.venv/bin/python -m pytest tests/ -v`，Expected: 9 passed
- [ ] **Step 5: Commit** — `git add gateway && git commit -m "feat: 网关最近文档接口 /api/recent"`

---

### Task 2: Rust 桌面文件扫描

**Files:**
- Modify: `desktop/src-tauri/Cargo.toml`（+`dirs = "6"`）、`desktop/src-tauri/src/search/mod.rs`（或新 `desktop/src-tauri/src/scan.rs`——**新建 scan.rs**）、`desktop/src-tauri/src/lib.rs`
- Test: `scan.rs` 内 `#[cfg(test)]`

**Interfaces:**
- Produces: `#[derive(Serialize)] #[serde(rename_all = "camelCase")] pub struct FileEntry { pub name: String, pub path: String, pub size_bytes: Option<u64>, pub modified: Option<u64>, pub is_dir: bool }`；`#[tauri::command] async fn desktop_files(folders: Vec<String>) -> Result<Vec<FileEntry>, String>`（参数为自定义文件夹列表；桌面目录自动并入）。纯函数 `pub fn entries_from_dir(path: &Path) -> Vec<FileEntry>`（跳过 `.` 开头隐藏项与 `desktop.ini`/`$RECYCLE.BIN`/`Thumbs.db`）供单测。

- [ ] **Step 1: 失败测试（scan.rs）**

```rust
#[cfg(test)]
mod tests {
    use super::{entries_from_dir, SKIP_NAMES};
    use std::fs;

    #[test]
    fn skips_hidden_and_junk_and_includes_dirs() {
        let dir = std::env::temp_dir().join(format!("tjad-scan-test-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join("方案.dwg"), b"x").unwrap();
        fs::write(dir.join(".hidden"), b"x").unwrap();
        fs::write(dir.join("desktop.ini"), b"x").unwrap();
        fs::create_dir_all(dir.join("子文件夹")).unwrap();
        let entries = entries_from_dir(&dir);
        let names: Vec<&str> = entries.iter().map(|e| e.name.as_str()).collect();
        assert!(names.contains(&"方案.dwg"));
        assert!(names.contains(&"子文件夹"));
        assert!(!names.contains(&".hidden"));
        assert!(!names.contains(&"desktop.ini"));
        let sub = entries.iter().find(|e| e.name == "子文件夹").unwrap();
        assert!(sub.is_dir);
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn skip_list_has_junk() {
        assert!(SKIP_NAMES.contains(&"desktop.ini"));
        assert!(SKIP_NAMES.contains(&"Thumbs.db"));
    }
}
```

- [ ] **Step 2: 跑测试确认失败** — `cd desktop/src-tauri && cargo test scan`，Expected: FAIL（模块不存在）
- [ ] **Step 3: 实现 scan.rs**

```rust
use serde::Serialize;
use std::path::Path;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileEntry {
    pub name: String,
    pub path: String,
    pub size_bytes: Option<u64>,
    pub modified: Option<u64>,
    pub is_dir: bool,
}

pub const SKIP_NAMES: &[&str] = &["desktop.ini", "Thumbs.db", "$RECYCLE.BIN", ".DS_Store"];

pub fn entries_from_dir(path: &Path) -> Vec<FileEntry> {
    let Ok(rd) = std::fs::read_dir(path) else { return vec![] };
    let mut out = Vec::new();
    for entry in rd.flatten() {
        let name = entry.file_name().to_string_lossy().into_owned();
        if name.starts_with('.') || SKIP_NAMES.contains(&name.as_str()) {
            continue;
        }
        let Ok(meta) = entry.metadata() else { continue };
        out.push(FileEntry {
            path: entry.path().to_string_lossy().into_owned(),
            name,
            size_bytes: (!meta.is_dir()).then_some(meta.len()),
            modified: meta
                .modified()
                .ok()
                .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|d| d.as_secs()),
            is_dir: meta.is_dir(),
        });
    }
    out.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    out
}

#[tauri::command]
pub async fn desktop_files(folders: Vec<String>) -> Result<Vec<FileEntry>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let mut dirs: Vec<std::path::PathBuf> = folders.iter().map(std::path::PathBuf::from).collect();
        if let Some(d) = dirs::desktop_dir() {
            if !dirs.iter().any(|p| p == &d) {
                dirs.push(d);
            }
        }
        let mut all: Vec<FileEntry> = dirs.iter().flat_map(|p| entries_from_dir(p)).collect();
        all.dedup_by(|a, b| a.path == b.path);
        Ok(all)
    })
    .await
    .map_err(|e| e.to_string())?
}
```

`Cargo.toml` 依赖区加 `dirs = "6"`；`lib.rs` 加 `mod scan;`，`generate_handler![]` 追加 `desktop_files`。
- [ ] **Step 4: 全绿** — `cargo test && cargo clippy --all-targets -- -D warnings`；手工：`npm run tauri dev` 下暂无调用点（Task 6 接线），控制台无错即可。
- [ ] **Step 5: Commit** — `git add src-tauri && git commit -m "feat: 桌面与自定义文件夹扫描命令"`

---

### Task 3: Rust 文件监听（notify + 重扫事件）

**Files:**
- Modify: `desktop/src-tauri/Cargo.toml`（+`notify = "7"`）、新 `desktop/src-tauri/src/watch.rs`、`desktop/src-tauri/src/lib.rs`
- Test: `watch.rs` 内单测（退避纯函数）

**Interfaces:**
- Consumes: AppConfig.watchedFolders（Task 4 提供——本任务先用空 Vec 起步，Task 4 接线补全）。
- Produces: Tauri 事件 `fs-changed`（payload 为变更路径字符串）；`pub struct WatchState { ... }`（manage 状态，含 watcher 与当前监听目录）；`pub fn backoff_ms(failures: u32) -> u64`（1s/2s/4s…封顶 60s）；`pub fn rebuild_watcher(app: &AppHandle) -> Result<(), String>`（按当前配置重建监听；配置变更后由 set_app_config 调用）。

- [ ] **Step 1: 失败测试**

```rust
#[cfg(test)]
mod tests {
    use super::backoff_ms;

    #[test]
    fn backoff_doubles_and_caps() {
        assert_eq!(backoff_ms(0), 1000);
        assert_eq!(backoff_ms(1), 2000);
        assert_eq!(backoff_ms(3), 16000);
        assert_eq!(backoff_ms(10), 60000);
    }
}
```

- [ ] **Step 2: 确认失败** — `cargo test backoff_ms`，Expected: FAIL
- [ ] **Step 3: 实现 watch.rs**

```rust
use notify::{RecommendedWatcher, RecursiveMode, Watcher};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager};

pub struct WatchState {
    pub watcher: Mutex<Option<RecommendedWatcher>>,
    pub failures: Mutex<u32>,
}

pub fn backoff_ms(failures: u32) -> u64 {
    1000u64.saturating_mul(1 << failures.min(6)).min(60000)
}

fn watched_dirs(folders: &[String]) -> Vec<std::path::PathBuf> {
    let mut dirs: Vec<std::path::PathBuf> = folders.iter().map(std::path::PathBuf::from).collect();
    if let Some(d) = dirs::desktop_dir() {
        if !dirs.iter().any(|p| p == &d) {
            dirs.push(d);
        }
    }
    dirs
}

pub fn rebuild_watcher(app: &AppHandle) -> Result<(), String> {
    let cfg = crate::settings_cmd::get_app_config(app.clone());
    let dirs = watched_dirs(&cfg.watched_folders);
    let emitter = app.clone();
    let (tx, rx) = std::sync::mpsc::channel();
    let mut watcher = notify::recommended_watcher(move |res: Result<notify::Event, notify::Error>| {
        if let Ok(ev) = res {
            let path = ev.paths.first().map(|p| p.to_string_lossy().into_owned()).unwrap_or_default();
            let _ = emitter.emit("fs-changed", path);
        }
    })
    .map_err(|e| e.to_string())?;
    for d in &dirs {
        if d.is_dir() {
            let _ = watcher.watch(d, RecursiveMode::NonRecursive);
        }
    }
    // 消费 rx 防通道堆积：事件经 emitter 直发，rx 仅作 watcher 生命周期载体
    std::thread::spawn(move || { while rx.recv().is_ok() {} });
    let state = app.state::<WatchState>();
    *state.watcher.lock().unwrap() = Some(watcher);
    *state.failures.lock().unwrap() = 0;
    Ok(())
}

/// 周期对账 + 失败退避重建由 lib.rs 的定时任务驱动
#[tauri::command]
pub fn watch_status(app: AppHandle) -> Result<usize, String> {
    let state = app.state::<WatchState>();
    Ok(state.failures.lock().unwrap().clone() as usize)
}
```

注意：`recommended_watcher` 的 tx/rx 需要保活——上面用线程消费 rx；若 `notify::recommended_watcher` 返回值直接持有即可（tx 由 watcher 内部持有），则去掉显式 channel，改为闭包内直接 emit（以 `notify = "7"` 实际 API 为准：`recommended_watcher(event_handler)` 返回 watcher，handler 是 `FnMut`——**闭包直接 emit，不需要 channel**，按此简化实现，上面的 rx 载体代码删除）。

`lib.rs`：`mod watch;`；setup 内 `app.manage(watch::WatchState { watcher: std::sync::Mutex::new(None), failures: std::sync::Mutex::new(0) });`，随后 `if let Err(e) = watch::rebuild_watcher(app.handle()) { eprintln!("watch 初始化失败: {e}"); }`；启动一个 30s 周期任务：`tauri::async_runtime::spawn(async move { loop { tokio::time::sleep(std::time::Duration::from_secs(30)).await; let _ = watch::rebuild_watcher(&handle); } })`（对账即周期重建，简单可靠；`handle` 为 `app.handle().clone()`）。`generate_handler![]` 追加 `watch_status`。
- [ ] **Step 4: 全绿** — `cargo test && cargo clippy --all-targets -- -D warnings`
- [ ] **Step 5: Commit** — `git add src-tauri && git commit -m "feat: notify 文件监听与对账重建"`

---

### Task 4: AppConfig 扩展 + 双热键

**Files:**
- Modify: `desktop/src-tauri/src/settings_cmd.rs`、`desktop/src-tauri/src/hotkey_state.rs`、`desktop/src-tauri/src/lib.rs`、`src/settings/store.ts`、`src/settings/__tests__/store.test.ts`
- Test: store.test.ts 追加；hotkey_state 单测追加

**Interfaces:**
- Produces: AppConfig 新增字段（serde camelCase + serde default，旧 config.json 兼容）：`organizerHotkey: String`（默认 `"alt+d"`）、`watchedFolders: Vec<String>`（默认 `[]`）、`stackRules: Vec<StackRule>`（默认 builtin，见下）；`#[derive(Serialize, Deserialize, Clone)] #[serde(rename_all = "camelCase")] pub struct StackRule { pub id: String, pub label: String, pub kind: String, pub value: String }`（kind ∈ `type`｜`date`｜`keyword`；type=逗号分隔小写扩展名，date=天数，keyword=子串）；hotkey_state 拆为按角色管理：`pub struct Hotkeys { pub launcher: Mutex<String>, pub organizer: Mutex<String> }`，命令 `set_hotkey`（launcher，签名不变）与 `#[tauri::command] pub fn set_organizer_hotkey(app, hotkey: String)`；`pub fn register_or_fallback(app: &AppHandle, role: &str, hotkey: &str) -> String`（返回实际生效键，注册失败回退各自默认：launcher=alt+space、organizer=alt+d）。前端 `AppConfig`（store.ts）同步三字段 + DEFAULTS。

- [ ] **Step 1: 失败测试**

store.test.ts 追加：

```ts
it("新增 M1b 字段有默认值", () => {
  const c = withDefaults({});
  expect(c.organizerHotkey).toBe("alt+d");
  expect(c.watchedFolders).toEqual([]);
  expect(c.stackRules.length).toBeGreaterThanOrEqual(3);
});
```

hotkey_state.rs 测试追加：

```rust
#[test]
fn organizer_fallback_default() {
    assert!(validate("not a key!!").is_err());
}
```

（`validate` 已存在——organizer 复用它；`register_or_fallback` 的回退常量含 organizer 默认 alt+d。）

- [ ] **Step 2: 确认失败** — `npm test`（新用例 FAIL）与 `cargo test`（视实现顺序）
- [ ] **Step 3: 实现**——settings_cmd.rs：`StackRule` 结构 + AppConfig 三字段（各带 `#[serde(default = "...")]`；stack_rules 默认函数返回 builtin 四条：`[{id:"r-doc",label:"文档",kind:"type",value:"doc,docx,pdf,md,txt,rtf"},{id:"r-sheet",label:"表格",kind:"type",value:"xls,xlsx,csv"},{id:"r-img",label:"图片",kind:"type",value:"png,jpg,jpeg,gif,webp,bmp"},{id:"r-recent",label:"最近一周",kind:"date",value:"7"}]`）+ `set_app_config` 无需变化（整包写回）。hotkey_state.rs：把 `CurrentHotkey(pub Mutex<String>)` 重构为 `Hotkeys` 双字段，`set_hotkey` 与新 `set_organizer_hotkey` 走同一内部 `register_for_role`；lib.rs setup：管理 `Hotkeys`，注册 `register_or_fallback(handle,"launcher",cfg.hotkey)` 与 `register_or_fallback(handle,"organizer",cfg.organizer_hotkey)`（替代现有单注册调用），organizer 热键回调 = 切换 `organizer` 窗口可见性（Task 5 提供窗口创建逻辑——本任务先写 `tray::show_organizer_toggle(app)` 占位调用，**该函数在本任务先实现为空逻辑？不行——plan 规则禁止悬空引用**。调整：**Task 5 先行创建 organizer 窗口模块，本任务在 Task 5 之后执行**。交换执行顺序：Task 5 → Task 4。）store.ts：AppConfig 接口 + DEFAULTS 加三字段（stackRules 默认与 Rust builtin 一致的字面量数组）。
- [ ] **Step 4: 全绿** — cargo/npm 全套 + `npm run build`
- [ ] **Step 5: Commit** — `git add src-tauri src/settings && git commit -m "feat: M1b 配置扩展（规则/文件夹/收纳热键）与双热键"`

> **执行顺序说明（覆盖上文编号顺序）**：Task 5（organizer 窗口）在 Task 4 之前执行；Task 4 的热键回调才能接到真实窗口切换。台账按此顺序记录。

---

### Task 5: organizer 窗口与呼出基础设施

**Files:**
- Modify: `desktop/src-tauri/src/tray.rs`、`desktop/src-tauri/src/lib.rs`
- Create: `desktop/src/organizer/Organizer.vue`（本任务为最小骨架：毛玻璃背景 + "整理模式"标题 + 点击空白收起；Stacks/Dock/Widgets 由后续任务填充）

**Interfaces:**
- Produces: 窗口 label `"organizer"`（透明、maximized、decorations(false)、skip_taskbar、visible(false)、always_on_top(false)——覆盖层不必置顶）；`tray.rs::pub fn toggle_organizer(app: &AppHandle)`（不存在则创建后 show，存在则 show/hide 切换；show 时按光标所在屏 maximize——用 `windows.rs::launcher_position` 同款 monitor 查找：新增 `pub fn monitor_of(cursor, monitors) -> (f64,f64,f64,f64)` 并让 launcher_position 复用之）；`on_window_event` 对 organizer 的 `Focused(false)` → hide；`#[tauri::command] pub fn hide_organizer(app)`（前端点击空白调用）。Task 4 的 organizer 热键回调调用 `toggle_organizer`。

- [ ] **Step 1: windows.rs 抽 monitor_of 并保持 launcher_position 测试不破** —— 重构 `launcher_position` 内部为调用 `monitor_of`；现有 2 个测试必须原样通过（行为不变）。
- [ ] **Step 2: tray.rs 增 toggle_organizer** —— 创建参数：`tauri::WebviewWindowBuilder::new(app, "organizer", WebviewUrl::App("organizer.html".into())).title("整理模式").maximized(true).decorations(false).transparent(true).skip_taskbar(true).visible(false).build()`；toggle：`is_visible()` → hide / show+set_focus。
- [ ] **Step 3: 前端多入口 organizer.html** —— `vite.config.ts` input 加 `organizer: resolve(__dirname, "organizer.html")`；`desktop/organizer.html` 同 settings.html 结构（script 指向 `/src/organizer/main.ts`）；`src/organizer/main.ts` 挂载 `Organizer.vue`。
- [ ] **Step 4: Organizer.vue 骨架**

```vue
<template>
  <main class="canvas" data-interactive @click.self="close" @keydown.esc="close" tabindex="0">
    <h1 class="hint">整理模式</h1>
  </main>
</template>
<script setup lang="ts">
import { onMounted } from "vue";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";

async function close() { await invoke("hide_organizer"); void getCurrentWindow(); }
onMounted(() => { document.body.style.background = "transparent"; });
</script>
<style scoped>
.canvas { height: 100vh; background: rgba(18, 18, 20, 0.55); backdrop-filter: blur(40px) saturate(1.2); }
@supports not (backdrop-filter: blur(1px)) { .canvas { background: rgba(18, 18, 20, 0.92); } }
.hint { color: rgba(255,255,255,0.4); font-size: 13px; position: absolute; top: 16px; left: 50%; transform: translateX(-50%); }
</style>
```

`lib.rs`：`#[tauri::command] fn hide_organizer(app: AppHandle) { if let Some(w) = app.get_webview_window("organizer") { let _ = w.hide(); } }` 注册进 handler；`on_window_event` 追加 organizer 失焦隐藏分支。
- [ ] **Step 5: 验证** — cargo/npm 全绿 + `npm run build`；手工：临时在 settings 保存 organizerHotkey 后按 Alt+D（或 Task 4 未完成前用托盘临时入口验证——**用托盘菜单临时加"整理模式"项**，Task 4 完成后热键接管）。
- [ ] **Step 6: Commit** — `git add src-tauri src/organizer organizer.html vite.config.ts && git commit -m "feat: 整理模式覆盖层窗口与呼出切换"`

---

### Task 6: Stacks（规则引擎 + 画布渲染）

**Files:**
- Create: `src/organizer/stacks.ts`（纯函数）、`src/organizer/Stacks.vue`
- Modify: `src/organizer/Organizer.vue`（挂载 Stacks + fs-changed 重扫 + 30s 对账）、`src/launcher/gateway.ts` 无关不动
- Test: `src/organizer/__tests__/stacks.test.ts`

**Interfaces:**
- Consumes: `desktop_files(folders)`（Task 2）、`AppConfig.stackRules`（Task 4，经 `loadConfig()`）、`runAction(item, weknoraUrl?, opts?)`（M1a，open/reveal FileHit）。
- Produces: `stacks.ts`: `interface Stack { id: string; label: string; entries: FileEntry[] }`；`computeStacks(entries: FileEntry[], rules: StackRule[]): Stack[]`（规则序 first-match；`type` 匹配扩展名（小写、含点归一）、`date` 匹配 modified 距今天数 ≤ value、`keyword` 名含子串；无匹配 → `{id:"unsorted", label:"未分类"}`，恒在末位）；`FileEntry` 类型从 Rust 对齐（camelCase，isDir）。

- [ ] **Step 1: 失败测试**

```ts
import { describe, expect, it } from "vitest";
import { computeStacks } from "../stacks";
import type { FileEntry } from "../../launcher/types";

function fe(name: string, modified = Math.floor(Date.now() / 1000), isDir = false): FileEntry {
  return { name, path: "/d/" + name, sizeBytes: 1, modified, isDir };
}
const rules = [
  { id: "r-img", label: "图片", kind: "type", value: "png,jpg" },
  { id: "r-recent", label: "最近一周", kind: "date", value: "7" },
  { id: "r-kw", label: "方案", kind: "keyword", value: "方案" },
];

describe("computeStacks", () => {
  it("类型/日期/关键词按序 first-match，剩余进未分类", () => {
    const day = 86400;
    const s = computeStacks([fe("a.png"), fe("b.doc", Math.floor(Date.now() / 1000) - day * 2), fe("x方案y.zip", 0), fe("其他.txt")], rules);
    expect(s.map((k) => k.label)).toEqual(["图片", "最近一周", "方案", "未分类"]);
    expect(s[0].entries[0].name).toBe("a.png");
    expect(s[2].entries[0].name).toBe("x方案y.zip");
  });
  it("目录参与归堆且未分类恒在末位（可为空则不渲染由 UI 决定）", () => {
    const s = computeStacks([fe("folder", Date.now() / 1000 >> 0, true)], rules);
    expect(s[0].entries[0].isDir).toBe(true);
  });
});
```

（若 `FileEntry` 尚无 `isDir` 字段——Task 2 的 Rust 已带 isDir，前端 types.ts 需补 `isDir: boolean`，在本任务加。）

- [ ] **Step 2: 实现 stacks.ts**（~40 行，按测试语义写：`const ext = name.slice(name.lastIndexOf(".")+1).toLowerCase()`；date 用 `Math.floor(Date.now()/1000) - modified <= Number(value)*86400`；空规则返回 `[{id:"unsorted",label:"未分类",entries}]`）
- [ ] **Step 3: Stacks.vue** —— 桌面顶行横向排列堆栈卡片（毛玻璃小卡 + 图标 + label + 数量角标）；点击卡片展开网格浮层（卡片下方 absolute 弹出，网格列出文件，普通点击 `runAction(entry, weknoraWebUrl)` 打开、Cmd/Ctrl+点击 reveal——`weknoraWebUrl` 由 Organizer.vue 传入）；再次点击收起；浮层点击外部关闭。数据流：Organizer.vue onMounted `loadConfig()` → `stackRules` + `watchedFolders` → `invoke<FileEntry[]>("desktop_files", { folders })` → `computeStacks`；监听 `listen<string>("fs-changed", …)` 防抖 500ms 重扫 + `setInterval` 30s 对账重扫（对账与防抖共用同一 `rescan()`）。
- [ ] **Step 4: 测试与构建** — `npm test && npm run build`（stacks 用例 + 既有全绿）
- [ ] **Step 5: Commit** — `git add src/organizer && git commit -m "feat: Stacks 规则引擎与画布归堆渲染"`

---

### Task 7: Dock（底部栏）

**Files:**
- Create: `src/organizer/Dock.vue`
- Modify: `src/organizer/Organizer.vue`（底部挂载）

**Interfaces:**
- Consumes: `runAction`（`open-settings` 动作、`open-url:` 动作）；`tray::show_launcher` 需 Tauri 命令暴露——**新增 `#[tauri::command] pub fn show_launcher_cmd(app: AppHandle)`**（tray.rs `show_launcher` 已 pub，包一层）注册 handler。
- Produces: Dock 固定项：知识库网页（`open-url:<cfg.weknoraWebUrl>`）、检索（`show_launcher_cmd`）、设置（`open-settings`）；"最近使用"区：localStorage 键 `tjadknows.recent-files`（`FileEntry[]`，上限 8，最新在前）。打开行为统一走 `runAction` 后调用 `recordRecent(entry)`（导出 `recordRecent`/`loadRecent` 于 `src/organizer/recent.ts`，Stacks.vue 的 open 分支也调用它）。

- [ ] **Step 1: recent.ts（TDD）** —— `src/organizer/__tests__/recent.test.ts`：

```ts
import { describe, expect, it } from "vitest";
import { dedupeRecent } from "../recent";

describe("dedupeRecent", () => {
  it("按 path 去重、最新在前、上限 8", () => {
    const a = { name: "a", path: "/a", sizeBytes: null, modified: null, isDir: false };
    const b = { ...a, path: "/b" };
    const out = dedupeRecent([a, b, { ...a, path: "/a" }], 8);
    expect(out.map((x) => x.path)).toEqual(["/a", "/b"]);
  });
});
```

实现 `recent.ts`：`dedupeRecent(list, cap)` 纯函数 + `recordRecent(entry)`（localStorage 读写 try/catch）+ `loadRecent()`。
- [ ] **Step 2: Dock.vue** —— 底部居中毛玻璃圆角条：固定三项（SVG/文字图标：知识库/检索/设置）+ 分隔线 + 最近使用文件名（超长省略，点击 `runAction(entry, …)` 打开）；hover 浮起动效（120ms transform）。`show_launcher_cmd` 前端经 `invoke` 调用。
- [ ] **Step 3: 接线** —— Stacks.vue 打开文件处调用 `recordRecent`；Organizer.vue 挂载 Dock。
- [ ] **Step 4: 全绿 + Commit** — `npm test && npm run build`；`git add src/organizer src-tauri/src/tray.rs src-tauri/src/lib.rs && git commit -m "feat: 底部 Dock 与最近使用"`

---

### Task 8: Widgets（时钟/日历 + WeKnora 速览）

**Files:**
- Create: `src/organizer/Widgets.vue`
- Modify: `src/organizer/Organizer.vue`（右上角挂载）、`src/launcher/gateway.ts`（+`fetchRecent`）

**Interfaces:**
- Consumes: `GET /api/recent`（Task 1）、`cfg.weknoraWebUrl`、`runAction`（点条目打开知识结果）。
- Produces: `gateway.ts::fetchRecent(cfg, signal?): Promise<KnowledgeHit[]>`；Widgets：左上角时钟/日历卡（`setInterval` 1s 更新时间，日期中文格式 `2026年9月27日 周日`，`toLocaleDateString("zh-CN", { weekday: "long" })`）；右上角 WeKnora 速览卡：今日新增数（`recent` 结果中 `updated_at` 为今天的条数——**WeKnora recent 返回字段以实测为准：若无时间字段则显示"最近文档"列表不带计数**，实现需容错）、最近 5 条标题列表，点标题 `runAction(hit, weknoraWebUrl)`，点卡片头 `open-url:<weknoraWebUrl>`；60s 刷新 + 网关失败静默（显示"网关不可达"）。

- [ ] **Step 1: gateway.ts 追加 fetchRecent**

```ts
export async function fetchRecent(cfg: GatewayConfig, signal?: AbortSignal): Promise<KnowledgeHit[]> {
  const body = await get(cfg, "/api/recent?limit=30", signal) as { results: KnowledgeHit[] };
  return body.results ?? [];
}
```

- [ ] **Step 2: Widgets.vue 实现**（时钟 `const now = ref(new Date())` + interval；速览卡按上述容错逻辑；样式沿用 `.frost` 与 --radius 变量；两卡均为 `data-interactive`）
- [ ] **Step 3: 全绿 + Commit** — `npm test && npm run build`；`git add src/organizer src/launcher/gateway.ts && git commit -m "feat: 时钟日历与 WeKnora 速览 Widgets"`

---

### Task 9: 设置页 M1b 项

**Files:**
- Modify: `src/settings/Settings.vue`、`src/settings/store.ts`（如 Task 4 未覆盖完整）

**Interfaces:**
- Consumes: AppConfig 三新字段（Task 4）。
- Produces: 设置页新增三块——收纳热键输入框（isValidHotkey 校验，同现有热键）；监视文件夹列表（input + 添加/删除按钮，`watchedFolders: string[]`）；归堆规则编辑器（行式：label 输入 + kind 下拉（type/date/keyword）+ value 输入 + 删除按钮 + "添加规则"按钮；type value 占位提示"扩展名逗号分隔"，date 提示"天数"，keyword 提示"名称包含"）。保存链复用现有 saveConfig。

- [ ] **Step 1: Settings.vue 追加三块 UI**（v-model 绑定 `cfg.organizerHotkey` / `cfg.watchedFolders` / `cfg.stackRules`；数组编辑用本地 ref 深拷贝 + 保存时写回；`isValidHotkey` 复用 store.ts 导出）
- [ ] **Step 2: 全绿** — `npm test && npm run build`；手工：托盘→设置，加一条 keyword 规则与一个自定义文件夹，保存后重启应用生效（重启生效边界，ACCEPTANCE 注明）。
- [ ] **Step 3: Commit** — `git add src/settings && git commit -m "feat: 设置页收纳热键/监视文件夹/归堆规则编辑"`

---

### Task 10: 验收与打包

**Files:**
- Modify: `desktop/docs/ACCEPTANCE.md`
- Verify: 构建与性能预算

- [ ] **Step 1: 构建验证** — `npm run tauri build`（dmg 更新产出）；运行打包态应用（非 dev）核对整理模式呼出/收起、毛玻璃、托盘不受影响。
- [ ] **Step 2: 性能核对** — 大桌面（≥300 文件）扫描 <2s；两窗口常驻内存合计 <150MB（活动监视器记录数字进 ACCEPTANCE）。
- [ ] **Step 3: ACCEPTANCE.md 增 M1b 段**——本机已验证：整理模式呼出/收起、堆栈归堆、Dock、Widgets、fs-changed 重扫（手工 touch 文件）；待人工/联调：Windows 真机（notify 行为、桌面路径 known-folder、自定义文件夹网络盘降级）、WeKnora recent 字段实测（今日计数是否可用）、OS 拖出与拖拽入库（M3）、配置重启生效说明、点击空白收起（spec 穿透解释）。
- [ ] **Step 4: Commit** — `git add docs/ACCEPTANCE.md && git commit -m "docs: M1b 验收记录与已知边界"`

---

## Self-Review 记录

- **Spec 覆盖**：§9 三件套——Stacks（T2/T3/T6）、Dock（T7）、Widgets（T1/T8）；视觉语言 §8（各组件 .frost/.radius）；v1 覆盖层不动原生图标（T5 独立窗口）；配置（T4/T9）；性能与验收（T10）。**缺口检查**：spec "扇形/网格展开"实现为网格（扇形属纯装饰，网格信息密度更高——记录为解释而非缺失）；"拖出/拖拽入库"按 spec 自身归 M3；穿透交互按绑定解释降级为"点击空白收起"。
- **占位符扫描**：Task 3 对 notify API 的两种形态给了明确取舍指令（闭包直 emit，删除 channel 载体）；Task 8 WeKnora recent 字段容错双路径；无 TBD。
- **类型一致性**：`FileEntry` camelCase + `isDir`（Rust serde ↔ TS types.ts 补字段，T6 标注）；`StackRule` 四字段（Rust serde camelCase ↔ store.ts/stacks.ts 同名）；`fetchRecent` 签名与 `get()` 现有 signal 参数兼容；T4↔T5 执行顺序交换已在文内显式声明。
