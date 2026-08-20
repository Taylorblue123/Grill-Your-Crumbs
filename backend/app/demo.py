from __future__ import annotations

from copy import deepcopy

from .engine import add_answer_to_thread, analyze_sources, build_artifact, next_question
from .provenance import validate_artifact
from .storage import SessionNotFoundError, SessionStore


DEMO_BASELINE = (
    "I helped rebuild onboarding for a student founder community and worked with the team to launch it."
)

DEMO_ANSWERS = [
    "Activation rose from 42% to 61% in six weeks, while support questions fell by about a third.",
    "I chose to cut the form from seven steps to three after watching eight new members abandon identity setup.",
    "We could not replace the identity provider, so I designed a progressive profile flow around that constraint.",
]


def ensure_demo_session(store: SessionStore) -> None:
    try:
        store.load("demo")
        return
    except SessionNotFoundError:
        pass

    session = store.create_session(
        DEMO_BASELINE,
        [
            {
                "source_type": "notes",
                "source_name": "onboarding-retro.md",
                "text": "New members regularly abandoned the old seven-step form during identity setup.",
            }
        ],
        session_id="demo",
    )
    reading = analyze_sources(session["chunks"])
    session.update(reading)
    store.append_event("demo", "source_read", {"probe_count": 3})

    for round_number, answer in enumerate(DEMO_ANSWERS, start=1):
        question = next_question(
            round_number,
            chunks=session["chunks"],
            turns=session["turns"],
            restatement=session["restatement"],
        )
        turn = {
            "turn_id": f"t{round_number}",
            "round": round_number,
            **question,
            "user_answer": answer,
            "status": "answered",
        }
        session["turns"].append(turn)
        store.append_event("demo", "question_asked", {"turn_id": turn["turn_id"]})
        store.append_event("demo", "answer_received", {"turn_id": turn["turn_id"]})
        add_answer_to_thread(session["thread"], turn)

    raw_artifact = build_artifact(session)
    session["artifact"] = validate_artifact(
        deepcopy(raw_artifact), chunks=session["chunks"], turns=session["turns"]
    )
    store.save(session)
    store.append_event("demo", "artifact_created", session["artifact"]["stats"])
