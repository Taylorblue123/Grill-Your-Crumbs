"""联调用的假 LLM 后端：真服务、真 HTTP、真前端，只有 LLM 是编的。

作答循环的验收标准全是行为性的（点选项要填进框、事实要看得见落进账本、刷新
要接得回来），只有把整套系统跑起来点一遍才算数。但真 LLM 一轮十几秒、烧 token、
还每次答得不一样——联调需要的恰恰相反：秒回、免费、可复现。

所以这里给一个按剧本走的假 LLM，其余部件（FastAPI、SQLite、会话仓、React 构建
产物）全是真的。

用法：
    .venv/bin/python -m uvicorn backend.scripts.fake_llm_server:app --port 8000

配套：frontend/smoke-live.mjs
"""

import re
from dataclasses import replace
from typing import Any, Dict, List

from backend.app.config import LlmSettings, Settings
from backend.app.main import create_app


OPENING: Dict[str, Any] = {
    "tree": [
        {"id": "n1", "topic": "那次延迟优化到底做了什么", "why": "简历只写了「优化性能」"},
        {"id": "n2", "topic": "带没带过人", "why": "JD 要求 mentoring"},
        {"id": "n3", "topic": "线上事故处理", "why": "JD 要求 on-call"},
    ],
    "question": {
        "id": "n1",
        "text": "你简历里写的「优化了接口性能」，具体是把什么从多少压到了多少？",
        "why": "你的《我的简历.html》里这句话没有任何数字，而 JD 明确要求「有性能调优经验」。",
        "options": [
            {"key": "a", "text": "加了缓存，把重复查询挡在数据库外面"},
            {"key": "b", "text": "改了 SQL / 加了索引"},
            {"key": "c", "text": "改成批量或异步处理"},
            {"key": "d", "text": "都不是，我另有做法"},
        ],
        "recommended": {"key": "a", "reason": "你的料里出现过 Redis 依赖，所以我猜是缓存那一路。"},
    },
}

TURNS: List[Dict[str, Any]] = [
    {
        "facts": [
            {"text": "把订单查询接口的 P99 从 800ms 压到 120ms", "source": "800ms 压到 120ms"},
            {"text": "手段是给热点查询加 Redis 缓存，命中率 92%", "source": "加了 Redis 缓存"},
        ],
        "tree": [
            {"id": "n2", "topic": "带没带过人", "why": "JD 要求 mentoring"},
            {"id": "n3", "topic": "线上事故处理", "why": "JD 要求 on-call"},
        ],
        "question": {
            "id": "n2",
            "text": "缓存命中率 92% 是怎么测出来的？谁在看这个数？",
            "why": "你刚说的 92% 是这场里第一个硬数字，但它从哪来的还说不清。",
            "options": [
                {"key": "a", "text": "Redis 自带的 INFO stats 里读的"},
                {"key": "b", "text": "自己埋了点，上了 Grafana 面板"},
                {"key": "c", "text": "压测时算的，线上没长期看"},
            ],
            "recommended": {"key": "b", "reason": "你提过团队有监控大盘。"},
        },
        "done": False,
    },
    {
        "facts": [
            {"text": "自己埋点做了 Grafana 缓存命中率大盘，全组共用", "source": "上了 Grafana 面板"},
        ],
        "tree": [{"id": "n3", "topic": "线上事故处理", "why": "JD 要求 on-call"}],
        "question": {
            "id": "n3",
            "text": "这套缓存上线后出过事故吗？比如缓存击穿、脏数据。",
            "why": "JD 要求 on-call 经验，而缓存正是最容易出事的那一层。",
            "options": [
                {"key": "a", "text": "出过缓存击穿，加了互斥锁"},
                {"key": "b", "text": "出过脏数据，改了失效策略"},
                {"key": "c", "text": "没出过事"},
            ],
            "recommended": {"key": "a", "reason": "高命中率的热点缓存最常见的就是击穿。"},
        },
        "done": False,
    },
    {
        "facts": [
            {"text": "遇到过缓存击穿，用互斥锁 + 逻辑过期扛住了大促", "source": "加了互斥锁"},
        ],
        "tree": [],
        "question": None,
        "done": True,
    },
]


def _read_ledger(prompt: str) -> List[Dict[str, str]]:
    """从改写 prompt 里读回账本：每条事实的 id 和它来自的轮次 id。

    剧本没法把这些 id 写死——它们是服务端每场现生成的 uuid。真模型也是从
    prompt 里的账本读到它们的，这里做同一件事，用正则代替阅读理解。
    """
    return [
        {"fact_id": fact_id, "turn": turn_id}
        for fact_id, turn_id in re.findall(
            r"\[事实 id: ([^\]]+)\] \[来自轮次 turn:([^，]+)，", prompt
        )
    ]


def _rewrite_card(prompt: str, instruction: bool) -> Dict[str, Any]:
    """按账本现编一版成稿。

    金色片段的 `source` 指向账本里真实的轮次 id、`fact_ids` 指向真实的事实 id——
    联调要验的正是「hover 金色片段能弹出当轮问答」，指错了就验不着。
    """
    ledger = _read_ledger(prompt)
    if not ledger:
        return {
            "segments": [{"text": "后端工程师 · 接口与性能", "source": "original", "fact_ids": []}],
            "refusal": None,
        }

    # 要求编造的指令一律拒绝——这条是产品红线在联调里的可见出口。
    if instruction and re.search(r"实习|加一段|编|写成|夸大", prompt.split("## 用户的改稿指令")[-1]):
        return {
            "segments": [],
            "refusal": "你让我写一段这场拷问里没有任何事实支撑的经历。编出来的那句话面试时要你自己扛，我不写。",
        }

    tail = "（改稿版）" if instruction else ""
    by_turn: Dict[str, List[str]] = {}
    for item in ledger:
        by_turn.setdefault(item["turn"], []).append(item["fact_id"])

    segments: List[Dict[str, Any]] = [
        {"text": "后端工程师 · 接口与性能", "source": "original", "fact_ids": []}
    ]
    for index, (turn_id, fact_ids) in enumerate(by_turn.items(), start=1):
        segments.append(
            {
                "text": f"第 {index} 处拷问挖出来的内容{tail}：这一段绑定 {len(fact_ids)} 条事实。",
                "source": f"turn:{turn_id}",
                "fact_ids": fact_ids,
            }
        )
    return {"segments": segments, "refusal": None}


class ScriptedLlm:
    """按调用次序发牌：开场发 OPENING，之后依次发每一轮作答；改写现编。

    剧本按 **schema_name** 认出这是开场、作答还是改写，而不是数总调用次数——联调要
    连开好几场（重开一次、验一次「够了」中断），按总次数数的话第二场的开场会
    领到一张作答的牌，树是空的，于是开场直接 502。
    """

    def __init__(self) -> None:
        self.turn_calls = 0

    def complete(self, *, messages: Any, schema_name: str, schema: Any) -> Dict[str, Any]:
        if schema_name == "grill_opening":
            self.turn_calls = 0
            return OPENING
        if schema_name == "grill_rewrite":
            prompt = "\n".join(message["content"] for message in messages)
            return _rewrite_card(prompt, "## 用户的改稿指令" in prompt)
        card = TURNS[min(self.turn_calls, len(TURNS) - 1)]
        self.turn_calls += 1
        return card


def build() -> Any:
    # 真 key 不需要，也不该在联调里出现：LLM 整个被换掉了。
    settings = replace(
        Settings.from_env(),
        llm=LlmSettings(api_key="fake", model="fake", base_url=None),
    )
    return create_app(settings, llm=ScriptedLlm())


app = build()
