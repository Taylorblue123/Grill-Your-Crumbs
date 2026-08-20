from __future__ import annotations

import json
import logging
import os
import re
from dataclasses import dataclass
from typing import Any

import httpx
from pydantic import ValidationError

from .models import Artifact as ArtifactSchema
from .models import QuestionDraft, SourceAnalysis


logger = logging.getLogger(__name__)


QUESTION_BANK = [
    {
        "dimension": "The measurable change",
        "question": "What changed because of your work, and what number best proves it?",
        "why_asked": "The source describes the work, but not the measurable result that makes it credible.",
        "guessed_answer": "For example: activation moved from 42% to 61% within six weeks.",
    },
    {
        "dimension": "Your decision and trade-off",
        "question": "Which decision was specifically yours, and why did you choose it over the obvious alternative?",
        "why_asked": "Separating your judgment from the team's activity reveals seniority and ownership.",
        "guessed_answer": "For example: I removed two setup steps after observing where new users stopped.",
    },
    {
        "dimension": "The difficult constraint",
        "question": "What was the hardest constraint or failure you had to work through?",
        "why_asked": "Constraints expose the part of the achievement that a polished summary usually hides.",
        "guessed_answer": "For example: we could not change the identity provider, so I redesigned around it.",
    },
    {
        "dimension": "The downstream behavior change",
        "question": "Who noticed the outcome, and what did they do differently afterward?",
        "why_asked": "A downstream behavior change is stronger evidence than a self-reported success.",
        "guessed_answer": "For example: three community leads adopted the flow for their own cohorts.",
    },
    {
        "dimension": "The invisible contribution",
        "question": "What detail would a teammate include that you have left out?",
        "why_asked": "People routinely omit invisible coordination, recovery work, and unusually good judgment.",
        "guessed_answer": "For example: I also wrote the migration guide and coached two volunteers through rollout.",
    },
]


def _known_text(
    chunks: list[dict[str, Any]],
    turns: list[dict[str, Any]] | None = None,
    restatement: str | None = None,
) -> str:
    parts = [chunk["text"] for chunk in chunks]
    parts.extend(turn.get("user_answer") or "" for turn in turns or [])
    if restatement:
        parts.append(restatement)
    return "\n".join(parts).casefold()


def _dimension_is_covered(dimension: str, evidence: str) -> bool:
    signals = {
        "The measurable change": (
            r"%|percent|percentage|doubled|tripled|halved|"
            r"from\s+\d[\d,.]*\s+to\s+\d|"
            r"\b(rose|grew|fell|dropped|increased|decreased|reduced|improved|saved)\b.{0,40}\d"
        ),
        "Your decision and trade-off": r"\b(chose|decided|because|instead|trade.?off|alternative)\b",
        "The difficult constraint": r"\b(constraint|challenge|difficult|failed|failure|blocked|limitation)\b|could not|couldn't",
        "The downstream behavior change": r"\b(adopted|activated|activation|retained|renewed|converted|shared|support questions)\b",
        "The invisible contribution": r"\b(coached|mentored|coordinated|migration|documentation|teammate)\b",
    }
    return bool(re.search(signals[dimension], evidence, re.IGNORECASE))


def analyze_sources(chunks: list[dict[str, Any]]) -> dict[str, Any]:
    baseline = chunks[0]["text"].strip()
    first_sentence = re.split(r"(?<=[.!?。！？])\s+", baseline, maxsplit=1)[0]
    if first_sentence.casefold().startswith("i "):
        subject = f"you {first_sentence[2:]}"
    elif first_sentence.casefold().startswith("we "):
        subject = f"you and your team {first_sentence[3:]}"
    elif first_sentence:
        subject = first_sentence[0].lower() + first_sentence[1:]
    else:
        subject = "you led this work."
    restatement = f"I understand that {subject}"
    evidence = _known_text(chunks)
    probe_copy = {
        "The measurable change": "A number turns activity into evidence of impact.",
        "Your decision and trade-off": "The choice only you could explain reveals ownership and judgment.",
        "The difficult constraint": "What resisted you makes the achievement specific and believable.",
        "The downstream behavior change": "Someone acting differently is stronger evidence than a self-reported win.",
        "The invisible contribution": "Coordination and recovery work are often missing from polished summaries.",
    }
    missing = [
        question["dimension"]
        for question in QUESTION_BANK
        if not _dimension_is_covered(question["dimension"], evidence)
    ]
    covered = [
        question["dimension"]
        for question in QUESTION_BANK
        if question["dimension"] not in missing
    ]
    probes = [
        {"point": dimension, "why_valuable": probe_copy[dimension]}
        for dimension in (missing + covered)[:3]
    ]
    return {"restatement": restatement, "probes": probes}


def next_question(
    round_number: int,
    *,
    chunks: list[dict[str, Any]] | None = None,
    turns: list[dict[str, Any]] | None = None,
    restatement: str | None = None,
) -> dict[str, Any] | None:
    evidence = _known_text(chunks or [], turns, restatement)
    asked = {turn["question"] for turn in turns or []}
    missing = [
        question
        for question in QUESTION_BANK
        if not _dimension_is_covered(question["dimension"], evidence)
        and question["question"] not in asked
    ]
    if not missing:
        return None
    selected = missing[0]
    return {key: selected[key] for key in ("question", "why_asked", "guessed_answer")}


def add_answer_to_thread(thread: dict[str, Any], turn: dict[str, Any]) -> None:
    answer = (turn.get("user_answer") or "").strip()
    if not answer:
        return
    fact = {"text": answer, "turn_id": turn["turn_id"]}
    if re.search(r"\d|%|percent|percentage", answer, re.IGNORECASE):
        bucket = "quantified_results"
    elif re.search(r"\b(chose|decided|because|instead|trade.?off|alternative)\b", answer, re.IGNORECASE) or "decision" in turn["question"].casefold():
        bucket = "decisions"
    elif re.search(r"\b(constraint|challenge|difficult|failed|failure|blocked|limitation)\b|could not|couldn't", answer, re.IGNORECASE) or "constraint" in turn["question"].casefold():
        bucket = "challenges"
    else:
        bucket = "raw_new_facts"
    if fact not in thread[bucket]:
        thread[bucket].append(fact)
    thread["highlight"] = answer


def _source_segment(source: dict[str, Any], text: str | None = None) -> dict[str, Any]:
    return {
        "text": text or source["text"],
        "origin": "source",
        "ref": [source["id"]],
        "turn_id": None,
        "verified": False,
    }


def _grill_segment(turn: dict[str, Any]) -> dict[str, Any]:
    first_sentence = re.split(
        r"(?<=[.!?。！？])\s+", (turn["user_answer"] or "").strip(), maxsplit=1
    )[0]
    excerpt = " ".join(first_sentence.split()[:40])
    return {
        "text": excerpt,
        "origin": "grill",
        "ref": [],
        "turn_id": turn["turn_id"],
        "verified": False,
    }


def _resume_action(text: str) -> str:
    first_sentence = re.split(r"(?<=[.!?。！？])\s+", text.strip(), maxsplit=1)[0]
    cleaned = " ".join(first_sentence.split()[:40]).rstrip(".!?")
    for prefix in ("I ", "We ", "You "):
        if cleaned.casefold().startswith(prefix.casefold()):
            cleaned = cleaned[len(prefix) :]
            break
    return cleaned[:1].upper() + cleaned[1:] + "."


def _first_person(text: str) -> str:
    first_sentence = re.split(r"(?<=[.!?。！？])\s+", text.strip(), maxsplit=1)[0]
    return " ".join(first_sentence.split()[:40])


def build_artifact(session: dict[str, Any]) -> dict[str, Any]:
    source = next(
        (chunk for chunk in session["chunks"] if chunk["source_name"] == "Corrected interpretation"),
        session["chunks"][0],
    )
    answered = [turn for turn in session["turns"] if turn["status"] == "answered"]
    source_segment = _source_segment(source, _resume_action(source["text"]))
    grill_segments = [_grill_segment(turn) for turn in answered[:3]]
    inference = {
        "text": "The combined evidence suggests a clear story of ownership and measurable impact.",
        "origin": "inferred",
        "ref": [],
        "turn_id": None,
        "verified": False,
    }
    resume_bullets = [[source_segment, *grill_segments[:1]]]
    resume_bullets.extend([[segment] for segment in grill_segments[1:]])
    self_intro = [
        _source_segment(source, _first_person(source["text"])),
        *[_grill_segment(turn) for turn in answered[:2]],
        inference,
    ]
    return {
        "artifact_id": f"artifact-{session['session_id']}",
        "resume_bullets": resume_bullets,
        "self_intro": self_intro,
        "stats": {"n_source": 0, "n_grill": 0, "n_inferred": 0},
    }


SYSTEM_PROMPT = """You are Grill, an evidence-first career interviewer.
Help a user turn an underspecified experience into concrete, credible career material.

Rules:
- Ask one focused follow-up at a time.
- Ask only for facts that cannot be inferred from the supplied material or earlier answers.
- Prefer measurable outcomes, personal decisions and trade-offs, real constraints, failures, and downstream impact.
- Never ask a generic question such as 'Can you tell me more?'
- Explain why each question may uncover hidden value.
- Offer one concrete guessed answer that the user can confirm or replace.
- Never invent provenance. A source segment must cite a supplied chunk id and closely match its text. A grill segment must cite a turn id and closely match that user's answer. Anything else is inferred.
- Return only valid JSON matching the requested shape.
"""


@dataclass(frozen=True)
class GrillEngine:
    api_url: str | None = None
    model: str | None = None
    api_key: str | None = None
    timeout_seconds: float = 30.0

    @classmethod
    def from_env(cls) -> "GrillEngine":
        return cls(
            api_url=os.getenv("GRILL_LLM_API_URL") or None,
            model=os.getenv("GRILL_LLM_MODEL") or None,
            api_key=os.getenv("GRILL_LLM_API_KEY") or None,
            timeout_seconds=float(os.getenv("GRILL_LLM_TIMEOUT", "30")),
        )

    @property
    def model_enabled(self) -> bool:
        return bool(self.api_url and self.model)

    def _complete_json(self, instruction: str) -> dict[str, Any] | None:
        if not self.model_enabled:
            return None
        headers = {"Content-Type": "application/json"}
        if self.api_key:
            headers["Authorization"] = f"Bearer {self.api_key}"
        try:
            response = httpx.post(
                self.api_url,
                headers=headers,
                json={
                    "model": self.model,
                    "messages": [
                        {"role": "system", "content": SYSTEM_PROMPT},
                        {"role": "user", "content": instruction},
                    ],
                    "response_format": {"type": "json_object"},
                    "temperature": 0.25,
                },
                timeout=self.timeout_seconds,
            )
            response.raise_for_status()
            content = response.json()["choices"][0]["message"]["content"]
            return json.loads(content)
        except (httpx.HTTPError, KeyError, IndexError, TypeError, json.JSONDecodeError) as error:
            logger.warning("Model response failed validation; using deterministic fallback: %s", error)
            return None

    def analyze(self, chunks: list[dict[str, Any]]) -> dict[str, Any]:
        result = self._complete_json(
            "Read these source chunks:\n"
            f"{json.dumps(chunks, ensure_ascii=False)}\n\n"
            "Return {\"restatement\": string, \"probes\": [{\"point\": string, "
            "\"why_valuable\": string}]} with exactly three probes. The restatement should expose "
            "your current understanding so the user can correct it."
        )
        try:
            if result:
                return SourceAnalysis.model_validate(result).model_dump()
        except ValidationError as error:
            logger.warning("Model source analysis failed schema validation; using fallback: %s", error)
        return analyze_sources(chunks)

    def question(self, session: dict[str, Any]) -> dict[str, Any] | None:
        round_number = len(session["turns"]) + 1
        fallback = next_question(
            round_number,
            chunks=session["chunks"],
            turns=session["turns"],
            restatement=session.get("restatement"),
        )
        if fallback is None:
            return None
        result = self._complete_json(
            "Choose the single highest-value next question for this session:\n"
            f"{json.dumps({'chunks': session['chunks'], 'restatement': session.get('restatement'), 'turns': session['turns']}, ensure_ascii=False)}\n\n"
            "Return {\"question\": string, \"why_asked\": string, \"guessed_answer\": string}."
        )
        try:
            if result:
                return QuestionDraft.model_validate(result).model_dump()
        except ValidationError as error:
            logger.warning("Model question failed schema validation; using fallback: %s", error)
        return fallback

    def artifact(self, session: dict[str, Any]) -> dict[str, Any]:
        result = self._complete_json(
            "Create a concise resume bullet and first-person self introduction from this session:\n"
            f"{json.dumps({'chunks': session['chunks'], 'turns': session['turns'], 'thread': session['thread']}, ensure_ascii=False)}\n\n"
            "Return {\"artifact_id\": string, \"resume_bullets\": [[Segment]], "
            "\"self_intro\": [Segment], \"stats\": {\"n_source\": 0, \"n_grill\": 0, "
            "\"n_inferred\": 0}}. Segment is {\"text\": string, "
            "\"origin\": \"source|grill|inferred\", \"ref\": [chunk_id], "
            "\"turn_id\": turn_id|null, \"verified\": false}. Keep source and grill segments "
            "close enough to their cited evidence for deterministic token-overlap verification."
        )
        try:
            if result:
                result["artifact_id"] = result.get("artifact_id") or f"artifact-{session['session_id']}"
                result["stats"] = {"n_source": 0, "n_grill": 0, "n_inferred": 0}
                return ArtifactSchema.model_validate(result).model_dump()
        except ValidationError as error:
            logger.warning("Model artifact failed schema validation; using fallback: %s", error)
        return build_artifact(session)
