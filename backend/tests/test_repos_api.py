"""POST /api/v1/repos 的 HTTP 行为：建库、upsert、逐项包络、四种错误码。

全程走注入的假 GitHub 适配器——不打真网络，不吃 GitHub 的 60 次/小时配额。
"""

from pathlib import Path
from typing import Any, Dict, List, Optional

from fastapi.testclient import TestClient

from backend.app.config import LlmSettings, Settings
from backend.app.github import GitHubError
from backend.app.main import create_app


DEMO_USER = "00000000-0000-0000-0000-000000000001"

REPO = {
    "full_name": "me/second-hand",
    "description": "校园二手交易平台",
    "language": "Python",
    "topics": ["fastapi"],
    "readme": "# 二手\n把首页延迟从 800ms 降到 120ms。",
    "commits": ["perf: 首页加缓存", "feat: 下单流程"],
    "tree": ["README.md", "app/"],
}


class FakeGitHub:
    """假 GitHub：按 full_name 返回预设结果，或抛预设的失败。"""

    def __init__(
        self,
        repos: Optional[Dict[str, Dict[str, Any]]] = None,
        error: Optional[Exception] = None,
    ):
        self.repos = repos or {}
        self.error = error
        self.fetched: List[str] = []

    def list_repos(self, token: str):
        return []

    def fetch_repo(self, full_name: str, token: Optional[str] = None) -> Dict[str, Any]:
        self.fetched.append(full_name)
        if self.error is not None:
            raise self.error
        if full_name not in self.repos:
            raise GitHubError(f"找不到仓库 {full_name}。", status_code=404)
        return self.repos[full_name]


def make_client(tmp_path: Path, github: Any) -> TestClient:
    # 每个用例各要一个干净的库，同一个用例里也可能要好几个（每种失败一个），
    # 所以接受 tmp_path 的任意子目录，不假设它已经存在。
    tmp_path.mkdir(parents=True, exist_ok=True)
    prototype = tmp_path / "demo.html"
    prototype.write_text("<h1>demo</h1>", encoding="utf-8")
    settings = Settings(
        database_path=tmp_path / "grill.db",
        upload_dir=tmp_path / "uploads",
        prototype_path=prototype,
        frontend_dist=tmp_path / "frontend-dist",
        session_mirror_path=tmp_path / "data" / "grill-sessions.json",
        demo_user_id=DEMO_USER,
        llm=LlmSettings(api_key="test-key", model="test-model", base_url=None),
    )
    return TestClient(create_app(settings, github=github))


def connect(client: TestClient, url: str):
    return client.post("/api/v1/repos", json={"url": url})


# --- 建库 -------------------------------------------------------------------


def test_pasting_a_public_repo_url_creates_a_repo_crumb(tmp_path: Path) -> None:
    github = FakeGitHub({"me/second-hand": REPO})
    with make_client(tmp_path, github) as client:
        response = connect(client, "https://github.com/me/second-hand")

        assert response.status_code == 200
        # 逐项包络：即使只连一个仓库，结果也装在 results 里。
        results = response.json()["results"]
        assert len(results) == 1
        result = results[0]
        assert result["full_name"] == "me/second-hand"
        assert result["ok"] is True
        assert result["updated"] is False
        assert result["error"] is None

        crumb = result["crumb"]
        assert crumb["kind"] == "repo"
        assert crumb["display_name"] == "me/second-hand"
        # 摘要必须真的含 README / commits / 文件树，这是本票的验收点。
        assert "把首页延迟从 800ms 降到 120ms。" in crumb["content"]
        assert "perf: 首页加缓存" in crumb["content"]
        assert "README.md" in crumb["content"]

        # 料列表里看得见，于是能被勾选进场。
        listed = client.get("/api/v1/crumbs").json()["crumbs"]
        assert [(c["id"], c["kind"]) for c in listed] == [(crumb["id"], "repo")]

        # URL 的各种形态都归一到同一个 full_name。
        assert github.fetched == ["me/second-hand"]


def test_repo_crumb_can_be_selected_into_a_grill_session(tmp_path: Path) -> None:
    """repo 料能进场并被拷问引用——料的正文原样出现在给 LLM 的 prompt 里。"""

    class RecordingLlm:
        def __init__(self):
            self.messages: List[Any] = []

        def complete(self, *, messages, schema_name, schema):
            self.messages.append(messages)
            return {
                "tree": [{"id": "t1", "topic": "性能优化怎么做的", "why": "JD 要求"}],
                "question": {
                    "id": "t1",
                    "text": "800ms 是怎么测出来的？",
                    "why": "仓库 README 只写了结果",
                    "options": [{"key": "A", "text": "压测"}],
                    "recommended": {"key": "A", "reason": "最常见"},
                },
            }

    llm = RecordingLlm()
    github = FakeGitHub({"me/second-hand": REPO})
    prototype = tmp_path / "demo.html"
    prototype.write_text("<h1>demo</h1>", encoding="utf-8")
    settings = Settings(
        database_path=tmp_path / "grill.db",
        upload_dir=tmp_path / "uploads",
        prototype_path=prototype,
        frontend_dist=tmp_path / "frontend-dist",
        session_mirror_path=tmp_path / "data" / "grill-sessions.json",
        demo_user_id=DEMO_USER,
        llm=LlmSettings(api_key="k", model="m", base_url=None),
    )
    with TestClient(create_app(settings, llm=llm, github=github)) as client:
        repo_crumb = connect(client, "github.com/me/second-hand").json()["results"][0]["crumb"]
        resume = client.post(
            "/api/v1/attachments",
            data={"kind": "resume"},
            files={"file": ("resume.txt", "王小明，后端实习。", "text/plain")},
        ).json()["crumb"]

        opened = client.post(
            "/api/v1/grill/sessions",
            json={
                "jd_text": "要求有性能优化经验。",
                "crumb_ids": [repo_crumb["id"], resume["id"]],
            },
        )

        assert opened.status_code == 201
        prompt = "\n".join(str(m) for m in llm.messages[0])
        assert "me/second-hand" in prompt
        assert "把首页延迟从 800ms 降到 120ms。" in prompt


# --- upsert -----------------------------------------------------------------


def test_refetching_the_same_repo_replaces_the_old_crumb(tmp_path: Path) -> None:
    """同 full_name 重拉是 upsert，不是新建也不是「重复料」。

    内容变了（新 commit），按 content_hash 去重会当成一份新料，于是同一个仓库
    在列表里堆成两条——所以这里断言的是「列表仍然只有一条，且内容是新的」。
    """
    github = FakeGitHub({"me/second-hand": dict(REPO)})
    with make_client(tmp_path, github) as client:
        first = connect(client, "https://github.com/me/second-hand").json()["results"][0]

        github.repos["me/second-hand"] = {
            **REPO,
            "commits": ["feat: 新加的一条", *REPO["commits"]],
        }
        second = connect(client, "https://github.com/me/second-hand.git").json()["results"][0]

        assert first["updated"] is False
        assert second["ok"] is True
        assert second["updated"] is True
        assert second["crumb"]["id"] != first["crumb"]["id"]
        assert "feat: 新加的一条" in second["crumb"]["content"]

        listed = client.get("/api/v1/crumbs").json()["crumbs"]
        assert [c["id"] for c in listed] == [second["crumb"]["id"]]


def test_identical_refetch_still_upserts_instead_of_reporting_a_duplicate(tmp_path: Path) -> None:
    """内容一字未变的重拉也走 upsert：仓库没变不是一种失败。"""
    github = FakeGitHub({"me/second-hand": REPO})
    with make_client(tmp_path, github) as client:
        connect(client, "https://github.com/me/second-hand")
        again = connect(client, "https://github.com/me/second-hand").json()["results"][0]

        assert again["ok"] is True
        assert again["updated"] is True
        assert len(client.get("/api/v1/crumbs").json()["crumbs"]) == 1


def test_upsert_is_scoped_to_the_user(tmp_path: Path) -> None:
    """另一个用户连同一个仓库，建的是他自己的料，不会顶掉别人的。"""
    other = "00000000-0000-0000-0000-000000000002"
    github = FakeGitHub({"me/second-hand": REPO})
    with make_client(tmp_path, github) as client:
        mine = connect(client, "me/second-hand").json()["results"][0]
        theirs = client.post(
            "/api/v1/repos",
            json={"url": "me/second-hand"},
            headers={"X-User-Id": other},
        ).json()["results"][0]

        assert theirs["updated"] is False
        assert theirs["crumb"]["id"] != mine["crumb"]["id"]
        assert len(client.get("/api/v1/crumbs").json()["crumbs"]) == 1


# --- 错误分区 ---------------------------------------------------------------


def test_unparseable_url_is_a_400_on_the_request_itself(tmp_path: Path) -> None:
    """URL 认不出时连 full_name 都填不出来，逐项包络没有主键可用——所以 400。"""
    github = FakeGitHub({})
    with make_client(tmp_path, github) as client:
        for bad in ["", "https://gitlab.com/me/repo", "随便打的一串"]:
            response = connect(client, bad)
            assert response.status_code == 400, bad
            assert isinstance(response.json()["detail"], str)
        # 明显非法的输入不该浪费一次 GitHub 配额。
        assert github.fetched == []


def test_missing_or_private_repo_reports_404_in_the_envelope(tmp_path: Path) -> None:
    github = FakeGitHub({})
    with make_client(tmp_path, github) as client:
        result = connect(client, "https://github.com/me/nope").json()["results"][0]

        assert result["ok"] is False
        assert result["crumb"] is None
        # 适配器给的具体失败原样透出，不被包络吞成一句「失败了」。
        assert "me/nope" in result["error"]
        assert result["error_kind"] == "not_found"


def test_rate_limit_reports_a_wait_and_a_way_out(tmp_path: Path) -> None:
    github = FakeGitHub(error=GitHubError("GitHub 限流了，等一会儿再试。", status_code=429))
    with make_client(tmp_path, github) as client:
        result = connect(client, "me/second-hand").json()["results"][0]

        assert result["ok"] is False
        assert "限流" in result["error"]
        # 种类必须活下来：限流是「等会儿重试」，404 是「重试也没用」。
        assert result["error_kind"] == "rate_limit"


def test_fetch_failure_reports_the_concrete_error(tmp_path: Path) -> None:
    github = FakeGitHub(error=GitHubError("连不上 GitHub：读超时", status_code=502))
    with make_client(tmp_path, github) as client:
        result = connect(client, "me/second-hand").json()["results"][0]

        assert result["ok"] is False
        assert "连不上 GitHub" in result["error"]
        assert result["error_kind"] == "fetch_failed"
        assert client.get("/api/v1/crumbs").json() == {"crumbs": []}


def test_unexpected_adapter_failure_stays_inside_the_envelope(tmp_path: Path) -> None:
    """适配器抛的不是 GitHubError 也只是这一项失败，不该变成 500。"""
    github = FakeGitHub(error=RuntimeError("解析响应炸了"))
    with make_client(tmp_path, github) as client:
        response = connect(client, "me/second-hand")

        assert response.status_code == 200
        result = response.json()["results"][0]
        assert result["ok"] is False
        assert "解析响应炸了" in result["error"]
        assert result["error_kind"] == "fetch_failed"


def test_empty_repo_is_rejected_instead_of_becoming_a_hollow_crumb(tmp_path: Path) -> None:
    github = FakeGitHub({"me/empty": {"full_name": "me/empty", "readme": "", "commits": [], "tree": []}})
    with make_client(tmp_path, github) as client:
        result = connect(client, "me/empty").json()["results"][0]

        assert result["ok"] is False
        assert "没有可拷问的内容" in result["error"]
        # 空仓库不给「把 README 当文件上传」的出路——它根本没有 README。
        assert result["error_kind"] == "empty"
        assert client.get("/api/v1/crumbs").json() == {"crumbs": []}

def test_every_failure_kind_is_distinguishable_at_the_http_layer(tmp_path: Path) -> None:
    """四种失败在包络里必须分得开。

    整个响应是 200，HTTP 状态码这条通路已经被逐项包络占掉了——所以如果
    `error_kind` 不存在，调用方只剩一个中文字符串可看。批量连仓时「限流了，等
    会儿重试」和「这个仓不存在，重试也没用」是两种完全不同的处置，靠对文案做
    子串匹配来区分是不可接受的。
    """
    cases = {
        "not_found": GitHubError("找不到仓库。", status_code=404),
        "rate_limit": GitHubError("GitHub 限流了。", status_code=429),
        "fetch_failed": GitHubError("连不上 GitHub。", status_code=502),
    }
    seen = {}
    for kind, error in cases.items():
        with make_client(tmp_path / kind, FakeGitHub(error=error)) as client:
            result = connect(client, "me/second-hand").json()["results"][0]
            assert response_is_200_envelope(result)
            seen[kind] = result["error_kind"]

    assert seen == {k: k for k in cases}


def response_is_200_envelope(result: Dict[str, Any]) -> bool:
    return result["ok"] is False and result["crumb"] is None


def test_connecting_a_repo_whose_summary_already_exists_returns_that_crumb(tmp_path: Path) -> None:
    """摘要和已有的一份料一字不差时，交回已有的那份，不报错。

    用户先把 README 当文件上传、再来连仓库，就会撞上 content_hash 的唯一约束。
    报错会把人堵死：除了先去删掉那份上传，他没有任何操作能脱困——而上传那条路
    遇到同样的情况是返回已有的料（`duplicate: true`）。两条路的语义得对齐。
    """
    github = FakeGitHub({"me/second-hand": REPO})
    with make_client(tmp_path, github) as client:
        # 先连一次，拿到摘要原文。
        first = connect(client, "me/second-hand").json()["results"][0]["crumb"]
        summary = first["content"]
        # 把它删掉，再作为一份**上传的文件**重新进库——于是仓库料的位置空着，
        # 但同样内容的哈希已经被另一份料占了。
        assert client.delete(f"/api/v1/crumbs/{first['id']}").status_code == 204
        uploaded = client.post(
            "/api/v1/attachments",
            data={"kind": "notes"},
            files={"file": ("readme.md", summary, "text/markdown")},
        ).json()["crumb"]

        again = connect(client, "me/second-hand").json()["results"][0]

        assert again["ok"] is True
        assert again["error"] is None
        # 交回的是已经在库里的那一份，不是新建的。
        assert again["crumb"]["id"] == uploaded["id"]
        assert again["updated"] is False
        assert len(client.get("/api/v1/crumbs").json()["crumbs"]) == 1
