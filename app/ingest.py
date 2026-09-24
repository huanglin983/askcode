"""扫描 readme/**/*.md，按二级标题 ## 切块，保留全文映射。"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from pathlib import Path


HEADING2_RE = re.compile(r"^##\s+(.+?)\s*$", re.MULTILINE)
TITLE_RE = re.compile(r"^#\s+(.+?)\s*$", re.MULTILINE)
TABLE_NAME_RE = re.compile(
    r"(?:README_|RAG_)([A-Za-z][A-Za-z0-9_]*)",
    re.IGNORECASE,
)
INLINE_TABLE_RE = re.compile(
    r"\b((?:ods|dwd|dws|ads|dim|bda)_[a-z0-9_]+)\b",
    re.IGNORECASE,
)
FIELD_HEADING_HINTS = ("字段血缘", "字段", "列", "module-")


@dataclass
class Chunk:
    chunk_id: str
    file: str  # 相对展示路径，如 readme/README_xxx.md
    abs_path: Path
    heading: str
    title: str
    text: str
    table_names: list[str] = field(default_factory=list)
    is_field_section: bool = False


@dataclass
class DocRecord:
    file: str
    abs_path: Path
    title: str
    markdown: str
    table_names: list[str] = field(default_factory=list)


@dataclass
class CorpusIndex:
    chunks: list[Chunk] = field(default_factory=list)
    docs: dict[str, DocRecord] = field(default_factory=dict)  # key = display file path


def display_path(readme_root: Path, abs_path: Path) -> str:
    try:
        rel = abs_path.relative_to(readme_root)
        return f"readme/{rel.as_posix()}"
    except ValueError:
        return f"readme/{abs_path.name}"


def extract_title(markdown: str, fallback: str) -> str:
    m = TITLE_RE.search(markdown)
    if m:
        return m.group(1).strip()
    return fallback


def extract_table_names(filename: str, text: str) -> list[str]:
    names: list[str] = []
    seen: set[str] = set()

    def add(n: str) -> None:
        key = n.lower()
        if key not in seen:
            seen.add(key)
            names.append(n)

    stem = Path(filename).stem
    m = TABLE_NAME_RE.search(stem)
    if m:
        add(m.group(1))
    for prefix in ("README_", "RAG_"):
        if stem.upper().startswith(prefix.upper()):
            add(stem[len(prefix) :])
            break

    for m in INLINE_TABLE_RE.finditer(text[:4000]):
        add(m.group(1))

    return names


def is_field_heading(heading: str) -> bool:
    h = heading.lower()
    return any(k in heading or k in h for k in FIELD_HEADING_HINTS)


def split_by_h2(markdown: str) -> list[tuple[str, str]]:
    """返回 [(heading, body), ...]。无 ## 时整篇为一块。"""
    matches = list(HEADING2_RE.finditer(markdown))
    if not matches:
        title = extract_title(markdown, "全文")
        return [(title, markdown.strip())]

    chunks: list[tuple[str, str]] = []
    preface = markdown[: matches[0].start()].strip()
    if preface:
        title = extract_title(preface, "文档前言")
        chunks.append((title, preface))

    for i, m in enumerate(matches):
        heading = m.group(1).strip()
        start = m.end()
        end = matches[i + 1].start() if i + 1 < len(matches) else len(markdown)
        body = markdown[start:end].strip()
        text = f"## {heading}\n\n{body}".strip()
        chunks.append((heading, text))
    return chunks


def build_index(readme_dir: Path) -> CorpusIndex:
    index = CorpusIndex()
    if not readme_dir.exists():
        return index

    files = sorted(readme_dir.rglob("*.md"))
    for abs_path in files:
        if not abs_path.is_file():
            continue
        try:
            markdown = abs_path.read_text(encoding="utf-8")
        except UnicodeDecodeError:
            markdown = abs_path.read_text(encoding="utf-8", errors="replace")

        disp = display_path(readme_dir, abs_path)
        title = extract_title(markdown, abs_path.stem)
        tables = extract_table_names(abs_path.name, markdown)
        index.docs[disp] = DocRecord(
            file=disp,
            abs_path=abs_path,
            title=title,
            markdown=markdown,
            table_names=tables,
        )

        for i, (heading, text) in enumerate(split_by_h2(markdown)):
            chunk_tables = extract_table_names(abs_path.name, text)
            merged = list(dict.fromkeys(chunk_tables + tables))
            index.chunks.append(
                Chunk(
                    chunk_id=f"{disp}#{i}",
                    file=disp,
                    abs_path=abs_path,
                    heading=heading,
                    title=title,
                    text=text,
                    table_names=merged,
                    is_field_section=is_field_heading(heading),
                )
            )
    return index
