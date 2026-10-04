#!/usr/bin/env bash
# 探测 WeKnora 知识对话接口是否恢复（解析完成后人工运行）。
# 请求 POST {BASE_URL}/api/v1/knowledge-chat/{SESSION_ID}，输出 HTTP code 与
# 响应前 200 字符。全部参数可用环境变量覆盖：
#   BASE_URL    WeKnora 实例地址（默认内网联调实例）
#   KEY         X-API-Key 鉴权头值（默认取 WEKNORA_API_KEY；真实 key 不入库，需 ops 提供）
#   SESSION_ID  会话 id（默认空 = 先 POST /api/v1/sessions 现建一个）
#   KB          知识库 id（默认 101-市场运营部，联调实测可命中的部门库）
#   QUERY       探测问题（默认"资质"，与验收联调同款）
set -euo pipefail

BASE_URL="${BASE_URL:-http://10.137.200.58:8091}"
KEY="${KEY:-${WEKNORA_API_KEY:-}}"
SESSION_ID="${SESSION_ID:-}"
KB="${KB:-101-市场运营部}"
QUERY="${QUERY:-资质}"

if [ -z "$KEY" ]; then
  echo "缺少 API key：export KEY=...（X-API-Key 鉴权头，见 ACCEPTANCE 联调结论）" >&2
  exit 2
fi

# 无现成会话则现建一个（WeKnora 建会话只收 title，知识库在对话请求体里给）
if [ -z "$SESSION_ID" ]; then
  SESSION_ID=$(curl -sS -m 30 -X POST "$BASE_URL/api/v1/sessions" \
    -H "X-API-Key: $KEY" -H 'Content-Type: application/json' \
    -d '{"title":"tjadknows-probe"}' |
    sed -n 's/.*"id"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -n1)
  if [ -z "$SESSION_ID" ]; then
    echo "创建会话失败：无法从 POST /api/v1/sessions 响应解析 id" >&2
    exit 2
  fi
  echo "session: $SESSION_ID"
fi

echo "POST $BASE_URL/api/v1/knowledge-chat/$SESSION_ID (kb=$KB)"
tmp=$(mktemp)
trap 'rm -f "$tmp"' EXIT
# SSE 流式接口：-N 关缓冲，-m 兜底超时；HTTP code 单独取出
code=$(curl -sS -N -m 120 -o "$tmp" -w '%{http_code}' -X POST \
  "$BASE_URL/api/v1/knowledge-chat/$SESSION_ID" \
  -H "X-API-Key: $KEY" -H 'Content-Type: application/json' \
  -d "{\"query\":\"$QUERY\",\"knowledge_base_ids\":[\"$KB\"]}")

echo "HTTP $code"
echo "----"
head -c 200 "$tmp"
echo
