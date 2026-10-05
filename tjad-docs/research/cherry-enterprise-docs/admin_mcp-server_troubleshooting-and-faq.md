---
title: 故障排查与 FAQ
description: MCP 服务器配置与调用中的常见问题排查步骤和解决方案。
---

# 故障排查与 FAQ

- 原因 ：JSON 格式不标准。
- 解决 ：检查是否在最后一项参数后多加了逗号，或者使用了中文引号。点击 格式化 JSON 按钮可自动修复简单错误。
- 原因 ：服务器环境缺少运行时依赖。
- 解决 ： 确认运行 Cherry Studio 的主机上已安装 Node.js （对应 npx ，下载： https://nodejs.org/ https://nodejs.org/ ）或 Python （对应 uvx ，下载： https://www.python.org/downloads/ https://www.python.org/downloads/ ）。 检查网络连接，首次运行 npx 可能需要从 npm 镜像源下载包，网络超时会导致启动失败。
- 验证方法 ： 进入 助手管理 ，将该 MCP 绑定到一个测试助手。 读取 desktop 目录下的 test.txt
