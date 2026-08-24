"""成稿改写：事实账本 → 带出处的段落，以及对话式改稿。

拷问收口之后的最后一段路。输入不是原始问答记录，而是**事实账本**——问答记录里
夹着语气词、跑题、答了一半又推翻的话，让模型自己从中挑事实等于把 `answer.py`
已经做过的事再做一遍，而且做得更差（那一次它手上有完整上下文，这一次没有）。
账本是那次抽取的结果，已经一条一句、条条带出处。

三条规则落在这里，不在别处：

1. **红线：真缺口不进生成上下文**（ADR-0002 后果 1）。这里的强制方式是**账本即全部
   事实来源**：没挖到的东西压根不在 prompt 里，模型没见过的东西谈不上围绕它编造。
   原简历也进上下文，但它进的身份是「基线」——照抄可以，`source` 记 `original`。

2. **出处靠 LLM 自证**（issue #22 评审张力 2，显式接受的风险）。模型给每段标 `source`
   和 `fact_ids`，服务端不做溯源校验——校验的防线在 eval 票。这里只做**引用完整性**
   的清洗：`fact_ids` 里指不到账本的 id 丢掉，`source` 指向不存在的轮次或没进场的料
   降级为 `original`。这不是溯源校验，只是不让前端拿到悬空指针。

3. **缓存按参数**（issue #27 验收）：同一版本 + 同一指令重复调用返回缓存，不烧第二次
   token。用户双击「改稿」、网络重发都会走到这条。缓存键是 `(base_version, instruction)`——
   同一句指令在 v1 上和在 v2 上是两次不同的改写。

改稿的**拒绝路径**是产品红线在这一片的出口：指令要求编造未挖到的经历时，模型交回
`refusal` 而不是照做，成稿维持上一版原样。拒绝不是错误——HTTP 200，前端把理由说给
用户听。让「拒绝」走错误码会诱使前端把它当故障重试，而重试一次编造指令没有意义。
"""

from typing import Any, Dict, List, Optional, Tuple

from .grill import GrillError, truncate
from .llm import Llm


# 原简历 / 单份料入 prompt 的字符上限，与开场同一量级。
BASELINE_CHAR_LIMIT = 8000
CRUMB_SUMMARY_CHAR_LIMIT = 2000
JD_CHAR_LIMIT = 8000
INSTRUCTION_CHAR_LIMIT = 500

# 出处前缀。前端读的是同一套字符串，改这里要同时改前端。
SOURCE_ORIGINAL = "original"
TURN_PREFIX = "turn:"
CRUMB_PREFIX = "crumb:"


REWRITE_SCHEMA: Dict[str, Any] = {
    "type": "object",
    "properties": {
        "segments": {
            "type": "array",
            "description": "改写后的简历，按段落切开。每段一条出处。",
            "items": {
                "type": "object",
                "properties": {
                    "text": {"type": "string", "description": "这一段的正文"},
                    "source": {
                        "type": "string",
                        "description": (
                            "这一段的出处，三取一："
                            "original（原简历本来就有这句话）、"
                            "turn:<轮次 id>（拷问某一轮挖出来的）、"
                            "crumb:<料 id>（某份料里读到的）"
                        ),
                    },
                    "fact_ids": {
                        "type": "array",
                        "description": "支撑这一段的账本事实 id；source 为 original 时可为空",
                        "items": {"type": "string"},
                    },
                },
                "required": ["text", "source", "fact_ids"],
                "additionalProperties": False,
            },
        },
        "refusal": {
            "type": ["string", "null"],
            "description": (
                "指令要求编造未挖到的经历时，写下拒绝理由（说清哪一条要求没有事实支撑）；"
                "正常改写时为 null"
            ),
        },
    },
    "required": ["segments", "refusal"],
    "additionalProperties": False,
}


SYSTEM_PROMPT = """你是一个简历改写者。用户刚被拷问完，你手上有一本**事实账本**——
那场拷问从他嘴里挖出来的、条条带出处的事实。你的任务是把原简历重写成一份新简历。

## 硬规则

1. **只写账本里有的和原简历里有的。** 账本没有、原简历也没有的事，一个字都不许写。
   你没看到某件事，不代表用户没做过——但那不是你能替他编的。宁可简历短一点。
2. **每一段都要标出处。** `source` 三取一：
   - `original`：这句话原简历里本来就有（你只是搬过来，或只改了措辞）
   - `turn:<轮次 id>`：这一段的内容是拷问某一轮挖出来的（账本里每条事实都标了它来自哪一轮）
   - `crumb:<料 id>`：这一段来自某份料
   同时把支撑这一段的账本事实 id 填进 `fact_ids`。标错出处比不标更糟——用户会拿它去核实。
3. **不许空词套话。** 「负责了」「参与了」「丰富的经验」「深入理解」「高度重视」这类词
   一个都不许出现。写具体做了什么、数字是多少、结果如何。做不到具体，就说明这件事
   账本里没挖够，那就别写它。
4. **不许排比堆砌。** 三句话同一个句式排下来是 AI 写的味道。句子长短要错落。
5. **说人话。** 用户是中文求职者，写中文。别翻译腔，别学术腔。

## 段落切分

按简历的自然结构切：一段经历的一条 bullet 是一段，标题行是一段。切太碎（切到半句）
会让出处标记失去意义，切太粗（整段经历一段）会让金色染色糊成一片。

## 语言

全程中文。"""


REVISION_PROMPT = """你是一个简历改写者。用户手上已经有一版成稿，现在给你一条改稿指令。

## 硬规则

1. **指令只能改表达，不能改事实。** 用户可以让你改语气、改长短、改结构、改措辞。
   但他**不能**让你添加账本里没有的经历、放大数字、把「参与」说成「主导」。
2. **要求编造就拒绝。** 指令若要求写入账本和原简历里都没有的事（「加一段大厂实习」
   「说我带过十个人」「把用户量写成一百万」），不要照做：把 `refusal` 写成一段说给用户
   听的话，讲清楚哪一条要求没有事实支撑、你为什么不写。这时 `segments` 交回**上一版
   原样**。这条没有例外——简历要经得起面试追问，编出来的那句话是用户在面试现场要
   自己扛的。
3. **出处标记不许丢。** 改完表达之后，每一段照旧标 `source` 和 `fact_ids`。一段话被
   改写、被拆开、被合并，它的出处跟着走。金色溯源要贯穿所有版本。
4. 原来那几条写作规则继续有效：不许空词套话、不许排比堆砌、说人话。

## 段落切分

沿用上一版的切法，除非指令本身就是要改结构（「第二段砍半」「合并成一段」）。

## 语言

全程中文。"""


def _ledger_block(facts: List[Dict[str, Any]], history: List[Dict[str, Any]]) -> str:
    """账本入 prompt：每条事实带上它的轮次 id 和轮号。

    轮次 id 必须出现在事实这一行上——模型要给段落标 `turn:<id>`，得知道每条事实
    对应哪个 id。让它自己去下面的问答记录里找对应关系，是在给它制造出错的机会。
    """
    if not facts:
        return "（空——这场拷问一条事实都没挖到，那就只能照原简历重写措辞）"

    rounds = {turn.get("id"): turn.get("question_text", "") for turn in history}
    lines = []
    for fact in facts:
        turn_id = fact.get("turn_id", "")
        lines.append(
            f"- [事实 id: {fact.get('id')}] [来自轮次 {TURN_PREFIX}{turn_id}，"
            f"第 {fact.get('round')} 问] {fact.get('text')}"
        )
        question = rounds.get(turn_id)
        if question:
            lines.append(f"    （那一问：{question}）")
    return "\n".join(lines)


def _crumbs_block(crumbs: List[Dict[str, Any]], baseline_crumb_id: str) -> str:
    """料摘要入 prompt。

    只给摘要不给全文：全文在开场那次调用里读过了，而改写真正的事实来源是账本。
    料在这里的作用是让模型认得出「这句话原简历里有」和「这句话某份料里提过」，
    摘要足够支撑这个判断。底稿本身另外整份入场，这里跳过。
    """
    others = [crumb for crumb in crumbs if crumb.get("id") != baseline_crumb_id]
    if not others:
        return "（除了底稿简历之外没有别的料）"
    return "\n\n".join(
        f"### 料 [{CRUMB_PREFIX}{crumb.get('id')}]\n"
        f"- 名称：{crumb.get('display_name') or '未命名'}\n"
        f"- 类型：{crumb.get('kind')}\n"
        f"- 摘要：\n{truncate(crumb.get('content') or '', CRUMB_SUMMARY_CHAR_LIMIT)}"
        for crumb in others
    )


def _previous_block(segments: List[Dict[str, Any]]) -> str:
    """上一版成稿入 prompt，连同它的出处标记。

    出处得一起送进去：改稿要求「出处标记不许丢」，而模型要保住一段话的出处，
    前提是它看得见那段话原来标的是什么。
    """
    return "\n".join(
        f"- [{segment.get('source')}] "
        f"[fact_ids: {', '.join(segment.get('fact_ids') or []) or '无'}] "
        f"{segment.get('text')}"
        for segment in segments
    )


def build_rewrite_messages(
    *,
    jd_text: str,
    baseline_text: str,
    crumbs: List[Dict[str, Any]],
    baseline_crumb_id: str,
    facts: List[Dict[str, Any]],
    history: List[Dict[str, Any]],
    previous_segments: Optional[List[Dict[str, Any]]],
    instruction: Optional[str],
) -> List[Dict[str, str]]:
    """拼改写消息。初稿和改稿走同一个函数，差别在系统提示词和多出来的两块。

    分成两个函数会让「账本怎么入场」「料怎么摘要」这些共同部分复制两份，
    而它们正是最容易改着改着两边不一致的地方。
    """
    blocks = [
        "## 目标岗位 JD（原文）\n\n" + truncate(jd_text, JD_CHAR_LIMIT),
        "## 原简历（底稿）\n\n" + truncate(baseline_text, BASELINE_CHAR_LIMIT),
        "## 事实账本（这场拷问挖到的全部事实）\n\n" + _ledger_block(facts, history),
        "## 其余的料（摘要）\n\n" + _crumbs_block(crumbs, baseline_crumb_id),
    ]

    if previous_segments is not None:
        blocks.append("## 上一版成稿（含出处标记）\n\n" + _previous_block(previous_segments))

    if instruction:
        blocks.append(
            "## 用户的改稿指令\n\n"
            + truncate(instruction, INSTRUCTION_CHAR_LIMIT)
            + "\n\n（记住：指令只能改表达不能改事实。要求编造就拒绝并说明理由。）"
        )
        tail = "请按用户的指令改这一版稿子。出处标记跟着每一段走，一个都不能丢。"
    else:
        tail = (
            "请把原简历重写成一份新简历。账本里的事实要用上，"
            "账本和原简历里都没有的事一个字都不要写。"
        )

    return [
        {"role": "system", "content": REVISION_PROMPT if instruction else SYSTEM_PROMPT},
        {"role": "user", "content": "\n\n".join(blocks) + "\n\n---\n\n" + tail},
    ]


def _clean_segments(
    raw_segments: Any,
    *,
    facts: List[Dict[str, Any]],
    history: List[Dict[str, Any]],
    crumb_ids: List[str],
) -> List[Dict[str, Any]]:
    """把模型交回的段落折成响应形状，顺手清掉悬空引用。

    这里做的**不是溯源校验**（那一条本轮显式不做，见模块开头与 TODOS.md）：不检查
    段落文字是否真的出自它标称的来源。做的只有引用完整性——指不到账本的 `fact_ids`
    丢掉、指不到真实轮次的 `turn:` 与指不到进场料的 `crumb:` 降级成 `original`。
    悬空指针会让前端 hover 一个染色片段却弹出空卡片（`crumb:` 那一种更糟：前端
    拿不到名字时会把原始 id 当标题显示出来），那是比「少标一处」更糟的破绽。

    降级而不是丢弃：段落本身是模型写出来的正文，出处标错不该让这句话从简历里消失。
    降成 `original` 的代价是它不染金色——少认领一处功劳，好过认领一处假的。
    """
    known_facts = {fact["id"]: fact for fact in facts}
    turns = {turn.get("id"): turn for turn in history}
    known_crumbs = set(crumb_ids)

    cleaned: List[Dict[str, Any]] = []
    for item in raw_segments or []:
        if not isinstance(item, dict):
            continue
        text = (item.get("text") or "").strip()
        if not text:
            continue

        source = (item.get("source") or SOURCE_ORIGINAL).strip() or SOURCE_ORIGINAL
        fact_ids = [
            fact_id
            for fact_id in item.get("fact_ids") or []
            if isinstance(fact_id, str) and fact_id in known_facts
        ]

        segment: Dict[str, Any] = {
            "text": text,
            "source": source,
            "fact_ids": fact_ids,
            "round": None,
            "question_text": None,
            "answer_text": None,
        }

        if source.startswith(TURN_PREFIX):
            turn = turns.get(source[len(TURN_PREFIX):])
            if turn is None:
                # 指向一个不存在的轮次：hover 会弹出空卡片，降级处理。
                segment["source"] = SOURCE_ORIGINAL
            else:
                segment["round"] = _round_of(turn, facts)
                segment["question_text"] = turn.get("question_text")
                segment["answer_text"] = turn.get("answer_text")
        elif source.startswith(CRUMB_PREFIX):
            # 指向一份没进场的料，同样降级：前端认不出这个 id，会把它当名字显示。
            if source[len(CRUMB_PREFIX):] not in known_crumbs:
                segment["source"] = SOURCE_ORIGINAL

        cleaned.append(segment)

    return cleaned


def _round_of(turn: Dict[str, Any], facts: List[Dict[str, Any]]) -> Optional[int]:
    """这一轮是第几问。账本上的 `round` 是绝对轮次，从任一条事实上读即可。

    抽不出事实的那一轮在账本里没有条目，于是这里返回 None——那一轮也不该被段落
    引用（它什么都没挖到），真出现了就让前端只显示问答不显示轮号。
    """
    for fact in facts:
        if fact.get("turn_id") == turn.get("id"):
            return fact.get("round")
    return None


def _stats(segments: List[Dict[str, Any]]) -> Dict[str, int]:
    """「同一段经历，x 处是刚从我嘴里挖出来的」——就是这个 x。

    `fact_count` 数的是被真正用上的事实（去重），不是账本总条数：账本里有 20 条
    而成稿只用上 8 条时，报 20 是在夸大这份成稿的含金量。
    """
    grilled = [segment for segment in segments if segment["source"] != SOURCE_ORIGINAL]
    used = {fact_id for segment in segments for fact_id in segment["fact_ids"]}
    return {
        "total_segments": len(segments),
        "grilled_segments": len(grilled),
        "fact_count": len(used),
    }


def run_rewrite(
    *,
    llm: Llm,
    session: Dict[str, Any],
    baseline_text: str,
    crumbs: List[Dict[str, Any]],
    instruction: Optional[str],
    previous: Optional[Dict[str, Any]],
) -> Dict[str, Any]:
    """跑一次改写，返回新的一版——**不写会话仓**。

    和 `run_turn` 同一条纪律（issue #26 的失败原子性）：本函数是纯函数，写状态由 HTTP
    层在它成功返回之后一次性完成。LLM 失败时版本历史一个字没变，同一指令可安全重发。

    返回 `{"segments", "stats", "refusal"}`。`refusal` 非空时 `segments` 是上一版原样——
    拒绝了一条编造指令，成稿不该跟着变。
    """
    facts = session["facts"]
    history = session["history"]
    previous_segments = previous["segments"] if previous else None

    result = llm.complete(
        messages=build_rewrite_messages(
            jd_text=session["jd_text"],
            baseline_text=baseline_text,
            crumbs=crumbs,
            baseline_crumb_id=session["baseline_crumb_id"],
            facts=facts,
            history=history,
            previous_segments=previous_segments,
            instruction=instruction,
        ),
        schema_name="grill_rewrite",
        schema=REWRITE_SCHEMA,
    )
    if not isinstance(result, dict):
        raise GrillError("LLM returned a non-object rewrite result")

    refusal = (result.get("refusal") or "").strip() or None
    if refusal and instruction:
        # 拒绝路径：成稿维持上一版原样。
        #
        # 用户可能带着指令直接进来（前端还没拉过初稿），这时没有「上一版」可以
        # 维持——交回空成稿，让前端只显示拒绝理由。这仍然是 200：他要读的是
        # 「为什么不给你写」，而把它变成 502 会让前端当故障重试。
        if previous is None:
            return {"segments": [], "stats": _stats([]), "refusal": refusal}
        return {"segments": previous["segments"], "stats": previous["stats"], "refusal": refusal}

    segments = _clean_segments(
        result.get("segments"),
        facts=facts,
        history=history,
        crumb_ids=session.get("crumb_ids") or [],
    )
    if not segments:
        # 一段都没有等于这次调用没干活——和空树同一类失败。
        raise GrillError("LLM returned an empty rewrite")

    return {"segments": segments, "stats": _stats(segments), "refusal": None}


def cache_key(base_version: int, instruction: Optional[str]) -> Tuple[int, str]:
    """缓存键：在**哪一版**上执行**哪条指令**。

    只按指令做键是不够的——「口语一点」用在 v1 和用在 v2 上是两次不同的改写，
    共用一个缓存会把用户送回一版他已经改过的稿子。
    """
    return (base_version, (instruction or "").strip())
