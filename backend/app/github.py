"""GitHub 适配器。

接缝（#23）定义的接口在这里有了两个真实现：`fetch_repo` 拉单个仓库的元数据、
README、近期 commit 与顶层文件树；`list_repos` 用 PAT 列出 token 可见的全部
仓库（含私有仓）。

**token 只从参数进，不从这一层的环境里读。** 适配器不知道 token 存在哪、活多久
——那是 `tokens.TokenStore` 的事。这样「PAT 不落日志」只需要在一个地方成立。
"""

import asyncio
from typing import Any, Dict, List, Optional, Protocol

import httpx

from .repos import COMMIT_LIMIT, commit_messages, decode_readme, repo_listing, tree_paths


API_ROOT = "https://api.github.com"

# 一个仓库要打四个端点（元数据 / README / commits / 文件树）。上限 5 是工程
# 评审的裁决：GitHub 未认证配额是每小时 60 次，把并发放开只会更快撞限流，
# 而串行等四轮 RTT 又没必要。
MAX_CONCURRENCY = 5
TIMEOUT_SECONDS = 20.0

# 列表一页 100 条（GitHub 的上限），最多翻 10 页。上限存在的理由是「1000 个仓库
# 的列表已经没人挑得动」，不是性能——翻到底的用户会看见明说的截断提示，而不是
# 悄悄少掉一半。
REPOS_PER_PAGE = 100
MAX_REPO_PAGES = 10


class GitHubError(RuntimeError):
    """GitHub 拉取失败（限流、网络、不可见）。

    `status_code` 是**给 HTTP 层看的映射结果**，不是 GitHub 原样回的码：404
    照转 404（仓库不存在或不可见），429 照转（限流），401 照转（token 无效或
    过期——这一种用户自己能修，别的都不能），其余一律 502（我们这边没能替用户
    把料拿到，不是用户请求的错）。
    """

    def __init__(self, message: str, status_code: Optional[int] = None):
        super().__init__(message)
        self.status_code = status_code


class GitHub(Protocol):
    """应用工厂注入的 GitHub 适配器接口。"""

    def verify_token(self, token: str) -> Dict[str, Any]:
        """这个 token 能用吗？能用就回它属于谁（`{login}`），不能用就抛。"""
        ...

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


def _rate_limit_message(token: Optional[str]) -> str:
    """限流文案分带 token / 不带两种。

    配额差了 83 倍（未登录 60/小时，PAT 5000/小时），处置也不同：没 token 的人
    该去连一个 PAT，有 token 的人只能等。给他们同一句「等一会儿再试」，等于对
    前一种人藏起了当场就能用的出路。
    """
    if token:
        return (
            "GitHub 限流了（已登录状态每小时 5000 次请求，这轮用完了）。"
            "等一会儿再试，或者先把 README 当文件上传。"
        )
    return (
        "GitHub 限流了（未登录状态每小时只有 60 次请求）。连一个 GitHub token "
        "能把配额提到 5000 次，或者等一会儿再试，也可以先把 README 当文件上传。"
    )


def _raise_for_status(
    response: httpx.Response, full_name: str, token: Optional[str] = None
) -> None:
    if response.status_code == 401:
        raise GitHubError(
            "GitHub 不认这个 token（无效或已过期）。重新贴一个有 repo 读权限的 "
            "Personal Access Token。",
            status_code=401,
        )
    if response.status_code == 404:
        # 带着 token 还 404，「是不是私有仓」这条线索就没用了——token 本来就能看见
        # 私有仓。这时更可能是地址打错，或者这个 token 的权限没覆盖到它。
        if token:
            raise GitHubError(
                f"找不到仓库 {full_name}。地址可能打错了，或者这个 token 的权限"
                "没覆盖到它（细粒度 token 要显式勾选仓库）。",
                status_code=404,
            )
        raise GitHubError(
            f"找不到仓库 {full_name}。它可能不存在，或者是私有仓——连一个 GitHub "
            "token 就能拉私有仓。",
            status_code=404,
        )
    if _rate_limited(response):
        raise GitHubError(_rate_limit_message(token), status_code=429)
    if response.status_code >= 400:
        raise GitHubError(
            f"GitHub 返回 {response.status_code}，没能拉到 {full_name}。",
            status_code=502,
        )


class HttpGitHub:
    """真实现：httpx.AsyncClient，并发上限 `MAX_CONCURRENCY`。"""

    def __init__(self, timeout_seconds: float = TIMEOUT_SECONDS):
        self.timeout_seconds = timeout_seconds

    def verify_token(self, token: str) -> Dict[str, Any]:
        """打一次 `/user` 验 token，回 `{login}`。

        存之前先验，是为了让「token 贴错了」这个错误出现在用户刚贴完的那一刻，
        而不是下一步拉列表时——那时的报错指向的是列表，不是 token。
        """
        return asyncio.run(self._verify(token))

    async def _verify(self, token: str) -> Dict[str, Any]:
        async with httpx.AsyncClient(
            base_url=API_ROOT,
            headers=_headers(token),
            timeout=self.timeout_seconds,
            follow_redirects=True,
        ) as client:
            try:
                response = await client.get("/user")
            except httpx.HTTPError as error:
                raise GitHubError(f"连不上 GitHub：{error}", status_code=502) from error

        _raise_for_status(response, "你的 GitHub 账号", token)
        try:
            payload = response.json()
        except ValueError as error:
            raise GitHubError("GitHub 回的账号信息解析不了。", status_code=502) from error
        if not isinstance(payload, dict):
            raise GitHubError("GitHub 回的账号信息形状不对。", status_code=502)
        return {"login": payload.get("login") or ""}

    def list_repos(self, token: str) -> List[Dict[str, Any]]:
        """token 可见的全部仓库（含私有），按最近推送排序。

        `/user/repos` 而不是 `/users/{name}/repos`：后者只回公开仓，而「看得见
        自己的私有仓」正是贴 PAT 换来的那件事。
        """
        return asyncio.run(self._list(token))

    async def _list(self, token: str) -> List[Dict[str, Any]]:
        repos: List[Dict[str, Any]] = []
        async with httpx.AsyncClient(
            base_url=API_ROOT,
            headers=_headers(token),
            timeout=self.timeout_seconds,
            follow_redirects=True,
            limits=httpx.Limits(max_connections=MAX_CONCURRENCY),
        ) as client:
            # 分页是串行的，不是并发：GitHub 不回总数，只能靠「这一页不满 100 条」
            # 判断到底了。并发翻页得先猜页数，猜多了白打请求（还烧配额），猜少了
            # 漏仓库。
            for page in range(1, MAX_REPO_PAGES + 1):
                try:
                    response = await client.get(
                        "/user/repos",
                        params={
                            "per_page": REPOS_PER_PAGE,
                            "page": page,
                            # affiliation 显式写死。默认值还含 organization_member
                            # ——组织里所有人都能看见的仓库，对大公司的员工是成百上千
                            # 个和他本人无关的仓，挑选列表会被彻底淹掉。
                            #
                            # 代价是**看得见但不是自己的**组织仓不在列表里。那不是死路：
                            # 贴 URL 那条路照样能连（有 token 时私有的也行）。用一条兜底
                            # 通路，换一个还挑得动的列表。
                            "affiliation": "owner,collaborator",
                            "sort": "pushed",
                            "direction": "desc",
                        },
                    )
                except httpx.HTTPError as error:
                    raise GitHubError(f"连不上 GitHub：{error}", status_code=502) from error

                _raise_for_status(response, "你的仓库列表", token)
                try:
                    payload = response.json()
                except ValueError as error:
                    raise GitHubError(
                        "GitHub 回的仓库列表解析不了。", status_code=502
                    ) from error
                if not isinstance(payload, list):
                    raise GitHubError("GitHub 回的仓库列表形状不对。", status_code=502)

                repos.extend(repo_listing(payload))
                if len(payload) < REPOS_PER_PAGE:
                    break
        return repos

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
            _raise_for_status(meta_response, full_name, token)
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
