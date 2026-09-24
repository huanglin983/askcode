# 数据血缘 README 检索 · 本机网页应用

自然语言查**表 / 字段 / 业务名词**，从本地 `readme/**/*.md` 做 BM25 检索，再调用**通义千问**（DashScope OpenAI 兼容接口）生成三幕式回答。精确命中表或字段时可在页面内查看完整 README。

> 本应用**不**接入 Dify / ChatBI / 天玑，**不**调用 ODPS，**不上**向量库。

## 目录

- 应用代码：本仓根目录（`app/`、`static/` 等）
- 知识库：`E:/支架项目/readme`（只读，见 config `readme_dir`）
- 业务 SQL：`E:/支架项目/src`（本应用不直接读代码，仅 README 引用）

## 快速启动（Windows）

双击或在终端运行：

```powershell
cd E:\askcode
.\start.bat
```

首次若无 `config.yaml`，脚本会从 `config.example.yaml` 复制一份；请先填入 `llm.api_key`。

手动启动：

```powershell
cd E:\askcode
copy config.example.yaml config.yaml
# 编辑 config.yaml，将 llm.api_key 换成真实 DashScope Key
pip install -r requirements.txt
uvicorn app.main:app --host 127.0.0.1 --port 8765
```

浏览器打开：<http://127.0.0.1:8765/>

Linux / macOS：

```bash
cd /path/to/askcode
chmod +x start.sh
./start.sh
```

## 配置说明

复制 `config.example.yaml` → `config.yaml`（已 gitignore，勿提交）：

| 项 | 说明 |
|----|------|
| `readme_dir` | 默认指向 `E:/支架项目/readme`（绝对路径） |
| `server.host` / `port` | 监听地址，默认 `127.0.0.1:8765` |
| `llm.base_url` | DashScope OpenAI 兼容地址 |
| `llm.api_key` | 必填；占位符时 `/api/chat` 会返回明确错误 |
| `llm.model` | 如 `qwen-plus` / `qwen-turbo` / `qwen-max` |
| `retrieval.top_k` | 检索返回块数，默认 8 |

启动后访问 `GET /health` 可查看文档数、切块数、LLM 是否就绪。

## API

| 方法 | 路径 | 说明 |
|------|------|------|
| `POST` | `/api/chat` | body: `{"query":"..."}` → 三幕式答案 + sources + matched_docs |
| `GET` | `/api/doc?path=readme/xxx.md&heading=` | 安全读取全文（禁止目录穿越） |
| `POST` | `/api/reindex` | 重扫 `readme/` 刷新切块索引 |
| `GET` | `/health` | 健康检查 |
| `GET` | `/` | H5 问答页 |

## 前端用法

1. 输入自然语言问题，点「发送」（或 Ctrl+Enter）
2. 答案按三节展示：意图识别 / 思考推理 / 最终总结
3. 底部有 BM25 来源列表；**精确到表/字段**时卡片上有「查看完整 README」
4. 点击后右侧抽屉展示全文，并尽量滚动到命中的 `##` 章节
5. 知识库有更新时点「刷新索引」

## 回答规范

模型 system prompt 见 `prompts/system.md`：仅依据检索片段作答，禁止编造未出现的表/字段/血缘。

## 验收自检

- [ ] 配置 `config.yaml` 后本机可问答
- [ ] 回答为三幕式 Markdown
- [ ] sources 可回溯到具体 `readme/*.md` 的 `##` 块
- [ ] 精确命中时出现「查看完整 README」，可定位章节
- [ ] 非法 `path`（跳出 readme）被拒绝
