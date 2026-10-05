# M2 终审修复波报告（final-fix）

日期：2026-09-28　基线：9ec1985（chore: M2 构建升级与验收记录）　分支：main

## 结论

三项终审修复（F1/F2/F3）全部完成，全量验证绿，2 个 commit：

| commit | 内容 |
|---|---|
| `032bb2d` | fix: 检索预算 6s 与全败如实呈现（F1+F2，gateway/app.py + gateway/tests/test_api.py） |
| `cff3ef2` | fix: pet 窗口创建失败不阻断启动（F3，src-tauri/src/lib.rs） |

## F1（Critical）：检索单库预算 3s → 6s

- `gateway/app.py:21` `DEEP_PER_KB_TIMEOUT = 3.0` → `6.0`；`:28` 注释"单库 3s 预算"同步改 6s。
- **连带调整（超出协调者字面范围，必要）**：`tests/test_api.py::test_deep_per_kb_timeout_keeps_partial` 原依赖 `asyncio.sleep(5) > 3.0` 触发超时——6s 预算下 sleep(5) 会正常返回、用例必挂。改为 `monkeypatch.setattr(app_mod, "DEEP_PER_KB_TIMEOUT", 0.05)`，用例不再依赖预算具体值（更符合"无对具体值的断言"要求），且运行更快（~0.05s，原先真实等 3s）。docstring 同步更新。

## F2（Important）：检索全败与 0 命中可区分

- `chat_stream` 内检索 `one()` 返回值 `[]` → `(ok: bool, results)`：HTTPError/Timeout → `(False, [])`，成功 → `(True, rs)`。
- 扇出后统计：`ids` 非空且全部库 `ok=False` → 发 `status`"知识库暂时无法访问，请稍后重试" + `delta` 同文案 + `done {partial: true}`，**不发 sources**（spec §4 如实呈现不可达）；随后 return，不进 ollama。
- 部分失败：维持既有 partial 语义（未额外改动，按协调者裁决"现有 done 已带"）。
- 全部成功但 0 命中：维持现有文案"知识库暂时没有检索到相关内容。"（`ids` 为空的既有路径不受影响，以 `ids and` 守卫避免空集误判全败）。
- 新增回归用例 `test_chat_stream_all_kb_failures_reported_as_unreachable`（双库 500 → 断言 status/delta 文案、无 sources、done partial:true）。网关用例 17 → 18。
- 前端无需改动：`src/pet/chat.ts` 的 status/delta/done(partial) 均为通用处理。

## F3（Important）：pet 窗口创建 fail-soft

- `src-tauri/src/lib.rs` setup 中 `pet::ensure_pet_window(app.handle())?` → `if let Err(e) = ... { eprintln!("pet 窗口创建失败: {e}"); }`，单点失败不再炸掉整个 app。托盘 `toggle_pet`（pet.rs:396）已有 `let _ = ensure_pet_window(&app)` 补建路径，无需改动。

## 验证（全绿）

| 命令 | 结果 |
|---|---|
| `gateway/.venv/bin/python -m pytest tests/ -q` | 18 passed（0.38s，原 17 例 + 新增 1 例） |
| `cargo test`（src-tauri） | 17 passed; 0 failed |
| `cargo clippy --all-targets -- -D warnings` | 通过，无警告 |
| `npm test` | 13 files / 59 tests passed |
| `npm run build` | built（386ms） |

## 疑虑 / 残留（不阻塞合并）

1. **`list_kbs` 失败 + 无显式 kb_ids 的旁路**：chat_stream 里 `list_kbs` 抛错时 `all_kbs=[]` → `ids=[]` → 用户仍看到"没有检索到相关内容"。F2 裁决范围仅覆盖"扇出后全部库 ok=False"，此旁路属相邻但不同的洞（同样是不可达被误读为空）。修复需给 list_kbs 也加 ok 标志，超出本次"内聚小改"范围，建议后续小任务处理。
2. **超时用例的预算 monkeypatch**：`test_deep_per_kb_timeout_keeps_partial` 不再实测默认 6s 常量本身（只测"超预算即取消"的语义）。这是为了用例不随预算值漂移，属有意取舍。
3. 提交身份为 git 自动推断（Zhang Kaijian <zhangkaijian@Mac-mini.local>），与仓库既有提交一致，未额外配置。
