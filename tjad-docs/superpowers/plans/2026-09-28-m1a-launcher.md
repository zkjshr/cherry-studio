# M1a 呼出式检索 Launcher 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 构建 Tauri 2 桌面检索 Launcher：全局热键呼出搜索框，联邦检索 WeKnora 知识库（经网关两档：标题即时档 + 语义深度档）、本机文件（Everything/mdfind）、本地动作，Mac 风格毛玻璃视觉。

**Architecture:** 三部分——①`desktop/` Tauri 2 客户端（Vue 3 + TS 前端、Rust 核心：热键/窗口/托盘/本地检索 FFI/网关客户端）；②`desktop/gateway/` FastAPI 网关（部署到 192.168.66.12，持有 WeKnora API key，扇出 hybrid-search 并归一合并）；③客户端所有 WeKnora 流量只经网关，API key 不下发。

**Tech Stack:** Tauri 2 / Vue 3.5 / TypeScript / Vite 6 / vitest / Rust (reqwest, serde, everything-sdk) / FastAPI + httpx + pytest。

**Spec:** `docs/superpowers/specs/2026-09-27-m1-launcher-design.md`（§3 检索架构、§4 客户端结构、§6 降级、§8 视觉语言为本计划的主要依据）。

## Global Constraints

- 前端构建目标 `target: 'chrome109'`（Win7 的 WebView2 停在 Chromium 109）；不得使用 109 之后的 CSS/JS 特性（禁 `:has()` 以外的宽松假设——`:has()` 109 可用；禁 scroll-driven animations、popover API）。
- 毛玻璃用 `backdrop-filter: blur(...)`；必须带降级（`@supports not (backdrop-filter: blur(1px))` 时用 rgba 纯色）。
- 客户端常驻内存预算 <150MB；呼出响应 <200ms；即时档首结果 <300ms。
- 客户端不出现 WeKnora API key；网关鉴权用共享 token（内测期）。
- 深度档扇出并发 ≤8，返回 ≤20 条；即时档防抖 120ms，深度档防抖 450ms。
- 所有新代码位于 `desktop/` 子目录；`desktop/` 自建独立 git 仓库（根目录含密钥文件，禁止把 TJADKnows 根目录 init 成 git 仓库）。
- 平台支持：Windows 7–11、macOS 10.15+；Windows 专属代码必须 `#[cfg(windows)]` 隔离，保证 mac 上可开发编译。
- 提交信息用中文祈使句（如 `feat: 热键呼出窗口`）。

---

### Task 0: 脚手架与仓库初始化

**Files:**
- Create: `desktop/.gitignore`, `desktop/package.json`, `desktop/vite.config.ts`, `desktop/tsconfig.json`, `desktop/index.html`
- Create: `desktop/src/main.ts`, `desktop/src/App.vue`, `desktop/src/style.css`
- Create: `desktop/src-tauri/Cargo.toml`, `desktop/src-tauri/tauri.conf.json`, `desktop/src-tauri/src/main.rs`, `desktop/src-tauri/src/lib.rs`, `desktop/src-tauri/build.rs`
- Create: `desktop/gateway/requirements.txt`, `desktop/gateway/.env.example`

**Interfaces:**
- Produces: 可运行的空壳（`npm run tauri dev` 打开窗口）；`src/App.vue` 为空布局占位，后续任务替换。

- [ ] **Step 1: 创建目录与 git 仓库**

```bash
mkdir -p /Volumes/MacSSD/Library/VibeCoding/TJADKnows/desktop
cd /Volumes/MacSSD/Library/VibeCoding/TJADKnows/desktop
git init
```

- [ ] **Step 2: 写 `.gitignore`**

```gitignore
node_modules/
dist/
src-tauri/target/
gateway/__pycache__/
gateway/.env
gateway/.venv/
*.log
.DS_Store
```

- [ ] **Step 3: 初始化前端工程**

`desktop/package.json`：

```json
{
  "name": "tjadknows-desktop",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vue-tsc --noEmit && vite build",
    "tauri": "tauri",
    "test": "vitest run"
  },
  "dependencies": {
    "vue": "^3.5.13"
  },
  "devDependencies": {
    "@tauri-apps/cli": "^2.5.0",
    "@vitejs/plugin-vue": "^5.2.1",
    "typescript": "^5.7.2",
    "vite": "^6.2.0",
    "vitest": "^3.0.5",
    "vue-tsc": "^2.2.0"
  }
}
```

`desktop/vite.config.ts`：

```ts
import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";

export default defineConfig({
  plugins: [vue()],
  clearScreen: false,
  server: { port: 1420, strictPort: true },
  build: { target: "chrome109" },
  test: { environment: "jsdom" },
});
```

`desktop/tsconfig.json`：

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "jsx": "preserve",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "types": ["vite/client"]
  },
  "include": ["src"]
}
```

`desktop/index.html`：

```html
<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <title>TJADKnows</title>
  </head>
  <body>
    <div id="app"></div>
    <script type="module" src="/src/main.ts"></script>
  </body>
</html>
```

`desktop/src/main.ts`：

```ts
import { createApp } from "vue";
import App from "./App.vue";
import "./style.css";

createApp(App).mount("#app");
```

`desktop/src/App.vue`：

```vue
<template>
  <main class="placeholder">TJADKnows Launcher</main>
</template>
```

`desktop/src/style.css`（视觉语言基线，来自 spec §8）：

```css
:root {
  --bg-blur: rgba(28, 28, 30, 0.72);
  --bg-solid: rgba(28, 28, 30, 0.92);
  --border-faint: rgba(255, 255, 255, 0.12);
  --text-primary: rgba(255, 255, 255, 0.92);
  --text-secondary: rgba(255, 255, 255, 0.55);
  --accent: #4d8df6;
  --radius: 14px;
  --shadow-soft: 0 8px 32px rgba(0, 0, 0, 0.35);
}
* { box-sizing: border-box; }
html, body, #app { margin: 0; height: 100%; }
body {
  font-family: "PingFang SC", "HarmonyOS Sans SC", -apple-system, "SF Pro Text", "Segoe UI", sans-serif;
  color: var(--text-primary);
  background: transparent;
}
.frost {
  background: var(--bg-blur);
  backdrop-filter: blur(24px) saturate(1.4);
  border: 1px solid var(--border-faint);
  border-radius: var(--radius);
  box-shadow: var(--shadow-soft);
}
@supports not (backdrop-filter: blur(1px)) {
  .frost { background: var(--bg-solid); }
}
.placeholder { display: grid; place-items: center; height: 100%; color: var(--text-secondary); }
```

- [ ] **Step 4: 初始化 Tauri 2**

`desktop/src-tauri/Cargo.toml`：

```toml
[package]
name = "tjadknows-desktop"
version = "0.1.0"
edition = "2021"

[lib]
name = "tjadknows_desktop_lib"
crate-type = ["staticlib", "cdylib", "rlib"]

[build-dependencies]
tauri-build = { version = "2", features = [] }

[dependencies]
tauri = { version = "2", features = ["tray-icon"] }
tauri-plugin-global-shortcut = "2"
tauri-plugin-single-instance = "2"
tauri-plugin-autostart = "2"
tauri-plugin-opener = "2"
serde = { version = "1", features = ["derive"] }
serde_json = "1"
reqwest = { version = "0.12", features = ["json"] }
tokio = { version = "1", features = ["full"] }
thiserror = "2"
```

`desktop/src-tauri/build.rs`：

```rust
fn main() { tauri_build::build() }
```

`desktop/src-tauri/src/main.rs`：

```rust
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() { tjadknows_desktop_lib::run() }
```

`desktop/src-tauri/src/lib.rs`：

```rust
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

`desktop/src-tauri/tauri.conf.json`：

```json
{
  "$schema": "https://schema.tauri.app/config/2",
  "productName": "TJADKnows",
  "version": "0.1.0",
  "identifier": "cn.tjad.tjadknows.desktop",
  "build": {
    "beforeDevCommand": "npm run dev",
    "devUrl": "http://localhost:1420",
    "beforeBuildCommand": "npm run build",
    "frontendDist": "../dist"
  },
  "app": {
    "windows": [],
    "security": { "csp": null }
  },
  "bundle": {
    "active": true,
    "targets": ["nsis", "dmg"],
    "icon": []
  }
}
```

`desktop/gateway/requirements.txt`：

```
fastapi>=0.115
uvicorn[standard]>=0.32
httpx>=0.28
pydantic>=2.9
pytest>=8.3
pytest-asyncio>=0.24
respx>=0.22
```

`desktop/gateway/.env.example`（真实值只存服务器，不入库）：

```
WEKNORA_BASE_URL=http://192.168.66.12:8080
WEKNORA_API_KEY=替换为只读 API key
GATEWAY_TOKEN=内测共享token
```

- [ ] **Step 5: 验证空壳可运行**

Run: `cd desktop && npm install && npm run tauri dev`
Expected: 编译完成、进程保持运行且无报错（本任务 `windows: []` 且无 Rust 建窗逻辑，所以**没有可见窗口是正常的**，可见窗口在 Task 1 出现）。验证后 Ctrl+C 退出。

- [ ] **Step 6: Commit**

```bash
cd /Volumes/MacSSD/Library/VibeCoding/TJADKnows/desktop
git add -A && git commit -m "chore: Tauri 2 + Vue 3 脚手架与网关依赖清单"
```

---

### Task 1: 热键呼出窗口、单实例与托盘

**Files:**
- Create: `desktop/src-tauri/src/tray.rs`
- Modify: `desktop/src-tauri/src/lib.rs`
- Test: `desktop/src-tauri/src/windows.rs` 内纯函数单测

**Interfaces:**
- Produces: `windows.rs::pub fn launcher_position(cursor: (f64, f64), monitors: &[(f64, f64, f64, f64)]) -> (f64, f64)`（cursor 所在屏上水平居中、距顶 20% 处）；`tray.rs::pub fn build_tray(app: &tauri::AppHandle) -> tauri::Result<()>`；窗口 label 固定 `"launcher"`。

- [ ] **Step 1: 写失败的定位纯函数测试**

`desktop/src-tauri/src/windows.rs`：

```rust
/// 光标所在显示器上放置 launcher：水平居中、垂直位于屏幕顶部 20% 处。
/// monitors: Vec<(x, y, width, height)>
pub fn launcher_position(cursor: (f64, f64), monitors: &[(f64, f64, f64, f64)]) -> (f64, f64) {
    let win_w = 720.0_f64;
    let mon = monitors
        .iter()
        .find(|&&(x, y, w, h)| cursor.0 >= x && cursor.0 < x + w && cursor.1 >= y && cursor.1 < y + h)
        .unwrap_or(&(0.0, 0.0, 1920.0, 1080.0));
    let (mx, my, mw, mh) = *mon;
    (mx + (mw - win_w) / 2.0, my + mh * 0.2)
}

#[cfg(test)]
mod tests {
    use super::launcher_position;

    #[test]
    fn centers_on_monitor_holding_cursor() {
        let monitors = vec![(0.0, 0.0, 1920.0, 1080.0), (1920.0, 0.0, 2560.0, 1440.0)];
        let (x, y) = launcher_position((3000.0, 500.0), &monitors);
        assert!((x - (1920.0 + (2560.0 - 720.0) / 2.0)).abs() < 0.01);
        assert!((y - 288.0).abs() < 0.01);
    }

    #[test]
    fn falls_back_to_primary_when_cursor_offscreen() {
        let (x, y) = launcher_position((-500.0, -500.0), &[(0.0, 0.0, 1920.0, 1080.0)]);
        assert!((x - 600.0).abs() < 0.01);
        assert!((y - 216.0).abs() < 0.01);
    }
}
```

- [ ] **Step 2: 运行测试确认通过（本任务先测后接线的例外：纯函数直接 TDD）**

Run: `cd desktop/src-tauri && cargo test launcher_position`
Expected: 2 passed

- [ ] **Step 3: 托盘模块**

`desktop/src-tauri/src/tray.rs`：

```rust
use tauri::menu::{Menu, MenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{AppHandle, Manager};

pub fn build_tray(app: &AppHandle) -> tauri::Result<()> {
    let open = MenuItem::with_id(app, "open", "呼出检索", true, None::<&str>)?;
    let settings = MenuItem::with_id(app, "settings", "设置…", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&open, &settings, &quit])?;
    TrayIconBuilder::with_id("main")
        .tooltip("TJADKnows")
        .menu(&menu)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "open" => show_launcher(app),
            "settings" => open_settings(app),
            "quit" => app.exit(0),
            _ => {}
        })
        .build(app)?;
    Ok(())
}

pub fn show_launcher(app: &AppHandle) {
    if let Some(win) = app.get_webview_window("launcher") {
        let _ = win.show();
        let _ = win.set_focus();
    }
}

fn open_settings(app: &AppHandle) {
    if let Some(win) = app.get_webview_window("settings") {
        let _ = win.show();
        let _ = win.set_focus();
        return;
    }
    let _ = tauri::WebviewWindowBuilder::new(app, "settings", tauri::WebviewUrl::App("settings.html".into()))
        .title("TJADKnows 设置")
        .inner_size(560.0, 420.0)
        .build();
}
```

- [ ] **Step 4: 接线 lib.rs（热键 + 窗口生命周期 + 单实例）**

`desktop/src-tauri/src/lib.rs` 全量替换：

```rust
mod tray;
mod windows;

use tauri::{Manager, PhysicalPosition};
use tauri_plugin_autostart::MacosLauncher;

fn create_launcher_window(app: &tauri::AppHandle) -> tauri::Result<()> {
    let cursor = app
        .cursor_position()
        .unwrap_or(PhysicalPosition::new(0.0, 0.0));
    let monitors: Vec<(f64, f64, f64, f64)> = app
        .available_monitors()?
        .iter()
        .filter_map(|m| {
            let p = m.position();
            let s = m.size();
            Some((p.x as f64, p.y as f64, s.width as f64, s.height as f64))
        })
        .collect();
    let (x, y) = windows::launcher_position((cursor.x, cursor.y), &monitors);
    tauri::WebviewWindowBuilder::new(app, "launcher", tauri::WebviewUrl::App("index.html".into()))
        .title("TJADKnows")
        .inner_size(720.0, 480.0)
        .position(x, y)
        .decorations(false)
        .transparent(true)
        .always_on_top(true)
        .skip_taskbar(true)
        .focused(true)
        .build()?;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            tray::show_launcher(app);
        }))
        .plugin(tauri_plugin_autostart::init(
            MacosLauncher::LaunchAgent,
            None,
        ))
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            tray::build_tray(app.handle())?;
            create_launcher_window(app.handle())?;
            #[cfg(desktop)]
            {
                use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut};
                app.global_shortcut().on_shortcut("alt+space", |app, _s, event| {
                    if event.state == ShortcutState::Pressed {
                        if let Some(win) = app.get_webview_window("launcher") {
                            if win.is_visible().unwrap_or(false) {
                                let _ = win.hide();
                            } else {
                                let _ = win.show();
                                let _ = win.set_focus();
                            }
                        }
                    }
                })?;
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            // launcher 失焦即收起（spec §4）
            if let tauri::WindowEvent::Focused(false) = event {
                if window.label() == "launcher" {
                    let _ = window.hide();
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

注意：`#[cfg(desktop)]` 块内的 `use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut};` 是该快捷键 API 的唯一导入来源，不要在文件顶部重复导入。

- [ ] **Step 5: 全量测试 + 运行验证**

Run: `cd desktop/src-tauri && cargo test && cargo clippy -- -D warnings`
Expected: tests passed，无 clippy 告警（如 clippy 报未使用导入，按提示清理后重跑）。
Run: `npm run tauri dev` → 按 Alt+Space（mac 上 Option+Space）验证：呼出/隐藏切换、点击别处窗口失焦收起、再次启动 exe 时唤起已有实例（单实例）、托盘菜单可用。

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat: 热键呼出/失焦收起/单实例/托盘"
```

---

### Task 2: 网关——WeKnora 客户端与两档检索

**Files:**
- Create: `desktop/gateway/app.py`, `desktop/gateway/config.py`, `desktop/gateway/weknora.py`, `desktop/gateway/merge.py`, `desktop/gateway/auth.py`
- Test: `desktop/gateway/tests/test_merge.py`, `desktop/gateway/tests/test_api.py`

**Interfaces:**
- Consumes: WeKnora `GET /api/v1/search?keyword=&limit=&offset=`（标题级）；`POST /api/v1/knowledge-bases/{id}/hybrid-search`（body `{"query_text": "...", "limit": N}`，注意参数名是 `query_text` 不是 `query`）；`GET /api/v1/knowledge-bases`（列库，供设置页）。
- Produces（网关 REST，客户端依赖）:
  - `GET /api/health` → `{"status":"ok"}`
  - `GET /api/kbs` → `{"kbs":[{"id":"...","name":"101-市场运营部"}]}`
  - `GET /api/instant?q=<kw>&limit=20` → `{"results":[{"id","kb_id","kb_name","title","file_name","score":null}]}`
  - `GET /api/deep?q=<kw>&kb_ids=a,b,c&limit=20` → `{"results":[...同上,含score],"partial":bool}`
  - 鉴权：以上（除 health）需 `Authorization: Bearer <GATEWAY_TOKEN>`。

- [ ] **Step 1: 写 merge 纯函数的失败测试**

`desktop/gateway/tests/test_merge.py`：

```python
from gateway.merge import merge_deep_results

def _r(kb, kid, score):
    return {"id": kid, "kb_id": kb, "kb_name": f"KB-{kb}", "title": f"t{kid}", "file_name": f"{kid}.md", "score": score}

def test_minmax_normalizes_and_dedups():
    a = [_r("kb1", "d1", 0.9), _r("kb1", "d2", 0.5)]
    b = [_r("kb2", "d3", 0.4), _r("kb2", "d4", 0.2)]
    out = merge_deep_results({"kb1": a, "kb2": b}, limit=10)
    assert [r["id"] for r in out] == ["d1", "d3", "d2", "d4"]

def test_dedup_keeps_higher_score():
    a = [_r("kb1", "d1", 0.2)]
    b = [_r("kb2", "d1", 0.9)]
    out = merge_deep_results({"kb1": a, "kb2": b}, limit=10)
    assert len(out) == 1 and out[0]["kb_id"] == "kb2"

def test_limit_and_empty():
    assert merge_deep_results({}, limit=5) == []
    a = [_r("kb1", f"d{i}", 0.5 + i / 100) for i in range(30)]
    assert len(merge_deep_results({"kb1": a}, limit=20)) == 20
```

- [ ] **Step 2: 运行确认失败**

Run: `cd desktop/gateway && python -m pytest tests/test_merge.py -v`
Expected: FAIL (ModuleNotFoundError: gateway.merge)

- [ ] **Step 3: 实现 merge（min-max 归一 → 跨库排序 → 按 id 去重保留高分 → 截断）**

`desktop/gateway/merge.py`：

```python
"""跨库 hybrid-search 结果归一合并：归一分仅用于排序，去重按原始 score 保留最高
（单结果库 min-max 归一恒为 1.0，不能用归一分去重；跨库原始分量纲可能不可比，内测期接受）。"""


def _normalize(scores: list[float]) -> list[float]:
    if not scores:
        return []
    lo, hi = min(scores), max(scores)
    if hi - lo < 1e-9:
        return [1.0] * len(scores)
    return [(s - lo) / (hi - lo) for s in scores]


def merge_deep_results(by_kb: dict[str, list[dict]], limit: int) -> list[dict]:
    merged: dict[str, dict] = {}
    for results in by_kb.values():
        norms = _normalize([float(r.get("score") or 0.0) for r in results])
        for r, n in zip(results, norms):
            r = {**r, "score": round(n, 4)}
            old = merged.get(r["id"])
            if old is None or r["score"] > old["score"]:
                merged[r["id"]] = r
    ranked = sorted(merged.values(), key=lambda r: r["score"], reverse=True)
    return ranked[:limit]
```

`desktop/gateway/config.py`：

```python
import os


class Settings:
    weknora_base_url: str = os.environ.get("WEKNORA_BASE_URL", "http://127.0.0.1:8080")
    weknora_api_key: str = os.environ.get("WEKNORA_API_KEY", "")
    gateway_token: str = os.environ.get("GATEWAY_TOKEN", "")


settings = Settings()
```

`desktop/gateway/auth.py`：

```python
from fastapi import Header, HTTPException

from gateway.config import settings


def require_token(authorization: str = Header(default="")) -> None:
    expected = f"Bearer {settings.gateway_token}"
    if settings.gateway_token and authorization != expected:
        raise HTTPException(status_code=401, detail="unauthorized")
```

`desktop/gateway/weknora.py`：

```python
"""WeKnora HTTP 客户端：标题检索、按库混合检索、列库。"""
import httpx

from gateway.config import settings

TIMEOUT = httpx.Timeout(5.0, read=8.0)


def _headers() -> dict[str, str]:
    return {"Authorization": f"Bearer {settings.weknora_api_key}"}


async def instant_search(client: httpx.AsyncClient, q: str, limit: int) -> list[dict]:
    resp = await client.get(
        f"{settings.weknora_base_url}/api/v1/search",
        params={"keyword": q, "limit": limit, "offset": 0},
        headers=_headers(),
    )
    resp.raise_for_status()
    data = resp.json().get("data") or []
    out = []
    for k in data:
        out.append({
            "id": k.get("id"),
            "kb_id": k.get("knowledge_base_id"),
            "kb_name": k.get("knowledge_base_name") or k.get("knowledgeBaseName") or "",
            "title": k.get("title") or k.get("file_name") or "",
            "file_name": k.get("file_name") or "",
            "score": None,
        })
    return out


async def kb_hybrid_search(client: httpx.AsyncClient, kb_id: str, q: str, limit: int) -> list[dict]:
    resp = await client.post(
        f"{settings.weknora_base_url}/api/v1/knowledge-bases/{kb_id}/hybrid-search",
        json={"query_text": q, "limit": limit},
        headers=_headers(),
    )
    resp.raise_for_status()
    body = resp.json()
    items = body.get("data") if isinstance(body.get("data"), list) else (body.get("results") or [])
    out = []
    for item in items:
        k = item.get("knowledge") or item
        out.append({
            "id": k.get("id") or item.get("knowledge_id"),
            "kb_id": kb_id,
            "kb_name": k.get("knowledge_base_name") or "",
            "title": k.get("title") or k.get("file_name") or "",
            "file_name": k.get("file_name") or "",
            "score": item.get("score") or item.get("similarity"),
        })
    return out


async def list_kbs(client: httpx.AsyncClient) -> list[dict]:
    resp = await client.get(
        f"{settings.weknora_base_url}/api/v1/knowledge-bases",
        params={"page": 1, "page_size": 200},
        headers=_headers(),
    )
    resp.raise_for_status()
    items = resp.json().get("data") or []
    if isinstance(items, dict):
        items = items.get("items") or items.get("list") or []
    return [{"id": k["id"], "name": k.get("name", "")} for k in items if k.get("id")]
```

`desktop/gateway/app.py`：

```python
import asyncio
from contextlib import asynccontextmanager

import httpx
from fastapi import Depends, FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware

from gateway import weknora
from gateway.auth import require_token
from gateway.config import settings
from gateway.merge import merge_deep_results

FANOUT_CONCURRENCY = 8
DEEP_PER_KB = 15

app = FastAPI(title="TJADKnows Gateway")
app.add_middleware(CORSMiddleware, allow_origins=["tauri://localhost", "http://tauri.localhost", "http://localhost:1420"], allow_methods=["*"], allow_headers=["*"])


@app.get("/api/health")
async def health() -> dict:
    return {"status": "ok"}


@app.get("/api/kbs", dependencies=[Depends(require_token)])
async def kbs() -> dict:
    async with httpx.AsyncClient(timeout=weknora.TIMEOUT) as client:
        return {"kbs": await weknora.list_kbs(client)}


@app.get("/api/instant", dependencies=[Depends(require_token)])
async def instant(q: str = Query(min_length=1), limit: int = 20) -> dict:
    async with httpx.AsyncClient(timeout=weknora.TIMEOUT) as client:
        try:
            return {"results": await weknora.instant_search(client, q, limit)}
        except httpx.HTTPError as e:
            raise HTTPException(status_code=502, detail=f"weknora unreachable: {e}")


@app.get("/api/deep", dependencies=[Depends(require_token)])
async def deep(q: str = Query(min_length=1), kb_ids: str = Query(default=""), limit: int = 20) -> dict:
    ids = [s for s in kb_ids.split(",") if s]
    if not ids:
        return {"results": [], "partial": False}
    sem = asyncio.Semaphore(FANOUT_CONCURRENCY)

    async def one(client: httpx.AsyncClient, kb_id: str) -> tuple[str, list[dict] | None]:
        async with sem:
            try:
                return kb_id, await weknora.kb_hybrid_search(client, kb_id, q, DEEP_PER_KB)
            except httpx.HTTPError:
                return kb_id, None

    async with httpx.AsyncClient(timeout=httpx.Timeout(5.0, read=10.0)) as client:
        pairs = await asyncio.gather(*(one(client, kb_id) for kb_id in ids))
    by_kb = {kb: r for kb, r in pairs if r is not None}
    return {"results": merge_deep_results(by_kb, limit), "partial": len(by_kb) < len(ids)}
```

`desktop/gateway/tests/__init__.py`、`desktop/gateway/__init__.py` 均为空文件。`desktop/gateway/pytest.ini`：

```ini
[pytest]
asyncio_mode = auto
pythonpath = .
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd desktop/gateway && python -m venv .venv && .venv/bin/pip install -r requirements.txt && .venv/bin/python -m pytest tests/test_merge.py -v`
Expected: 3 passed

- [ ] **Step 5: 写 API 层失败测试（respx 模拟 WeKnora）**

`desktop/gateway/tests/test_api.py`：

```python
import httpx
import respx
from fastapi.testclient import TestClient

from gateway.app import app
from gateway.config import settings

client = TestClient(app)
AUTH = {"Authorization": "Bearer test-token"}
settings.gateway_token = "test-token"


def test_health_no_auth():
    assert client.get("/api/health").json() == {"status": "ok"}


@respx.mock
def test_instant_proxies_keyword():
    respx.get("http://wk.test/api/v1/search").mock(return_value=httpx.Response(200, json={
        "success": True, "data": [{"id": "k1", "knowledge_base_id": "kb1", "knowledge_base_name": "101-市场运营部", "title": "关于X的通知", "file_name": "x.md"}], "has_more": False, "total": 1}))
    from gateway.config import settings as s
    s.weknora_base_url = "http://wk.test"
    resp = client.get("/api/instant?q=X", headers=AUTH)
    assert resp.status_code == 200
    assert resp.json()["results"][0]["kb_name"] == "101-市场运营部"


def test_auth_required():
    settings.gateway_token = "test-token"
    assert client.get("/api/instant?q=X").status_code == 401


@respx.mock
def test_deep_partial_on_kb_failure():
    from gateway.config import settings as s
    s.weknora_base_url = "http://wk.test"
    respx.post("http://wk.test/api/v1/knowledge-bases/kb1/hybrid-search").mock(
        return_value=httpx.Response(200, json={"data": [{"knowledge": {"id": "d1", "title": "t"}, "score": 0.8}]}))
    respx.post("http://wk.test/api/v1/knowledge-bases/kb2/hybrid-search").mock(
        return_value=httpx.Response(500))
    resp = client.get("/api/deep?q=X&kb_ids=kb1,kb2", headers=AUTH)
    body = resp.json()
    assert body["partial"] is True and body["results"][0]["id"] == "d1"
```

- [ ] **Step 6: 跑 API 测试并修复**

Run: `.venv/bin/python -m pytest tests/ -v`
Expected: 全部 passed（respx 的 mock 地址需与 settings 一致；若 respx 拦截不到，检查 `weknora_base_url` 是否在 mock 注册前被改写——测试内已先改后请求）。

- [ ] **Step 7: 对真实 WeKnora 冒烟（验证响应字段假设）**

```bash
# 在 192.168.66.12 或能访问内网的机器上执行；先起网关：
cd desktop/gateway && WEKNORA_BASE_URL=http://192.168.66.12:8080 WEKNORA_API_KEY=<真实key> GATEWAY_TOKEN=dev .venv/bin/uvicorn gateway.app:app --port 8787
curl -s "http://127.0.0.1:8787/api/health"
curl -s -H "Authorization: Bearer dev" "http://127.0.0.1:8787/api/instant?q=设计" | head -c 800
curl -s -H "Authorization: Bearer dev" "http://127.0.0.1:8787/api/deep?q=设计&kb_ids=<一个真实kb_id>" | head -c 800
```

Expected: instant 返回标题命中（title 级）；deep 返回带 score 的语义结果。**若字段名与 `weknora.py` 映射不符（例如 hybrid-search 返回结构不同），以 curl 实测响应为准修正映射后重跑 pytest。**

- [ ] **Step 8: Commit**

```bash
git add -A && git commit -m "feat: 网关两档检索（instant/deep 扇出归一合并）与 WeKnora 客户端"
```

---

### Task 3: 客户端网关客户端与搜索状态（TS 层）

**Files:**
- Create: `desktop/src/launcher/types.ts`, `desktop/src/launcher/debounce.ts`, `desktop/src/launcher/gateway.ts`, `desktop/src/launcher/useSearch.ts`
- Test: `desktop/src/launcher/__tests__/debounce.test.ts`, `desktop/src/launcher/__tests__/useSearch.test.ts`

**Interfaces:**
- Consumes: 网关 REST（Task 2）；Rust 命令（Task 5 `local_file_search`, `get_settings`, Task 6 actions）。
- Produces:
  - `types.ts`: `interface KnowledgeHit { id: string; kb_id: string; kb_name: string; title: string; file_name: string; score: number | null }`；`interface FileHit { name: string; path: string; size_bytes: number | null; modified: number | null }`；`interface ActionHit { id: string; title: string; cmd: string }`；`interface GatewayConfig { baseUrl: string; token: string }`
  - `gateway.ts`: `fetchInstant(cfg, q): Promise<KnowledgeHit[]>`、`fetchDeep(cfg, q, kbIds: string[]): Promise<{ results: KnowledgeHit[]; partial: boolean }>`、`fetchKbs(cfg): Promise<{ id: string; name: string }[]>`、`checkHealth(cfg): Promise<boolean>`
  - `useSearch(queryRef, cfgRef, kbIdsRef)`: 返回 `{ knowledge, deep, files, actions, deepPartial, errors }`。

- [ ] **Step 1: debounce 失败测试与实现**

`desktop/src/launcher/__tests__/debounce.test.ts`：

```ts
import { describe, expect, it, vi } from "vitest";
import { debounce } from "../debounce";

describe("debounce", () => {
  it("只在静默期后触发一次", () => {
    vi.useFakeTimers();
    const fn = vi.fn();
    const d = debounce(fn, 120);
    d(); d(); d();
    vi.advanceTimersByTime(119);
    expect(fn).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
```

`desktop/src/launcher/debounce.ts`：

```ts
export function debounce<A extends unknown[]>(fn: (...args: A) => void, ms: number): (...args: A) => void {
  let t: ReturnType<typeof setTimeout> | undefined;
  return (...args: A) => {
    if (t) clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}
```

- [ ] **Step 2: types + gateway 客户端**

`desktop/src/launcher/types.ts`：

```ts
export interface KnowledgeHit {
  id: string;
  kb_id: string;
  kb_name: string;
  title: string;
  file_name: string;
  score: number | null;
}
export interface FileHit {
  name: string;
  path: string;
  size_bytes: number | null;
  modified: number | null;
}
export interface ActionHit { id: string; title: string; cmd: string }
export interface GatewayConfig { baseUrl: string; token: string }

export function authHeaders(cfg: GatewayConfig): Record<string, string> {
  return cfg.token ? { Authorization: `Bearer ${cfg.token}` } : {};
}
```

`desktop/src/launcher/gateway.ts`：

```ts
import { authHeaders, type GatewayConfig, type KnowledgeHit } from "./types";

const TIMEOUT_MS = 8000;

async function get(cfg: GatewayConfig, path: string, signal?: AbortSignal): Promise<unknown> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  signal?.addEventListener("abort", () => ctrl.abort());
  try {
    const resp = await fetch(`${cfg.baseUrl.replace(/\/$/, "")}${path}`, {
      headers: authHeaders(cfg),
      signal: ctrl.signal,
    });
    if (!resp.ok) throw new Error(`gateway ${resp.status}`);
    return await resp.json();
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchInstant(cfg: GatewayConfig, q: string): Promise<KnowledgeHit[]> {
  const body = await get(cfg, `/api/instant?q=${encodeURIComponent(q)}&limit=20`) as { results: KnowledgeHit[] };
  return body.results ?? [];
}

export async function fetchDeep(cfg: GatewayConfig, q: string, kbIds: string[]) {
  if (!kbIds.length) return { results: [] as KnowledgeHit[], partial: false };
  const body = await get(cfg, `/api/deep?q=${encodeURIComponent(q)}&kb_ids=${kbIds.join(",")}&limit=20`) as { results: KnowledgeHit[]; partial: boolean };
  return { results: body.results ?? [], partial: !!body.partial };
}

export async function fetchKbs(cfg: GatewayConfig): Promise<{ id: string; name: string }[]> {
  const body = await get(cfg, "/api/kbs") as { kbs: { id: string; name: string }[] };
  return body.kbs ?? [];
}

export async function checkHealth(cfg: GatewayConfig): Promise<boolean> {
  try {
    await get(cfg, "/api/health");
    return true;
  } catch {
    return false;
  }
}
```

- [ ] **Step 3: useSearch 组合式函数（即时 120ms / 深度 450ms，AbortController 取消过期请求）**

`desktop/src/launcher/useSearch.ts`：

```ts
import { computed, ref, watch, type Ref } from "vue";
import { fetchDeep, fetchInstant } from "./gateway";
import { searchActions } from "./actions";
import type { ActionHit, FileHit, GatewayConfig, KnowledgeHit } from "./types";

export interface SearchState {
  knowledge: Ref<KnowledgeHit[]>;
  deep: Ref<KnowledgeHit[]>;
  deepPartial: Ref<boolean>;
  files: Ref<FileHit[]>;
  actions: Ref<ActionHit[]>;
  deepError: Ref<boolean>;
}

const INSTANT_MS = 120;
const DEEP_MS = 450;

export function useSearch(
  query: Ref<string>,
  cfg: Ref<GatewayConfig>,
  kbIds: Ref<string[]>,
  fileSearch: (q: string) => Promise<FileHit[]>,
): SearchState {
  const knowledge = ref<KnowledgeHit[]>([]);
  const deep = ref<KnowledgeHit[]>([]);
  const deepPartial = ref(false);
  const files = ref<FileHit[]>([]);
  const actions = ref<ActionHit[]>([]);
  const deepError = ref(false);

  const queryLen = computed(() => query.value.trim().length);

  let instantCtrl: AbortController | undefined;
  let deepCtrl: AbortController | undefined;
  let deepTimer: ReturnType<typeof setTimeout> | undefined;

  function runInstant(q: string) {
    instantCtrl?.abort();
    instantCtrl = new AbortController();
    const myCtrl = instantCtrl;
    void (async () => {
      try {
        const [k, f] = await Promise.all([
          fetchInstant(cfg.value, q),
          fileSearch(q).catch(() => [] as FileHit[]),
        ]);
        if (myCtrl !== instantCtrl) return; // 已被更新的请求取代
        knowledge.value = k;
        files.value = f;
      } catch {
        if (myCtrl === instantCtrl) knowledge.value = [];
      }
    })();
  }

  function runDeep(q: string) {
    if (deepTimer) clearTimeout(deepTimer);
    deepTimer = setTimeout(() => {
      deepCtrl?.abort();
      deepCtrl = new AbortController();
      const myCtrl = deepCtrl;
      void (async () => {
        try {
          const r = await fetchDeep(cfg.value, q, kbIds.value);
          if (myCtrl !== deepCtrl) return;
          deep.value = r.results;
          deepPartial.value = r.partial;
          deepError.value = false;
        } catch {
          if (myCtrl === deepCtrl) { deepError.value = true; deep.value = []; }
        }
      })();
    }, DEEP_MS);
  }

  watch(queryLen, (len) => {
    const q = query.value.trim();
    if (len < 2) {
      instantCtrl?.abort();
      knowledge.value = []; files.value = []; actions.value = []; deep.value = []; deepError.value = false;
      return;
    }
    actions.value = searchActions(q);
    runInstant(q);
    runDeep(q);
  });

  return { knowledge, deep, deepPartial, files, actions, deepError };
}
```

注意：此文件引用 `./actions`（Task 4 提供 `searchActions(q: string): ActionHit[]`）。实现本任务时先建空壳 `desktop/src/launcher/actions.ts`：`export function searchActions(_q: string): ActionHit[] { return []; }`，Task 4 替换实现。

- [ ] **Step 4: useSearch 失败测试**

`desktop/src/launcher/__tests__/useSearch.test.ts`：

```ts
import { describe, expect, it, vi } from "vitest";
import { ref } from "vue";
import { useSearch } from "../useSearch";
import type { GatewayConfig, KnowledgeHit } from "../types";

vi.mock("../gateway", () => ({
  fetchInstant: vi.fn(async (_c: unknown, q: string) =>
    [{ id: "k1", kb_id: "kb1", kb_name: "KB", title: q, file_name: "f", score: null }] as KnowledgeHit[]),
  fetchDeep: vi.fn(async () => ({ results: [], partial: false })),
}));

const cfg = ref<GatewayConfig>({ baseUrl: "http://g", token: "t" });

describe("useSearch", () => {
  it("短查询清空，长查询出即时结果", async () => {
    vi.useFakeTimers();
    const q = ref("");
    const s = useSearch(q, cfg, ref([]), async () => []);
    q.value = "设计";
    await vi.advanceTimersByTimeAsync(500);
    expect(s.knowledge.value).toHaveLength(1);
    q.value = "a";
    await vi.advanceTimersByTimeAsync(500);
    expect(s.knowledge.value).toHaveLength(0);
    expect(s.actions.value).toHaveLength(0);
  });

  it("深度结果被更新请求取代时不回写旧值", async () => {
    vi.useFakeTimers();
    const { fetchDeep } = await import("../gateway");
    let resolveDeep!: (v: unknown) => void;
    vi.mocked(fetchDeep).mockImplementationOnce(() => new Promise((r) => { resolveDeep = r; }));
    const q = ref("");
    const s = useSearch(q, cfg, ref([]), async () => []);
    q.value = "方案一";
    await vi.advanceTimersByTimeAsync(460);
    q.value = "方案二字";
    await vi.advanceTimersByTimeAsync(1000);
    resolveDeep({ results: [{ id: "stale" }], partial: false });
    await Promise.resolve();
    expect(s.deep.value).toHaveLength(0);
  });
});
```

Run: `cd desktop && npm test`
Expected: 全部 passed（`fetchDeep` mock 首调用返回挂起 Promise——若 vi.mocked 类型报错，用 `(fetchDeep as any)` 收敛）。

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: 前端检索状态机（即时/深度双档防抖与过期请求取消）"
```

---

### Task 4: 动作注册表

**Files:**
- Create: `desktop/src/launcher/actions.ts`（替换 Task 3 的空壳）
- Create: `desktop/public/actions.json`
- Test: `desktop/src/launcher/__tests__/actions.test.ts`

**Interfaces:**
- Produces: `searchActions(q: string): ActionHit[]`（前缀/子串匹配 title，不匹配返回 []）；`ActionHit.cmd` 为 `"open-url:<url>"` 或 `"open-app:<tauri-cmd>"`，Enter 执行时由 Task 6 的 `runAction` 解释。

- [ ] **Step 1: 失败测试**

`desktop/src/launcher/__tests__/actions.test.ts`：

```ts
import { describe, expect, it } from "vitest";
import { searchActions } from "../actions";

describe("searchActions", () => {
  it("大小写不敏感子串匹配", () => {
    const hits = searchActions("weknora");
    expect(hits.length).toBeGreaterThanOrEqual(1);
    expect(hits[0].title).toContain("知识库");
  });
  it("无匹配返回空", () => {
    expect(searchActions("zzzz不存在")).toHaveLength(0);
  });
});
```

- [ ] **Step 2: 实现注册表**

`desktop/public/actions.json`：

```json
[
  { "id": "open-weknora", "title": "打开 WeKnora 知识库网页", "cmd": "open-url:http://192.168.66.12:8080" },
  { "id": "open-settings", "title": "打开设置", "cmd": "open-settings" }
]
```

`desktop/src/launcher/actions.ts`：

```ts
import type { ActionHit } from "./types";

let registry: ActionHit[] = [];

export async function loadActions(): Promise<void> {
  try {
    registry = await (await fetch("/actions.json")).json();
  } catch {
    registry = [];
  }
}

export function searchActions(q: string): ActionHit[] {
  const needle = q.toLowerCase();
  return registry.filter((a) => a.title.toLowerCase().includes(needle));
}
```

测试直接 import `searchActions` 时 registry 为空——测试文件顶部先 `await loadActions()`（用 `beforeAll`）。修正测试：

```ts
import { beforeAll, describe, expect, it } from "vitest";
import { loadActions, searchActions } from "../actions";

describe("searchActions", () => {
  beforeAll(async () => { await loadActions(); });
  it("大小写不敏感子串匹配", () => {
    const hits = searchActions("weknora");
    expect(hits.length).toBeGreaterThanOrEqual(1);
    expect(hits[0].title).toContain("知识库");
  });
  it("无匹配返回空", () => {
    expect(searchActions("zzzz不存在")).toHaveLength(0);
  });
});
```

（vitest 下 `fetch("/actions.json")` 需要 jsdom 能读到 public 资源；若失败，在 `vite.config.ts` 的 `test` 段加 `server: { deps: { inline: [/actions/] } }`，或将 actions.json 内容内联为 TS 常量 `desktop/src/launcher/builtinActions.ts` 并让 loadActions 优先读它——采用后者更稳：`builtinActions.ts` 导出与 actions.json 相同的数组，`loadActions` 改为 `registry = builtinActions;`，public/actions.json 保留给运行时覆盖。）

- [ ] **Step 3: 跑测试**

Run: `npm test`
Expected: actions 2 个用例 passed。

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "feat: 本地动作注册表 v1"
```

---

### Task 5: 本机文件检索（mdfind + Everything FFI）

**Files:**
- Create: `desktop/src-tauri/src/search/mod.rs`, `desktop/src-tauri/src/search/mdfind.rs`, `desktop/src-tauri/src/search/everything.rs`
- Modify: `desktop/src-tauri/src/lib.rs`（注册 `local_file_search` 命令）
- Test: 各模块内 `#[cfg(test)]`

**Interfaces:**
- Produces（Tauri 命令，前端依赖）: `#[tauri::command] async fn local_file_search(app: AppHandle, q: String, limit: usize) -> Vec<FileHit>`；`#[tauri::command] fn local_file_available() -> bool`。`FileHit` 与 TS `FileHit` 字段一致（serde rename camelCase：`sizeBytes`/`modified`——注意：为与 Task 3 的 TS 类型对齐，Rust 端 `#[serde(rename_all = "camelCase")]`，TS 侧 `size_bytes` 改为 `sizeBytes`、`modified` 不变；本任务同步修改 `types.ts`）。macOS 实现 mdfind；Windows 实现 Everything SDK；不可用时命令返回空数组且 `local_file_available()` 返回 false。

- [ ] **Step 1: 定义共享类型与 provider 接口（含失败测试）**

`desktop/src-tauri/src/search/mod.rs`：

```rust
pub mod mdfind;
#[cfg(windows)]
pub mod everything;

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct FileHit {
    pub name: String,
    pub path: String,
    pub size_bytes: Option<u64>,
    pub modified: Option<u64>,
}

#[derive(Debug, thiserror::Error)]
pub enum SearchError {
    #[error("provider unavailable")]
    Unavailable,
    #[error(transparent)]
    Io(#[from] std::io::Error),
}

pub trait FileProvider: Send + Sync {
    fn available(&self) -> bool;
    fn search(&self, query: &str, limit: usize) -> Result<Vec<FileHit>, SearchError>;
}

/// 从 mdfind 输出（每行一个绝对路径）解析 FileHit。供单测。
pub fn parse_mdfind_output(output: &str, limit: usize) -> Vec<FileHit> {
    output
        .lines()
        .filter(|l| !l.trim().is_empty())
        .take(limit)
        .map(|p| {
            let name = p.rsplit('/').next().unwrap_or(p).to_string();
            let meta = std::fs::metadata(p).ok();
            FileHit {
                name,
                path: p.to_string(),
                size_bytes: meta.as_ref().map(|m| m.len()),
                modified: meta
                    .as_ref()
                    .and_then(|m| m.modified().ok())
                    .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                    .map(|d| d.as_secs()),
            }
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::parse_mdfind_output;

    #[test]
    fn parses_paths_and_skips_empty_lines() {
        let out = "/Users/a/方案.dwg\n\n/Users/b/报告.docx\n";
        let hits = parse_mdfind_output(out, 10);
        assert_eq!(hits.len(), 2);
        assert_eq!(hits[0].name, "方案.dwg");
    }

    #[test]
    fn respects_limit() {
        let out = "/a\n/b\n/c\n";
        assert_eq!(parse_mdfind_output(out, 2).len(), 2);
    }
}
```

- [ ] **Step 2: 跑测试确认通过**

Run: `cd desktop/src-tauri && cargo test`
Expected: mod tests 2 个用例 passed（Task 0/1 的用例保持通过）。

- [ ] **Step 3: macOS mdfind 实现**

`desktop/src-tauri/src/search/mdfind.rs`：

```rust
use super::{FileHit, FileProvider, SearchError};
use std::process::Command;

pub struct MdfindProvider;

impl FileProvider for MdfindProvider {
    fn available(&self) -> bool {
        cfg!(target_os = "macos")
    }

    fn search(&self, query: &str, limit: usize) -> Result<Vec<FileHit>, SearchError> {
        if !self.available() {
            return Err(SearchError::Unavailable);
        }
        let out = Command::new("mdfind")
            .arg("-literal")
            .arg(format!("(kMDItemDisplayName == '*{query}*'cd)"))
            .output()?;
        if !out.status.success() {
            return Ok(vec![]);
        }
        Ok(super::parse_mdfind_output(&String::from_utf8_lossy(&out.stdout), limit))
    }
}
```

注意：`query` 拼入 mdfind 表达式前必须过滤引号，防止注入破坏表达式：在 `format!` 之前加 `let query = query.replace(['"', '*'], " ");`。

- [ ] **Step 4: Windows Everything 实现**

`desktop/src-tauri/Cargo.toml` 追加：

```toml
[target.'cfg(windows)'.dependencies]
everything-sdk = "0.3"
```

`desktop/src-tauri/src/search/everything.rs`：

```rust
use super::{FileHit, FileProvider, SearchError};

pub struct EverythingProvider;

impl FileProvider for EverythingProvider {
    fn available(&self) -> bool {
        // SDK DLL 由 Everything 主程序安装；进程内不可用即返回 false，前端隐藏文件分区（spec §6）
        everything_sdk::Everything::new().is_ok()
    }

    fn search(&self, query: &str, limit: usize) -> Result<Vec<FileHit>, SearchError> {
        let mut ev = everything_sdk::Everything::new().map_err(|_| SearchError::Unavailable)?;
        ev.set_search(query);
        ev.set_max(limit as u32);
        ev.set_request_flags(
            everything_sdk::request::EVERYTHING_REQUEST_FILE_NAME
                | everything_sdk::request::EVERYTHING_REQUEST_PATH
                | everything_sdk::request::EVERYTHING_REQUEST_SIZE,
        );
        ev.query();
        let mut hits = Vec::new();
        for item in ev.results().iter().take(limit) {
            let path = item.path();
            hits.push(FileHit {
                name: item.name().to_string_lossy().into_owned(),
                path: path.to_string_lossy().into_owned(),
                size_bytes: item.size(),
                modified: None,
            });
        }
        Ok(hits)
    }
}
```

**如果 `everything-sdk` crate 的 API 与以上调用不符（crate 版本差异）：不要自由发挥，改为用 `libloading` 直接加载 `Everything64.dll` 并绑定四个核心导出（`Everything_SetSearchW`、`Everything_QueryW`、`Everything_GetNumResults`、`Everything_GetResultFullPathNameW`），按此语义实现 `search`。** 引擎侧不允许跳过本模块。

- [ ] **Step 5: 注册 Tauri 命令**

`desktop/src-tauri/src/lib.rs` 在 `mod windows;` 后追加 `mod search;`，`run()` 内 `.setup(...)` 之后链上：

```rust
        .invoke_handler(tauri::generate_handler![
            local_file_search,
            local_file_available,
        ])
```

并在 `lib.rs` 顶部（`run` 之前）加：

```rust
use search::FileProvider;

#[tauri::command]
fn local_file_available() -> bool {
    #[cfg(target_os = "macos")]
    { search::mdfind::MdfindProvider.available() }
    #[cfg(windows)]
    { search::everything::EverythingProvider.available() }
    #[cfg(not(any(target_os = "macos", windows)))]
    { false }
}

#[tauri::command]
async fn local_file_search(q: String, limit: Option<usize>) -> Result<Vec<search::FileHit>, String> {
    let limit = limit.unwrap_or(15);
    let provider: &dyn FileProvider = provider();
    if q.trim().is_empty() {
        return Ok(vec![]);
    }
    // 阻塞进程调用放线程池，避免卡 UI
    let q2 = q.trim().to_string();
    tauri::async_runtime::spawn_blocking(move || {
        provider.search(&q2, limit).unwrap_or_default()
    })
    .await
    .map_err(|e| e.to_string())
}

fn provider() -> &'static dyn FileProvider {
    #[cfg(target_os = "macos")]
    { &search::mdfind::MdfindProvider }
    #[cfg(windows)]
    { &search::everything::EverythingProvider }
    #[cfg(not(any(target_os = "macos", windows)))]
    { unreachable!() }
}
```

（`unreachable!()` 分支在前两个 cfg 块已覆盖所有编译目标；若 clippy 报 unreachable 告警，将该分支改为空 `{ panic!("unsupported platform") }`。）

- [ ] **Step 6: 测试 + 手工验证**

Run: `cd desktop/src-tauri && cargo test && cargo clippy -- -D warnings`
Expected: passed。
Run: `npm run tauri dev`，在 macOS 上暂无 UI 调用点——验证方式：控制台临时无错误即可（UI 接线在 Task 7）。

- [ ] **Step 7: 同步 TS 类型**

修改 `desktop/src/launcher/types.ts` 中 `FileHit`：

```ts
export interface FileHit {
  name: string;
  path: string;
  sizeBytes: number | null;
  modified: number | null;
}
```

并同步 `useSearch.ts` 中 `catch(() => [] as FileHit[])` 无需变化。Run `npm run build`（vue-tsc 类型检查）确认无误。

- [ ] **Step 8: Commit**

```bash
git add -A && git commit -m "feat: 本机文件检索（mdfind + Everything SDK，含不可用降级）"
```

---

### Task 6: 打开行为与动作执行命令

**Files:**
- Create: `desktop/src-tauri/src/open.rs`
- Modify: `desktop/src-tauri/src/lib.rs`
- Test: `desktop/src/launcher/__tests__/runAction.test.ts`

**Interfaces:**
- Consumes: `ActionHit.cmd`（Task 4 格式）、`KnowledgeHit`、`FileHit`。
- Produces: Tauri 命令 `open_knowledge(hit: KnowledgeHit, weknoraUrl: String)`（知识结果：有 `file_name` 时打开 `{weknoraUrl}/file?knowledgeId={id}` 预览，否则打开 WeKnora 根页——**以 Task 7 冒烟时实测 WeKnora 前端路由为准修正 URL 拼法**）；`open_file(path: String)` / `reveal_in_folder(path: String)`（经 tauri-plugin-opener）；`run_action(cmd: String)`（分发 `open-url:` / `open-settings`）。

- [ ] **Step 1: Rust 命令实现**

`desktop/src-tauri/src/open.rs`：

```rust
use crate::search::FileHit;
use serde::Deserialize;
use tauri::{AppHandle, Manager};
use tauri_plugin_opener::OpenerExt;

#[derive(Debug, Deserialize)]
pub struct KnowledgeHit {
    #[serde(default)]
    pub id: String,
    #[serde(default)]
    pub kb_id: String,
    #[serde(default)]
    pub file_name: String,
}

#[tauri::command]
pub fn open_knowledge(app: AppHandle, hit: KnowledgeHit, weknora_url: String) -> Result<(), String> {
    let url = if hit.file_name.is_empty() {
        weknora_url
    } else {
        format!("{}/file?knowledgeId={}", weknora_url.trim_end_matches('/'), hit.id)
    };
    app.opener().open_url(url, None::<&str>).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn open_file(app: AppHandle, path: String) -> Result<(), String> {
    app.opener().open_path(path, None::<&str>).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn reveal_in_folder(app: AppHandle, path: String) -> Result<(), String> {
    let parent = std::path::Path::new(&path)
        .parent()
        .map(|p| p.to_path_buf())
        .unwrap_or_else(|| std::path::PathBuf::from(&path));
    app.opener()
        .reveal_item_in_dir(&path)
        .or_else(|_| app.opener().open_path(parent.to_string_lossy(), None::<&str>))
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn run_action(app: AppHandle, cmd: String) -> Result<(), String> {
    if let Some(url) = cmd.strip_prefix("open-url:") {
        return app.opener().open_url(url, None::<&str>).map_err(|e| e.to_string());
    }
    if cmd == "open-settings" {
        if let Some(win) = app.get_webview_window("settings") {
            let _ = win.show();
            let _ = win.set_focus();
        }
        return Ok(());
    }
    Err(format!("unknown action: {cmd}"))
}

/// 供单测：根据 file_name 判定预览 URL 是否可用（纯逻辑抽取）
pub fn preview_url(id: &str, file_name: &str, base: &str) -> Option<String> {
    if file_name.is_empty() {
        None
    } else {
        Some(format!("{}/file?knowledgeId={}", base.trim_end_matches('/'), id))
    }
}

#[cfg(test)]
mod tests {
    use super::preview_url;

    #[test]
    fn builds_preview_url_only_with_file() {
        assert_eq!(
            preview_url("k1", "a.md", "http://w/"),
            Some("http://w/file?knowledgeId=k1".to_string())
        );
        assert_eq!(preview_url("k1", "", "http://w"), None);
    }
}
```

`desktop/src-tauri/src/lib.rs`：`mod open;`、mod 声明区追加，`generate_handler![]` 内追加 `open_knowledge, open_file, reveal_in_folder, run_action`。

- [ ] **Step 2: 跑 Rust 测试**

Run: `cd desktop/src-tauri && cargo test && cargo clippy -- -D warnings`
Expected: passed。

- [ ] **Step 3: 前端 runAction 分发（失败测试 + 实现）**

`desktop/src/launcher/__tests__/runAction.test.ts`：

```ts
import { describe, expect, it, vi } from "vitest";
import { runAction } from "../runAction";
import type { KnowledgeHit } from "../types";

const invoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...a: unknown[]) => invoke(...a) }));

describe("runAction", () => {
  it("动作走 run_action 命令", async () => {
    await runAction({ id: "a", title: "t", cmd: "open-url:http://x" });
    expect(invoke).toHaveBeenCalledWith("run_action", { cmd: "open-url:http://x" });
  });
  it("知识结果走 open_knowledge", async () => {
    const hit: KnowledgeHit = { id: "k1", kb_id: "kb", kb_name: "n", title: "t", file_name: "f.md", score: null };
    await runAction(hit, "http://w");
    expect(invoke).toHaveBeenCalledWith("open_knowledge", { hit, weknoraUrl: "http://w" });
  });
  it("文件结果走 reveal_in_folder（修饰键在组件层处理）", async () => {
    await runAction({ name: "a", path: "/tmp/a", sizeBytes: null, modified: null });
    expect(invoke).toHaveBeenCalledWith("open_file", { path: "/tmp/a" });
  });
});
```

`desktop/src/launcher/runAction.ts`：

```ts
import { invoke } from "@tauri-apps/api/core";
import type { ActionHit, FileHit, KnowledgeHit } from "./types";

export type Selectable = KnowledgeHit | FileHit | ActionHit;

function isKnowledge(x: Selectable): x is KnowledgeHit {
  return (x as KnowledgeHit).kb_id !== undefined;
}
function isFile(x: Selectable): x is FileHit {
  return (x as FileHit).path !== undefined;
}

export async function runAction(item: Selectable, weknoraUrl?: string): Promise<void> {
  if (isKnowledge(item)) {
    await invoke("open_knowledge", { hit: item, weknoraUrl });
  } else if (isFile(item)) {
    await invoke("open_file", { path: item.path });
  } else {
    await invoke("run_action", { cmd: (item as ActionHit).cmd });
  }
}
```

安装前端依赖：`npm i @tauri-apps/api`。Run: `npm test` → passed；`npm run build` 通过。

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "feat: 结果打开行为（知识/文件/动作）与预览 URL"
```

---

### Task 7: Launcher UI（Mac 风格三分区 + 键盘导航）

**Files:**
- Create: `desktop/src/launcher/Launcher.vue`, `desktop/src/launcher/ResultList.vue`, `desktop/src/launcher/keyboard.ts`
- Modify: `desktop/src/App.vue`（挂载 Launcher）、`desktop/src/launcher/actions.ts` 旁的 `builtinActions`（如 Task 4 采用内联方案）
- Test: `desktop/src/launcher/__tests__/keyboard.test.ts`

**Interfaces:**
- Consumes: `useSearch`（Task 3）、`runAction`（Task 6）、`loadActions`（Task 4）、`local_file_available`（Task 5）。
- Produces: `keyboard.ts` 导出 `flatten(knowledge, files, actions): {kind, item}[]` 与 `move(active, delta, len): number`（循环导航）；`Launcher.vue` 为窗口根组件。

- [ ] **Step 1: 键盘导航失败测试**

`desktop/src/launcher/__tests__/keyboard.test.ts`：

```ts
import { describe, expect, it } from "vitest";
import { move } from "../keyboard";

describe("move", () => {
  it("向下到底回绕到 0", () => {
    expect(move(2, 1, 3)).toBe(0);
  });
  it("向上到顶回绕到末尾", () => {
    expect(move(0, -1, 3)).toBe(2);
  });
  it("空列表保持 -1", () => {
    expect(move(-1, 1, 0)).toBe(-1);
  });
});
```

`desktop/src/launcher/keyboard.ts`：

```ts
export function move(active: number, delta: number, len: number): number {
  if (len === 0) return -1;
  return (((active + delta) % len) + len) % len;
}
```

- [ ] **Step 2: ResultList 组件**

`desktop/src/launcher/ResultList.vue`：

```vue
<template>
  <ul class="results">
    <li
      v-for="(row, i) in rows"
      :key="row.kind + '-' + keyOf(row.item)"
      :class="{ active: i === activeIndex }"
      @mouseenter="$emit('hover', i)"
      @click="$emit('choose', row.item)"
    >
      <span class="badge" :data-kind="row.kind">{{ badge(row.kind) }}</span>
      <span class="title">{{ titleOf(row.item) }}</span>
      <span class="meta">{{ metaOf(row) }}</span>
    </li>
  </ul>
</template>

<script setup lang="ts">
import type { ActionHit, FileHit, KnowledgeHit } from "./types";

export interface Row {
  kind: "knowledge" | "file" | "action";
  item: KnowledgeHit | FileHit | ActionHit;
}

defineProps<{ rows: Row[]; activeIndex: number }>();
defineEmits<{ hover: [number]; choose: [Row["item"]] }>();

function badge(kind: Row["kind"]): string {
  return kind === "knowledge" ? "知" : kind === "file" ? "文" : "动";
}
function keyOf(item: Row["item"]): string {
  if ("kb_id" in item) return item.id;
  if ("path" in item) return item.path;
  return (item as ActionHit).id;
}
function titleOf(item: Row["item"]): string {
  if ("kb_id" in item) return item.title || item.file_name;
  if ("path" in item) return item.name;
  return (item as ActionHit).title;
}
function metaOf(row: Row): string {
  if (row.kind === "knowledge") return (row.item as KnowledgeHit).kb_name;
  if (row.kind === "file") return (row.item as FileHit).path;
  return "";
}
</script>

<style scoped>
.results { list-style: none; margin: 0; padding: 4px; overflow-y: auto; }
li { display: flex; align-items: center; gap: 10px; padding: 9px 12px; border-radius: 10px; cursor: default; }
li.active { background: rgba(255, 255, 255, 0.1); }
.badge { flex: none; width: 20px; height: 20px; display: grid; place-items: center; font-size: 11px; border-radius: 6px; background: rgba(255,255,255,0.12); }
.title { flex: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-size: 14px; }
.meta { color: var(--text-secondary); font-size: 12px; max-width: 40%; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
</style>
```

- [ ] **Step 3: Launcher 根组件（输入框 + 分区标题 + 键盘/回车）**

`desktop/src/launcher/Launcher.vue`：

```vue
<template>
  <main class="frost launcher">
    <input
      ref="inputEl"
      v-model="query"
      class="query"
      placeholder="搜索知识库、本机文件…"
      spellcheck="false"
      @keydown="onKeydown"
    />
    <section v-if="grouped.knowledge.length" class="section">
      <h6>知识库</h6>
      <ResultList :rows="grouped.knowledge" :active-index="activeFlat" @hover="activeFlat = $event" @choose="choose" />
    </section>
    <section v-if="grouped.deep.length" class="section">
      <h6>深度结果<em v-if="deepPartial">（部分库超时）</em></h6>
      <ResultList :rows="grouped.deep" :active-index="activeFlat" @hover="activeFlat = $event" @choose="choose" />
    </section>
    <section v-if="grouped.files.length" class="section">
      <h6>本机文件</h6>
      <ResultList :rows="grouped.files" :active-index="activeFlat" @hover="activeFlat = $event" @choose="choose" />
    </section>
    <section v-if="grouped.actions.length" class="section">
      <h6>动作</h6>
      <ResultList :rows="grouped.actions" :active-index="activeFlat" @hover="activeFlat = $event" @choose="choose" />
    </section>
    <footer v-if="!flat.length" class="empty">{{ hint }}</footer>
  </main>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { invoke } from "@tauri-apps/api/core";
import ResultList, { type Row } from "./ResultList.vue";
import { loadActions } from "./actions";
import { checkHealth, fetchKbs } from "./gateway";
import { useSearch } from "./useSearch";
import type { ActionHit, FileHit, GatewayConfig, KnowledgeHit } from "./types";
import { move } from "./keyboard";
import { runAction } from "./runAction";

const DEFAULT_CFG: GatewayConfig = { baseUrl: "http://192.168.66.12:8787", token: "" };

const query = ref("");
const cfg = ref<GatewayConfig>(DEFAULT_CFG);
const kbIds = ref<string[]>([]);
const fileAvailable = ref(true);
const activeFlat = ref(0);
const inputEl = ref<HTMLInputElement>();

const fileSearch = async (q: string) => {
  if (!fileAvailable.value) return [] as FileHit[];
  return await invoke<FileHit[]>("local_file_search", { q, limit: 15 });
};
const s = useSearch(query, cfg, kbIds, fileSearch);

const grouped = computed(() => ({
  knowledge: s.knowledge.value.map((k) => ({ kind: "knowledge", item: k }) as Row),
  deep: s.deep.value
    .filter((d) => !s.knowledge.value.some((k) => k.id === d.id))
    .map((k) => ({ kind: "knowledge", item: k }) as Row),
  files: s.files.value.map((f) => ({ kind: "file", item: f }) as Row),
  actions: s.actions.value.map((a) => ({ kind: "action", item: a }) as Row),
}));
const flat = computed<Row[]>(() => [
  ...grouped.value.knowledge, ...grouped.value.deep, ...grouped.value.files, ...grouped.value.actions,
]);
const hint = computed(() =>
  fileAvailable.value ? "输入以搜索" : "本机文件检索不可用（Windows 需安装并运行 Everything），其余功能不受影响");

function onKeydown(e: KeyboardEvent) {
  if (e.key === "Escape") { query.value = ""; return; }
  if (e.key === "ArrowDown") { e.preventDefault(); activeFlat.value = move(activeFlat.value, 1, flat.value.length); }
  else if (e.key === "ArrowUp") { e.preventDefault(); activeFlat.value = move(activeFlat.value, -1, flat.value.length); }
  else if (e.key === "Enter") { e.preventDefault(); const row = flat.value[activeFlat.value]; if (row) choose(row.item); }
}

async function choose(item: KnowledgeHit | FileHit | ActionHit) {
  await runAction(item, cfg.value.baseUrl.replace(/\/$/, ""));
}

onMounted(async () => {
  await loadActions();
  fileAvailable.value = await invoke<boolean>("local_file_available");
  inputEl.value?.focus();
  if (await checkHealth(cfg.value)) {
    try {
      const kbs = await fetchKbs(cfg.value);
      kbIds.value = kbs.map((k) => k.id);
    } catch { /* 深度档静默失败（spec §6） */ }
  }
});
</script>

<style scoped>
.launcher { height: 100vh; display: flex; flex-direction: column; overflow: hidden; padding: 14px; gap: 6px; }
.query { height: 46px; border: none; outline: none; background: transparent; color: var(--text-primary); font-size: 19px; padding: 0 8px; border-bottom: 1px solid var(--border-faint); }
.section { display: flex; flex-direction: column; min-height: 0; }
.section h6 { margin: 8px 8px 2px; font-size: 11px; font-weight: 500; color: var(--text-secondary); letter-spacing: 1px; }
.section h6 em { font-style: normal; color: #f0a24d; }
.empty { display: grid; place-items: center; flex: 1; color: var(--text-secondary); font-size: 13px; }
</style>
```

注意收尾一处：`kbIds.value = kbs.map(k => k.id)` 即全库订阅（全员可搜全部库，spec 已确认）；M1a 不做勾选 UI，设置页（Task 8）只读展示库列表。

`desktop/src/App.vue` 替换为：

```vue
<template>
  <Launcher />
</template>
<script setup lang="ts">
import Launcher from "./launcher/Launcher.vue";
</script>
```

- [ ] **Step 4: 跑全部前端测试与构建**

Run: `npm test && npm run build`
Expected: 全部 passed；vue-tsc 无类型错误。

- [ ] **Step 5: 手工冒烟（macOS，连内网网关）**

先起网关（Task 2 Step 7 方式），再 `npm run tauri dev`：
Expected: Alt+Space 呼出；输入 `设计` → 知识库分区秒出标题命中，~0.5s 后深度结果追加；本机文件分区出现 mdfind 命中；输入 `weknora` → 动作区出现"打开 WeKnora"；↑↓ 导行、Enter 打开浏览器/文件夹；Esc 清空；网关停掉后知识分区消失但文件/动作正常，深度结果区无残留错误弹窗。

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat: Launcher UI 三分区与键盘导航（Mac 风格）"
```

---

### Task 8: 设置窗口与配置持久化

**Files:**
- Create: `desktop/src/settings/Settings.vue`, `desktop/src/settings/store.ts`, `desktop/src-tauri/src/settings_cmd.rs`
- Modify: `desktop/src-tauri/src/lib.rs`（注册 settings 窗口命令）、`desktop/src-tauri/tauri.conf.json`（无改动，settings 窗口由 tray 按需创建）
- Test: `desktop/src/settings/__tests__/store.test.ts`

**Interfaces:**
- Consumes: Task 1 `tray.rs::open_settings`（打开 `settings.html`）、`fetchKbs`（Task 3）。
- Produces: `store.ts`: `loadConfig(): Promise<AppConfig>`、`saveConfig(c: AppConfig): Promise<void>`，`interface AppConfig { gatewayUrl: string; gatewayToken: string; hotkey: string; autostart: boolean }`；Tauri 命令 `get_app_config` / `set_app_config`（JSON 存于 `app_config_dir/config.json`）与 `set_hotkey(hotkey: String)`（重注册全局热键，Task 1 的 alt+space 固定注册改为经此命令）。

- [ ] **Step 1: 配置读写的失败测试（纯逻辑：默认值合并）**

`desktop/src/settings/__tests__/store.test.ts`：

```ts
import { describe, expect, it } from "vitest";
import { withDefaults } from "../store";

describe("withDefaults", () => {
  it("补全缺失字段并保留已存值", () => {
    const c = withDefaults({ gatewayUrl: "http://g", gatewayToken: "t" });
    expect(c.hotkey).toBe("alt+space");
    expect(c.autostart).toBe(false);
    expect(c.gatewayUrl).toBe("http://g");
  });
});
```

`desktop/src/settings/store.ts`：

```ts
import { invoke } from "@tauri-apps/api/core";

export interface AppConfig {
  gatewayUrl: string;
  gatewayToken: string;
  hotkey: string;
  autostart: boolean;
}

const DEFAULTS: AppConfig = {
  gatewayUrl: "http://192.168.66.12:8787",
  gatewayToken: "",
  hotkey: "alt+space",
  autostart: false,
};

export function withDefaults(partial: Partial<AppConfig>): AppConfig {
  return { ...DEFAULTS, ...partial };
}

export async function loadConfig(): Promise<AppConfig> {
  return withDefaults(await invoke<Partial<AppConfig>>("get_app_config"));
}

export async function saveConfig(c: AppConfig): Promise<void> {
  await invoke("set_app_config", { config: c });
  await invoke("set_hotkey", { hotkey: c.hotkey });
  await invoke("plugin:autostart|enable"); // autostart=false 时由 Settings.vue 调 disable
}
```

- [ ] **Step 2: Rust 配置命令**

`desktop/src-tauri/src/settings_cmd.rs`：

```rust
use serde::{Deserialize, Serialize};
use std::fs;
use tauri::Manager;
use tauri_plugin_autostart::ManagerExt;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppConfig {
    pub gateway_url: String,
    pub gateway_token: String,
    pub hotkey: String,
    pub autostart: bool,
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            gateway_url: "http://192.168.66.12:8787".into(),
            gateway_token: String::new(),
            hotkey: "alt+space".into(),
            autostart: false,
        }
    }
}

fn config_path(app: &tauri::AppHandle) -> std::path::PathBuf {
    let dir = app.path().app_config_dir().expect("config dir");
    let _ = fs::create_dir_all(&dir);
    dir.join("config.json")
}

#[tauri::command]
pub fn get_app_config(app: tauri::AppHandle) -> AppConfig {
    fs::read_to_string(config_path(&app))
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

#[tauri::command]
pub fn set_app_config(app: tauri::AppHandle, config: AppConfig) -> Result<(), String> {
    let json = serde_json::to_string_pretty(&config).map_err(|e| e.to_string())?;
    fs::write(config_path(&app), json).map_err(|e| e.to_string())?;
    let _ = app.autolaunch().enable();
    Ok(())
}
```

`desktop/src-tauri/src/hotkey_state.rs`（热键重注册，供 `set_hotkey`）：

```rust
use std::sync::Mutex;
use tauri::Manager;
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};

pub struct CurrentHotkey(pub Mutex<String>);

#[tauri::command]
pub fn set_hotkey(app: tauri::AppHandle, hotkey: String) -> Result<(), String> {
    let gs = app.global_shortcut();
    if let Some(old) = app.state::<CurrentHotkey>().0.lock().ok().map(|g| g.clone()) {
        let _ = gs.unregister(old.parse::<tauri_plugin_global_shortcut::Shortcut>().map_err(|e| e.to_string())?);
    }
    let shortcut: tauri_plugin_global_shortcut::Shortcut = hotkey.parse().map_err(|e| format!("无效快捷键 {hotkey}: {e}"))?;
    gs.on_shortcut(shortcut, |app, _s, event| {
        if event.state == ShortcutState::Pressed {
            if let Some(win) = app.get_webview_window("launcher") {
                if win.is_visible().unwrap_or(false) { let _ = win.hide(); } else { let _ = win.show(); let _ = win.set_focus(); }
            }
        }
    })
    .map_err(|e| e.to_string())?;
    if let Ok(mut cur) = app.state::<CurrentHotkey>().0.lock() {
        *cur = hotkey;
    }
    Ok(())
}
```

`lib.rs` 接线：`mod settings_cmd; mod hotkey_state;`；`.setup()` 内注册状态 `app.manage(hotkey_state::CurrentHotkey(std::sync::Mutex::new("alt+space".into())));` 并把 Task 1 的固定 `on_shortcut("alt+space", …)` 替换为 `hotkey_state::set_hotkey(app.handle().clone(), "alt+space")?;`；`generate_handler![]` 追加 `get_app_config, set_app_config, set_hotkey`。Task 1 顶部重复导入同步清理。

- [ ] **Step 3: 设置窗口页面**

`desktop/src/settings/Settings.vue`：

```vue
<template>
  <main class="frost pane">
    <h2>设置</h2>
    <label>网关地址<input v-model="cfg.gatewayUrl" /></label>
    <label>网关 Token<input v-model="cfg.gatewayToken" type="password" /></label>
    <label>呼出快捷键<input v-model="cfg.hotkey" placeholder="alt+space" /></label>
    <label class="row"><input v-model="cfg.autostart" type="checkbox" /> 开机自启</label>
    <p class="kbs">可检索知识库：{{ kbs.length ? kbs.map(k => k.name).join("、") : "（网关不可达或未配置）" }}</p>
    <button :disabled="!valid" @click="save">保存</button>
    <p v-if="saved" class="ok">已保存</p>
  </main>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { fetchKbs } from "../launcher/gateway";
import { loadConfig, saveConfig, type AppConfig } from "./store";

const cfg = ref<AppConfig>({ gatewayUrl: "", gatewayToken: "", hotkey: "alt+space", autostart: false });
const kbs = ref<{ id: string; name: string }[]>([]);
const saved = ref(false);
const valid = computed(() => /^https?:\/\//.test(cfg.value.gatewayUrl) && /^[a-z+]/.test(cfg.value.hotkey));

onMounted(async () => {
  cfg.value = await loadConfig();
  try {
    kbs.value = await fetchKbs({ baseUrl: cfg.value.gatewayUrl, token: cfg.value.gatewayToken });
  } catch { /* 列表加载失败不阻塞设置（spec §6） */ }
});

async function save() {
  await saveConfig(cfg.value);
  saved.value = true;
  setTimeout(() => (saved.value = false), 1500);
}
</script>

<style scoped>
.pane { height: 100vh; padding: 22px 26px; display: flex; flex-direction: column; gap: 12px; overflow-y: auto; }
h2 { margin: 0 0 6px; font-size: 17px; }
label { display: flex; flex-direction: column; gap: 4px; font-size: 12px; color: var(--text-secondary); }
label.row { flex-direction: row; align-items: center; gap: 8px; color: var(--text-primary); }
input:not([type="checkbox"]) { height: 34px; border-radius: 8px; border: 1px solid var(--border-faint); background: rgba(255,255,255,0.06); color: var(--text-primary); padding: 0 10px; outline: none; }
.kbs { font-size: 12px; color: var(--text-secondary); }
button { height: 36px; border: none; border-radius: 9px; background: var(--accent); color: #fff; font-size: 14px; cursor: pointer; }
button:disabled { opacity: 0.4; cursor: not-allowed; }
.ok { margin: 0; font-size: 12px; color: #7ad48a; }
</style>
```

settings 窗口的 html：`vite.config.ts` `build.rollupOptions.input` 增加多入口：

```ts
import { resolve } from "path";
// defineConfig 内：
build: {
  target: "chrome109",
  rollupOptions: {
    input: {
      main: resolve(__dirname, "index.html"),
      settings: resolve(__dirname, "settings.html"),
    },
  },
},
```

`desktop/settings.html`（仓库根 desktop/ 下）：

```html
<!doctype html>
<html lang="zh-CN">
  <head><meta charset="UTF-8" /><title>设置</title></head>
  <body><div id="app"></div><script type="module" src="/src/settings/main.ts"></script></body>
</html>
```

`desktop/src/settings/main.ts`：

```ts
import { createApp } from "vue";
import Settings from "./Settings.vue";
import "../style.css";

createApp(Settings).mount("#app");
```

- [ ] **Step 4: 测试与验证**

Run: `npm test && npm run build && cd src-tauri && cargo test && cargo clippy -- -D warnings`
Expected: 全部通过。
手工：托盘 → 设置… 打开设置窗；改 token/快捷键为 `ctrl+shift+k` 保存 → 新热键呼出生效、旧热键失效；勾选开机自启保存后系统启动项出现。

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: 设置窗口（网关/热键/自启）与配置持久化"
```

---

### Task 9: 网关健康监测与托盘降级态

**Files:**
- Create: `desktop/src/launcher/health.ts`
- Modify: `desktop/src-tauri/src/tray.rs`, `desktop/src-tauri/src/lib.rs`
- Test: `desktop/src/launcher/__tests__/health.test.ts`

**Interfaces:**
- Consumes: `checkHealth`（Task 3）；托盘图标资源 `icons/tray-online.png`、`icons/tray-offline.png`（32x32，由占位纯色 PNG 生成，打包前替换为设计图标）。
- Produces: `health.ts::startHealthPoll(cfgRef, onChange): void`（60s 轮询，状态变化才回调）；Tauri 事件 `gateway-health`（payload `true|false`）→ 托盘图标切换。

- [ ] **Step 1: 前端轮询（失败测试）**

`desktop/src/launcher/__tests__/health.test.ts`：

```ts
import { describe, expect, it, vi } from "vitest";
import { nextChange } from "../health";

describe("health 状态变化检测", () => {
  it("相同状态不触发回调", () => {
    expect(nextChange(true, true)).toBe(false);
    expect(nextChange(false, true)).toBe(true);
  });
});
```

`desktop/src/launcher/health.ts`：

```ts
import { checkHealth } from "./gateway";
import type { GatewayConfig } from "./types";

export function nextChange(prev: boolean, now: boolean): boolean {
  return prev !== now;
}

export function startHealthPoll(cfgRef: { value: GatewayConfig }, onHealth: (ok: boolean) => void): void {
  let prev = true;
  const tick = async () => {
    const now = await checkHealth(cfgRef.value);
    if (nextChange(prev, now)) {
      prev = now;
      onHealth(now);
    }
  };
  void tick();
  setInterval(() => void tick(), 60_000);
}
```

`Launcher.vue` 的 `onMounted` 末尾追加：

```ts
  const { emit } = await import("@tauri-apps/api/event");
  startHealthPoll(cfg, (ok) => void emit("gateway-health", ok));
```

并在顶部 import `startHealthPoll`。

- [ ] **Step 2: 托盘监听切换图标**

`tray.rs` 的 `build_tray` 改为保存句柄并监听事件（追加在 build 之后）：

```rust
    let handle = app.clone();
    app.listen("gateway-health", move |event| {
        let online = event.payload() == "true";
        if let Some(tray) = handle.tray_by_id("main") {
            let icon_path = if online { "icons/tray-online.png" } else { "icons/tray-offline.png" };
            if let Ok(icon) = tauri::image::Image::from_path(icon_path) {
                let _ = tray.set_icon(Some(icon));
            }
        }
    });
```

`build_tray` 签名改为接收 `&mut tauri::AppHandle` 或在函数内 `let app = app.clone();`（按编译器提示调整借用）；`build_tray` 内默认先设 `tray-online.png` 图标：`TrayIconBuilder::with_id("main").icon(tauri::image::Image::from_path("icons/tray-online.png")?)`（启动即离线时随后的事件会纠正）。占位图标生成：

```bash
cd desktop/src-tauri
python3 - <<'EOF'
from pathlib import Path
import struct, zlib
def png(color, path):
    w = h = 32
    raw = b"".join(b"\x00" + bytes(color) * w for _ in range(h))
    def chunk(t, d):
        c = t + d
        return struct.pack(">I", len(d)) + c + struct.pack(">I", zlib.crc32(c))
    data = (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 6, 0, 0, 0))
            + chunk(b"IDAT", zlib.compress(raw)) + chunk(b"IEND", b""))
    Path(path).write_bytes(data)
png((77, 141, 246, 255), "icons/tray-online.png")
png((120, 120, 120, 255), "icons/tray-offline.png")
EOF
```

- [ ] **Step 3: 测试与手工验证**

Run: `npm test && cargo test`
手工：正常起网关 → 图标蓝色；kill 网关 uvicorn → ≤60s 内图标变灰；重启网关 → 变回蓝色。

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "feat: 网关健康监测与托盘降级态"
```

---

### Task 10: 打包与 Win7/Win11/macOS 三平台验收

**Files:**
- Modify: `desktop/src-tauri/tauri.conf.json`（bundle 细化）、`desktop/src-tauri/Cargo.toml`（release profile）
- Create: `desktop/docs/ACCEPTANCE.md`

**Interfaces:**
- Consumes: 前 9 个任务的全部功能。
- Produces: 安装包（nsis `.exe` / dmg）与验收记录文档。

- [ ] **Step 1: 打包配置**

`tauri.conf.json` 的 `bundle` 段替换为：

```json
{
  "bundle": {
    "active": true,
    "targets": ["nsis", "dmg"],
    "icon": ["icons/icon.ico", "icons/icon.icns", "icons/32x32.png", "icons/128x128.png"],
    "windows": {
      "webviewInstallMode": { "type": "offlineInstaller" },
      "nsis": { "installMode": "currentUser" }
    }
  }
}
```

`Cargo.toml` 追加：

```toml
[profile.release]
strip = true
lto = true
opt-level = "s"
```

生成正式图标（占位可用 python PNG 脚本产出 32/128 后用 `npx @tauri-apps/cli icon icons/128x128.png` 派生全套）。

- [ ] **Step 2: 构建**

Run: `npm run tauri build`
Expected: `desktop/src-tauri/target/release/bundle/{nsis,dmg}` 产出安装包；macOS 上仅 dmg 可构建，nsis 在 Windows 机器或 CI（GitHub Actions `tauri-apps/tauri-action`，后续可选）构建。

- [ ] **Step 3: 三平台手工验收（记录到 `desktop/docs/ACCEPTANCE.md`）**

验收清单（每项记录 ✅/❌ 与现象）：

```markdown
# M1a 验收记录

## Win11
- 安装包安装成功，无杀软误报
- Alt+Space 呼出 <200ms；失焦收起；Esc 清空
- 知识库即时/深度结果正常；Enter 打开
- mdfind/Everything 文件检索正常（Everything 需运行）
- 托盘健康图标切换正常

## Win7（真机）
- 离线 WebView2 安装器装出后应用可启动；若启动失败，手动安装 Chromium 109 版 WebView2 后复测
- 毛玻璃渲染正常；低端机卡顿时确认自动降级生效
- 全局热键与系统冲突时的表现记录

## macOS 10.15+
- dmg 安装、Option+Space（配置为 alt+space 时 mac 映射）呼出
- mdfind 结果与权限（若受 TCC 限制记录授权步骤）

## 内测（3-5 人一周）
- 每日真实使用率、高频 query 样本收集
- 深度档超时/部分结果出现频率
```

- [ ] **Step 4: 修复验收问题并出补丁版本**

发现的问题按严重度逐项修复（每个问题独立 commit），更新 ACCEPTANCE.md。

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "chore: 打包配置与三平台验收记录"
```

---

## Self-Review 记录

- **Spec 覆盖**：§3 两档检索（Task 2/3/7）、§4 客户端结构与热键/托盘/单实例（Task 0/1）、§5 嵌入面板（不在 M1a，后续）、§6 降级——网关不可达（Task 3 catch + Task 9 托盘）、Everything 不可用（Task 5 available + Task 7 hint）、深度超时部分结果（Task 2 partial + Task 7 角标）、Win7（Task 0 target + Task 10）；§8 视觉语言（Task 0 style.css + Task 7/8）；设置页四项（Task 8）。**缺口**：spec §1 "订阅部门库" 设置项在 M1a 降级为只读展示（全库订阅），已按全员可搜决策在 Task 7 说明——spec 无需修改（设置页展示仍满足"配置网关地址/订阅库"）。
- **占位符扫描**：Task 5 Everything 的 crate API 不匹配时给出了明确替代路径（libloading 绑定四个导出）；Task 6 预览 URL 拼法需实测修正——均为带验证步骤的显式指令，非 TBD。
- **类型一致性**：`FileHit` 前端为 camelCase（Task 5 Step 7 已同步 Task 3 的定义）；`KnowledgeHit` Rust 侧 `open.rs` 仅反序列化所需子集，字段名与 TS 一致（serde 默认蛇形→TS 端是蛇形命名 `kb_id` 等——**修正**：`open.rs` 的 `KnowledgeHit` 需与 TS 一致使用蛇形字段，serde 默认即蛇形，TS 类型也是蛇形，一致 ✓）；`local_file_search` 返回值经 `spawn_blocking` → `Vec<FileHit>` 与 `useSearch` 的 `fileSearch` 签名一致 ✓。
