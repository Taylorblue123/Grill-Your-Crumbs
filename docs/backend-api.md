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
| `GET` | `/` | serve the built single-file prototype |

`kind` accepts `auto`, `resume`, `repo`, `notes`, `diary`, `social`, `linkedin`, or `manual`.
`auto` maps PDF/DOCX/HTML to `resume` and text-like files to `notes`.

The demo accepts PDF, DOCX, HTML, TXT, Markdown, CSV, and JSON up to 10 MiB. Uploads are streamed to
disk, hashed with SHA-256, and deduplicated per user. Extracted text becomes the `crumb.content`;
the original file remains separate in `attachment`, so future re-extraction does not mutate the
provenance record silently.

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
  `duplicate: true` rather than creating conflicting provenance.

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
