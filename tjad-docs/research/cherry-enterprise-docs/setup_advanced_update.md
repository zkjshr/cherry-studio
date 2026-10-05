---
title: 软件更新
description: 通过管理后台一键更新（Docker Compose 部署）或手动更新 Cherry Studio Enterprise 到最新版本。
---

# 软件更新

一键更新功能需要 v0.3.3

## 更新方式

### 方式一：管理后台一键更新（推荐）
如果您使用 Docker Compose 方式部署，可以通过管理后台直接进行更新。
为了启用一键更新功能，您需要在 docker-compose.yml 中配置以下内容：
- 挂载 Docker Socket ：允许容器内部控制 Docker
- 挂载 docker-compose.yml 文件 ：允许容器读取和更新配置文件
- 登录管理后台
- 进入「关于我们」页面
- 在「版本信息」区域，点击「检查更新」按钮
- 如果有新版本可用，会显示「立即更新」按钮和可用版本列表
- 选择要更新的版本，点击「更新」按钮
- 系统会自动： 拉取新版本镜像 更新 docker-compose.yml 中的镜像版本 停止旧容器 启动新容器
- 更新完成后，页面会自动刷新
- 更新过程中服务会短暂中断（通常 10-30 秒）
- 更新过程中请勿关闭浏览器或刷新页面
- 如果更新失败，请查看容器日志排查问题

### 方式二：手动更新
如果您没有配置一键更新，或更喜欢手动控制更新过程，可以按以下步骤操作：
修改 docker-compose.yml 中的镜像版本：
- 访问管理后台，在「关于我们」页面查看版本号
- 检查服务是否正常运行： curl http://localhost:3670/health

## 查看版本信息

### 查看当前版本
- 管理后台 ：登录后进入「关于我们」页面
- API 接口 ：访问 /health 端点
- 命令行 ： shiki shiki-themes github-light github-dark --shiki-light #24292e --shiki-dark #e1e4e8 --shiki-light-bg #fff --shiki-dark-bg #24292e 0 0 0 24 24 m 4,4 a 1,1 0 0 0 -0.7070312,0.2929687 1,1 0 0 0 0,1.4140625 L 8.5859375,11 3.2929688,16.292969 a 1,1 0 0 0 0,1.414062 1,1 0 0 0 1.4140624,0 l 5.9999998,-6 a 1.0001,1.0001 0 0 0 0,-1.414062 L 4.7070312,4.2929687 A 1,1 0 0 0 4,4 Z m 8,14 a 1,1 0 0 0 -1,1 1,1 0 0 0 1,1 h 8 a 1,1 0 0 0 1,-1 1,1 0 0 0 -1,-1 z currentColor line --shiki-light #6F42C1 --shiki-dark #B392F0 docker --shiki-light #032F62 --shiki-dark #9ECBFF inspect --shiki-light #032F62 --shiki-dark #9ECBFF cherry-studio-enterprise-api --shiki-light #D73A49 --shiki-dark #F97583 | --shiki-light #6F42C1 --shiki-dark #B392F0 grep --shiki-light #032F62 --shiki-dark #9ECBFF Image

### 查看更新日志
- 管理后台 ：在「关于我们」>「更新日志」查看
- 在线文档 ：访问 /[lang]/docs/admin/about/release-notes 更新日志

## 常见问题

### 1. 一键更新按钮不显示
可能原因 ：
- 未挂载 Docker Socket
- 未挂载 docker-compose.yml 文件
- Docker Socket 权限不足
解决方案 ：
- 确认 docker-compose.yml 中包含必要的 volumes 挂载
- 确认 Docker Socket 文件存在： ls -la /var/run/docker.sock
- 检查容器是否有权限访问 Docker Socket

### 2. 镜像拉取失败
可能原因 ：
- 网络连接问题
- Docker Hub 访问受限
解决方案 ：
- 检查网络连接
- 配置 Docker 镜像加速器
- 手动拉取镜像后再更新

### 3. 更新后服务无法启动
排查步骤 ：
常见原因 ：
- 数据库连接配置错误
- 端口被占用
- 环境变量配置缺失

## 相关文档
- /[lang]/docs/setup/docker Docker 部署指南 - Docker 环境部署详细配置
- /[lang]/docs/setup/advanced/database 数据库配置指南 - PostgreSQL 详细配置
- /[lang]/docs/setup/helm Helm 部署指南 - Kubernetes 环境部署
