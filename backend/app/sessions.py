"""拷问会话内存仓：session_id → 状态。

会话本体活在进程内存里，不进 SQLite——后端重启丢会话是本切片接受的代价
（前端对 404 会话给「重开一场」提示）。data/ 下的 JSON 只是 dev 镜像：
每次变更 dump 一次，重启回读一次，损坏就丢弃冷启动。

**token 永不入镜像。** GitHub PAT 之类的凭据只在内存里活着，dump 时两道过
滤：按字段名剔除（`SECRET_FIELDS`），再扫一遍自由文本里长得像凭据的串
（`CREDENTIAL_PATTERN`）。后者是兜底——用户完全可能把 PAT 贴进作答框。
两道都是尽力而为，镜像文件不是安全边界，别往里塞任何秘密。

本仓对会话状态的形状不作断言——它存什么由拷问端点那一片决定。但有一条
**ADR-0002 的不变量**要在这里点明，免得下一片踩空：事实（fact）写入时必须
记录来源，来源字段不可为空（出处只能在写入时记录，事后无法补）。本仓不替
调用方强制它——强制点在事实的构造处，不在这个通用容器里——写事实进会话的
那一片必须自己守住。
"""

import copy
import json
import os
import re
from pathlib import Path
from typing import Any, Dict, Optional
from uuid import uuid4


# dump 时一律剔除的字段名。新增任何凭据类字段，都要同时加进这里。
SECRET_FIELDS = frozenset({"token", "github_token", "access_token", "api_key", "secret"})

# 兜底：凭据也可能被用户粘进自由文本（比如把 PAT 贴进作答框）。按字段名剔除
# 拦不住这种，所以再按前缀扫一遍字符串。这不是密码学意义上的保证，只是让
# 「token 永不入镜像」在最常见的走漏路径上真的成立。
#
# 只吃掉 token 本身（ASCII 的字母数字下划线连字符），不按空格切词——中文
# 常常不带空格，按空格切会把紧跟在 token 后面的正文一起吞掉。
#
# 长度下限按前缀分开定：`ghp_` 这类前缀本身已经足够特异，一位都不会误伤普通
# 词，尾巴短一点也照删；`sk-` 太像普通的连字符词（sk-learning），所以要求
# 尾巴够长才动手。
CREDENTIAL_PATTERN = re.compile(
    r"(?:ghp_|gho_|ghu_|ghs_|ghr_|github_pat_)[A-Za-z0-9_-]+"
    r"|sk-[A-Za-z0-9_-]{16,}"
)
REDACTED = "[redacted]"


def scrub_secrets(value: Any) -> Any:
    """递归剔除凭据：先按字段名，再按自由文本里的 token 前缀。"""
    if isinstance(value, dict):
        return {
            key: scrub_secrets(item)
            for key, item in value.items()
            if key not in SECRET_FIELDS
        }
    if isinstance(value, list):
        return [scrub_secrets(item) for item in value]
    if isinstance(value, str):
        return _redact_credentials(value)
    return value


def _redact_credentials(text: str) -> str:
    """把自由文本里长得像凭据的串换成 [redacted]，其余一个字不动。"""
    return CREDENTIAL_PATTERN.sub(REDACTED, text)


class GrillSessionStore:
    """内存会话仓 + data/ 下的 JSON dev 镜像。"""

    def __init__(self, mirror_path: Optional[Path] = None):
        self._sessions: Dict[str, Dict[str, Any]] = {}
        self._mirror_path = mirror_path
        if mirror_path is not None:
            self._sessions = _load_mirror(mirror_path)

    def create(self, **state: Any) -> str:
        session_id = str(uuid4())
        self._sessions[session_id] = copy.deepcopy(state)
        self._dump()
        return session_id

    def get(self, session_id: str) -> Optional[Dict[str, Any]]:
        """返回会话状态的一份深拷贝。

        浅拷贝不够：会话状态里的事实账本、挖掘树都是嵌套结构，浅拷贝会让
        调用方绕过 `update` 静默改仓，改动也就不会落进镜像。
        """
        session = self._sessions.get(session_id)
        return copy.deepcopy(session) if session is not None else None

    def update(self, session_id: str, **changes: Any) -> Dict[str, Any]:
        session = self._sessions.get(session_id)
        if session is None:
            raise KeyError(session_id)
        session.update(copy.deepcopy(changes))
        self._dump()
        return copy.deepcopy(session)

    def delete(self, session_id: str) -> None:
        if self._sessions.pop(session_id, None) is not None:
            self._dump()

    def _dump(self) -> None:
        """把内存状态写进镜像。写不成不是致命错——会话在内存里照样能用。"""
        if self._mirror_path is None:
            return
        payload = scrub_secrets(self._sessions)
        try:
            self._mirror_path.parent.mkdir(parents=True, exist_ok=True)
            # 先写临时文件再原子替换：进程半途死掉也不会留下半截 JSON。
            temporary = self._mirror_path.with_suffix(f"{self._mirror_path.suffix}.tmp")
            temporary.write_text(
                json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8"
            )
            os.replace(temporary, self._mirror_path)
        except (OSError, TypeError, ValueError):
            # 镜像只是 dev 便利，坏了就坏了，不能拖垮正在进行的拷问。
            pass


def _load_mirror(path: Path) -> Dict[str, Dict[str, Any]]:
    """回读镜像。文件不在、读不动、不是 JSON、形状不对——一律冷启动。"""
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError, UnicodeDecodeError):
        return {}
    if not isinstance(raw, dict):
        return {}
    return {
        key: value
        for key, value in raw.items()
        if isinstance(key, str) and isinstance(value, dict)
    }
