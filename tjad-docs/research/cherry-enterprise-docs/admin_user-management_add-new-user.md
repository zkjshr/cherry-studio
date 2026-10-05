---
title: 添加新用户
description: 手动创建用户账号，配置用户名、密码和分组归属。
---

# 添加新用户

Express 版用户可以通过 邀请链接 快速添加成员。详见 /[lang]/docs/admin/user-management/invite-members 成员邀请 。

## 操作流程 a #heading8ca0746f50e147119c6c47d6dded5dd2-cao-zuo-liu-cheng-0 heading8ca0746f50e147119c6c47d6dded5dd2-cao-zuo-liu-cheng-0
- 在用户管理主界面右上角，点击 + 添加用户 按钮。
- 在弹出的侧滑/模态窗口中，依次完成以下配置：

## 配置参数详解 a #heading8ca0746f50e147119c6c47d6dded5dd2-pei-zhi-can-shu-xiang-jie-0 heading8ca0746f50e147119c6c47d6dded5dd2-pei-zhi-can-shu-xiang-jie-0
| 参数项 |
| 必填 |
| 格式要求 |
| 说明 |
| 下拉选择 |
| strong 核心配置 。选择用户所属的逻辑分组，此项直接决定用户登录后能看到哪些模型（Model Provider）和助手。 |
| 至少 3 个字符 |
| 建议使用员工姓名拼音或工号，需保证系统内唯一。 |
| 至少 6 个字符 |
| 初始登录密码。 |
| 否 |
| 开关（默认关闭） |
| 开启后，该用户将被设置为所属分组的管理员。 |
- 点击 创建用户 完成操作。
Tip: 出于安全考虑，建议在分发账号后，通知用户并在首次登录后修改初始密码。
