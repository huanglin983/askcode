"""通义千问 · DashScope OpenAI 兼容调用。"""
from __future__ import annotations

from openai import OpenAI

from .config import AppConfig, load_system_prompt


def chat_completion(cfg: AppConfig, user_query: str, context: str) -> str:
    ready, msg = cfg.llm_ready()
    if not ready:
        raise RuntimeError(msg)

    system = load_system_prompt()
    user_content = (
        "以下是从知识库 README 检索到的相关片段。请仅依据这些片段回答用户问题；"
        "片段未出现的表/字段/血缘不得编造。\n\n"
        f"## 检索片段\n\n{context}\n\n"
        f"## 用户问题\n\n{user_query}"
    )

    client = OpenAI(
        api_key=cfg.llm.api_key,
        base_url=cfg.llm.base_url,
        timeout=cfg.llm.timeout_sec,
    )
    resp = client.chat.completions.create(
        model=cfg.llm.model,
        messages=[
            {"role": "system", "content": system},
            {"role": "user", "content": user_content},
        ],
        temperature=0.2,
    )
    content = resp.choices[0].message.content
    if not content:
        raise RuntimeError("大模型返回空内容")
    return content.strip()
