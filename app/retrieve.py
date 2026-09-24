"""BM25 关键词检索 + 精确命中判定。"""
from __future__ import annotations

import re
from dataclasses import dataclass

import jieba
from rank_bm25 import BM25Okapi

from .ingest import Chunk, CorpusIndex
from .schemas import MatchedDoc, SourceItem

TOKEN_RE = re.compile(r"[A-Za-z][A-Za-z0-9_]*|[\u4e00-\u9fff]+|\d+")
TABLE_LIKE_RE = re.compile(
    r"\b((?:ods|dwd|dws|ads|dim|bda)_[a-z0-9_]+|[a-z][a-z0-9_]{4,})\b",
    re.IGNORECASE,
)
FIELD_LIKE_RE = re.compile(r"\b([a-z][a-z0-9_]{2,})\b", re.IGNORECASE)


def tokenize(text: str) -> list[str]:
    text = text.lower()
    tokens: list[str] = []
    for raw in TOKEN_RE.findall(text):
        if re.fullmatch(r"[\u4e00-\u9fff]+", raw):
            tokens.extend(t for t in jieba.cut_for_search(raw) if t.strip())
        else:
            tokens.append(raw)
    if tokens:
        return tokens
    return [text.strip().lower()] if text.strip() else []


@dataclass
class Hit:
    chunk: Chunk
    score: float


class Retriever:
    def __init__(self, index: CorpusIndex):
        self.index = index
        self._bm25: BM25Okapi | None = None
        self._corpus_tokens: list[list[str]] = []
        self._rebuild()

    def _rebuild(self) -> None:
        self._corpus_tokens = []
        for c in self.index.chunks:
            boost = f"{c.file} {c.title} {c.heading} " * 2
            self._corpus_tokens.append(tokenize(boost + c.text))
        if self._corpus_tokens:
            self._bm25 = BM25Okapi(self._corpus_tokens)
        else:
            self._bm25 = None

    def replace_index(self, index: CorpusIndex) -> None:
        self.index = index
        self._rebuild()

    def search(self, query: str, top_k: int = 8) -> list[Hit]:
        if not self._bm25 or not self.index.chunks:
            return []
        q_tokens = tokenize(query)
        scores = self._bm25.get_scores(q_tokens)
        ranked = sorted(enumerate(scores), key=lambda x: x[1], reverse=True)
        hits: list[Hit] = []
        for idx, score in ranked[: max(top_k * 3, top_k)]:
            if score <= 0:
                continue
            hits.append(Hit(chunk=self.index.chunks[idx], score=float(score)))
            if len(hits) >= top_k:
                break
        return hits


def extract_query_entities(query: str) -> tuple[list[str], list[str]]:
    tables = [m.group(1) for m in TABLE_LIKE_RE.finditer(query)]
    tables = list(dict.fromkeys(t.lower() for t in tables))
    fields = [m.group(1).lower() for m in FIELD_LIKE_RE.finditer(query)]
    fields = [f for f in fields if f not in tables and len(f) >= 3]
    fields = list(dict.fromkeys(fields))
    return tables, fields


def build_sources(hits: list[Hit]) -> list[SourceItem]:
    return [
        SourceItem(file=h.chunk.file, heading=h.chunk.heading, score=round(h.score, 4))
        for h in hits
    ]


def build_matched_docs(query: str, hits: list[Hit], index: CorpusIndex) -> list[MatchedDoc]:
    q_tables, q_fields = extract_query_entities(query)
    q_lower = query.lower()

    by_file: dict[str, MatchedDoc] = {}
    for h in hits:
        c = h.chunk
        doc = index.docs.get(c.file)
        title = doc.title if doc else c.title
        if c.file not in by_file:
            by_file[c.file] = MatchedDoc(
                file=c.file,
                title=title,
                hit_headings=[],
                precise=False,
            )
        md = by_file[c.file]
        if c.heading and c.heading not in md.hit_headings:
            md.hit_headings.append(c.heading)

        precise = False
        doc_tables = [t.lower() for t in (doc.table_names if doc else c.table_names)]
        for t in q_tables:
            if t in doc_tables or t in c.file.lower() or t in title.lower():
                precise = True
                break
        stem = c.file.split("/")[-1].replace(".md", "").lower()
        for prefix in ("readme_", "rag_"):
            if stem.startswith(prefix):
                stem_table = stem[len(prefix) :]
                if stem_table and (
                    stem_table in q_lower or any(stem_table == t for t in q_tables)
                ):
                    precise = True
                break

        if c.is_field_section and q_fields:
            body_lower = c.text.lower()
            if any(f in body_lower for f in q_fields):
                precise = True

        if not precise and q_tables:
            for t in q_tables:
                if t in c.file.lower() or t in title.lower():
                    precise = True
                    break

        if precise:
            md.precise = True

    docs = list(by_file.values())
    docs.sort(key=lambda d: (not d.precise, d.file))
    return docs


def format_context(hits: list[Hit]) -> str:
    parts: list[str] = []
    for i, h in enumerate(hits, 1):
        c = h.chunk
        parts.append(
            f"### 片段 {i}\n"
            f"- 文件: {c.file}\n"
            f"- 标题: {c.title}\n"
            f"- 章节: {c.heading}\n"
            f"- 相关度: {h.score:.4f}\n\n"
            f"{c.text}"
        )
    return "\n\n---\n\n".join(parts) if parts else "（无检索命中）"
