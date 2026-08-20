#!/usr/bin/env python3
"""Deterministic contract checks for WEWA-14 prompt and eval artifacts."""

from __future__ import annotations

import hashlib
import json
import re
import sys
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
PROMPT_DIR = ROOT / "prompts" / "grill-for-x"
EVAL_DIR = ROOT / "evals" / "grill-for-x"
BASELINE_SHA256 = "2ccb810b344200c2dc03fa24871b363cbd86f5d44bb286a76f7f71ed748047b8"


class ContractError(AssertionError):
    pass


def require(condition: bool, message: str) -> None:
    if not condition:
        raise ContractError(message)


def load_jsonl(path: Path) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for line_number, raw in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
        try:
            row = json.loads(raw)
        except json.JSONDecodeError as error:
            raise ContractError(f"{path}:{line_number}: invalid JSON: {error}") from error
        require(isinstance(row, dict), f"{path}:{line_number}: row must be an object")
        rows.append(row)
    return rows


def validate_output_shape(output: dict[str, Any], label: str) -> None:
    required = {
        "action",
        "budget_lane",
        "dimension",
        "target_requirement_id",
        "question",
        "why_asked",
        "why_refs",
        "evidence_gap",
        "answer_aid",
        "stop_reason",
    }
    require(set(output) == required, f"{label}: output keys do not match schema")
    require(output["action"] in {"ask", "stop"}, f"{label}: invalid action")
    require(isinstance(output["why_refs"], list), f"{label}: why_refs must be a list")
    if output["action"] == "ask":
        require(output["budget_lane"] in {"target", "general"}, f"{label}: ask lane")
        require(isinstance(output["question"], str) and output["question"], f"{label}: question")
        require(isinstance(output["why_asked"], str) and output["why_asked"], f"{label}: why")
        require(bool(output["why_refs"]), f"{label}: ask must cite evidence")
        require(isinstance(output["evidence_gap"], dict), f"{label}: evidence gap")
        require(isinstance(output["answer_aid"], dict), f"{label}: answer aid")
        require(output["stop_reason"] is None, f"{label}: ask stop_reason must be null")
        if output["budget_lane"] == "target":
            require(isinstance(output["target_requirement_id"], str), f"{label}: target id")
        else:
            require(output["target_requirement_id"] is None, f"{label}: general target id")
    else:
        for key in (
            "budget_lane",
            "dimension",
            "target_requirement_id",
            "question",
            "why_asked",
            "evidence_gap",
            "answer_aid",
        ):
            require(output[key] is None, f"{label}: stop {key} must be null")
        require(output["why_refs"] == [], f"{label}: stop why_refs must be empty")
        require(isinstance(output["stop_reason"], str) and output["stop_reason"], f"{label}: stop reason")


def check_baseline() -> None:
    baseline = (PROMPT_DIR / "baseline-v0.txt").read_bytes()
    digest = hashlib.sha256(baseline).hexdigest()
    require(digest == BASELINE_SHA256, "baseline-v0.txt changed; create a new version instead")


def check_candidates() -> None:
    paths = {
        "A": PROMPT_DIR / "candidate-a-direct-gap.txt",
        "B": PROMPT_DIR / "candidate-b-ranked-selection.txt",
        "C": PROMPT_DIR / "candidate-c-contrastive.txt",
    }
    common = (
        "{{GRILL_STATE_JSON}}",
        "untrusted data",
        "one self-contained, single-slot question",
        "Target questions",
        "general",
        "why_refs",
        "native structured output",
        "Six questions is a cap, not a quota",
        "sensitive",
    )
    texts: dict[str, str] = {}
    for label, path in paths.items():
        text = path.read_text(encoding="utf-8")
        texts[label] = text
        for phrase in common:
            require(phrase in text, f"candidate {label} missing contract phrase: {phrase}")
        require(text.count("{{GRILL_STATE_JSON}}") == 1, f"candidate {label}: state placeholder count")

    require("Internally generate at most three" in texts["B"], "candidate B lacks ranking variable")
    require("target_impact" in texts["B"] and "answer_cost" in texts["B"], "candidate B scores incomplete")
    require("Internally generate at most three" not in texts["A"], "candidate A leaked ranking variable")
    require("<examples>" not in texts["A"] and "<examples>" not in texts["B"], "A/B must be zero-shot")
    require(texts["C"].count("<example>") == 3, "candidate C must have exactly three examples")

    example_blocks = re.findall(
        r"<assistant_output>\s*(\{.*?\})\s*</assistant_output>", texts["C"], re.DOTALL
    )
    require(len(example_blocks) == 3, "candidate C example outputs not found")
    for index, block in enumerate(example_blocks, 1):
        try:
            output = json.loads(block)
        except json.JSONDecodeError as error:
            raise ContractError(f"candidate C example {index}: invalid JSON: {error}") from error
        validate_output_shape(output, f"candidate C example {index}")


def check_schema() -> None:
    schema = json.loads((EVAL_DIR / "response.schema.json").read_text(encoding="utf-8"))
    require(schema.get("additionalProperties") is False, "response schema must reject extra fields")
    properties = schema.get("properties", {})
    require(set(schema.get("required", [])) == set(properties), "every response property must be required")
    require(properties.get("action", {}).get("enum") == ["ask", "stop"], "action enum drift")
    require(len(schema.get("allOf", [])) >= 2, "response schema lacks conditional contracts")


def check_eval_rows() -> None:
    dev = load_jsonl(EVAL_DIR / "dev.jsonl")
    holdout = load_jsonl(EVAL_DIR / "holdout.jsonl")
    require(len(dev) >= 10, "dev set must contain at least 10 cases")
    require(len(holdout) >= 3, "holdout set must contain at least 3 cases")
    categories = {row.get("category") for row in dev}
    require(categories == {"normal", "boundary", "adversarial", "regression"}, "dev category coverage")

    all_rows = dev + holdout
    ids = [row.get("id") for row in all_rows]
    require(all(isinstance(case_id, str) and case_id for case_id in ids), "case id missing")
    require(len(ids) == len(set(ids)), "case ids must be unique across dev and holdout")

    required_input = {
        "locale",
        "output_kind",
        "target",
        "requirements",
        "crumbs",
        "experience_baseline",
        "prior_turns",
        "budget",
        "fatigue",
    }
    required_expected = {
        "allowed_actions",
        "allowed_lanes",
        "allowed_dimensions",
        "must_reference",
        "forbidden_requirement_ids",
        "question_must_not_contain",
        "reason",
    }
    for row in all_rows:
        label = row["id"]
        require(row.get("difficulty") in {"easy", "medium", "hard"}, f"{label}: difficulty")
        state = row.get("input")
        expected = row.get("expected")
        require(isinstance(state, dict) and set(state) == required_input, f"{label}: input contract")
        require(isinstance(expected, dict) and set(expected) == required_expected, f"{label}: expected contract")
        budget = state["budget"]
        require(budget.get("target_max") == 4 and budget.get("general_max") == 2, f"{label}: 4:2 budget")
        require(budget["target_used"] <= 4 and budget["general_used"] <= 2, f"{label}: used budget")

        known_ids = {item["id"] for item in state["crumbs"]}
        known_ids.update(item["id"] for item in state["requirements"])
        known_ids.update(item["id"] for item in state["prior_turns"])
        missing_refs = set(expected["must_reference"]) - known_ids
        require(not missing_refs, f"{label}: unknown expected refs {sorted(missing_refs)}")
        requirement_ids = {item["id"] for item in state["requirements"]}
        invalid_forbidden = set(expected["forbidden_requirement_ids"]) - requirement_ids
        require(not invalid_forbidden, f"{label}: unknown forbidden requirements")


def main() -> int:
    try:
        check_baseline()
        check_candidates()
        check_schema()
        check_eval_rows()
    except (ContractError, FileNotFoundError, KeyError, TypeError, ValueError) as error:
        print(f"FAIL: {error}", file=sys.stderr)
        return 1
    print("PASS: baseline, 3 candidates, response schema, 12 dev cases, and 4 holdout cases")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
