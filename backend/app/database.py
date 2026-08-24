import sqlite3
from pathlib import Path
from typing import Any, Dict, List, Optional


SCHEMA = """
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS crumb (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (
        kind IN ('resume', 'repo', 'notes', 'diary', 'social', 'linkedin', 'manual')
    ),
    display_name TEXT NOT NULL,
    content TEXT NOT NULL,
    content_hash TEXT NOT NULL,
    token_count INTEGER NOT NULL DEFAULT 0,
    synced_at TEXT NOT NULL,
    UNIQUE (user_id, content_hash)
);

CREATE INDEX IF NOT EXISTS crumb_user_synced_at
    ON crumb (user_id, synced_at DESC);

CREATE TABLE IF NOT EXISTS attachment (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    crumb_id TEXT NOT NULL UNIQUE REFERENCES crumb(id) ON DELETE CASCADE,
    original_name TEXT NOT NULL,
    media_type TEXT NOT NULL,
    byte_size INTEGER NOT NULL CHECK (byte_size >= 0),
    storage_key TEXT NOT NULL UNIQUE,
    sha256 TEXT NOT NULL,
    extraction_status TEXT NOT NULL CHECK (
        extraction_status IN ('ready', 'unsupported', 'failed')
    ),
    created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS attachment_user_created_at
    ON attachment (user_id, created_at DESC);
"""


CRUMB_INSERT = """
    INSERT INTO crumb (
        id, user_id, kind, display_name, content, content_hash,
        token_count, synced_at
    ) VALUES (
        :id, :user_id, :kind, :display_name, :content, :content_hash,
        :token_count, :synced_at
    )
"""


class Database:
    def __init__(self, path: Path):
        self.path = path

    def connect(self) -> sqlite3.Connection:
        connection = sqlite3.connect(str(self.path))
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA foreign_keys = ON")
        return connection

    def initialize(self) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with self.connect() as connection:
            connection.executescript(SCHEMA)

    def find_crumb_by_hash(self, user_id: str, content_hash: str) -> Optional[Dict[str, Any]]:
        with self.connect() as connection:
            row = connection.execute(
                "SELECT * FROM crumb WHERE user_id = ? AND content_hash = ?",
                (user_id, content_hash),
            ).fetchone()
            return dict(row) if row else None

    def find_crumb_by_display_name(
        self, user_id: str, kind: str, display_name: str
    ) -> Optional[Dict[str, Any]]:
        """按 (kind, display_name) 找料。仓库料的 upsert 键就是这一对。

        为什么不是 content_hash：重拉一个仓库，内容几乎必然变了（新 commit、
        改过的 README），哈希对不上，去重逻辑会当成一份新料，于是同一个仓库在
        列表里堆成好几条。仓库的身份是 `full_name`，不是它某一刻的内容。
        """
        with self.connect() as connection:
            row = connection.execute(
                "SELECT * FROM crumb WHERE user_id = ? AND kind = ? AND display_name = ?",
                (user_id, kind, display_name),
            ).fetchone()
            return dict(row) if row else None

    def upsert_crumb(self, crumb: Dict[str, Any], replaces_id: Optional[str] = None) -> None:
        """写一份无附件的料；给了 `replaces_id` 就在同一事务里先删掉旧的那份。

        删+插而不是 UPDATE：旧料可能挂着附件（用户先上传过 README 又来连仓），
        DELETE 的级联会把它一起清掉，UPDATE 会留下一条指向新内容的陈旧附件。
        同一事务保证不会出现「旧的删了、新的没进去」的空档。
        """
        with self.connect() as connection:
            if replaces_id:
                connection.execute(
                    "DELETE FROM crumb WHERE user_id = ? AND id = ?",
                    (crumb["user_id"], replaces_id),
                )
            connection.execute(CRUMB_INSERT, crumb)

    def get_attachment_for_crumb(self, crumb_id: str) -> Optional[Dict[str, Any]]:
        with self.connect() as connection:
            row = connection.execute(
                "SELECT * FROM attachment WHERE crumb_id = ?", (crumb_id,)
            ).fetchone()
            return dict(row) if row else None

    def insert_upload(self, crumb: Dict[str, Any], attachment: Dict[str, Any]) -> None:
        with self.connect() as connection:
            connection.execute(CRUMB_INSERT, crumb)
            connection.execute(
                """
                INSERT INTO attachment (
                    id, user_id, crumb_id, original_name, media_type, byte_size,
                    storage_key, sha256, extraction_status, created_at
                ) VALUES (
                    :id, :user_id, :crumb_id, :original_name, :media_type, :byte_size,
                    :storage_key, :sha256, :extraction_status, :created_at
                )
                """,
                attachment,
            )

    def list_crumbs(self, user_id: str) -> List[Dict[str, Any]]:
        with self.connect() as connection:
            rows = connection.execute(
                """
                SELECT c.*, a.id AS attachment_id, a.original_name, a.media_type,
                       a.byte_size, a.extraction_status
                FROM crumb c
                LEFT JOIN attachment a ON a.crumb_id = c.id
                WHERE c.user_id = ?
                ORDER BY c.synced_at DESC
                """,
                (user_id,),
            ).fetchall()
            return [dict(row) for row in rows]

    def list_crumbs_by_ids(self, user_id: str, crumb_ids: List[str]) -> List[Dict[str, Any]]:
        """按 id 取这个用户的料。不存在或不属于该用户的 id 静默缺席——
        调用方比对数量差就知道哪些没取到，这里不替它决定那算不算错。

        id 分批查：`IN (?, ?, …)` 占的是 SQLite 的变量额度，而这个上限在老一点
        的构建上只有 999。请求体里的 id 数量是客户端说了算的，不该由它决定这条
        查询会不会炸——分批之后多长的列表都只是多跑几次。
        """
        if not crumb_ids:
            return []
        # 留出余量给 user_id 那一个变量。
        batch_size = 500
        rows: List[Dict[str, Any]] = []
        with self.connect() as connection:
            for start in range(0, len(crumb_ids), batch_size):
                batch = crumb_ids[start:start + batch_size]
                placeholders = ",".join("?" for _ in batch)
                rows.extend(
                    dict(row)
                    for row in connection.execute(
                        f"SELECT * FROM crumb WHERE user_id = ? AND id IN ({placeholders})",
                        (user_id, *batch),
                    ).fetchall()
                )
        # 排序放在分批之后，否则每批各自有序、合起来无序。
        rows.sort(key=lambda row: row.get("synced_at") or "", reverse=True)
        return rows

    def delete_crumb(self, user_id: str, crumb_id: str) -> Optional[Dict[str, Any]]:
        with self.connect() as connection:
            row = connection.execute(
                """
                SELECT c.id, a.storage_key
                FROM crumb c
                LEFT JOIN attachment a ON a.crumb_id = c.id
                WHERE c.user_id = ? AND c.id = ?
                """,
                (user_id, crumb_id),
            ).fetchone()
            if not row:
                return None
            connection.execute(
                "DELETE FROM crumb WHERE user_id = ? AND id = ?", (user_id, crumb_id)
            )
            return dict(row)

