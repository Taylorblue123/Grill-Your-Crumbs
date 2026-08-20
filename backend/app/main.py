from __future__ import annotations

import os
from pathlib import Path
from typing import Any

from fastapi import FastAPI, HTTPException, Response, status
from fastapi.middleware.cors import CORSMiddleware

from .demo import ensure_demo_session
from .engine import GrillEngine, add_answer_to_thread
from .models import EventCreate, RestatementUpdate, SessionCreate, TurnSubmission
from .provenance import validate_artifact
from .storage import SessionNotFoundError, SessionStore


def create_app(data_dir: Path | None = None) -> FastAPI:
    resolved_data_dir = data_dir or Path(os.getenv("GRILL_DATA_DIR", "data"))
    store = SessionStore(resolved_data_dir)
    engine = GrillEngine.from_env()
    ensure_demo_session(store)

    application = FastAPI(title="Grill Your Crumbs API", version="0.1.0")
    application.state.store = store
    application.state.engine = engine
    application.add_middleware(
        CORSMiddleware,
        allow_origins=[
            origin.strip()
            for origin in os.getenv(
                "GRILL_ALLOWED_ORIGINS",
                "http://localhost:5173,http://127.0.0.1:5173,http://localhost:4173",
            ).split(",")
            if origin.strip()
        ],
        allow_credentials=False,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    def load_or_404(session_id: str) -> dict[str, Any]:
        try:
            return store.load(session_id)
        except SessionNotFoundError as error:
            raise HTTPException(status_code=404, detail="Session not found") from error

    @application.get("/api/health")
    def health() -> dict[str, str]:
        return {"status": "ok"}

    @application.post("/api/session", status_code=status.HTTP_201_CREATED)
    def create_session(payload: SessionCreate) -> dict[str, Any]:
        session = store.create_session(
            payload.raw_experience,
            [source.model_dump() for source in payload.extra_sources],
        )
        return {"session_id": session["session_id"], "chunks": session["chunks"]}

    @application.post("/api/session/{session_id}/read")
    def read_sources(session_id: str) -> dict[str, Any]:
        session = load_or_404(session_id)
        reading = engine.analyze(session["chunks"])
        session.update(reading)
        store.save(session)
        store.append_event(session_id, "source_read", {"probe_count": len(reading["probes"])})
        return reading

    @application.patch("/api/session/{session_id}/read")
    def correct_reading(session_id: str, payload: RestatementUpdate) -> dict[str, str]:
        session = load_or_404(session_id)
        session["restatement"] = payload.restatement.strip()
        correction = next(
            (
                chunk
                for chunk in session["chunks"]
                if chunk["source_name"] == "Corrected interpretation"
            ),
            None,
        )
        if correction:
            correction["text"] = session["restatement"]
        else:
            correction = {
                "id": f"c{len(session['chunks']) + 1}",
                "source_type": "notes",
                "source_name": "Corrected interpretation",
                "text": session["restatement"],
            }
            session["chunks"].append(correction)
        store.save(session)
        store.append_event(session_id, "restatement_corrected", {"chunk_id": correction["id"]})
        return {"restatement": session["restatement"]}

    @application.post("/api/session/{session_id}/turn")
    def submit_turn(session_id: str, payload: TurnSubmission) -> dict[str, Any]:
        session = load_or_404(session_id)
        turns = session["turns"]
        pending = turns[-1] if turns and turns[-1]["status"] == "pending" else None
        has_action = bool(payload.answer and payload.answer.strip()) or payload.skipped or payload.flagged_useless

        if pending and has_action:
            if payload.flagged_useless:
                pending["status"] = "flagged_useless"
                store.append_event(session_id, "flag_useless_question", {"turn_id": pending["turn_id"]})
            elif payload.skipped:
                pending["status"] = "skipped"
                store.append_event(session_id, "question_skipped", {"turn_id": pending["turn_id"]})
            else:
                pending["status"] = "answered"
                pending["user_answer"] = payload.answer.strip() if payload.answer else None
                add_answer_to_thread(session["thread"], pending)
                store.append_event(session_id, "answer_received", {"turn_id": pending["turn_id"]})
        elif pending:
            return {"turn": pending, "done": False, "thread": session["thread"]}
        elif has_action:
            raise HTTPException(status_code=409, detail="No question is waiting for an answer")

        if len(turns) >= 5:
            store.save(session)
            return {"turn": turns[-1], "done": True, "thread": session["thread"]}

        question = engine.question(session)
        if question is None:
            store.save(session)
            return {
                "turn": turns[-1] if turns else None,
                "done": True,
                "thread": session["thread"],
            }

        round_number = len(turns) + 1
        turn = {
            "turn_id": f"t{round_number}",
            "round": round_number,
            **question,
            "user_answer": None,
            "status": "pending",
        }
        turns.append(turn)
        store.save(session)
        store.append_event(session_id, "question_asked", {"turn_id": turn["turn_id"]})
        return {"turn": turn, "done": False, "thread": session["thread"]}

    @application.post("/api/session/{session_id}/artifact")
    def create_artifact(session_id: str) -> dict[str, Any]:
        session = load_or_404(session_id)
        artifact = validate_artifact(
            engine.artifact(session),
            chunks=session["chunks"],
            turns=session["turns"],
        )
        session["artifact"] = artifact
        store.save(session)
        store.append_event(session_id, "artifact_created", artifact["stats"])
        return {"thread": session["thread"], "artifact": artifact}

    @application.post("/api/session/{session_id}/event", status_code=status.HTTP_204_NO_CONTENT)
    def capture_event(session_id: str, payload: EventCreate) -> Response:
        load_or_404(session_id)
        store.append_event(session_id, payload.type, payload.payload)
        return Response(status_code=status.HTTP_204_NO_CONTENT)

    @application.get("/api/session/{session_id}")
    def get_session(session_id: str) -> dict[str, Any]:
        return load_or_404(session_id)

    @application.get("/api/session/{session_id}/replay")
    def get_replay(session_id: str) -> dict[str, Any]:
        session = load_or_404(session_id)
        return {**session, "timeline": store.events(session_id)}

    return application


app = create_app()
