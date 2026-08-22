/* ============================================================
   Grill Your Crumbs — 最终 demo 的假数据
   在原 data.js 基础上补了三件东西（都是评审要求的）：
   1) turn.grip      把「我对这块的把握」从裸百分比换成可数的证据
   2) HARVEST        新事实拆成带 id / 维度 / 标签的独立条目，可数可撤回
   3) segment.hs     稿子里每个金色片段硬绑到它依赖的那几条新事实
   ============================================================ */

export const BASELINE =
  '大三的时候在一个实验室做了个推荐系统的项目，主要负责后端和一部分模型。做了大概半年，最后上线了，效果还可以。中间遇到了一些困难，也学到了很多东西。';

export const CRUMBS = [
  { id:'c1', type:'resume',   name:'Chen-Resume-2026.pdf', text:'XX大学 计算机科学与技术 2022–2026 · GPA 3.8/4.0' },
  { id:'c2', type:'resume',   name:'Chen-Resume-2026.pdf', text:'校园二手交易平台 · 推荐系统 · 后端开发 · 2025.03–2025.09' },
  { id:'c3', type:'repo',     name:'github.com/chen/campus-rec', text:'Python · FastAPI · Faiss · Redis · LightGBM ｜ 128 commits，主力提交者' },
  { id:'c4', type:'repo',     name:'campus-rec / README.md', text:'双塔召回 + LightGBM 精排；日均请求 12w' },
  { id:'c5', type:'notes',    name:'notes-2025.md', text:'2025-05-18 线上 P99 又炸了。Faiss 全量加载太慢，冷启动要 40s，内存也顶不住。' },
  { id:'c6', type:'diary',    name:'diary/2025-06.md', text:'2025-06-02 跟师兄吵了一架。他坚持要上 BERT，可我们根本没有那么多标注数据。' },
  { id:'c7', type:'social',   name:'X · @chen_dev', text:'终于把 CTR 从 1.8% 拉到 3.1% 了，今晚能睡个好觉。' },
  { id:'c8', type:'linkedin', name:'LinkedIn · Experience', text:'Backend Engineer Intern · 2025.07–2025.09' },
  /* ↓ 材料库里还有这些，默认不在本场——可以从右边拖进来 */
  { id:'c9',  type:'repo',   name:'github.com/chen/pay-gateway', text:'Go · Redis · 令牌桶限流中间件；2024 暑期实习产出', off:true },
  { id:'c10', type:'notes',  name:'notes-2024.md', text:'2024-08-03 压测环境和线上流量分布不一样，前两次调参全白干了。', off:true },
  { id:'c11', type:'social', name:'X · @chen_dev', text:'读完《Designing Data-Intensive Applications》第 7 章，终于懂隔离级别了。', off:true },
  { id:'c12', type:'diary',  name:'diary/2025-09.md', text:'2025-09-20 项目交接给学弟了，有点舍不得。', off:true }
];

export const SOURCE_LABEL = { resume:'简历', repo:'代码仓库', notes:'笔记', diary:'日记', social:'社交动态', linkedin:'LinkedIn', manual:'其他材料' };
export const SOURCE_ICON  = { resume:'📄', repo:'⌥', notes:'📝', diary:'🔒', social:'💬', linkedin:'in', manual:'＋' };

/* ── 投喂方式 B：不写字，从已有材料里挑一段经历 ──
   AI 先把 crumbs 聚成几段「可讲的经历」，每段都说清它是从哪几条材料聚出来的、
   以及为什么值得挖。用户挑一个就能开始——一个字都不用写。 */
export const EXPERIENCES = [
  { id:'e1', title:'校园二手交易平台 · 推荐系统', span:'2025.03 – 2025.09',
    crumbs:['c2','c3','c4','c5','c6','c7'],
    why:'材料最密的一段，但<b>缺口也最大</b>：6 条材料里有代码、有事故、有吵架记录，却<b>没有一条写了结局</b>。',
    est:'预计能问出 5–6 轮', heat:'厚', recommend:true },
  { id:'e2', title:'支付网关限流中间件（暑期实习）', span:'2024.06 – 2024.08',
    crumbs:['c8','c9','c10'],
    why:'有 repo 有踩坑笔记，但<b>只有 3 条材料</b>，而且简历上只留下一个头衔。适合快挖 3 轮补细节。',
    est:'预计能问出 3–4 轮', heat:'中' },
  { id:'e3', title:'把项目交接给学弟这件事', span:'2025.09',
    crumbs:['c12','c8'],
    why:'只有一条日记。<b>材料太薄，问出来的东西会主要靠你自己讲</b>——如果你想聊“带人/交接”，这段才值得。',
    est:'预计能问出 2 轮', heat:'薄' }
];

/* 六个维度：只用来分组，不用来算完成度 */
export const DIMS = ['动机','角色边界','关键决策','量化结果','真实困难','判断与协作'];

/* ── 新事实账本：每一条都是独立、可数、可撤回的条目 ──
   dest='候补' 的条目不会自动进简历，但可以被用户手动拖进去（promote 是拖进去之后写成的那句话）。
   这个字段就是后端 fact 表里的 `destination` + `promoted_text`。 */
export const HARVEST = {
  h1:{ dim:'量化结果',  turn:'t1', text:'人均停留时长 +40%',                                   tags:['数字','业务指标'],  dest:'简历 ＋ 自我介绍' },
  h2:{ dim:'量化结果',  turn:'t1', text:'日均 GMV 增量约 ¥12,000',                             tags:['数字','业务指标'],  dest:'简历 ＋ 自我介绍' },
  h3:{ dim:'量化结果',  turn:'t2', text:'P99 800ms → 120ms（6.7×），冷启动 40s → 3s',          tags:['数字','性能'],      dest:'简历' },
  h4:{ dim:'关键决策',  turn:'t2', text:'选分片 + mmap 懒加载而非扩容，依据是实测峰值 QPS 仅 300', tags:['取舍','成本意识'],  dest:'简历' },
  h5:{ dim:'真实困难',  turn:'t2', text:'Faiss 全量索引常驻内存导致冷启动 40s',                 tags:['事故','根因'],      dest:'候补',
       promote:'Root-caused a production P99 regression to a fully memory-resident Faiss index producing a 40s cold start.' },
  h6:{ dim:'关键决策',  turn:'t3', text:'用 2,000 条标注跑对照实验：BERT 只 +0.3pt AUC，推理成本 6×', tags:['实验','数字'],  dest:'简历 ＋ 自我介绍' },
  h7:{ dim:'判断与协作',turn:'t3', text:'用数据而不是资历解决分歧，预算改投特征工程',            tags:['冲突','说服'],      dest:'简历' },
  h10:{dim:'判断与协作',turn:'t3', text:'把对照实验结果做成一张表，当面拍给对方看',              tags:['沟通','证据'],      dest:'候补',
       promote:'Resolved a senior-vs-junior technical disagreement by presenting a side-by-side benchmark table instead of escalating.' },
  h8:{ dim:'角色边界',  turn:'t4', text:'后 3 个月带 2 名初级开发，负责任务拆解与 code review（100+ PR）', tags:['带人','数字'], dest:'简历' },
  h9:{ dim:'动机',      turn:'t6', text:'自己挂闲置两周无人问津 → 翻点击日志发现 70% 流量集中在首页前 20 个商品 → 主动写提案', tags:['起因','主动性'], dest:'简历 ＋ 自我介绍' }
};
export const isCand = id => (HARVEST[id].dest || '').startsWith('候补');

/* ── grill 回合 ──
   grip：把握度不再是一个凭空的百分比，而是「材料里有几条提到过」——可数、可点。 */
export const TURNS = [
  { id:'t1', round:1, dim:'量化结果', status:'answered',
    src:'jd', jdReq:['r7'], jdLine:'JD 第 7 条要「能用业务指标衡量自己的工作」。你的材料里有模型指标，<b>0 条</b>有业务指标。',
    grip:{ lv:'低', ev:'8 条材料里 <b>1 条</b>提到过效果（X 动态给了 CTR），<b>0 条</b>提到业务侧发生了什么', refs:['c7'] },
    question:'你说“效果还可以”——具体是哪个指标、从多少变到多少？除了模型指标，业务侧发生了什么？',
    why:'你的 X 动态里已经写了 CTR 1.8%→3.1%，所以这一段我不问。我不确定的是：这个提升换算成业务是什么。八份材料里没有一份提到过。',
    guess:'CTR 提升了约 1.3 个百分点；业务侧可能有停留时长或 GMV 的变化？',
    answer:'CTR 从 1.8% 到 3.1%。另外人均停留时长 +40%，上线后日均 GMV 多了大概 1.2 万。',
    harvest:['h1','h2'] },

  { id:'t2', round:2, dim:'关键决策', status:'answered',
    src:'jd', jdReq:['r2','r3','r4'], jdLine:'JD 有 3 条压在这上面（高并发 / 性能优化 / 独立排查）。你的笔记只写了现象，<b>结局和取舍一条都没有</b>。',
    grip:{ lv:'低', ev:'<b>1 条</b>笔记记了这次事故，但<b>0 条</b>写了结局，也<b>0 条</b>写了为什么这么选', refs:['c5'] },
    question:'notes-2025.md 里 5 月 18 号那次 P99 炸了、冷启动 40s——最后是怎么收场的？这个方案是谁提的？',
    why:'你的笔记只记录了问题，没有结局。而“为什么选了这个方案、而不是加机器”这件事，只有你自己知道。',
    guess:'改成了增量索引或者分片加载？',
    answer:'我把全量 Faiss 换成分片 + mmap 懒加载，P99 从 800ms 降到 120ms，冷启动 40s → 3s。方案是我提的——我算过我们 QPS 峰值只有 300，没必要全内存，加机器是浪费预算。',
    harvest:['h3','h4','h5'] },

  { id:'t3', round:3, dim:'判断与协作', status:'answered',
    src:'jd', jdReq:['r6','r9','r11'], jdLine:'JD 第 9 条要「跨团队沟通与说服」、第 11 条要「资源受限时的成本权衡」。这两条在材料里<b>各 0 条证据</b>。',
    grip:{ lv:'低', ev:'<b>1 条</b>日记提到你们吵过一架，<b>0 条</b>写了最后谁的方案落地、你拿什么说服的', refs:['c6'] },
    question:'日记里你和师兄为“要不要上 BERT”吵过一架。最后谁的方案落地了？你拿什么说服（或被说服）的？',
    why:'这是唯一一条被你自己标成“吵架”的记录。争执点通常是你判断力最集中的地方，也是面试官最爱追问的地方。',
    guess:'你赢了，理由是标注数据不够？',
    answer:'算各退一步。我拿 2000 条人工标注跑了个对照实验：BERT 比 LightGBM 只高 0.3 个点 AUC，但推理成本是 6 倍。我把这张表拍给他看，他就同意先不上了，我们把预算挪去做特征工程。',
    harvest:['h6','h7','h10'] },

  { id:'t4', round:4, dim:'角色边界', status:'answered',
    src:'jd', jdReq:['r8'], jdLine:'JD 第 8 条要「带人 / code review 经验」。12 条材料里 <b>0 条</b>提到带人——但你日记里出现过「交接给学弟」。',
    grip:{ lv:'中', ev:'<b>2 条</b>材料写了你的头衔（“后端开发”/“Intern”），<b>0 条</b>说清你带没带人', refs:['c2','c8'] },
    question:'“做了大概半年”——这半年里你一直是一个人干，还是后期带过人？',
    why:'“负责后端和一部分模型”这句话把你的角色说小了。带人 / 不带人是简历上完全不同的两个层级，而所有材料对此都沉默。',
    guess:'大部分时间独立开发，后期可能带过一两个学弟？',
    answer:'后三个月带了两个大二的学弟，我负责拆任务和 code review，前后 review 了 100 多个 PR。',
    harvest:['h8'] },

  { id:'t5', round:5, dim:'动机', status:'flagged_useless',
    src:'general', jdReq:[], jdLine:'',
    grip:{ lv:'中', ev:'（这一轮我没找准方向：<b>0 条</b>具体依据，问了一个泛问题。）', refs:[] },
    question:'你能再多讲讲这个项目吗？',
    why:'', guess:'', answer:'', harvest:[] },

  { id:'t6', round:6, dim:'动机', status:'answered',
    src:'general', jdReq:['r10'], jdLine:'这一题不是 JD 逼出来的 —— 预算里留了 2 轮打「只有你有」的东西。动机 JD 不会写，但它决定这段听起来是“完成任务”还是“主动解决问题”。',
    grip:{ lv:'低', ev:'<b>0 条</b>材料提到这个项目是怎么开始的——动机只存在你脑子里', refs:[] },
    question:'当初为什么是你去做这个推荐系统？是被分配的，还是你主动争取的？',
    why:'上一题被你标成没意义——你说得对，那是个空问。换个只有你能回答的：动机决定了这段经历讲出来是“完成任务”还是“主动解决问题”。',
    guess:'实验室分配的任务？',
    answer:'其实是我主动提的。平台当时只有按时间排序，我自己挂东西两周没人问，就去翻了后台点击日志，发现七成流量都堆在首页前 20 个商品上，然后写了个提案给老师。',
    harvest:['h9'] }
];

/* ── 成稿。金色片段用 hs 硬绑到它依赖的新事实条目 ── */
export const ARTIFACT = {
  /* bullet_req[i] = 第 i 条 bullet 回答了 JD 的哪几条要求 */
  bullet_req: [['r5','r7'], ['r2','r3','r4'], ['r6','r11','r9'], ['r8'], ['r10'], []],
  promoted_req: { h5:['r4'], h10:['r9'] },
  resume_bullets: [
    [
      { t:'Built and shipped a two-tower retrieval + LightGBM ranking recommender for a campus C2C marketplace serving 120k requests/day,', o:'source', ref:'c4' },
      { t:'lifting CTR from 1.8% to 3.1%', o:'source', ref:'c7' },
      { t:'while driving +40% average session time and ~¥12k incremental daily GMV.', o:'grill', turn:'t1', hs:['h1','h2'] }
    ],
    [
      { t:'Traced a production P99 regression to the Faiss index being loaded fully into memory (40s cold start),', o:'source', ref:'c5' },
      { t:'benchmarked peak QPS at ~300 and shipped a sharded + mmap lazy-loading design instead of scaling hardware, cutting P99 from 800ms to 120ms (6.7×) and cold start to 3s.', o:'grill', turn:'t2', hs:['h3','h4'] }
    ],
    [
      { t:'Faced a team push to adopt BERT despite limited labeled data;', o:'source', ref:'c6' },
      { t:'ran a controlled experiment on 2,000 hand-labeled samples showing BERT gained only +0.3pt AUC at 6× inference cost,', o:'grill', turn:'t3', hs:['h6'] },
      { t:'and redirected the remaining budget to feature engineering.', o:'grill', turn:'t3', hs:['h7'] }
    ],
    [
      { t:'Mentored 2 junior engineers over the final 3 months, owning task breakdown and reviewing 100+ pull requests.', o:'grill', turn:'t4', hs:['h8'] }
    ],
    [
      { t:'Originated the project: after noticing 70% of traffic concentrated on the top 20 homepage listings, wrote and pitched the proposal that became this system.', o:'grill', turn:'t6', hs:['h9'] }
    ],
    [
      { t:'Collaborated cross-functionally with product and design stakeholders to align on roadmap priorities.', o:'inferred', verified:false,
        note:'这句在你的八份材料和六轮对话里都找不到出处——是我自己补的套话。请确认或删掉。' }
    ]
  ],
  self_intro: [
    { t:'我是 Chen，计算机专业，做后端，也做一点推荐。', o:'source', ref:'c1' },
    { t:'我最近的一段经历是把学校二手交易平台从“按时间排序”做成了一套真正的推荐系统——', o:'source', ref:'c2' },
    { t:'起因很土：我自己挂了两周东西没人问，去翻点击日志才发现七成流量都堆在首页前 20 个商品上，于是写了提案。', o:'grill', turn:'t6', hs:['h9'] },
    { t:'上线后 CTR 从 1.8% 到 3.1%，', o:'source', ref:'c7' },
    { t:'日均 GMV 多了一万二。', o:'grill', turn:'t1', hs:['h2'] },
    { t:'过程中我最满意的其实不是模型，是一次成本判断：团队想上 BERT，我用 2000 条标注跑对照实验，证明它只多 0.3 个点却要 6 倍推理成本，把预算省下来做了特征工程。', o:'grill', turn:'t3', hs:['h6','h7'] },
    { t:'我擅长在资源有限的时候，先量一量再决定要不要花钱。', o:'inferred', verified:true,
      note:'这句是我从你三次回答里归纳的一句总结，原话里没有——你可以改成自己的说法。' }
  ],
  /* 7 蓝 + 9 金 + 2 红 = 18 个片段。标题里的「9 处」必须和这里对得上，现场一数不能穿帮 */
  stats:{ n_source:7, n_grill:9, n_inferred:2 }
};

/* 产出物类型（格式）—— 和「为谁做」是正交的两件事 */
export const GOALS = ['简历 bullet','LinkedIn About','60 秒自我介绍','个人网站项目页'];

/* ── Target：一个 JD / 一个机会 ──
   requirement 的四种状态由 reqState() 算出来：
     strong  已有证据（ev 里的 crumb），或 fills 里的事实已经挖到了
     weak    只有沾边的证据（weak.text 说清差在哪）
     none    还没有，但问得出来（fills 指明问出哪几条就能补上）
     gap     你确实没有 —— 永远补不上，绝不为它生成文案
   最后那一种是这一版最重要的东西：JD 是检查表，不是模板。 */
export const TARGETS = [
  { id:'tg1', kind:'实习', title:'后端开发实习生', org:'某大厂 · 基础架构', when:'3 天前收藏', primary:true,
    raw:'岗位职责：参与后端服务的设计与开发，负责推荐/搜索链路的性能优化与稳定性建设。\n任职要求：见下。',
    reqs:[
      { id:'r1',  kind:'hard', text:'熟悉 Python / Go，有后端服务开发经验', ev:['c3','c2'] },
      { id:'r2',  kind:'hard', text:'有高并发系统的实践经验',
        weak:{ text:'README 写了「日均 12w 请求」，但没有峰值 QPS、没有延迟数字', refs:['c4'] }, fills:['h3'] },
      { id:'r3',  kind:'hard', text:'熟悉常见性能优化手段（缓存 / 索引 / 懒加载）', fills:['h4'] },
      { id:'r4',  kind:'hard', text:'具备独立排查线上问题的能力',
        weak:{ text:'笔记里记了一次 P99 事故，但只有现象、没有根因和结局', refs:['c5'] }, fills:['h5'] },
      { id:'r5',  kind:'pref', text:'有推荐 / 搜索方向的项目经验', ev:['c4','c2'] },
      { id:'r6',  kind:'pref', text:'有机器学习模型落地经验',
        weak:{ text:'repo 里出现过 LightGBM，但看不出你怎么选型、效果如何', refs:['c3'] }, fills:['h6'] },
      { id:'r7',  kind:'pref', text:'能用业务指标衡量自己的工作', fills:['h1','h2'] },
      { id:'r8',  kind:'pref', text:'有带人 / code review 经验', fills:['h8'] },
      { id:'r9',  kind:'pref', text:'良好的跨团队沟通与说服能力', fills:['h7','h10'] },
      { id:'r10', kind:'implicit', text:'主动发现问题并推动解决', fills:['h9'] },
      { id:'r11', kind:'implicit', text:'资源受限时能做成本权衡', fills:['h4','h6'] },
      { id:'r12', kind:'hard', text:'2026 届本科及以上，计算机相关专业', ev:['c1'] },
      { id:'r13', kind:'hard', text:'熟悉 Kubernetes / 容器化部署', gap:true },
      { id:'r14', kind:'pref', text:'有消息队列（Kafka / Pulsar）使用经验', gap:true }
    ]},
  { id:'tg2', kind:'RA', title:'推荐系统方向 Research Assistant', org:'XX 实验室', when:'上周收藏',
    raw:'招募方向：推荐系统的召回与排序；需要能独立做实验设计。',
    reqs:[
      { id:'q1', kind:'hard', text:'有推荐 / 信息检索方向的项目经验', ev:['c4','c2'] },
      { id:'q2', kind:'hard', text:'熟悉召回 + 排序的经典架构', ev:['c4'] },
      { id:'q3', kind:'hard', text:'能独立完成实验设计与对照分析', fills:['h6'] },
      { id:'q4', kind:'pref', text:'有处理真实业务数据的经验',
        weak:{ text:'README 有请求量，但没有真实业务侧的结果', refs:['c4'] }, fills:['h1','h2'] },
      { id:'q5', kind:'pref', text:'能读英文论文并复现', gap:true },
      { id:'q6', kind:'pref', text:'有稳定产出（论文 / 开源 / 技术博客）', gap:true },
      { id:'q7', kind:'implicit', text:'能长期投入（≥ 6 个月）',
        weak:{ text:'简历显示这个项目做了 7 个月，但没写你后来还在不在', refs:['c2'] } },
      { id:'q8', kind:'implicit', text:'自驱，能自己找问题', fills:['h9'] }
    ]},
  { id:'tg3', kind:'合伙人', title:'技术合伙人 / 早期团队', org:'—', entryOnly:true,
    raw:'', reqs:[] }
];
export const REQ_KIND = { hard:'硬性', pref:'优先', implicit:'隐含' };

/* 同频的人 —— placeholder。匹配只发生在标签层，不碰 crumbs 原文。 */
export const PEERS = [
  { id:'p1', handle:'@lin_infra', line:'后端 / 存储 · 在做一个校内拼车的匹配服务',
    overlap:['成本意识','根因','事故'],
    theirs:'为了省钱没上 K8s，自己写了个 systemd + 健康检查的土方案，跑了半年没挂。',
    mineHint:'你的「选分片 + mmap 懒加载而非扩容」和这条是同一种判断' },
  { id:'p2', handle:'@zoe_ml', line:'ML · 正在写一篇关于小样本排序的本科毕设',
    overlap:['实验','数字','取舍'],
    theirs:'拿 1500 条标注跑了对照，发现复杂模型在小数据上根本打不过 GBDT。',
    mineHint:'你第 3 轮那条「BERT +0.3pt / 6× 成本」几乎是同一个结论' },
  { id:'p3', handle:'@harper_pm', line:'产品 · 在找会做推荐的技术伙伴',
    overlap:['起因','主动性','业务指标'],
    theirs:'我做的第一个功能也是因为自己是用户、自己被恶心到了才做的。',
    mineHint:'你第 6 轮讲的「自己挂闲置两周没人问」是同一类起点' }
];

/* 可见性三层 —— placeholder，默认最严 */
export const VISIBILITY = [
  { key:'private',   name:'材料原文', desc:'日记、笔记、私有 repo 的原文', state:'永不参与匹配', locked:true },
  { key:'matchable', name:'标签签名', desc:'只有 #成本意识 这类标签，不含事实原文', state:'参与匹配', on:true },
  { key:'public',    name:'事实原文', desc:'某一条事实的具体内容', state:'逐条手动放行 · 现在 0 条', on:false }
];

/* ── Dashboard 的历史数据 ──
   以「经历」为单位组织：一段经历下面挂着它的事实、轮次、产出物。
   thread（第几场拷问）退成经历的一个属性，不再是顶层分类。 */
export const PAST_EXP = [
  { id:'x2', title:'开源项目 campus-rec 的 README 重写', span:'2025.10',
    crumbs:2, rounds:'4 / 4', when:'3 天前', state:'done',
    dims:{ '动机':2, '角色边界':1, '判断与协作':3, '量化结果':2 },
    arts:['个人网站项目页 v2','LinkedIn About'],
    facts:[
      { dim:'动机',     text:'重写 README 是因为有人提 issue 说看不懂怎么跑', tags:['起因'],        dest:'项目页', from:'第 1 轮' },
      { dim:'判断与协作',text:'把 quickstart 压到 3 条命令，剩下的挪进 FAQ',   tags:['沟通','取舍'], dest:'项目页', from:'第 3 轮' },
      { dim:'量化结果', text:'重写后两周内 star +40，issue 里“跑不起来”归零',  tags:['数字'],        dest:'项目页', from:'第 4 轮' }
    ]},
  { id:'x3', title:'支付网关限流中间件（暑期实习）', span:'2024.06 – 2024.08',
    crumbs:3, rounds:'2 / 6', when:'上周', state:'thin',
    dims:{ '关键决策':1, '真实困难':1, '量化结果':1 },
    arts:[],
    facts:[
      { dim:'量化结果', text:'限流上线后网关 5xx 从 0.9% 降到 0.05%',       tags:['数字','稳定性'], dest:'简历', from:'第 1 轮' },
      { dim:'关键决策', text:'选令牌桶而非漏桶：突发流量是那个业务的常态',   tags:['取舍'],          dest:'简历', from:'第 2 轮' },
      { dim:'真实困难', text:'压测环境和线上流量分布不一致，前两次调参全废', tags:['事故','根因'],   dest:'候补', from:'第 2 轮' }
    ]}
];
export const PAST_ARTIFACTS = [
  { id:'a_02', title:'个人网站 · campus-rec 项目页', kind:'项目页', exps:['开源项目 campus-rec 的 README 重写'], when:'3 天前', prov:[9,7,1] },
  { id:'a_03', title:'LinkedIn About（英文）',       kind:'LinkedIn', exps:['开源项目 campus-rec 的 README 重写'], when:'3 天前', prov:[5,4,2] },
  { id:'a_04', title:'面试自我介绍 · 60 秒（草稿）', kind:'自我介绍', exps:['支付网关限流中间件（暑期实习）'],     when:'上周',  prov:[4,2,3] }
];

/* 演示材料的静态索引。运行时上传的材料不进这里——它们活在 store 的 crumbs 里，
   用 selectors.crumbById(state) 查。TURNS 是纯静态脚本，可以直接索引。 */
export const DEMO_CRUMB_BY_ID = Object.fromEntries(CRUMBS.map(c=>[c.id,c]));
export const TURN_BY_ID  = Object.fromEntries(TURNS.map(t=>[t.id,t]));

/* 后端 VALID_KINDS 和前端图标表不完全重合，兜底到一个一定有图标的类型。 */
export function normalizeKind(kind){
  return SOURCE_ICON[kind] ? kind : 'manual';
}
