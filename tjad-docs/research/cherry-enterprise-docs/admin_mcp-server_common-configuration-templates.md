---
title: 常用配置模板
description: Playwright、Filesystem、Fetch 等常用 MCP 服务器的官方验证配置示例。
---

# 常用配置模板

为了方便您快速上手，以下是官方验证过的常用 MCP 服务器配置代码。

## 🌐 Playwright (网页自动化)
赋予 AI 浏览网页、截图和抓取数据的能力。
- 依赖环境 ：Node.js
- 适用场景 ：联网搜索助手、新闻摘要助手。

## 📂 Filesystem (本地文件系统)
赋予 AI 读写服务器特定目录的能力。
- 依赖环境 ：Node.js
- 适用场景 ：代码审计助手、日志分析助手。
安全警告 ：请务必在 args 中指定具体的 安全目录路径 （如下例中的 /Users/admin/desktop ），切勿直接授权根目录 / ，以防系统文件被误删。

## 📡 Fetch (HTTP 请求)
赋予 AI 发送 HTTP 请求的能力。
- 依赖环境 ：Python (使用 UV 包管理器) 或 Node.js
- 适用场景 ：API 测试、简单的数据抓取。
