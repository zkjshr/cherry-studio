# M1a 验收记录

> 验收日期：2026-09-27 · 版本：0.1.0 · 构建配置见 `src-tauri/tauri.conf.json`（bundle targets: nsis / dmg，WebView2 离线安装器，NSIS currentUser 安装模式）。
>
> 标记说明：✅ 本机已验证；⬜ 待人工验收（列明环境与步骤）。

## 构建产物

| 平台 | 产物 | 状态 |
| --- | --- | --- |
| macOS | `src-tauri/target/release/bundle/dmg/TJADKnows_0.1.0_aarch64.dmg` | ✅ 本机构建成功（见下方构建说明） |
| Windows 11/10 | `src-tauri/target/release/bundle/nsis/*.exe` | ⬜ 待 Windows 机器或 CI（`tauri-apps/tauri-action`）构建 |
| Windows 7 | 同上（x86_64-pc-windows-msvc target，Task 0 已配置） | ⬜ 随 nsis 一并构建 |

Release profile（`Cargo.toml`）：`strip = true`、`lto = true`、`opt-level = "s"`。

**构建说明（macOS dmg）**：`npm run tauri build` 完成编译并产出 `bundle/macos/TJADKnows.app`，但其中的 Finder 美化 AppleScript 步骤在非 GUI shell 下报 `AppleEvent已超时 (-1712)`（本机环境限制，非配置问题）。用同一 `bundle_dmg.sh` 加 `--skip-jenkins` 手动补产 dmg（仅跳过图标定位等外观定制，不影响内容）；已验证 dmg 可挂载、含 `TJADKnows.app` 与 Applications 链接。后续在有 GUI 自动化权限的环境重跑 `npm run tauri build` 即可得到带美化布局的 dmg。

## Win11

- ⬜ 安装包安装成功，无杀软误报（依赖 nsis 构建产物）
- ⬜ Alt+Space 呼出 <200ms；失焦收起；Esc 清空
- ⬜ 知识库即时/深度结果正常；Enter 打开
- ⬜ mdfind/Everything 文件检索正常（Everything 需运行）
- ⬜ 托盘健康图标切换正常

### 待人工验收条目（来自实现台账）

1. **nsis 安装**：安装包尚未构建。在 Windows 机器上运行 `npm run tauri build`（或配置 GitHub Actions `tauri-apps/tauri-action`）后，验证安装/卸载（currentUser 模式应免管理员权限）与 WebView2 离线安装器集成。
2. **Everything 运行时行为**：Task 5 采用 libloading 动态绑定 Everything SDK（`Everything_SetSearchW` / `Everything_QueryW` / `Everything_GetResultFileNameW` 等），需真机确认：
   - Everything64.dll/Everything32.dll 的 DLL 搜索路径（`Everything.exe` 同目录策略）实际生效；
   - `Everything_QueryW` 为阻塞调用，确认在 `spawn_blocking` 中不卡 UI，且 Everything 未运行时走 available=false 降级提示；
   - `size`/`modified` 字段恒为 None（Task 5 已知：绑定未取 `Everything_GetResultSize`/`GetResultDateModified`），确认 UI 上文件结果无空字段渲染问题。

## Win7（真机）

- ⬜ 离线 WebView2 安装器装出后应用可启动；若启动失败，手动安装 Chromium 109 版 WebView2 后复测
- ⬜ 毛玻璃渲染正常；低端机卡顿时确认自动降级生效
- ⬜ 全局热键与系统冲突时的表现记录

### 待人工验收条目（来自实现台账）

1. **WebView2 109 离线安装**：Win7 只能装 Chromium 109 内核版 WebView2，需在真机验证 offlineInstaller 产出的引导是否成功、失败时手动安装路径。
2. **毛玻璃性能降级**：低端机确认 blur 背景自动降级（Task 8 的降级开关）生效。
3. **热键冲突**：Win7 上 Alt+Space 默认被系统窗口菜单占用，记录 RegisterHotKey 失败时的提示与替代方案。

## macOS 10.15+

- ✅ dmg 构建：`npm run tauri build` 成功，产物 `bundle/dmg/TJADKnows_0.1.0_aarch64.dmg`
- ⬜ dmg 安装、Option+Space（配置为 alt+space 时 mac 映射）呼出
- ⬜ mdfind 结果与权限（若受 TCC 限制记录授权步骤）

### 待人工验收条目（来自实现台账）

1. **Option+Space 热键真人复核**（Task 1 遗留）：`alt+space` 在 macOS 上的映射需真人在真机确认呼出/再按收起。
2. **HiDPI 缩放屏窗口定位**（Task 1 遗留）：在缩放（非默认）分辨率的外接屏上验证窗口居中/位置不漂移。
3. **托盘图标呈现**（Task 9 遗留）：确认 tray-online.png / tray-offline.png 在浅色/深色菜单栏下的可见性（PNG 为黑色剪影时深色菜单栏可能不显眼，必要时补 Template Image）。
4. **托盘健康状态迁移**（Task 9 遗留）：网关 true→false→true 三态切换后图标与菜单文案正确迁移、无残留。
5. **reveal_in_folder 行为**：Enter/打开定位到文件所在文件夹并高亮（tauri-plugin-opener revealItemInDir），真人点击复核。

## 内测（3-5 人一周）

- ⬜ 每日真实使用率、高频 query 样本收集
- ⬜ 深度档超时/部分结果出现频率

## 联调（真实 WeKnora）

- ⬜ 真实 WeKnora 冒烟：instant/deep 两档结果字段验证（清单见 gateway 侧 task-2-report）
- ⬜ 预览 URL 拼法实测：`{base}/file?knowledgeId={id}`（Task 6 遗留，需以真实网关返回的 id 修正拼法）
- ⬜ 深度档部分结果角标：网关超时时前端展示部分结果 + 角标提示

---

# M1b 验收记录（Mac 风格收纳层）

> 验收日期：2026-09-27 · 版本：0.1.0 · HEAD 181b9ad + Task 10 + 终审修复波（F1–F4） · 打包态 .app 实机冒烟（macOS 26.5.1 arm64，三屏 1920x1080 扩展桌面，本机不在内网）。
>
> 标记说明：✅ 本机已验证；⬜ 待人工验收（列明环境与步骤）。

## 构建产物（M1b）

| 产物 | 路径 | 状态 |
| --- | --- | --- |
| macOS .app | `src-tauri/target/release/bundle/macos/TJADKnows.app` | ✅ `npm run tauri build` 产出（release 编译 1m13s） |
| macOS dmg | `src-tauri/target/release/bundle/dmg/TJADKnows_0.1.0_aarch64.dmg` | ✅ 美化失败后 `bundle_dmg.sh --skip-jenkins` 补产，挂载验证含 TJADKnows.app 与 Applications 链接 |

**dmg 步骤现象记录（同 M1a，且本次查明根因）**：`npm run tauri build` 中 bundle_dmg.sh 的 Finder 美化 AppleScript 在本 shell 环境报 `AppleEvent已超时 (-1712)` 失败；失败运行会残留两处脏状态——①挂载卷未弹出（`/Volumes/dmg.*`），②中间产物 `rw.*.dmg` 落在 `bundle/macos/` 源目录内——导致后续 hdiutil 报"设备上无剩余空间"的连锁失败（磁盘实际有 180Gi 空闲）。弹出残留卷、删除残留 rw 文件后以 `bundle_dmg.sh --skip-jenkins` 补产成功（仅跳过图标定位等外观定制）。

**关键修复（Task 10 + 修复轮 1）**：项目此前缺少 `src-tauri/capabilities/` 权限声明，Tauri 2 ACL 为空，打包态前端 `listen()`（fs-changed/gateway-health）等核心命令被静默拒绝。Task 10 补 `src-tauri/capabilities/default.json`（`core:default`，作用于 launcher/organizer/settings 三窗口）——但当时"core:default 覆盖 hide()"的验收声明**不实**：`core:window:default` 只含只读查询，不含 `core:window:allow-hide`；打包态实际验证通过的 Esc/点空白收起走的是 `invoke("hide_organizer")` **自定义命令**（从来不受 ACL 管辖），而 launcher Esc 走 `getCurrentWindow().hide()`（前端核心命令）在打包态仍被静默拒绝。修复轮 1 在 permissions 显式补 `core:window:allow-hide`，并以打包态 A/B 复验（见下方 launcher 条目）。

## M1b 本机已验证（打包态）

- ✅ 整理模式呼出：托盘菜单「整理模式」呼出覆盖层，毛玻璃背景 + 顶部提示，铺满屏
- ✅ 整理模式收起：Esc、点空白、失焦三条路径均收起（Alt+D 见下）
- ✅ Alt+D 收纳热键：注册成功（启动 stderr 无注册失败告警，无系统冲突）；合成按键实测「隐藏」稳定触发，「呼出」在合成事件下偶发不触发（合成 CGEvent 限制，真人按键复核列待验）
- ✅ 堆栈归堆：默认四规则（文档/表格/图片/最近一周）+ 未分类恒末位；桌面 24 项 → 文档7 表格2 最近一周1 未分类14
- ✅ fs-changed 实时重扫：打包态 touch 桌面 .txt → 防抖 500ms 后堆计数 7→8，观察延迟 <1s
- ✅ 堆栈展开网格/打开/reveal：点堆栈卡展开网格（3 列）；普通点击打开（.txt 在 TextEdit 打开，overlay 随失焦收起，最近使用入账）；Cmd+点击在 Finder 定位并高亮文件（reveal，不入最近使用）
- ✅ 点空白收起（spec「穿透」按绑定解释的实现）：空白单击收起 overlay；网格展开态下第一击先关网格（透明遮罩层 z-21 吸收点击）、第二击收起——已知交互，见下方台账引用
- ✅ Dock：三固定项（知识库/检索/设置）；「检索」点击呼出 launcher 且 overlay 失焦收起
- ✅ 时钟日历 widget：时间/日期正确；WeKnora 速览 widget：网关不可达时显示「网关不可达」降级文案（本机不在内网，符合预期）
- ✅ 便签 widget（终审 F3 补齐）：毛玻璃小卡挂左下角（left:24/bottom:96，不与底部居中 Dock 重叠，240x180）；输入防抖 500ms 自动保存 localStorage（tjadknows.note），右上角「已保存」微提示 1.5s 后消失（截图留痕 .superpowers/sdd/2026-09-27-m1b-organizer/evidence/note-typed-crop.png）；本机真机实测「输入内容 → 收起 → 再呼出 → 内容还在」，且退出应用重启后再呼出内容仍在（跨重启持久化，evidence/note-restart-crop.png）
- ✅ launcher：启动时创建并出现于光标所在屏（720x480 毛玻璃搜索框）；Alt+Space 切换显隐两次验证通过（Rust 侧 show/hide，不受 ACL 影响）；Esc 关窗修复轮 1 补 `core:window:allow-hide` 后打包态 A/B 复验通过——修复前同口径合成 Esc 后窗口 onscreen=true（未隐藏，即被 ACL 静默拒绝，此前归因 IME 系误判），修复后 onscreen=false（正常关窗）；真人按键仍列待验
- ✅ 托盘：菜单四项（呼出检索/整理模式/设置…/退出）齐全可用

### 性能核对（预算：扫描 <2s、两窗口常驻内存合计 <150MB）

- ✅ 大桌面扫描：桌面 325 项（300 临时文件 + 原有）时，fs-changed → 防抖 500ms + 扫描归堆渲染 ≈0.3–0.5s，端到端观察 0.6–1.0s（逐帧截图 200ms 步进测得），<2s 预算
- ✅ 内存（top「MEM」口径，即活动监视器「内存」列 / phys_footprint；两窗口均创建、桌面 325 项）：

| 进程 | MEM |
| --- | --- |
| 主进程（Rust 宿主 + 托盘 + 双热键 + watcher） | 32M |
| launcher WebContent | 23M |
| organizer WebContent | 52M |
| **两窗口合计（含宿主）** | **≈107M < 150MB** |

  另有系统级共享 WebKit GPU（71M）/ Networking（7.3M）XPC 服务，为多应用共享，未计入。临时文件 300+2 个测后已全部删除（桌面恢复原状）。

## M1b 待人工 / 联调

1. **Windows 真机**：notify 文件监听行为；known-folder 桌面路径解析；自定义文件夹指向网络盘时的扫描/监听降级；Alt+D 与系统/输入法冲突（`register_or_fallback` 回退提示）。
2. **WeKnora recent 字段实测**：网关不可达未能验证 `updated_at` 计数容错能否激活「最近使用」速览，需内网实测。
3. **spec 穿透解释与配置重启生效**：点击空白收起（非穿透）实现已验；堆栈/热键/文件夹配置修改后按「重启生效」口径需真人走查一遍设置页保存→重启→生效链路。
4. **OS 拖出/拖拽入库**：spec 自身归 M3，未实现未验。
5. **多屏 place_on_cursor_monitor「三步舞」缺陷（终审 F1，已修复并复验 ✅）**：原缺陷（Task 10 三屏实测）——出生即 `maximized(true)` 的窗口 unmaximize 无法恢复原始 frame，导致 ①覆盖层宽度达单屏两倍；②落屏不跟随光标。修复：创建窗口去掉 `.maximized(true)`；呼出改为 show 后按光标所在 monitor 的物理 frame 显式 `set_size` + `set_position`（铺满整屏，不依赖 maximize 状态）。**本机三屏复验（macOS 26.5.1 arm64，三屏 1920x1080 横排 0/1920/3840，合成鼠标移动 + CGWindowList + 截图留痕，evidence/final-screen{1,2,3}.png）**：
   - 屏 1：光标 (960,540) 呼出 → CGWindowList bounds=(0,0,1920,1080)，与屏 1 frame 完全一致，铺满无双倍宽；毛玻璃/时钟/便签/Dock 渲染正常；
   - 屏 2：光标 (2880,540) 呼出 → bounds=(1920,0,1920,1080)，恰好铺满屏 2；堆栈/便签/速览正常；
   - 屏 3：光标 (4800,540) 呼出 → bounds=(3840,0,1920,1080)，恰好铺满屏 3；
   - 收起（Esc）→ 呼出跨屏往返，落屏始终跟随光标所在屏。结论：双倍宽与落错屏两现象均消失。
   - 复验方法备注：验证须以打包 .app 经 LaunchServices 启动；以 nohup 直接拉起裸二进制时 WKWebView XPC 不出内容进程、窗口全空（harness 现象，非应用缺陷）。
6. **全屏 Space 环境的呼出语义（新增现象记录）**：目标屏处于全屏 App Space 时，托盘「呼出检索」/Dock「检索」的 show_launcher 只把 launcher 窗口置可见于其所在桌面 Space（CGWindowList onscreen=false，窗口存活、位置正确），不主动切换 Space；回归到桌面 Space 后窗口可正常显示。单屏常规桌面（无全屏 Space）预期无此现象，待真机确认。
7. **真人键盘/输入复核**：真实按键下的 Alt+D / Alt+Space；**launcher Esc 打包态关窗**（修复轮 1 已以合成 Esc A/B 法复验通过：修复前后仅差 `core:window:allow-hide`，交付路径一致——修复前 onscreen 不变=权限被拒，修复后 onscreen=false=关窗生效；但合成按键非真人输入，最终以真人按键复核为准）；launcher 搜索真实输入（本机系统拼音 IME 会拦截合成键盘事件，未能验证搜索全链路）。

### 台账已知边界引用（M1b 相关，均无害/已挂账）

- spec §9 便签 widget 与速览「收藏」维度：便签已于本修复补齐；「收藏」维度依赖 WeKnora 收藏 API，暂缺、联调后评估。
- Esc 双触发（幂等无害）；创建窗口失败静默吞（建议 eprintln）。
- Dock 最近列表同会话不实时刷新（本次实测确认：网格内打开文件入账后 Dock 列表不变，重开窗口后生效；storage 事件可解）。
- 浮层（堆栈网格/速览）视口边缘避让未做。
- watch 失败退避 backoff 已接线但被 30s 周期地板掩盖（动态范围 30–60s）。

## 联调结论（2026-09-28，真实实例 10.137.200.58:8091）

- WeKnora API key 鉴权头为 **X-API-Key**（Bearer 会 401）——网关已修
- 标题/最近检索真实路由为 **GET /api/v1/knowledge/search**（`/api/v1/search` 在此实例 404）；支持 `recent=true`；字段含 kb_name/updated_at（前端"今日新增"计数可激活）
- hybrid-search 可用，返回**平铺 chunk 字段**（knowledge_id/knowledge_title/score，无 kb_name），**忽略 limit 恒返 80 条**——网关截断+库列表回填 kb_name
- 实例有 54 库、34,258 篇文档；部分库列表接口 chunk_count 显示 0 但 hybrid-search 有语义结果（以实测为准）
- 知识结果打开落点改为 **{weknoraWebUrl}/knowledge-bases/{kb_id}**（库详情页实测 200；该实例文档预览无独立 URL）；若实例前端为 hash 路由（地址栏带 #），需人工在浏览器确认后微调拼法
- 本地三档冒烟：instant 20 条 / deep 12 条归一 / recent 30 条，全部通过

---

# M2 验收记录（桌宠主入口）

> 验收日期：2026-09-28 · 基线 HEAD `03a059e` + T6 顺手修（PetApp onDown dragging 置位下移 try 保护域）· 构建升级 `vite build.target: chrome109 → es2022` · 打包态 .app 实机冒烟（macOS 26.5.1 arm64，主屏 1920x1080@1x + 两台 1080p 扩展屏）。
>
> 标记说明：✅ 本机已验证；⬜ 待人工验收（列明环境与步骤）。
> **环境限制（如实记录）**：本验收会话中 GUI 处于锁屏（密码锁），合成鼠标事件（CGEventPost）已验证可用但无法到达锁屏之下的应用窗口，System Events 点击权限缺失（-25200，与 T4/T5 会话一致）。因此打包态冒烟分两层：**免 GUI 层**（CGWindowList 窗口几何 / config 注入重启 / 网关 curl 全链 / 进程内存）已实机验证；**真鼠标交互层**（点击/拖拽/Esc/右键/托盘/面板内对话）列待人工，验证步骤已写明。

## 构建产物（M2）

| 产物 | 路径 | 状态 |
| --- | --- | --- |
| macOS .app | `src-tauri/target/release/bundle/macos/TJADKnows.app` | ✅ `npm run tauri build`（release 47.2s；含 T6 顺手修与 es2022 前端产物） |
| macOS dmg | `src-tauri/target/release/bundle/dmg/TJADKnows_0.1.0_aarch64.dmg` | ✅ AppleScript 美化超时后按既定流程 `bundle_dmg.sh --skip-jenkins` 补产（2.16MB；同 M1a/M1b 现象），挂载验证含 TJADKnows.app 与 Applications 链接 |
| Windows nsis | `src-tauri/target/release/bundle/nsis/*.exe` | ⬜ 无 Win 机——挂 GitHub Actions（`tauri-apps/tauri-action`）或用户自建，M2 未构建 |

**构建升级（T6 Step 1）**：`vite.config.ts` `build.target` `chrome109 → es2022`。`npm run build`（vue-tsc + vite）通过；grep 全 `src/` 无任何依赖 chrome109 特性的引用（es2022 目标较 chrome109 只会更宽松，例行确认无破坏）。`npm test` 59/59 通过（含 T6 顺手修后的全量回归）。

**T6 顺手修（T5 审查 Important）**：`src/pet/PetApp.vue` `onDown` 的 `dragging.value = true` 原置于 try/finally 保护域之前——其前的 `await win.outerPosition()` / `await listen(...)` 若 reject，无 finally 兜底则 dragging 永久 true（皮肤永久 dragged、onDown 永久早退）。已下移至 try 块首行（listen 保持在前，不丢先于 `begin_pet_drag` 到达的判停事件）。测试/构建通过；锁屏导致打包态真实点击复验受限，逻辑覆盖见 `npm test` 回归。

## M2 本机已验证（打包态，免 GUI 层）

验证方法：.app 经 LaunchServices（`open`）启动（裸二进制启动有 WKWebView XPC 问题，见 M1b 备注）；窗口几何经 CGWindowList；位置/开关经 config.json 注入 + 重启；对话链路经网关同端点 curl（面板发送的即 `GET /api/chat/stream`，dev-smoke token，本地 uvicorn 8787 + WeKnora 10.137.200.58 + ollama 192.168.66.25）。

| 项 | 结果 | 证据 |
| --- | --- | --- |
| 桌宠出现 + 默认位 | ✅ | 启动即现 pet 窗 `TJADKnows 桌宠` @ (1660,760) 200x240 = `default_pet_pos((0,0,1920,1080))` 精确值（CGWindowList bounds 全等）；launcher 720x480 同创建 |
| 位置记忆（恢复路径） | ✅ | config 注入 `petX:700, petY:300` → 重启后 pet 窗精确 @ (700,300) 200x240（CGWindowList）；清除字段重启回落默认位 |
| petEnabled=false 重启生效 | ✅ | 开关置 false 重启：仅 launcher 窗，**无 pet 窗**（CGWindowList 为证）；还原 true 重启后 pet 复现默认位 |
| 网关对话链路（四类事件实测（error 事件 T1 设计为不发，前端支持保留）） | ✅ | curl 全链实测（见下节）；status/sources/delta/done 四类事件全部到达，鉴权 401 语义正常 |
| pet+panel 常驻内存 | ✅ | 见下方性能小节 |
| dmg 完整性 | ✅ | hdiutil 挂载 → TJADKnows.app + Applications 链接 → 卸载，无残留卷 |

### 网关对话链路实测明细（2026-09-28 20:09–20:30）

| 轮次 | 请求 | 事件链 | 结果 |
| --- | --- | --- | --- |
| 1 | q=集团资质（52 库自动） | status(正在检索 52 个…) → status(**命中 0 篇**) → delta(兜底文案) → done{partial:true} | 21.2s；WeKnora 并发扇出 0 命中（直连实测单库延迟 3.7s > 单库 3s 预算——T1 已挂账「预算偏紧」） |
| 2 | q=资质（52 库自动） | 同上 0 命中 partial | 21.1s（同上，连续两轮，实例负载波动） |
| 3 | q=资质 & kb_ids=101-市场运营部 | status(检索 1 库) → status(**命中 2 篇**) → **sources(2 篇，kb_name 回填：《关于公路行业资质通过建设部审查意见公示的通知.md》《喜讯集团相继获得建筑行业甲级和城乡规划甲级资质.md》)** → delta(**180s 首 token 硬顶降级**：「生成服务暂不可用：TimeoutError…」) → done{partial:true} | 总 3:00.6 |
| 4 | 同轮 3 | 同上（180s 降级） | 总 3:00.7 |

**首 token 实际时长（如实记录）**：本轮 ollama (qwen2.5:14b) 首 token **始终未在 180s 内到达**（连续两轮触发网关硬顶降级，降级路径本身按设计工作）。直连 ollama 探针：模型已载入 VRAM（15.3GB 全量），但 240s 流式 tiny prompt **0 token**——GPU 争用实锤（开放项，交用户侧排查 ollama 主机负载）。历史正常参照：T1 同链路首 delta 21.4s、T4 完整流成功。**检索段（status/sources/kb_name 回填/超时降级/partial 语义）本轮全部实测通过；生成段待 ollama 主机恢复后以面板人工复验。**

### 性能（top「MEM」口径，与 M1b 同法；pet 态）

| 进程 | MEM |
| --- | --- |
| 主进程（Rust 宿主 + 托盘 + 双热键 + 4 窗管理） | 25M |
| WebContent（launcher） | 19M |
| WebContent（pet，**panel 渲染于同窗同进程**，扩窗 560x500 不新增进程） | 16M |
| **pet+panel 相关合计（含宿主）** | **≈60M < 150MB 预算** |

面板打开态的进程级内存与 pet 态相同（panel 非独立窗口/进程）；面板扩窗后 webview 实际增量列待人工（锁屏），预算余量大（90MB）。

## M2 待人工（本会话锁屏，真鼠标交互层）

环境：解锁后桌面上 .app 运行中（当前以 petEnabled=true 默认配置）。以下每项 30 秒内可完成：

1. **点击开面板 + 宠物不跳动（第 0 步打包态复验）**：单击宠物 → 面板打开（判停 ~400ms 后），全程宠物屏幕位不动。预期窗口几何：560x500 @ (1300,500)（右下角锚定平移）。T5 dev 态探针几何证据：修复前 `set_size` 后即时 getter 读旧值 → 锚定位移算 0 → 宠物随窗口右下扩跳出屏；修复后 open target=(1300,500) 精确、close-pre=(1300,500)/(560,500) 两轮干净（见 task-5-report）。
2. **拖拽 + dragged→idle 视觉复位 + 位置记忆（落盘路径）**：按住拖动（拖拽中皮肤 dragged、跟随光标）→ 松手 ~400ms 后回 idle → 检查 `~/Library/Application Support/cn.tjad.tjadknows.desktop/config.json` 的 petX/petY 已更新 → 退出重启 → 宠物在拖拽后位置出现。（恢复路径已由 config 注入法打包态验证 ✅）
3. **面板内对话全链**：面板输入框发送问题 → thinking 皮肤 → status 行 → sources chips → 逐字回答（talking）→ done；Esc 关面板；流式中关面板 → idle。**生成段依赖 ollama 主机恢复**（本轮 >200s 无首 token，见上）。
4. **右键菜单**：organizerEnabled=false（当前配置）应显示 **3 项**：呼出检索/设置…/退出，**无「整理模式」**；设置页开启整理模式并重启后应显示 **4 项**（含整理模式）且可用。
5. **托盘**：菜单栏 TJADKnows 图标 → 「显示/隐藏桌宠」开/关两次（pet 窗消失/复现）；菜单项与 organizerEnabled 联动同上。
6. **设置两开关真人走查**：设置页勾选 petEnabled=false + 保存 → 重启无桌宠；organizerEnabled 同理（菜单无整理模式 + Alt+D 不呼出）。
7. **真实鼠标手感全套**：点击响应（~400ms 判停延迟体感）、慢起拖拽（按住 >400ms 再移动不被误判点击）、长按不动（>4.3s 看门狗，不 toggle）、IME 组词 Enter 不发送（含 keyCode 229 残留场景）、面板长文贴底滚动跟随/上翻不拉扯。

## M2 待 Windows 真机

1. **nsis 构建**：无 Win 机——挂 GitHub Actions（`tauri-apps/tauri-action`，bundle targets 已含 nsis + WebView2 offlineInstaller + currentUser 安装模式）或用户自建 `npm run tauri build`。构建后验证：安装/卸载、开机自启、桌宠/面板/设置全功能。
2. **穿透行为**：Windows 侧 `GetCursorPos` 轮询的动态穿透（悬停可交互/离开穿透）真机走查——macOS 无法验证 Windows 光标路径。
3. **125%/150% DPI 缩放**：桌宠默认位（`default_pet_pos_scaled` 单测覆盖 @1x/@1.25x/@2x）与拖拽坐标（物理/逻辑换算）、面板扩窗锚定（`panel_new_physical_size` 单测覆盖 @1.25x）的真机实测。
4. **Everything 联动**：`local_file_search`（M1a launcher 文件检索）在对话中的角色——**M2 桌宠对话未接入文件检索，此联动不存在于 M2 范围**（如实注明；launcher 侧 Everything 行为沿用 M1a 待验清单）。
5. **Windows 真实鼠标手感全套**：同上待人工第 7 项在 Windows 的对应项（模态拖拽吃 mouseup → released 恒 false 的「判停即评估」回退路径）。

## M2 已知边界（挂账）

- **ollama 首 token 延迟**：本轮实测 >200s 无首 token（含 240s 直连探针 0 token，模型已在 VRAM），历史 123–180s+——GPU 争用开放项，交用户排查 ollama 主机（192.168.66.25）负载/并发；网关侧已有 180s 首 token / 300s 总量硬顶降级兜底（本轮降级路径实测工作正常）。
- **点击响应延迟 ~400ms**：判停防抖时长（防慢起拖拽误判），可感知；如需更快，`pet.rs` 判停时长为独立参数可调（与落盘防抖 400ms 各自独立）。
- **面板打开期间拖拽不落盘**：面板态窗口位置变化不写 petX/petY（既有语义，宠物锚定右下、窗口位由开合逻辑管理）。
- **退出竞态丢末次位置**：退出前 400ms 落盘防抖窗口内的末次拖拽位置丢失（T2 已知，量级为最后一次拖拽即退出且恰在 400ms 内，低概率）。
- **103 类「标题不含查询词」库可能落选 top8**：轮转融合以标题含查询词为第一排序键（该 API 唯一相关性信号），标题不含查询词的高相关库（如 103-科技质量部对「资质」查询，T1 实测 0.0164 分）可能落选；根治需 WeKnora 返回正文重排——下轮计划决策。
- **WeKnora 52 库扇出 3s 单库预算偏紧**：负载波动时整轮 0 命中走 partial 兜底（本轮两连发实测）；调大 `DEEP_PER_KB_TIMEOUT` 为一处常量改（T1 挂账）。

## E1 企业配置链路（2026-10-03，gateway 侧）

- `GET /api/client/config`：X-Client-Token 鉴权（401）、未发布 404、If-None-Match 304（含列表/*/弱形式）、200 合并 config_version + ETag —— pytest 31 passed（含 NaN 草稿拒绝回归）
- 管理端：/admin 单页（textarea 草稿编辑 + 发布 + 版本显示）、/admin/api/config|draft|publish（X-Admin-Token，空 token 环境拒绝）
- 存储费语义：草稿入库前重序列化（拒绝 NaN/Infinity），版本号 AUTOINCREMENT 单调
- 端到端（与 cherry-studio enterprise 分支联调，见 docs/superpowers/plans/2026-10-03-e1-enterprise-config-pipeline.md 执行日志）：发布 v1 → 客户端自动注入五件套 + 304 增量 + 断网降级缓存应用，全部通过
- 部署注意：生产必须设置 GATEWAY_TOKEN（admin 端点空 token 直接 401；client 端点空 token 放行与现有端点一致）

## E2/E3 结构化后台 + MCP + 代理（2026-10-04，gateway 侧）

- 管理端 API：upstreams CRUD+连通测试（409 引用保护）、settings 三键、assistants/mcp-servers/minapps CRUD、publish 组合（引用校验 400 明细）+ rollback 重发快照、usage summary（7/30/90 天）
- 管理页 v2：/admin 8 标签页（上游与模型/默认模型/助手/MCP/小程序/知识库/用量/版本），无 prompt/alert/confirm（webview 兼容），token localStorage + 401 重提示
- 模型路由：/v1/chat/completions 纯代理（{upstream}/{model} 寻址，openai Bearer/SSE 透传 + ollama NDJSON→SSE），/v1/models，未知模型 OpenAI 404；RAG 完整迁至 /v1/kb/chat/completions；用量全量记账（含错误/断流）
- WeKnora MCP：/mcp/weknora streamable-http + token 中间件（11 种绕过探针全 401）；weknora_search/list_kbs 真连 54 库；hybrid-search 受 WeKnora GPU 争用挂起（环境问题，代码正确降级，recent 路径正常）
- 反向代理：/proxy/weknora/ 剥离帧头 + 3xx Location 改写回代理前缀 + 逐跳头剥离 + 流式双向
- 端到端：发布→客户端注入→真实模型对话记账→MCP 检索→代理嵌头，全通过（见计划文档执行日志）

## E4 内测发包（2026-10-04，gateway + 客户端）

- 客户端发布件：2.1.4-tjad.1（打包默认企业配置 resources/enterprise.default.json、企业模式禁用上游自动更新）；mac dmg 410MB 已构建并上服务器；Windows nsis 走 GitHub Actions 原生构建（企业 workflow，本机无法交叉编译原生模块）
- 服务端：192.168.66.12:8787 生产部署（Python 3.12 venv、start.sh + tjad-beta-2026 令牌、WeKnora/ollama 跨网段连通实测、beta 配置发布 v1、MCP 真连 54 库、模型路由真实对话 6291 tokens 记账、/download 下载页 dmg 已挂）
- 内测指南：desktop/docs/BETA-GUIDE.md
- 运维注意：服务器 start.sh 用 nohup（重启机器后需手动 bash ~/tjad-gateway/start.sh 或加 crontab @reboot）；代码更新 = rsync gateway/ → ~/tjad-gateway/gateway/ + start.sh

### E4 补充（2026-10-04 上午）：Windows 包到货

- GHA Enterprise Build（run 37167802145）成功产出 setup.exe + portable.exe（各 343MB），16 路并行下载回本机后已上服务器 /download；mac dmg 挂载验证通过（含 Cherry Studio.app）
- 三包齐备：mac-arm64.dmg 410MB / win-x64-setup.exe 343MB / win-x64-portable.exe 343MB，下载页从办公网实测可列可下（Range 断点续传 206）

### 品牌更名 TJADKnows Desktop（2026-10-04 中午，2.1.4-tjad.2）

- 客户端：electron-builder productName/appId(com.tjad.TJADKnowsDesktop)/win executableName + APP_NAME 常量（client 90d2e2e）；上游功能名（如 Cherry Studio Web Search）与错误文案字面量保留不动
- 网关：/download 页标题与 xattr 提示、BETA-GUIDE 全部更名（gateway 70c49fa），已部署服务器
- 三包重新构建并替换：TJADKnows-Desktop-2.1.4-tjad.2-{mac-arm64.dmg 410MB, win-x64-setup.exe 343MB, win-x64-portable.exe 343MB}；旧 Cherry-Studio 命名包已从服务器移除；mac 挂载验证含 "TJADKnows Desktop.app"；GHA run 37173716820

### tjad.4（2026-10-04 晚）：插件市场 v1 上包 + desktop 仓库归位

- desktop 仓库从 archive/desktop-tauri 移回 TJADKnows/desktop 原位（用户确认；archive README 已改写说明缘由）；BETA-GUIDE 收编至仓库根 docs/
- 三包全部 tjad.4（含插件市场 v1：侧栏市场页 + 四类组件安装/卸载），tjad.3 已从服务器移除
- 生产市场样例：weknora-toolkit（推荐位，1 技能 + 1 助手）；上架 SOP 见 E5 计划执行日志

### 市场详情页 ZCode 化（2026-10-05，868ae75b）

- 详情由小弹层改为页内钻取视图（ZCode 形态）：返回行、56px 图标头部、版本/已装徽标、分类/作者/主页仓库外链、关键词、whitespace-pre-wrap 完整多段介绍、组件分组卡片（计数徽标）、底部固定操作条（安装态机保留：spinner/成功/已装禁用，部分失败 toast）
- manifest 契约扩展可选 author/homepage/repository/keywords（zod optional，网关原样透传 plugin.json 字段）
- i18n 35 个 market.* 键 × 13 语言包（+back/author/homepage/viewRepo，-detail.title）；96 测试绿、typecheck 0、eslint 0

### 市场示意插件批量上架（2026-10-05）

- 服务器市场共 6 个插件（全部 valid）：weknora-toolkit（原有）+ 新增 5 个示意——周报与工作汇报助手★（skill+assistant）、EKP 办公小助手★（skill+minapp）、CAD 制图规范速查（skill）、常用入口合集（minapps×2）、AI 使用礼仪（skill）
- 覆盖全部四类组件与全部分类（knowledge/productivity/utilities/other），featured×3；每个含 icon.svg、多段 description、author/keywords（详情页元信息展示用）
- 上架 SOP 复核：本地造目录 → scp -r 到 ~/tjad-gateway/gateway/data/marketplace/ → catalog 现扫即生效，零重启

## 小世界 W1（2026-10-05，三代理并行 + 生产联调）

- world 服务（world/server，Node ESM + node:sqlite + ws）：WS 房间（50 人上限 code 4000）、心跳合并在场名单（scene=true 走动 / scene=false 部门工位坐姿）、near≤8m/all 聊天、静态托管前端；node --test 23 用例 + smoke 全绿
- Three.js 前端（world/frontend，vite+ts 1429 行）：园区（草坪/道路/主楼/9 部门开放区 54 工位/停车场 20 位+3 车/行道树）、lowpoly 化身（部门色+名牌+行走摆臂+坐姿）、10Hz 同步插值、聊天（头顶气泡+全体频道）、身份填写、满员遮罩；build 零错误
- 客户端：侧栏「小世界」（市场下方，Globe2，设置→侧栏入口可开关默认展示）、webview 沿用 mini-app 链路（persist:webview 分区）、WorldPresenceService 30s 心跳（客户端开着即在线）、world_url 管理端键→组合配置→偏好→快照全链透传
- 生产部署（66.12）：网关更新 world_url 契约（v8 已发布 world_url=ZT:8788）；world 服务 ~/tjad-world（start-world.sh，:8788）
- E2E：客户端心跳 → world health online:1；模拟第二玩家 join/pos/chat → players:2 + 聊天回显 ✓
- 提交：67de9ba(W1a) 6b5323e(W1b) 62acb28+80f4806(W1c) 已推送

### 服务转本机部署（2026-10-05，用户决定）

- 66.12 服务器部署撤除（~/tjad-gateway ~/tjad-world 已清）；全套服务跑开发机本机 127.0.0.1:8787（网关，含迁移回的企业配置库/市场/下载）+ :8788（小世界）
- 一键启动：scripts/start-services.sh；配置 v9 全部 127.0.0.1 地址；打包默认地址同步切换
- 注意：本机部署 = 仅本机可达（127.0.0.1）；如需他人访问，起服务时 --host 0.0.0.0 + 换 TJADKnows ZT IP（10.121.16.83）即可，服务器历史部署方式见 git 历史
