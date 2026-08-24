"""拷问开场：定靶（JD + 选料）→ 规划挖掘树 → 出首题。

这一片只管**开场**：把选中的料和 JD 拼成一次 LLM 调用，让模型先读完料、
规划一棵「想挖的点」的树，再从树上摘第一题。作答与收口是下一片的事。

三条产品约束落在这里，不在别处：

1. **基线认定**：拷问的靶子是「原简历 vs 新简历」，没有原简历就没有对比基准，
   所以进场的料必须含至少一份 `resume`。多份取最新 `synced_at`——用户传了新版
   简历就该按新版问。响应回显 `baseline_crumb_id`，让前端能说清「拿哪份当底稿」。

2. **先查料，再问人**（`SYSTEM_PROMPT` 的硬规则）：料里已经写清楚的信息禁止再问
   用户。这是 spec 里 user story 16 的落点，也是拷问区别于「多聊两句」的地方。

3. **空树即失败**：模型没规划出任何想挖的点，等于这次调用没干活。重试由 LLM 封装
   负责（超时 / 5xx / 解析失败各重试一次），封装返回后树仍为空就抛 `GrillError`，
   HTTP 层映射 502——调用方可安全重发，因为规划无副作用。
"""

from typing import Any, Dict, List, Optional

from .llm import Llm


# 单份料入 prompt 的字符上限。八千字约等于一份长简历或一个大 repo 摘要，
# 再长的尾巴对「该问什么」几乎没有边际贡献，却会挤掉别的料。截断处留明确
# 标记，让模型知道自己看到的是残篇，不至于把「后面没写」误当成真缺口。
CRUMB_CHAR_LIMIT = 8000
TRUNCATION_NOTICE = "\n……（本份料超长，已截断，后文未提供）"

# JD 同样截断：一份 JD 再长也不该把料挤出上下文。
JD_CHAR_LIMIT = 8000


class GrillError(RuntimeError):
    """拷问逻辑本身失败（比如模型交回空树）。HTTP 层映射 502。"""


# 开场调用的结构化输出形状。`tree` 是挖掘树的前沿（想挖的点），`question` 是
# 从树上摘下来的第一题。两者一次调用同时产出——分两次调用会让首题脱离树，
# 「还剩 n 个想挖的点」也就无从算起。
OPENING_SCHEMA: Dict[str, Any] = {
    "type": "object",
    "properties": {
        "tree": {
            "type": "array",
            "description": "想挖的点（挖掘树前沿），按重要性排序",
            "items": {
                "type": "object",
                "properties": {
                    "id": {"type": "string"},
                    "topic": {"type": "string", "description": "这个点想挖什么"},
                    "why": {"type": "string", "description": "为什么这个点值得挖"},
                },
                "required": ["id", "topic", "why"],
                "additionalProperties": False,
            },
        },
        "question": {
            "type": "object",
            "properties": {
                "id": {"type": "string", "description": "对应 tree 里某个点的 id"},
                "text": {"type": "string", "description": "问给用户看的那句话"},
                "why": {
                    "type": "string",
                    "description": "为什么问这个，必须指向具体某份料或 JD 的某条要求",
                },
                "options": {
                    "type": "array",
                    "description": "3-4 个选项，把回忆题变成辨认题",
                    "items": {
                        "type": "object",
                        "properties": {
                            "key": {"type": "string"},
                            "text": {"type": "string"},
                        },
                        "required": ["key", "text"],
                        "additionalProperties": False,
                    },
                },
                "recommended": {
                    "type": "object",
                    "description": "推荐哪个选项，以及推荐理由",
                    "properties": {
                        "key": {"type": "string"},
                        "reason": {"type": "string"},
                    },
                    "required": ["key", "reason"],
                    "additionalProperties": False,
                },
            },
            "required": ["id", "text", "why", "options", "recommended"],
            "additionalProperties": False,
        },
    },
    "required": ["tree", "question"],
    "additionalProperties": False,
}


SYSTEM_PROMPT = """你是一个简历拷问官。你的任务是把用户散落的材料（「料」）问成一份
拿得出手的个人资产，靶子是一份具体的目标岗位 JD。

你现在做的是**开场**：读完用户的全部料和 JD，规划一棵「想挖的点」的树，然后问出第一题。

## 硬规则

1. **先查料，再问人。** 料里已经写清楚的信息，禁止再问用户。你问的每一个点，都必须是
   料里没有、或者写得含糊到无法支撑 JD 某条要求的东西。如果你想问的东西料里已经有了，
   换一个点。这是最重要的一条——问用户已经告诉过你的事，是在浪费他的时间。
2. **每个问题都要能回答「你凭什么问我这个」。** `why` 字段必须指向具体的某一份料
   （用它的名字）或 JD 里的某条要求（引原文片段），不许写「想多了解一下」这类空话。
3. **选项是台阶，不是选择题。** 每题给 3-4 个选项，覆盖这个点最可能的几种真实情况，
   让用户在想不起来时有辨认的抓手。推荐项要挑最可能命中的那个，理由要说清你为什么
   这么猜（基于哪份料的哪个线索）。
4. **不许编造。** 你在选项和推荐理由里做的是**猜测**，措辞要让用户看得出这是猜测，
   而不是断言他做过某件事。
5. 一次只问一个问题。

## 挖掘树

`tree` 是你这场拷问想挖的所有点，按重要性排序。它是你的 scratchpad——用户每答一题，
你会更新它，问空了这场就收口。开场至少要规划出一个点，通常 4-8 个。

`question.id` 必须等于 `tree` 里你正在问的那个点的 id。

## 语言

全程用中文提问。用户是中文求职者。"""


def pick_baseline(crumbs: List[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    """选出当底稿的那份简历：`kind == "resume"` 里 `synced_at` 最新的一份。

    返回 None 表示进场的料里没有简历——调用方据此返回 422。
    """
    resumes = [crumb for crumb in crumbs if crumb.get("kind") == "resume"]
    if not resumes:
        return None
    return max(resumes, key=lambda crumb: crumb.get("synced_at") or "")


def truncate(text: str, limit: int, notice: str = TRUNCATION_NOTICE) -> str:
    """截断超长文本，并在截断处留明确标记。

    标记不能省：模型看不出自己拿到的是残篇的话，会把截断处当成真的结尾，
    于是「后面没写」被误判成真缺口。作答那一片截断用户的长答案，同理。
    """
    if len(text) <= limit:
        return text
    return text[:limit] + notice


def build_opening_messages(
    *,
    jd_text: str,
    crumbs: List[Dict[str, Any]],
    baseline_crumb_id: str,
) -> List[Dict[str, str]]:
    """把料和 JD 拼成开场调用的消息。

    料按「哪份是底稿」标注——模型需要知道拿哪份简历当对比基准，否则它分不清
    「这句话在简历里已经有了」和「这句话在某份笔记里提过」。
    """
    blocks: List[str] = []
    for index, crumb in enumerate(crumbs, start=1):
        role = "【当前简历 · 本场底稿】" if crumb["id"] == baseline_crumb_id else ""
        blocks.append(
            f"### 料 {index}{role}\n"
            f"- 名称：{crumb.get('display_name') or '未命名'}\n"
            f"- 类型：{crumb.get('kind')}\n"
            f"- 内容：\n{truncate(crumb.get('content') or '', CRUMB_CHAR_LIMIT)}"
        )

    user_content = (
        "## 目标岗位 JD（原文）\n\n"
        f"{truncate(jd_text, JD_CHAR_LIMIT)}\n\n"
        "## 用户的料\n\n"
        + "\n\n".join(blocks)
        + "\n\n---\n\n"
        "请先读完以上全部材料，规划出你这场想挖的点（挖掘树），然后问出第一个问题。"
        "记住：料里已经写清楚的东西，一个字都不要问。"
    )

    return [
        {"role": "system", "content": SYSTEM_PROMPT},
        {"role": "user", "content": user_content},
    ]


def open_session(
    *,
    llm: Llm,
    jd_text: str,
    crumbs: List[Dict[str, Any]],
    baseline_crumb_id: str,
) -> Dict[str, Any]:
    """跑一次开场调用，返回 `{"tree": [...], "question": {...}}`。

    LLM 的超时 / 5xx / 解析失败重试由封装负责，这里只管产出是否可用：
    空树等于这次调用没干活，抛 `GrillError`。
    """
    result = llm.complete(
        messages=build_opening_messages(
            jd_text=jd_text, crumbs=crumbs, baseline_crumb_id=baseline_crumb_id
        ),
        schema_name="grill_opening",
        schema=OPENING_SCHEMA,
    )

    tree = result.get("tree") or []
    question = result.get("question") or {}
    if not tree:
        raise GrillError("LLM planned an empty excavation tree")
    if not question.get("text"):
        raise GrillError("LLM returned no opening question")

    return {"tree": tree, "question": question}


def question_view(question: Dict[str, Any], tree: List[Dict[str, Any]]) -> Dict[str, Any]:
    """把模型交回的题 + 树折成前端要的问题卡形状。

    `remaining` 是「还剩 n 个想挖的点」：树上除了正在问的这个点之外还剩几个。
    它是从树推导的，不是模型自报的数字——自报的数字会和树对不上。
    """
    asked_id = question.get("id")
    remaining = sum(1 for node in tree if node.get("id") != asked_id)
    return {
        "id": asked_id or "",
        "text": question.get("text", ""),
        "why": question.get("why", ""),
        "options": [
            {"key": option.get("key", ""), "text": option.get("text", "")}
            for option in question.get("options") or []
        ],
        "recommended": {
            "key": (question.get("recommended") or {}).get("key", ""),
            "reason": (question.get("recommended") or {}).get("reason", ""),
        },
        "remaining": remaining,
    }
