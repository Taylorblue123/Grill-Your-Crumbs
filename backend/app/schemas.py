from typing import List, Optional

from pydantic import BaseModel


class AttachmentView(BaseModel):
    id: str
    original_name: str
    media_type: str
    byte_size: int
    extraction_status: str


class CrumbView(BaseModel):
    id: str
    kind: str
    display_name: str
    content: str
    token_count: int
    synced_at: str
    attachment: Optional[AttachmentView] = None


class UploadResponse(BaseModel):
    crumb: CrumbView
    duplicate: bool


class CrumbListResponse(BaseModel):
    crumbs: List[CrumbView]


class HealthResponse(BaseModel):
    status: str


# --- 拷问 -------------------------------------------------------------------


class GrillSessionRequest(BaseModel):
    """开场请求：定靶（JD）+ 选料。"""

    jd_text: str
    crumb_ids: List[str]


class QuestionOption(BaseModel):
    key: str
    text: str


class QuestionRecommendation(BaseModel):
    key: str
    reason: str


class QuestionView(BaseModel):
    """问题卡。选项 + 推荐项把「回忆题」变成「辨认题」，
    `why` 让每一问都能回答「你凭什么问我这个」，
    `remaining` 让用户看得见拷问的尽头。"""

    id: str
    text: str
    why: str
    options: List[QuestionOption]
    recommended: QuestionRecommendation
    remaining: int


class GrillSessionResponse(BaseModel):
    session_id: str
    # 回显拿哪份简历当底稿——多份简历时用户得知道产品选了哪一份。
    baseline_crumb_id: str
    question: QuestionView

