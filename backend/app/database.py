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

    def get_attachment_for_crumb(self, crumb_id: str) -> Optional[Dict[str, Any]]:
        with self.connect() as connection:
            row = connection.execute(
                "SELECT * FROM attachment WHERE crumb_id = ?", (crumb_id,)
            ).fetchone()
            return dict(row) if row else None

    def insert_upload(self, crumb: Dict[str, Any], attachment: Dict[str, Any]) -> None:
        with self.connect() as connection:
            connection.execute(
                """
                INSERT INTO crumb (
                    id, user_id, kind, display_name, content, content_hash,
                    token_count, synced_at
                ) VALUES (
                    :id, :user_id, :kind, :display_name, :content, :content_hash,
                    :token_count, :synced_at
                )
                """,
                crumb,
            )
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

