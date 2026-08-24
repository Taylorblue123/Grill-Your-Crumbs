"""拷问开场端点的外部行为：POST /api/v1/grill/sessions。

全部用例从 HTTP 层驱动，LLM 走假实现——不打真网络、不烧 token。断言的是
请求进 / 响应出，以及 prompt 里有没有该有的东西；内部怎么拼 prompt、树存在
哪，测试一概不管。
"""

from pathlib import Path
from typing import Any, Dict, List

from fastapi.testclient import TestClient

from backend.app.config import LlmSettings, Settings
from backend.app.llm import LlmError
from backend.app.main import create_app


DEMO_USER = "00000000-0000-0000-0000-000000000001"

OPENING = {
    "tree": [
        {"id": "n1", "topic": "那次延迟优化到底做了什么", "why": "简历只写了「优化性能」"},
        {"id": "n2", "topic": "带没带过人", "why": "JD 要求 mentoring"},
        {"id": "n3", "topic": "线上事故处理", "why": "JD 要求 on-call"},
    ],
    "question": {
        "id": "n1",
        "text": "你简历里写的「优化了接口性能」，具体是把什么从多少压到了多少？",
        "why": "你的《我的简历.pdf》里这句话没有任何数字，而 JD 明确要求「有性能调优经验」。",
        "options": [
            {"key": "a", "text": "加了缓存，把重复查询挡在数据库外面"},
            {"key": "b", "text": "改了 SQL / 加了索引"},
            {"key": "c", "text": "改成批量或异步处理"},
            {"key": "d", "text": "都不是，我另有做法"},
        ],
        "recommended": {
            "key": "a",
            "reason": "你的 repo 料里出现过 Redis 依赖，所以我猜是缓存那一路。",
        },
    },
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
    """假 LLM：返回预设开场结果，记录被问过什么。"""

    def __init__(self, result: Dict[str, Any]):
        self.result = result
        self.calls: List[Dict[str, Any]] = []

    def complete(self, *, messages, schema_name, schema):
        self.calls.append({"messages": messages, "schema_name": schema_name, "schema": schema})
        return self.result

    @property
    def prompt(self) -> str:
        """最后一次调用送进去的全部文本，用来断言 prompt 里有没有该有的东西。"""
        return "\n".join(message["content"] for message in self.calls[-1]["messages"])


def seed_crumb(
    client: TestClient, *, kind: str, name: str, content: str, synced_at: str
) -> str:
    """直接写库建料——这些用例测的是拷问，不是上传。"""
    from uuid import uuid4

    crumb_id = str(uuid4())
    client.app.state.database.insert_upload(
        {
            "id": crumb_id,
            "user_id": DEMO_USER,
            "kind": kind,
            "display_name": name,
            "content": content,
            "content_hash": f"hash-{crumb_id}",
            "token_count": max(1, len(content) // 4),
            "synced_at": synced_at,
        },
        {
            "id": str(uuid4()),
            "user_id": DEMO_USER,
            "crumb_id": crumb_id,
            "original_name": name,
            "media_type": "application/pdf",
            "byte_size": len(content),
            "storage_key": f"{DEMO_USER}/{crumb_id}.pdf",
            "sha256": f"hash-{crumb_id}",
            "extraction_status": "ready",
            "created_at": synced_at,
        },
    )
    return crumb_id


def make_client(tmp_path: Path, llm: Any = None) -> TestClient:
    return TestClient(create_app(make_settings(tmp_path), llm=llm or FakeLlm(OPENING)))


# --- 开场成功路径 -----------------------------------------------------------


def test_opening_returns_a_complete_question_card(tmp_path: Path) -> None:
    llm = FakeLlm(OPENING)
    with make_client(tmp_path, llm) as client:
        resume = seed_crumb(
            client, kind="resume", name="我的简历.pdf",
            content="优化了接口性能", synced_at="2026-01-01T00:00:00Z",
        )
        response = client.post(
            "/api/v1/grill/sessions",
            json={"jd_text": "要求有性能调优经验", "crumb_ids": [resume]},
        )

    assert response.status_code == 201
    body = response.json()
    assert body["session_id"]
    assert body["baseline_crumb_id"] == resume

    question = body["question"]
    assert question["text"] == OPENING["question"]["text"]
    assert question["why"] == OPENING["question"]["why"]
    assert [option["key"] for option in question["options"]] == ["a", "b", "c", "d"]
    assert question["recommended"]["key"] == "a"
    assert question["recommended"]["reason"]
    # 树上 3 个点，正在问 n1，所以还剩 2 个想挖的点。
    assert question["remaining"] == 2


def test_opening_prompt_carries_the_jd_the_crumbs_and_the_no_asking_rule(
    tmp_path: Path,
) -> None:
    """开场调用得让模型看见靶子、看见料，并且知道「先查料，再问人」。"""
    llm = FakeLlm(OPENING)
    with make_client(tmp_path, llm) as client:
        resume = seed_crumb(
            client, kind="resume", name="我的简历.pdf",
            content="做过一个推荐系统", synced_at="2026-01-01T00:00:00Z",
        )
        notes = seed_crumb(
            client, kind="notes", name="项目笔记.md",
            content="用了协同过滤", synced_at="2026-01-02T00:00:00Z",
        )
        client.post(
            "/api/v1/grill/sessions",
            json={"jd_text": "招推荐算法工程师", "crumb_ids": [resume, notes]},
        )

    prompt = llm.prompt
    assert "招推荐算法工程师" in prompt
    assert "做过一个推荐系统" in prompt
    assert "用了协同过滤" in prompt
    assert "我的简历.pdf" in prompt
    assert "料里已经写清楚的信息，禁止再问用户" in prompt
    # 模型得知道哪份是底稿，否则分不清「简历里已有」和「某份笔记里提过」。
    assert "本场底稿" in prompt


def test_long_crumbs_are_truncated_with_a_visible_marker(tmp_path: Path) -> None:
    """超长的料截断入 prompt，并且明确告诉模型「后文未提供」——
    否则它会把截断处当成真的结尾，把「没写」误判成真缺口。"""
    llm = FakeLlm(OPENING)
    with make_client(tmp_path, llm) as client:
        resume = seed_crumb(
            client, kind="resume", name="巨长简历.pdf",
            content="甲" * 9000, synced_at="2026-01-01T00:00:00Z",
        )
        client.post(
            "/api/v1/grill/sessions",
            json={"jd_text": "任意 JD", "crumb_ids": [resume]},
        )

    prompt = llm.prompt
    assert "甲" * 8000 in prompt
    assert "甲" * 8001 not in prompt
    assert "已截断" in prompt


# --- 基线认定 ---------------------------------------------------------------


def test_baseline_is_the_most_recently_synced_resume(tmp_path: Path) -> None:
    with make_client(tmp_path) as client:
        old = seed_crumb(
            client, kind="resume", name="旧简历.pdf",
            content="旧版", synced_at="2026-01-01T00:00:00Z",
        )
        new = seed_crumb(
            client, kind="resume", name="新简历.pdf",
            content="新版", synced_at="2026-06-01T00:00:00Z",
        )
        response = client.post(
            "/api/v1/grill/sessions",
            json={"jd_text": "任意 JD", "crumb_ids": [old, new]},
        )

    assert response.status_code == 201
    assert response.json()["baseline_crumb_id"] == new


def test_crumbs_without_a_resume_are_rejected(tmp_path: Path) -> None:
    """没有原简历就没有对比基准，这场拷问无从开始。"""
    with make_client(tmp_path) as client:
        notes = seed_crumb(
            client, kind="notes", name="随手笔记.md",
            content="一些想法", synced_at="2026-01-01T00:00:00Z",
        )
        response = client.post(
            "/api/v1/grill/sessions",
            json={"jd_text": "任意 JD", "crumb_ids": [notes]},
        )

    assert response.status_code == 422
    assert "简历" in response.json()["detail"]


# --- 无效输入 ---------------------------------------------------------------


def test_empty_jd_is_rejected(tmp_path: Path) -> None:
    with make_client(tmp_path) as client:
        resume = seed_crumb(
            client, kind="resume", name="我的简历.pdf",
            content="内容", synced_at="2026-01-01T00:00:00Z",
        )
        response = client.post(
            "/api/v1/grill/sessions",
            json={"jd_text": "   ", "crumb_ids": [resume]},
        )

    assert response.status_code == 400


def test_empty_crumb_selection_is_rejected(tmp_path: Path) -> None:
    with make_client(tmp_path) as client:
        response = client.post(
            "/api/v1/grill/sessions", json={"jd_text": "任意 JD", "crumb_ids": []}
        )

    assert response.status_code == 422


def test_a_huge_crumb_id_list_does_not_blow_up_the_query(tmp_path: Path) -> None:
    """id 数量由客户端说了算，不该由它决定这条查询炸不炸（SQLite 变量上限）。"""
    from uuid import uuid4

    with make_client(tmp_path) as client:
        resume = seed_crumb(
            client, kind="resume", name="我的简历.pdf",
            content="内容", synced_at="2026-01-01T00:00:00Z",
        )
        noise = [str(uuid4()) for _ in range(3000)]
        response = client.post(
            "/api/v1/grill/sessions",
            json={"jd_text": "任意 JD", "crumb_ids": [*noise, resume]},
        )

    assert response.status_code == 201
    assert response.json()["baseline_crumb_id"] == resume


def test_crumbs_belonging_to_another_user_are_not_visible(tmp_path: Path) -> None:
    """选了别人的料，等于一份都没选中——不能让 id 猜测泄漏别人的材料。"""
    with make_client(tmp_path) as client:
        resume = seed_crumb(
            client, kind="resume", name="我的简历.pdf",
            content="内容", synced_at="2026-01-01T00:00:00Z",
        )
        response = client.post(
            "/api/v1/grill/sessions",
            json={"jd_text": "任意 JD", "crumb_ids": [resume]},
            headers={"X-User-Id": "00000000-0000-0000-0000-0000000000ff"},
        )

    assert response.status_code == 422


# --- LLM 失败 ---------------------------------------------------------------


def test_empty_tree_is_treated_as_an_llm_failure(tmp_path: Path) -> None:
    """空树 = 这次调用没干活。重试由封装负责，返回后仍空就 502。"""
    llm = FakeLlm({"tree": [], "question": OPENING["question"]})
    with make_client(tmp_path, llm) as client:
        resume = seed_crumb(
            client, kind="resume", name="我的简历.pdf",
            content="内容", synced_at="2026-01-01T00:00:00Z",
        )
        response = client.post(
            "/api/v1/grill/sessions",
            json={"jd_text": "任意 JD", "crumb_ids": [resume]},
        )

    assert response.status_code == 502


def test_llm_error_maps_to_502(tmp_path: Path) -> None:
    class FailingLlm:
        def complete(self, *, messages, schema_name, schema):
            raise LlmError("upstream is down")

    with make_client(tmp_path, FailingLlm()) as client:
        resume = seed_crumb(
            client, kind="resume", name="我的简历.pdf",
            content="内容", synced_at="2026-01-01T00:00:00Z",
        )
        response = client.post(
            "/api/v1/grill/sessions",
            json={"jd_text": "任意 JD", "crumb_ids": [resume]},
        )

    assert response.status_code == 502


# --- 会话留存 ---------------------------------------------------------------


def test_session_state_is_stored_for_the_next_slice(tmp_path: Path) -> None:
    """开场存下的东西，作答那一片要接着用：树、JD、选中的料、底稿。"""
    with make_client(tmp_path) as client:
        resume = seed_crumb(
            client, kind="resume", name="我的简历.pdf",
            content="内容", synced_at="2026-01-01T00:00:00Z",
        )
        response = client.post(
            "/api/v1/grill/sessions",
            json={"jd_text": "招后端", "crumb_ids": [resume]},
        )
        session = client.app.state.sessions.get(response.json()["session_id"])

    assert session["jd_text"] == "招后端"
    assert session["crumb_ids"] == [resume]
    assert session["baseline_crumb_id"] == resume
    assert len(session["tree"]) == 3
    assert session["facts"] == []


def test_scripted_demo_endpoints_are_untouched(tmp_path: Path) -> None:
    """剧本 demo 依赖的端点一行没动——开场票不许碰它们。"""
    with make_client(tmp_path) as client:
        assert client.get("/api/health").json() == {"status": "ok"}
        assert client.get("/api/v1/crumbs").json() == {"crumbs": []}
