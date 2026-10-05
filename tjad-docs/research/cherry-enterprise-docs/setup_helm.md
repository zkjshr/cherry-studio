---
title: Helm 部署
description: 使用 Helm Chart 将 Cherry Studio Enterprise 部署到 Kubernetes 集群，包括 API 服务和管理后台。
---

# Helm 部署

推荐 ：使用 Cherry Studio Agent 部署技能可以自动完成以下所有步骤。详见 /[lang]/docs/setup 安装与部署 → Agent 一键部署 。

## 特性
- 双服务部署 ：同时部署 API 服务和管理后台（Admin）
- 独立配置 ：每个服务可独立启用/禁用和配置
- 自动扩展 ：支持 HPA（水平 Pod 自动扩展）
- 健康检查 ：包含 liveness 和 readiness 探针
- Ingress 支持 ：为每个服务配置独立的 Ingress 规则

## 前置条件
- Kubernetes 1.16+
- Helm 3.0+
- 集群中需要支持 PVC
- 已准备好 PostgreSQL 数据库（参考 /[lang]/docs/setup/advanced/database 数据库配置 ）

## 镜像地址
- Docker Hub : cherrystudio/cherry-studio-enterprise-api
- 国内镜像 （推荐中国大陆用户使用）: docker-registry.cherry-ai.com/public/cherry-studio-enterprise-api

## 部署步骤

### 第一步：获取 Helm Chart
选择以下任一方式：

### 第二步：创建配置文件
Chart 默认的镜像版本、数据库连接和 JWT 密钥均为测试用值， 不能直接用于部署 。必须创建 values-custom.yaml 覆盖这些配置。
创建 values-custom.yaml ，根据你的实际环境修改以下内容：
建议使用 Kubernetes Secret 管理 JWT 密钥和数据库密码等敏感信息，详见下方 #%E7%94%9F%E4%BA%A7%E7%8E%AF%E5%A2%83%E6%95%8F%E6%84%9F%E4%BF%A1%E6%81%AF%E7%AE%A1%E7%90%86 生产环境敏感信息管理 。

### 第三步：安装

### 第四步：验证部署
确认以下检查项：
- 所有 Pod 都处于 Running 状态
- Service 正常创建并有对应的 Endpoints
- PVC 已绑定到可用的 PV
- 如启用了 Ingress，检查 Ingress 规则是否正常创建

## 访问应用

### 使用 Port-Forward（测试环境）
访问 http://localhost:3670 （API）和 http://localhost:3680 （Admin）。

### 使用 Ingress（生产环境）
通过 values-custom.yaml 中配置的域名直接访问：
- API 服务： app.api.ingress.hosts 中配置的域名
- Admin 后台： app.admin.ingress.hosts 中配置的域名

## 升级
修改 values-custom.yaml 中的 app.image.tag 为目标版本后执行：

## 卸载

## 配置参考

### 应用服务参数
| 参数 |
| 描述 |
| 默认值 |
| 是否启用应用服务 |
| 副本数量 |
| 镜像仓库 |
| 镜像标签（⚠️ 未设置时回退到 Chart appVersion v0.1.3） |
| 未设置 |
| 是否启用 HPA 自动扩展 |
| HPA 最小副本数 |
| HPA 最大副本数 |
| API Service 类型 |
| API 服务端口 |
| Admin Service 类型 |
| Admin 服务端口 |
| 是否启用持久化存储 |
| 存储大小 |
| 存储访问模式 |
| 数据挂载路径 |
| 是否启用 API Ingress |
| 是否启用 Admin Ingress |
| CPU 限制 |
| 内存限制 |
| CPU 请求 |
| 内存请求 |
| 环境变量配置 |
| 见下方环境变量说明 |

### 端口说明
本应用在单个容器中运行两个服务：
| 端口 |
| 服务 |
| 描述 |
| 3670 |
| API 服务 |
| RESTful API 接口 |
| 3680 |
| Admin 后台 |
| 管理后台界面 |

### 环境变量
通过 app.env 配置，以下为主要环境变量：
| 环境变量 |
| 描述 |
| 管理后台访问 API 的地址 |
| API 服务端口（默认 3670 ） |
| Admin 后台端口（默认 3680 ） |
| 管理后台应用名称 |
| 管理后台 Logo URL |
| 管理后台基础路径（默认 / ） |
| JWT 密钥（⚠️ 必须替换） |
| 环境变量 |
| 描述 |
| 数据库主机地址（⚠️ 必须替换） |
| 数据库端口（默认 5432 ） |
| 数据库用户名（⚠️ 必须替换） |
| 数据库密码（⚠️ 必须替换） |
| 数据库名称（⚠️ 必须替换） |
| 数据库类型（默认 postgres ） |
| 是否启用 SSL（默认 false ） |

### 生产环境敏感信息管理
建议使用 Kubernetes Secret 管理 JWT 密钥和数据库密码：

### 集群规格建议
| 用户规模 |
| 节点配置 |
| 节点数量 |
| Pod 副本数 |
| 存储容量 |
| 2 vCPU, 4GB RAM |
| 1-2个 |
| 1 |
| 10-20GB |
| 4 vCPU, 8GB RAM |
| 2-3个 |
| 1-2 |
| 20-50GB |
| 8 vCPU, 16GB RAM |
| 3-5个 |
| 2-3 |
| 50-100GB |
| 16 vCPU, 32GB RAM |
| 5+个 |
| 3-5 |
| 100GB+ |
Cherry Studio Enterprise 是轻量级应用（启动后内存约 100-150MB，CPU < 100m），小规格集群也能支撑较多用户。
数据库推荐 ：
- < 200人 ：单个 PostgreSQL 实例（2 vCPU, 4GB RAM）
- > 200人 ：PostgreSQL 主从复制，主要用于提高可用性

## 故障排除
- Pod 一直处于 Pending 状态 检查节点资源是否充足 确认 PVC 能够正常创建和绑定
- 服务无法访问 检查 Service 和 Endpoints 是否正确 确认防火墙规则
- 数据丢失 确认 PVC 配置正确 检查存储类是否支持持久化
查看日志 ：

## 注意事项
- 单实例运行 ：为保证数据一致性，建议设置 replicaCount: 1 。如需高可用，请配置 PostgreSQL 主从复制。
- 数据持久化 ：确保集群支持持久化存储，否则数据会在 Pod 重启时丢失。
- 网络安全 ：生产环境建议使用 Ingress + TLS，限制网络访问权限，定期更新镜像版本。
