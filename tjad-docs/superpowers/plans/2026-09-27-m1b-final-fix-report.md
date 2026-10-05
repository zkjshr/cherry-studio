# M1b 终审修复波报告（F1–F4）

> 日期：2026-09-27 · 基线 HEAD a1926f1 · 完成后 HEAD 5dc0b10
> Commits：`2488622 fix: 多屏落屏与覆盖层宽度修复`（F1+F2，src-tauri）、`5dc0b10 feat: 便签 widget 补齐 spec 范围`（F3+F4，前端+文档）

## 结论速览

| 项 | 状态 | 验证 |
| --- | --- | --- |
| F1 多屏三步舞缺陷 | ✅ 已修复 | 本机三屏逐屏真机复验通过（CGWindowList 数值 + 截图留痕） |
| F2 FileHit isDir 类型一致 | ✅ 已修复 | cargo test 13 passed（新增 marks_dirs_via_metadata） |
| F3 便签 widget | ✅ 已补齐 | 真机「输入→收起→再呼出→内容还在」+ 应用重启后仍在 |
| F4 台账留痕 | ✅ 已写入 | docs/ACCEPTANCE.md 台账已知边界引用段 |
| 四道验证门 | ✅ 全绿 | cargo test / cargo clippy -D warnings / npm test / npm run build |

## F1 多屏落屏与覆盖层宽度（阻塞项）

### 根因与修法

- 原实现：窗口出生即 `.maximized(true)`，show 时「unmaximize → 挪到目标屏原点 → re-maximize」。macOS 上 unmaximize 需要恢复到「进入 maximize 前记录的 frame」，而该窗口从未有过正常 frame，恢复结果不可控 → 覆盖层宽度达单屏两倍、zoom 落屏不跟随光标。
- 修复（`src-tauri/src/tray.rs`）：
  1. 创建窗口去掉 `.maximized(true)`；
  2. `toggle_organizer` 两条呼出路径均改为 **先 show 再摆位**；
  3. `place_on_cursor_monitor` 用 `windows::monitor_of`（光标物理坐标 + `app.available_monitors()` 的物理 frame）算目标屏，`set_size(PhysicalSize)` → `set_position(PhysicalPosition)` 显式铺满整屏，不再依赖 maximize 状态。

### 调试中发现并一并处理的时序坑

首版修复（摆位在 show 之前排队）真机实测窗口 frame 落在 `(0, 30, 1920, 1080)`——顶部被压到菜单栏（macOS 26 本机菜单栏高 30px，`NSScreen.visibleFrame` 实测 main 屏 1050/1080）下缘，底部悬出屏外 30px。纯 AppKit 最小复现（borderless NSWindow + setFrameTopLeftPoint）无此约束，判定为 Tauri/tao 异步摆位与窗口首次 orderFront 约束的时序问题；把摆位移到 show 之后（size 先、position 后）后 frame 精确。该顺序已固化在代码与注释中。

### 三屏真机复验（逐屏现象）

环境：macOS 26.5.1 arm64，三屏 1920x1080 @1x 横排（CGDisplayBounds：0 / 1920 / 3840，均 y=0）。方法：Swift 探针合成鼠标移动（CGWarp + mouseMoved）→ 合成 Alt+D 呼出（global-hotkey 对合成事件偶发双触发，故用「按键后查 CGWindowList、未显示则重试」循环）→ CGWindowListCopyWindowInfo 读窗口 bounds + `screencapture -D` 截图留痕。

| 屏 | 光标（全局物理坐标） | CGWindowList「整理模式」bounds | 判定 | 留痕 |
| --- | --- | --- | --- | --- |
| 1 | (960, 540) | `(0, 0, 1920, 1080)`，onscreen=1 | 恰好铺满屏 1，无双倍宽 | evidence/final-screen1.png |
| 2 | (2880, 540) | `(1920, 0, 1920, 1080)`，onscreen=1 | 恰好铺满屏 2，落屏跟随光标 | evidence/final-screen2.png |
| 3 | (4800, 540) | `(3840, 0, 1920, 1080)`，onscreen=1 | 恰好铺满屏 3 | evidence/final-screen3.png |

- 每屏截图可见：毛玻璃覆盖层铺满该屏、顶部「整理模式」提示、左上时钟、右上 WeKnora 速览（网关不可达降级文案，符合本机不在内网预期）、左下便签卡、底部居中 Dock（知识库/检索/设置）；屏 2/3 堆栈 chips（文档7 表格2 最近一周1 未分类14）正常。
- Esc 收起后再跨屏呼出，落屏始终为光标所在屏。终审所述「双倍宽」「落错屏」两现象均不复现。
- 复验在打包态进行：`npm run tauri build -- --bundles app` 产出的 TJADKnows.app 经 `open`（LaunchServices）启动——与交付路径一致。

### 复验方法备忘（后续再验必读）

1. **必须用打包 .app 经 LaunchServices 启动**。以 `nohup` 直接拉起裸二进制时，WKWebView 的 WebContent XPC 不创建，两窗口全部空白（截窗为纯黑），窗口几何仍正确但无内容渲染——harness 现象，非应用缺陷。对照：同一份代码经 `open` 启动渲染正常。
2. 合成 Alt+D 对 global-hotkey 偶发一次按键双触发（等效「呼出又立即收起」），自动化验证需「按键→查询→重试」循环；真人按键无此问题（前轮验收已单独确认）。
3. 重编译 .app 会更换 ad-hoc 签名 → TCC「桌面文件夹」授权被重置，首屏呼出会弹授权框，允许即可（截图 final-screen1.png 中央即该弹窗）。

## F2 FileHit is_dir

- `src-tauri/src/search/mod.rs`：`FileHit` 增 `pub is_dir: bool`（serde rename_all=camelCase 已有，序列化为 isDir，与 `src/launcher/types.ts` 必填声明对齐）；`parse_mdfind_output` 用已有 metadata 判 `is_some_and(|m| m.is_dir())`，元数据取不到时按文件兜底；新增单测 `marks_dirs_via_metadata`（临时目录构造 文件/目录/不存在路径 三态断言）。
- `src-tauri/src/search/everything.rs`（Windows，libloading 版）：每个结果路径 `std::fs::metadata(&path).map(|m| m.is_dir()).unwrap_or(false)`。
- `cargo test` 13 passed。

## F3 便签 widget

- **实现选型：独立文件 `src/organizer/NoteWidget.vue`**（Widgets.vue 已含时钟+速览两卡、模板/脚本职责已满，独立文件便于后续按 spec 继续挂新卡）；在 Organizer.vue 中 `<NoteWidget />` 挂载（首轮真机验证曾发现仅加模板漏加 import——构建不报错但组件不渲染，已修复并复验）。
- 规格：无边框透明 textarea 多行输入；localStorage 键 `tjadknows.note`；输入 debounce 500ms 自动保存，右上角「已保存」微提示 1.5s 后消失（真机截图捕到该提示，evidence/note-typed-crop.png）；`.frost` 毛玻璃小卡，`left:24px; bottom:96px`、240x180，左下角与底部居中 Dock 无重叠；`data-interactive` 标记与既有卡片一致。
- 兜底：窗口 blur / pagehide 时同步落盘一次，避免收起（失焦即 hide）时最后一批击键停在防抖窗口内。
- 真机复验（屏 3，剪贴板 Cmd+V 注入文本规避拼音 IME）：
  1. 输入「终审修复波 F3 便签持久化复验 2026-09-27」→ 0.9s 后「已保存」提示可见；
  2. Esc 收起（CGWindowList onscreen=0）→ 再呼出 → 内容还在（evidence/note-reshow-crop.png）；
  3. `pkill` 退出应用 → 重新 `open` .app → 呼出整理模式 → 内容仍在（localStorage 跨重启，evidence/note-restart-crop.png）；
  4. 验证后已清空便签并收起，不留测试痕迹。

## F4 台账留痕

docs/ACCEPTANCE.md「台账已知边界引用」新增首行：spec §9 便签 widget 与速览「收藏」维度：便签已于本修复补齐；「收藏」维度依赖 WeKnora 收藏 API，暂缺、联调后评估（收藏维度维持裁剪但留痕）。

## 验证门（最终代码）

- `cargo test`：13 passed, 0 failed
- `cargo clippy --all-targets -- -D warnings`：零告警
- `npm test`（vitest）：9 files / 26 tests passed
- `npm run build`（vue-tsc + vite）：通过，dist 含便签产物
- 打包冒烟：`npm run tauri build -- --bundles app` 产出 TJADKnows.app（5.03 MiB），LaunchServices 启动 + 三屏呼出冒烟通过（即复验所用实例）

## 疑虑与备注

1. **摆位时序依赖「show 后摆位」**：这是在本机 macOS 26 实测出的唯一稳定顺序（摆位先于首序 show 会被系统约束改写 frame）。若后续 Tauri/tao 升级改变该行为，需重跑三屏复验。
2. **place_on_cursor_monitor 用整屏 frame 而非工作区**：无边框透明覆盖层铺满整屏（含菜单栏背后区域），与旧 maximize 观感一致；如未来要求让出 Dock/菜单栏需改用 visibleFrame。
3. Everything 路径（Windows）的 is_dir 逻辑无法在本机执行，仅有代码评审 + 单测覆盖 mdfind 侧；Windows 真机项沿用既有待验清单。
4. 速览「收藏」维度按终审裁定维持裁剪，已留痕（F4），依赖 WeKnora 收藏 API 联调后评估。
