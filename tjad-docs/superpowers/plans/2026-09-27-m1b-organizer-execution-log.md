# SDD ledger — plan: docs/superpowers/plans/2026-09-27-m1b-organizer.md
Task 1: complete (commits a89c284..c3d88a6, review clean)
Task 1: minor (deferred): recent/instant limit 无 ge=1 下界；recent 无短超时预算（联调后再评估）
Task 2: complete (commits c3d88a6..bcf0efd, review clean)
Task 2: minor→Task 6 前 (Important): dedup_by 仅去相邻重复，别名路径（大小写/符号链接/不相邻重复）会产出重复行——Task 6 接线前改 HashSet canonicalize 过滤；symlink 不跟随语义待确认
Task 3: complete (commits bcf0efd..b47b939, review clean)
Task 3: →Task 4 硬性移交: ① backoff_ms 未接线（failures 从不递增，须补"rebuild失败→failures+1→按退避延迟重试"驱动）② set_app_config 变更后调 rebuild_watcher ③ watched_dirs 与 scan.rs 抽公共函数
Task 3: →Task 6: 前端忽略空 payload fs-changed；backoff 公式 f=3 跳 16s（4x 跳变）待 spec 作者终裁
Task 5: complete (commits b47b939..cc788c1, review clean)
Task 5: minor→解锁后人工 (Important): GUI 视觉项未真机（锁屏）——托盘呼出视觉/收起三途径/多屏三步舞（I-1）解锁后必验
Task 5: minor (deferred): Esc 双触发（幂等无害）；创建失败静默吞（建议 eprintln）
Task 4: complete (commits cc788c1..0a1aa83, review clean; 三移交落实)
Task 4: minor (deferred): set_hotkey 恒 Ok 致前端无法感知回退（建议透传实际生效键）；backoff 被 30s 地板掩盖（动态范围 30-60s）；同键冲突静默回退无提示
Task 6: complete (commits 0a1aa83..8c54087, review clean; dedup 移交项落实)
Task 6: minor (deferred): 浮层视口边缘避让；展开时点另一卡先关再开（两次点击）；onMounted async reject 未兜底（listen/interval 不注册）
Task 7: complete (commits 27eff6c..3c0fc4f, review clean)
Task 7: minor (deferred): Dock 固定项无 catch（空 URL 拼 open-url: 报 unhandled）；最近列表同会话不实时刷新（storage 事件可解）
Task 9: fix round 1/5 开启 (Important: keyword 空 value 规则吞全部文件——保存过滤需含 value 空行)
Task 9: 台账裁定: 审查者指"Date.now() id 生成 brief 无指示"有误——控制器派发指令确有此指示，实现者表述属实
Task 9: fix round 1/5 (1 addressed, 0 open — value 空行统一过滤+hint; commits 3c0fc4f..3204561)
Task 9: complete (commits 27eff6c..3204561, review clean)
Task 9: minor (deferred): Date.now().toString(36) 同毫秒 id 碰撞；文件夹去重区分大小写/未归一化波浪号；stacks.ts 匹配层空 value 防御（第二道闸）
Task 8: fix round 1/5 开启 (Critical 未截断 5 条 + 报告失实；Important 时钟卡与 Stacks 确定性重叠)
Task 8: fix round 1/5 (3 addressed, 0 open — 截断5条/顶部布局隔离/日期空格; commits 3204561..181b9ad)
Task 8: complete (commits 3c0fc4f..181b9ad, review clean)
Task 10: complete (commits 181b9ad..4298432..a1926f1, review clean; capabilities hide 权限修复 A/B 实证)
Task 10: →终审/台账: 多屏三步舞缺陷实锤（覆盖层宽度两倍+落屏不跟随光标）；全屏 Space 呼出现象；IME/合成键验证局限；launcher Esc 真人按键复核
Final review: 需修复后合并 — 唯一阻塞: 多屏三步舞; I-2 便签无痕裁剪需补
Final fix wave: F1 三屏复验通过(bounds=光标屏frame)/F2 FileHit isDir/F3 便签 widget 补齐/F4 留痕 (commits a1926f1..2488622..5dc0b10), 复审 4/4 ADDRESSED
Final: 可合并。带出项: 打磨轮(Esc双触发/Dock catch/浮层避让/storage 同步/堆栈第二道闸等 UX 项)、联调轮(recent 字段/limit 下界)、Windows 真机、全屏 Space 现象挂账
