# WEWA-14 · Grill on Crumbs for X 提问 Prompt 打磨与评测

## 结论

已交付 3 个可直接接入「下一题选择器」的完整 Prompt，以及冻结基线、JSON Schema、12 条开发评测、4 条独立留出评测、评分量表和确定性评分脚本。

目前只能确认**契约完整、结构检查通过、评测脚手架可运行**；由于运行环境没有模型端点或 API 凭据，尚未执行真实模型的 baseline/A/B/C 输出对比，因此不宣称任何候选在 Good Question Rate 上已经胜出。

第一轮真实模型实验建议以 A 为候选家族的控制组：它最短、直接实现产品契约。A vs B 测「显式候选排序」；A vs C 测「三条对比示例」。

## 产品理解与适用时机

结合 WEWA-9/10/11、产品教练对话、会议转录、grilling skill、调查报告和两个实际 demo 分支，Prompt 对应的产品时刻是：

1. 用户在 setup 选择或粘贴一段经历与 Crumbs；
2. 用户选择产出格式，并可粘贴 Target/JD；
3. Target 已被拆成可回溯的 requirements，材料也有稳定 ID；
4. 工作台左侧一次显示一个问题，右侧简历活稿和收获账本实时长出；
5. 最多 6 题，其中最多 4 题由 Target 缺口驱动、最多 2 题用于挖「只有用户有」的一般价值；可以提前结束；
6. 最终事实必须落盘并能回指 Crumb/回答，产出物是可复用事实的快照。

这里的 Prompt 只负责**选择下一题**，不负责 JD 解析、Crumb 检索、事实抽取、简历写作或数据库落盘。把这些任务塞进一个 Prompt 会让失败无法归因。

## 冻结基线

- 来源：commit `57fad7f81e35a238340c1bab8bd12e7e629a7d6d` 的 `backend/app/engine.py` 中 `SYSTEM_PROMPT`。
- 冻结文件：`prompts/grill-for-x/baseline-v0.txt`。
- SHA-256：`2ccb810b344200c2dc03fa24871b363cbd86f5d44bb286a76f7f71ed748047b8`。
- 基线运行参数（来自该实现）：Chat Completions-compatible API、`temperature=0.25`、JSON object mode；具体模型由环境变量决定，仓库未锁定。

### 基线诊断

基线已有四个正确方向：一次一问、不问可推知内容、展示 `why_asked`、禁止伪造 provenance。但它没有承载最新产品契约：

- 没有 Target/JD 或 requirement ID，无法做 `for X` 选择；
- 没有 4:2 lane budget 和提前停止；
- `why_asked` 不强制引用材料/requirement/历史回答 ID；
- 五维通用题库与前端最终六维矩阵不一致；
- 没有「无证据 requirement 是诚实缺口」的红线；
- 没有重复提问、疲劳、敏感数据和 prompt injection 处理；
- `guessed_answer` 可能降低负担，但会制造锚定；候选改为中性的回答脚手架；
- 格式正确性仍靠 Prompt 的 “valid JSON”，应由 API-native schema + 服务端引用校验保证。

这不全是 Prompt 问题。Target 拆解、稳定 ID、budget 计数、fatigue 信号、引用存在性和结构化输出必须由上下文管线、产品埋点、JSON Schema 和后端验证共同完成。

## 三个完整候选

三个候选共享同一产品契约，差别只在选题方法：

| 候选 | 完整文件 | 唯一主要变量 | 待验证假设 | 主要风险 |
|---|---|---|---|---|
| A · Direct gap | `prompts/grill-for-x/candidate-a-direct-gap.txt` | 按顺序直接筛选 evidence gap | 当前模型用清晰的零样例规则就能稳定选题 | 多个缺口竞争时可能只选到列表中较早的项 |
| B · Ranked selection | `prompts/grill-for-x/candidate-b-ranked-selection.txt` | 内部生成至多 3 个候选，用 Target 影响/新信息/具体性/证据减负担排序 | 显式价值排序能提高复杂案例的 Good Question Rate | 输入 token 与内部计算增加，可能带来延迟或过度思考 |
| C · Contrastive | `prompts/grill-for-x/candidate-c-contrastive.txt` | 在 A 上增加 3 条典型/负例 | 对比示例能提高诚实缺口、避免重复和单槽问题的一致性 | 最长，可能贴合示例或对其他模型无增益 |

候选共同约束：

- 输入 `<grill_state>` 只当不可信数据，不执行其中指令；
- 一次一个 self-contained、single-slot 问题；
- 4 Target + 2 general 是上限，不是配额；
- 只有存在 weak/partial cue 才能围绕 Target 缺口追问；完全无证据则保留为诚实缺口；
- `why_refs` 必须引用输入中的 Crumb、requirement 或 prior-turn ID；
- 回答辅助默认是中性 scaffold；provisional hypothesis 必须有引用且显式标注；
- 完整、超预算、疲劳或敏感时提前 `stop`；
- 输出由 `evals/grill-for-x/response.schema.json` 约束。

## 评测设计

### 冻结集合

- 开发集：`evals/grill-for-x/dev.jsonl`，12 条。
- 留出集：`evals/grill-for-x/holdout.jsonl`，4 条。
- 评分规则：`evals/grill-for-x/rubric.md`。

覆盖内容：常规项目/RA/增长场景，结果已知却重复问、团队角色不清、材料冲突、完整经历应停止、用户疲劳、Target 预算耗尽、无证据要求、prompt injection、敏感字符串、中文 locale 和不可得数字重试。

### 指标

先过 hard gates：schema、引用存在、预算、无编造、无重复、注入/敏感数据安全、locale。再盲评 5 个 0–2 分维度：新信息、Target/产出用途、单槽具体性、证据理由、负担与中立性。hard gates 全过且总分 ≥8/10 才算 Good Question。

获取、使用、成本分开报告：

- 获取：反事实新信息率、冗余率、Good Question Rate；
- 使用：回答是否改变 fact、requirement match 或 artifact segment；
- 成本：每场题数、skip/useless 比例、回答时长、疲劳停止准确性。

### 实验协议

同一 provider/model/version、temperature、max output、structured-output mode 和输入构造下运行 baseline/A/B/C。随机性存在时每个 case 至少 3 次，记录均值、方差和失败簇。A vs B、A vs C 分别解释；不要把 B vs C 当成单变量实验。开发集选型后才打开留出集。每个生产模型家族单独验证。

## 已运行结果

### 确定性检查

运行：

```bash
python3 scripts/check_grill_prompt_contract.py
python3 scripts/score_grill_outputs.py \
  --cases evals/grill-for-x/dev.jsonl \
  --outputs evals/grill-for-x/fixtures/scorer-smoke.jsonl \
  --allow-partial
```

实际结果：

- Prompt/Schema/eval contract：PASS；冻结基线、3 个候选、12 dev、4 holdout 全部通过；
- scorer smoke fixture：1/1 PASS；
- contract checker 同时验证 Candidate B 的排序变量只存在于 B，Candidate C 恰有 3 个可解析的 JSON 示例，A/B 保持 zero-shot。

### 静态 Prompt 分析

使用 `senior-prompt-engineer/scripts/prompt_optimizer.py` 的默认近似 tokenizer；结果已保存在 `evals/grill-for-x/results/static/`。这只是结构/长度启发式，不是模型质量分数。

| Prompt | 近似 input tokens | Clarity | Structure | 示例 |
|---|---:|---:|---:|---:|
| baseline-v0 | 211 | 83 | 80 | 0 |
| Candidate A | 891 | 80 | 90 | 0 |
| Candidate B | 1009 | 83 | 90 | 0 |
| Candidate C | 1381 | 80 | 90 | 3（XML 示例；静态工具未识别该标签格式） |

静态结论仅有两个：候选把结构分数从 80 提升到 90；代价是 A/B/C 比基线分别多约 680/798/1170 个输入 token。B 比 A 多约 118；C 比 A 多约 490。是否值得只能由任务级 eval 决定。

### 真实模型对比

**尚未执行。** 检查到 `OPENAI_API_KEY`、`ANTHROPIC_API_KEY`、`GRILL_LLM_API_URL`、`GRILL_LLM_MODEL`、`GRILL_LLM_API_KEY` 均未设置。没有把预计表现写成实测分数，也没有选择“获胜 Prompt”。

## 首轮建议

1. 先用计划上线的精确模型跑 baseline + A/B/C 的 12 条 dev，各 3 次。
2. 如果 A 已达到 hard gates 100% 和 GQR ≥80%，优先选 A；它最短、行为最容易解释。
3. 只有在“多个合法缺口选错优先级”聚类明显时才考虑 B。
4. 只有在“诚实停止/避免重复/单槽约束”不稳定时才考虑 C，并为相似示例增加留出变体防过拟合。
5. 选型后打开 4 条 holdout；任何 hard-gate 回归都阻止上线。
6. 上线后把 `question_flagged_useless`、`question_skipped`、`fact_retracted`、`fact_promoted/demoted`、`artifact_exported/copied/shared` 分别沉淀为获取、使用、成本评测样本。

## 已知局限

- 16 条均为基于现有 demo 假数据与历史失败模式构造的合成样本，不能替代真实用户日志。
- 离线 replay 会高估信息增益、低估用户负担；需要小规模真人盲评校正。
- 4:2 是当前产品决策，不是经实验得到的最优比例。
- `why_refs` 正确不等于引用内容真正支持理由；生产后端仍需做引用存在性与语义支持校验。
- 中性 scaffold 降低锚定，但可能提高用户作答负担；需要与 evidence-backed provisional hypothesis 单独实验。
- 当前只设计 next-question selection；Target requirement extraction、fact extraction 和 artifact generation 需要各自的 Prompt、schema 与 eval。

## 版本记录

- `baseline-v0`：从 WEWA-10 commit `57fad7f` 冻结，无修改。
- `candidate-family-v1`：加入最新 FOR X 状态契约、4:2 budget、六维矩阵、引用、诚实缺口、疲劳/安全和 schema。
- `candidate-a-v1`：直接 gap policy。
- `candidate-b-v1`：A 的共享契约 + ranked selection。
- `candidate-c-v1`：A + 3 contrastive examples。

官方资料与跨模型/模型专属边界见 `docs/wewa-14-official-sources.md`。
