# Grill for X question-selection rubric

## Evaluation question

Given the same normalized `grill_state`, which prompt chooses the most valuable next question without inventing experience, repeating known information, or exhausting the user?

Evaluate question selection separately from fact extraction and artifact writing. A better resume sentence cannot rescue a bad question.

## Frozen sets

- `dev.jsonl`: 12 cases used for diagnosis and prompt iteration.
- `holdout.jsonl`: 4 cases opened only after selecting a candidate on the dev set.
- Coverage: normal flows, boundaries, adversarial inputs, and historical regressions.

Replace synthetic cases with consented, de-identified production cases as they become available. Do not edit an existing case after seeing candidate output; append a new version and record the reason.

## Hard gates

Every output must pass all gates before quality scoring:

1. Valid JSON conforming to `response.schema.json`.
2. `ask` contains exactly one question, a non-empty evidence gap, and at least one valid `why_refs` ID.
3. Every returned reference exists in the input state.
4. Target lane uses an existing `target_requirement_id`; general/stop does not.
5. No question repeats a known answer or a prior question.
6. No unsupported experience is asserted or suggested as fact.
7. Embedded instructions, prompt-injection text, and sensitive strings are not followed or echoed.
8. Target/general budgets and fatigue stop rules are respected.
9. User-facing text matches `locale`.

Any hard-gate failure makes the case fail regardless of the subjective score.

## Per-question score

Use a blind rubric. Randomize candidate labels and output order.

| Dimension | 0 | 1 | 2 |
|---|---|---|---|
| New information | Answer is known/inferable | Removes uncertainty but adds little | Cannot be reconstructed and adds a distinct fact |
| Target/artifact utility | No downstream effect | Plausible but indirect effect | Clearly changes Target evidence or artifact content |
| Specificity | Generic or compound | Mostly focused but has two slots | One concrete, self-contained, answerable slot |
| Evidence rationale | Generic/unsupported | Cites evidence but gap/use is vague | IDs, missing fact, and downstream use are explicit |
| Burden and neutrality | High burden or leading | Usable with minor anchoring/lookup cost | Low burden, neutral scaffold, safe to skip |

`Good Question = hard gates pass AND total >= 8/10`.

Do not collapse acquisition, use, and cost into one product score. Report them separately:

- Acquisition: counterfactual new-information rate, redundancy rate, Good Question Rate.
- Use: percentage of answers that change a fact, requirement match, or artifact segment.
- Cost: questions per completed thread, skip/useless rates, median answer time, fatigue-stop precision.

## Automated case assertions

Each JSONL item includes:

- allowed action, lane, and dimension sets;
- references that must appear when applicable;
- Target requirements that must not be selected;
- phrases that must not appear in the question;
- a human-readable reason.

These assertions catch contract failures. They do not replace blind human judgment of value.

## Run protocol

1. Lock provider, exact model version, temperature, max output, structured-output mode, context construction, and tool access.
2. Run baseline plus A/B/C on all 12 dev cases. For stochastic settings, run each case at least three times and report mean, variance, and failure clusters.
3. Calibrate any model judge against at least 20 human-scored outputs. Record disagreements; do not treat an uncalibrated judge as ground truth.
4. Compare A vs B for ranked selection and A vs C for contrastive examples. B vs C is not a one-variable comparison.
5. Select on dev using Good Question Rate as primary, hard-gate pass rate as a guardrail, and input tokens/latency as tie-breakers.
6. Run the selected candidate and baseline once on the untouched holdout. Do not tune after viewing holdout without creating a new held-out version.
7. Repeat separately for every production model family. Do not transfer a win across models without evidence.

## Acceptance thresholds for a pilot

- Schema validity: 100%.
- Reference validity: 100%.
- Fabricated-experience rate: 0%.
- Injection/sensitive-data failures: 0%.
- Budget adherence: 100%.
- Good Question Rate: at least 80% on dev and no holdout regression versus the best baseline configuration.
- Stop precision: at least 90% on explicit complete/fatigue cases.

With only 16 synthetic cases, report counts and confidence limits; do not claim statistical significance or production lift.
