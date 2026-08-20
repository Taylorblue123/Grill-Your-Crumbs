from __future__ import annotations

import json
import os
from datetime import UTC, datetime
from pathlib import Path
from typing import Any
from uuid import uuid4


class SessionNotFoundError(KeyError):
    pass


def utc_now() -> str:
    return datetime.now(UTC).isoformat()


class SessionStore:
    def __init__(self, root: Path) -> None:
        self.root = Path(root)
        self.root.mkdir(parents=True, exist_ok=True)

    def create_session(
        self,
        raw_experience: str,
        extra_sources: list[dict[str, Any]],
        *,
        session_id: str | None = None,
    ) -> dict[str, Any]:
        session_id = session_id or uuid4().hex[:12]
        chunks = [
            {
                "id": "c1",
                "source_type": "raw_experience",
                "source_name": "Your starting point",
                "text": raw_experience.strip(),
            }
        ]
        chunks.extend(
            {
                "id": f"c{index}",
                "source_type": source["source_type"],
                "source_name": source["source_name"],
                "text": source["text"].strip(),
            }
            for index, source in enumerate(extra_sources, start=2)
        )
        session = {
            "session_id": session_id,
            "created_at": utc_now(),
            "restatement": None,
            "probes": [],
            "chunks": chunks,
            "turns": [],
            "thread": {
                "thread_id": f"thread-{session_id}",
                "session_id": session_id,
                "highlight": "",
                "quantified_results": [],
                "decisions": [],
                "challenges": [],
                "raw_new_facts": [],
            },
            "artifact": None,
        }
        self.save(session)
        self.append_event(session_id, "session_created", {"chunk_count": len(chunks)})
        return session

    def _session_dir(self, session_id: str) -> Path:
        return self.root / session_id

    def _write_json(self, path: Path, value: Any) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        temporary = path.with_suffix(path.suffix + ".tmp")
        temporary.write_text(
            json.dumps(value, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
        os.replace(temporary, path)

    def save(self, session: dict[str, Any]) -> None:
        session_dir = self._session_dir(session["session_id"])
        self._write_json(
            session_dir / "session.json",
            {
                "session_id": session["session_id"],
                "created_at": session["created_at"],
                "restatement": session.get("restatement"),
                "probes": session.get("probes", []),
            },
        )
        self._write_json(session_dir / "chunks.json", session["chunks"])
        self._write_json(session_dir / "turns.json", session["turns"])
        self._write_json(session_dir / "thread.json", session["thread"])
        if session.get("artifact") is not None:
            self._write_json(session_dir / "artifact.json", session["artifact"])

    def load(self, session_id: str) -> dict[str, Any]:
        session_dir = self._session_dir(session_id)
        metadata_path = session_dir / "session.json"
        if not metadata_path.exists():
            raise SessionNotFoundError(session_id)

        metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
        artifact_path = session_dir / "artifact.json"
        return {
            **metadata,
            "chunks": json.loads((session_dir / "chunks.json").read_text(encoding="utf-8")),
            "turns": json.loads((session_dir / "turns.json").read_text(encoding="utf-8")),
            "thread": json.loads((session_dir / "thread.json").read_text(encoding="utf-8")),
            "artifact": (
                json.loads(artifact_path.read_text(encoding="utf-8"))
                if artifact_path.exists()
                else None
            ),
        }

    def append_event(self, session_id: str, event_type: str, payload: dict[str, Any]) -> None:
        session_dir = self._session_dir(session_id)
        if not (session_dir / "session.json").exists():
            raise SessionNotFoundError(session_id)
        event = {"type": event_type, "at": utc_now(), "payload": payload}
        with (session_dir / "events.jsonl").open("a", encoding="utf-8") as handle:
            handle.write(json.dumps(event, ensure_ascii=False) + "\n")

    def events(self, session_id: str) -> list[dict[str, Any]]:
        events_path = self._session_dir(session_id) / "events.jsonl"
        if not events_path.exists():
            if not (self._session_dir(session_id) / "session.json").exists():
                raise SessionNotFoundError(session_id)
            return []
        return [
            json.loads(line)
            for line in events_path.read_text(encoding="utf-8").splitlines()
            if line.strip()
        ]
