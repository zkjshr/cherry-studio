# TJADKnows Gateway

桌面端知识检索/对话的 FastAPI 网关：代理 WeKnora（标题/最近检索、hybrid-search、
来源 kb_name 回填）与 ollama（生成），提供 `/api/v1/search`、`/api/v1/deep`、
`/api/chat/stream`（SSE）与 Bearer token 鉴权。环境变量见 `config.py`。

## 部署要求

- **Python ≥ 3.10**：代码使用 `str | None` 等 3.10 联合类型写法，低版本解释器无法启动
- 安装依赖：`python -m venv .venv && .venv/bin/pip install -r requirements.txt`
- 启动（在仓库 `desktop/` 目录下）：`.venv/bin/uvicorn gateway.app:app --port 8787`

## 运维脚本

- `scripts/probe_chat.sh`：人工探测 WeKnora 知识对话接口
  （`POST /api/v1/knowledge-chat/{session_id}`）是否恢复——输出 HTTP code 与
  响应前 200 字符，参数可用环境变量覆盖（见脚本头注释）。
