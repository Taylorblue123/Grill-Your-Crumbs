from contextlib import asynccontextmanager
from datetime import datetime, timezone
import hashlib
from pathlib import Path
import re
from typing import Any, Dict, Optional
from uuid import UUID, uuid4

from fastapi import Depends, FastAPI, File, Form, Header, HTTPException, Response, UploadFile, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from .config import Settings
from .database import Database
from .extraction import ExtractionError, MEDIA_TYPES, extract_text, validate_extension
from .schemas import CrumbListResponse, CrumbView, HealthResponse, UploadResponse


CHUNK_SIZE = 1024 * 1024
VALID_KINDS = {"resume", "repo", "notes", "diary", "social", "linkedin", "manual"}


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def safe_filename(filename: str) -> str:
    name = Path(filename or "attachment").name
    return re.sub(r"[^\w.()\-\u4e00-\u9fff ]", "_", name)[:180] or "attachment"


def validate_user_id(value: str) -> str:
    try:
        return str(UUID(value))
    except ValueError as error:
        raise HTTPException(status_code=400, detail="X-User-Id must be a UUID") from error


def infer_kind(kind: str, suffix: str) -> str:
    if kind != "auto":
        if kind not in VALID_KINDS:
            raise HTTPException(status_code=422, detail="Invalid material kind")
        return kind
    if suffix in {".pdf", ".docx", ".html", ".htm"}:
        return "resume"
    return "notes"


def make_crumb_view(row: Dict[str, Any], attachment: Optional[Dict[str, Any]] = None) -> CrumbView:
    attachment_row = attachment
    if attachment_row is None and row.get("attachment_id"):
        attachment_row = {
            "id": row["attachment_id"],
            "original_name": row["original_name"],
            "media_type": row["media_type"],
            "byte_size": row["byte_size"],
            "extraction_status": row["extraction_status"],
        }
    return CrumbView(
        id=row["id"],
        kind=row["kind"],
        display_name=row["display_name"],
        content=row["content"],
        token_count=row["token_count"],
        synced_at=row["synced_at"],
        attachment=attachment_row,
    )


def create_app(settings: Optional[Settings] = None) -> FastAPI:
    app_settings = settings or Settings.from_env()
    database = Database(app_settings.database_path)

    @asynccontextmanager
    async def lifespan(_: FastAPI):
        database.initialize()
        app_settings.upload_dir.mkdir(parents=True, exist_ok=True)
        yield

    app = FastAPI(
        title="Grill Your Crumbs API",
        version="0.1.0",
        description="Attachment ingestion and crumb storage for the interactive demo.",
        lifespan=lifespan,
    )
    app.state.settings = app_settings
    app.state.database = database
    app.add_middleware(
        CORSMiddleware,
        allow_origin_regex=r"^(null|https?://(localhost|127\.0\.0\.1)(:\d+)?)$",
        allow_credentials=False,
        allow_methods=["GET", "POST", "DELETE", "OPTIONS"],
        allow_headers=["Content-Type", "X-User-Id"],
    )

    def current_user_id(x_user_id: Optional[str] = Header(default=None)) -> str:
        return validate_user_id(x_user_id or app_settings.demo_user_id)

    @app.get("/api/health", response_model=HealthResponse)
    def health() -> HealthResponse:
        return HealthResponse(status="ok")

    @app.get("/api/v1/crumbs", response_model=CrumbListResponse)
    def list_crumbs(user_id: str = Depends(current_user_id)) -> CrumbListResponse:
        rows = database.list_crumbs(user_id)
        return CrumbListResponse(crumbs=[make_crumb_view(row) for row in rows])

    @app.post(
        "/api/v1/attachments",
        response_model=UploadResponse,
        status_code=status.HTTP_201_CREATED,
    )
    async def upload_attachment(
        response: Response,
        file: UploadFile = File(...),
        kind: str = Form(default="auto"),
        user_id: str = Depends(current_user_id),
    ) -> UploadResponse:
        original_name = safe_filename(file.filename or "attachment")
        try:
            suffix = validate_extension(original_name)
        except ExtractionError as error:
            raise HTTPException(status_code=415, detail=str(error)) from error

        attachment_id = str(uuid4())
        storage_key = f"{user_id}/{attachment_id}{suffix}"
        destination = app_settings.upload_dir / storage_key
        destination.parent.mkdir(parents=True, exist_ok=True)
        digest = hashlib.sha256()
        byte_size = 0

        try:
            with destination.open("wb") as output:
                while True:
                    chunk = await file.read(CHUNK_SIZE)
                    if not chunk:
                        break
                    byte_size += len(chunk)
                    if byte_size > app_settings.max_upload_bytes:
                        raise HTTPException(
                            status_code=413,
                            detail=f"Attachment exceeds {app_settings.max_upload_bytes} bytes",
                        )
                    digest.update(chunk)
                    output.write(chunk)

            if byte_size == 0:
                raise HTTPException(status_code=422, detail="Attachment is empty")

            content_hash = digest.hexdigest()
            duplicate = database.find_crumb_by_hash(user_id, content_hash)
            if duplicate:
                destination.unlink(missing_ok=True)
                existing_attachment = database.get_attachment_for_crumb(duplicate["id"])
                response.status_code = status.HTTP_200_OK
                return UploadResponse(
                    crumb=make_crumb_view(duplicate, existing_attachment), duplicate=True
                )

            try:
                content, extraction_status = extract_text(destination, suffix)
            except ExtractionError as error:
                raise HTTPException(status_code=422, detail=str(error)) from error

            now = utc_now()
            crumb = {
                "id": str(uuid4()),
                "user_id": user_id,
                "kind": infer_kind(kind, suffix),
                "display_name": original_name,
                "content": content,
                "content_hash": content_hash,
                "token_count": max(1, len(content) // 4),
                "synced_at": now,
            }
            attachment = {
                "id": attachment_id,
                "user_id": user_id,
                "crumb_id": crumb["id"],
                "original_name": original_name,
                "media_type": MEDIA_TYPES[suffix],
                "byte_size": byte_size,
                "storage_key": storage_key,
                "sha256": content_hash,
                "extraction_status": extraction_status,
                "created_at": now,
            }
            database.insert_upload(crumb, attachment)
            return UploadResponse(crumb=make_crumb_view(crumb, attachment), duplicate=False)
        except Exception:
            destination.unlink(missing_ok=True)
            raise
        finally:
            await file.close()

    @app.delete("/api/v1/crumbs/{crumb_id}", status_code=status.HTTP_204_NO_CONTENT)
    def delete_crumb(crumb_id: str, user_id: str = Depends(current_user_id)) -> None:
        deleted = database.delete_crumb(user_id, crumb_id)
        if not deleted:
            raise HTTPException(status_code=404, detail="Crumb not found")
        if deleted.get("storage_key"):
            storage_path = (app_settings.upload_dir / deleted["storage_key"]).resolve()
            upload_root = app_settings.upload_dir.resolve()
            if upload_root in storage_path.parents:
                storage_path.unlink(missing_ok=True)

    # React 前端的静态资源。只在构建过之后挂载 —— 跑后端测试时 dist/ 不存在是正常的。
    frontend_assets = app_settings.frontend_dist / "assets"
    if frontend_assets.is_dir():
        app.mount("/assets", StaticFiles(directory=str(frontend_assets)), name="assets")

    @app.get("/", include_in_schema=False)
    def index() -> FileResponse:
        """有 React 构建产物就服务它，否则回落到单文件原型。"""
        spa_index = app_settings.frontend_dist / "index.html"
        if spa_index.exists():
            return FileResponse(str(spa_index), media_type="text/html")
        if app_settings.prototype_path.exists():
            return FileResponse(str(app_settings.prototype_path), media_type="text/html")
        raise HTTPException(
            status_code=404,
            detail="Build the frontend (cd frontend && npm run build) or run prototype/build.sh",
        )

    return app


app = create_app()
