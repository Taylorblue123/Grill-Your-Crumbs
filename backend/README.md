# Backend

This is the first runnable backend slice for the prototype: attachment ingestion and durable
`crumb` storage. It deliberately does not pretend that the demo's scripted grilling flow is
already model-backed.

## Run locally

From the repository root:

```sh
python3 -m venv .venv
.venv/bin/pip install -r backend/requirements-dev.txt
./prototype/build.sh
.venv/bin/uvicorn app.main:app --app-dir backend --reload
```

Open <http://127.0.0.1:8000>. API docs are at <http://127.0.0.1:8000/docs>.

SQLite and uploaded files default to `data/`, which is gitignored. Environment overrides are
listed in `.env.example`. The local demo uses one fixed user id; production must replace the
`X-User-Id`/demo fallback dependency with authenticated user context.

## Tests

```sh
.venv/bin/python -m pytest backend/tests
```
