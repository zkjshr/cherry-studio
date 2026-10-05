# SDD ledger — plan: docs/superpowers/plans/2026-09-28-m1a-launcher.md
Task 0: complete (commits 7da9d2f (root), review clean)
Task 0: minor (deferred): src-tauri/gen/schemas 生成物入库——后续任务补 .gitignore + git rm --cached
Task 0: minor (deferred): git committer 身份为推断值（Zhang Kaijian <zhangkaijian@Mac-mini.local>）
Task 0: minor (deferred): tauri.conf.json bundle.icon=[] 未同步占位图标——Task 10 打包时填正式值
Task 1: complete (commits 7da9d2f..eaacf86, review clean)
Task 1: minor→跟踪 (Important): 热键 Option+Space 切换未真人实测（osascript 无辅助功能权限）——Task 10 验收前必须闭环
Task 1: minor (deferred): HiDPI 缩放屏窗口偏位风险（Physical vs Logical 单位）——缩放屏实测
Task 1: minor (deferred): 托盘 settings 菜单项指向不存在的 settings.html（Task 8 补）；macos-private-api 随本 commit 入库；git 身份未配置
Task 2: complete (commits 7da9d2f..8d888b6, review clean)
Task 2: minor→联调 (Important): Step 7 真实 WeKnora 冒烟未做（无 API key）——联调时按 task-2-report 清单验证请求侧+响应侧字段
Task 2: minor (deferred): deep 接口 limit 无上限（建议 le=20）；GATEWAY_TOKEN 为空时放行（部署必须设）；merge.py 补量纲局限注释（计划已回写）
Task 3: fix round 1/5 (4 addressed, 0 open — C1等长重搜/I1清deepTimer/I2即时120ms防抖/I3真正abort; commits 90df223..0699d2b)
Task 3: complete (commits eaacf86..0699d2b, review clean)
Task 3: minor (deferred): 短查询分支未 abort deepCtrl（在途 deep 请求靠代次检查丢弃，与修复前一致）
Task 3: minor (deferred): 测试未覆盖 deepPartial=true 路径与防抖时序细粒度断言
Task 4: complete (commits 0699d2b..25e2b74, review clean)
Task 4: minor (deferred): builtinActions.ts 与 public/actions.json 双份内容漂移风险（Task 6 若接 json 需定唯一源）；registry 引用赋值无 mutate 防护
Task 5: fix round 1/5 (2 addressed, 0 open — C1 FFI 符号绑定/I1 SDK_LOCK 串行化; commits 25e2b74..f8c4e1e)
Task 5: complete (commits eaacf86..f8c4e1e, review clean; Windows 分支交叉 check 通过，运行时行为待 Task 10 真机)
Task 5: minor→Task 10 (Important): Everything 运行时行为零真机验证（DLL 搜索路径/QueryW 阻塞/size+modified 恒 None）
Task 6: complete (commits f8c4e1e..868e6cb, review clean)
Task 6: minor (deferred): open.rs 的 kb_id 冗余字段+allow(dead_code)（可删）；preview_url 与 open_knowledge 双份 URL 拼接（建议收敛让测试覆盖真命令）；runAction 可选 weknoraUrl 允许非法状态（当前调用路径恒传）
Task 6: minor→Task 7冒烟: 预览 URL 拼法 {base}/file?knowledgeId={id} 待实测；reveal_in_folder 跨平台运行时行为待测
Task 8: complete 主体 (commits 5f3c84d..89e8a9e, spec ✅; I1 进入修复轮)
Task 8: minor (deferred): save() 失败无错误提示；set_hotkey 失败无回滚；valid 正则弱；config_path expect panic
Task 7: fix round 1/5 开启 (C1 hover/activeFlat 索引空间错位)
Task 7: minor (deferred): deepError 未消费（深度失败完全静默）；查询变化 activeFlat 不 clamp；li/badge 圆角低于视觉带；flatten 未导出（未披露）
Task 7: fix round 1/5 (2 addressed, 0 open — C1 sectionBases 基址偏移/M2 activeFlat 钳制; commits 89e8a9e..5b755e0)
Task 7: complete (commits 868e6cb..5b755e0, review clean)
Task 8: fix round 1/5 开启 (I1 启动消费配置)
Task 8: fix round 1/5 (1 addressed — I1 启动消费; 新发现1 Important: 无效持久化热键阻断启动; commits 5b755e0..e34011f)
Task 8: fix round 2/5 开启 (无效热键启动兜底)
Task 8: fix round 2/5 (1 addressed — e579885 启动兜底+回退单测; 审查者"b"举例被实测修正为合法快捷键, 真实失败面=空串/未知键/残缺组合)
Task 8: complete (commits 5f3c84d..e579885, 待轮2复审)
Task 8: fix round 2/5 (1 addressed, 0 open — 无效热键双层回退; commits b45dfc3..e579885)
Task 8: complete (commits 5f3c84d..e579885, review clean)
Task 8: minor (deferred): Settings.vue valid 正则弱（"b"可存，行为怪异但无害，可要求必须带修饰键）；save() 失败无错误提示
Task 9: fix round 1/5 (1 addressed — 6b83f4c 图标 include_bytes 内嵌 + M1 payload 精确比较; 待复审)
Task 9: fix round 1/5 (2 addressed, 0 open — C1 include_bytes 内嵌/M1 == "true"; commits e579885..6b83f4c)
Task 9: complete (commits e34011f..6b83f4c, review clean)
Task 9: minor→Task 10 (Important): 托盘图标颜色在菜单栏的实际呈现与 true→false→true 迁移待联调（网关不可达）；正式设计图标落地时重估深浅色自适应
Task 10: complete (commits 6b83f4c..8df149c, review clean; nsis 待 Windows/CI，dmg 已产出)
Task 10: minor (deferred): ACCEPTANCE.md dmg ✅ 行措辞与构建说明矛盾（--skip-jenkins 绕行未写入 ✅ 行）；正式图标重派命令未记录
Final review: 需修复后合并 — 2 Critical + 5 Important + 热键校验升级
Final fix wave: 8/8 ADDRESSED (commits 8df149c..429446b..a89c284), 复审无新破坏
Final: 可合并（desktop 仓库单分支 main，无需 merge 操作）；I2 改配置需重启生效（验收文档需注明）、M1 mdfind 括号注入/网关 kb_id 格式校验等带入联调清单
