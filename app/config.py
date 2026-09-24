"""加载项目根目录 config.yaml。"""
from __future__ import annotations

from pathlib import Path
from typing import Any

import yaml
from pydantic import BaseModel, Field

APP_DIR = Path(__file__).resolve().parent.parent
CONFIG_PATH = APP_DIR / "config.yaml"
EXAMPLE_CONFIG_PATH = APP_DIR / "config.example.yaml"
PROMPTS_DIR = APP_DIR / "prompts"
STATIC_DIR = APP_DIR / "static"

PLACEHOLDER_KEYS = {"YOUR_DASHSCOPE_API_KEY", "", "changeme", "xxx"}


class ServerConfig(BaseModel):
    host: str = "127.0.0.1"
    port: int = 8765


class LlmConfig(BaseModel):
    base_url: str = "https://dashscope.aliyuncs.com/compatible-mode/v1"
    api_key: str = "YOUR_DASHSCOPE_API_KEY"
    model: str = "qwen-plus"
    timeout_sec: int = 120


class RetrievalConfig(BaseModel):
    top_k: int = 8


class AppConfig(BaseModel):
    readme_dir: str = "../../readme"
    server: ServerConfig = Field(default_factory=ServerConfig)
    llm: LlmConfig = Field(default_factory=LlmConfig)
    retrieval: RetrievalConfig = Field(default_factory=RetrievalConfig)

    @property
    def readme_path(self) -> Path:
        p = Path(self.readme_dir)
        if not p.is_absolute():
            p = (APP_DIR / p).resolve()
        return p

    def llm_ready(self) -> tuple[bool, str]:
        if not CONFIG_PATH.exists():
            return (
                False,
                f"缺少配置文件 {CONFIG_PATH.name}，请复制 config.example.yaml 为 config.yaml 并填入 api_key",
            )
        key = (self.llm.api_key or "").strip()
        if key in PLACEHOLDER_KEYS or key.upper().startswith("YOUR_"):
            return False, "config.yaml 中 llm.api_key 仍为占位符，请填入真实的 DashScope API Key"
        if not self.llm.base_url.strip():
            return False, "config.yaml 中 llm.base_url 为空"
        return True, ""


def load_config(path: Path | None = None) -> AppConfig:
    cfg_path = path or CONFIG_PATH
    if not cfg_path.exists():
        src = EXAMPLE_CONFIG_PATH if EXAMPLE_CONFIG_PATH.exists() else None
        if src is None:
            return AppConfig()
        data = _read_yaml(src)
        return AppConfig.model_validate(data)
    data = _read_yaml(cfg_path)
    return AppConfig.model_validate(data)


def _read_yaml(path: Path) -> dict[str, Any]:
    with path.open("r", encoding="utf-8") as f:
        data = yaml.safe_load(f) or {}
    if not isinstance(data, dict):
        raise ValueError(f"配置文件格式错误: {path}")
    return data


def load_system_prompt() -> str:
    path = PROMPTS_DIR / "system.md"
    if not path.exists():
        raise FileNotFoundError(f"缺少 system prompt: {path}")
    return path.read_text(encoding="utf-8")
