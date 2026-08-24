# Backend

This is the first runnable backend slice for the prototype: attachment ingestion and durable
`crumb` storage. It deliberately does not pretend that the demo's scripted grilling flow is
already model-backed.

## Run locally

From the repository root:

```sh
python3 -m venv .venv
.venv/bin/pip install -r backend/requirements-dev.txt
.venv/bin/uvicorn app.main:app --app-dir backend --reload
```

API docs are at <http://127.0.0.1:8000/docs>.

`GET /` serves whichever frontend is available, in this order:

1. `frontend/dist/index.html` — the React app, once `cd frontend && npm run build` has run
2. `prototype/grill-demo.html` — the single-file prototype, after `./prototype/build.sh`

For frontend development prefer `cd frontend && npm run dev` (<http://localhost:5173>); it
proxies `/api` here, so you get hot reload against a real backend.

SQLite and uploaded files default to `data/`, which is gitignored. Environment overrides are
listed in `.env.example`. The local demo uses one fixed user id; production must replace the
`X-User-Id`/demo fallback dependency with authenticated user context.

## 拷问（真实链路）

`POST /api/v1/grill/sessions` 开一场拷问：`{jd_text, crumb_ids}` → 一次 LLM 调用读完
选中的料、对着 JD 规划「想挖的点」挖掘树、出首题 → `{session_id, baseline_crumb_id, question}`。

几条规则值得先知道：

- **基线**：`crumb_ids` 必须含至少一份 `kind=resume` 的料（拿它当底稿，新简历以它为对比
  基准），否则 422；多份简历取 `synced_at` 最新的一份，响应里回显 `baseline_crumb_id`。
- **错误码**：JD 为空 400；选中的料一份都不存在、或里面没有简历 422；LLM 失败或规划出
  空树 502（规划无副作用，可安全重发）。
- **会话**在内存里（`GrillSessionStore`），后端重启即丢；`data/grill-sessions.json` 只是
  dev 镜像，token 永不落盘。

`POST /api/v1/grill/sessions/{id}/answers` 答一轮：`{question_id, answer_text, chosen_option}` →
一次 LLM 调用完成「抽事实入账本 + 更新树 + 出下一题或收口」→ `{facts, question|null, done}`。

`GET /api/v1/grill/sessions/{id}` 会话全投影，供刷新后重连现场。

`POST /api/v1/grill/sessions/{id}/stop` 「够了，去改写」：把中断写进服务端并收口
（幂等）。必须落到后端而不是前端自己切屏——会话恢复读的是投影，前端单方面切走的话，
刷新一次就把用户送回他刚走开的那道题。投影的 `closed_by` 区分 `exhausted`（树问空了）
与 `stopped`（用户叫停），两种收口的文案不同。中断不删会话：账本留给改写那一片用。

作答循环的几条规则：

- **失败原子性**：LLM 成功返回后才写会话状态。失败返 502 且会话一个字没变，
  同一答案可安全重发，不会留下半轮的事实。
- **作答幂等**：请求带 `question_id`。答的不是当前那道题（重复提交、两个标签页
  各答各的、会话已收口）一律 409，body 里带当前会话投影供客户端对齐；409 在调
  LLM 之前返回，不烧 token。
- **退化防护**：已答不足 2 轮时模型自称 `done` 不采纳，改从树上摘一题继续问；
  但树真的空了照样收口——硬编一题出来就成了为凑轮数而问。
- **出处不变量**：事实入账本必须带来源（ADR-0002），强制点在 `answer.py` 的
  `_harvest`，来源为空的事实直接丢弃。
- **上下文**：每轮 prompt = 挖掘树 + 事实账本 + 近 3 轮问答 + JD。料不再整份重发，
  开场那一次已经读过，账本承担「已经知道什么」的记忆。

前端的真实链路在 `#screen=live`（落地页有独立入口），和剧本 demo 完全分开。
会话 id 存在 sessionStorage，进 Live 屏时自动重连；会话 404（后端重启丢会话）
时给「重开一场」提示。

需要一个真 key 才跑得动（见 `.env.example`）。测试里 LLM 走假实现，不打网络。

### 联调（真前后端 + 假 LLM）

作答循环的验收标准都是行为性的，跑一遍点给自己看：

```sh
cd frontend && npm run build && cd ..
.venv/bin/python -m uvicorn backend.scripts.fake_llm_server:app --port 8000
node frontend/smoke-live.mjs http://127.0.0.1:8000
```

`backend/scripts/fake_llm_server.py` 只把 LLM 换成按剧本发牌的假件，其余全真。

## Tests

```sh
.venv/bin/python -m pytest backend/tests
```
