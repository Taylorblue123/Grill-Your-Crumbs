from app.engine import GrillEngine, build_artifact


def test_invalid_model_artifact_uses_valid_fallback(monkeypatch) -> None:
    engine = GrillEngine(api_url="https://model.invalid", model="test")
    monkeypatch.setattr(
        GrillEngine,
        "_complete_json",
        lambda _self, _instruction: {
            "artifact_id": "bad",
            "resume_bullets": [[{"text": "Missing required provenance"}]],
            "self_intro": [],
            "stats": {},
        },
    )
    session = {
        "session_id": "s1",
        "restatement": "You rebuilt onboarding.",
        "chunks": [
            {
                "id": "c1",
                "source_type": "raw_experience",
                "source_name": "baseline",
                "text": "I rebuilt onboarding.",
            }
        ],
        "turns": [
            {
                "turn_id": "t1",
                "round": 1,
                "question": "What changed?",
                "why_asked": "Impact was missing.",
                "guessed_answer": "Perhaps activation improved.",
                "user_answer": "Activation rose from 42% to 61%.",
                "status": "answered",
            }
        ],
        "thread": {
            "thread_id": "thread-s1",
            "session_id": "s1",
            "highlight": "Activation rose from 42% to 61%.",
            "quantified_results": [],
            "decisions": [],
            "challenges": [],
            "raw_new_facts": [],
        },
    }

    artifact = engine.artifact(session)

    assert artifact["artifact_id"] == "artifact-s1"
    assert artifact["resume_bullets"][0][0]["ref"] == ["c1"]


def test_fallback_preserves_team_ownership_in_self_intro() -> None:
    session = {
        "session_id": "s1",
        "chunks": [
            {
                "id": "c1",
                "source_type": "raw_experience",
                "source_name": "baseline",
                "text": "We launched onboarding for the community.",
            }
        ],
        "turns": [],
    }

    artifact = build_artifact(session)

    assert artifact["self_intro"][0]["text"] == "We launched onboarding for the community."
