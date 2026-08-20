# Grill for X prompt variants

`baseline-v0.txt` is an immutable copy of `SYSTEM_PROMPT` from commit `57fad7f81e35a238340c1bab8bd12e7e629a7d6d`, file `backend/app/engine.py`. It is retained for comparison and must not be edited.

The three candidates share the same product and output contract:

- one focused question at a time;
- evidence IDs in every user-facing rationale;
- a maximum 4 Target-driven + 2 general-value questions, with early stopping;
- six durable experience dimensions;
- neutral answer scaffolds instead of unsupported guessed answers;
- no fabrication for Target requirements with no evidence or adjacent cue;
- untrusted-input and sensitive-data handling;
- API-native enforcement of `evals/grill-for-x/response.schema.json` when supported.

Only one primary variable changes per comparison:

| Variant | Primary variable | Hypothesis |
|---|---|---|
| A · Direct gap | Direct ordered selection rules | A compact zero-shot policy is sufficient and cheapest. |
| B · Ranked selection | Generate up to three eligible candidates and rank by value minus burden | Explicit selection improves Good Question Rate on competing gaps. |
| C · Contrastive | A's policy plus three typical/negative examples | Examples improve boundary consistency and stop behavior at extra token cost. |

Compare A vs B to isolate selection strategy. Compare A vs C to isolate examples. Do not interpret B vs C as a single-variable experiment.

The runtime should send exactly one `<grill_state>` JSON object and enforce the response schema outside the prompt. The prompt files intentionally do not duplicate the full JSON Schema.
