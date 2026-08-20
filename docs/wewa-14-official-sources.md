# WEWA-14 official prompt and evaluation sources

Accessed: 2026-08-21. These are design references; task-specific eval results remain the acceptance criterion.

| Source | Provider | Applies to | Executable principle used here | Version boundary |
|---|---|---|---|---|
| [Prompt engineering](https://developers.openai.com/api/docs/guides/prompt-engineering) | OpenAI | OpenAI API models | Separate identity, instructions, examples, and context; delimit variable context; add representative fixtures and eval checks before changing prompts; use diverse examples only when needed. | Live documentation accessed 2026-08-21; model-specific behavior must be re-evaluated on the deployed model. |
| [Working with evals](https://developers.openai.com/api/docs/guides/evals) | OpenAI | OpenAI Evals and general eval workflow | Describe desired behavior first, run representative test inputs, analyze failures, then iterate. | Live documentation accessed 2026-08-21; API examples may change. |
| [Prompt engineering overview](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/overview) | Anthropic | Claude models | Establish success criteria, empirical tests, and a baseline prompt before prompt optimization; do not treat every failure as a prompt problem. | Live documentation accessed 2026-08-21; Claude-specific tuning does not automatically transfer to other models. |
| [Prompting best practices](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/claude-prompting-best-practices) | Anthropic | Claude models | Use clear sequential instructions, relevant/diverse examples, and consistent XML boundaries for mixed instructions and data. | Live documentation accessed 2026-08-21; example-count and long-context advice are model-specific and must be tested. |

## Cross-model principles adopted

- Freeze a real baseline and evaluate candidates on the same inputs and runtime settings.
- Define behavior and output contracts before optimizing wording.
- Keep stable instructions separate from untrusted dynamic context.
- Prefer native schema enforcement to prompt-only JSON requests.
- Use examples to address observed boundary failures, not as an automatic default.

## Model-specific cautions

- OpenAI's current documentation recommends structured outputs where available; this repository therefore keeps the JSON Schema outside the prose prompt.
- Anthropic documents XML tags as useful boundaries and recommends 3–5 relevant, diverse examples. Candidate C tests three examples; candidates A and B deliberately remain zero-shot.
- No result for one provider/model should be claimed for another without a separate run under the same case set.
