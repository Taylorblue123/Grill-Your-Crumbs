"""GitHub 适配器。

接缝（#23）定义的接口在这里有了第一个真实现：`fetch_repo` 拉单个仓库的元数据、
README、近期 commit 与顶层文件树。`list_repos`（需要 token 的私有仓列表）仍是
占位——那是 PAT 那一票的事，没有调用方的实现无从验证。
"""

import asyncio
from typing import Any, Dict, List, Optional, Protocol

import httpx

from .repos import COMMIT_LIMIT, commit_messages, decode_readme, tree_paths


API_ROOT = "https://api.github.com"

# 一个仓库要打四个端点（元数据 / README / commits / 文件树）。上限 5 是工程
# 评审的裁决：GitHub 未认证配额是每小时 60 次，把并发放开只会更快撞限流，
# 而串行等四轮 RTT 又没必要。
MAX_CONCURRENCY = 5
TIMEOUT_SECONDS = 20.0


class GitHubError(RuntimeError):
    """GitHub 拉取失败（限流、网络、不可见）。

    `status_code` 是**给 HTTP 层看的映射结果**，不是 GitHub 原样回的码：404
    照转 404（仓库不存在或不可见），429 照转（限流），其余一律 502（我们这边
    没能替用户把料拿到，不是用户请求的错）。
    """

    def __init__(self, message: str, status_code: Optional[int] = None):
        super().__init__(message)
        self.status_code = status_code


class GitHub(Protocol):
    """应用工厂注入的 GitHub 适配器接口。"""

    def list_repos(self, token: str) -> List[Dict[str, Any]]:
        """列出 token 可见的全部仓库（含私有）。"""
        ...

    def fetch_repo(self, full_name: str, token: Optional[str] = None) -> Dict[str, Any]:
        """拉取单个仓库的元数据、README、近期 commits 与顶层文件树。"""
        ...


def _headers(token: Optional[str]) -> Dict[str, str]:
    headers = {
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        # GitHub 对没有 User-Agent 的请求直接 403。
        "User-Agent": "grill-your-crumbs",
    }
    if token:
        headers["Authorization"] = f"Bearer {token}"
    return headers


def _rate_limited(response: httpx.Response) -> bool:
    """这次 403/429 是限流吗？

    GitHub 的限流有时回 429，有时回 403 带 `x-ratelimit-remaining: 0`。两者对
    用户是同一件事（「等一会儿再来」），但如果把限流的 403 当成「仓库不可见」，
    用户会去检查仓库是不是私有的——查了半天，其实只要等。
    """
    if response.status_code == 429:
        return True
    return response.status_code == 403 and response.headers.get("x-ratelimit-remaining") == "0"


def _raise_for_status(response: httpx.Response, full_name: str) -> None:
    if response.status_code == 404:
        raise GitHubError(
            f"找不到仓库 {full_name}。它可能不存在，或者是私有仓——公开仓才能这样连。",
            status_code=404,
        )
    if _rate_limited(response):
        raise GitHubError(
            "GitHub 限流了（未登录状态每小时只有 60 次请求）。等一会儿再试，"
            "或者先把 README 当文件上传。",
            status_code=429,
        )
    if response.status_code >= 400:
        raise GitHubError(
            f"GitHub 返回 {response.status_code}，没能拉到 {full_name}。",
            status_code=502,
        )


class HttpGitHub:
    """真实现：httpx.AsyncClient，并发上限 `MAX_CONCURRENCY`。"""

    def __init__(self, timeout_seconds: float = TIMEOUT_SECONDS):
        self.timeout_seconds = timeout_seconds

    def list_repos(self, token: str) -> List[Dict[str, Any]]:
        raise NotImplementedError("GitHub repo listing lands with the PAT slice")

    def fetch_repo(self, full_name: str, token: Optional[str] = None) -> Dict[str, Any]:
        """同步入口，内部并发拉四个端点。

        接口是同步的（端点函数是 `def`，跑在 FastAPI 的线程池里），并发只是这
        一次拉取内部的实现细节——所以自己起 event loop，而不是把 async 泄漏
        到调用方去。
        """
        return asyncio.run(self._fetch(full_name, token))

    async def _fetch(self, full_name: str, token: Optional[str]) -> Dict[str, Any]:
        limits = httpx.Limits(max_connections=MAX_CONCURRENCY)
        semaphore = asyncio.Semaphore(MAX_CONCURRENCY)
        async with httpx.AsyncClient(
            base_url=API_ROOT,
            headers=_headers(token),
            timeout=self.timeout_seconds,
            follow_redirects=True,
            limits=limits,
        ) as client:

            async def get(path: str, **params: Any) -> httpx.Response:
                async with semaphore:
                    try:
                        return await client.get(path, params=params or None)
                    except httpx.HTTPError as error:
                        raise GitHubError(
                            f"连不上 GitHub：{error}", status_code=502
                        ) from error

            # 元数据先单独拉：它决定仓库到底存不存在，也给出默认分支——文件树
            # 要按分支取，猜 "main" 会在老仓库（master）上无声地少半份摘要。
            meta_response = await get(f"/repos/{full_name}")
            _raise_for_status(meta_response, full_name)
            meta = meta_response.json()
            branch = meta.get("default_branch") or "HEAD"

            readme, commits, tree = await asyncio.gather(
                get(f"/repos/{full_name}/readme"),
                get(f"/repos/{full_name}/commits", per_page=COMMIT_LIMIT),
                get(f"/repos/{full_name}/contents", ref=branch),
            )

        return {
            "full_name": meta.get("full_name") or full_name,
            "description": meta.get("description") or "",
            "language": meta.get("language") or "",
            "topics": meta.get("topics") or [],
            "stargazers_count": meta.get("stargazers_count") or 0,
            "forks_count": meta.get("forks_count") or 0,
            "created_at": meta.get("created_at") or "",
            "pushed_at": meta.get("pushed_at") or "",
            # 次要端点任一失败都不该让整次连仓失败：没有 README 的仓库很常见，
            # 空仓库连 commits 都是 404。缺的那一节摘要里不出现就是了——把「仓库
            # 拿到了但没有 README」变成一次失败，只会逼用户去解决一个不存在的问题。
            "readme": decode_readme(_json_or_none(readme)),
            "commits": commit_messages(_json_or_none(commits)),
            "tree": tree_paths(_json_or_none(tree)),
        }


def _json_or_none(response: httpx.Response) -> Any:
    """次要端点的响应 → 解好的 JSON，拿不到（4xx/5xx 或不是 JSON）就 None。"""
    if response.status_code >= 400:
        return None
    try:
        return response.json()
    except ValueError:
        return None
