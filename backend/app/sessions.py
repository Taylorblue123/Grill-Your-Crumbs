"""拷问会话仓：session_id → 状态，落 SQLite 持久化。

会话本体过去活在进程内存里，后端一重启就全丢。现在整块落库——和料
（crumb）、附件（attachment）一个待遇，同一个 `database_path` 下的库。重启后
进行中的会话仍在，能读、能接着答。

会话状态是一棵嵌套的 dict（事实账本、成稿版本、挖掘树……）。它整块以序列化
的 JSON 存一个 TEXT 列，而不是拆成一张张表：状态的形状由拷问端点那一片决定，
拆列会把那个决定硬编进建库脚本里——加一个字段就得改 schema。关键是「重启后
会话还在」，不是「把每个字段拆成列」。

**token 永不入库。** GitHub PAT 之类的凭据只在内存的调用方手里活着，写库时两
道过滤：按字段名剔除（`SECRET_FIELDS`），再扫一遍自由文本里长得像凭据的串
（`CREDENTIAL_PATTERN`）。后者是兜底——用户完全可能把 PAT 贴进作答框。两道都
是尽力而为，库文件不是安全边界，别往里塞任何秘密。

本仓对会话状态的形状不作断言——它存什么由拷问端点那一片决定。但有一条
**ADR-0002 的不变量**要在这里点明，免得下一片踩空：事实（fact）写入时必须
记录来源，来源字段不可为空（出处只能在写入时记录，事后无法补）。本仓不替
调用方强制它——强制点在事实的构造处，不在这个通用容器里——写事实进会话的
那一片必须自己守住。
"""

import copy
import json
import re
from typing import Any, Dict, Optional
from uuid import uuid4

from .database import Database


# 写库时一律剔除的字段名。新增任何凭据类字段，都要同时加进这里。
SECRET_FIELDS = frozenset({"token", "github_token", "access_token", "api_key", "secret"})

# 兜底：凭据也可能被用户粘进自由文本（比如把 PAT 贴进作答框）。按字段名剔除
# 拦不住这种，所以再按前缀扫一遍字符串。这不是密码学意义上的保证，只是让
# 「token 永不入库」在最常见的走漏路径上真的成立。
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
    """落 SQLite 的会话仓。create/get/update/delete 的语义和内存版一致——
    换的只是底层：进程内存 → 同一个 `database_path` 下的 `grill_session` 表。

    写进去的是**过滤掉凭据之后**的状态；调用方手里那份未经过滤的原文只活在
    这一次请求里，不随会话落库。于是 `get` 回来的状态里凭据已经不在了——这和
    过去的内存版不同（那时内存里原文还在，只是镜像不含它），但对拷问端点没有
    影响：端点从不把会话里的凭据再读出来用（PAT 走 tokens.TokenStore，与会话
    无关）。落库换成「凭据根本不进库」比「进库再小心不读」更难出错。
    """

    def __init__(self, database: Database):
        self._database = database
        # 直接构造这个仓的地方（测试、脚本）未必跑过 create_app 的 lifespan，
        # 那里才 initialize() 建表。这一步幂等（CREATE TABLE IF NOT EXISTS），
        # 保证 `grill_session` 表在任何入口下都存在。
        self._database.initialize()

    def create(self, **state: Any) -> str:
        session_id = str(uuid4())
        self._write(session_id, state)
        return session_id

    def get(self, session_id: str) -> Optional[Dict[str, Any]]:
        """取一场会话的状态；不在就 None。

        回来的是从库里反序列化出的新对象，天然是调用方独占的一份——无从绕过
        `update` 静默改仓（嵌套的事实账本、挖掘树也一样），因为它根本不是仓里
        那个对象。
        """
        raw = self._database.get_grill_session(session_id)
        if raw is None:
            return None
        return json.loads(raw)

    def update(self, session_id: str, **changes: Any) -> Dict[str, Any]:
        raw = self._database.get_grill_session(session_id)
        if raw is None:
            raise KeyError(session_id)
        session = json.loads(raw)
        session.update(copy.deepcopy(changes))
        self._write(session_id, session)
        return copy.deepcopy(session)

    def delete(self, session_id: str) -> None:
        self._database.delete_grill_session(session_id)

    def _write(self, session_id: str, state: Dict[str, Any]) -> None:
        """落库一场会话：先过滤凭据，再序列化成 JSON 写进那一行。"""
        payload = json.dumps(scrub_secrets(state), ensure_ascii=False)
        self._database.put_grill_session(session_id, payload)
