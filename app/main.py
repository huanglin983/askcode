"""FastAPI 入口：检索问答 + 完整 README + 静态 H5。"""
from __future__ import annotations

from pathlib import Path

from fastapi import FastAPI, HTTPException, Query
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from .config import STATIC_DIR, load_config
from .ingest import build_index
from .llm import chat_completion
from .retrieve import (
    Retriever,
    build_matched_docs,
    build_sources,
    format_context,
)
from .schemas import (
    ChatRequest,
    ChatResponse,
    DocListItem,
    DocListResponse,
    DocResponse,
    HealthResponse,
    ReindexResponse,
)

cfg = load_config()
corpus = build_index(cfg.readme_path)
retriever = Retriever(corpus)

app = FastAPI(title="数据血缘 README 检索", version="1.0.0")


def _safe_resolve_doc(path_param: str) -> Path:
    """仅允许 readme_dir 之下，防目录穿越。"""
    raw = (path_param or "").strip().replace("\\", "/")
    if not raw:
        raise HTTPException(status_code=400, detail="path 不能为空")
    if raw.startswith("readme/"):
        rel = raw[len("readme/") :]
    else:
        rel = raw
    if ".." in rel.split("/") or rel.startswith("/"):
        raise HTTPException(status_code=400, detail="非法 path")

    root = cfg.readme_path.resolve()
    target = (root / rel).resolve()
    try:
        target.relative_to(root)
    except ValueError:
        raise HTTPException(status_code=400, detail="path 超出知识库目录") from None
    if not target.is_file():
        raise HTTPException(status_code=404, detail=f"文档不存在: {path_param}")
    return target


@app.get("/health", response_model=HealthResponse)
def health() -> HealthResponse:
    ready, msg = cfg.llm_ready()
    return HealthResponse(
        status="ok",
        chunks=len(retriever.index.chunks),
        docs=len(retriever.index.docs),
        llm_ready=ready,
        message=msg or f"知识库: {cfg.readme_path}",
    )


@app.post("/api/reindex", response_model=ReindexResponse)
def reindex() -> ReindexResponse:
    global cfg, corpus, retriever
    cfg = load_config()
    corpus = build_index(cfg.readme_path)
    retriever.replace_index(corpus)
    return ReindexResponse(
        ok=True,
        chunks=len(corpus.chunks),
        docs=len(corpus.docs),
        message=f"已重扫 {cfg.readme_path}",
    )


@app.post("/api/chat", response_model=ChatResponse)
def chat(req: ChatRequest) -> ChatResponse:
    query = req.query.strip()
    if not query:
        raise HTTPException(status_code=400, detail="query 不能为空")

    ready, msg = cfg.llm_ready()
    if not ready:
        raise HTTPException(status_code=503, detail=msg)

    hits = retriever.search(query, top_k=cfg.retrieval.top_k)
    context = format_context(hits)
    try:
        answer = chat_completion(cfg, query, context)
    except Exception as e:  # noqa: BLE001
        raise HTTPException(status_code=502, detail=f"大模型调用失败: {e}") from e

    return ChatResponse(
        answer_markdown=answer,
        sources=build_sources(hits),
        matched_docs=build_matched_docs(query, hits, retriever.index),
    )


@app.get("/api/docs", response_model=DocListResponse)
def list_docs(
    q: str | None = Query(None, description="可选，服务端模糊过滤；空则返回全部"),
) -> DocListResponse:
    """列出知识库全部 README，可选模糊过滤（文件名/标题/表名）。"""
    items = [
        DocListItem(
            file=d.file,
            title=d.title,
            table_names=list(d.table_names or []),
        )
        for d in retriever.index.docs.values()
    ]
    items.sort(key=lambda x: x.file.lower())

    needle = (q or "").strip().lower()
    if needle:
        tokens = [t for t in needle.replace(",", " ").split() if t]

        def score(it: DocListItem) -> int:
            hay = " ".join(
                [it.file, it.title, " ".join(it.table_names)]
            ).lower()
            sc = 0
            for t in tokens:
                if t in hay:
                    sc += 10
                    if t in it.file.lower():
                        sc += 5
                    if any(t in n.lower() for n in it.table_names):
                        sc += 3
                else:
                    # 子序列模糊：字符按序出现
                    i = 0
                    for ch in hay:
                        if i < len(t) and ch == t[i]:
                            i += 1
                    if i == len(t):
                        sc += 2
                    else:
                        return -1
            return sc

        ranked = [(score(it), it) for it in items]
        items = [it for sc, it in sorted(ranked, key=lambda x: (-x[0], x[1].file)) if sc >= 0]

    return DocListResponse(total=len(items), docs=items)


@app.get("/api/doc", response_model=DocResponse)
def get_doc(
    path: str = Query(..., description="如 readme/README_xxx.md"),
    heading: str | None = Query(None, description="可选，前端滚动定位用"),
) -> DocResponse:
    _ = heading
    target = _safe_resolve_doc(path)
    try:
        markdown = target.read_text(encoding="utf-8")
    except UnicodeDecodeError:
        markdown = target.read_text(encoding="utf-8", errors="replace")

    disp = path.strip().replace("\\", "/")
    if not disp.startswith("readme/"):
        disp = f"readme/{disp}"
    doc = retriever.index.docs.get(disp)
    title = doc.title if doc else target.stem
    return DocResponse(path=disp, title=title, markdown=markdown)


@app.get("/")
def index_page() -> FileResponse:
    index = STATIC_DIR / "index.html"
    if not index.exists():
        raise HTTPException(status_code=404, detail="缺少 static/index.html")
    return FileResponse(index)


if STATIC_DIR.exists():
    app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")
