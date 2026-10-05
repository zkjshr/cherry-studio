---
title: 备份与恢复
description: 备份和恢复 Cherry Studio Enterprise 的 PostgreSQL 数据库和应用数据目录，支持 Docker 和 Kubernetes 两种部署方式。
---

# 备份与恢复


## Docker 部署备份

### PostgreSQL 数据库备份

### 应用数据目录备份

### PostgreSQL 数据恢复

## Kubernetes (Helm) 部署备份

### PostgreSQL 数据库备份
如果需要备份应用的其他数据文件，数据存储在 PVC 中：

### 备份脚本（推荐）
为了简化备份过程，可以使用以下脚本： helm/scripts/backup-database.sh

## 备份故障排除

### 1. 检查 PVC 名称是否正确

### 2. 检查 pod 状态

### 3. 手动清理失败的 pod

### 4. 使用分步备份

## 相关文档
- /[lang]/docs/setup/docker Docker 部署指南 - Docker 环境部署详细配置
- /[lang]/docs/setup/helm Helm 部署指南 - Kubernetes 环境部署
- /[lang]/docs/setup/advanced/database 数据库配置指南 - PostgreSQL 详细配置
