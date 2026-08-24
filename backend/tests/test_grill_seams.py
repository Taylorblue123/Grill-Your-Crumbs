"""拷问链路的三处接缝：适配器注入、LLM 封装的失败语义、拷问会话仓的镜像行为。

这些用例不打真网络、不需要真 key——LLM 与 GitHub 走假实现，OpenAI 客户端走
一个记录调用的替身。
"""

import json
from pathlib import Path
from typing import Any, Dict, List

import pytest
from fastapi.testclient import TestClient

from backend.app.config import LlmSettings, Settings
from backend.app.llm import LlmError, OpenAiLlm
from backend.app.main import create_app
from backend.app.sessions import GrillSessionStore, scrub_secrets


DEMO_USER = "00000000-0000-0000-0000-000000000001"

QUESTION_SCHEMA = {
    "type": "object",
    "properties": {"text": {"type": "string"}},
    "required": ["text"],
    "additionalProperties": False,
}


def make_settings(tmp_path: Path, **overrides: Any) -> Settings:
    prototype = tmp_path / "demo.html"
    prototype.write_text("<h1>demo</h1>", encoding="utf-8")
    defaults: Dict[str, Any] = {
        "database_path": tmp_path / "grill.db",
        "upload_dir": tmp_path / "uploads",
        "prototype_path": prototype,
        "frontend_dist": tmp_path / "frontend-dist",
        "session_mirror_path": tmp_path / "data" / "grill-sessions.json",
        "demo_user_id": DEMO_USER,
        "llm": LlmSettings(api_key="test-key", model="test-model", base_url=None),
    }
    defaults.update(overrides)
    return Settings(**defaults)


class FakeLlm:
    """假 LLM：返回预设结果，记录被问过什么。"""

    def __init__(self, result: Dict[str, Any]):
        self.result = result
        self.calls: List[Dict[str, Any]] = []

    def complete(self, *, messages, schema_name, schema):
        self.calls.append({"messages": messages, "schema_name": schema_name})
        return self.result


class FakeGitHub:
    """假 GitHub：固定仓库数据，永不打网络。"""

    def __init__(self, repos: List[Dict[str, Any]]):
        self.repos = repos
        self.tokens_seen: List[str] = []

    def list_repos(self, token: str):
        self.tokens_seen.append(token)
        return self.repos

    def fetch_repo(self, full_name: str, token=None):
        return {"full_name": full_name, "readme": "", "commits": [], "tree": []}


# --- 注入接缝 ---------------------------------------------------------------


def test_app_factory_accepts_injected_adapters(tmp_path: Path) -> None:
    llm = FakeLlm({"text": "第一题"})
    github = FakeGitHub([{"full_name": "me/repo", "private": True}])

    with TestClient(create_app(make_settings(tmp_path), llm=llm, github=github)) as client:
        assert client.get("/api/health").json() == {"status": "ok"}
        assert client.app.state.llm is llm
        assert client.app.state.github is github


def test_app_factory_defaults_to_real_adapters(tmp_path: Path) -> None:
    """不传适配器时装的是真实现——构造不打网络，所以这条断言是安全的。"""
    from backend.app.github import HttpGitHub

    with TestClient(create_app(make_settings(tmp_path))) as client:
        assert isinstance(client.app.state.llm, OpenAiLlm)
        assert isinstance(client.app.state.github, HttpGitHub)


# --- LLM 封装 ---------------------------------------------------------------


class StubCompletion:
    def __init__(self, content: str):
        message = type("Message", (), {"content": content})()
        self.choices = [type("Choice", (), {"message": message})()]


class StubOpenAiClient:
    """替身 OpenAI 客户端：按脚本依次抛异常或返回结果，并记录每次调用参数。"""

    def __init__(self, script: List[Any]):
        self.script = list(script)
        self.calls: List[Dict[str, Any]] = []
        self.chat = type("Chat", (), {"completions": self})()

    def create(self, **kwargs: Any) -> Any:
        self.calls.append(kwargs)
        outcome = self.script.pop(0)
        if isinstance(outcome, Exception):
            raise outcome
        return outcome


def make_llm(script: List[Any], **overrides: Any) -> tuple[OpenAiLlm, StubOpenAiClient]:
    settings = LlmSettings(
        api_key="test-key", model="test-model", base_url=None, **overrides
    )
    client = StubOpenAiClient(script)
    return OpenAiLlm(settings, client=client), client


def call(llm: OpenAiLlm) -> Dict[str, Any]:
    return llm.complete(
        messages=[{"role": "user", "content": "hi"}],
        schema_name="question",
        schema=QUESTION_SCHEMA,
    )


def test_call_llm_returns_parsed_structured_output(tmp_path: Path) -> None:
    llm, client = make_llm([StubCompletion(json.dumps({"text": "第一题"}))])

    assert call(llm) == {"text": "第一题"}
    request = client.calls[0]
    assert request["model"] == "test-model"
    assert request["timeout"] == 60.0
    assert request["response_format"]["type"] == "json_schema"
    assert request["response_format"]["json_schema"]["schema"] == QUESTION_SCHEMA


def test_call_llm_retries_once_on_timeout_then_succeeds(tmp_path: Path) -> None:
    from openai import APITimeoutError

    llm, client = make_llm(
        [
            APITimeoutError(request=None),
            StubCompletion(json.dumps({"text": "重试后拿到的题"})),
        ]
    )

    assert call(llm) == {"text": "重试后拿到的题"}
    assert len(client.calls) == 2


def test_call_llm_retries_once_on_unparseable_output(tmp_path: Path) -> None:
    llm, client = make_llm(
        [StubCompletion("not json at all"), StubCompletion(json.dumps({"text": "ok"}))]
    )

    assert call(llm) == {"text": "ok"}
    assert len(client.calls) == 2


def test_call_llm_raises_after_retry_still_fails(tmp_path: Path) -> None:
    from openai import APITimeoutError

    llm, client = make_llm([APITimeoutError(request=None), APITimeoutError(request=None)])

    with pytest.raises(LlmError):
        call(llm)
    assert len(client.calls) == 2


def test_call_llm_does_not_retry_client_errors(tmp_path: Path) -> None:
    """4xx（key 错、模型名错）重发也是一样的结果，不浪费一次调用。"""
    import httpx
    from openai import BadRequestError

    error = BadRequestError(
        "bad model",
        response=httpx.Response(400, request=httpx.Request("POST", "https://x")),
        body=None,
    )
    llm, client = make_llm([error])

    with pytest.raises(LlmError):
        call(llm)
    assert len(client.calls) == 1


def test_llm_config_comes_from_environment(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("GRILL_LLM_API_KEY", "env-key")
    monkeypatch.setenv("GRILL_LLM_MODEL", "env-model")
    monkeypatch.setenv("GRILL_LLM_BASE_URL", "https://vendor.example/v1")

    settings = LlmSettings.from_env()

    assert settings.api_key == "env-key"
    assert settings.model == "env-model"
    assert settings.base_url == "https://vendor.example/v1"
    assert settings.timeout_seconds == 60.0


def test_llm_defaults_to_gpt_5_mini_and_official_base_url(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    for name in ("GRILL_LLM_API_KEY", "OPENAI_API_KEY", "GRILL_LLM_MODEL", "GRILL_LLM_BASE_URL"):
        monkeypatch.delenv(name, raising=False)

    settings = LlmSettings.from_env()

    assert settings.model == "gpt-5-mini"
    assert settings.base_url is None  # None = SDK 默认（OpenAI 官方）


def test_llm_without_api_key_fails_loudly(tmp_path: Path) -> None:
    llm = OpenAiLlm(LlmSettings(api_key=None, model="m", base_url=None))

    with pytest.raises(LlmError, match="API key"):
        call(llm)


# --- 拷问会话内存仓 ---------------------------------------------------------


def test_session_state_is_mirrored_to_disk_on_every_change(tmp_path: Path) -> None:
    mirror = tmp_path / "data" / "grill-sessions.json"
    store = GrillSessionStore(mirror)

    session_id = store.create(target_text="后端实习", facts=[])
    assert json.loads(mirror.read_text(encoding="utf-8"))[session_id]["target_text"] == "后端实习"

    fact = {"text": "把延迟从 800ms 压到 120ms", "source": "turn:1"}
    store.update(session_id, facts=[fact])
    mirrored = json.loads(mirror.read_text(encoding="utf-8"))
    assert mirrored[session_id]["facts"] == [fact]

    store.delete(session_id)
    assert json.loads(mirror.read_text(encoding="utf-8")) == {}


def test_sessions_survive_a_restart(tmp_path: Path) -> None:
    mirror = tmp_path / "data" / "grill-sessions.json"
    session_id = GrillSessionStore(mirror).create(target_text="后端实习", facts=[])

    restarted = GrillSessionStore(mirror)

    assert restarted.get(session_id)["target_text"] == "后端实习"


def test_corrupt_mirror_cold_starts_instead_of_crashing(tmp_path: Path) -> None:
    mirror = tmp_path / "data" / "grill-sessions.json"
    mirror.parent.mkdir(parents=True)
    mirror.write_text("{ this is not json", encoding="utf-8")

    store = GrillSessionStore(mirror)

    assert store.get("anything") is None
    assert store.create(target_text="fresh")  # 损坏的镜像被覆盖，新会话照常能建


def test_tokens_never_reach_the_mirror(tmp_path: Path) -> None:
    mirror = tmp_path / "data" / "grill-sessions.json"
    store = GrillSessionStore(mirror)

    session_id = store.create(
        token="ghp_supersecret",
        github_token="ghp_alsosecret",
        nested={"access_token": "ghp_nested", "repo": "me/repo"},
        target_text="后端实习",
    )

    raw = mirror.read_text(encoding="utf-8")
    assert "ghp_" not in raw
    assert "后端实习" in raw
    assert json.loads(raw)[session_id]["nested"] == {"repo": "me/repo"}
    # 内存里 token 照常在——只是永不落盘。
    assert store.get(session_id)["token"] == "ghp_supersecret"


def test_tokens_pasted_into_free_text_never_reach_the_mirror(tmp_path: Path) -> None:
    """按字段名剔除拦不住「用户把 PAT 贴进作答框」，所以自由文本也要扫一遍。"""
    mirror = tmp_path / "data" / "grill-sessions.json"
    store = GrillSessionStore(mirror)

    session_id = store.create(
        history=[{"answer": "我的 token 是 ghp_supersecret1234，用它拉的仓库"}],
        notes="key sk-abcdef1234567890abcdef 也不该落盘",
    )

    raw = mirror.read_text(encoding="utf-8")
    assert "ghp_supersecret1234" not in raw
    assert "sk-abcdef1234567890abcdef" not in raw
    assert "用它拉的仓库" in raw  # 用户的话本身留着，只挖掉凭据
    # 普通的连字符词不该被误伤——「sk-」太像正常词，只有够长才当凭据处理。
    assert scrub_secrets("我在 sk-learning 平台学过") == "我在 sk-learning 平台学过"
    # 内存里原文照旧——只是永不落盘。
    assert "ghp_supersecret1234" in store.get(session_id)["history"][0]["answer"]


def test_scrub_secrets_leaves_ordinary_state_alone() -> None:
    state = {"target_text": "JD", "facts": [{"text": "事实", "source": "turn:1"}]}

    assert scrub_secrets(state) == state


def test_store_hands_out_copies_not_live_state(tmp_path: Path) -> None:
    store = GrillSessionStore(tmp_path / "mirror.json")
    session_id = store.create(facts=[])

    store.get(session_id)["facts"].append("偷偷加的")

    assert store.get(session_id)["facts"] == []


def test_data_directory_is_gitignored() -> None:
    repo_root = Path(__file__).resolve().parents[2]
    ignored = (repo_root / ".gitignore").read_text(encoding="utf-8").splitlines()

    assert "/data/" in ignored


def test_llm_error_maps_to_502_at_the_http_layer(tmp_path: Path) -> None:
    """本票还没有端点，但先钉死映射约定：LlmError → 502，调用方可安全重发。

    后续切片的拷问端点照这个形状接 LlmError 即可。
    """
    from fastapi import HTTPException

    class FailingLlm:
        def complete(self, *, messages, schema_name, schema):
            raise LlmError("upstream is down")

    app = create_app(make_settings(tmp_path), llm=FailingLlm())

    @app.post("/api/v1/_probe")
    def probe() -> Dict[str, Any]:
        try:
            return app.state.llm.complete(messages=[], schema_name="q", schema={})
        except LlmError as error:
            raise HTTPException(status_code=502, detail=str(error)) from error

    with TestClient(app) as client:
        response = client.post("/api/v1/_probe")

    assert response.status_code == 502
    assert response.json()["detail"] == "upstream is down"
