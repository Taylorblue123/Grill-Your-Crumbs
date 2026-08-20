#!/usr/bin/env python3
"""Score captured Grill outputs against deterministic JSONL assertions."""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path
from typing import Any

from check_grill_prompt_contract import ContractError, load_jsonl, validate_output_shape


ROOT = Path(__file__).resolve().parents[1]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--cases", type=Path, required=True)
    parser.add_argument("--outputs", type=Path, required=True)
    parser.add_argument("--output", type=Path)
    parser.add_argument("--allow-partial", action="store_true")
    return parser.parse_args()


def known_ids(state: dict[str, Any]) -> set[str]:
    ids = {item["id"] for item in state["crumbs"]}
    ids.update(item["id"] for item in state["requirements"])
    ids.update(item["id"] for item in state["prior_turns"])
    return ids


def score_case(case: dict[str, Any], output: dict[str, Any]) -> list[str]:
    failures: list[str] = []
    try:
        validate_output_shape(output, case["id"])
    except ContractError as error:
        return [str(error)]

    expected = case["expected"]
    state = case["input"]
    if output["action"] not in expected["allowed_actions"]:
        failures.append(f"action {output['action']!r} not allowed")
    if output["budget_lane"] not in expected["allowed_lanes"]:
        failures.append(f"lane {output['budget_lane']!r} not allowed")
    if output["dimension"] not in expected["allowed_dimensions"]:
        failures.append(f"dimension {output['dimension']!r} not allowed")

    refs = set(output["why_refs"])
    unknown = refs - known_ids(state)
    if unknown:
        failures.append(f"unknown why_refs: {sorted(unknown)}")

    if output["action"] == "ask":
        missing = set(expected["must_reference"]) - refs
        if missing:
            failures.append(f"missing expected refs: {sorted(missing)}")
        if output["target_requirement_id"] in expected["forbidden_requirement_ids"]:
            failures.append(f"forbidden requirement selected: {output['target_requirement_id']}")
        question = output["question"]
        folded = question.casefold()
        for term in expected["question_must_not_contain"]:
            if term.casefold() in folded:
                failures.append(f"question contains forbidden term: {term!r}")
        if question.count("?") + question.count("？") > 1:
            failures.append("question contains multiple question marks")
        if state["locale"].startswith("zh") and not re.search(r"[\u3400-\u9fff]", question):
            failures.append("question does not match Chinese locale")

        aid = output["answer_aid"]
        aid_refs = set(aid["refs"])
        invalid_aid_refs = aid_refs - known_ids(state)
        if invalid_aid_refs:
            failures.append(f"unknown answer-aid refs: {sorted(invalid_aid_refs)}")
        if aid["kind"] == "provisional_hypothesis":
            if not aid["provisional"] or not aid_refs:
                failures.append("provisional hypothesis must be flagged and evidence-backed")
        elif aid["provisional"]:
            failures.append("neutral scaffold cannot be marked provisional")

        lane = output["budget_lane"]
        if lane == "target" and state["budget"]["target_used"] >= state["budget"]["target_max"]:
            failures.append("target budget exceeded")
        if lane == "general" and state["budget"]["general_used"] >= state["budget"]["general_max"]:
            failures.append("general budget exceeded")
    return failures


def main() -> int:
    args = parse_args()
    cases = {row["id"]: row for row in load_jsonl(args.cases)}
    captured_rows = load_jsonl(args.outputs)
    captured: dict[str, dict[str, Any]] = {}
    for row in captured_rows:
        case_id = row.get("id")
        if case_id in captured:
            print(f"FAIL: duplicate output id {case_id}", file=sys.stderr)
            return 1
        if case_id not in cases:
            print(f"FAIL: unknown output id {case_id}", file=sys.stderr)
            return 1
        if not isinstance(row.get("output"), dict):
            print(f"FAIL: output for {case_id} must be an object", file=sys.stderr)
            return 1
        captured[case_id] = row["output"]

    missing_ids = set(cases) - set(captured)
    if missing_ids and not args.allow_partial:
        print(f"FAIL: missing outputs for {sorted(missing_ids)}", file=sys.stderr)
        return 1

    details = []
    for case_id, output in captured.items():
        failures = score_case(cases[case_id], output)
        details.append({"id": case_id, "passed": not failures, "failures": failures})

    passed = sum(item["passed"] for item in details)
    report = {
        "cases_file": str(args.cases),
        "outputs_file": str(args.outputs),
        "evaluated": len(details),
        "passed": passed,
        "failed": len(details) - passed,
        "pass_rate": passed / len(details) if details else 0.0,
        "partial": bool(missing_ids),
        "details": details,
    }
    rendered = json.dumps(report, ensure_ascii=False, indent=2)
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(rendered + "\n", encoding="utf-8")
    print(rendered)
    return 0 if report["failed"] == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
