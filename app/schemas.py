"""请求/响应模型。"""
from __future__ import annotations

from pydantic import BaseModel, Field


class ChatRequest(BaseModel):
    query: str = Field(..., min_length=1, description="用户自然语言问题")


class SourceItem(BaseModel):
    file: str
    heading: str
    score: float


class MatchedDoc(BaseModel):
    file: str
    title: str
    hit_headings: list[str] = Field(default_factory=list)
    precise: bool = False


class ChatResponse(BaseModel):
    answer_markdown: str
    sources: list[SourceItem] = Field(default_factory=list)
    matched_docs: list[MatchedDoc] = Field(default_factory=list)


class DocListItem(BaseModel):
    file: str
    title: str
    table_names: list[str] = Field(default_factory=list)


class DocListResponse(BaseModel):
    total: int
    docs: list[DocListItem] = Field(default_factory=list)


class DocResponse(BaseModel):
    path: str
    title: str
    markdown: str


class HealthResponse(BaseModel):
    status: str
    chunks: int = 0
    docs: int = 0
    llm_ready: bool = False
    message: str = ""


class ReindexResponse(BaseModel):
    ok: bool
    chunks: int
    docs: int
    message: str = ""
