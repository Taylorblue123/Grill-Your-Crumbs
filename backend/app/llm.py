"""LLM 封装：拷问三条 prompt 共用的唯一出口。

调用方只看见 `LlmError`——超时、5xx、结构化输出解析失败，重试一次后仍失败的
一切都收敛成它，HTTP 层照它映射 502（调用方可安全重发，因为 LLM 调用无副作用）。
"""

import json
from typing import Any, Dict, List, Optional, Protocol

from .config import LlmSettings


class LlmError(RuntimeError):
    """一次 LLM 调用（含那一次重试）彻底失败。HTTP 层映射为 502。"""


class Llm(Protocol):
    """应用工厂注入的 LLM 适配器接口。测试传假实现，不打真网络。"""

    def complete(
        self,
        *,
        messages: List[Dict[str, str]],
        schema_name: str,
        schema: Dict[str, Any],
    ) -> Dict[str, Any]:
        """返回符合 `schema` 的结构化结果；失败抛 `LlmError`。"""
        ...


class OpenAiLlm:
    """真实现：OpenAI 官方 SDK，结构化输出走 json_schema。

    key / 模型名 / base_url 全部来自 `LlmSettings`（即环境变量）——换厂商只要
    改 `GRILL_LLM_BASE_URL` 与 `GRILL_LLM_MODEL`，这里一行不动。
    SDK 自带的重试关掉（`max_retries=0`），重试语义由本类统一掌握：超时 / 5xx /
    解析失败各算一次可重试失败，总共尝试 `max_attempts` 次。
    """

    def __init__(self, settings: LlmSettings, client: Optional[Any] = None):
        self._settings = settings
        self._client = client

    def _ensure_client(self) -> Any:
        if self._client is not None:
            return self._client
        if not self._settings.api_key:
            raise LlmError(
                "LLM API key is not configured (set GRILL_LLM_API_KEY or OPENAI_API_KEY)"
            )
        try:
            from openai import OpenAI
        except ImportError as error:  # pragma: no cover - 依赖装好就不会走到
            raise LlmError("openai SDK is not installed") from error

        self._client = OpenAI(
            api_key=self._settings.api_key,
            base_url=self._settings.base_url,
            timeout=self._settings.timeout_seconds,
            max_retries=0,
        )
        return self._client

    def complete(
        self,
        *,
        messages: List[Dict[str, str]],
        schema_name: str,
        schema: Dict[str, Any],
    ) -> Dict[str, Any]:
        client = self._ensure_client()
        response_format = {
            "type": "json_schema",
            "json_schema": {"name": schema_name, "schema": schema, "strict": True},
        }

        last_error: Optional[Exception] = None
        for _ in range(max(1, self._settings.max_attempts)):
            try:
                completion = client.chat.completions.create(
                    model=self._settings.model,
                    messages=messages,
                    response_format=response_format,
                    timeout=self._settings.timeout_seconds,
                )
                return _parse_structured(completion)
            except Exception as error:  # noqa: BLE001 - 下面按可重试性分流
                if not _is_retryable(error):
                    raise LlmError(f"LLM call failed: {error}") from error
                last_error = error

        raise LlmError(f"LLM call failed after retry: {last_error}") from last_error


def _parse_structured(completion: Any) -> Dict[str, Any]:
    """把一次 completion 拆成 dict。任何形状不对都算解析失败（可重试）。"""
    try:
        content = completion.choices[0].message.content
    except (AttributeError, IndexError, TypeError) as error:
        raise _ParseError(f"unexpected completion shape: {error}") from error
    if not content:
        raise _ParseError("completion contained no content")
    try:
        parsed = json.loads(content)
    except json.JSONDecodeError as error:
        raise _ParseError(f"completion was not valid JSON: {error}") from error
    if not isinstance(parsed, dict):
        raise _ParseError("completion JSON was not an object")
    return parsed


class _ParseError(Exception):
    """结构化输出解析失败。内部信号，重试一次后收敛成 LlmError。"""


def _is_retryable(error: Exception) -> bool:
    """超时、连接错误、5xx、解析失败可重试；4xx（key 错、模型名错）不重试。"""
    if isinstance(error, _ParseError):
        return True
    try:
        from openai import APIConnectionError, APIStatusError, APITimeoutError
    except ImportError:  # pragma: no cover - 依赖装好就不会走到
        return False
    if isinstance(error, (APITimeoutError, APIConnectionError)):
        return True
    if isinstance(error, APIStatusError):
        return error.status_code >= 500
    return False
