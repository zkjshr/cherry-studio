---
title: 外部应用接入（Express 模型）
description: 在外部应用、IDE 插件或自建服务中，通过 API 调用 Cherry Studio 企业版 Express 模型。
---

# 外部应用接入（Express 模型）


## 适用前提
开始前，请先确认以下条件已经满足：
- 管理员已经为当前用户创建并启用了 API Key 。
- 管理员已经在 Express 模型 中启用了目标模型。
- 当前用户所属分组已经被授权可访问该模型。
- 您已经拿到企业版 API 地址，例如 https://api.enterprise.cherry-ai.com 。
相关文档：
- /[lang]/docs/admin/user-management/api-key-management API 密钥管理
- /[lang]/docs/admin/service-provider/provider-management-express-hosted 服务商管理（Express 版/托管）

## 配置项对应关系
在大多数支持 OpenAI 协议的外部应用中，您只需要填写以下 3 个核心参数：
| 配置项 |
| 填写内容 |
| 说明 |
| Base URL / 服务器地址 |
| 企业版 API 地址 |
| 例如 https://api.enterprise.cherry-ai.com |
| API Key |
| 用户自己的 API Key |
| 形如 sk-... |
| Model |
| Express 模型必须带上服务商后缀 |
- 如果外部应用会自动拼接 /v1/chat/completions ，通常填写根地址即可，例如 https://api.enterprise.cherry-ai.com
- 如果您使用的是 OpenAI 官方 SDK，需要把 baseURL 写成 https://api.enterprise.cherry-ai.com/v1

## 模型命名规则
Express 模型在外部应用中调用时， model 字段必须写成 模型 ID@provider_id 。
格式：
示例：
注意： 这里要填写的是 模型 ID ，不是页面上的展示名称。并且必须带上 @x-express 后缀，否则接口会返回 Provider is required 。

## 通用请求示例

### cURL

### Node.js（OpenAI SDK）

### Python（OpenAI SDK）

## 外部应用中的推荐填写方式
如果您使用的是聊天工具、IDE 插件或其他第三方应用，通常可以按下面的方式配置：
| 字段 |
| 推荐填写 |
| Provider Type |
| OpenAI Compatible / OpenAI |
| Base URL |
| API Key |
| 用户自己的 sk-... |
| Model |
兼容性说明： 手动填写自定义模型名

## 常见问题
通常是因为 model 没有带服务商后缀。请检查是否写成了下面这种完整格式：
请检查：
- API Key 是否填写错误
- API Key 是否已过期
- API Key 是否已被管理员禁用
请检查：
- 目标模型是否已经在 Express 模型列表中启用
- 当前用户所属分组是否已被授权使用该模型
- 模型后缀是否与后台所属分类一致
通常表示企业 Express 余额不足，或该模型受到了额度限制。请联系管理员前往 模型管理 > Express 查看余额与模型状态。
