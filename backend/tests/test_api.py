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
        # 不指向真实的 frontend/dist：这些用例测的是 API，不该依赖前端构建过没有。
        frontend_dist=tmp_path / "frontend-dist",
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


HTML_RESUME = """<!doctype html>
<html><head><title>简历</title>
<style>body { color: #333; }</style>
<script>console.log("noise");</script>
</head>
<body>
  <h1>王小明</h1>
  <p>把延迟从 <b>800ms</b> 降到 <i>120ms</i>。</p>
  <!-- 招聘方看不到的注释 -->
  <ul><li>Python &amp; FastAPI</li></ul>
</body></html>
"""


def test_html_upload_strips_tags_and_infers_resume(tmp_path: Path) -> None:
    with make_client(tmp_path) as client:
        response = client.post(
            "/api/v1/attachments",
            files={"file": ("resume.html", HTML_RESUME, "text/html")},
        )

        assert response.status_code == 201
        crumb = response.json()["crumb"]
        assert crumb["kind"] == "resume"
        assert crumb["attachment"]["media_type"] == "text/html"

        content = crumb["content"]
        assert "<" not in content and ">" not in content
        assert "王小明" in content
        assert "把延迟从 800ms 降到 120ms。" in content
        # 标签剥离要连同不可见内容一起丢掉：脚本、样式、注释都不是简历正文。
        assert "console.log" not in content
        assert "color: #333" not in content
        assert "招聘方看不到的注释" not in content
        # HTML 实体要还原成字符，别把 &amp; 原样喂给拷问。
        assert "Python & FastAPI" in content
        assert "&amp;" not in content

        listed = client.get("/api/v1/crumbs").json()["crumbs"]
        assert [c["id"] for c in listed] == [crumb["id"]]
        assert listed[0]["content"] == content


def test_html_upload_respects_explicit_kind_and_htm_suffix(tmp_path: Path) -> None:
    with make_client(tmp_path) as client:
        response = client.post(
            "/api/v1/attachments",
            data={"kind": "notes"},
            files={"file": ("scratch.htm", "<p>一条随手记</p>", "text/html")},
        )

        assert response.status_code == 201
        crumb = response.json()["crumb"]
        assert crumb["kind"] == "notes"
        assert crumb["content"] == "一条随手记"


def test_html_upload_without_text_is_rejected(tmp_path: Path) -> None:
    with make_client(tmp_path) as client:
        response = client.post(
            "/api/v1/attachments",
            files={"file": ("empty.html", "<html><body><br><hr></body></html>", "text/html")},
        )

        assert response.status_code == 422
        assert list((tmp_path / "uploads").rglob("*.*")) == []


def test_html_upload_survives_unclosed_head(tmp_path: Path) -> None:
    """真实导出的简历常省略 `</head>`；正文不能因此被整份吞掉。"""
    with make_client(tmp_path) as client:
        response = client.post(
            "/api/v1/attachments",
            files={
                "file": (
                    "sloppy.html",
                    "<html><head><title>简历</title><body><p>正文还在</p></body></html>",
                    "text/html",
                )
            },
        )

        assert response.status_code == 201
        content = response.json()["crumb"]["content"]
        assert "正文还在" in content
        assert "简历" not in content  # <title> 是元数据，不是简历正文
