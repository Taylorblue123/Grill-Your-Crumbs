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

前端的真实链路在 `#screen=live`（落地页有独立入口），和剧本 demo 完全分开。

需要一个真 key 才跑得动（见 `.env.example`）。测试里 LLM 走假实现，不打网络。

## Tests

```sh
.venv/bin/python -m pytest backend/tests
```
