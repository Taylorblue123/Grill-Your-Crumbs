"""成稿改写的外部行为：POST /api/v1/grill/sessions/{id}/rewrite 及两条读路径。

和前两片同样的立场：全部用例从 HTTP 层驱动，LLM 走假实现。断言的是请求进 / 响应出、
以及版本历史被改成了什么样；prompt 怎么拼、段落怎么清洗，测试一概不管——除了一处
例外：账本必须真的进 prompt、原始问答记录不必进（那是这一片的输入契约，是外部可
观察的行为的成因，值得钉死）。

这一片要守的五条规则，各有对应用例：

- **出处绑定**：segments 的 source 标记与 fact_ids 指回账本，hover 要的问答一并带出
- **版本推进**：instruction 推进版本号，历史可回看
- **缓存**：同参数重复调用返回缓存，不烧第二次 token
- **拒绝路径**：要求编造的指令被拒绝并说明，成稿维持上一版原样
- **失败原子性**：LLM 抛错 → 502 且版本历史一个字没变
"""

from pathlib import Path
from typing import Any, Dict, List, Optional
from uuid import uuid4

from fastapi.testclient import TestClient

from backend.app.config import LlmSettings, Settings
from backend.app.llm import LlmError
from backend.app.main import create_app


DEMO_USER = "00000000-0000-0000-0000-000000000001"

BASELINE_TEXT = "负责了后端接口的开发\n优化了接口性能"

# 开场那一次调用的返回。照抄自 test_grill_answers.py 而非共享——测试文件之间互相
# import 会让一个文件的编辑悄悄弄坏另一个文件（本仓已有的 `make_settings` 同理）。
OPENING: Dict[str, Any] = {
    "tree": [
        {"id": "n1", "topic": "那次延迟优化到底做了什么", "why": "简历只写了「优化性能」"},
        {"id": "n2", "topic": "带没带过人", "why": "JD 要求 mentoring"},
    ],
    "question": {
        "id": "n1",
        "text": "你简历里写的「优化了接口性能」，具体是把什么从多少压到了多少？",
        "why": "你的《我的简历.html》里这句话没有任何数字。",
        "options": [{"key": "a", "text": "加了缓存"}],
        "recommended": {"key": "a", "reason": "repo 料里出现过 Redis 依赖。"},
    },
}

# 一轮作答：抽出两条事实，树上划掉 n1，收口。
TURN_DONE: Dict[str, Any] = {
    "facts": [
        {"text": "把 P99 从 800ms 压到 120ms", "source": "第 1 轮回答"},
        {"text": "手段是给热点查询加 Redis 缓存", "source": "第 1 轮回答"},
    ],
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


def seed_crumb(
    client: TestClient, *, kind: str, name: str, content: str, synced_at: str
) -> str:
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
            "media_type": "text/html",
            "byte_size": len(content),
            "storage_key": f"{DEMO_USER}/{crumb_id}.html",
            "sha256": f"hash-{crumb_id}",
            "extraction_status": "ready",
            "created_at": synced_at,
        },
    )
    return crumb_id


class ScriptedLlm:
    """按顺序交回预设结果的假 LLM。最后一个结果之后一直交回它。"""

    def __init__(self, *results: Dict[str, Any]):
        self.results = list(results)
        self.calls: List[Dict[str, Any]] = []

    def complete(self, *, messages, schema_name, schema):
        self.calls.append({"messages": messages, "schema_name": schema_name, "schema": schema})
        index = min(len(self.calls) - 1, len(self.results) - 1)
        return self.results[index]

    @property
    def prompt(self) -> str:
        return "\n".join(message["content"] for message in self.calls[-1]["messages"])


class FailingRewriteLlm:
    """开场和作答成功，改写调用前 `failures` 次抛 LlmError。"""

    def __init__(self, failures: int, *results: Dict[str, Any]):
        self.remaining_failures = failures
        self.scripted = ScriptedLlm(*results)
        self.calls = self.scripted.calls

    def complete(self, **kwargs):
        if kwargs["schema_name"] == "grill_rewrite" and self.remaining_failures > 0:
            self.remaining_failures -= 1
            self.calls.append(kwargs)
            raise LlmError("upstream is down")
        return self.scripted.complete(**kwargs)


def make_client(tmp_path: Path, llm: Any) -> TestClient:
    return TestClient(create_app(make_settings(tmp_path), llm=llm))


def closed_session(client: TestClient) -> str:
    """开一场、答一轮、收口，返回 session_id。改写用例的起点都在这。"""
    resume = seed_crumb(
        client, kind="resume", name="我的简历.html",
        content=BASELINE_TEXT, synced_at="2026-01-01T00:00:00Z",
    )
    repo = seed_crumb(
        client, kind="repo", name="api-service",
        content="Redis 缓存层与压测脚本", synced_at="2026-01-02T00:00:00Z",
    )
    opened = client.post(
        "/api/v1/grill/sessions",
        json={"jd_text": "要求有性能调优经验", "crumb_ids": [resume, repo]},
    )
    assert opened.status_code == 201
    session_id = opened.json()["session_id"]
    client.post(
        f"/api/v1/grill/sessions/{session_id}/answers",
        json={
            "question_id": "n1",
            "answer_text": "把 P99 从 800ms 压到 120ms，加了 Redis 缓存",
            "chosen_option": None,
        },
    )
    return session_id


def turn_id_of(client: TestClient, session_id: str) -> str:
    """账本上任一条事实的 turn_id——假 LLM 要拿它来标 `source`。

    turn_id 是服务端生成的 uuid，用例没法预先写死，只能问会话要。真实的模型
    同样是从 prompt 里的账本读到它的。
    """
    facts = client.get(f"/api/v1/grill/sessions/{session_id}").json()["facts"]
    return facts[0]["turn_id"]


def rewrite_result(
    *segments: Dict[str, Any], refusal: Optional[str] = None
) -> Dict[str, Any]:
    return {"segments": list(segments), "refusal": refusal}


def draft_for(turn_id: str, fact_ids: List[str]) -> Dict[str, Any]:
    """典型初稿：一段照抄原简历，一段是拷问挖出来的。"""
    return rewrite_result(
        {"text": "后端工程师 · 接口与性能", "source": "original", "fact_ids": []},
        {
            "text": "把订单查询接口 P99 从 800ms 压到 120ms，做法是给热点查询加 Redis 缓存",
            "source": f"turn:{turn_id}",
            "fact_ids": fact_ids,
        },
    )


def open_and_draft(client: TestClient, llm: ScriptedLlm):
    """收口 → 让假 LLM 交回一版引用真实 id 的初稿 → 返回 (session_id, 响应)。

    假 LLM 的脚本要引用服务端生成的 turn_id / fact_id，所以初稿结果只能在会话
    建好之后才拼得出来——`results` 在这里被追加，而不是在构造时写死。
    """
    session_id = closed_session(client)
    projection = client.get(f"/api/v1/grill/sessions/{session_id}").json()
    fact_ids = [fact["id"] for fact in projection["facts"]]
    llm.results.append(draft_for(projection["facts"][0]["turn_id"], fact_ids))
    return session_id, client.post(
        f"/api/v1/grill/sessions/{session_id}/rewrite", json={"instruction": None}
    )


# --- 初稿 -------------------------------------------------------------------


def test_the_initial_draft_carries_the_original_and_its_segments(tmp_path: Path) -> None:
    """收口后出初稿：左边原简历、右边带出处标记的成稿，一个响应全给到。"""
    llm = ScriptedLlm(OPENING, TURN_DONE)
    with make_client(tmp_path, llm) as client:
        _, response = open_and_draft(client, llm)

    assert response.status_code == 200
    body = response.json()
    assert body["version"] == 1
    assert body["instruction"] is None
    assert body["refusal"] is None
    # 对比视图左边永远是原简历——前端不必自己去料库里捞底稿。
    assert body["original_text"] == BASELINE_TEXT
    assert [segment["text"] for segment in body["segments"]] == [
        "后端工程师 · 接口与性能",
        "把订单查询接口 P99 从 800ms 压到 120ms，做法是给热点查询加 Redis 缓存",
    ]


def test_segment_sources_bind_to_the_ledger(tmp_path: Path) -> None:
    """金色染色和 hover 溯源的数据基础：source 标记 + fact_ids 指回账本。"""
    llm = ScriptedLlm(OPENING, TURN_DONE)
    with make_client(tmp_path, llm) as client:
        session_id, response = open_and_draft(client, llm)
        facts = client.get(f"/api/v1/grill/sessions/{session_id}").json()["facts"]

    segments = response.json()["segments"]
    assert segments[0]["source"] == "original"
    assert segments[0]["fact_ids"] == []

    grilled = segments[1]
    assert grilled["source"] == f"turn:{facts[0]['turn_id']}"
    assert grilled["fact_ids"] == [fact["id"] for fact in facts]


def test_a_grilled_segment_carries_the_round_and_its_qa(tmp_path: Path) -> None:
    """hover 金色片段要显示「来自第几轮的哪个问答」——问答随段落一起下发，
    前端不必再去反查账本。"""
    llm = ScriptedLlm(OPENING, TURN_DONE)
    with make_client(tmp_path, llm) as client:
        _, response = open_and_draft(client, llm)

    grilled = response.json()["segments"][1]
    assert grilled["round"] == 1
    assert grilled["question_text"] == OPENING["question"]["text"]
    assert "800ms" in grilled["answer_text"]


def test_stats_count_what_the_grilling_contributed(tmp_path: Path) -> None:
    """「同一段经历，x 处是刚从我嘴里挖出来的」。"""
    llm = ScriptedLlm(OPENING, TURN_DONE)
    with make_client(tmp_path, llm) as client:
        _, response = open_and_draft(client, llm)

    stats = response.json()["stats"]
    assert stats["total_segments"] == 2
    assert stats["grilled_segments"] == 1
    # 账本两条事实都被这一段用上了。
    assert stats["fact_count"] == 2


def test_the_rewrite_prompt_is_fed_the_ledger_not_the_raw_transcript(
    tmp_path: Path,
) -> None:
    """输入是**事实账本**，不是原始问答记录（issue #27 的输入契约）。

    问答记录里夹着语气词和跑题，让模型自己从中挑事实等于把作答那一片已经做过
    的事再做一遍，而且做得更差。账本是那次抽取的结果。

    JD、原简历、料摘要同样在场——改写要对着靶子写，也要认得出哪句话原简历里有。
    """
    llm = ScriptedLlm(OPENING, TURN_DONE)
    with make_client(tmp_path, llm) as client:
        open_and_draft(client, llm)

    prompt = llm.prompt
    assert "把 P99 从 800ms 压到 120ms" in prompt        # 账本
    assert "要求有性能调优经验" in prompt                  # JD
    assert "负责了后端接口的开发" in prompt                # 原简历
    assert "Redis 缓存层与压测脚本" in prompt              # 别的料的摘要


def test_asking_for_a_draft_again_does_not_burn_a_second_call(tmp_path: Path) -> None:
    """前端每次进对比视图都会调这个端点——不能每次都重跑一次 LLM。"""
    llm = ScriptedLlm(OPENING, TURN_DONE)
    with make_client(tmp_path, llm) as client:
        session_id, first = open_and_draft(client, llm)
        calls_before = len(llm.calls)
        again = client.post(
            f"/api/v1/grill/sessions/{session_id}/rewrite", json={"instruction": None}
        )

    assert len(llm.calls) == calls_before
    assert again.json() == first.json()


def test_a_rewrite_of_a_missing_session_is_404(tmp_path: Path) -> None:
    llm = ScriptedLlm(OPENING, TURN_DONE)
    with make_client(tmp_path, llm) as client:
        response = client.post(
            "/api/v1/grill/sessions/00000000-0000-0000-0000-0000000000aa/rewrite",
            json={"instruction": None},
        )

    assert response.status_code == 404


def test_another_users_session_cannot_be_rewritten(tmp_path: Path) -> None:
    llm = ScriptedLlm(OPENING, TURN_DONE)
    with make_client(tmp_path, llm) as client:
        session_id, _ = open_and_draft(client, llm)
        response = client.post(
            f"/api/v1/grill/sessions/{session_id}/rewrite",
            json={"instruction": None},
            headers={"X-User-Id": "00000000-0000-0000-0000-0000000000ff"},
        )

    assert response.status_code == 404


def test_a_rewrite_is_available_before_the_session_closes(tmp_path: Path) -> None:
    """随时可改写：中途想看看现在能出个什么稿，不必先把这场问完。"""
    llm = ScriptedLlm(OPENING)
    with make_client(tmp_path, llm) as client:
        resume = seed_crumb(
            client, kind="resume", name="我的简历.html",
            content=BASELINE_TEXT, synced_at="2026-01-01T00:00:00Z",
        )
        session_id = client.post(
            "/api/v1/grill/sessions",
            json={"jd_text": "要求有性能调优经验", "crumb_ids": [resume]},
        ).json()["session_id"]
        llm.results.append(
            rewrite_result({"text": "后端工程师", "source": "original", "fact_ids": []})
        )
        response = client.post(
            f"/api/v1/grill/sessions/{session_id}/rewrite", json={"instruction": None}
        )

    assert response.status_code == 200
    assert response.json()["version"] == 1


# --- 悬空引用的清洗 ---------------------------------------------------------


def test_fact_ids_that_point_nowhere_are_dropped(tmp_path: Path) -> None:
    """指不到账本的 fact_id 丢掉：hover 一个金色片段却弹出空卡片，比少标一处更糟。

    这不是溯源校验（本轮显式不做，见 TODOS.md），只是不让前端拿到悬空指针。
    """
    llm = ScriptedLlm(OPENING, TURN_DONE)
    with make_client(tmp_path, llm) as client:
        session_id = closed_session(client)
        turn_id = turn_id_of(client, session_id)
        llm.results.append(
            rewrite_result(
                {
                    "text": "把 P99 压到 120ms",
                    "source": f"turn:{turn_id}",
                    "fact_ids": ["不存在的事实 id"],
                }
            )
        )
        response = client.post(
            f"/api/v1/grill/sessions/{session_id}/rewrite", json={"instruction": None}
        )

    segment = response.json()["segments"][0]
    assert segment["fact_ids"] == []
    # 段落本身留着——出处标错不该让这句话从简历里消失。
    assert segment["text"] == "把 P99 压到 120ms"


def test_a_segment_pointing_at_an_unknown_turn_is_demoted(tmp_path: Path) -> None:
    """指向不存在轮次的段落降级成 original——少认领一处功劳，好过认领一处假的。"""
    llm = ScriptedLlm(
        OPENING,
        TURN_DONE,
        rewrite_result(
            {"text": "凭空冒出来的一段", "source": "turn:根本没有这一轮", "fact_ids": []}
        ),
    )
    with make_client(tmp_path, llm) as client:
        session_id = closed_session(client)
        response = client.post(
            f"/api/v1/grill/sessions/{session_id}/rewrite", json={"instruction": None}
        )

    segment = response.json()["segments"][0]
    assert segment["source"] == "original"
    assert segment["round"] is None
    # 降级的段落不进「挖出来的」计数。
    assert response.json()["stats"]["grilled_segments"] == 0


def test_an_empty_rewrite_is_a_502(tmp_path: Path) -> None:
    """一段都没有等于这次调用没干活——和开场空树同一类失败。"""
    llm = ScriptedLlm(OPENING, TURN_DONE, rewrite_result())
    with make_client(tmp_path, llm) as client:
        session_id = closed_session(client)
        response = client.post(
            f"/api/v1/grill/sessions/{session_id}/rewrite", json={"instruction": None}
        )

    assert response.status_code == 502


# --- 对话式改稿与版本 -------------------------------------------------------


def revised(turn_id: str, fact_ids: List[str]) -> Dict[str, Any]:
    """改稿后的一版：措辞变了，出处标记跟着走。"""
    return rewrite_result(
        {"text": "后端工程师", "source": "original", "fact_ids": []},
        {
            "text": "订单接口 P99 从 800ms 干到 120ms，靠的是热点查询走 Redis",
            "source": f"turn:{turn_id}",
            "fact_ids": fact_ids,
        },
    )


def test_an_instruction_advances_the_version(tmp_path: Path) -> None:
    """自然语言指令改稿 → v2。"""
    llm = ScriptedLlm(OPENING, TURN_DONE)
    with make_client(tmp_path, llm) as client:
        session_id, first = open_and_draft(client, llm)
        facts = client.get(f"/api/v1/grill/sessions/{session_id}").json()["facts"]
        llm.results.append(
            revised(facts[0]["turn_id"], [fact["id"] for fact in facts])
        )
        response = client.post(
            f"/api/v1/grill/sessions/{session_id}/rewrite", json={"instruction": "口语一点"}
        )

    assert first.json()["version"] == 1
    body = response.json()
    assert body["version"] == 2
    assert body["instruction"] == "口语一点"
    assert "干到 120ms" in body["segments"][1]["text"]


def test_provenance_survives_a_revision(tmp_path: Path) -> None:
    """改稿后出处标记不丢失，金色溯源贯穿始终（issue #27 验收）。"""
    llm = ScriptedLlm(OPENING, TURN_DONE)
    with make_client(tmp_path, llm) as client:
        session_id, _ = open_and_draft(client, llm)
        facts = client.get(f"/api/v1/grill/sessions/{session_id}").json()["facts"]
        llm.results.append(
            revised(facts[0]["turn_id"], [fact["id"] for fact in facts])
        )
        response = client.post(
            f"/api/v1/grill/sessions/{session_id}/rewrite", json={"instruction": "口语一点"}
        )

    grilled = response.json()["segments"][1]
    assert grilled["source"] == f"turn:{facts[0]['turn_id']}"
    assert grilled["fact_ids"] == [fact["id"] for fact in facts]
    # hover 要的问答同样还在。
    assert grilled["round"] == 1
    assert grilled["question_text"] == OPENING["question"]["text"]


def test_the_previous_version_is_fed_to_the_revision_prompt(tmp_path: Path) -> None:
    """改稿改的是**上一版成稿**，不是从头再写一遍。出处标记也一起送进去——
    模型要保住一段话的出处，前提是它看得见那段话原来标的是什么。"""
    llm = ScriptedLlm(OPENING, TURN_DONE)
    with make_client(tmp_path, llm) as client:
        session_id, _ = open_and_draft(client, llm)
        facts = client.get(f"/api/v1/grill/sessions/{session_id}").json()["facts"]
        llm.results.append(revised(facts[0]["turn_id"], [fact["id"] for fact in facts]))
        client.post(
            f"/api/v1/grill/sessions/{session_id}/rewrite", json={"instruction": "口语一点"}
        )

    prompt = llm.prompt
    assert "做法是给热点查询加 Redis 缓存" in prompt   # v1 的正文
    assert f"turn:{facts[0]['turn_id']}" in prompt      # v1 的出处标记
    assert "口语一点" in prompt                          # 指令本身


def test_the_same_instruction_on_the_same_version_is_cached(tmp_path: Path) -> None:
    """同参数重复调用返回缓存，不烧第二次 token（issue #27 验收）。

    双击「改稿」、网络重发都走这条。
    """
    llm = ScriptedLlm(OPENING, TURN_DONE)
    with make_client(tmp_path, llm) as client:
        session_id, _ = open_and_draft(client, llm)
        facts = client.get(f"/api/v1/grill/sessions/{session_id}").json()["facts"]
        llm.results.append(revised(facts[0]["turn_id"], [fact["id"] for fact in facts]))

        first = client.post(
            f"/api/v1/grill/sessions/{session_id}/rewrite", json={"instruction": "口语一点"}
        )
        calls_before = len(llm.calls)
        second = client.post(
            f"/api/v1/grill/sessions/{session_id}/rewrite", json={"instruction": "口语一点"}
        )

        history = client.get(
            f"/api/v1/grill/sessions/{session_id}/rewrite/versions"
        ).json()

    assert len(llm.calls) == calls_before
    assert second.json() == first.json()
    # 缓存命中不该造出第三版。
    assert [item["version"] for item in history["versions"]] == [1, 2]


def test_the_same_instruction_on_a_later_version_is_not_cached(tmp_path: Path) -> None:
    """「口语一点」用在 v1 和用在 v2 上是两次不同的改写。

    只按指令做键会把用户送回一版他已经改过的稿子。
    """
    llm = ScriptedLlm(OPENING, TURN_DONE)
    with make_client(tmp_path, llm) as client:
        session_id, _ = open_and_draft(client, llm)
        facts = client.get(f"/api/v1/grill/sessions/{session_id}").json()["facts"]
        fact_ids = [fact["id"] for fact in facts]
        llm.results.append(revised(facts[0]["turn_id"], fact_ids))

        client.post(
            f"/api/v1/grill/sessions/{session_id}/rewrite", json={"instruction": "口语一点"}
        )
        client.post(
            f"/api/v1/grill/sessions/{session_id}/rewrite", json={"instruction": "再短一点"}
        )
        response = client.post(
            f"/api/v1/grill/sessions/{session_id}/rewrite", json={"instruction": "口语一点"}
        )

    # v2 上的「口语一点」是 v4，不是缓存里那个 v2。
    assert response.json()["version"] == 4


def test_the_version_history_lists_what_each_version_was_asked_for(
    tmp_path: Path,
) -> None:
    """版本步进器的数据源：v1/v2/v3 各是哪条指令改出来的。"""
    llm = ScriptedLlm(OPENING, TURN_DONE)
    with make_client(tmp_path, llm) as client:
        session_id, _ = open_and_draft(client, llm)
        facts = client.get(f"/api/v1/grill/sessions/{session_id}").json()["facts"]
        llm.results.append(revised(facts[0]["turn_id"], [fact["id"] for fact in facts]))
        client.post(
            f"/api/v1/grill/sessions/{session_id}/rewrite", json={"instruction": "口语一点"}
        )
        client.post(
            f"/api/v1/grill/sessions/{session_id}/rewrite", json={"instruction": "去 AI 味"}
        )
        history = client.get(
            f"/api/v1/grill/sessions/{session_id}/rewrite/versions"
        ).json()

    assert history["versions"] == [
        {"version": 1, "instruction": None},
        {"version": 2, "instruction": "口语一点"},
        {"version": 3, "instruction": "去 AI 味"},
    ]


def test_an_old_version_can_be_read_back(tmp_path: Path) -> None:
    """「回看更好的一版」的读路径。回看是纯读，不把旧版复制成新版。"""
    llm = ScriptedLlm(OPENING, TURN_DONE)
    with make_client(tmp_path, llm) as client:
        session_id, first = open_and_draft(client, llm)
        facts = client.get(f"/api/v1/grill/sessions/{session_id}").json()["facts"]
        llm.results.append(revised(facts[0]["turn_id"], [fact["id"] for fact in facts]))
        client.post(
            f"/api/v1/grill/sessions/{session_id}/rewrite", json={"instruction": "口语一点"}
        )

        old = client.get(f"/api/v1/grill/sessions/{session_id}/rewrite/1")
        history = client.get(
            f"/api/v1/grill/sessions/{session_id}/rewrite/versions"
        ).json()

    assert old.status_code == 200
    assert old.json() == first.json()
    assert [item["version"] for item in history["versions"]] == [1, 2]


def test_reading_a_version_that_does_not_exist_is_404(tmp_path: Path) -> None:
    llm = ScriptedLlm(OPENING, TURN_DONE)
    with make_client(tmp_path, llm) as client:
        session_id, _ = open_and_draft(client, llm)
        response = client.get(f"/api/v1/grill/sessions/{session_id}/rewrite/9")

    assert response.status_code == 404


def test_an_instruction_before_any_draft_produces_v1(tmp_path: Path) -> None:
    """用户直接带着指令进来（前端还没拉过初稿）：那就是 v1，不是 v2。"""
    llm = ScriptedLlm(OPENING, TURN_DONE)
    with make_client(tmp_path, llm) as client:
        session_id = closed_session(client)
        turn_id = turn_id_of(client, session_id)
        llm.results.append(draft_for(turn_id, []))
        response = client.post(
            f"/api/v1/grill/sessions/{session_id}/rewrite", json={"instruction": "短一点"}
        )

    assert response.json()["version"] == 1


# --- 拒绝编造 ---------------------------------------------------------------


REFUSAL = "你让我加一段大厂实习，但这场拷问里没有任何一条事实提到它。编出来的经历面试时要你自己扛，我不写。"


def test_an_instruction_asking_for_fabrication_is_refused(tmp_path: Path) -> None:
    """产品唯一红线在这一片的出口：要求编造的指令被拒绝并说明原因（ADR-0002）。"""
    llm = ScriptedLlm(OPENING, TURN_DONE)
    with make_client(tmp_path, llm) as client:
        session_id, first = open_and_draft(client, llm)
        llm.results.append(rewrite_result(refusal=REFUSAL))
        response = client.post(
            f"/api/v1/grill/sessions/{session_id}/rewrite",
            json={"instruction": "再加一段字节跳动的实习经历"},
        )

    # 拒绝是 200 不是错误：走错误码会诱使前端把它当故障重试，
    # 而重试一条编造指令没有意义——用户需要读到的是「为什么不给你写」。
    assert response.status_code == 200
    body = response.json()
    assert body["refusal"] == REFUSAL
    # 成稿维持上一版原样：拒绝了一条指令，稿子不该跟着变。
    assert body["segments"] == first.json()["segments"]


def test_a_refusal_does_not_lose_the_previous_draft(tmp_path: Path) -> None:
    """被拒之后接着改稿，改的仍是那份稿子——拒绝不该把用户的成果搅乱。"""
    llm = ScriptedLlm(OPENING, TURN_DONE)
    with make_client(tmp_path, llm) as client:
        session_id, first = open_and_draft(client, llm)
        llm.results.append(rewrite_result(refusal=REFUSAL))
        client.post(
            f"/api/v1/grill/sessions/{session_id}/rewrite",
            json={"instruction": "再加一段字节跳动的实习经历"},
        )
        facts = client.get(f"/api/v1/grill/sessions/{session_id}").json()["facts"]
        llm.results.append(revised(facts[0]["turn_id"], [fact["id"] for fact in facts]))
        response = client.post(
            f"/api/v1/grill/sessions/{session_id}/rewrite", json={"instruction": "口语一点"}
        )

    body = response.json()
    assert body["refusal"] is None
    assert "干到 120ms" in body["segments"][1]["text"]
    # 被拒的那一版照样占一个版本号——用户在历史里看得见「我提过这个，被拒了」。
    assert body["version"] == 3
    assert first.json()["version"] == 1


# --- 失败原子性 -------------------------------------------------------------


def test_an_llm_failure_leaves_the_version_history_untouched(tmp_path: Path) -> None:
    """LLM 抛错 → 502，版本历史一个字没变，同一指令可安全重发。"""
    llm = FailingRewriteLlm(1, OPENING, TURN_DONE)
    with make_client(tmp_path, llm) as client:
        session_id = closed_session(client)
        turn_id = turn_id_of(client, session_id)

        failed = client.post(
            f"/api/v1/grill/sessions/{session_id}/rewrite", json={"instruction": None}
        )
        assert failed.status_code == 502
        empty = client.get(
            f"/api/v1/grill/sessions/{session_id}/rewrite/versions"
        ).json()
        assert empty["versions"] == []

        llm.scripted.results.append(draft_for(turn_id, []))
        retried = client.post(
            f"/api/v1/grill/sessions/{session_id}/rewrite", json={"instruction": None}
        )
        history = client.get(
            f"/api/v1/grill/sessions/{session_id}/rewrite/versions"
        ).json()

    assert retried.status_code == 200
    # 重发没有留下半个版本——失败那次一版都没写进去。
    assert [item["version"] for item in history["versions"]] == [1]


def test_a_deleted_baseline_crumb_does_not_break_the_rewrite(tmp_path: Path) -> None:
    """用户在别处删了底稿简历：改写照样能跑，只是左边没有可比的原文。"""
    llm = ScriptedLlm(OPENING, TURN_DONE)
    with make_client(tmp_path, llm) as client:
        session_id = closed_session(client)
        turn_id = turn_id_of(client, session_id)
        baseline_id = client.get(
            f"/api/v1/grill/sessions/{session_id}"
        ).json()["baseline_crumb_id"]
        client.delete(f"/api/v1/crumbs/{baseline_id}")

        llm.results.append(draft_for(turn_id, []))
        response = client.post(
            f"/api/v1/grill/sessions/{session_id}/rewrite", json={"instruction": None}
        )

    assert response.status_code == 200
    assert response.json()["original_text"] == ""
    assert response.json()["segments"]


def test_a_refusal_before_any_draft_still_explains_itself(tmp_path: Path) -> None:
    """用户带着一条编造指令直接进来（前端还没拉过初稿）。

    这时没有「上一版」可以维持，但拒绝仍然是 200：他要读的是「为什么不给你写」，
    把这一种变成 502 会让前端当故障重试。
    """
    llm = ScriptedLlm(OPENING, TURN_DONE, rewrite_result(refusal=REFUSAL))
    with make_client(tmp_path, llm) as client:
        session_id = closed_session(client)
        response = client.post(
            f"/api/v1/grill/sessions/{session_id}/rewrite",
            json={"instruction": "加一段字节跳动的实习"},
        )

    assert response.status_code == 200
    body = response.json()
    assert body["refusal"] == REFUSAL
    assert body["segments"] == []


def test_a_segment_sourced_from_a_crumb_keeps_its_marker(tmp_path: Path) -> None:
    """三色出处的第三色：来自某份料的段落标 `crumb:<id>`，前端染蓝。

    金色（拷问挖到的）之外还有这一种，成稿里两者都算「不是原简历本来就有的」。
    """
    llm = ScriptedLlm(OPENING, TURN_DONE)
    with make_client(tmp_path, llm) as client:
        session_id = closed_session(client)
        crumb_id = client.get("/api/v1/crumbs").json()["crumbs"][0]["id"]
        llm.results.append(
            rewrite_result(
                {"text": "原简历本来就有的一句", "source": "original", "fact_ids": []},
                {"text": "从料里读到的一句", "source": f"crumb:{crumb_id}", "fact_ids": []},
            )
        )
        response = client.post(
            f"/api/v1/grill/sessions/{session_id}/rewrite", json={"instruction": None}
        )

    segment = response.json()["segments"][1]
    assert segment["source"] == f"crumb:{crumb_id}"
    # 料来源不是「某一轮问答」，所以没有轮号可标——hover 卡片走另一条分支。
    assert segment["round"] is None
    # 但它照样算「不是原简历本来就有的」。
    assert response.json()["stats"]["grilled_segments"] == 1


def test_a_segment_pointing_at_a_crumb_outside_the_session_is_demoted(
    tmp_path: Path,
) -> None:
    """指向一份没进场的料，同样降级成 original。

    前端认不出这个 id，会把它原样当成料的名字显示在 hover 卡片上——
    比少标一处更糟。
    """
    llm = ScriptedLlm(
        OPENING,
        TURN_DONE,
        rewrite_result(
            {"text": "来路不明的一段", "source": "crumb:根本没进场的料", "fact_ids": []}
        ),
    )
    with make_client(tmp_path, llm) as client:
        session_id = closed_session(client)
        response = client.post(
            f"/api/v1/grill/sessions/{session_id}/rewrite", json={"instruction": None}
        )

    segment = response.json()["segments"][0]
    assert segment["source"] == "original"
    assert response.json()["stats"]["grilled_segments"] == 0
