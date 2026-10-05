# M1a 桌面检索 Launcher — 终审修复波报告

日期：2026-09-28（实际执行 2026-09-27）
仓库：/Volumes/MacSSD/Library/VibeCoding/TJADKnows/desktop/
分支：main

## Commits

| hash | 说明 |
|---|---|
| 429446b | fix: 终审修复（预览URL基址/设置动作/启动兜底/深度恢复）— Rust + 前端，10 文件 |
| a89c284 | fix: 网关 3s 超时预算与部分结果语义 — gateway，2 文件 |

## 逐项修复明细

### C1（Critical）知识结果 Enter 打开的预览 URL 基址错误
- `src-tauri/src/settings_cmd.rs`：AppConfig 新增 `weknora_web_url` 字段，`#[serde(default = "default_weknora_web_url")]`（默认 `http://192.168.66.12:8080`），旧 config.json（无此字段）可正常反序列化；Default impl 同步更新。
- `src/settings/store.ts`：接口与 DEFAULTS 增加 `weknoraWebUrl`。
- `src/settings/Settings.vue`：新增 "WeKnora 网页地址" 输入框（与现有字段同样式），valid 校验纳入 `^https?://`。
- `src/launcher/Launcher.vue`：新增 `weknoraWebUrl` ref，onMounted 从持久化配置填充；`choose` 改传 `weknoraWebUrl`（原先误传网关 `cfg.baseUrl`，导致 `:8787/file?knowledgeId=…` 404）。

### C2（Critical）"打开设置"动作首点静默无效
- `src-tauri/src/tray.rs`：`open_settings` 改 `pub`（内部已有"存在则聚焦、不存在则创建"逻辑）。
- `src-tauri/src/open.rs`：`run_action` 的 `open-settings` 分支改为调用 `crate::tray::open_settings(&app)`；随之移除不再使用的 `Manager` 导入（clippy -D warnings 通过）。

### I1 Esc 不收起窗口
- `Launcher.vue` onKeydown Escape 分支：清空 query 后追加 `getCurrentWindow().hide()`（import 自 `@tauri-apps/api/window`）。

### I3 热键注册冲突可阻断启动
- `src-tauri/src/lib.rs` setup：`hotkey_state::set_hotkey(...)?` 去掉 `?`，改为 `if let Err(e) = … { eprintln!(…) }`。用户配置键与默认回退键都注册失败时，应用以"无热键"状态启动，托盘/设置仍可用。

### I4 网关"晚到"恢复后深度档永久失效
- `Launcher.vue` startHealthPoll 回调：`ok === true` 且 `kbIds` 为空时补一次 `fetchKbs`（`.catch` 静默），恢复深度档。

### I5 deep 扇出无 3s 预算且 TimeoutError 打穿 500
- `gateway/app.py`：`DEEP_PER_KB_TIMEOUT = 3.0`；`one()` 内 `await asyncio.wait_for(weknora.kb_hybrid_search(...), timeout=3.0)`，except 捕获 `(httpx.HTTPError, asyncio.TimeoutError)` 归入 `(kb_id, None)`，保持 partial 语义。
- `gateway/tests/test_api.py` 新增 `test_deep_per_kb_timeout_keeps_partial`：monkeypatch `gateway.weknora.kb_hybrid_search`（kb1 为 `asyncio.sleep(5)` 慢库——可被 wait_for 超时；kb2 正常），断言 200、`partial=True`、结果仅含快库 id "fast"。注意：fake 返回的是 `kb_hybrid_search` 的归一化输出形态（顶层 `id`），不是 WeKnora 原始响应形态，否则 merge 层 KeyError。

### I6 reveal_in_folder 悬空 + 测试名实不符
- `src/launcher/runAction.ts`：新增可选参数 `opts?: { reveal?: boolean }`，file 分支 reveal 时走 `reveal_in_folder`，否则 `open_file`。
- `Launcher.vue` Enter 分支：`choose(row.item, e.metaKey || e.ctrlKey)`（普通 Enter 打开、Cmd/Ctrl+Enter 显示所在文件夹）；choose 点击路径不传（默认 false，走 open_file）。
- `src/launcher/__tests__/runAction.test.ts`：第三个用例拆为两个——默认走 open_file、带 reveal 选项走 reveal_in_folder。

### 热键校验升级
- `src/settings/store.ts`：导出 `isValidHotkey(s)`，要求匹配 `/(ctrl|alt|shift|meta|cmd|super)\+/i`（至少一个修饰键，防单字母键注册为全局热键劫持系统按键）。
- `Settings.vue` valid 计算属性改用 `isValidHotkey(cfg.hotkey)`（替换原 `/^[a-z+]/` 弱校验）。
- `src/settings/__tests__/store.test.ts`：新增 isValidHotkey 两组用例（修饰键合法 / 单字母非法），并覆盖 `weknoraWebUrl` 默认值补全。

## 验证结果（全部绿）

| 命令 | 结果 |
|---|---|
| `cargo test`（src-tauri） | 7 passed |
| `cargo clippy --all-targets -- -D warnings` | 通过，0 警告 |
| `npm test` | 7 files / 21 tests passed |
| `npm run build`（vue-tsc + vite） | 通过 |
| `gateway: .venv/bin/python -m pytest tests/ -v` | 8 passed（含新增超时用例，约 3.2s） |

## 疑虑 / 备注
1. Settings.vue 的 valid 同时要求 `weknoraWebUrl` 为 http(s) URL（超出裁定字面范围，但与 gatewayUrl 校验一致，防止存入非法值破坏预览）；loadConfig 的 withDefaults 保证旧配置加载后即为合法默认值，不会出现"打开设置就禁用保存"的情况。
2. 热键校验升级后，`isValidHotkey("b")` 之类输入在设置层即被拒绝保存；Rust 侧 `hotkey_state::validate` 仍接受无修饰键解析（插件层行为），两层校验职责不同，未改动。
3. 新增网关测试含真实 3s wait_for 超时等待，套件总时长 ~3.2s，可接受。
4. git 提交者身份为本机自动生成（Zhang Kaijian <zhangkaijian@Mac-mini.local>），未设置全局 user.name/email，仅提示。
