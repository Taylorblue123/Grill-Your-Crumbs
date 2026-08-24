"""GitHub 凭据仓：user_id → token，只活在进程内存里。

**这一模块存在的全部理由是「token 不落任何地方」。** 它没有镜像、没有 SQLite、
没有 `__repr__`——把凭据放进一个连序列化入口都没有的容器里，「永不入 data/」
就不是靠调用方自觉，而是这个类型本身办不到。

会话仓（`sessions.GrillSessionStore`）走的是另一条路：它要落 dev 镜像，所以
用 `scrub_secrets` 在 dump 时过滤凭据。两道防线针对的是两种走漏——那边防的是
「用户把 PAT 粘进作答框」，这边防的是「我们自己存下来的那份」。

重启即失效是有意的：会话本体也活在内存里（重启丢会话），凭据比会话活得更久
没有意义，反而多一份要清理的东西。前端在 401 时重新要一次 PAT 即可。
"""

from typing import Dict, Optional


class TokenStore:
    """user_id → GitHub token。纯内存，无持久化。"""

    def __init__(self) -> None:
        self._tokens: Dict[str, str] = {}

    def set(self, user_id: str, token: str) -> None:
        """存一个 token。空串等同于「清掉」——前端的「断开连接」走的就是它。"""
        cleaned = (token or "").strip()
        if cleaned:
            self._tokens[user_id] = cleaned
        else:
            self._tokens.pop(user_id, None)

    def get(self, user_id: str) -> Optional[str]:
        return self._tokens.get(user_id)

    def clear(self, user_id: str) -> None:
        self._tokens.pop(user_id, None)

    def __repr__(self) -> str:
        """只说存了几个，不说存了什么。

        默认的 dataclass/dict repr 会把 token 原样印进异常追踪、日志、调试器
        ——那正是「PAT 不落日志」最常见的破法，而且它不需要任何人写错代码就会
        发生。
        """
        return f"<TokenStore {len(self._tokens)} token(s)>"
