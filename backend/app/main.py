from concurrent.futures import ThreadPoolExecutor, as_completed
from contextlib import asynccontextmanager
from datetime import datetime, timezone
import hashlib
from pathlib import Path
import re
import sqlite3
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
from .github import MAX_CONCURRENCY, GitHub, GitHubError, HttpGitHub
from .grill import GrillError, open_session, pick_baseline, question_view
from .llm import Llm, LlmError, OpenAiLlm
from .repos import (
    RepoUrlError,
    build_repo_summary,
    normalize_full_name,
    parse_repo_url,
    repo_has_substance,
)
from .rewrite import cache_key, run_rewrite
from .schemas import (
    CrumbListResponse,
    CrumbView,
    FactView,
    GitHubRepoListResponse,
    GitHubRepoView,
    GitHubTokenRequest,
    GitHubTokenResponse,
    GrillAnswerRequest,
    GrillAnswerResponse,
    GrillSessionRequest,
    GrillSessionResponse,
    GrillSessionView,
    HealthResponse,
    RepoConnectRequest,
    RepoConnectResponse,
    RepoResult,
    RewriteHistoryResponse,
    RewriteRequest,
    RewriteResponse,
    RewriteVersionView,
    UploadResponse,
)
from .sessions import GrillSessionStore
from .tokens import TokenStore


CHUNK_SIZE = 1024 * 1024
VALID_KINDS = {"resume", "repo", "notes", "diary", "social", "linkedin", "manual"}

# GitHub 适配器的状态码 → 逐项包络里的失败种类。见 `RepoResult.error_kind`。
_ERROR_KINDS = {
    401: "unauthorized",
    404: "not_found",
    429: "rate_limit",
    502: "fetch_failed",
}

# 一次批量最多连多少个仓库。上限的理由是「拉 50 个仓库要打 200 个 GitHub
# 端点、几分钟不返回」——那时用户早已经以为页面卡死了。超出的部分不静默丢掉，
# 逐项包络里逐个说明。
MAX_BATCH_REPOS = 20

# 列表最多回多少行。适配器已经在 10 页处截断（1000 个），这一层再收一次是
# 因为「一屏能挑得动多少」和「拉得到多少」是两回事。截断时明说，不静默。
MAX_LISTED_REPOS = 300


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



def new_crumb(
    user_id: str,
    kind: str,
    display_name: str,
    content: str,
    content_hash: Optional[str] = None,
) -> Dict[str, Any]:
    """建一份料的行。

    两个建库入口（上传附件、连仓库）共用它，因为 `token_count` 的算法是一条领域
    规则，不是某个端点的实现细节——分别写两遍，改预算口径时就会漏掉一处。

    `content_hash` 可传：上传那条路是流式读文件时顺手算出来的，不必让内容再过
    一遍 sha256。不传就按内容算。
    """
    return {
        "id": str(uuid4()),
        "user_id": user_id,
        "kind": kind,
        "display_name": display_name,
        "content": content,
        "content_hash": content_hash or hashlib.sha256(content.encode("utf-8")).hexdigest(),
        "token_count": max(1, len(content) // 4),
        "synced_at": utc_now(),
    }

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
    # GitHub 凭据仓：纯内存，无镜像、无 SQLite。见 tokens.TokenStore 的
    # 模块注释——「PAT 不落任何地方」是那个类型本身的性质，不靠这里自觉。
    tokens = TokenStore()

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
    app.state.tokens = tokens
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

            crumb = new_crumb(
                user_id,
                infer_kind(kind, suffix),
                original_name,
                content,
                content_hash=content_hash,
            )
            now = crumb["synced_at"]
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

    # --- GitHub 连接 ---------------------------------------------------------
    #
    # 三个端点是一条链：贴 token → 看列表 → 勾选批量拉取。分成三个而不是一个
    # 「连 GitHub」大端点，因为中间那一步是**用户在做决定**——他要看着私有标记
    # 和最近推送时间挑哪几个仓库值得进场。把挑选折进一次调用，等于替他决定。

    @app.post("/api/v1/github/token", response_model=GitHubTokenResponse)
    def connect_github_token(
        request: GitHubTokenRequest, user_id: str = Depends(current_user_id)
    ) -> GitHubTokenResponse:
        """存一个 PAT，并当场验证它是不是真的能用。

        **存之前先验**：不验的话，用户贴错 token 要到下一步（拉列表）才发现，
        而那时的报错指向的是「列表拉不到」，不是「你贴的 token 不对」。一次
        `/user` 调用就能把错误归位到真正的原因上。

        空 token 是「断开连接」：清掉已存的那份，回 `connected=False`。这条路
        不打 GitHub——断开不需要 GitHub 同意。
        """
        raw = (request.token or "").strip()
        if not raw:
            tokens.clear(user_id)
            return GitHubTokenResponse(connected=False)

        try:
            identity = app_github.verify_token(raw)
        except GitHubError as error:
            # 401 是「这个 token 不行」（用户能修），其余是「我们没能验成」
            # （用户修不了）。合成同一个状态码会让前者收到一句「稍后重试」——
            # 而他重试一百次也不会好。
            raise HTTPException(
                status_code=401 if error.status_code == 401 else 502, detail=str(error)
            ) from error
        except Exception as error:  # noqa: BLE001 — 适配器的意外失败不该是 500
            raise HTTPException(
                status_code=502, detail=f"没能验证这个 token：{error}"
            ) from error

        tokens.set(user_id, raw)
        return GitHubTokenResponse(connected=True, login=identity.get("login") or None)

    @app.get("/api/v1/github/repos", response_model=GitHubRepoListResponse)
    def list_github_repos(
        user_id: str = Depends(current_user_id),
    ) -> GitHubRepoListResponse:
        """token 可见的全部仓库（含私有），最近推送的排前面。

        没存 token 就是 401：这不是「列表是空的」。空列表会让前端画一个「你没有
        仓库」的空态，而真相是「你还没连 GitHub」——两者的出路完全不同。
        """
        token = tokens.get(user_id)
        if token is None:
            raise HTTPException(
                status_code=401, detail="还没连 GitHub。先贴一个 Personal Access Token。"
            )

        try:
            repos = app_github.list_repos(token)
        except GitHubError as error:
            if error.status_code == 401:
                # token 已经失效（用户在 GitHub 那边撤销/过期了）。留着它只会让
                # 接下来每一次拉取都撞同一堵墙，所以当场清掉——前端收到 401 就
                # 知道该重新要一次 PAT。
                tokens.clear(user_id)
            raise HTTPException(
                status_code=error.status_code or 502, detail=str(error)
            ) from error
        except Exception as error:  # noqa: BLE001
            raise HTTPException(
                status_code=502, detail=f"没能拉到你的仓库列表：{error}"
            ) from error

        return GitHubRepoListResponse(
            repos=[GitHubRepoView(**repo) for repo in repos[:MAX_LISTED_REPOS]],
            truncated=len(repos) > MAX_LISTED_REPOS,
        )

    def _failed(full_name: str, message: str, kind: str) -> RepoResult:
        return RepoResult(full_name=full_name, ok=False, error=message, error_kind=kind)

    def fetch_one_repo(full_name: str, token: Optional[str]) -> Any:
        """拉一个仓库 → 仓库数据，或一条失败结果。**永不抛异常**（除程序错误）。

        和「入库」分开，是为了让批量那条路能把这一半**并发**跑起来：拉取是
        纯网络等待，入库是 SQLite 写。合在一起就只能整个串行——20 个仓库要打
        80 次 GitHub，一个请求几分钟不返回，用户早以为页面卡死了。
        """

        def failed(message: str, kind: str) -> RepoResult:
            return _failed(full_name, message, kind)

        try:
            repo = app_github.fetch_repo(full_name, token)
        except GitHubError as error:
            # 适配器算出的状态码在这里翻成 `error_kind`。翻译而不是直接透出数字：
            # 整个响应是 200（逐项包络），一个裸的 404 字段只会让人以为响应本身是
            # 404。丢掉这一层区分是不行的——批量连仓时「等会儿重试」和「重试也没用」
            # 是两种完全不同的处置。
            return failed(str(error), _ERROR_KINDS.get(error.status_code, "fetch_failed"))
        except NotImplementedError:
            # 适配器还没接（接缝占位）。这是程序错误，不该伪装成一次拉取失败。
            raise
        except Exception as error:  # noqa: BLE001 — 适配器的意外失败也只是这一项失败
            return failed(f"没能从 GitHub 拉到 {full_name}：{error}", "fetch_failed")

        if not repo_has_substance(repo):
            return failed(
                f"{full_name} 里没有可拷问的内容——没有 README、没有 commit、也没有文件。",
                "empty",
            )
        return repo

    def store_one_repo(user_id: str, full_name: str, repo: Dict[str, Any]) -> RepoResult:
        """仓库数据 → 一份 repo 料（upsert）→ 一条逐项结果。

        **只在单线程里调用。** 上面那一半可以并发，这一半不行：它读一次库
        （找同名旧料）再写一次，两个线程同时给同一个仓库做这件事会互相顶掉。
        """

        def failed(message: str, kind: str) -> RepoResult:
            return _failed(full_name, message, kind)

        content = build_repo_summary(repo)
        existing = database.find_crumb_by_display_name(user_id, "repo", full_name)
        # 内容哈希仍然写（由工厂按内容算）：附件上传那条路按它去重，仓库料虽然
        # 走 upsert，也得有个不与别人冲突的值。
        crumb = new_crumb(user_id, "repo", full_name, content)
        try:
            database.upsert_crumb(crumb, replaces_id=existing["id"] if existing else None)
        except sqlite3.IntegrityError:
            # 同一份内容已经作为**别的**料存在（同 user 的 content_hash 唯一约束）。
            # 比如用户先把 README 当文件上传过，再来连仓库，两边抽出的文本一字不差。
            #
            # 这不是失败：用户要的是「这个仓库的内容进到我的料里」，而它已经在了。
            # 报错会把人堵死——他没有任何操作能让自己脱困（除了先去删掉那份上传），
            # 而上传那条路遇到同样的情况是返回已有的料（`duplicate: true`）。所以
            # 这里也把已有的那份交回去，语义对齐。
            twin = database.find_crumb_by_hash(user_id, crumb["content_hash"])
            if twin is None:
                # 约束是被别的什么撞的，我们没能力解释——按拉取失败交代。
                return failed(f"没能把 {full_name} 存成一份料，请稍后重试。", "fetch_failed")
            return RepoResult(
                full_name=full_name,
                ok=True,
                crumb=make_crumb_view(twin),
                # 没有新建也没有替换，交回的是本来就在的那份。
                updated=False,
            )

        return RepoResult(
            full_name=full_name,
            ok=True,
            crumb=make_crumb_view(crumb),
            updated=existing is not None,
        )

    def connect_one_repo(user_id: str, full_name: str, token: Optional[str]) -> RepoResult:
        """拉 + 入库。贴 URL 那条路只连一个仓库，没有并发可言，就直接串起来。"""
        fetched = fetch_one_repo(full_name, token)
        if isinstance(fetched, RepoResult):
            return fetched
        return store_one_repo(user_id, full_name, fetched)

    @app.post("/api/v1/repos", response_model=RepoConnectResponse)
    def connect_repo(
        request: RepoConnectRequest, user_id: str = Depends(current_user_id)
    ) -> RepoConnectResponse:
        """连仓库：拉元数据 + README + 近期 commit + 顶层文件树 → 每个仓库一份 repo 料。

        两个入口：`{url}` 贴一个地址，`{full_names}` 批量勾选。

        **响应总是 200，失败装在逐项包络里。** 单个仓库时这看起来绕，但批量连仓
        时「三个成功两个失败」没有一个 HTTP 状态码能表达——一项失败不该让已经拉
        到的那几个也丢掉。

        唯一的例外是请求本身不合法（400）：URL 认不出、`url` 和 `full_names` 都
        没给或都给了。那时不存在「哪一项失败了」，逐项包络没有主键可用。

        **有 token 就带上。** 于是贴 URL 那条路也能连私有仓——用户已经授权过了，
        还要求他为私有仓换一个入口是没有道理的。

        **upsert 而不是去重。** 同一个仓库重拉，内容几乎必然变了（新 commit、
        改过的 README），按 content_hash 去重会让它在料列表里堆成好几条。仓库的
        身份是 `full_name`，所以按 `(kind='repo', display_name=full_name)` 替换。
        """
        has_url = bool((request.url or "").strip())
        has_names = request.full_names is not None
        if has_url == has_names:
            raise HTTPException(
                status_code=400,
                detail="给一个 url（贴地址），或者一组 full_names（批量勾选），二选一。",
            )

        token = tokens.get(user_id)

        if has_url:
            try:
                full_name = parse_repo_url(request.url or "")
            except RepoUrlError as error:
                raise HTTPException(status_code=400, detail=str(error)) from error
            return RepoConnectResponse(results=[connect_one_repo(user_id, full_name, token)])

        names = request.full_names or []
        if not names:
            raise HTTPException(status_code=400, detail="一个仓库都没勾选。")

        # 先把名字过一遍：形状不对的、重复的、超出上限的当场定案，剩下的才值得
        # 去打 GitHub。**结果按请求里的顺序排**——用户勾选的顺序就是他阅读结果的
        # 顺序，按完成先后返回会让同一次操作每次长得不一样。
        planned: List[Any] = []       # RepoResult（已定案）或 str（待拉取）
        seen: set = set()
        for raw in names:
            # 形状不对的那一项自己失败，不带走整批：批量请求里混进一个坏名字，
            # 让另外十九个也拉不到是说不过去的。
            try:
                full_name = normalize_full_name(raw)
            except RepoUrlError as error:
                planned.append(
                    RepoResult(
                        full_name=str(raw), ok=False, error=str(error), error_kind="bad_name"
                    )
                )
                continue
            # 同一个仓库在一批里出现两次，第二次是 upsert 掉自己刚建的那份——
            # 白打一轮 GitHub 请求，还会让前端收到两条 id 不同的同名料。
            if full_name in seen:
                continue
            seen.add(full_name)

            if len(seen) > MAX_BATCH_REPOS:
                planned.append(
                    RepoResult(
                        full_name=full_name,
                        ok=False,
                        error=(
                            f"一次最多连 {MAX_BATCH_REPOS} 个仓库，这个没连。"
                            "分几批勾选就行。"
                        ),
                        # 自成一种，不能混进 fetch_failed：那一种前端会给「把
                        # README 当文件上传」的兜底指引，而这一项的出路是「再勾
                        # 一次」——给错建议比不给建议更耽误人。
                        error_kind="overflow",
                    )
                )
                continue
            planned.append(full_name)

        # 并发拉取，上限 MAX_CONCURRENCY。拉取是纯网络等待，串行跑 20 个仓库
        # 就是 80 次 GitHub 往返排成一队——一个请求几分钟不返回，用户早以为
        # 页面卡死了。上限不放开是因为配额：并发再高也只是更快撞限流。
        pending = [name for name in planned if isinstance(name, str)]
        fetched: Dict[str, Any] = {}
        if pending:
            with ThreadPoolExecutor(max_workers=min(MAX_CONCURRENCY, len(pending))) as pool:
                futures = {
                    pool.submit(fetch_one_repo, name, token): name for name in pending
                }
                for future in as_completed(futures):
                    name = futures[future]
                    try:
                        fetched[name] = future.result()
                    except Exception as error:  # noqa: BLE001 — 这一项失败，不是整批
                        fetched[name] = _failed(
                            name, f"没能从 GitHub 拉到 {name}：{error}", "fetch_failed"
                        )

        # 入库是顺序的：SQLite 写 + 「找同名旧料再替换」这一读一写不能并发。
        results: List[RepoResult] = []
        for item in planned:
            if isinstance(item, RepoResult):
                results.append(item)
                continue
            outcome = fetched[item]
            results.append(
                outcome
                if isinstance(outcome, RepoResult)
                else store_one_repo(user_id, item, outcome)
            )

        return RepoConnectResponse(results=results)

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
            # 成稿版本历史，改写那一片追加。空 = 还没出过初稿。
            rewrites=[],
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

    def rewrite_view(version: Dict[str, Any], original_text: str) -> RewriteResponse:
        return RewriteResponse(
            version=version["version"],
            original_text=original_text,
            segments=version["segments"],
            stats=version["stats"],
            instruction=version.get("instruction"),
            refusal=version.get("refusal"),
        )

    def baseline_text_of(session: Dict[str, Any], user_id: str) -> str:
        """取底稿简历的正文。

        会话只记 `baseline_crumb_id`，正文每次现从库里读——把整份简历也塞进会话
        状态会让内存仓和 dev 镜像里多一份随时可能和料库对不上的副本。
        料被删掉是可能的（用户在别处删了它），那时底稿为空串：改写照样能跑，
        只是左边没有可比的原文，成稿全部落在账本上。
        """
        rows = database.list_crumbs_by_ids(user_id, [session["baseline_crumb_id"]])
        return rows[0]["content"] if rows else ""

    @app.post(
        "/api/v1/grill/sessions/{session_id}/rewrite",
        response_model=RewriteResponse,
    )
    def rewrite_session(
        session_id: str,
        request: RewriteRequest,
        user_id: str = Depends(current_user_id),
    ) -> RewriteResponse:
        """出初稿，或按一条自然语言指令改稿。

        `instruction` 为空 = 初稿（v1）；带指令 = 在最新一版上改，版本 +1。

        三条不变量在这里守住：

        **缓存按参数**（issue #27 验收）。同一版本 + 同一指令重复调用返回缓存，不烧第二次
        token——双击「改稿」、网络重发都走这条。缓存查在调 LLM 之前。

        **失败原子性**（同 `run_turn` 的纪律）。`run_rewrite` 是纯函数不碰会话仓，
        版本在它成功返回之后一次性追加。LLM 失败时历史一个字没变，同一指令可安全重发。

        **拒绝是 200 不是错误**。指令要求编造未挖到的经历时，成稿维持上一版原样，
        `refusal` 带上理由。走错误码会诱使前端把它当故障重试，而重试一条编造指令
        没有意义——用户需要读到的是「为什么不给你写」。
        """
        session = load_session(session_id, user_id)
        versions: List[Dict[str, Any]] = session.get("rewrites") or []
        instruction = (request.instruction or "").strip() or None
        base_version = versions[-1]["version"] if versions else 0

        if instruction is None and versions:
            # 无指令 = 「给我看初稿」。已经出过稿就把最新一版交回去，不重跑一次
            # LLM——前端每次进对比视图都会调这个端点。
            return rewrite_view(versions[-1], baseline_text_of(session, user_id))

        # 缓存查的是**最新那一版**是不是正好由这条指令产出的。双击「改稿」、网络
        # 重发都长这样：第一次已经把 v2 写好了，第二次带着同一条指令再来。
        #
        # 不扫全部历史：同一条指令在 v1 上和在 v2 上是两次不同的改写（「口语一点」
        # 改过一轮之后再来一次，用户要的是在当前这版上继续，不是回到那个旧版）。
        # `cache_key` 带上底版本号，正是为了让这两次不互相顶掉。
        #
        # `base_version - 1` 不是笔误：存进去的键记的是那一版**当初的底版本**，
        # 而它自己就是现在的 `base_version`，所以它的底版本比现在小一。
        if versions and tuple(versions[-1].get("cache_key") or ()) == cache_key(
            base_version - 1, instruction
        ):
            return rewrite_view(versions[-1], baseline_text_of(session, user_id))

        baseline_text = baseline_text_of(session, user_id)
        try:
            produced = run_rewrite(
                llm=app_llm,
                session=session,
                baseline_text=baseline_text,
                crumbs=database.list_crumbs_by_ids(user_id, session.get("crumb_ids") or []),
                instruction=instruction,
                previous=versions[-1] if versions else None,
            )
        except (LlmError, GrillError) as error:
            raise HTTPException(status_code=502, detail=str(error)) from error

        version = {
            "version": base_version + 1,
            "instruction": instruction,
            "segments": produced["segments"],
            "stats": produced["stats"],
            "refusal": produced["refusal"],
            # 记下这一版是「在哪一版上执行哪条指令」得来的——下一次同样的请求
            # 靠它认出自己是一次重发。
            "cache_key": list(cache_key(base_version, instruction)),
            "created_at": utc_now(),
        }
        sessions.update(session_id, rewrites=[*versions, version])

        return rewrite_view(version, baseline_text)

    @app.get(
        "/api/v1/grill/sessions/{session_id}/rewrite/versions",
        response_model=RewriteHistoryResponse,
    )
    def list_rewrite_versions(
        session_id: str, user_id: str = Depends(current_user_id)
    ) -> RewriteHistoryResponse:
        """版本步进器的数据源：有哪些版本、各自是哪条指令改出来的。"""
        session = load_session(session_id, user_id)
        return RewriteHistoryResponse(
            versions=[
                RewriteVersionView(
                    version=version["version"], instruction=version.get("instruction")
                )
                for version in session.get("rewrites") or []
            ]
        )

    @app.get(
        "/api/v1/grill/sessions/{session_id}/rewrite/{version}",
        response_model=RewriteResponse,
    )
    def get_rewrite_version(
        session_id: str, version: int, user_id: str = Depends(current_user_id)
    ) -> RewriteResponse:
        """回看某一版。「比较并回到更好的一版」的读路径。

        回看是纯读：不把旧版复制成新版。用户在 v3 上回看 v1 之后再改稿，改的仍然是
        v3——「回到 v1 再改」是另一个产品动作，本切片不做（issue #22 明确把多版本
        并排对比划在范围外）。
        """
        session = load_session(session_id, user_id)
        found = next(
            (item for item in session.get("rewrites") or [] if item["version"] == version),
            None,
        )
        if found is None:
            raise HTTPException(status_code=404, detail="没有这一版成稿。")
        return rewrite_view(found, baseline_text_of(session, user_id))

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
