---
title: 数据库配置
description: Cherry Studio Enterprise 使用 PostgreSQL 作为数据库系统，支持云数据库和私有部署两种方案。
---

# 数据库配置


## 推荐方案

### 方案一：使用云数据库服务（推荐）
使用云服务商提供的托管数据库服务，无需自行维护：

### 方案二：使用现有 PostgreSQL 服务器
如果您的组织已有 PostgreSQL 数据库服务器，可直接使用。

## 数据库准备
无论使用云服务还是自有数据库，需要准备：
- 创建数据库 ：创建名为 cherry-studio-enterprise 的数据库
- 创建用户 ：创建专用数据库用户并授予权限
- 获取连接信息 ： 数据库地址（Host） 端口（Port，默认 5432） 数据库名（Database） 用户名（Username） 密码（Password）

## 环境变量配置
根据 /[lang]/docs/setup/docker Docker 部署文档 ，配置以下数据库相关环境变量：

### 必需配置

## 配置示例

### 示例 1：阿里云 RDS

### 示例 2：腾讯云 PostgreSQL

### 示例 3：私有 PostgreSQL 服务器

## Docker Compose 配置
在 docker-compose.yml 中配置：

## 使用 .env 文件（推荐）
创建 .env 文件管理敏感信息：
然后在 docker-compose.yml 中引用：

## 连接测试
启动服务后，可通过以下方式验证数据库连接：

## 注意事项
- 数据库命名规范 ：建议统一使用 cherry-studio-enterprise 作为数据库名和用户名
- 强密码策略 ：数据库密码应使用强密码，避免使用默认或简单密码
- SSL 连接 ： 云服务通常需要开启（ DB_SSL=true ） 内网环境可根据安全需求决定是否开启
- 数据备份 ：定期备份数据库，特别是生产环境
- 版本要求 ：PostgreSQL 12.0 或更高版本（推荐 15.x）

## 故障排查

### 连接失败
- 检查数据库地址和端口是否正确
- 确认用户名密码是否正确
- 验证防火墙是否允许连接
- 云服务需检查白名单设置

### SSL 连接问题
- 云服务通常强制要求 SSL，确保 DB_SSL=true
- 某些云服务可能需要下载 SSL 证书
- 内网环境如无特殊要求可设置 DB_SSL=false

### 权限不足
确保数据库用户拥有以下权限：
- CREATE（创建表）
- SELECT、INSERT、UPDATE、DELETE（数据操作）
- ALTER（修改表结构）
如需技术支持，请联系： mailto:support@cherry-ai.com support@cherry-ai.com
