---
title: 单点登录
description: 集成 Casdoor 作为统一身份认证系统，提供企业级单点登录 (SSO) 功能，支持 OAuth 2.0 协议。
---

# 单点登录


## 功能特性
- 统一身份认证 ：用户只需登录一次即可访问所有相关应用
- 用户管理 ：集中管理企业用户账号和权限
- 多种登录方式 ：支持用户名密码、第三方登录等多种认证方式
- 安全保障 ：基于 OAuth 2.0 协议，确保认证过程的安全性

## 环境变量配置
在 Docker 容器或环境变量中配置以下 Casdoor 相关参数：

## Docker Compose 配置
在 docker-compose.yml 中添加 Casdoor 配置：

## 配置说明
| 环境变量 |
| 描述 |
| 示例值 |
| Casdoor 服务器地址 |
| 在 Casdoor 中创建的应用 ID |
| 应用密钥，用于安全通信 |
| Casdoor 中的组织名称 |
| Casdoor 中的应用名称 |

## 使用流程

### 客户端登录
- 启动 Cherry Studio 企业版客户端
- 在登录界面选择「一键认证登录」
- 输入服务器地址： https://api.your-domain.com
- 系统会自动跳转到 Casdoor 认证页面
- 完成认证后客户端自动登录

## 用户管理

### 添加用户
在 Casdoor 管理后台中：
- 进入「用户管理」页面
- 点击「添加用户」
- 填写用户信息： 用户名 邮箱 姓名 密码（可选，支持用户自行设置）
- 分配到对应的组织： cherry-studio

## 安全注意事项
- 保护应用密钥 ： CASDOOR_APP_SECRET 是敏感信息，请妥善保管
- HTTPS 部署 ：生产环境务必使用 HTTPS 协议
- 定期更新 ：定期更新应用密钥以确保安全性
- 访问控制 ：在 Casdoor 中配置适当的访问控制策略

## 故障排查

### 登录跳转失败
- 检查 CASDOOR_ENDPOINT 是否可访问
- 确认 API_URL 配置是否正确
- 验证网络连接和防火墙设置

### 认证失败
- 检查 CASDOOR_APP_ID 和 CASDOOR_APP_SECRET 是否正确
- 确认组织名和应用名配置是否匹配
- 查看应用日志获取详细错误信息
如需更多技术支持，请联系： mailto:support@cherry-ai.com support@cherry-ai.com
