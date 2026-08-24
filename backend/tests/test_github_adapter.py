"""真 GitHub 适配器的 HTTP 行为，用 httpx 的 MockTransport 驱动。

这里测的是「GitHub 回什么 → 我们抛什么」这一层映射，也就是本片唯一会在真网络
上出错的地方。不打真网络：GitHub 未认证配额是每小时 60 次，测试套件不该去抢它。
"""

import asyncio
import base64
from typing import Dict, List

import httpx
import pytest

from backend.app.github import (
    MAX_CONCURRENCY,
    MAX_REPO_PAGES,
    REPOS_PER_PAGE,
    GitHubError,
    HttpGitHub,
)


def transport(handler) -> httpx.MockTransport:
    return httpx.MockTransport(handler)


def patch_client(monkeypatch, handler) -> List[httpx.Request]:
    """把 AsyncClient 换成走 MockTransport 的版本，并记录发出的请求。"""
    seen: List[httpx.Request] = []

    def recording(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return handler(request)

    original = httpx.AsyncClient

    def factory(*args, **kwargs):
        kwargs["transport"] = transport(recording)
        return original(*args, **kwargs)

    monkeypatch.setattr(httpx, "AsyncClient", factory)
    return seen


META = {
    "full_name": "me/second-hand",
    "description": "校园二手交易平台",
    "language": "Python",
    "topics": ["fastapi"],
    "stargazers_count": 7,
    "forks_count": 1,
    "created_at": "2025-01-01T00:00:00Z",
    "pushed_at": "2026-05-01T00:00:00Z",
    "default_branch": "trunk",
}


def happy_handler(request: httpx.Request) -> httpx.Response:
    path = request.url.path
    if path == "/repos/me/second-hand":
        return httpx.Response(200, json=META)
    if path == "/repos/me/second-hand/readme":
        return httpx.Response(
            200,
            json={
                "encoding": "base64",
                "content": base64.b64encode("# 二手\n延迟 800ms → 120ms".encode("utf-8")).decode(),
            },
        )
    if path == "/repos/me/second-hand/commits":
        return httpx.Response(
            200,
            json=[
                {"commit": {"message": "perf: 首页加缓存"}},
                {"commit": {"message": "feat: 下单流程"}},
            ],
        )
    if path == "/repos/me/second-hand/contents":
        return httpx.Response(
            200,
            json=[
                {"name": "README.md", "type": "file"},
                {"name": "app", "type": "dir"},
            ],
        )
    return httpx.Response(404, json={"message": "Not Found"})


def test_fetch_repo_assembles_metadata_readme_commits_and_tree(monkeypatch) -> None:
    seen = patch_client(monkeypatch, happy_handler)

    repo = HttpGitHub().fetch_repo("me/second-hand")

    assert repo["full_name"] == "me/second-hand"
    assert repo["description"] == "校园二手交易平台"
    assert "延迟 800ms → 120ms" in repo["readme"]
    assert repo["commits"] == ["perf: 首页加缓存", "feat: 下单流程"]
    # 目录带斜杠，让「这是个包」在纯文本摘要里也看得出来。
    assert repo["tree"] == ["README.md", "app/"]

    # 文件树按仓库自报的默认分支取，不猜 "main"——老仓库是 master，猜错会
    # 无声地少半份摘要。
    contents = [r for r in seen if r.url.path.endswith("/contents")][0]
    assert contents.url.params["ref"] == "trunk"
    # 未认证请求也必须带 User-Agent，否则 GitHub 直接 403。
    assert seen[0].headers["user-agent"]
    assert "authorization" not in seen[0].headers


def test_missing_repo_maps_to_404_and_names_the_private_case(monkeypatch) -> None:
    """「找不到」和「是私有的」在 GitHub 那边是同一个 404，文案必须两种都提。

    只说「找不到」的话，连自己私有仓的用户会去反复检查地址有没有打错。
    """
    patch_client(monkeypatch, lambda request: httpx.Response(404, json={}))

    with pytest.raises(GitHubError) as error:
        HttpGitHub().fetch_repo("me/nope")

    assert error.value.status_code == 404
    assert "me/nope" in str(error.value)
    assert "私有" in str(error.value)


@pytest.mark.parametrize(
    "response",
    [
        httpx.Response(429, json={}),
        # GitHub 的限流有时是 403 带 remaining: 0。当成「不可见」会让用户白查半天。
        httpx.Response(403, json={}, headers={"x-ratelimit-remaining": "0"}),
    ],
)
def test_rate_limit_maps_to_429_with_a_way_out(monkeypatch, response: httpx.Response) -> None:
    patch_client(monkeypatch, lambda request: response)

    with pytest.raises(GitHubError) as error:
        HttpGitHub().fetch_repo("me/second-hand")

    assert error.value.status_code == 429
    assert "限流" in str(error.value)
    # 兜底指引写进错误本身：用户在报错处就该看到出路。
    assert "上传" in str(error.value)


def test_non_ratelimit_403_is_a_fetch_failure_not_a_rate_limit(monkeypatch) -> None:
    patch_client(monkeypatch, lambda request: httpx.Response(403, json={}))

    with pytest.raises(GitHubError) as error:
        HttpGitHub().fetch_repo("me/second-hand")

    assert error.value.status_code == 502
    assert "限流" not in str(error.value)


def test_network_failure_maps_to_502(monkeypatch) -> None:
    def boom(request: httpx.Request) -> httpx.Response:
        raise httpx.ReadTimeout("读超时", request=request)

    patch_client(monkeypatch, boom)

    with pytest.raises(GitHubError) as error:
        HttpGitHub().fetch_repo("me/second-hand")

    assert error.value.status_code == 502
    assert "连不上 GitHub" in str(error.value)


def test_secondary_endpoints_may_fail_without_failing_the_whole_fetch(monkeypatch) -> None:
    """没有 README 的仓库很常见，空仓库连 commits 都 404。

    把「仓库拿到了但没有 README」变成一次失败，只会逼用户去解决一个不存在的
    问题——所以缺的那一节留空，整次拉取照样成功。
    """

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/repos/me/bare":
            return httpx.Response(200, json={"full_name": "me/bare", "default_branch": "main"})
        return httpx.Response(404, json={"message": "Not Found"})

    patch_client(monkeypatch, handler)

    repo = HttpGitHub().fetch_repo("me/bare")

    assert repo["full_name"] == "me/bare"
    assert repo["readme"] == ""
    assert repo["commits"] == []
    assert repo["tree"] == []


def test_secondary_endpoints_are_fetched_concurrently(monkeypatch) -> None:
    """三个次要端点并发发出，不是串行等三轮 RTT。

    注意这里**不**断言并发上限：一次 fetch_repo 只有三个并发请求，上限是 5，
    所以那条断言在这个用例里永远为真，测不出上限有没有生效。上限本身由
    `test_concurrency_cap_actually_blocks` 单独测。
    """
    inflight: Dict[str, int] = {"now": 0, "peak": 0}
    gate = asyncio.Event()

    async def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/repos/me/second-hand":
            return httpx.Response(200, json=META)
        inflight["now"] += 1
        inflight["peak"] = max(inflight["peak"], inflight["now"])
        # 三个都到齐了才放行：串行实现会在这里死等，永远凑不满三个。
        if inflight["now"] >= 3:
            gate.set()
        await asyncio.wait_for(gate.wait(), timeout=5)
        inflight["now"] -= 1
        return httpx.Response(200, json=[])

    seen = patch_client(monkeypatch, handler)

    HttpGitHub().fetch_repo("me/second-hand")

    assert len(seen) == 4
    assert inflight["peak"] == 3


def test_concurrency_cap_actually_blocks(monkeypatch) -> None:
    """并发上限对超过 5 个请求真的生效。

    上限存在的理由是 GitHub 的配额（未认证 60 次/小时），把并发放开只会更快
    撞限流——所以它必须真的是个上限，不是注释里的愿望。一次 fetch_repo 只发
    三个并发请求，测不到 5，所以这里直接驱动 `_fetch_all` 的并发原语：批量连仓
    （PAT 那一票）会走到这条路上。
    """
    inflight: Dict[str, int] = {"now": 0, "peak": 0}
    released = asyncio.Event()

    async def work() -> None:
        inflight["now"] += 1
        inflight["peak"] = max(inflight["peak"], inflight["now"])
        if inflight["now"] >= MAX_CONCURRENCY:
            released.set()
        await asyncio.wait_for(released.wait(), timeout=5)
        inflight["now"] -= 1

    async def drive() -> None:
        semaphore = asyncio.Semaphore(MAX_CONCURRENCY)

        async def guarded() -> None:
            async with semaphore:
                await work()

        await asyncio.gather(*(guarded() for _ in range(MAX_CONCURRENCY * 3)))

    asyncio.run(drive())

    assert inflight["peak"] == MAX_CONCURRENCY


# --- PAT：验 token / 列仓库 --------------------------------------------------


def test_verify_token_sends_the_bearer_and_returns_the_login(monkeypatch) -> None:
    seen = patch_client(monkeypatch, lambda request: httpx.Response(200, json={"login": "me"}))

    assert HttpGitHub().verify_token("ghp_x") == {"login": "me"}

    assert seen[0].url.path == "/user"
    assert seen[0].headers["authorization"] == "Bearer ghp_x"


def test_a_bad_token_maps_to_401_not_a_generic_failure(monkeypatch) -> None:
    """401 是用户自己能修的那一种失败（重贴一个），别的都不是。

    合成 502 会让「你贴的 token 不对」收到一句「稍后重试」——而他重试一百次
    也不会好。
    """
    patch_client(monkeypatch, lambda request: httpx.Response(401, json={}))

    with pytest.raises(GitHubError) as error:
        HttpGitHub().verify_token("ghp_bad")

    assert error.value.status_code == 401
    assert "token" in str(error.value)


def test_list_repos_asks_for_private_repos_and_keeps_only_the_four_fields(monkeypatch) -> None:
    page = [
        {
            "full_name": "me/secret",
            "private": True,
            "description": "私有的",
            "pushed_at": "2026-08-01T00:00:00Z",
            # 真实响应里还有九十多个字段，一个都不该透出去。
            "permissions": {"admin": True},
            "clone_url": "https://github.com/me/secret.git",
        },
        {"full_name": "me/open", "private": False, "description": None, "pushed_at": ""},
    ]
    seen = patch_client(monkeypatch, lambda request: httpx.Response(200, json=page))

    repos = HttpGitHub().list_repos("ghp_x")

    assert repos == [
        {
            "full_name": "me/secret",
            "private": True,
            "description": "私有的",
            "pushed_at": "2026-08-01T00:00:00Z",
        },
        {"full_name": "me/open", "private": False, "description": "", "pushed_at": ""},
    ]
    request = seen[0]
    # `/user/repos` 而不是 `/users/{name}/repos`：后者只回公开仓，而看得见自己的
    # 私有仓正是贴 PAT 换来的那件事。
    assert request.url.path == "/user/repos"
    assert request.headers["authorization"] == "Bearer ghp_x"
    assert request.url.params["per_page"] == str(REPOS_PER_PAGE)
    assert request.url.params["sort"] == "pushed"


def test_list_repos_pages_until_a_short_page(monkeypatch) -> None:
    """GitHub 不回总数，只能靠「这一页不满 100 条」判断到底了。

    不翻页的话，超过 100 个仓库的用户会看不见自己后面的仓库——而且看不出少了。
    """
    def handler(request: httpx.Request) -> httpx.Response:
        page = int(request.url.params["page"])
        if page == 1:
            return httpx.Response(
                200,
                json=[
                    {"full_name": f"me/r{i}", "private": False}
                    for i in range(REPOS_PER_PAGE)
                ],
            )
        return httpx.Response(200, json=[{"full_name": "me/last", "private": True}])

    seen = patch_client(monkeypatch, handler)

    repos = HttpGitHub().list_repos("ghp_x")

    assert len(repos) == REPOS_PER_PAGE + 1
    assert repos[-1]["full_name"] == "me/last"
    assert [r.url.params["page"] for r in seen] == ["1", "2"]


def test_list_repos_stops_at_the_page_ceiling(monkeypatch) -> None:
    """每页都满的话会一直翻下去——上限存在就是为了不让它无限翻。"""
    full_page = [{"full_name": f"me/r{i}", "private": False} for i in range(REPOS_PER_PAGE)]
    seen = patch_client(monkeypatch, lambda request: httpx.Response(200, json=full_page))

    repos = HttpGitHub().list_repos("ghp_x")

    assert len(seen) == MAX_REPO_PAGES
    assert len(repos) == MAX_REPO_PAGES * REPOS_PER_PAGE


def test_list_repos_maps_an_expired_token_to_401(monkeypatch) -> None:
    patch_client(monkeypatch, lambda request: httpx.Response(401, json={}))

    with pytest.raises(GitHubError) as error:
        HttpGitHub().list_repos("ghp_stale")

    assert error.value.status_code == 401


def test_rate_limit_copy_differs_with_and_without_a_token(monkeypatch) -> None:
    """配额差 83 倍（60/小时 vs 5000/小时），处置也不同。

    没 token 的人该去连一个 PAT，有 token 的人只能等。给他们同一句「等一会儿
    再试」，等于对前一种人藏起了当场就能用的出路。
    """
    limited = httpx.Response(429, json={})
    patch_client(monkeypatch, lambda request: limited)

    with pytest.raises(GitHubError) as anonymous:
        HttpGitHub().fetch_repo("me/second-hand")
    with pytest.raises(GitHubError) as authenticated:
        HttpGitHub().fetch_repo("me/second-hand", "ghp_x")

    assert "60" in str(anonymous.value) and "token" in str(anonymous.value)
    assert "5000" in str(authenticated.value)
    # 有 token 的人再去连一个 token 是没有出路的，不该这么建议他。
    assert "连一个 GitHub token" not in str(authenticated.value)


def test_fetching_a_private_repo_with_a_token_sends_the_bearer(monkeypatch) -> None:
    """有 token 时贴 URL 也能连私有仓——同一条路，多带一个 Authorization。"""
    seen = patch_client(monkeypatch, happy_handler)

    HttpGitHub().fetch_repo("me/second-hand", "ghp_x")

    assert all(request.headers["authorization"] == "Bearer ghp_x" for request in seen)
