"""PAT 三件套的 HTTP 行为：存 token → 列仓库 → 批量拉取。

全程走注入的假 GitHub 适配器——不打真网络，也不需要一个真 PAT。

本文件最重要的两组断言不在「功能对不对」上：
- **token 不落任何地方**（`test_the_token_never_reaches_the_mirror_or_the_database`）
- **一项失败不带走整批**（`test_a_batch_reports_each_repo_separately`）
前者是本票的红线，后者是逐项包络存在的全部理由。
"""

import json
import threading
import time
from pathlib import Path
from typing import Any, Dict, List, Optional

from fastapi.testclient import TestClient

from backend.app.config import LlmSettings, Settings
from backend.app.github import MAX_CONCURRENCY, GitHubError
from backend.app.main import MAX_BATCH_REPOS, create_app


DEMO_USER = "00000000-0000-0000-0000-000000000001"
TOKEN = "ghp_averyrealisticlookingtoken123456"

REPO = {
    "full_name": "me/second-hand",
    "description": "校园二手交易平台",
    "readme": "# 二手\n把首页延迟从 800ms 降到 120ms。",
    "commits": ["perf: 首页加缓存"],
    "tree": ["README.md"],
}
PRIVATE_REPO = {
    "full_name": "me/secret",
    "description": "还没开源的那个",
    "readme": "# 内部项目\n把结算耗时从 3s 压到 400ms。",
    "commits": ["perf: 结算批处理"],
    "tree": ["README.md"],
}

LISTING = [
    {
        "full_name": "me/secret",
        "private": True,
        "description": "还没开源的那个",
        "pushed_at": "2026-08-20T00:00:00Z",
    },
    {
        "full_name": "me/second-hand",
        "private": False,
        "description": "校园二手交易平台",
        "pushed_at": "2026-08-01T00:00:00Z",
    },
]


class FakeGitHub:
    """假 GitHub：记下每次调用带的 token，好断言「有 token 时确实带上了」。"""

    def __init__(
        self,
        repos: Optional[Dict[str, Dict[str, Any]]] = None,
        listing: Optional[List[Dict[str, Any]]] = None,
        verify_error: Optional[Exception] = None,
        list_error: Optional[Exception] = None,
        errors: Optional[Dict[str, Exception]] = None,
    ):
        self.repos = repos or {}
        self.listing = listing if listing is not None else list(LISTING)
        self.verify_error = verify_error
        self.list_error = list_error
        self.errors = errors or {}
        self.fetched: List[tuple] = []
        self.verified: List[str] = []
        self.listed: List[str] = []

    def verify_token(self, token: str) -> Dict[str, Any]:
        self.verified.append(token)
        if self.verify_error is not None:
            raise self.verify_error
        return {"login": "me"}

    def list_repos(self, token: str) -> List[Dict[str, Any]]:
        self.listed.append(token)
        if self.list_error is not None:
            raise self.list_error
        return self.listing

    def fetch_repo(self, full_name: str, token: Optional[str] = None) -> Dict[str, Any]:
        self.fetched.append((full_name, token))
        if full_name in self.errors:
            raise self.errors[full_name]
        if full_name not in self.repos:
            raise GitHubError(f"找不到仓库 {full_name}。", status_code=404)
        # 私有仓没 token 拉不到——这正是 PAT 换来的那件事，假实现也得守住，
        # 否则「有 token 时贴 URL 可连私有仓」这条断言是假的。
        if self.repos[full_name].get("_private") and not token:
            raise GitHubError(f"找不到仓库 {full_name}。", status_code=404)
        return {k: v for k, v in self.repos[full_name].items() if k != "_private"}


def make_settings(tmp_path: Path) -> Settings:
    tmp_path.mkdir(parents=True, exist_ok=True)
    prototype = tmp_path / "demo.html"
    prototype.write_text("<h1>demo</h1>", encoding="utf-8")
    return Settings(
        database_path=tmp_path / "grill.db",
        upload_dir=tmp_path / "uploads",
        prototype_path=prototype,
        frontend_dist=tmp_path / "frontend-dist",
        session_mirror_path=tmp_path / "data" / "grill-sessions.json",
        demo_user_id=DEMO_USER,
        llm=LlmSettings(api_key="test-key", model="test-model", base_url=None),
    )


def make_client(tmp_path: Path, github: Any) -> TestClient:
    return TestClient(create_app(make_settings(tmp_path), github=github))


def paste_token(client: TestClient, token: str = TOKEN):
    return client.post("/api/v1/github/token", json={"token": token})


# --- token ------------------------------------------------------------------


def test_pasting_a_token_verifies_it_and_reports_whose_it_is(tmp_path: Path) -> None:
    github = FakeGitHub()
    with make_client(tmp_path, github) as client:
        response = paste_token(client)

        assert response.status_code == 200
        body = response.json()
        assert body == {"connected": True, "login": "me"}
        # 存之前先验：贴错的 token 要在贴完的那一刻就报错，不是等到拉列表时。
        assert github.verified == [TOKEN]


def test_the_response_never_echoes_the_token_back(tmp_path: Path) -> None:
    """回显没有任何用处（前端已经知道自己刚贴了什么），只是多一条走漏路径。"""
    with make_client(tmp_path, FakeGitHub()) as client:
        body = paste_token(client).text

        assert TOKEN not in body
        # 连尾四位都不回。
        assert TOKEN[-4:] not in body


def test_a_rejected_token_is_a_401_and_is_not_stored(tmp_path: Path) -> None:
    github = FakeGitHub(verify_error=GitHubError("GitHub 不认这个 token。", status_code=401))
    with make_client(tmp_path, github) as client:
        response = paste_token(client, "ghp_bad")

        assert response.status_code == 401
        assert "token" in response.json()["detail"]
        # 没存下来：接下来拉列表仍然是「还没连 GitHub」，不是「token 失效」。
        listed = client.get("/api/v1/github/repos")
        assert listed.status_code == 401
        assert github.listed == []


def test_a_verification_outage_is_a_502_not_a_401(tmp_path: Path) -> None:
    """「GitHub 连不上」和「你的 token 不对」是两件事。

    合成 401 会让一个 token 完全正确的用户去反复重贴——而问题根本不在他那边。
    """
    github = FakeGitHub(verify_error=GitHubError("连不上 GitHub：读超时", status_code=502))
    with make_client(tmp_path, github) as client:
        assert paste_token(client).status_code == 502


def test_an_empty_token_disconnects(tmp_path: Path) -> None:
    """空串是「断开连接」。这条路不打 GitHub——断开不需要 GitHub 同意。"""
    github = FakeGitHub()
    with make_client(tmp_path, github) as client:
        paste_token(client)
        response = paste_token(client, "")

        assert response.status_code == 200
        assert response.json() == {"connected": False, "login": None}
        assert github.verified == [TOKEN]  # 第二次没去验
        assert client.get("/api/v1/github/repos").status_code == 401


def test_tokens_are_scoped_to_the_user(tmp_path: Path) -> None:
    """另一个用户不该借到我的 token 去看我的私有仓。"""
    other = "00000000-0000-0000-0000-000000000002"
    github = FakeGitHub()
    with make_client(tmp_path, github) as client:
        paste_token(client)

        theirs = client.get("/api/v1/github/repos", headers={"X-User-Id": other})

        assert theirs.status_code == 401


# --- 仓库列表 ---------------------------------------------------------------


def test_the_repo_list_shows_private_repos_and_marks_them(tmp_path: Path) -> None:
    github = FakeGitHub()
    with make_client(tmp_path, github) as client:
        paste_token(client)

        response = client.get("/api/v1/github/repos")

        assert response.status_code == 200
        body = response.json()
        assert body["truncated"] is False
        assert body["repos"] == [
            {
                "full_name": "me/secret",
                "private": True,
                "description": "还没开源的那个",
                "pushed_at": "2026-08-20T00:00:00Z",
            },
            {
                "full_name": "me/second-hand",
                "private": False,
                "description": "校园二手交易平台",
                "pushed_at": "2026-08-01T00:00:00Z",
            },
        ]
        # 列表是用存下来的那个 token 拉的，不是前端又贴了一次。
        assert github.listed == [TOKEN]


def test_listing_without_a_token_is_a_401_not_an_empty_list(tmp_path: Path) -> None:
    """空列表会让前端画「你没有仓库」的空态，而真相是「你还没连 GitHub」。

    两者的出路完全不同：一个要去 GitHub 建仓库，一个只要贴个 token。
    """
    with make_client(tmp_path, FakeGitHub()) as client:
        response = client.get("/api/v1/github/repos")

        assert response.status_code == 401
        assert "Personal Access Token" in response.json()["detail"]


def test_a_token_revoked_after_connecting_is_dropped_on_the_spot(tmp_path: Path) -> None:
    """token 在 GitHub 那边被撤销了。留着它只会让接下来每一次拉取都撞同一堵墙。"""
    github = FakeGitHub(list_error=GitHubError("GitHub 不认这个 token。", status_code=401))
    with make_client(tmp_path, github) as client:
        paste_token(client)

        assert client.get("/api/v1/github/repos").status_code == 401

        # 已经清掉了：下一次仍是 401，但适配器不会再被白白调用一次。
        before = len(github.listed)
        assert client.get("/api/v1/github/repos").status_code == 401
        assert len(github.listed) == before


def test_rate_limited_listing_keeps_the_token_and_says_to_wait(tmp_path: Path) -> None:
    """限流不是 token 的错——清掉它会让用户以为自己白连了。"""
    github = FakeGitHub(list_error=GitHubError("GitHub 限流了，等一会儿再试。", status_code=429))
    with make_client(tmp_path, github) as client:
        paste_token(client)

        response = client.get("/api/v1/github/repos")

        assert response.status_code == 429
        assert "限流" in response.json()["detail"]

        # token 还在：换成不限流之后，用户不必重贴。
        github.list_error = None
        assert client.get("/api/v1/github/repos").status_code == 200


# --- 批量拉取 ---------------------------------------------------------------


def test_selecting_several_repos_creates_one_crumb_each(tmp_path: Path) -> None:
    github = FakeGitHub({"me/second-hand": REPO, "me/secret": PRIVATE_REPO})
    with make_client(tmp_path, github) as client:
        paste_token(client)

        response = client.post(
            "/api/v1/repos", json={"full_names": ["me/secret", "me/second-hand"]}
        )

        assert response.status_code == 200
        results = response.json()["results"]
        assert [(r["full_name"], r["ok"]) for r in results] == [
            ("me/secret", True),
            ("me/second-hand", True),
        ]
        assert "把结算耗时从 3s 压到 400ms。" in results[0]["crumb"]["content"]

        # 料列表里两份 repo 料都在，于是能被勾选进场。
        listed = client.get("/api/v1/crumbs").json()["crumbs"]
        assert sorted(c["display_name"] for c in listed) == ["me/second-hand", "me/secret"]
        assert all(c["kind"] == "repo" for c in listed)

        # 批量拉取用的是存下来的 token——否则私有那个根本拉不到。
        assert github.fetched == [("me/secret", TOKEN), ("me/second-hand", TOKEN)]


def test_a_batch_reports_each_repo_separately(tmp_path: Path) -> None:
    """**部分失败不影响其余入库。**

    这是逐项包络存在的全部理由：勾了五个仓库，其中一个被限流、一个不存在，
    另外三个已经拉到的料不该跟着一起丢掉，而每个失败项要说清自己失败在哪。
    """
    github = FakeGitHub(
        {"me/second-hand": REPO, "me/secret": PRIVATE_REPO},
        errors={
            "me/limited": GitHubError("GitHub 限流了，等一会儿再试。", status_code=429),
            "me/boom": RuntimeError("解析响应炸了"),
        },
    )
    with make_client(tmp_path, github) as client:
        paste_token(client)

        results = client.post(
            "/api/v1/repos",
            json={
                "full_names": [
                    "me/second-hand",
                    "me/limited",
                    "me/gone",
                    "me/boom",
                    "me/secret",
                ]
            },
        ).json()["results"]

        assert [(r["full_name"], r["ok"], r["error_kind"]) for r in results] == [
            ("me/second-hand", True, None),
            ("me/limited", False, "rate_limit"),
            ("me/gone", False, "not_found"),
            ("me/boom", False, "fetch_failed"),
            ("me/secret", True, None),
        ]
        # 每个失败项都带着自己的那句话，不是共用一句「失败了」。
        assert "限流" in results[1]["error"]
        assert "me/gone" in results[2]["error"]
        assert "解析响应炸了" in results[3]["error"]

        # 成功的两个照常入库。
        listed = client.get("/api/v1/crumbs").json()["crumbs"]
        assert sorted(c["display_name"] for c in listed) == ["me/second-hand", "me/secret"]


def test_a_malformed_name_fails_alone_instead_of_taking_the_batch_down(tmp_path: Path) -> None:
    github = FakeGitHub({"me/second-hand": REPO})
    with make_client(tmp_path, github) as client:
        results = client.post(
            "/api/v1/repos", json={"full_names": ["不是个仓库名", "me/second-hand"]}
        ).json()["results"]

        assert results[0]["ok"] is False
        assert results[0]["error_kind"] == "bad_name"
        assert results[1]["ok"] is True
        # 形状不对的那个不该浪费一次 GitHub 配额。
        assert [name for name, _ in github.fetched] == ["me/second-hand"]


def test_the_same_repo_twice_in_one_batch_is_fetched_once(tmp_path: Path) -> None:
    """否则第二次是 upsert 掉自己刚建的那份——白打一轮请求，前端还收到两条同名料。"""
    github = FakeGitHub({"me/second-hand": REPO})
    with make_client(tmp_path, github) as client:
        results = client.post(
            "/api/v1/repos", json={"full_names": ["me/second-hand", "me/second-hand"]}
        ).json()["results"]

        assert len(results) == 1
        assert len(github.fetched) == 1


def test_an_oversized_batch_reports_the_overflow_instead_of_dropping_it(tmp_path: Path) -> None:
    """静默丢掉超出的部分，用户会以为它们都连上了。"""
    names = [f"me/r{i}" for i in range(MAX_BATCH_REPOS + 3)]
    github = FakeGitHub({name: {**REPO, "full_name": name} for name in names})
    with make_client(tmp_path, github) as client:
        results = client.post("/api/v1/repos", json={"full_names": names}).json()["results"]

        assert len(results) == len(names)
        assert all(r["ok"] for r in results[:MAX_BATCH_REPOS])
        overflow = results[MAX_BATCH_REPOS:]
        assert all(r["ok"] is False for r in overflow)
        assert str(MAX_BATCH_REPOS) in overflow[0]["error"]
        assert len(github.fetched) == MAX_BATCH_REPOS


def test_a_batch_fetches_concurrently_but_never_past_the_cap(tmp_path: Path) -> None:
    """**并发上限 5。**

    串行跑 20 个仓库就是 80 次 GitHub 往返排成一队——一个请求几分钟不返回，
    用户早以为页面卡死了。但并发再高也只是更快撞限流，所以要的是「并发，且
    有上限」，两头都得断言：真的重叠了（不是串行），且峰值没越过上限。
    """
    names = [f"me/r{i}" for i in range(12)]

    lock = threading.Lock()
    live = {"now": 0, "peak": 0}

    class SlowGitHub(FakeGitHub):
        def fetch_repo(self, full_name, token=None):
            with lock:
                live["now"] += 1
                live["peak"] = max(live["peak"], live["now"])
            try:
                # 每次拉取都慢一点，好让重叠真的发生——瞬间返回的话，峰值可能
                # 只是因为线程还没来得及起，测不出并发。
                time.sleep(0.02)
                return super().fetch_repo(full_name, token)
            finally:
                with lock:
                    live["now"] -= 1

    github = SlowGitHub({name: {**REPO, "full_name": name} for name in names})
    with make_client(tmp_path, github) as client:
        results = client.post("/api/v1/repos", json={"full_names": names}).json()["results"]

    assert all(r["ok"] for r in results)
    assert live["peak"] > 1, "拉取是串行的——20 个仓库会排成 80 次往返"
    assert live["peak"] <= MAX_CONCURRENCY, f"并发峰值 {live['peak']} 越过了上限"


def test_batch_results_come_back_in_the_order_they_were_asked_for(tmp_path: Path) -> None:
    """并发拉取的完成顺序是乱的，但结果不能跟着乱。

    用户勾选的顺序就是他阅读结果的顺序；按完成先后返回会让同一次操作每次长得
    不一样，「哪个没连上」也就每次都要重新找一遍。
    """
    names = [f"me/r{i}" for i in range(8)]

    class JitteryGitHub(FakeGitHub):
        def fetch_repo(self, full_name, token=None):
            # 后面的仓库反而先返回，把完成顺序彻底打乱。
            time.sleep(0.03 - 0.003 * int(full_name.rsplit("r", 1)[1]))
            return super().fetch_repo(full_name, token)

    github = JitteryGitHub({name: {**REPO, "full_name": name} for name in names})
    with make_client(tmp_path, github) as client:
        results = client.post("/api/v1/repos", json={"full_names": names}).json()["results"]

    assert [r["full_name"] for r in results] == names


def test_giving_both_a_url_and_full_names_is_a_400(tmp_path: Path) -> None:
    """请求本身不合法：不存在「哪一项失败了」，逐项包络没有主键可用。"""
    with make_client(tmp_path, FakeGitHub()) as client:
        for body in (
            {"url": "me/second-hand", "full_names": ["me/secret"]},
            {},
            {"full_names": []},
        ):
            response = client.post("/api/v1/repos", json=body)
            assert response.status_code == 400, body


# --- 有 token 时贴 URL 也能连私有仓 -------------------------------------------


def test_pasting_a_private_repo_url_works_once_a_token_is_connected(tmp_path: Path) -> None:
    """用户已经授权过了，还要求他为私有仓换一个入口是没有道理的。"""
    github = FakeGitHub({"me/secret": {**PRIVATE_REPO, "_private": True}})
    with make_client(tmp_path, github) as client:
        # 没 token 时私有仓是 404（GitHub 对不可见的仓库就是这么回的）。
        before = client.post(
            "/api/v1/repos", json={"url": "https://github.com/me/secret"}
        ).json()["results"][0]
        assert before["ok"] is False
        assert before["error_kind"] == "not_found"

        paste_token(client)

        after = client.post(
            "/api/v1/repos", json={"url": "https://github.com/me/secret"}
        ).json()["results"][0]

        assert after["ok"] is True
        assert after["crumb"]["display_name"] == "me/secret"
        assert "把结算耗时从 3s 压到 400ms。" in after["crumb"]["content"]
        # 第二次带上了 token，第一次没有。
        assert github.fetched == [("me/secret", None), ("me/secret", TOKEN)]


# --- 红线：token 不落任何地方 -------------------------------------------------


def test_the_token_never_reaches_the_mirror_or_the_database(tmp_path: Path) -> None:
    """**本票的红线。**

    走完整条链（贴 token → 列仓库 → 批量拉取 → 开一场拷问），然后把 data/ 下
    每一个字节翻一遍：token 一次都不该出现。

    翻的是**整个目录**而不是「我知道会写的那几个文件」——红线的意义正在于挡住
    我没想到的那条写入路径。
    """
    from backend.app.grill import open_session  # noqa: F401  确认拷问那条路存在

    class ScriptedLlm:
        def complete(self, *, messages, schema_name, schema):
            return {
                "tree": [{"id": "t1", "topic": "性能", "why": "JD 要求"}],
                "question": {
                    "id": "t1",
                    "text": "800ms 怎么测的？",
                    "why": "README 只写了结果",
                    "options": [{"key": "A", "text": "压测"}],
                    "recommended": {"key": "A", "reason": "最常见"},
                },
            }

    github = FakeGitHub({"me/secret": PRIVATE_REPO})
    settings = make_settings(tmp_path)
    with TestClient(create_app(settings, llm=ScriptedLlm(), github=github)) as client:
        paste_token(client)
        client.get("/api/v1/github/repos")
        repo_crumb = client.post(
            "/api/v1/repos", json={"full_names": ["me/secret"]}
        ).json()["results"][0]["crumb"]
        resume = client.post(
            "/api/v1/attachments",
            data={"kind": "resume"},
            files={"file": ("resume.txt", "王小明，后端实习。", "text/plain")},
        ).json()["crumb"]
        client.post(
            "/api/v1/grill/sessions",
            json={"jd_text": "要求性能优化经验。", "crumb_ids": [repo_crumb["id"], resume["id"]]},
        )

    written = [path for path in tmp_path.rglob("*") if path.is_file()]
    # 确实写了东西——不然这个测试是在为一个空目录叫好。
    assert any(path.suffix == ".db" for path in written)
    assert settings.session_mirror_path.exists()

    for path in written:
        blob = path.read_bytes()
        assert TOKEN.encode() not in blob, path
        # 前缀也不该在：即使被切过、被编码过，`ghp_` 出现就值得看一眼。
        assert b"ghp_" not in blob, path


def test_a_token_pasted_into_an_answer_is_scrubbed_from_the_mirror(tmp_path: Path) -> None:
    """兜底那一道：用户完全可能把 PAT 贴进作答框，而那是自由文本，不是凭据字段。"""
    from backend.app.sessions import GrillSessionStore

    mirror = tmp_path / "data" / "grill-sessions.json"
    store = GrillSessionStore(mirror)
    store.create(history=[{"answer": f"我的 token 是 {TOKEN}，你自己看吧"}])

    blob = mirror.read_text(encoding="utf-8")

    assert TOKEN not in blob
    assert "[redacted]" in blob
    # 只吃掉 token 本身，紧跟着的中文正文一个字不动。
    assert "你自己看吧" in json.loads(blob).__str__()
