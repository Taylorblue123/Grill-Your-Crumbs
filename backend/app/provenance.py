from __future__ import annotations

import re
from copy import deepcopy
from typing import Any, Iterable


TOKEN_RE = re.compile(r"[\w%]+", re.UNICODE)


def _tokens(value: str) -> list[str]:
    return [token.casefold() for token in TOKEN_RE.findall(value)]


def _supported(candidate: str, evidence: Iterable[str]) -> bool:
    candidate_tokens = _tokens(candidate)
    if not candidate_tokens:
        return False

    for source in evidence:
        source_tokens = _tokens(source)
        normalized_candidate = candidate_tokens
        normalized_source = source_tokens
        if (
            normalized_candidate
            and normalized_candidate[0] not in {"i", "we", "you"}
            and normalized_source
            and normalized_source[0] in {"i", "we", "you"}
        ):
            normalized_source = normalized_source[1:]
        if normalized_candidate and normalized_source[: len(normalized_candidate)] == normalized_candidate:
            return True
    return False


def _all_segments(artifact: dict[str, Any]) -> Iterable[dict[str, Any]]:
    for bullet in artifact.get("resume_bullets", []):
        yield from bullet
    yield from artifact.get("self_intro", [])


def validate_artifact(
    artifact: dict[str, Any],
    *,
    chunks: list[dict[str, Any]],
    turns: list[dict[str, Any]],
) -> dict[str, Any]:
    """Validate provenance claims and downgrade unsupported claims.

    This function deliberately accepts and returns JSON-shaped dictionaries so
    it can guard both model output and replay fixtures at the API boundary.
    """

    validated = deepcopy(artifact)
    chunks_by_id = {chunk["id"]: chunk for chunk in chunks}
    turns_by_id = {turn["turn_id"]: turn for turn in turns}
    counts = {"source": 0, "grill": 0, "inferred": 0}

    for segment in _all_segments(validated):
        origin = segment.get("origin")
        is_supported = False

        if origin == "source":
            evidence = [
                chunks_by_id[chunk_id]["text"]
                for chunk_id in segment.get("ref", [])
                if chunk_id in chunks_by_id
            ]
            is_supported = _supported(segment.get("text", ""), evidence)
        elif origin == "grill":
            turn = turns_by_id.get(segment.get("turn_id"))
            if turn and turn.get("status") == "answered" and turn.get("user_answer"):
                is_supported = _supported(segment.get("text", ""), [turn["user_answer"]])

        if origin in {"source", "grill"} and is_supported:
            segment["verified"] = True
        else:
            segment["origin"] = "inferred"
            segment["verified"] = False
            segment["ref"] = []
            segment["turn_id"] = None

        counts[segment["origin"]] += 1

    validated["stats"] = {
        "n_source": counts["source"],
        "n_grill": counts["grill"],
        "n_inferred": counts["inferred"],
    }
    return validated
