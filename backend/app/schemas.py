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


class GrillAnswerRequest(BaseModel):
    """一次作答。

    `question_id` 是幂等键：带上「我答的是哪道题」，重发才分得清「网络抖了一下」
    和「又答了一次」。`chosen_option` 可空——选项是台阶，不是必答的选择题。
    """

    question_id: str
    answer_text: str
    chosen_option: Optional[str] = None


class FactView(BaseModel):
    """账本里的一条事实。

    `turn_id` 是它的出处指针：账本里点一条，能跳回它来自的那一问；
    `round` 是那一问的编号（从 1 起），给用户看的「来自第 N 问」。
    出处不可为空是 ADR-0002 的红线，强制在事实构造处（`answer.py`）。
    """

    id: str
    text: str
    turn_id: str
    round: int


class GrillAnswerResponse(BaseModel):
    """一轮作答的产出：新落账的事实 + 下一题，或者收口。

    `question` 与 `done` 互斥：`done=True` 时 `question` 必为 null。
    """

    facts: List[FactView]
    question: Optional[QuestionView] = None
    done: bool


class GrillSessionView(BaseModel):
    """会话全投影：刷新页面后，前端只拿这一个响应就能把现场原样重画出来。

    不含料的正文——料前端已经有了（读全局 store），投影再发一遍只是白费带宽。
    """

    session_id: str
    baseline_crumb_id: str
    jd_text: str
    facts: List[FactView]
    question: Optional[QuestionView] = None
    done: bool
    # 怎么收的口：exhausted 树问空了 / stopped 用户叫停 / null 还没收口。
    # 两种收口的文案不同——「问到底了」和「你叫停了」对用户是两件事。
    closed_by: Optional[str] = None
    # 已答轮数。前端拿它给问题卡编号（「第 n 问」），也决定「够了」按钮的措辞。
    answered_count: int

