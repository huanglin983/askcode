#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

if [[ ! -f config.yaml ]]; then
  if [[ -f config.example.yaml ]]; then
    cp config.example.yaml config.yaml
    echo "[info] 已从 config.example.yaml 创建 config.yaml，请填入 llm.api_key"
  else
    echo "[error] 缺少 config.yaml / config.example.yaml" >&2
    exit 1
  fi
fi

PY=""
if command -v python3 >/dev/null 2>&1; then
  PY=python3
elif command -v python >/dev/null 2>&1; then
  PY=python
else
  echo "[error] 未找到 Python" >&2
  exit 1
fi

if ! "$PY" -c "import fastapi,uvicorn,openai,yaml,rank_bm25,jieba" >/dev/null 2>&1; then
  echo "[info] 安装 requirements.txt ..."
  "$PY" -m pip install -r requirements.txt
fi

HOST="$("$PY" -c "import yaml;c=yaml.safe_load(open('config.yaml',encoding='utf-8')) or {};print((c.get('server') or {}).get('host','127.0.0.1'))")"
PORT="$("$PY" -c "import yaml;c=yaml.safe_load(open('config.yaml',encoding='utf-8')) or {};print((c.get('server') or {}).get('port',8765))")"

echo "[info] 启动 http://${HOST}:${PORT}/"
exec "$PY" -m uvicorn app.main:app --host "$HOST" --port "$PORT"
