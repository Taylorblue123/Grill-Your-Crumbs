from contextlib import asynccontextmanager
from datetime import datetime, timezone
import hashlib
from pathlib import Path
import re
from typing import Any, Dict, List, Optional
from uuid import UUID, uuid4

from fastapi import Depends, FastAPI, File, Form, Header, HTTPException, Response, UploadFile, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from .answer import run_turn
from .config import Settings
from .database import Database
from .extraction import ExtractionError, MEDIA_TYPES, extract_text, validate_extension
from .github import GitHub, HttpGitHub
from .grill import GrillError, open_session, pick_baseline, question_view
from .llm import Llm, LlmError, OpenAiLlm
from .schemas import (
    CrumbListResponse,
    CrumbView,
    FactView,
    GrillAnswerRequest,
    GrillAnswerResponse,
    GrillSessionRequest,
    GrillSessionResponse,
    GrillSessionView,
    HealthResponse,
    UploadResponse,
)
from .sessions import GrillSessionStore


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


def fact_views(facts: List[Dict[str, Any]]) -> List[FactView]:
    """账本条目 → 前端形状。`source` 留在服务端：它是给溯源校验用的原文片段，
    对用户没有阅读价值，透出去只会让账本变吵。"""
    return [
        FactView(
            id=fact["id"],
            text=fact["text"],
            turn_id=fact["turn_id"],
            round=fact["round"],
        )
        for fact in facts
    ]


def session_projection(session_id: str, session: Dict[str, Any]) -> GrillSessionView:
    """会话状态 → 全投影。刷新后前端只拿这一个响应就能重画现场。"""
    return GrillSessionView(
        session_id=session_id,
        baseline_crumb_id=session["baseline_crumb_id"],
        jd_text=session["jd_text"],
        facts=fact_views(session["facts"]),
        question=session.get("question"),
        done=bool(session.get("done")),
        closed_by=session.get("closed_by"),
        answered_count=len(session.get("history") or []),
    )


def create_app(
    settings: Optional[Settings] = None,
    llm: Optional[Llm] = None,
    github: Optional[GitHub] = None,
) -> FastAPI:
    """应用工厂。

    `llm` 与 `github` 是全代码库仅有的一处依赖注入点，位于最高点：不传就用真
    实现，测试传假实现，于是会话状态机的行为可以在不打真网络、不烧 token 的
    前提下从 HTTP 层驱动断言。
    """
    app_settings = settings or Settings.from_env()
    database = Database(app_settings.database_path)
    app_llm: Llm = llm or OpenAiLlm(app_settings.llm)
    app_github: GitHub = github or HttpGitHub()
    sessions = GrillSessionStore(app_settings.session_mirror_path)

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
    app.state.llm = app_llm
    app.state.github = app_github
    app.state.sessions = sessions
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

    @app.post(
        "/api/v1/grill/sessions",
        response_model=GrillSessionResponse,
        status_code=status.HTTP_201_CREATED,
    )
    def start_grill_session(
        request: GrillSessionRequest, user_id: str = Depends(current_user_id)
    ) -> GrillSessionResponse:
        """开场：定靶（JD + 选料）→ 一次 LLM 调用规划挖掘树并出首题。

        错误码分工：JD 空是**请求本身**不合法（400）；料的问题是内容层面不满足
        前提（422）——选的料一份都不存在，或者选中的料里没有简历当底稿。
        """
        jd_text = request.jd_text.strip()
        if not jd_text:
            raise HTTPException(status_code=400, detail="JD 不能为空——拷问需要一个靶子。")

        crumbs = database.list_crumbs_by_ids(user_id, request.crumb_ids)
        if not crumbs:
            raise HTTPException(status_code=422, detail="至少要选一份料才能开始拷问。")

        baseline = pick_baseline(crumbs)
        if baseline is None:
            raise HTTPException(
                status_code=422,
                detail="进场的料里没有简历。拷问要拿一份简历当底稿，请先上传或勾选一份简历。",
            )

        try:
            opening = open_session(
                llm=app_llm,
                jd_text=jd_text,
                crumbs=crumbs,
                baseline_crumb_id=baseline["id"],
            )
        except (LlmError, GrillError) as error:
            # 规划无副作用，调用方可安全重发——502 就是这么约定的。
            raise HTTPException(status_code=502, detail=str(error)) from error

        question = question_view(opening["question"], opening["tree"])
        session_id = sessions.create(
            user_id=user_id,
            jd_text=jd_text,
            crumb_ids=[crumb["id"] for crumb in crumbs],
            baseline_crumb_id=baseline["id"],
            tree=opening["tree"],
            question=question,
            # 事实账本从空开始。ADR-0002 的不变量（事实写入必须带来源）由写事实
            # 的那一片守住——本片一条事实都不写。
            facts=[],
            history=[],
            done=False,
            created_at=utc_now(),
        )

        return GrillSessionResponse(
            session_id=session_id,
            baseline_crumb_id=baseline["id"],
            question=question,
        )

    def load_session(session_id: str, user_id: str) -> Dict[str, Any]:
        """取会话，顺手做归属检查。

        别人的会话和不存在的会话给同一个 404：会话 id 是 uuid，但「猜不中」不是
        访问控制，而 403 会把「这个 id 确实存在」告诉猜的人。
        """
        session = sessions.get(session_id)
        if session is None or session.get("user_id") != user_id:
            raise HTTPException(status_code=404, detail="这场拷问不在了。后端重启会丢掉进行中的会话。")
        return session

    @app.get("/api/v1/grill/sessions/{session_id}", response_model=GrillSessionView)
    def get_grill_session(
        session_id: str, user_id: str = Depends(current_user_id)
    ) -> GrillSessionView:
        """会话全投影，供刷新后重连现场。

        会话活在内存里，后端重启即丢——那时这里 404，前端据此给「重开一场」提示。
        """
        return session_projection(session_id, load_session(session_id, user_id))

    @app.post(
        "/api/v1/grill/sessions/{session_id}/stop",
        response_model=GrillSessionView,
    )
    def stop_grill_session(
        session_id: str, user_id: str = Depends(current_user_id)
    ) -> GrillSessionView:
        """「够了，去改写」：用户中断这场拷问。

        中断必须写进服务端，不能只在前端把屏幕切走：会话恢复读的是这个投影，
        前端单方面「切到收口画面」的话，刷新一次就会把用户送回他刚走开的那道题。

        已经收口的会话再点一次是幂等的——不报错，直接把当前投影交回去。
        中断不删会话：账本要留给改写那一片用。
        """
        session = load_session(session_id, user_id)
        if not session.get("done"):
            # 当前那道题作废：用户不打算答了，留着它只会让恢复出来的现场自相矛盾。
            session = sessions.update(
                session_id, done=True, question=None, closed_by="stopped"
            )
        return session_projection(session_id, session)

    @app.post(
        "/api/v1/grill/sessions/{session_id}/answers",
        response_model=GrillAnswerResponse,
    )
    def submit_grill_answer(
        session_id: str,
        request: GrillAnswerRequest,
        user_id: str = Depends(current_user_id),
    ) -> GrillAnswerResponse:
        """作答一轮：一次 LLM 调用完成「抽事实入账本 + 更新树 + 出下一题或收口」。

        两条不变量在这里守住：

        **作答幂等**（见 issue #26）。`question_id` 必须等于当前那道题，否则 409 并把
        当前状态一起交回去——重发、双标签页、后退键重提交都走这条，客户端拿 409
        的 body 就能对齐现场，不必再拉一次 GET。409 在调 LLM 之前就返回，重复
        作答不烧 token。

        **失败原子性**（见 issue #26）。`run_turn` 是纯函数不碰会话仓，状态在它成功
        返回之后一次性写入。所以 LLM 失败时会话一个字没变，同一答案可以安全重发，
        也不会留下半轮的事实。
        """
        session = load_session(session_id, user_id)

        current_question = session.get("question") or {}
        if session.get("done") or request.question_id != current_question.get("id"):
            raise HTTPException(
                status_code=409,
                detail=session_projection(session_id, session).model_dump(),
            )

        answer_text = request.answer_text.strip()
        if not answer_text:
            raise HTTPException(status_code=400, detail="答点什么再提交——空答案没有可挖的东西。")

        try:
            turn = run_turn(
                llm=app_llm,
                session=session,
                answer_text=answer_text,
                chosen_option=request.chosen_option,
            )
        except (LlmError, GrillError) as error:
            raise HTTPException(status_code=502, detail=str(error)) from error

        # 这里之后不再有失败点：一次 update 把整轮的产出写进去。
        sessions.update(
            session_id,
            tree=turn["tree"],
            facts=[*session["facts"], *turn["facts"]],
            history=[*session["history"], turn["turn"]],
            question=turn["question"],
            done=turn["done"],
            # 树问空了才是「问到底了」；用户叫停走 /stop，记 "stopped"。
            closed_by="exhausted" if turn["done"] else None,
        )

        return GrillAnswerResponse(
            facts=fact_views(turn["facts"]),
            question=turn["question"],
            done=turn["done"],
        )

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
