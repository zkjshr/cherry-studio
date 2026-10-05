#!/bin/bash
# 一键启动企业版开发实例（热更新预览，无需打包）。服务须先 scripts/start-services.sh
SERVER="${1:-http://127.0.0.1:8787}"
TOKEN="${2:-tjad-beta-2026}"
pkill -9 -f "cherry-studio/node_modules/.pnpm/electron" 2>/dev/null
sleep 2
cd "$(dirname "$0")/.."
export PATH="/opt/homebrew/opt/node@24/bin:$PATH"
CHERRY_ENTERPRISE_SERVER_URL="$SERVER" CHERRY_ENTERPRISE_TOKEN="$TOKEN" pnpm dev
