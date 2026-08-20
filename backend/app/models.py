from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator


SourceType = Literal[
    "raw_experience",
    "resume",
    "repo",
    "linkedin",
    "portfolio",
    "notes",
    "diary",
    "social",
]


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class Chunk(StrictModel):
    id: str = Field(min_length=1, max_length=80)
    source_type: SourceType
    source_name: str = Field(min_length=1, max_length=120)
    text: str = Field(min_length=1, max_length=60_000)


class Probe(StrictModel):
    point: str = Field(min_length=1, max_length=300)
    why_valuable: str = Field(min_length=1, max_length=600)


class SourceAnalysis(StrictModel):
    restatement: str = Field(min_length=1, max_length=2_000)
    probes: list[Probe] = Field(min_length=3, max_length=3)


class QuestionDraft(StrictModel):
    question: str = Field(min_length=1, max_length=1_000)
    why_asked: str = Field(min_length=1, max_length=1_000)
    guessed_answer: str = Field(min_length=1, max_length=2_000)


TurnStatus = Literal["pending", "answered", "skipped", "flagged_useless"]


class Turn(QuestionDraft):
    turn_id: str = Field(min_length=1, max_length=80)
    round: int = Field(ge=1, le=20)
    user_answer: str | None = Field(default=None, max_length=10_000)
    status: TurnStatus


class ThreadFact(StrictModel):
    text: str = Field(min_length=1, max_length=10_000)
    turn_id: str = Field(min_length=1, max_length=80)


class Thread(StrictModel):
    thread_id: str = Field(min_length=1, max_length=120)
    session_id: str = Field(min_length=1, max_length=120)
    highlight: str = Field(max_length=10_000)
    quantified_results: list[ThreadFact] = Field(default_factory=list)
    decisions: list[ThreadFact] = Field(default_factory=list)
    challenges: list[ThreadFact] = Field(default_factory=list)
    raw_new_facts: list[ThreadFact] = Field(default_factory=list)


Origin = Literal["source", "grill", "inferred"]


class Segment(StrictModel):
    text: str = Field(min_length=1, max_length=10_000)
    origin: Origin
    ref: list[str] = Field(default_factory=list, max_length=20)
    turn_id: str | None = Field(default=None, max_length=80)
    verified: bool = False

    @model_validator(mode="after")
    def validate_reference_shape(self) -> "Segment":
        if self.origin == "source" and not self.ref:
            raise ValueError("Source segments require at least one chunk reference")
        if self.origin == "grill" and not self.turn_id:
            raise ValueError("Grill segments require a turn id")
        return self


class ArtifactStats(StrictModel):
    n_source: int = Field(default=0, ge=0)
    n_grill: int = Field(default=0, ge=0)
    n_inferred: int = Field(default=0, ge=0)


class Artifact(StrictModel):
    artifact_id: str = Field(min_length=1, max_length=120)
    resume_bullets: list[list[Segment]] = Field(min_length=1, max_length=10)
    self_intro: list[Segment] = Field(min_length=1, max_length=100)
    stats: ArtifactStats = Field(default_factory=ArtifactStats)


class ExtraSource(StrictModel):
    source_type: SourceType
    source_name: str = Field(min_length=1, max_length=120)
    text: str = Field(min_length=1, max_length=60_000)


class SessionCreate(StrictModel):
    raw_experience: str = Field(min_length=10, max_length=60_000)
    extra_sources: list[ExtraSource] = Field(default_factory=list, max_length=20)


class TurnSubmission(StrictModel):
    answer: str | None = Field(default=None, max_length=10_000)
    skipped: bool = False
    flagged_useless: bool = False

    @model_validator(mode="after")
    def validate_action(self) -> "TurnSubmission":
        actions = [bool(self.answer and self.answer.strip()), self.skipped, self.flagged_useless]
        if sum(actions) > 1:
            raise ValueError("Choose only one turn action")
        return self


class RestatementUpdate(StrictModel):
    restatement: str = Field(min_length=10, max_length=2_000)


EventType = Literal[
    "copy_artifact",
    "export_md",
    "flag_useless_question",
    "delete_segment",
]


class EventCreate(StrictModel):
    type: EventType
    payload: dict[str, Any] = Field(default_factory=dict)
