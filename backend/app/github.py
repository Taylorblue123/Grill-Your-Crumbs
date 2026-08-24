"""GitHub 适配器接缝。

本票（#23）只铺接缝：定义应用工厂注入的接口与失败类型，让后续切片的仓库
列表 / 批量拉取端点有地方接上来，也让测试能传假实现、不打真网络、不需要真
token。真实的 HTTP 拉取逻辑随那些端点一起落地，这里先不写——没有调用方的
实现无从验证，写了也只是负债。
"""

from typing import Any, Dict, List, Optional, Protocol


class GitHubError(RuntimeError):
    """GitHub 拉取失败（限流、网络、不可见）。HTTP 层映射为 502 / 404。"""

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


class HttpGitHub:
    """真实现的占位。

    端点未接，所以调用它是程序错误，不是运行时可恢复的失败——直接抛
    `NotImplementedError`，而不是伪装成 `GitHubError` 让调用方以为是网络问题。
    """

    def list_repos(self, token: str) -> List[Dict[str, Any]]:
        raise NotImplementedError("GitHub repo listing lands with the repos endpoint slice")

    def fetch_repo(self, full_name: str, token: Optional[str] = None) -> Dict[str, Any]:
        raise NotImplementedError("GitHub repo fetching lands with the repos endpoint slice")
