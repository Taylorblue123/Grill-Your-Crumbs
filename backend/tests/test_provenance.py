import pytest

from app.provenance import validate_artifact


def test_unverifiable_source_and_grill_segments_are_downgraded() -> None:
    chunks = [
        {
            "id": "c1",
            "source_type": "raw_experience",
            "source_name": "baseline",
            "text": "I rebuilt the onboarding flow for a student community.",
        }
    ]
    turns = [
        {
            "turn_id": "t1",
            "round": 1,
            "question": "What changed?",
            "why_asked": "The result is missing.",
            "guessed_answer": "Perhaps activation improved.",
            "user_answer": "Activation rose from 42% to 61% in six weeks.",
            "status": "answered",
        }
    ]
    artifact = {
        "artifact_id": "a1",
        "resume_bullets": [
            [
                {
                    "text": "Rebuilt the onboarding flow for a student community.",
                    "origin": "source",
                    "ref": ["c1"],
                    "turn_id": None,
                    "verified": False,
                },
                {
                    "text": "Activation rose from 42% to 61% in six weeks.",
                    "origin": "grill",
                    "ref": [],
                    "turn_id": "t1",
                    "verified": False,
                },
                {
                    "text": "Saved the company $2 million.",
                    "origin": "source",
                    "ref": ["c1"],
                    "turn_id": None,
                    "verified": True,
                },
                {
                    "text": "Activation rose from 42% to 61% in six weeks and saved $2 million.",
                    "origin": "grill",
                    "ref": [],
                    "turn_id": "t1",
                    "verified": True,
                },
                {
                    "text": "I single-handedly rebuilt the onboarding flow for a student community.",
                    "origin": "source",
                    "ref": ["c1"],
                    "turn_id": None,
                    "verified": True,
                },
            ]
        ],
        "self_intro": [],
        "stats": {"n_source": 0, "n_grill": 0, "n_inferred": 0},
    }

    validated = validate_artifact(artifact, chunks=chunks, turns=turns)
    segments = validated["resume_bullets"][0]

    assert segments[0]["origin"] == "source"
    assert segments[0]["verified"] is True
    assert segments[1]["origin"] == "grill"
    assert segments[1]["verified"] is True
    assert segments[2]["origin"] == "inferred"
    assert segments[2]["verified"] is False
    assert segments[3]["origin"] == "inferred"
    assert segments[3]["verified"] is False
    assert segments[4]["origin"] == "inferred"
    assert segments[4]["verified"] is False
    assert validated["stats"] == {"n_source": 1, "n_grill": 1, "n_inferred": 3}


@pytest.mark.parametrize(
    ("claim", "source"),
    [
        ("Approve the launch.", "I did not approve the launch."),
        ("Led the launch.", "My manager, not I, led the launch."),
        ("I launched onboarding.", "We launched onboarding."),
    ],
)
def test_negation_attribution_and_ownership_cannot_be_changed(claim: str, source: str) -> None:
    artifact = {
        "artifact_id": "a1",
        "resume_bullets": [
            [{"text": claim, "origin": "source", "ref": ["c1"], "turn_id": None, "verified": True}]
        ],
        "self_intro": [],
        "stats": {"n_source": 0, "n_grill": 0, "n_inferred": 0},
    }

    validated = validate_artifact(
        artifact,
        chunks=[{"id": "c1", "text": source}],
        turns=[],
    )

    segment = validated["resume_bullets"][0][0]
    assert segment["origin"] == "inferred"
    assert segment["verified"] is False
