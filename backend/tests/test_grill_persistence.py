"""拷问会话落库的外部行为：重启后会话仍可读、可接着答（issue #44 验收）。

和其它拷问用例同样的立场：全部从 HTTP 层驱动，LLM 走假实现。这一片要钉死的
是「后端重启不丢进行中的会话」——重启=用同一份 settings（指向同一个 tmp_path
库）新建第二个 app 实例。第二个实例的进程内存里什么会话都没有，会话全得从
SQLite 里读回来。
"""

from pathlib import Path
from typing import Any, Dict, List, Optional
from uuid import uuid4

from fastapi.testclient import TestClient

from backend.app.config import LlmSettings, Settings
from backend.app.main import create_app


DEMO_USER = "00000000-0000-0000-0000-000000000001"

OPENING: Dict[str, Any] = {
    "tree": [
        {"id": "n1", "topic": "那次延迟优化到底做了什么", "why": "简历只写了「优化性能」"},
        {"id": "n2", "topic": "带没带过人", "why": "JD 要求 mentoring"},
        {"id": "n3", "topic": "线上事故处理", "why": "JD 要求 on-call"},
    ],
    "question": {
        "id": "n1",
        "text": "你简历里写的「优化了接口性能」，具体是把什么从多少压到了多少？",
        "why": "你的《我的简历.pdf》里这句话没有任何数字，而 JD 明确要求「有性能调优经验」。",
        "options": [{"key": "a", "text": "加了缓存"}],
        "recommended": {"key": "a", "reason": "repo 料里出现过 Redis 依赖。"},
    },
}

TURN_N2: Dict[str, Any] = {
    "facts": [
        {"text": "把 P99 从 800ms 压到 120ms", "source": "第 1 轮回答"},
        {"text": "手段是给热点查询加 Redis 缓存", "source": "第 1 轮回答"},
    ],
    "tree": [
        {"id": "n2", "topic": "带没带过人", "why": "JD 要求 mentoring"},
        {"id": "n3", "topic": "线上事故处理", "why": "JD 要求 on-call"},
    ],
    "question": {
        "id": "n2",
        "text": "你说的「带过人」，具体带了几个人、带多久？",
        "why": "JD 明确要求 mentoring 经验，而你的简历里一个字都没提。",
        "options": [{"key": "a", "text": "带过 1-2 个实习生"}],
        "recommended": {"key": "a", "reason": "你的 repo 料里有大量 review 记录。"},
    },
    "done": False,
}

TURN_DONE: Dict[str, Any] = {
    "facts": [{"text": "带过两个实习生半年", "source": "第 2 轮回答"}],
    "tree": [],
    "question": None,
    "done": True,
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


class ScriptedLlm:
    """按顺序交回预设结果。最后一个之后一直交回它。"""

    def __init__(self, *results: Dict[str, Any]):
        self.results = list(results)
        self.calls: List[Dict[str, Any]] = []

    def complete(self, *, messages, schema_name, schema):
        self.calls.append({"messages": messages, "schema_name": schema_name})
        index = min(len(self.calls) - 1, len(self.results) - 1)
        return self.results[index]


def seed_resume(client: TestClient) -> str:
    """直接写库建一份简历料——这些用例测的是会话落库，不是上传。"""
    crumb_id = str(uuid4())
    client.app.state.database.insert_upload(
        {
            "id": crumb_id,
            "user_id": DEMO_USER,
            "kind": "resume",
            "display_name": "我的简历.pdf",
            "content": "负责了后端接口的开发\n优化了接口性能",
            "content_hash": f"hash-{crumb_id}",
            "token_count": 10,
            "synced_at": "2026-01-01T00:00:00Z",
        },
        {
            "id": str(uuid4()),
            "user_id": DEMO_USER,
            "crumb_id": crumb_id,
            "original_name": "我的简历.pdf",
            "media_type": "application/pdf",
            "byte_size": 20,
            "storage_key": f"{DEMO_USER}/{crumb_id}.pdf",
            "sha256": f"hash-{crumb_id}",
            "extraction_status": "ready",
            "created_at": "2026-01-01T00:00:00Z",
        },
    )
    return crumb_id


def answer(client: TestClient, session_id: str, question_id: str, text: str):
    return client.post(
        f"/api/v1/grill/sessions/{session_id}/answers",
        json={"question_id": question_id, "answer_text": text, "chosen_option": None},
    )


def test_a_session_survives_a_restart_and_can_still_be_answered(tmp_path: Path) -> None:
    """核心验收：开场 → 答一轮 → 重启（同一个库，新 app 实例）→ 会话仍返回
    完整投影、能接着作答。事实账本重启后仍可读。"""
    settings = make_settings(tmp_path)

    # 第一个 app 实例：开场、答第一轮。
    first_llm = ScriptedLlm(OPENING, TURN_N2)
    with TestClient(create_app(settings, llm=first_llm)) as client:
        resume = seed_resume(client)
        opened = client.post(
            "/api/v1/grill/sessions",
            json={"jd_text": "要求有性能调优经验，能带人", "crumb_ids": [resume]},
        )
        assert opened.status_code == 201
        session_id = opened.json()["session_id"]

        first_round = answer(client, session_id, "n1", "把 P99 从 800ms 压到 120ms")
        assert first_round.status_code == 200
        assert first_round.json()["question"]["id"] == "n2"

    # 重启：同一份 settings（同一个库），全新的 app 实例。它的进程内存里没有
    # 任何会话——下面每一条断言都得从 SQLite 里读回来才能成立。
    second_llm = ScriptedLlm(TURN_DONE)
    with TestClient(create_app(settings, llm=second_llm)) as restarted:
        projection = restarted.get(f"/api/v1/grill/sessions/{session_id}")
        assert projection.status_code == 200
        body = projection.json()

        # 完整投影：靶子、底稿、当前题、已答轮数、账本都从库里读回来了。
        assert body["session_id"] == session_id
        assert body["baseline_crumb_id"] == resume
        assert body["jd_text"] == "要求有性能调优经验，能带人"
        assert body["question"]["id"] == "n2"
        assert body["answered_count"] == 1
        assert body["done"] is False
        # 事实账本重启后仍可读。
        assert [fact["text"] for fact in body["facts"]] == [
            "把 P99 从 800ms 压到 120ms",
            "手段是给热点查询加 Redis 缓存",
        ]

        # 能接着答：在新实例上作答第二轮，这场收口。
        second_round = answer(restarted, session_id, "n2", "带过两个实习生半年")
        assert second_round.status_code == 200
        assert second_round.json()["done"] is True

        # 第二轮的事实累加进同一本账本——重启没有把第一轮的事实弄丢。
        after = restarted.get(f"/api/v1/grill/sessions/{session_id}").json()
        assert [fact["text"] for fact in after["facts"]] == [
            "把 P99 从 800ms 压到 120ms",
            "手段是给热点查询加 Redis 缓存",
            "带过两个实习生半年",
        ]
        assert after["closed_by"] == "exhausted"


def test_rewrite_versions_survive_a_restart(tmp_path: Path) -> None:
    """成稿版本重启后仍可读：在第一个实例上出初稿，重启后版本历史与那一版
    都还在，接着改稿版本号从那之后继续。"""
    settings = make_settings(tmp_path)

    first_llm = ScriptedLlm(OPENING, TURN_DONE)
    with TestClient(create_app(settings, llm=first_llm)) as client:
        resume = seed_resume(client)
        session_id = client.post(
            "/api/v1/grill/sessions",
            json={"jd_text": "要求有性能调优经验", "crumb_ids": [resume]},
        ).json()["session_id"]
        answer(client, session_id, "n1", "把 P99 从 800ms 压到 120ms")

        facts = client.get(f"/api/v1/grill/sessions/{session_id}").json()["facts"]
        turn_id = facts[0]["turn_id"]
        fact_ids = [fact["id"] for fact in facts]
        draft = {
            "segments": [
                {"text": "后端工程师", "source": "original", "fact_ids": []},
                {
                    "text": "把 P99 从 800ms 压到 120ms，加了 Redis 缓存",
                    "source": f"turn:{turn_id}",
                    "fact_ids": fact_ids,
                },
            ],
            "refusal": None,
        }
        first_llm.results.append(draft)
        v1 = client.post(
            f"/api/v1/grill/sessions/{session_id}/rewrite", json={"instruction": None}
        )
        assert v1.status_code == 200
        assert v1.json()["version"] == 1

    # 重启：成稿版本得从库里读回来。
    revised = {
        "segments": [
            {"text": "后端工程师", "source": "original", "fact_ids": []},
            {
                "text": "订单接口 P99 从 800ms 干到 120ms，靠热点查询走 Redis",
                "source": f"turn:{turn_id}",
                "fact_ids": fact_ids,
            },
        ],
        "refusal": None,
    }
    second_llm = ScriptedLlm(revised)
    with TestClient(create_app(settings, llm=second_llm)) as restarted:
        # v1 的版本历史还在。
        history = restarted.get(
            f"/api/v1/grill/sessions/{session_id}/rewrite/versions"
        ).json()
        assert [item["version"] for item in history["versions"]] == [1]

        # v1 的那一版正文可回看。
        read_back = restarted.get(f"/api/v1/grill/sessions/{session_id}/rewrite/1")
        assert read_back.status_code == 200
        assert read_back.json()["segments"] == v1.json()["segments"]

        # 接着改稿：版本从 v1 之后继续，推进到 v2，不是重开 v1。
        v2 = restarted.post(
            f"/api/v1/grill/sessions/{session_id}/rewrite",
            json={"instruction": "口语一点"},
        )
        assert v2.status_code == 200
        assert v2.json()["version"] == 2
        assert v2.json()["instruction"] == "口语一点"

        history_after = restarted.get(
            f"/api/v1/grill/sessions/{session_id}/rewrite/versions"
        ).json()
        assert history_after["versions"] == [
            {"version": 1, "instruction": None},
            {"version": 2, "instruction": "口语一点"},
        ]


def test_an_unknown_session_is_404_even_with_persistence(tmp_path: Path) -> None:
    """落库不改 404 的语义：真不存在的会话仍 404——前端据此给「重开一场」提示，
    只是如今重启不再是触发它的原因。"""
    with TestClient(create_app(make_settings(tmp_path), llm=ScriptedLlm(OPENING))) as client:
        response = client.get(
            "/api/v1/grill/sessions/00000000-0000-0000-0000-0000000000aa"
        )

    assert response.status_code == 404
