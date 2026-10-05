---
title: 安装与部署
description: 提供 Docker、Helm、腾讯云应用等多种部署方案，满足不同规模企业的需求。
---

# 安装与部署


## 🤖 使用 Cherry Studio Agent 部署
私有化部署需要先完成服务端安装，才能登录企业版客户端。可借助 Cherry Studio 社区版中的 Agent 自动完成部署。
步骤 ：
- 下载并安装 https://www.cherry-ai.com/download Cherry Studio 社区版
- 打开客户端，进入「智能体」，选择或新建一个智能体
- 将以下提示词发送给智能体： shiki shiki-themes github-light github-dark --shiki-light #24292e --shiki-dark #e1e4e8 --shiki-light-bg #fff --shiki-dark-bg #24292e 0 0 0 24 24 M 6,1 C 4.354992,1 3,2.354992 3,4 v 16 c 0,1.645008 1.354992,3 3,3 h 12 c 1.645008,0 3,-1.354992 3,-3 V 8 7 A 1.0001,1.0001 0 0 0 20.707031,6.2929687 l -5,-5 A 1.0001,1.0001 0 0 0 15,1 h -1 z m 0,2 h 7 v 3 c 0,1.645008 1.354992,3 3,3 h 3 v 11 c 0,0.564129 -0.435871,1 -1,1 H 6 C 5.4358712,21 5,20.564129 5,20 V 4 C 5,3.4358712 5.4358712,3 6,3 Z M 15,3.4140625 18.585937,7 H 16 C 15.435871,7 15,6.5641288 15,6 Z currentColor line 按照 https://docs.enterprise.cherry-ai.com/zh/docs/setup 指引，安装 cherry-enterprise-deploy-skill，帮我部署。
- 按 Agent 提示提供服务器信息（IP、SSH 账号），即可完成部署
> 技能包下载： /assets/downloads/cherry-enterprise-deploy-skill.zip cherry-enterprise-deploy-skill.zip
如需手动部署，请继续阅读下方内容选择部署方式。

## 🚀 开始之前

### 系统要求
- CPU : 2核心或以上
- 内存 : 4GB RAM（推荐 8GB）
- 存储 : 20GB 可用空间（根据数据量调整）
- 网络 : 稳定的网络连接
- 操作系统 : Linux (Ubuntu 20.04+, CentOS 7+)、macOS、Windows
- 容器环境 : Docker 20.10+ （Docker 部署）
- Kubernetes : 1.19+ （Helm 部署）
- 数据库 : PostgreSQL 12+

### 准备工作清单
在开始部署前，请确保您已准备好以下内容：
- 选择部署方式（Docker / Kubernetes）
- 准备服务器或云主机
- 安装必要的运行环境
- 选择使用 PostgreSQL
- 准备数据库连接信息
- 创建数据库和用户
- 决定是否使用 SSO 单点登录
- 准备 Casdoor 配置信息（如需要）
- 配置企业认证系统对接
- 确定服务访问域名
- 配置 SSL 证书（生产环境）
- 开放必要的端口（3670 API, 3680 Admin）

## 📦 部署方案选择
根据您的需求选择合适的部署方案：

### ☁️ 云应用一键部署（推荐）
适用场景 ：
- 快速上手，零配置部署
- 中小型企业快速试用
- 不熟悉技术运维的用户
优势 ：
- 一键部署，无需技术门槛
- 自动化配置网络和安全组
- 包含数据库和管理面板
- 云端资源弹性扩容

### 🐳 Docker 部署
适用场景 ：
- 快速体验和测试
- 中小型团队使用
- 单机部署需求
优势 ：
- 部署简单，一键启动
- 环境隔离，易于维护
- 支持 Docker Compose 编排

### ☸️ Kubernetes Helm 部署
适用场景 ：
- 大型企业生产环境
- 需要高可用和自动扩缩容
- 已有 Kubernetes 集群
优势 ：
- 自动化运维管理
- 支持水平扩展
- 完善的健康检查和故障恢复

## 📋 部署步骤概览

### 第一步：选择部署方案
根据上述指南选择适合您的部署方式。

### 第二步：配置数据库
- 安装 PostgreSQL
- 创建数据库和用户
- 配置连接参数

### 第三步：部署应用
根据选择的部署方式执行相应步骤：
- Docker: 使用 docker-compose 启动
- Kubernetes: 使用 Helm 安装

### 第四步：配置认证（可选）
如需企业 SSO 单点登录：
- 部署 Casdoor 服务
- 配置应用和组织
- 集成到 Cherry Studio

### 第五步：验证部署
- 访问 API 健康检查： http://your-domain:3670/health
- 访问管理后台： http://your-domain:3680
- 使用默认管理员账号登录
- 完成初始配置
> 首次自部署环境会初始化管理员账号：用户名为 admin ，初始密码为 secret 。如果您使用云应用部署，请以应用设置页面提供的后台管理账号信息为准，并在首次登录后立即修改密码。

## 下一步
选择您的部署方式，开始安装：
- /[lang]/docs/setup/cloud-app ☁️ 云应用部署（推荐） - 一键部署，零技术门槛
- /[lang]/docs/setup/docker 🐳 Docker 部署 - 使用 Docker 快速部署
- /[lang]/docs/setup/helm ☸️ Helm 部署 - 在 Kubernetes 上部署
- /[lang]/docs/setup/advanced/database 🗄️ 数据库配置 - 配置 PostgreSQL 数据库
