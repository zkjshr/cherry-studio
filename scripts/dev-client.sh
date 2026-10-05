#!/bin/bash
# 一键启动企业版开发实例（热更新预览，无需打包）
# 用法：scripts/dev-client.sh [网关地址，默认生产]
# - 渲染层改动保存即生效（Vite HMR）
# - 主进程/enterprise 模块改动自动重编译并重启应用
# - dev 数据与正式包完全隔离（userData 带 Dev 后缀），随便折腾
SERVER="${1:-http://192.168.66.12:8787}"
TOKEN="${2:-tjad-beta-2026}"
pkill -9 -f "cherry-studio/node_modules/.pnpm/electron" 2>/dev/null
sleep 2
cd "$(dirname "$0")/.."   # 脚本随 cherry-studio 仓库分发，直接回仓库根
export PATH="/opt/homebrew/opt/node@24/bin:$PATH"
CHERRY_ENTERPRISE_SERVER_URL="$SERVER" CHERRY_ENTERPRISE_TOKEN="$TOKEN" pnpm dev
