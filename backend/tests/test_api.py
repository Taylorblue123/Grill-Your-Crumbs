from pathlib import Path

from fastapi.testclient import TestClient

from backend.app.config import Settings
from backend.app.main import create_app


DEMO_USER = "00000000-0000-0000-0000-000000000001"


def make_client(tmp_path: Path, max_upload_bytes: int = 1024 * 1024) -> TestClient:
    prototype = tmp_path / "demo.html"
    prototype.write_text("<h1>demo</h1>", encoding="utf-8")
    settings = Settings(
        database_path=tmp_path / "grill.db",
        upload_dir=tmp_path / "uploads",
        prototype_path=prototype,
        max_upload_bytes=max_upload_bytes,
        demo_user_id=DEMO_USER,
    )
    return TestClient(create_app(settings))


def test_upload_list_and_delete_text_attachment(tmp_path: Path) -> None:
    with make_client(tmp_path) as client:
        response = client.post(
            "/api/v1/attachments",
            data={"kind": "notes"},
            files={"file": ("project-notes.md", "Latency fell from 800ms to 120ms.", "text/markdown")},
        )
        assert response.status_code == 201
        payload = response.json()
        assert payload["duplicate"] is False
        assert payload["crumb"]["kind"] == "notes"
        assert payload["crumb"]["content"] == "Latency fell from 800ms to 120ms."
        assert payload["crumb"]["attachment"]["original_name"] == "project-notes.md"

        crumb_id = payload["crumb"]["id"]
        listed = client.get("/api/v1/crumbs").json()["crumbs"]
        assert [crumb["id"] for crumb in listed] == [crumb_id]

        assert client.delete(f"/api/v1/crumbs/{crumb_id}").status_code == 204
        assert client.get("/api/v1/crumbs").json() == {"crumbs": []}
        assert list((tmp_path / "uploads").rglob("*.md")) == []


def test_duplicate_upload_reuses_existing_crumb(tmp_path: Path) -> None:
    with make_client(tmp_path) as client:
        first = client.post(
            "/api/v1/attachments",
            files={"file": ("one.txt", "same evidence", "text/plain")},
        )
        second = client.post(
            "/api/v1/attachments",
            files={"file": ("two.txt", "same evidence", "text/plain")},
        )

        assert first.status_code == 201
        assert second.status_code == 200
        assert second.json()["duplicate"] is True
        assert second.json()["crumb"]["id"] == first.json()["crumb"]["id"]
        assert len(client.get("/api/v1/crumbs").json()["crumbs"]) == 1


def test_rejects_unsupported_empty_and_oversized_files(tmp_path: Path) -> None:
    with make_client(tmp_path, max_upload_bytes=8) as client:
        unsupported = client.post(
            "/api/v1/attachments", files={"file": ("script.js", "alert(1)", "text/javascript")}
        )
        empty = client.post(
            "/api/v1/attachments", files={"file": ("empty.txt", b"", "text/plain")}
        )
        oversized = client.post(
            "/api/v1/attachments", files={"file": ("large.txt", b"123456789", "text/plain")}
        )

        assert unsupported.status_code == 415
        assert empty.status_code == 422
        assert oversized.status_code == 413
        assert list((tmp_path / "uploads").rglob("*.*")) == []


def test_user_header_is_validated_and_scopes_results(tmp_path: Path) -> None:
    other_user = "00000000-0000-0000-0000-000000000002"
    with make_client(tmp_path) as client:
        assert client.get("/api/v1/crumbs", headers={"X-User-Id": "not-a-uuid"}).status_code == 400
        client.post(
            "/api/v1/attachments",
            files={"file": ("private.txt", "private", "text/plain")},
        )
        assert client.get("/api/v1/crumbs", headers={"X-User-Id": other_user}).json() == {
            "crumbs": []
        }


def test_serves_built_prototype_and_health(tmp_path: Path) -> None:
    with make_client(tmp_path) as client:
        assert client.get("/api/health").json() == {"status": "ok"}
        response = client.get("/")
        assert response.status_code == 200
        assert "demo" in response.text
