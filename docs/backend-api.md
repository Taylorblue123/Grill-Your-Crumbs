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
| `POST` | `/api/v1/repos` | connect a public GitHub repo by URL → a `kind=repo` crumb |
| `GET` | `/` | serve the built single-file prototype |

`kind` accepts `auto`, `resume`, `repo`, `notes`, `diary`, `social`, `linkedin`, or `manual`.
`auto` maps PDF/DOCX/HTML to `resume` and text-like files to `notes`.

The demo accepts PDF, DOCX, HTML, TXT, Markdown, CSV, and JSON up to 10 MiB. Uploads are streamed to
disk, hashed with SHA-256, and deduplicated per user. Extracted text becomes the `crumb.content`;
the original file remains separate in `attachment`, so future re-extraction does not mutate the
provenance record silently.

## Connecting a public repo

`POST /api/v1/repos` takes `{url}` — any shape a user might paste (`https://github.com/owner/name`,
with `.git`, with a `/tree/main/...` subpath, `git@github.com:owner/name.git`, or bare
`owner/name`). The adapter fetches repo metadata, the README, the 15 most recent commit messages,
and the top-level file tree, then assembles them into one summary text that becomes
`crumb.content`, exactly like extracted attachment text.

Only public repos: no token is required, and none is sent. Private-repo listing needs a PAT and
belongs to a later slice.

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

Fetch failures carry the reason in `error`: a missing-or-private repo, GitHub's rate limit (60
requests/hour unauthenticated), or a network failure. The frontend pairs that message with a way
out — upload the repo's README as a file instead, which the existing attachment endpoint already
accepts.

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
