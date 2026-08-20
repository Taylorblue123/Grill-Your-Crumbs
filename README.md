# Grill Your Crumbs

An evidence-first interview demo that turns a rough career experience into specific resume material. The app asks focused follow-up questions, preserves what the user actually said, and shows where every generated segment came from.

## What the demo includes

- Live and Replay modes for a three-minute presentation and unfamiliar input.
- A three-screen journey: input, interview with a growing thread, and full-width proof.
- Blue source segments, gold interview discoveries, and red unsupported suggestions.
- Deterministic provenance checks that downgrade unsupported model claims.
- JSON session storage plus evaluation events for copy, export, weak questions, and deleted claims.
- An optional Chat Completions-compatible model adapter with an offline fallback.

## Run locally

Prerequisites: Python 3.11 or newer and Node.js 20 or newer.

```bash
python3 -m venv .venv
.venv/bin/python -m pip install -e './backend[dev]'
npm install --prefix frontend
```

Start the API and web app in separate terminals:

```bash
cd backend
../.venv/bin/uvicorn app.main:app --reload
```

```bash
cd frontend
npm run dev
```

Open `http://localhost:5173`. Replay works immediately. Live uses the deterministic interview fallback unless the optional variables in `.env.example` are exported before starting the API.

## Verify

```bash
.venv/bin/python -m pytest -q backend/tests
npm run check --prefix frontend
npm run build --prefix frontend
```

The API writes demo sessions to `backend/data/<session_id>/` by default. Each session contains `chunks.json`, `turns.json`, `thread.json`, `artifact.json`, and `events.jsonl`.
