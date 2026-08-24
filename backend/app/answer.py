"""作答一轮：抽事实入账本 → 更新挖掘树 → 出下一题或收口。

开场（`grill.py`）只跑一次；这一片跑到用户喊停为止。一次作答一次 LLM 调用，
一次调用同时干完三件事——抽事实、更新树、出下一题。分成三次调用会让三者互相
对不上：抽出来的事实进不了下一题的上下文，更新过的树和实际问出来的题脱钩。

四条规则落在这里，不在别处：

1. **上下文 = 树 + 账本 + 近 K 轮问答**（见 issue #26 的工程评审记录）。树告诉模型还有什么
   没挖，账本告诉它什么已经挖到了（不能再问一遍），近 K 轮让追问咬得住上一答。
   全量历史会让 prompt 无限膨胀，`RECENT_TURNS` 是那个 K。

2. **事实必须带出处**（ADR-0002）。`sessions.py` 说了强制点在事实构造处——就是
   这里的 `_harvest`。来源为空的事实直接丢掉：宁可少一条，也不能让账本里出现
   一条没法回溯的话。这是「每句话有出处」在运行时唯一的硬关口。

3. **退化防护**：已答不足 `MIN_TURNS_BEFORE_DONE` 轮时，模型自称 done 不采纳。
   模型偶尔图省事，答一题就想收摊，而一两轮的拷问对用户没有价值。但树真的空了
   是另一回事——那时候硬编一题出来就成了为凑轮数而问，照样收口。

4. **失败原子性**（见 issue #26 的工程评审记录）：本模块是纯函数，不碰会话仓。写状态由 HTTP
   层在本模块成功返回之后一次性完成，所以 LLM 失败时会话一个字没变，同一答案
   可以安全重发。
"""

from typing import Any, Dict, List, Optional
from uuid import uuid4

from .grill import GrillError, question_view, truncate
from .llm import Llm


# 每轮送进 prompt 的近期问答轮数。全量历史会让 prompt 随轮数无限膨胀，而拷问
# 真正需要「逐字咬住」的只有最近这几轮——更早的内容已经以事实的形式进了账本，
# 账本本身就在上下文里。
RECENT_TURNS = 3

# 已答满这么多轮之前，不采纳模型自称的 done。
MIN_TURNS_BEFORE_DONE = 2

# 单条答案入 prompt 的字符上限。用户偶尔会整段粘贴，没必要让一答挤掉账本。
ANSWER_CHAR_LIMIT = 4000
ANSWER_TRUNCATION_NOTICE = "\n……（回答超长，已截断）"


TURN_SCHEMA: Dict[str, Any] = {
    "type": "object",
    "properties": {
        "facts": {
            "type": "array",
            "description": "从这一轮回答里抽出的事实，一条一句，可独立阅读",
            "items": {
                "type": "object",
                "properties": {
                    "text": {
                        "type": "string",
                        "description": "事实原文，用户视角的一句话",
                    },
                    "source": {
                        "type": "string",
                        "description": "这条事实的出处：用户在这一轮说的哪句话",
                    },
                },
                "required": ["text", "source"],
                "additionalProperties": False,
            },
        },
        "tree": {
            "type": "array",
            "description": "更新后的挖掘树前沿：还没挖到的点。挖完的点删掉，新发现的点加进来",
            "items": {
                "type": "object",
                "properties": {
                    "id": {"type": "string"},
                    "topic": {"type": "string"},
                    "why": {"type": "string"},
                },
                "required": ["id", "topic", "why"],
                "additionalProperties": False,
            },
        },
        "question": {
            "type": ["object", "null"],
            "description": "下一题；收口时为 null",
            "properties": {
                "id": {"type": "string", "description": "对应 tree 里某个点的 id"},
                "text": {"type": "string"},
                "why": {
                    "type": "string",
                    "description": "为什么问这个，必须指向具体某份料、JD 某条要求，或用户刚说的某句话",
                },
                "options": {
                    "type": "array",
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
        "done": {
            "type": "boolean",
            "description": "这场是否问到头了。树空了才该为 true",
        },
    },
    "required": ["facts", "tree", "question", "done"],
    "additionalProperties": False,
}


SYSTEM_PROMPT = """你是一个简历拷问官。用户刚回答了你上一个问题，现在你要做三件事：
把回答里的事实抽出来记进账本、更新你的挖掘树、然后问出下一题。

## 硬规则

1. **抽事实，不抽废话。** 只抽可以直接写进简历或者支撑 JD 某条要求的具体内容：数字、
   规模、做法、结果、时间跨度。用户的语气词、犹豫、「我觉得可能」之类一律不抽。抽不到
   就交回空数组——用户答「想不起来」时抽不出事实是正常的，编一条比不抽更糟。
2. **每条事实必须带出处。** `source` 写用户在这一轮里说的哪句话（引原文片段）。这一条
   没有例外：出处只能在写入时记录，事后补不上。
3. **咬住上一个回答往深处追。** 下一题优先追问用户刚说的东西里最含糊、最没有数字、
   最难自证的那一处，而不是机械地跳到树上下一个点。追问追到底了，再回树上换点。
4. **先查料，再问人。** 料里已经写清楚的、账本里已经记下的，禁止再问一遍。用户已经
   告诉过你的事，再问一次是在浪费他的时间。
5. **不许编造。** 选项和推荐理由是**猜测**，措辞要让用户看得出这是猜测。
6. 一次只问一个问题。

## 挖掘树

`tree` 交回**更新后**的前沿：这一轮挖到位的点删掉，从回答里发现的新缺口加进来。
`question.id` 必须等于 `tree` 里你正在问的那个点的 id。

## 收口

树空了（没有任何还值得挖的点）才把 `done` 设为 true，同时 `question` 交回 null。
只要树上还有点，就继续问——`done` 不是「问得差不多了」的意思，是「真的没得问了」。

## 语言

全程用中文提问。用户是中文求职者。"""


def build_turn_messages(
    *,
    jd_text: str,
    tree: List[Dict[str, Any]],
    facts: List[Dict[str, Any]],
    history: List[Dict[str, Any]],
    question: Dict[str, Any],
    answer_text: str,
    chosen_option: Optional[str],
) -> List[Dict[str, str]]:
    """把这一轮的上下文拼成消息：树 + 账本 + 近 K 轮问答 + 本轮问答。

    料不再整份入场——开场那一次已经让模型读完了，而它规划出的树就是那次阅读的
    产物。每轮重发全部料会让 prompt 随轮数线性膨胀，收益却只有「万一模型忘了」。
    账本承担「已经知道什么」的记忆。
    """
    tree_block = (
        "\n".join(f"- [{node.get('id')}] {node.get('topic')}（{node.get('why')}）" for node in tree)
        if tree
        else "（空——没有还想挖的点了）"
    )

    ledger_block = (
        "\n".join(f"- {fact.get('text')}" for fact in facts)
        if facts
        else "（空——这是第一轮）"
    )

    recent = history[-RECENT_TURNS:]
    history_block = (
        "\n\n".join(
            f"问：{turn.get('question_text')}\n答：{turn.get('answer_text')}" for turn in recent
        )
        if recent
        else "（这是第一轮，还没有历史）"
    )

    # 点了选项就把选项原文一起送进去：光有 key 模型得回头猜它对应哪句话，
    # 而选项原文正是用户「认下了哪一种情况」的准确表述。
    chosen_block = ""
    if chosen_option:
        picked = next(
            (
                option
                for option in question.get("options") or []
                if option.get("key") == chosen_option
            ),
            None,
        )
        if picked:
            chosen_block = f"\n（用户点选了选项 {chosen_option}：{picked.get('text')}）"

    user_content = (
        "## 目标岗位 JD（原文）\n\n"
        f"{jd_text}\n\n"
        "## 你的挖掘树（还没挖到的点）\n\n"
        f"{tree_block}\n\n"
        "## 事实账本（已经挖到的，不要再问）\n\n"
        f"{ledger_block}\n\n"
        f"## 最近 {RECENT_TURNS} 轮问答\n\n"
        f"{history_block}\n\n"
        "## 这一轮\n\n"
        f"问：{question.get('text')}\n"
        f"答：{truncate(answer_text, ANSWER_CHAR_LIMIT, ANSWER_TRUNCATION_NOTICE)}{chosen_block}\n\n"
        "---\n\n"
        "请把这一轮回答里的事实抽出来、更新挖掘树、然后问出下一题。"
        "记住：账本和料里已经有的，一个字都不要再问。"
    )

    return [
        {"role": "system", "content": SYSTEM_PROMPT},
        {"role": "user", "content": user_content},
    ]


def _harvest(raw_facts: Any, turn_id: str, round_number: int) -> List[Dict[str, Any]]:
    """把模型交回的事实折成账本条目，顺手强制 ADR-0002 的出处不变量。

    来源为空的事实丢掉，不是报错：模型偶尔漏一条 source，为此让整轮作答失败，
    代价远大于少记一条。丢掉的那条对用户不可见——它本来也没法回溯。

    `round_number` 在这里定死而不是让前端按落账顺序推算：抽不出事实的一轮
    （用户答「想不起来」）在账本里不留痕迹，前端数出来的名次会比真实轮次少。
    「来自第 N 问」要能真的跳回那一问，就得是绝对轮次。
    """
    harvested: List[Dict[str, Any]] = []
    for item in raw_facts or []:
        if not isinstance(item, dict):
            continue
        text = (item.get("text") or "").strip()
        source = (item.get("source") or "").strip()
        if not text or not source:
            continue
        harvested.append(
            {
                "id": str(uuid4()),
                "text": text,
                "source": source,
                "turn_id": turn_id,
                "round": round_number,
            }
        )
    return harvested


def run_turn(
    *,
    llm: Llm,
    session: Dict[str, Any],
    answer_text: str,
    chosen_option: Optional[str],
) -> Dict[str, Any]:
    """跑一轮作答，返回这一轮的产出——**不写会话仓**。

    返回 `{"facts", "tree", "question", "done", "turn"}`：新抽的事实、更新后的树、
    下一题（收口时为 None）、是否收口，以及这一轮该追加进 history 的那条记录。
    调用方拿到之后一次性写状态，于是「LLM 失败 → 会话没动过」自然成立。
    """
    question = session["question"]
    turn_id = str(uuid4())

    result = llm.complete(
        messages=build_turn_messages(
            jd_text=session["jd_text"],
            tree=session["tree"],
            facts=session["facts"],
            history=session["history"],
            question=question,
            answer_text=answer_text,
            chosen_option=chosen_option,
        ),
        schema_name="grill_turn",
        schema=TURN_SCHEMA,
    )
    if not isinstance(result, dict):
        raise GrillError("LLM returned a non-object turn result")

    tree = [node for node in result.get("tree") or [] if isinstance(node, dict)]
    # 已答轮数含这一轮——判断「够不够两轮」、给事实标轮号都按本轮结束后的状态算。
    answered = len(session["history"]) + 1
    facts = _harvest(result.get("facts"), turn_id, answered)
    next_question = result.get("question") or None

    done = _decide_done(
        model_said_done=bool(result.get("done")),
        tree=tree,
        answered=answered,
    )

    if done:
        next_question = None
    else:
        next_question = next_question or _pick_from_tree(tree)
        if next_question is None:
            # 不收口却又拿不出题，等于这次调用没干活——和空树同一类失败。
            raise GrillError("LLM neither closed the session nor produced a next question")

    return {
        "facts": facts,
        "tree": tree,
        "question": question_view(next_question, tree) if next_question else None,
        "done": done,
        "turn": {
            "id": turn_id,
            "question_id": question.get("id", ""),
            "question_text": question.get("text", ""),
            "answer_text": answer_text,
            "chosen_option": chosen_option,
            "fact_ids": [fact["id"] for fact in facts],
        },
    }


def _decide_done(*, model_said_done: bool, tree: List[Dict[str, Any]], answered: int) -> bool:
    """收口判定。树是硬证据，模型自报的 `done` 只是建议。

    - 树空 → 收口，无论答了几轮。硬编一题出来就是为凑轮数而问。
    - 树非空 + 模型说 done + 已答够 `MIN_TURNS_BEFORE_DONE` 轮 → 采纳。
    - 树非空 + 模型说 done + 轮数不够 → 驳回，继续问。
    """
    if not tree:
        return True
    return model_said_done and answered >= MIN_TURNS_BEFORE_DONE


def _pick_from_tree(tree: List[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    """驳回 done 之后自己从树上摘一题。

    模型报 done 时通常连题都不给。不采纳它的 done 却也拿不出题，「不采纳」就
    只是嘴上说说，用户照样走到了尽头。这里从树顶那个点搭一道朴素的题——没有
    选项，因为选项要模型基于料去猜，而这条路径上模型已经不打算再问了。
    """
    if not tree:
        return None
    node = tree[0]
    return {
        "id": node.get("id", ""),
        "text": f"再往下挖一个点：{node.get('topic')}。这方面你有什么可以说的？",
        "why": node.get("why", ""),
        "options": [],
        "recommended": {"key": "", "reason": ""},
    }
