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

## Tests

```sh
.venv/bin/python -m pytest backend/tests
```
