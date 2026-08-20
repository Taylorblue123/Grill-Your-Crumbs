from fastapi.testclient import TestClient

from app.main import create_app


def test_live_session_can_be_completed_and_replayed(tmp_path) -> None:
    client = TestClient(create_app(data_dir=tmp_path))

    created = client.post(
        "/api/session",
        json={
            "raw_experience": "I rebuilt onboarding for our student community.",
            "extra_sources": [
                {
                    "source_type": "notes",
                    "source_name": "retro.md",
                    "text": "New members often abandoned the old seven-step form.",
                }
            ],
        },
    )
    assert created.status_code == 201
    session_id = created.json()["session_id"]
    assert [chunk["id"] for chunk in created.json()["chunks"]] == ["c1", "c2"]

    reading = client.post(f"/api/session/{session_id}/read")
    assert reading.status_code == 200
    assert reading.json()["restatement"]
    assert "you i" not in reading.json()["restatement"].lower()
    assert len(reading.json()["probes"]) == 3

    corrected = client.patch(
        f"/api/session/{session_id}/read",
        json={"restatement": "I led the onboarding rebuild, not the full launch."},
    )
    assert corrected.status_code == 200
    corrected_session = client.get(f"/api/session/{session_id}").json()
    assert corrected_session["restatement"] == corrected.json()["restatement"]
    assert corrected_session["chunks"][-1]["source_name"] == "Corrected interpretation"

    first_question = client.post(f"/api/session/{session_id}/turn", json={})
    assert first_question.status_code == 200
    assert first_question.json()["turn"]["turn_id"] == "t1"
    assert first_question.json()["turn"]["status"] == "pending"

    second_question = client.post(
        f"/api/session/{session_id}/turn",
        json={"answer": "Activation rose from 42% to 61% in six weeks."},
    )
    assert second_question.status_code == 200
    assert second_question.json()["turn"]["turn_id"] == "t2"

    result = client.post(f"/api/session/{session_id}/artifact")
    assert result.status_code == 200
    assert result.json()["artifact"]["stats"]["n_grill"] >= 1
    assert result.json()["artifact"]["resume_bullets"][0][0]["ref"] == ["c3"]
    assert result.json()["artifact"]["resume_bullets"][0][0]["text"] == (
        "Led the onboarding rebuild, not the full launch."
    )
    assert result.json()["thread"]["quantified_results"][0]["turn_id"] == "t1"

    event = client.post(
        f"/api/session/{session_id}/event",
        json={"type": "copy_artifact", "payload": {"surface": "resume"}},
    )
    assert event.status_code == 204

    replay = client.get(f"/api/session/{session_id}/replay")
    assert replay.status_code == 200
    assert [item["type"] for item in replay.json()["timeline"]] == [
        "session_created",
        "source_read",
        "restatement_corrected",
        "question_asked",
        "answer_received",
        "question_asked",
        "artifact_created",
        "copy_artifact",
    ]


def test_missing_session_returns_not_found(tmp_path) -> None:
    client = TestClient(create_app(data_dir=tmp_path))

    response = client.get("/api/session/does-not-exist")

    assert response.status_code == 404
    assert response.json() == {"detail": "Session not found"}


def test_prepared_replay_uses_distinct_evidence_driven_questions(tmp_path) -> None:
    client = TestClient(create_app(data_dir=tmp_path))

    replay = client.get("/api/session/demo/replay").json()

    questions = [turn["question"] for turn in replay["turns"]]
    assert len(questions) == len(set(questions)) == 3


def test_offline_question_selection_skips_facts_already_in_sources(tmp_path) -> None:
    client = TestClient(create_app(data_dir=tmp_path))
    created = client.post(
        "/api/session",
        json={
            "raw_experience": "I rebuilt onboarding and activation rose from 42% to 61% in six weeks.",
        },
    ).json()
    client.post(f"/api/session/{created['session_id']}/read")

    first_question = client.post(f"/api/session/{created['session_id']}/turn", json={}).json()["turn"]

    assert "what number" not in first_question["question"].lower()
    assert "decision" in first_question["question"].lower()


def test_a_year_alone_does_not_count_as_a_measurable_result(tmp_path) -> None:
    client = TestClient(create_app(data_dir=tmp_path))
    created = client.post(
        "/api/session",
        json={"raw_experience": "In 2024, I rebuilt onboarding for a student community."},
    ).json()
    client.post(f"/api/session/{created['session_id']}/read")

    first_question = client.post(f"/api/session/{created['session_id']}/turn", json={}).json()["turn"]

    assert "what number" in first_question["question"].lower()


def test_complete_source_stops_without_redundant_questions(tmp_path) -> None:
    client = TestClient(create_app(data_dir=tmp_path))
    created = client.post(
        "/api/session",
        json={
            "raw_experience": (
                "I chose the alternative because of a constraint, activation rose from 42% to 61%, "
                "three teams adopted it, and I coached a teammate through the migration."
            ),
        },
    ).json()
    client.post(f"/api/session/{created['session_id']}/read")

    next_turn = client.post(f"/api/session/{created['session_id']}/turn", json={})
    artifact = client.post(f"/api/session/{created['session_id']}/artifact")

    assert next_turn.status_code == 200
    assert next_turn.json()["done"] is True
    assert next_turn.json()["turn"] is None
    assert artifact.status_code == 200
    assert artifact.json()["artifact"]["stats"]["n_grill"] == 0


def test_offline_artifact_caps_long_source_text(tmp_path) -> None:
    client = TestClient(create_app(data_dir=tmp_path))
    raw_experience = "I " + " ".join(f"detail{index}" for index in range(100))
    created = client.post("/api/session", json={"raw_experience": raw_experience}).json()

    artifact = client.post(f"/api/session/{created['session_id']}/artifact").json()["artifact"]
    source_segment = artifact["resume_bullets"][0][0]

    assert source_segment["origin"] == "source"
    assert len(source_segment["text"].split()) <= 40
