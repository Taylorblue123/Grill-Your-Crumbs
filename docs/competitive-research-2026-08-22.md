# Grill Your Crumbs 竞品研究与机会判断

> 调研快照：2026-08-22（Asia/Shanghai）  
> 研究范围：中文与全球 AI 简历、职业资产、JD 定制、模拟面试及来源型 AI 工具。  
> 证据标准：产品官网、官方帮助中心、官方隐私政策、官方博客/公告、公开仓库与中国政府法规；没有把竞品自己的营销数字当成独立验证的市场事实。

## 0. 结论先行

1. **Coachly 和简小派都应进入核心竞品，而不是只当“面试工具”。** Coachly 已经把“简历拆成项目 → 项目级 STAR/短板诊断 → 5–10 个追问 → 报告跳回项目编辑器 → 修改后重新分析”做成显式闭环；简小派则把简历、JD、连续追问、报告和简历补强放进同一上下文。两者都碰到了 Grill Your Crumbs 最有价值的“追问反哺资产”部分。[Coachly 官网](https://usecoachly.net/)；[简小派官网](https://www.jianlipai.com/)；[简小派 AI 面试官](https://www.jianlipai.com/ai-interviewer)
2. **全球成熟平台正在从“写一份简历”转向“职业搜索操作系统”，且“一次一问”已经商品化。** Jobscan 在 2026-07 上线 AI Resume Coach，一次问一个聚焦问题并把回答起草成量化 bullet；Teal 把 Master Resume、岗位跟踪和会根据回答追问的 AI Interview Agent 接起来；Careerflow 在 2025 年底重构为 Base Resume → Job-Tailored Resume 单一来源；Rezi 在 2026 年 7 月正式文档化/强化了能边对话边实时改简历的 AI Resume Agent。[Jobscan 发布说明](https://www.jobscan.co/blog/ai-resume-builder/)；[Teal Interview Agent](https://help.tealhq.com/en/articles/9990318-using-ai-interview-practice-agent)；[Careerflow 两层简历更新](https://help.careerflow.ai/en/articles/11725769-transitioning-to-the-new-base-vs-job-tailored-resume-system)；[Rezi AI Resume Agent](https://www.rezi.ai/rezi-docs/ai-resume-agent)
3. **“长期职业资产 + 深访 + 真实性”本身也不是空白。** 免费开源的 `career-assets-skill` 已明确提出先读材料、深访、每 4 问整理一次、维护长期 `职业经历.md`、再派生岗位简历并回写投递/面试反馈；CareerFile 直接用 45–90 分钟结构化访谈寻找“hidden value”，交付可供通用 AI 重复使用的 CareerFile、Master Resume 与项目指令；8bit Career 则卖本地职业记录、证据型技能库和可回溯 claims。这意味着单靠“Agent 读材料后问问题并落盘”不足以形成壁垒。[公开仓库 README](https://github.com/Ivor-NCUT/career-assets-skill)；[CareerFile 官网](https://getpasttheats.com/)；[8bit Career 官方功能页](https://8bitcompany.com/career/whats-included)
4. **仍然存在一个清晰、但需要真实实现才能成立的空位：** `跨来源事实资产 × 高价值问题选择 × 逐片段可检查出处 × 撤回后下游联动`。本轮没有找到一家核心竞品同时做到：从简历以外的 repo/notes/diary/social 等材料形成经历；每个问题展示依据；回答拆成可复用事实；成稿每个事实片段绑定材料或某轮原话；撤回材料/事实后所有稿件与 JD 状态自动降级。
5. **最好的切入定位不是“更好的 AI 简历生成器”，也不是“AI 模拟面试”。** 建议定位为：**“把你已经做过、但没写清的经历，问成有证据、能复用的职业资产。”** 第一购买理由是“别替我编，而且让我在面试时能 defend 每一句”；简历是首个高价值出口，不是产品的数据中心。
6. **当前最大风险不是 UI，而是产品承诺尚未由真实引擎兑现。** 仓库明确说明目前只有附件上传/删除是真后端，六轮拷问、事实与成稿仍是脚本假数据；若不先实现真实的 `question → answer → fact → cited segment` 纵切，差异会停留在演示话术。[仓库 README](../README.md)；[前端说明](../frontend/README.md)；[后端 API 规划](backend-api.md)

### 研究限制

- 本研究只核验公开页面与无需登录的文档，没有购买套餐或完成各家封闭 Beta 的端到端实测；“未公开展示/未找到”不等于后台一定没有。
- 价格与免费额度是 2026-08-22 的页面快照，后续可能变化；页面中的用户量、效果与模型能力数字若来自竞品自身，本文会明确按“官方自述”处理。
- 产品能力和“是否合规”是两件事。本文比较的是隐私/处理地域/删除等**公开披露成熟度**，不对任何公司作法律合规认证。

### 市场信号与品类边界

这不是一个有可信独立规模口径的成熟品类。“AI 简历生成”“求职管理”“模拟面试”“职业教练”和“个人知识库”的统计口径高度重叠，因此本文不拼凑一个看似精确的 TAM。更可靠的信号来自需求侧：LinkedIn 2026 年官方研究称，全球 52% 受访者在找新机会，美国单个开放职位的申请人数较 2022 年春季翻倍；65% 求职者认为找工作更难，66% 招聘者也认为更难找到合格人才；81% 求职者已经或计划使用 AI。[LinkedIn 2026 官方研究](https://news.linkedin.com/en-us/2026/LinkedIn-Research-Talent-2026)

这组数据支持的不是“大家还缺一个写简历工具”，而是一个更尖锐的矛盾：生成与投递成本下降后，候选人材料变多，但招聘方看到的可信能力信号没有同比增加。GYC 所在的可服务市场，应定义成**把已有经历转成具体、相关、可追问验证的职业证据**，而不是所有需要模板、自动投递或通用面试题库的求职者。

这个市场的关键成功因素因此是：首次价值足够快、问题确实带来新增事实、最终主张可检查、能对目标岗位有用、用户负担可控、敏感材料可删除/导出，以及能借助职业教练/高校/社群等可信渠道获客。竞争强度很高，因为成熟求职平台有分发，通用模型有低成本能力，早期中文产品有本地化与价格优势。

## 1. 我们到底在和谁竞争

### 1.1 Grill Your Crumbs 的当前产品定义（来自仓库与附件）

产品服务于“有真实经历和散落材料，但难以把它们讲成具体、可信职业故事”的求职者；首个场景是 `grill for X → resume`。成功不是“文案更好听”，而是：最终产物出现 baseline 中没有的有价值事实，并且每个事实片段能回到材料或用户某轮回答，用户复制/导出结果。[PRODUCT.md](../PRODUCT.md)

当前设计的核心因果链是：

```text
简历 / repo / notes / diary / social / 手写经历
  → 聚成一段“经历”并显示材料厚薄与缺口
  → 可选目标 JD，拆成可验证要求而非一个黑盒匹配分
  → 6 轮问题预算：4 轮补 JD 可问缺口，2 轮挖用户独有价值
  → 每问一次展示 why_asked，并允许跳过/标记没意义
  → 回答拆成事实，挂在六个经历维度与标签下
  → 简历 / LinkedIn About / 60 秒介绍 / 项目页
  → 每个片段：材料来源 / 某轮回答 / AI 推断待确认
  → 撤回事实或材料，依赖的稿件片段与 JD 状态同步降级
```

仓库把“经历”视为长期资产，把产出物视为快照，把材料视为原料，把访谈记录视为过程；这比常见的“以简历文档为中心”多了一层可复用事实模型。[原型说明](../prototype/README.md)；[数据模型](backend-schema.md)

用户附件还定义了三条需要独立验证的价值链：新信息率（问出原材料无法重构的事实）、有效性（新事实是否改变下游产物）、负担（轮数/回答成本/疲劳），而不是合成一个“AI 质量分”。[原始讨论附件](/Users/mac/.codex/attachments/a972f287-d9a7-442b-a1f8-f9629177d924/pasted-text.txt)

### 1.2 竞品筛选标准

不是所有带“AI 简历”的网站都同样直接。本研究按下列工作流重合度排序：

- 是否读取现有简历/材料与目标 JD；
- 是否围绕用户的具体经历或项目追问，而非只生成文案/题库；
- 下一问是否根据上一答动态变化；
- 是否把回答回写成可复用内容，而非只给一次性评分；
- 是否保留 Base/Master/经历资产并派生多个岗位版本；
- 是否让用户检查事实来源、确认/撤回，并让下游联动；
- 中文市场可用性、价格与个人信息披露是否足够可信。

## 2. 核心五家：一张矩阵

| 核心竞品 | 为什么直接 | 主要输入与持久化中心 | AI 追问 | 主要输出 | 价格/GTM（官方当前页面） | 与 GYC 的关键缺口 |
|---|---|---|---|---|---|---|
| **Coachly（中国）** | 项目级深读、短板诊断、追问、编辑后重分析，最贴近“按项目追问→反哺” | PDF 简历被抽取为项目结构；保存简历、项目、面试历史 | 每项目 5–10 个针对性追问；JD 自动找匹配项目；模拟面试逐题评分 | STAR 拆解、五维诊断、追问链、面后报告 | 免费：3 项目/5 次面试；¥29/30 天；¥199/年；官网同时写明支付通道仍在接入 | 未公开展示多材料 Crumbs、事实级复用、片段级出处和撤回传播 |
| **简小派（中国）** | 同一上下文覆盖简历、JD、连续追问、面试报告和简历补强 | PDF/Word/TXT/图片/粘贴；每次对话保存；维护多份简历 | 会根据回答继续追问；问题来自简历和目标岗位 | 建议确认后写入简历；面试问题/回答/评分/改进建议 | Beta；默认 300 积分，文字 1/次、语音 5/次；有声 AI 面试 ¥150/30 分钟 | 未公开展示跨来源经历资产、逐片段证据绑定和事实撤回联动；公开隐私披露不如 Coachly 完整 |
| **Teal（全球）** | Master Resume/岗位跟踪/JD 定制/会跟进回答的 AI 面试已连成一套 | PDF/DOCX、LinkedIn URL、粘贴历史；Master Resume + Job Tracker + 岗位笔记 | AI Interviewer 会根据回答追问；可从已存 JD 发起岗位专属练习 | 多版本简历、Match/Analysis、AI bullet/summary/cover letter、录音/转写/反馈 | 免费核心；Teal+ $13/周、$29/月、$79/90 天 | 采访服务于面试表现，没有公开的“回答→事实→简历资产”自动回写，也无片段来源 |
| **Careerflow（全球）** | Base Resume → Job-Tailored Resume、岗位上下文、before/after 审核、模拟面试齐全 | PDF/DOCX、LinkedIn、AI prompt、空白模板；Base Resume 为每个岗位版本的来源 | 按简历+JD生成最多 5 个岗位问题；官方文档未说明根据上一答动态选择下一问 | 岗位版简历、技能/ATS 分数、逐建议接受/拒绝、面试录像/转写/反馈 | Basic 免费；Premium $8.99/周或 $23.99/月；含面试的 Premium Plus $44.99/月（年付折合 $24.99/月） | “单一来源”仍是 Base Resume 文档，不是证据事实；面试洞察没有公开说明回写到 Base |
| **Rezi（全球）** | 2026 年的 AI Resume Agent 已能通过对话实时修改简历并结合 JD/面试/找岗 | PDF/DOCX、LinkedIn、手工、对话；简历文档随 Agent 修改而持久化 | 对话有 follow-up，但用户主要主动提示；独立 AI Interview 更偏表达指标 | ATS 简历、Agent 实时修改、岗位定制、面试练习、求职搜索 | 免费；Pro $29/月；Lifetime $149；Enterprise $99/月/200 用户 | 对话焦点是“改文档/提分”，未公开展示系统主动寻找隐藏事实、证据出处或跨版本事实层 |

矩阵事实来源：[Coachly 官网](https://usecoachly.net/)；[Coachly 隐私政策](https://usecoachly.net/privacy)；[简小派首页](https://www.jianlipai.com/)；[简小派手册](https://jianlipai.com/manual)；[Teal 导入](https://help.tealhq.com/en/articles/9457699-import-existing-resume-or-linkedin-profile)；[Teal Job Matcher](https://help.tealhq.com/en/articles/9923251-using-job-matching-resume-curation)；[Teal Interview Agent](https://help.tealhq.com/en/articles/9990318-using-ai-interview-practice-agent)；[Teal 定价](https://www.tealhq.com/pricing)；[Careerflow Resume Builder](https://help.careerflow.ai/en/articles/11691410-getting-started-ai-resume-builder)；[Careerflow Mock Interview](https://help.careerflow.ai/en/articles/12631590-using-the-ai-mock-interview-tool)；[Careerflow Premium](https://www.careerflow.ai/premium)；[Rezi Create Resume](https://www.rezi.ai/rezi-docs/create-resume)；[Rezi Agent](https://www.rezi.ai/rezi-docs/ai-resume-agent)；[Rezi 定价](https://www.rezi.ai/rezi-docs/rezi-subscription-plans-explained)。

## 3. 核心竞品逐家拆解

### 3.1 Coachly：目前最贴脸的中国竞品

#### 可核验事实

- **定位/用户：** 官网称自己是“简历深度绑定的 AI 面试 Coach”，当前主要服务互联网技术岗、产品、数据方向，并坦白运营/设计/销售/市场还在打磨。[官网](https://usecoachly.net/)
- **工作流：** 上传 PDF → 将每个项目单独抽取 → 每项目给 STAR、数据/技术/角色/STAR/规模五维短板诊断、5–10 个追问 → 粘贴/截图 JD 后自动选择匹配项目 → 项目轮换深问与逐题评分 → 报告中的短板跳回编辑器补充 → 保存后清空旧分析并重跑，新一轮问题会反映新内容。[官网流程与 FAQ](https://usecoachly.net/)
- **持久化：** 隐私政策称会保存简历原文、结构化项目、面试对话、问题、评分与 embedding；用户可单条删除，注销后可识别信息 30 天内清除、备份最多保留 90 天；全量 JSON 导出需要发邮件。[隐私政策](https://usecoachly.net/privacy)
- **模型/合规披露：** 官方披露 DeepSeek-V3 用于文本理解/生成、Qwen-VL-Max 用于 OCR、BGE-M3 用于语义匹配，并宣称数据均在中国大陆境内；同时列出 Resend、Vercel、Railway 为处理/托管方。这里是**官方自述，不是本研究的独立审计结论**。[隐私政策](https://usecoachly.net/privacy)
- **价格/GTM：** 免费版 3 项目/5 次面试；30 天 ¥29；365 天 ¥199；一次付款不自动续费、微信/支付宝；同一页面又写明“支付通道接入中”，说明商业化仍很早期。[定价](https://usecoachly.net/)
- **近期动态：** 隐私政策最近更新于 2026-05-01，产品页 © 2026，且支付入口仍待就绪。[隐私政策](https://usecoachly.net/privacy)；[官网](https://usecoachly.net/)

#### 推断

- **威胁等级：高。** 它已经把 GYC 原本可能拿来做一句话差异化的“逐项目追问、修改后下一轮升级、国产模型与境内数据”写在首屏。
- **强项：** 中文技术求职切入很窄；30 秒先看到项目漏洞，价值到达快；¥29 的低价降低试用门槛；公开隐私政策比多数早期中文产品完整。
- **弱项/可攻位置：** 当前闭环中心仍是“简历项目 + 面试报告”，未公开显示多源材料聚类、事实去重/跨岗位复用、成稿片段点击回原材料或某轮回答、撤回一条事实后所有输出联动。GYC 必须把这四项做成实际体验，而不是只写在 schema。
- **重要提醒：** GYC 若只实现“项目级 STAR + 追问 + 报告”，会直接落入 Coachly 已占据且更便宜、更合规本地化的区间。

### 3.2 简小派：同上下文“简历—岗位—面试”闭环

#### 可核验事实

- **定位/工作流：** 官网主张“简历、岗位、面试，放在一次对话里准备”，对话会保存并可继续追问；用户可上传简历、贴 JD 找缺口、进入刷题或 30 分钟有声面试。[首页](https://www.jianlipai.com/)
- **追问机制：** 官方明确“每一次回答都会决定下一个问题”，并展示对项目的个人贡献、数据依据、决策过程继续深问，而非固定题库。[AI 面试官](https://www.jianlipai.com/ai-interviewer)
- **真实性/回写：** 所有简历改写先展示建议、确认后才写入；官方承诺不擅自增加数字、职级、证书、公司和管理规模；回答暴露的问题会提示对应简历段落如何补强。[首页](https://www.jianlipai.com/)
- **输入：** 手册列出 PDF、Word、TXT、图片和直接粘贴，JD 可粘贴；语音可用于补充项目事实、口述回答与快速修改。[手册](https://jianlipai.com/manual)
- **价格/GTM：** 产品仍标注 Beta/申请内测。默认 300 积分，文字消息 1 积分、语音 5 积分；对话失败返还；有声 AI 面试为 ¥150/30 分钟。[手册](https://jianlipai.com/manual)；[AI 面试官](https://www.jianlipai.com/ai-interviewer)

#### 推断

- **威胁等级：高，但形态不同。** 它比 Coachly 更像“对话式简历中台”，且“面试回答暴露的问题 → 对应简历补强”已直指 GYC 的下游闭环。
- **强项：** 中文、多岗位/多语言面试 persona、语音输入、确认后写入；30 分钟服务价也给出了偏高客单的“AI 教练”锚点。
- **弱项/可攻位置：** 公开材料仍以“一份简历”为上下文中心；没有发现公开的原子事实账本、来源片段、跨材料经历聚类或撤回传播。也没有在公开首页/手册中找到像 Coachly 那样具体的数据处理方、存储地域、训练用途与删除周期说明；这句话只表示**本轮公开资料未找到**，不等于其后台没有相应措施。

### 3.3 Teal：全球职业搜索 OS，适应性追问已成为平台能力

#### 可核验事实

- **输入/持久化：** Teal 可导入 PDF/DOCX、LinkedIn URL 或粘贴职业历史，也可从空白开始；岗位、JD、面试阶段与笔记保存在 Job Tracker。[导入说明](https://help.tealhq.com/en/articles/9457699-import-existing-resume-or-linkedin-profile)；[Job Tracker 面试说明](https://help.tealhq.com/en/articles/9530138-job-tracker-interviewing)
- **岗位定制：** Job Matcher 可把岗位 JD 接到简历，Auto-Select 根据相关性打开/关闭 Work Experience 与 Skills 内容；这证明它已经有 Master 内容 → 角色版本的选择层。[Auto-Select](https://help.tealhq.com/en/articles/9923251-using-job-matching-resume-curation)
- **追问：** AI Interviewer 会考虑用户当前回答，再选择 follow-up 或新问题；从 Job Tracker 发起时会使用该岗位 JD。结束后保留录音、完整转写与表现反馈。[Interview Agent](https://help.tealhq.com/en/articles/9990318-using-ai-interview-practice-agent)；[2026 面试准备指南](https://help.tealhq.com/en/articles/14435728-how-to-prepare-for-interviews-using-teal)
- **输出：** 无限简历、岗位跟踪、AI bullets/summary/cover letter、JD keyword matching、分析建议、面试练习与反馈。[Teal vs Teal+](https://help.tealhq.com/en/articles/9530153-teal-vs-teal)
- **价格/GTM：** 核心免费；Teal+ $13/周、$29/月、$79/90 天，免费用户可试 2 次面试练习/场景，付费无限。[定价](https://www.tealhq.com/pricing)；[版本对比](https://help.tealhq.com/en/articles/9530153-teal-vs-teal)
- **近期动态：** 官方 2026 年 3 月更新的流程已把 Interview Practice Hub、岗位特定面试、offer/compensation 分析纳入求职后半程，表明产品边界继续从简历扩到整条求职漏斗。[2026 指南](https://help.tealhq.com/en/articles/14435728-how-to-prepare-for-interviews-using-teal)

#### 推断

- **强项：** 免费分发、岗位捕获/跟踪、Master content 和面试练习的完整面；用户不必另建工作流。
- **弱项/机会：** Teal 采访的目标是“练会讲”，公开文档没有说明回答会被抽取成职业事实并回写 Master Resume。其 Match/Analysis 仍以分数、关键词和文档选择为主；GYC 可以用“问出你原来没有写下来的证据，而且告诉你是哪一问挖出来的”避开正面 ATS 功能战。

### 3.4 Careerflow：最清楚的 Base → 派生文档单一来源

#### 可核验事实

- **输入：** Base Resume 可由 PDF/DOCX、LinkedIn、AI prompt 或空白模板创建；Job-Tailored Resume 必须选择 Base Resume 和保存/抓取的岗位 JD。[Resume Builder 指南](https://help.careerflow.ai/en/articles/11691410-getting-started-ai-resume-builder)
- **持久化/工作流：** 2025-12-22 的重大更新把列表拆成 Base 与 Job-Tailored；每个 job card 只保留一个岗位版，优化原地更新而不再复制；浏览器扩展也必须从 Base 开始，形成文档级单一来源。[更新说明](https://help.careerflow.ai/en/articles/11725769-transitioning-to-the-new-base-vs-job-tailored-resume-system)
- **审核体验：** 一键优化先让用户选择技能，再逐建议 accept/reject/edit，并支持 before/after 并排对比；这是强控制感，但对比的是“修改前后”，不是“事实来自哪里”。[Resume Builder](https://help.careerflow.ai/en/articles/11691410-getting-started-ai-resume-builder)
- **面试：** 2025-12-03 的增强版 Mock Interview 支持上传简历+JD生成岗位问题、技术/行为/混合类型和不同 interviewer；结束后看录像、转写、评分、反馈和样例答案，结果留在账户中。公开文档没有说明上一回答会动态决定下一问题，也没有说明面试结果回写 Base。[Mock Interview](https://help.careerflow.ai/en/articles/12631590-using-the-ai-mock-interview-tool)
- **价格：** Basic 免费；Premium $8.99/周、$23.99/月、年付 $172.99；含 Mock Interview/Interview Analysis 的 Premium Plus $44.99/月、年付 $299.99。[Premium 页面](https://www.careerflow.ai/premium)
- **近期动态：** 2026-05 新帮助中心进一步固化 Base vs Job-Tailored；2026-07 又上线/宣传从一段 career background prompt 直接生成 Base Resume，产品正在同时压低冷启动与派生成本。[2026 Resume Builder](https://help.careerflow.ai/en/articles/11691410-getting-started-ai-resume-builder)；[AI prompt 创建](https://help.careerflow.ai/en/articles/11649204-how-to-create-a-resume-with-an-ai-prompt)

#### 推断

- **强项：** 对“一个职业底稿、多岗位派生”的文档级模型讲得最清楚；Before/After、逐项审批、Chrome Extension 与求职跟踪形成强闭环。
- **弱项/机会：** Base Resume 仍是压缩后的表达，不是可查证事实；用户后来口述的新信息是否适用于多个岗位版本没有显式数据层。GYC 应把自己描述为“Careerflow 的 Base Resume 再往下的一层：Base Evidence/Experience”，而不是再造一套 Resume Builder。

### 3.5 Rezi：对话式实时改文档正在变成基线

#### 可核验事实

- **输入：** PDF/DOCX、LinkedIn Chrome Extension、空白创建、手工复制，或直接启动 AI Resume Agent；可附 job title、company、JD 做 Target Resume。[Create Resume](https://www.rezi.ai/rezi-docs/create-resume)
- **Agent 工作流：** AI Resume Agent 可以围绕当前简历连续对话，分析、改 section、增强 bullet、定制岗位、准备面试、找岗；内容变化会实时反映在简历预览。[Agent 指南](https://www.rezi.ai/rezi-docs/ai-resume-agent)
- **输出：** ATS 简历、Rezi Score、keyword targeting、实时内容分析、简历/求职/面试工具、PDF/DOCX/Google Drive 导出。[订阅说明](https://www.rezi.ai/rezi-docs/rezi-subscription-plans-explained)
- **价格/GTM：** 免费有限额；Pro $29/月；Lifetime $149；Enterprise $99/月/200 用户，明显同时走 B2C 与高校/职业服务 B2B2C。[订阅说明](https://www.rezi.ai/rezi-docs/rezi-subscription-plans-explained)
- **近期动态：** AI Resume Agent 官方指南发布于 2026-07-15/16，新版订阅说明发布于 2026-08-03，说明 Rezi 正把单点 Writer 升级为统一职业 Agent。[Agent](https://www.rezi.ai/rezi-docs/ai-resume-agent)；[订阅](https://www.rezi.ai/rezi-docs/rezi-subscription-plans-explained)

#### 推断

- **强项：** 对话与文档联动、ATS 专业感、$149 lifetime、院校版；它会快速教育用户“对话里改简历”是默认体验。
- **弱项/机会：** Agent 的公开示例主要是用户主动下 prompt，系统没有公开证明会先发现材料沉默、解释 why、只问不可推断问题；也没有原子证据/出处层。GYC 的护城河不能是聊天框，而必须是 question-selection eval 与可审计数据结构。

## 4. 关键相邻替代品与威胁

### 4.1 `career-assets-skill`：机制最接近、商业上最便宜的 DIY 替代

这是一个免费公开 Agent skill，不是成熟 SaaS，但在机制上比多数简历网站更接近 GYC：先分诊求职紧急度/材料充足度；先读简历、网站、LinkedIn、项目材料；以时间线+成绩证据+成长故事深访；每 4 问整理一次；长期维护 `职业经历.md`；再派生岗位简历/面试版本；把投递和面试反馈回写主档；保真底稿与强化建议分层。[README](https://github.com/Ivor-NCUT/career-assets-skill)；[SKILL.md](https://github.com/Ivor-NCUT/career-assets-skill/blob/main/SKILL.md)

推断：它证明“长期资产、先访谈后写、真实性分层”可以被一份 prompt/skill 复制。它目前只有少量提交与很小的公开采用量（GitHub 页面显示 2 commits、3 stars；这只是 2026-08-22 页面快照），不是渠道威胁，却是**可复制性威胁**。[仓库页](https://github.com/Ivor-NCUT/career-assets-skill)

GYC 必须多出以下可执行能力：材料/回答的稳定 ID、事实级引用、撤回传播、JD 真实缺口、追问质量数据、可视 Replay、跨经历/跨岗位复用和低认知负担的 GUI。

### 4.2 Huntr：规模化求职数据与可解释改动威胁

Huntr 可导入 PDF/DOCX/LinkedIn，维护 Base 与岗位版本；AI Tailor 对 JD 的关键词、职责和资格做语义匹配，每项改动解释原因并由用户接受/编辑/忽略；版本、岗位、follow-up、CRM 保存在一套 job search 工具里。[Resume Builder](https://huntr.co/product/ai-resume-builder)；[Resume Tailor](https://huntr.co/product/resume-tailor)

它的面试目前更像“拿 JD+简历生成问题和样例答案”，不是公开文档中可证的多轮自适应访谈。[AI Interview Questions](https://help.huntr.co/en/articles/10697703-ai-interview-questions)

价格为免费基础版，Pro $40/月（季度折合 $30/月、半年折合 $26.66/月）。2026-04 官方文章称其 review 28 步、tailoring 5 步，并称流程受 170 万份申请数据影响；这些数字来自 Huntr 自己，适合判断其产品与数据叙事，不应当作独立效果验证。[定价/功能](https://huntr.co/product/ai-resume-builder)；[2026 方法说明](https://huntr.co/blog/how-to-use-ai-for-your-resume)

推断：Huntr 的威胁不是深访，而是可以用大规模漏斗数据训练“什么文案带来面试”。GYC 需要尽早把 `问题是否带来新事实 → 新事实是否进入稿件 → 是否复制/投递/拿到面试` 串成自己的 eval 数据，而不是只收集原始职业资料。

### 4.3 Kickresume：速度、模板、分发与“最低输入”基线

Kickresume 用 job title（也可加 job ad）即可生成整份初稿，支持 PDF/LinkedIn 导入、GPT-4.1 专用写作、ATS checker、Career Map、8 语翻译、个人网站。官方明确提醒 AI 写的内容仍需用户检查和个性化。[AI Writer](https://www.kickresume.com/en/ai-resume-writer/)；[帮助中心](https://www.kickresume.com/en/help-center/general/)

当前价格：免费 4 模板/无限下载；Premium $24/月、$18/月（季付）、$8/月（年付）；学生/教师可验证后获 6 个月 Premium。官网称 2025 年增加 11 项功能，但未在该页逐项列出。[定价](https://www.kickresume.com/en/pricing/)；[AI Writer](https://www.kickresume.com/en/ai-resume-writer/)

推断：它不是深访竞品，但会把用户对“几秒出稿、漂亮模板、免费导出”的预期压到极低。GYC 必须在开场 30 秒内先显示“我发现了哪几个材料缺口/为什么值得问”，否则多轮价值还没出现，用户已经回到速度型工具。

### 4.4 Google Career Dreamer + NotebookLM：反思与来源可信的通用组合

Career Dreamer 让用户回答少量经历、教育、技能和兴趣问题，生成 Career Identity Statement、可迁移技能和职业路径，再跳到 Gemini 改简历/求职信；它只在美国提供，仍自称 early-stage experiment，进度保存在浏览器而非服务器。[Career Dreamer](https://grow.google/career-dreamer/)；[2025–2026 使用说明](https://grow.google/grow-your-career/articles/career-change/)

NotebookLM 支持 Docs/Slides/Sheets、PDF/DOCX/TXT/MD/CSV/PPTX、网页、YouTube、音频和图片；回答基于用户选定来源并带引用。Google 在 2026-06 还公开建议用 NotebookLM 把过往经历整理成求职叙事。[来源说明](https://support.google.com/notebooklm/answer/16215270)；[Google 求职组合](https://blog.google/products-and-platforms/products/gemini/find-job-with-google-ai-tools/)

推断：两者组合可以免费覆盖“反思+多源引用+改稿”，但需要用户自己设计工作流，且没有职业事实模型、问题预算、JD 真实缺口或回答回写。GYC 的机会是把这种高手工作流产品化。

### 4.5 快面AI：中国面试端的强相邻替代与定位风险

快面AI 覆盖按 JD 改简历、会根据回答继续追问的文字/语音模拟面试、真实面试实时辅助、在线笔试辅助和面后报告；同一岗位下共享简历与 JD，并支持由一份底稿派生多个岗位版本。[官网](https://kuaimianai.com/)

其 GTM 强调“隐身、防屏幕共享、防切屏、实时作答”，新人有 1 次模拟面试；单场面试辅助 ¥39，套餐 ¥69/¥129/¥249；AI 简历免费。[官网价格与 FAQ](https://kuaimianai.com/)

推断：它争夺的是“拿 offer 的即时焦虑预算”，而 GYC 是“提前把真实经历讲清楚”。两者可能共享上游材料，但品牌伦理完全不同。GYC 应明确承诺“让你能自己 defend 每一句”，避免被归入面试作弊工具；同时，快面的强转化话术说明“面试前暴露漏洞”可能比“建立职业资产”更容易成为首购入口。

### 4.6 Jobscan AI Resume Coach：对“一次一问”的最直接商品化威胁

Jobscan 在 2026-07-08 发布新版 AI Resume Builder：用户可从空白、已有简历或 LinkedIn 开始，Coach 一次问一个聚焦问题，把回答起草成量化内容；用户逐条接受、编辑或跳过，再直接进入 Jobscan 的 ATS Optimizer 和求职流程。Builder 可免费创建和下载，较深的 Coach/生成能力进入试用或 Premium；官方公开价格为 $49.95/月或 $89.95/季度。[产品页](https://www.jobscan.co/ai-resume)；[发布说明](https://www.jobscan.co/blog/ai-resume-builder/)；[官方定价说明](https://www.jobscan.co/jobscan-tutorial)

推断：它证明“对话式挖成就”“一次一问”“用户审批”已经不能当 GYC 的主差异，而且其 ATS 品牌与 Build → Optimize → Apply 分发链很难正面追赶。公开资料没有展示问题依据 `why_refs`、回答拆成跨简历复用的原子事实、片段级来源或撤回传播；GYC 应只在这些可审计能力上与它对打。

### 4.7 CareerFile：直接占位“hidden value interview → 可复用职业真相包”

CareerFile 的公开承诺与 GYC 高度重合：一次 45–90 分钟、11 个 section 的 AI 访谈，每次问 1–2 个问题，对模糊回答继续追问；最后下载 `CareerFile.md`、多格式 Master Resume、AI Project Instructions 与使用指南，再上传到 Claude/ChatGPT 生成简历、求职信、简介和面试答案。首购 $20、复购 $10；官方称回答仅存在浏览器 session，关闭后不存储。[CareerFile 官网与访谈说明](https://getpasttheats.com/)

推断：它把“hidden value”“verified facts”“一个 source of truth、多种输出”都变成了清楚且便宜的商品，说明 GYC 不能只卖一份更漂亮的职业主档。其明显空位是：45–90 分钟首次负担高、持久化被外包给下载文件/通用 AI、没有公开的逐片段出处与撤回依赖图，也没有把每道问题的边际价值做成可见产品。

### 4.8 8bit Career：最接近 GYC 数据模型的本地证据型替代

8bit Career 以 $30 一次性 launch price 出售本地文件系统：完整职业记录、项目/决策/结果/证据、证据型技能清单、Source Health、岗位 fit、申请跟踪、面试准备、简历与求职信。官方明确写到每条 claim 可回到支撑它的 experience，缺失证据与不确定性保持可见，用户通过自己选择的 AI assistant 操作；数据保存在本机文件夹。[8bit Career 官方功能与价格](https://8bitcompany.com/career/whats-included)

推断：它说明“事实而非简历是资产”“可回溯 claims”“诚实 gap”也不能只作为口号。它更像一套 power-user 本地工作系统，公开页面未展示 GYC 式短回合自适应深访、问题依据、回答落账动画与撤回后的全界面传播。GYC 的机会在于把严谨的数据模型做成普通求职者可在几分钟内感到价值的消费级交互。

## 5. 差异到底在哪里：不要把功能表当定位

### 5.1 已经不再独特的能力

以下能力必须有，但不能再作为主差异：

- 上传简历/LinkedIn、贴 JD；
- 生成 ATS bullet、summary、cover letter；
- Base/Master Resume 派生多个岗位版本；
- before/after 并排、逐条接受 AI 建议；
- AI 面试、根据回答追问、转写与评分；
- “不编造”口头承诺；
- STAR 拆解、项目短板与量化结果建议；
- 一份简历、岗位跟踪和面试准备共享上下文。

上面每一项至少有一至三家核心竞品已经公开提供。[Teal](https://help.tealhq.com/en/articles/14435728-how-to-prepare-for-interviews-using-teal)；[Careerflow](https://help.careerflow.ai/en/articles/11691410-getting-started-ai-resume-builder)；[Coachly](https://usecoachly.net/)；[简小派](https://www.jianlipai.com/)；[Rezi](https://www.rezi.ai/rezi-docs/ai-resume-agent)

### 5.2 GYC 可守住的组合差异

| 差异 | 竞品常见做法 | GYC 应兑现的产品证据 |
|---|---|---|
| **经历而非简历是资产** | Master/Base Resume 是单一来源 | 多份材料聚成一段经历；一条事实可喂多个简历/介绍/项目页；产物只是快照 |
| **先发现沉默，再问** | 用户主动 prompt；或面试题库/JD 问题 | AI 先展示对材料的理解、缺口强度和 why_refs；只问已有材料无法推断的高价值问题 |
| **问题可审计** | 告诉你编辑“为什么更好” | 问题本身必须引用材料或 JD 要求；空依据问题被系统拦截，不只是 UI 文案 |
| **每个事实片段有出处** | 文档级 before/after、总分、AI assisted 标签 | 片段点击回到材料原文或第 N 轮原话；推断单独待确认；出处不能只靠颜色 |
| **撤回会传播** | 用户手动再改各岗位版本 | 撤回一条材料/事实，所有依赖片段、账本计数、JD 证据状态立即降级 |
| **JD 是检查表，不是模板** | 用关键词/职责补齐 Match Score | 明确区分有证据、弱证据、可问出、确实没有；真缺口绝不生成成就句 |
| **慢生产、快消费** | 只保留最终简历或面试报告 | Live 深访 + Replay 一分钟看完整因果链，并可分享某次“事实如何长出来” |
| **质量飞轮不是数据堆积** | 收简历、对话、应用数据 | `没意义/跳过/撤回/晋升/复制/投递反馈`直接成为 question、fact、destination、H3 样本 |

这些差异已经在仓库设计与 schema 中出现，但除附件上传外还没有真实后端兑现。[README](../README.md)；[后端 schema](backend-schema.md)；[后端 API](backend-api.md)

## 6. 机会地图与优先级

### 机会 A（P0）：做“可 defend 的简历”，不是更会写的简历

**用户工作：** “我担心 AI 把我写得很好看，但面试官一追问我就露馅；帮我只写真实发生、我讲得出来的内容。”

为什么现在有窗口：Huntr 官方自己指出通用 AI 会编数字/技能，并强调用户必须带来事实；Coachly、简小派也把不编造写成承诺，但本轮没有看到它们把**每个最终片段**硬绑到证据并允许撤回传播。[Huntr 2026 说明](https://huntr.co/blog/how-to-use-ai-for-your-resume)；[Coachly](https://usecoachly.net/)；[简小派](https://www.jianlipai.com/)

产品动作：

1. 先只实现一条 bullet 的真实纵切：`crumb/answer → fact → segment → hover 原文 → retract → segment 降级`。
2. 出口按钮写“复制带证据版本 / 复制纯文本版本”，并生成“面试 defend card”：每条 bullet 后面是事实、来源与可能追问。
3. 北极星不是“生成简历”，而是“有新增事实且无未确认片段的 artifact 被复制/导出”。

### 机会 B（P0）：把 Coachly 的“逐项目”再往前扩到“跨材料发现经历”

Coachly 从 PDF 已写进简历的项目开始；GYC 可从 repo README/commit、事故笔记、周报、日记、作品集、社媒、旧简历中聚出用户自己没写进简历的经历。NotebookLM 可以读多源但不懂职业资产，职业平台懂简历却没有多源可查事实，这正是结构性空隙。[Coachly](https://usecoachly.net/)；[NotebookLM 来源](https://support.google.com/notebooklm/answer/16215270)

产品动作：首批只支持“旧简历 + repo/README + 一份 notes”，先在技术实习/初级工程师里验证；不要同时接所有连接器。材料聚类卡必须显示“来自哪几条、厚/薄、缺什么、预计问几轮”。

### 机会 C（P1）：一次回答，多岗位/多产物复用

Teal/Careerflow/Rezi 已教育用户接受 Master/Base Resume，但底稿仍是文档。GYC 可以让用户只回答一次“为什么没上 BERT、用什么实验证明”，事实随后自动适配后端岗简历、产品型自我介绍、项目页与第二个 JD，而不重复追问。[Teal Auto-Select](https://help.tealhq.com/en/articles/9923251-using-job-matching-resume-curation)；[Careerflow Base/Job-Tailored](https://help.careerflow.ai/en/articles/11725769-transitioning-to-the-new-base-vs-job-tailored-resume-system)；[Rezi Agent](https://www.rezi.ai/rezi-docs/ai-resume-agent)

要避免的陷阱：不要直接承诺“动态简历”；先在第二个 JD 中展示“你上次已经回答过 4 个问题，这次只补 2 个差额”，用少问作为复用价值的可见证据。

### 机会 D（P1）：中国市场把隐私/数据去向做成可见产品能力

简历、日记、社媒和面试回答包含高敏感度职业与个人信息。中国《个人信息保护法》规定境内个人信息处理活动适用该法，并给出个人信息出境条件；《生成式人工智能服务管理暂行办法》要求依法处理查阅、复制、更正、补充、删除请求并提升生成准确性/可靠性；2024 年跨境数据规定对不同规模/场景进一步细化了豁免和义务。[个人信息保护法](https://www.cac.gov.cn/2021-08/20/c_1631050028355286.htm)；[生成式 AI 暂行办法](https://www.cac.gov.cn/2023-07/13/c_1690898327029107.htm)；[数据跨境规定](https://www.cac.gov.cn/2024-03/22/c_1712776612187994.htm)

这不是法律结论；正式上线前仍需专业合规审查。产品上可先做到：

- 单独列出每个处理方、字段、用途、地域、保留期、是否用于训练；
- 每条材料可不进本场/可删除，删除后引用实时失效；
- 一键导出全部材料、事实、问答与产物；一键清空；
- 日记/社媒默认不参与匹配或公开，事实原文逐条授权；
- 中国版本优先境内推理和存储，若跨境则明确告知与取得相应授权/履行适用程序。

Coachly 已把境内模型、存储、删除周期写成卖点，因此 GYC 不能只在隐私政策角落写一句“我们重视隐私”。同时 Coachly 对 Resend/Vercel/Railway 的处理地域还可以披露得更精细；GYC 可以用字段级处理方清单建立更高标准。[Coachly 隐私政策](https://usecoachly.net/privacy)

### 机会 E（P1）：面试后不是只评分，而是回写“新事实/表达风险”

简小派已经声明面试暴露的问题会映射回简历；Coachly 也会从报告跳回项目编辑器。因此“面试报告反哺简历”本身已被占位。[简小派](https://www.jianlipai.com/)；[Coachly](https://usecoachly.net/)

GYC 若进入这条线，要更严格：面试回答中出现的新数字/决定先进入待确认事实；和旧材料冲突时显示冲突；确认后才影响所有 artifact；面试中讲不清的既有 bullet 标记为“可写但不可 defend”，而不是自动润色掉。

### 机会 F（P2）：评测与数据飞轮是最可能的长期壁垒

产品护城河不是保存更多私人材料，而是积累“在什么上下文里，哪类问题真的问出了不可重构的新信息，并最终改变了哪个产物/投递结果”。建议把以下指标分开：

- `New-info rate`：回答能否从问前材料重构；
- `Fact acceptance/retraction`：抽出的事实被确认还是撤回；
- `Artifact utilization`：事实是否被采纳进 artifact；
- `Question burden`：跳过、没意义、回答长度下降、提前结束；
- `Downstream use`：复制、导出、投递、约面与面试 defend 结果。

Huntr 已经用 170 万申请的自有叙事建立“我们知道什么带来面试”的信任；GYC 需要建立更上游的“我们知道什么问题能挖出真实价值”。[Huntr 方法说明](https://huntr.co/blog/how-to-use-ai-for-your-resume)

## 7. 建议定位、首发人群与 GTM

### 7.1 定位句

推荐：

> **把你已经做过、但没写清的经历，问成有证据、能复用的职业资产。**

产品证明句：

> 每一句都能点回材料或你某一轮的原话；真没有的，我们不会替你圆。

避免把首屏写成：

- “AI 简历生成器”——进入 Kickresume/Rezi/Teal 的速度与模板战；
- “AI 模拟面试”——进入 Coachly/简小派/快面的训练与实时辅助战；
- “个人知识库”——进入 NotebookLM 的通用来源问答战；
- “动态职业画像/社交匹配”——价值链太远，且会立即放大隐私门槛。

### 7.2 建议首发人群（推断）

**中国/中文技术类实习、应届与 1–3 年经验求职者，手上至少有旧简历 + repo/项目笔记，但 bullet 只有职责、面试一追问就讲不清。**

理由：

- Coachly 已验证/押注技术、产品、数据岗位，说明项目型简历适合结构化追问；[Coachly](https://usecoachly.net/)
- repo/README/事故笔记能给 GYC 独有的多源优势；
- 校招/初级用户更常有“做过但没写清”而非完全没有材料；
- 面试 defend 是比“长期职业资产”更紧迫的购买动机。

这只是竞品研究后的市场假设，需要用真实用户访谈/付费实验验证。

### 7.3 价格与包装建议（推断，不是事实）

可用市场锚点：Coachly ¥29/30 天、¥199/年；简小派有声深访 ¥150/30 分钟；快面实时辅助 ¥39/场；全球全套 $23.99–$44.99/月，Teal/Rezi $29/月。[Coachly](https://usecoachly.net/)；[简小派](https://www.jianlipai.com/ai-interviewer)；[快面](https://kuaimianai.com/)；[Careerflow](https://www.careerflow.ai/premium)；[Teal](https://www.tealhq.com/pricing)；[Rezi](https://www.rezi.ai/rezi-docs/rezi-subscription-plans-explained)

建议初测：

- 免费：1 段经历、最多 3 问、可看三色来源但只导出 1 次；
- 求职月卡：¥39–59/30 天，5–10 段经历、多个 JD 差额追问、无限导出；
- 深度单场：¥99–149/30 分钟的“AI 深挖 + defend pack”，用来测试用户是否愿为结果而非 token 付费；
- 校园/Bootcamp：按席位提供 eval dashboard，但在真实 B2C 留存成立前不应过早做销售后台。

## 8. 产品路线上的“做/不做”

### 接下来最值得做

1. **真实后端纵切**：一份材料、一问一答、一条 fact、一个 cited segment、一次撤回；必须替换脚本假数据。
2. **中国技术求职样本集**：20–50 个真实 baseline/source/question/answer/artifact，用反事实重构标问题好坏。
3. **Coachly/简小派可用性对测**：同一份简历+JD跑三家，盲评“新事实数、能 defend 的 artifact 改变量、问题负担、错误事实”。
4. **首屏 time-to-proof**：上传后 30 秒先展示经历聚类与 3 个高价值缺口，不让用户先填长表。
5. **证据 UI 的硬约束**：不是让模型自报 ref；后端必须验证 source/grill origin，引用失效自动降级。
6. **隐私/导出/删除**：与产品纵切同一阶段做，尤其是 diary/social 默认私密与处理方地域披露。

### 暂时不做

- 通用模板/设计市场；
- 自动投递、岗位聚合与联系人 CRM；
- 实时面试作弊辅助；
- 大规模社交匹配/AI-native Blog；
- 在语料仍能进 context 时过早上复杂 RAG；
- “完整度百分比”或单一 Grill Score；
- 在真实 question engine 之前继续增加原型面板和视觉皮肤。

## 9. 最关键的竞争性验证

下一轮不应再问“用户喜欢哪个界面”，而应做同输入对照：

```text
输入：同一份旧简历 + 一个 repo README/项目笔记 + 同一份 JD
竞品：Jobscan / CareerFile 或 career-assets-skill / Coachly / 简小派 / GYC 真人或模型流程

记录：
1. 前 3 问中有几问问到源材料不可重构的新信息？
2. 新信息中有几条被用户确认且进入最终 bullet？
3. 最终 bullet 中有几条事实无法指出来源？
4. 用户需要多少次输入、多少分钟、多少字？
5. 第二个 JD 到来时，系统重复问了几条已经知道的事实？
6. 用户能否在 10 秒内证明任意一句“从哪来”？
```

**胜出标准建议：** GYC 不必在 ATS 分数、模板或全套求职管理上胜过成熟平台；它必须显著胜在“每分钟问出的确认新事实”“最终稿无来源事实比例”“第二岗位少问的重复问题数”。如果这三项不胜，产品只是更复杂的简历工具。

## 10. 最终判断

GYC 的机会不是市场上没人做“AI + 简历 + 面试”；恰恰相反，2025–2026 年的变化说明这些能力正在迅速商品化。真正的机会是把目前散落在不同产品里的三种价值合成一个严谨系统：

1. `career-assets-skill` 的长期经历资产；
2. Coachly/简小派/Teal 的基于项目、JD 与回答的追问；
3. NotebookLM 的来源可检查性；
4. 8bit Career 的本地证据记录与 claim trace；

再加上竞品尚未公开做透的**事实级撤回传播与跨产物复用**。

但这个组合只有在真实后端、eval 和隐私边界落地后才是产品差异；在那之前，它仍然是一套比竞品更完整的设计稿。
