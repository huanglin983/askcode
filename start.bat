@echo off
setlocal EnableExtensions
cd /d "%~dp0"

if not exist "config.yaml" (
  if exist "config.example.yaml" (
    copy /Y "config.example.yaml" "config.yaml" >nul
    echo [info] 已从 config.example.yaml 创建 config.yaml，请填入 llm.api_key
  ) else (
    echo [error] 缺少 config.yaml / config.example.yaml
    exit /b 1
  )
)

set "PY="
where py >nul 2>&1 && set "PY=py -3"
if not defined PY where python >nul 2>&1 && set "PY=python"
if not defined PY (
  echo [error] 未找到 Python，请先安装并加入 PATH
  exit /b 1
)

echo [info] 检查依赖...
%PY% -c "import fastapi,uvicorn,openai,yaml,rank_bm25,jieba" 2>nul
if errorlevel 1 (
  echo [info] 安装 requirements.txt ...
  %PY% -m pip install -r requirements.txt
  if errorlevel 1 exit /b 1
)

set "HOST=127.0.0.1"
set "PORT=8765"
for /f "usebackq tokens=*" %%i in (`%PY% -c "import yaml;c=yaml.safe_load(open('config.yaml',encoding='utf-8')) or {};s=c.get('server') or {};print(s.get('host','127.0.0.1'));print(s.get('port',8765))"`) do (
  if not defined _HOST (
    set "HOST=%%i"
    set "_HOST=1"
  ) else (
    set "PORT=%%i"
  )
)

echo [info] 启动 http://%HOST%:%PORT%/
%PY% -m uvicorn app.main:app --host %HOST% --port %PORT%
endlocal
