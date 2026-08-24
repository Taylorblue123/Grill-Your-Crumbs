"""作答循环的外部行为：POST /api/v1/grill/sessions/{id}/answers 与 GET /api/v1/grill/sessions/{id}。

和开场那一片同样的立场：全部用例从 HTTP 层驱动，LLM 走假实现。断言的是请求进 /
响应出、以及会话状态被改成了什么样；一次 LLM 调用里怎么拼 prompt、树怎么更新，
测试一概不管。

这一片要守的四条规则，各有对应用例：

- **失败原子性**：LLM 抛错 → 502 且会话一个字没变，重发同一答案照样成功
- **作答幂等**：重复 question_id → 409 + 当前状态，不产生第二次 LLM 调用
- **退化防护**：已答 <2 轮时模型报 done 不采纳
- **会话恢复**：GET 投影足以让前端把现场原样重画出来
"""

from pathlib import Path
from typing import Any, Dict, List, Optional
from uuid import uuid4

from fastapi.testclient import TestClient

from backend.app.config import LlmSettings, Settings
from backend.app.llm import LlmError
from backend.app.main import create_app


DEMO_USER = "00000000-0000-0000-0000-000000000001"

# 开场那一次调用的返回。和 test_grill_opening.py 里的同名常量一样，是照抄而非
# 共享——测试文件之间互相 import 会让一个文件的编辑悄悄弄坏另一个文件，而这
# 几行的重复代价远小于那种耦合。本仓已有的 `make_settings` 也是这么两份的。
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


def seed_crumb(
    client: TestClient, *, kind: str, name: str, content: str, synced_at: str
) -> str:
    """直接写库建料——这些用例测的是作答，不是上传。"""
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


# 一轮作答的典型返回：抽出两条事实，树上划掉 n1，下一题问 n2。
TURN_N2 = {
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
        "options": [
            {"key": "a", "text": "带过 1-2 个实习生"},
            {"key": "b", "text": "带过一个 3-5 人的小组"},
            {"key": "c", "text": "没正式带过，但做过 code review"},
        ],
        "recommended": {"key": "c", "reason": "你的 repo 料里有大量 review 记录。"},
    },
    "done": False,
}


def turn_done(facts: Optional[List[Dict[str, str]]] = None) -> Dict[str, Any]:
    """模型宣告收口的一轮：树空、无下一题。"""
    return {
        "facts": facts if facts is not None else [{"text": "补充了一条", "source": "回答"}],
        "tree": [],
        "question": None,
        "done": True,
    }


class ScriptedLlm:
    """按顺序交回预设结果的假 LLM：第一次开场，之后每次一轮作答。

    比 `FakeLlm` 多的只有「按调用序号换答案」——作答循环要连问好几轮，
    每轮结果不同。
    """

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


class FlakyLlm:
    """开场成功，之后前 `failures` 次作答调用抛 LlmError，再之后成功。"""

    def __init__(self, failures: int, *results: Dict[str, Any]):
        self.remaining_failures = failures
        self.scripted = ScriptedLlm(*results)
        self.calls = self.scripted.calls

    def complete(self, **kwargs):
        if self.calls and self.remaining_failures > 0:
            self.remaining_failures -= 1
            self.calls.append(kwargs)
            raise LlmError("upstream is down")
        return self.scripted.complete(**kwargs)


def open_a_session(client: TestClient) -> str:
    """开一场拷问，返回 session_id。用例的起点几乎都在这。"""
    resume = seed_crumb(
        client, kind="resume", name="我的简历.pdf",
        content="优化了接口性能", synced_at="2026-01-01T00:00:00Z",
    )
    response = client.post(
        "/api/v1/grill/sessions",
        json={"jd_text": "要求有性能调优经验，能带人", "crumb_ids": [resume]},
    )
    assert response.status_code == 201
    return response.json()["session_id"]


def make_client(tmp_path: Path, llm: Any) -> TestClient:
    return TestClient(create_app(make_settings(tmp_path), llm=llm))


def answer(
    client: TestClient,
    session_id: str,
    question_id: str,
    text: str = "把 P99 从 800ms 压到 120ms，加了 Redis 缓存",
    chosen_option: Optional[str] = None,
):
    return client.post(
        f"/api/v1/grill/sessions/{session_id}/answers",
        json={
            "question_id": question_id,
            "answer_text": text,
            "chosen_option": chosen_option,
        },
    )


# --- 作答成功路径 -----------------------------------------------------------


def test_answering_yields_facts_and_the_next_question(tmp_path: Path) -> None:
    """一次作答，一次 LLM 调用，同时交回事实、更新后的树和下一题。"""
    llm = ScriptedLlm(OPENING, TURN_N2)
    with make_client(tmp_path, llm) as client:
        session_id = open_a_session(client)
        response = answer(client, session_id, "n1")

    assert response.status_code == 200
    body = response.json()

    assert [fact["text"] for fact in body["facts"]] == [
        "把 P99 从 800ms 压到 120ms",
        "手段是给热点查询加 Redis 缓存",
    ]
    assert all(fact["id"] for fact in body["facts"])
    # 每条事实都标着它来自哪一轮——账本里点一条能跳回那一问（ADR-0002 的出处不变量）。
    assert all(fact["turn_id"] for fact in body["facts"])
    assert len({fact["turn_id"] for fact in body["facts"]}) == 1

    assert body["done"] is False
    assert body["question"]["id"] == "n2"
    assert body["question"]["text"] == TURN_N2["question"]["text"]
    # 树上剩 n2、n3，正在问 n2，所以还剩 1 个想挖的点。
    assert body["question"]["remaining"] == 1


def test_facts_accumulate_in_the_ledger_across_turns(tmp_path: Path) -> None:
    """账本是累加的：第二轮的事实不覆盖第一轮的。"""
    second_turn = {
        **TURN_N2,
        "facts": [{"text": "带过两个实习生半年", "source": "第 2 轮回答"}],
        "tree": [{"id": "n3", "topic": "线上事故处理", "why": "JD 要求 on-call"}],
        "question": {**TURN_N2["question"], "id": "n3", "text": "线上出过事故吗？"},
    }
    llm = ScriptedLlm(OPENING, TURN_N2, second_turn)
    with make_client(tmp_path, llm) as client:
        session_id = open_a_session(client)
        answer(client, session_id, "n1")
        answer(client, session_id, "n2", text="带过两个实习生")

        projection = client.get(f"/api/v1/grill/sessions/{session_id}").json()

    assert [fact["text"] for fact in projection["facts"]] == [
        "把 P99 从 800ms 压到 120ms",
        "手段是给热点查询加 Redis 缓存",
        "带过两个实习生半年",
    ]
    # 事实 id 全局唯一——账本里不能出现两条同 id 的事实。
    assert len({fact["id"] for fact in projection["facts"]}) == 3
    # 两轮的事实分属两个 turn_id。
    assert len({fact["turn_id"] for fact in projection["facts"]}) == 2


def test_facts_carry_the_absolute_round_they_came_from(tmp_path: Path) -> None:
    """账本上的「来自第 N 问」必须是绝对轮次。

    抽不出事实的一轮（用户答「想不起来」）在账本里不留痕迹，所以前端按落账
    顺序推算会数少——轮号只能由后端定死。
    """
    barren = {**TURN_N2, "facts": []}
    third = {
        **TURN_N2,
        "facts": [{"text": "第三轮才挖到的", "source": "第 3 轮回答"}],
        "tree": [{"id": "n3", "topic": "线上事故处理", "why": "JD 要求 on-call"}],
        "question": {**TURN_N2["question"], "id": "n3", "text": "线上出过事故吗？"},
    }
    llm = ScriptedLlm(OPENING, barren, third)
    with make_client(tmp_path, llm) as client:
        session_id = open_a_session(client)
        answer(client, session_id, "n1", text="想不起来了")   # 第 1 轮：颗粒无收
        response = answer(client, session_id, "n2", text="出过一次")  # 第 2 轮

    facts = response.json()["facts"]
    assert [fact["round"] for fact in facts] == [2]


def test_chosen_option_reaches_the_prompt(tmp_path: Path) -> None:
    """点了选项就把选项原文一起送进去——模型得知道用户认的是哪一种情况。"""
    llm = ScriptedLlm(OPENING, TURN_N2)
    with make_client(tmp_path, llm) as client:
        session_id = open_a_session(client)
        answer(client, session_id, "n1", text="对，就是这个", chosen_option="a")

    prompt = llm.prompt
    assert "对，就是这个" in prompt
    assert "加了缓存，把重复查询挡在数据库外面" in prompt  # OPENING 里选项 a 的原文


def test_free_form_answers_need_no_option(tmp_path: Path) -> None:
    """完全无视选项自由作答，同样能提交。"""
    llm = ScriptedLlm(OPENING, TURN_N2)
    with make_client(tmp_path, llm) as client:
        session_id = open_a_session(client)
        response = answer(client, session_id, "n1", text="都不是，我是重写了整个查询层")

    assert response.status_code == 200
    assert "重写了整个查询层" in llm.prompt


def test_the_turn_prompt_carries_the_tree_the_ledger_and_recent_turns(
    tmp_path: Path,
) -> None:
    """每轮上下文 = 树 + 账本 + 近 K 轮问答（工程评审裁决 13 的退化防护）。"""
    second_turn = {
        **TURN_N2,
        "facts": [{"text": "带过两个实习生半年", "source": "第 2 轮回答"}],
        "tree": [{"id": "n3", "topic": "线上事故处理", "why": "JD 要求 on-call"}],
        "question": {**TURN_N2["question"], "id": "n3", "text": "线上出过事故吗？"},
    }
    llm = ScriptedLlm(OPENING, TURN_N2, second_turn)
    with make_client(tmp_path, llm) as client:
        session_id = open_a_session(client)
        answer(client, session_id, "n1")
        answer(client, session_id, "n2", text="带过两个实习生")

    prompt = llm.prompt
    # 树：还没挖的点
    assert "线上事故处理" in prompt
    # 账本：已经挖到的事实——不能再问一遍
    assert "把 P99 从 800ms 压到 120ms" in prompt
    # 近 K 轮问答：上一题问了什么、用户怎么答的
    assert "带过两个实习生" in prompt
    # JD 一直在场：靶子不能中途丢
    assert "要求有性能调优经验" in prompt


# --- 收口 -------------------------------------------------------------------


def test_an_empty_tree_closes_the_session(tmp_path: Path) -> None:
    """树问空了这场就收口：done=true，question=null。"""
    llm = ScriptedLlm(OPENING, TURN_N2, turn_done())
    with make_client(tmp_path, llm) as client:
        session_id = open_a_session(client)
        answer(client, session_id, "n1")
        response = answer(client, session_id, "n2", text="带过两个实习生")

    assert response.status_code == 200
    body = response.json()
    assert body["done"] is True
    assert body["question"] is None
    # 收口那一轮抽到的事实照样入账本——收口不是丢掉最后一答。
    assert body["facts"]


def test_done_is_not_honoured_before_two_answered_turns(tmp_path: Path) -> None:
    """退化防护：模型第一轮就想收摊，不采纳——继续问树上的下一个点。

    模型偶尔会图省事，答了一题就报 done。少于两轮的拷问对用户没有价值，
    所以第一轮的 done 一律驳回，从树上另摘一题接着问。
    """
    premature = {**TURN_N2, "done": True}
    llm = ScriptedLlm(OPENING, premature)
    with make_client(tmp_path, llm) as client:
        session_id = open_a_session(client)
        response = answer(client, session_id, "n1")

    assert response.status_code == 200
    body = response.json()
    assert body["done"] is False
    assert body["question"] is not None
    assert body["question"]["id"] == "n2"


def test_done_before_two_turns_falls_back_to_the_tree_when_no_question_given(
    tmp_path: Path,
) -> None:
    """模型报 done 时通常连题都不给。不采纳 done 就得自己从树上摘一题，
    否则「不采纳」只是嘴上说说，用户还是走到了尽头。"""
    premature = {
        "facts": [{"text": "一条事实", "source": "回答"}],
        "tree": [{"id": "n2", "topic": "带没带过人", "why": "JD 要求 mentoring"}],
        "question": None,
        "done": True,
    }
    llm = ScriptedLlm(OPENING, premature)
    with make_client(tmp_path, llm) as client:
        session_id = open_a_session(client)
        response = answer(client, session_id, "n1")

    body = response.json()
    assert body["done"] is False
    assert body["question"] is not None
    assert body["question"]["id"] == "n2"
    assert body["question"]["text"]


def test_an_empty_tree_closes_even_before_two_turns(tmp_path: Path) -> None:
    """退化防护只驳回「模型自称 done」，不驳回「树真的空了」——
    树空了还硬编一题出来，就成了为凑轮数而问。"""
    llm = ScriptedLlm(OPENING, turn_done())
    with make_client(tmp_path, llm) as client:
        session_id = open_a_session(client)
        response = answer(client, session_id, "n1")

    body = response.json()
    assert body["done"] is True
    assert body["question"] is None


# --- 幂等与失败原子性 -------------------------------------------------------


def test_answering_the_same_question_twice_returns_409(tmp_path: Path) -> None:
    """作答幂等靠 question_id：已经答过的题再答一次是 409，不是又一轮。"""
    llm = ScriptedLlm(OPENING, TURN_N2)
    with make_client(tmp_path, llm) as client:
        session_id = open_a_session(client)
        answer(client, session_id, "n1")
        calls_before = len(llm.calls)
        response = answer(client, session_id, "n1", text="我再答一遍")

    assert response.status_code == 409
    # 重复作答不该再烧一次 LLM 调用。
    assert len(llm.calls) == calls_before


def test_the_409_body_carries_the_current_question(tmp_path: Path) -> None:
    """409 要带上当前状态，客户端据此对齐现场，不必再拉一次 GET。"""
    llm = ScriptedLlm(OPENING, TURN_N2)
    with make_client(tmp_path, llm) as client:
        session_id = open_a_session(client)
        answer(client, session_id, "n1")
        response = answer(client, session_id, "n1")

    detail = response.json()["detail"]
    assert detail["question"]["id"] == "n2"
    assert detail["done"] is False
    assert [fact["text"] for fact in detail["facts"]] == [
        "把 P99 从 800ms 压到 120ms",
        "手段是给热点查询加 Redis 缓存",
    ]


def test_a_stale_question_id_is_also_409(tmp_path: Path) -> None:
    """答的不是当前那道题（比如两个标签页各答各的），一样按冲突处理。"""
    llm = ScriptedLlm(OPENING, TURN_N2)
    with make_client(tmp_path, llm) as client:
        session_id = open_a_session(client)
        response = answer(client, session_id, "n9-不存在的题")

    assert response.status_code == 409


def test_an_llm_failure_leaves_the_session_untouched(tmp_path: Path) -> None:
    """失败原子性：LLM 抛错 → 502，会话一个字没变，同一答案可安全重发。"""
    llm = FlakyLlm(1, OPENING, TURN_N2)
    with make_client(tmp_path, llm) as client:
        session_id = open_a_session(client)
        before = client.get(f"/api/v1/grill/sessions/{session_id}").json()

        failed = answer(client, session_id, "n1")
        assert failed.status_code == 502

        after_failure = client.get(f"/api/v1/grill/sessions/{session_id}").json()
        assert after_failure == before

        # 重发同一答案：这次成功，事实不重复。
        retried = answer(client, session_id, "n1")
        assert retried.status_code == 200
        projection = client.get(f"/api/v1/grill/sessions/{session_id}").json()

    assert len(projection["facts"]) == 2
    assert projection["question"]["id"] == "n2"


def test_a_turn_without_facts_is_still_a_valid_turn(tmp_path: Path) -> None:
    """用户答「不知道」时抽不出事实是正常的——不该当失败，也不该卡在同一题。"""
    barren = {**TURN_N2, "facts": []}
    llm = ScriptedLlm(OPENING, barren)
    with make_client(tmp_path, llm) as client:
        session_id = open_a_session(client)
        response = answer(client, session_id, "n1", text="想不起来了")

    assert response.status_code == 200
    body = response.json()
    assert body["facts"] == []
    assert body["question"]["id"] == "n2"


def test_facts_without_a_source_are_dropped(tmp_path: Path) -> None:
    """ADR-0002 的出处不变量强制在事实的构造处：来源为空的事实不进账本。

    这里是「每句话有出处」在运行时唯一的硬关口——模型漏了 source 的那条，
    宁可丢掉，也不能让一条无出处的事实混进账本。
    """
    sloppy = {
        **TURN_N2,
        "facts": [
            {"text": "有出处的这条", "source": "第 1 轮回答"},
            {"text": "没出处的这条", "source": "   "},
            {"text": "连字段都没有的这条"},
        ],
    }
    llm = ScriptedLlm(OPENING, sloppy)
    with make_client(tmp_path, llm) as client:
        session_id = open_a_session(client)
        response = answer(client, session_id, "n1")

    assert [fact["text"] for fact in response.json()["facts"]] == ["有出处的这条"]


def test_answering_a_missing_session_returns_404(tmp_path: Path) -> None:
    llm = ScriptedLlm(OPENING, TURN_N2)
    with make_client(tmp_path, llm) as client:
        response = answer(client, "00000000-0000-0000-0000-0000000000aa", "n1")

    assert response.status_code == 404


def test_a_session_belonging_to_another_user_is_not_answerable(tmp_path: Path) -> None:
    """会话 id 是 uuid，但不能光靠猜不中来当访问控制。"""
    llm = ScriptedLlm(OPENING, TURN_N2)
    with make_client(tmp_path, llm) as client:
        session_id = open_a_session(client)
        response = client.post(
            f"/api/v1/grill/sessions/{session_id}/answers",
            json={"question_id": "n1", "answer_text": "答案", "chosen_option": None},
            headers={"X-User-Id": "00000000-0000-0000-0000-0000000000ff"},
        )

    assert response.status_code == 404


def test_an_empty_answer_is_rejected(tmp_path: Path) -> None:
    """空答案没有可抽的事实，也没有可追问的抓手——别浪费一次 LLM 调用。"""
    llm = ScriptedLlm(OPENING, TURN_N2)
    with make_client(tmp_path, llm) as client:
        session_id = open_a_session(client)
        calls_before = len(llm.calls)
        response = answer(client, session_id, "n1", text="   ")
        assert len(llm.calls) == calls_before

    assert response.status_code == 400


def test_answering_a_closed_session_returns_409(tmp_path: Path) -> None:
    """已经收口的会话不再接受作答。"""
    llm = ScriptedLlm(OPENING, TURN_N2, turn_done())
    with make_client(tmp_path, llm) as client:
        session_id = open_a_session(client)
        answer(client, session_id, "n1")
        answer(client, session_id, "n2", text="带过两个实习生")
        response = answer(client, session_id, "n3", text="还想再答")

    assert response.status_code == 409
    assert response.json()["detail"]["done"] is True


# --- 「够了」中断 -----------------------------------------------------------


def test_stopping_early_closes_the_session(tmp_path: Path) -> None:
    """「够了，去改写」把中断写进服务端——不能只在前端把屏幕切走。"""
    llm = ScriptedLlm(OPENING, TURN_N2)
    with make_client(tmp_path, llm) as client:
        session_id = open_a_session(client)
        response = client.post(f"/api/v1/grill/sessions/{session_id}/stop")

    assert response.status_code == 200
    body = response.json()
    assert body["done"] is True
    assert body["question"] is None


def test_a_stopped_session_stays_stopped_after_a_refresh(tmp_path: Path) -> None:
    """中断必须活在投影里。否则刷新一次，用户就被送回他刚走开的那道题。"""
    llm = ScriptedLlm(OPENING, TURN_N2)
    with make_client(tmp_path, llm) as client:
        session_id = open_a_session(client)
        answer(client, session_id, "n1")
        client.post(f"/api/v1/grill/sessions/{session_id}/stop")
        projection = client.get(f"/api/v1/grill/sessions/{session_id}").json()

    assert projection["done"] is True
    assert projection["question"] is None
    # 账本留着——改写那一片要用。中断不是放弃已经挖到的东西。
    assert len(projection["facts"]) == 2
    assert projection["answered_count"] == 1


def test_the_projection_says_how_the_session_closed(tmp_path: Path) -> None:
    """「问到底了」和「你叫停了」对用户是两件事，文案不同——所以投影得说清是哪一种。"""
    llm = ScriptedLlm(OPENING, TURN_N2, turn_done())
    with make_client(tmp_path, llm) as client:
        stopped = open_a_session(client)
        client.post(f"/api/v1/grill/sessions/{stopped}/stop")
        assert client.get(f"/api/v1/grill/sessions/{stopped}").json()["closed_by"] == "stopped"

        exhausted = open_a_session(client)
        answer(client, exhausted, "n1")
        answer(client, exhausted, "n2", text="带过两个实习生")
        projection = client.get(f"/api/v1/grill/sessions/{exhausted}").json()

    assert projection["closed_by"] == "exhausted"


def test_a_stopped_session_refuses_further_answers(tmp_path: Path) -> None:
    llm = ScriptedLlm(OPENING, TURN_N2)
    with make_client(tmp_path, llm) as client:
        session_id = open_a_session(client)
        client.post(f"/api/v1/grill/sessions/{session_id}/stop")
        response = answer(client, session_id, "n1")

    assert response.status_code == 409


def test_stopping_twice_is_idempotent(tmp_path: Path) -> None:
    """双击、重发都会走到这里——第二次不该报错。"""
    llm = ScriptedLlm(OPENING, TURN_N2)
    with make_client(tmp_path, llm) as client:
        session_id = open_a_session(client)
        client.post(f"/api/v1/grill/sessions/{session_id}/stop")
        response = client.post(f"/api/v1/grill/sessions/{session_id}/stop")

    assert response.status_code == 200
    assert response.json()["done"] is True


def test_stopping_a_missing_session_returns_404(tmp_path: Path) -> None:
    llm = ScriptedLlm(OPENING, TURN_N2)
    with make_client(tmp_path, llm) as client:
        response = client.post(
            "/api/v1/grill/sessions/00000000-0000-0000-0000-0000000000aa/stop"
        )

    assert response.status_code == 404


def test_another_users_session_cannot_be_stopped(tmp_path: Path) -> None:
    llm = ScriptedLlm(OPENING, TURN_N2)
    with make_client(tmp_path, llm) as client:
        session_id = open_a_session(client)
        response = client.post(
            f"/api/v1/grill/sessions/{session_id}/stop",
            headers={"X-User-Id": "00000000-0000-0000-0000-0000000000ff"},
        )

    assert response.status_code == 404


def test_resending_an_answer_after_a_successful_turn_is_a_conflict(
    tmp_path: Path,
) -> None:
    """真正危险的重发：响应已经发出，客户端没收到就重发。

    这一次会话确实变了（题已经推进），所以按 409 处理——重发不能变成第二轮，
    也不能把同一答案的事实再抽一遍。客户端拿 409 带回的状态对齐即可。
    """
    llm = ScriptedLlm(OPENING, TURN_N2)
    with make_client(tmp_path, llm) as client:
        session_id = open_a_session(client)
        answer(client, session_id, "n1")
        resent = answer(client, session_id, "n1")
        projection = client.get(f"/api/v1/grill/sessions/{session_id}").json()

    assert resent.status_code == 409
    # 事实没有被抽第二遍。
    assert len(projection["facts"]) == 2


# --- 会话恢复（GET 投影）----------------------------------------------------


def test_the_projection_restores_the_whole_scene(tmp_path: Path) -> None:
    """刷新页面后前端只拿这一个响应，就得把现场原样重画出来。"""
    llm = ScriptedLlm(OPENING, TURN_N2)
    with make_client(tmp_path, llm) as client:
        session_id = open_a_session(client)
        answer(client, session_id, "n1")
        response = client.get(f"/api/v1/grill/sessions/{session_id}")

    assert response.status_code == 200
    body = response.json()
    assert body["session_id"] == session_id
    assert body["baseline_crumb_id"]
    assert body["jd_text"] == "要求有性能调优经验，能带人"
    assert body["done"] is False
    assert body["question"]["id"] == "n2"
    assert len(body["facts"]) == 2
    # 已答轮数：前端拿它决定「够了」按钮说什么、第几问的编号从哪起。
    assert body["answered_count"] == 1


def test_the_projection_of_a_fresh_session_has_an_empty_ledger(tmp_path: Path) -> None:
    llm = ScriptedLlm(OPENING, TURN_N2)
    with make_client(tmp_path, llm) as client:
        session_id = open_a_session(client)
        body = client.get(f"/api/v1/grill/sessions/{session_id}").json()

    assert body["facts"] == []
    assert body["answered_count"] == 0
    assert body["question"]["id"] == "n1"


def test_a_missing_session_projection_is_404(tmp_path: Path) -> None:
    """后端重启丢会话走的就是这条——前端据此给「重开一场」提示。"""
    llm = ScriptedLlm(OPENING, TURN_N2)
    with make_client(tmp_path, llm) as client:
        response = client.get("/api/v1/grill/sessions/00000000-0000-0000-0000-0000000000aa")

    assert response.status_code == 404


def test_another_users_session_projection_is_404(tmp_path: Path) -> None:
    llm = ScriptedLlm(OPENING, TURN_N2)
    with make_client(tmp_path, llm) as client:
        session_id = open_a_session(client)
        response = client.get(
            f"/api/v1/grill/sessions/{session_id}",
            headers={"X-User-Id": "00000000-0000-0000-0000-0000000000ff"},
        )

    assert response.status_code == 404


def test_the_projection_does_not_ship_the_crumb_bodies_back(tmp_path: Path) -> None:
    """投影是给前端重画现场用的，不是把料再发一遍——料前端已经有了（读全局
    store）。问题卡里引用简历原话是另一回事，那是拷问该干的。"""
    llm = ScriptedLlm(OPENING, TURN_N2)
    with make_client(tmp_path, llm) as client:
        session_id = open_a_session(client)
        body = client.get(f"/api/v1/grill/sessions/{session_id}").json()

    assert "crumbs" not in body
    assert "crumb_ids" not in body
    # 树是模型的 scratchpad，不是给用户看的：透出去等于剧透接下来要问什么。
    assert "tree" not in body


# --- 剧本 demo 不受影响 -----------------------------------------------------


def test_scripted_demo_endpoints_are_untouched(tmp_path: Path) -> None:
    llm = ScriptedLlm(OPENING, TURN_N2)
    with make_client(tmp_path, llm) as client:
        assert client.get("/api/health").json() == {"status": "ok"}
        assert client.get("/api/v1/crumbs").json() == {"crumbs": []}
