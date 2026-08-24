# Backend API · first vertical slice

The first backend slice closes one complete user journey:

```text
select/drop a file → validate → store original → extract text → deduplicate
→ create crumb → return it → add it to the current Grill context
```

It is intentionally smaller than `backend-schema.md`. Threads, turns, facts, targets, and
artifacts remain the domain model for later slices; attachment ingestion is now runnable rather
than another proposed table.

## API

| Method | Route | Purpose |
|---|---|---|
| `GET` | `/api/health` | readiness check |
| `GET` | `/api/v1/crumbs` | list the current user's uploaded crumbs |
| `POST` | `/api/v1/attachments` | multipart upload with `file` and optional `kind` |
| `DELETE` | `/api/v1/crumbs/{id}` | delete the crumb and its stored original |
| `POST` | `/api/v1/repos` | connect repos → `kind=repo` crumbs: `{url}` (paste) or `{full_names}` (batch) |
| `POST` | `/api/v1/github/token` | store a GitHub PAT for this user (verified before it is stored) |
| `GET` | `/api/v1/github/repos` | list every repo the token can see, private ones included |
| `GET` | `/` | serve the built single-file prototype |

`kind` accepts `auto`, `resume`, `repo`, `notes`, `diary`, `social`, `linkedin`, or `manual`.
`auto` maps PDF/DOCX/HTML to `resume` and text-like files to `notes`.

The demo accepts PDF, DOCX, HTML, TXT, Markdown, CSV, and JSON up to 10 MiB. Uploads are streamed to
disk, hashed with SHA-256, and deduplicated per user. Extracted text becomes the `crumb.content`;
the original file remains separate in `attachment`, so future re-extraction does not mutate the
provenance record silently.

## Connecting a public repo

`POST /api/v1/repos` takes exactly one of two inputs:

- `{url}` — any shape a user might paste (`https://github.com/owner/name`, with `.git`, with a
  `/tree/main/...` subpath, `git@github.com:owner/name.git`, or bare `owner/name`).
- `{full_names: [...]}` — a batch, normally the repos ticked in the picker. Capped at 20 per call;
  anything past the cap gets its own `ok: false` entry (`error_kind: "overflow"`) rather than being
  dropped silently. Fetches run concurrently, bounded by the same `MAX_CONCURRENCY = 5` the adapter
  uses within a single repo; the database writes that follow stay sequential, and results come back
  in the order they were requested rather than the order they finished.

Giving both, or neither, is a `400`: the request itself is malformed, and there is no per-item key
to hang an envelope entry on.

Either way the adapter fetches repo metadata, the README, the 15 most recent commit messages, and
the top-level file tree, then assembles them into one summary text that becomes `crumb.content`,
exactly like extracted attachment text.

**No token needed for public repos**, and none is sent if none is connected. If the user *has*
connected a PAT, both entry points use it — so pasting a private repo's URL works too. Requiring a
separate entry point for private repos would be arbitrary: the user already authorized us.

Two shape decisions worth knowing before you call it:

- **The response is a per-item envelope** — `{results: [{full_name, ok, crumb|error, updated}]}` —
  and a failed fetch still returns HTTP 200 with `ok: false`. Today only one repo is connected per
  call, so this looks like indirection; the batch (PAT) slice connects many at once, where "three
  succeeded, two were rate-limited" has no single status code. Fixing the shape now avoids breaking
  the contract later. The one exception is an unparseable URL: that is a `400`, because there is no
  `full_name` to key an envelope entry on and the request itself is malformed.
- **Repos upsert, they do not deduplicate.** Attachments dedupe by `content_hash`; a re-fetched repo
  almost always has new content (new commits, an edited README), so hash-dedupe would stack the same
  repo into several crumbs. A repo's identity is its `full_name`, so the crumb is replaced by
  `(kind='repo', display_name=full_name)` and the response sets `updated: true`.

Fetch failures carry the reason in `error` and the *kind* in `error_kind` (`not_found`,
`unauthorized`, `rate_limit`, `fetch_failed`, `empty`, `bad_name`). The kind has to survive because
the envelope ate the status code: in a batch, "rate-limited, try later" and "no such repo, retrying
won't help" are different dispositions. The frontend pairs the message with a way out — upload the
repo's README as a file instead, which the existing attachment endpoint already accepts — but only
for the kinds where that is genuinely a way out (an empty repo has no README to upload).

## Connecting GitHub with a PAT

Three endpoints, one chain: paste a token → look at the list → tick some and pull.

`POST /api/v1/github/token` takes `{token}` and **verifies it against GitHub before storing it** —
otherwise a mistyped token surfaces one step later, as "couldn't fetch your repo list", which points
at the wrong thing. It responds `{connected, login}` and **never echoes the token back**, not even
the last four characters. An empty string means disconnect, and that path does not call GitHub —
disconnecting does not need GitHub's agreement.

`GET /api/v1/github/repos` returns `{repos: [{full_name, private, description, pushed_at}],
truncated}`, most recently pushed first, capped at 300 rows (the adapter itself stops after 10 pages
of 100). The listing asks for `affiliation=owner,collaborator`: the default also includes
`organization_member`, which for anyone at a large company buries the picker under hundreds of repos
they had no hand in. Org repos the user can see but doesn't own are therefore absent from the list —
not a dead end, since pasting the URL still connects them, private ones included. With no token stored this is a `401`, not an empty list: "you have no repos" and "you
haven't connected GitHub" send the user in completely different directions. A token that GitHub
rejects here is dropped on the spot, since every later call would hit the same wall.

### The token never lands anywhere

The PAT lives only in `backend/app/tokens.py`'s `TokenStore` — a plain in-memory dict, keyed by
user, with no mirror, no SQLite table, and a `__repr__` that reports a count rather than contents.
"Never persisted" is a property of the type, not a rule callers have to remember. Restarting the
process drops every token, which is deliberate: sessions are in-memory too, and a credential that
outlives its session is just one more thing to clean up.

The session mirror (`data/grill-sessions.json`) is the second line of defense, for the other leak
path: a user pasting a PAT into an answer box. `sessions.scrub_secrets` strips secret-named fields
and redacts token-shaped strings from free text on every dump.

`backend/tests/test_github_pat_api.py::test_the_token_never_reaches_the_mirror_or_the_database`
drives the whole chain and then greps every byte under `data/` — the whole directory, not just the
files we expect to be written, because the point of a redline is to catch the write path nobody
thought of.

PAT is a step, not the destination: OAuth device flow replaces only how the token is obtained
(see `TODOS.md`). These three endpoint shapes are designed to survive that swap unchanged.

## Boundaries and production adapters

- SQLite and local disk are development adapters. Keep the API shape, then replace them with
  Postgres and private object storage (S3/R2) before multi-user deployment.
- The demo user fallback is only for local use. Production auth must supply user identity; never
  trust an arbitrary `X-User-Id` from the public internet.
- Original files and extracted diary/note text are sensitive. Production needs encryption,
  retention/deletion policy, malware scanning, audit events, and signed download URLs.
- Extraction is synchronous for this 10 MiB local slice. Move scanning/OCR/extraction to a job
  queue when larger files or image-only PDFs are accepted; expose `pending/ready/failed` then.
- The upload response is idempotent by content: a duplicate returns the existing crumb with
  `duplicate: true` rather than creating conflicting provenance. **Repo crumbs are the one
  carve-out**: they are keyed by `full_name`, not by content hash, because a re-fetched repo
  almost always has new content. See "Connecting a public repo" above. Content-idempotence
  still applies across the two paths — if a repo summary collides with an already-stored
  crumb, the existing one is returned rather than reported as an error.

## Target backend for the complete demo

The full product should stay one API service until scale proves otherwise. Postgres owns domain
state, private object storage owns originals, and a worker handles scanning, extraction, JD
parsing, question generation, fact extraction, and artifact generation. The browser never talks
to an LLM or object store directly.

The frontend should consume server projections instead of reconstructing business state. For
example, requirement state, provenance counts, and the six-dimension ledger are derived by the
server from facts and matches; the browser only renders them.

The planned resource contract is:

| Area | Command/query | Important response or invariant |
|---|---|---|
| Materials | `POST /api/v1/attachments` | implemented; returns the durable crumb |
| Materials | `GET /api/v1/crumbs` | implemented; private library projection |
| Materials | `DELETE /api/v1/crumbs/{id}` | implemented; also clears the stored original |
| Targets | `POST /api/v1/targets` | accepts raw JD; returns `202` while requirements are parsed |
| Targets | `GET /api/v1/targets/{id}` | requirements plus derived `ok/weak/none/gap` state |
| Grills | `POST /api/v1/threads` | baseline, goal, optional target, selected crumb ids |
| Grills | `POST /api/v1/threads/{id}/start` | snapshots material and returns the first valid question |
| Grills | `GET /api/v1/threads/{id}` | workbench projection: turns, facts, draft, ledger, target tally |
| Turns | `POST /api/v1/turns/{id}/answers` | answer plus idempotency key; extracts facts and next question |
| Turns | `POST /api/v1/turns/{id}/skip` | records an evaluation event and advances |
| Turns | `POST /api/v1/turns/{id}/flag-useless` | records the negative sample and regenerates |
| Facts | `POST /api/v1/facts/{id}/retract` | soft retract; dependent segments/requirements downgrade |
| Facts | `POST /api/v1/facts/{id}/promote` | candidate → artifact with user-authored/approved text |
| Artifacts | `POST /api/v1/threads/{id}/artifacts` | generates a versioned snapshot; never emits a `gap` claim |
| Artifacts | `POST /api/v1/segments/{id}/confirm` | confirms an inferred segment and records the event |
| Artifacts | `POST /api/v1/artifacts/{id}/exports` | streams export and records the north-star event |

Command endpoints should accept an `Idempotency-Key`. A repeated answer/upload/export must return
the original result instead of duplicating facts, artifacts, or analytics events. Long-running
commands return `202` with `{job_id, status, resource_id}`; the client may poll
`GET /api/v1/jobs/{job_id}` initially and move to server-sent events later without changing the
domain endpoints.

### Server-enforced invariants

- A generated question is not exposed unless `why_refs` points to at least one selected crumb or
  a target requirement; “why this question” is part of the response, not optional UI copy.
- `thread.crumb_ids` is a snapshot. Adding/removing current material is a command, and removing a
  cited crumb immediately downgrades affected source segments.
- A grill-origin segment must reference active fact ids; retracting the last fact downgrades it to
  inferred. A source-origin segment must reference a selected crumb.
- A requirement in `gap` state can never be referenced by an artifact segment. This is checked in
  the generation transaction, not left to prompt wording.
- Undo is a compensating command (soft retraction/demotion), not a client-only state rewind.
- Every query and mutation is scoped by authenticated `user_id`; ids supplied by the browser are
  never sufficient authorization.

### Thread creation shape

```json
{
  "baseline_text": "rough experience, unchanged",
  "artifact_kind": "resume",
  "target_id": "optional-uuid",
  "crumb_ids": ["uuid", "uuid"],
  "question_budget": {"jd": 4, "general": 2}
}
```

The workbench query should return one cohesive projection. That avoids five panels racing through
separate requests and guarantees that provenance counts, active facts, draft segments, and target
tallies describe the same database revision.

## Next slices

1. Authenticated user/workspace boundary and object-storage adapter.
2. Create thread with a snapshot of selected crumb ids.
3. Generate/answer turns, then persist facts with immutable provenance.
4. Artifact generation and retraction-driven provenance views.
5. Target requirement parsing and the 4:2 question budget.
