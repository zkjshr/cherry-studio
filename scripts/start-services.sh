#!/bin/bash
# 一键启动本地全套服务（网关 :8787 + 小世界 :8788），地址即 127.0.0.1
# 依赖：gateway/.venv（python 依赖）、world/frontend/dist（pnpm/npm build 产物，见各 README）
set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
export GATEWAY_TOKEN=tjad-beta-2026

pkill -f "uvicorn gateway.app:app" 2>/dev/null || true
pkill -f "world/server/src/index.js" 2>/dev/null || true
sleep 1

(cd "$ROOT/gateway" && nohup .venv/bin/uvicorn gateway.app:app --host 0.0.0.0 --port 8787 > /tmp/local-gateway.log 2>&1 &)
(cd "$ROOT/world/server" && GATEWAY_TOKEN="$GATEWAY_TOKEN" PORT=8788 \
  WORLD_FRONTEND_DIST="$ROOT/world/frontend/dist" \
  WORLD_DB_PATH="$ROOT/world/data/world.sqlite3" \
  nohup node src/index.js > /tmp/local-world.log 2>&1 &)
sleep 3
echo "gateway  : $(curl -s -m 3 http://127.0.0.1:8787/api/health || echo 未就绪)"
echo "小世界   : $(curl -s -m 3 http://127.0.0.1:8788/api/health || echo 未就绪)"
echo "客户端预览：scripts/dev-client.sh （或浏览器开 http://127.0.0.1:8788）"
