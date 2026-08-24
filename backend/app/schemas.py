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


# --- 成稿改写 ---------------------------------------------------------------


class RewriteRequest(BaseModel):
    """一次改写。

    `instruction` 为空 = 出初稿（v1）；带指令 = 在上一版基础上改稿，版本 +1。
    指令只能改表达不能改事实——这条由改写 prompt 与拒绝路径守住，不在这里校验。
    """

    instruction: Optional[str] = None


class SegmentView(BaseModel):
    """成稿里的一段，以及它的出处。

    `source` 三取一：`original` 原简历本来就有、`turn:<turn_id>` 拷问某一轮挖到的、
    `crumb:<crumb_id>` 某份料里读到的。金色染色读的就是它——非 `original` 即金色。

    `fact_ids` 指回账本：hover 金色片段要显示「来自第几轮的哪个问答」，
    靠的是这些 id 反查账本条目的 `turn_id` 与 `round`。
    """

    text: str
    source: str
    fact_ids: List[str] = []
    # 这一段来自第几轮（`source` 为 turn 时才有）。前端不必自己反查账本。
    round: Optional[int] = None
    # 那一轮问了什么、用户怎么答的——hover 卡片的正文。
    question_text: Optional[str] = None
    answer_text: Optional[str] = None


class RewriteStats(BaseModel):
    """一眼看到「同一段经历，x 处是刚从我嘴里挖出来的」。"""

    total_segments: int
    grilled_segments: int
    fact_count: int


class RewriteResponse(BaseModel):
    """一版成稿。

    `original_text` 每版都带：左右对比视图左边永远是原简历，前端不必自己去
    料库里捞底稿——它拿到的 crumb 列表里未必有当前会话的那一份。
    """

    version: int
    original_text: str
    segments: List[SegmentView]
    stats: RewriteStats
    # 产出这一版的指令（初稿为 null）。版本步进器上写「v2 · 口语一点」。
    instruction: Optional[str] = None
    # 指令被拒时为拒绝理由，此时成稿维持上一版原样。
    refusal: Optional[str] = None


class RewriteVersionView(BaseModel):
    """版本历史里的一项。回看旧版走 `GET .../rewrite/{version}`。"""

    version: int
    instruction: Optional[str] = None


class RewriteHistoryResponse(BaseModel):
    versions: List[RewriteVersionView]


# --- 仓库料 -----------------------------------------------------------------


class GitHubTokenRequest(BaseModel):
    """贴一个 GitHub Personal Access Token。

    PAT 是**台阶不是终点**：产品形态是 OAuth device flow（见 TODOS.md）。升级
    时只换 token 的获取方式，这个请求体连同下游两个端点（列表、批量拉取）都不
    变——所以这里叫 `token` 而不是 `pat`，device flow 拿到的也是一个 token。

    空串是合法的：那是「断开连接」，等同于把已存的 token 清掉。
    """

    token: str


class GitHubTokenResponse(BaseModel):
    """token 存了之后回什么。

    **绝不回显 token**，连尾四位都不回：前端已经知道用户刚贴了什么，回显只是
    多制造一条走漏路径。回的是「连上了没有」和这个 token 属于谁——后者是用户
    确认「我贴的是对的那个账号」的唯一依据。
    """

    connected: bool
    login: Optional[str] = None


class GitHubRepoView(BaseModel):
    """挑选界面里的一行仓库。"""

    full_name: str
    private: bool
    description: str = ""
    pushed_at: str = ""


class GitHubRepoListResponse(BaseModel):
    repos: List[GitHubRepoView]
    # 翻到页数上限时为 True。静默截断会让用户以为「我的仓库就这些」，
    # 然后去找一个明明存在却没出现在列表里的仓库。
    truncated: bool = False


class RepoConnectRequest(BaseModel):
    """连仓库：贴一个 URL，或勾选一批 `full_name`。

    `url` 而不是 `full_name`：用户手上有的是浏览器地址栏里那一串，让他自己
    切成 owner/name 是把解析工作外包给用户。

    `full_names` 是批量入口（勾选列表里的多个仓库）。两者共用一个端点而不是
    各开一个，因为它们之后的每一步——拉取、建摘要、upsert、逐项包络——完全相同；
    分成两个端点只会让同一段逻辑有两个入口，日后改 upsert 规则得记住改两处。

    恰好给一个：两个都给或都不给都是 400（请求本身不合法，不是某一项失败）。
    """

    url: Optional[str] = None
    full_names: Optional[List[str]] = None


class RepoResult(BaseModel):
    """逐项结果。

    包络是逐项的，即使本票只连一个仓库——PAT 那一票要批量连（`{full_names}`），
    那时「一半成功一半失败」是常态。现在就按逐项定形，日后加批量入口不必破坏
    已经发出去的合同。

    `ok=True` 时 `crumb` 有值、`error` 为空，反之亦然。`updated` 只在成功时有
    意义：`True` 表示替换掉了同一个仓库的旧料。
    """

    full_name: str
    ok: bool
    crumb: Optional[CrumbView] = None
    updated: bool = False
    error: Optional[str] = None
    # 失败的**种类**，不只是一句话。包络把 HTTP 状态码吃掉了（整个响应是 200），
    # 所以四种失败的区分必须在这里活下来，否则调用方只剩一个字符串可看：
    # 批量连仓时分不出「限流了，等会儿重试」和「这个仓不存在，重试也没用」，
    # 前端也分不出该不该给「把 README 当文件上传」的兜底指引。
    #   not_found  仓库不存在或不可见（没连 token 时，私有仓也走这一种）
    #   unauthorized token 无效或过期——用户重贴一个就能修，和别的失败都不同
    #   rate_limit GitHub 限流，等一会儿能好
    #   fetch_failed 拉取失败（网络、GitHub 5xx、响应解析不了）
    #   empty      仓库拉到了但没有可拷问的内容
    #   bad_name   勾选/传进来的 full_name 形状不对（批量入口才会出现）
    #   overflow   超出单次批量上限，这一项没连（分批再勾一次就行）
    #
    # 曾经有过一种 `conflict`（摘要和已有的另一份料撞了），但那条路最后决定
    # 交回已有的那份、按成功处理（见 connect_one_repo 的 IntegrityError 分支），
    # 所以它从来没被发出去过，这里也就不留了。
    error_kind: Optional[str] = None


class RepoConnectResponse(BaseModel):
    results: List[RepoResult]
