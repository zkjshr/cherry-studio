# SDD ledger — plan: docs/superpowers/plans/2026-09-28-m2-pet-companion.md
Task 1: fix round 1/5 (4 addressed — Q1 全量扇出实证偏离/Q2 180-300s 硬顶/M1 history 校验/Q3 轮转+标题加权自查; commits a5ac162..74de4b8)
Task 1: complete (commits 2c2db2e..74de4b8, review clean)
Task 1: →后续: 103 类"标题不含查询词"库可能落选 top8（title 是唯一相关性信号，根治需正文重排——下轮计划决策）；检索阶段无独立总墙钟
Task 2: fix round 1/5 开启 (I1 Windows 拖拽时序/I2 organizer 热键门禁/I3 HiDPI 默认位)
Task 2: fix round 1/5 (4 addressed — I1 Moved防抖/I2 热键门禁+注销/I3 scaled默认位/Minor冗余; commits b6c481b..9fd8dc4)
Task 2: complete (commits a5ac162..9fd8dc4, review clean)
Task 2: minor→Task 4 (Important): 慢起拖拽（按住>300ms 才动）会误判为点击——Task 4 实装面板切换前必须重审判定逻辑
Task 2: minor (deferred): 退出窗口期 400ms 内丢末次位置；透明角挡点击（椭圆命中区后议）；Retina 1x/2x 之外缩放待 Windows 真机
Task 3: complete (commits 9fd8dc4..83e62d1, review clean)
Task 3: →Task 5 (Important): 拖拽超 300ms 视觉提前回 idle（复位挂在取位 setTimeout 上，Windows 模态拖拽吃 mouseup）——接真实拖拽结束信号
Task 3: minor→T6: 真窗四状态视觉肉眼确认进验收单；PetSkin 无入库回归测试；FPS 导入未用；hovering 死状态；frames.length 守卫
Task 4: complete (commits 83e62d1..008694a, review clean)
Task 4: →Task 5 第0步 (Important/I1): resize_pet_for_panel 扩窗锚定的 outer_size 新鲜度需 GUI 冒烟验证（tao 事件循环派发可能读到旧尺寸→宠物跳动）
Task 4: minor (deferred): Esc 面板内焦点失效（@keydown.stop）；IME 组合 Enter 提前发送；Windows 慢起拖拽残余误判（建议 Rust 权威判停事件根治）；长按 40 拍上限仍 toggle；滚底无贴底判定；loadConfig 失败静默；流式期间未驱动 thinking/talking 态（→T5 polish）
Task 5: complete (commits 008694a..03a059e, review clean; 第0步坐实并修复 T4 扩窗锚定缺陷)
Task 5: →T6 顺手修 (Important): PetApp onDown 的 dragging=true 早于 try 保护域（前置 await reject 则永久卡 dragged）——下移一行
Task 5: minor (deferred): IME keyCode 229 残留；扩窗瞬态帧；面板开期拖拽不落盘（既有语义）；点击延迟 ~400ms 调参项；真机鼠标级验证清单（T6 人工）
Task 6: complete (commits 03a059e..9ec1985, review clean)
Task 6: 协调者裁决: DEEP_PER_KB_TIMEOUT 3.0→6.0 采纳为终审前修复（默认全库路径连续两轮 0 命中=旗舰功能静默失效；代价仅降级轮 21s→40s）
Task 6: minor (deferred): ACCEPTANCE"五事件"标签改"四类实测"或注明 error 依据历史；onDown listen reject 泄漏 onUp 监听（正交无害）；微秒重入窗口（理论）
Final review: 需修复后合并 — Critical 预算6.0未落地 / Important 全败≠0命中 / Important pet窗fail-soft
Final fix wave: 3/3 ADDRESSED (commits 9ec1985..032bb2d..cff3ef2), 复审无新破坏
Final: 可合并。带出: Windows 真机全套（含慢起拖拽残余第8项）+ nsis 通道 + ollama GPU 争用（用户侧）+ 103类检索重排（下轮）+ M3 polish 批次（IME 229/点击延迟调参/退出flush/透明角等）
