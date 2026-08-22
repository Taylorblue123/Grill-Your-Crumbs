这是把前端 demo 里那套状态（账本 / 三色出处 / 候补 / 撤回 / Dashboard）落成表的方案。写成 Postgres DDL，但结构本身跟数据库无关。

核心只有一句话：**`fact` 是这个产品唯一的资产表，其他表都围着它转。** Thread 是过程，Artifact 是快照，只有 fact 会跨 thread、跨简历复用。

附件上传的首个可运行切片、API 契约和生产边界见 `backend-api.md`。下面的 `crumb`
仍然保存可供提问器读取的文本；原文件元数据与存储位置由独立的 `attachment` 表保存。

---

## 表关系

```
user
 ├── crumb                 从原文件提取、可供提问器读取的材料文本
 │    └── attachment       私有原文件的元数据、存储 key 与提取状态
 ├── thread                一场 grill（有目标、有轮次、有状态）
 │    └── turn             一轮问答（question / why_asked / guess / answer）
 │         └── fact        ★ 从这一轮回答里拆出的独立新事实
 │              └── fact_tag ──→ tag        维度标签 + 属性标签（封闭词表）
 ├── artifact              一份产出物（简历 / 自我介绍 / LinkedIn About）
 │    └── artifact_segment 成稿里的一个片段，带 origin（三色）
 │         ├──→ crumb            origin='source' 时必须指向一条
 │         └──→ segment_fact ──→ fact   origin='grill' 时必须至少指向一条
 └── event                 埋点 / 评测样本（负样本、幻觉样本、成功样本）
```

---

## DDL

```sql
create type source_kind    as enum ('resume','repo','notes','diary','social','linkedin','manual');
create type thread_state   as enum ('draft','running','done','abandoned');
create type turn_outcome   as enum ('answered','skipped','flagged_useless','pending');
create type fact_dest      as enum ('resume','intro','candidate','archived');
create type segment_origin as enum ('source','grill','inferred');
create type artifact_kind  as enum ('resume','intro','linkedin','project_page');

-- ── 原料 ──────────────────────────────────────────────
create table crumb (
  id            uuid primary key,
  user_id       uuid not null references "user"(id) on delete cascade,
  kind          source_kind not null,
  display_name  text not null,              -- 'notes-2025.md'
  content       text not null,
  content_hash  text not null,              -- 去重 + 判断是否需要重新读
  token_count   int  not null default 0,    -- 决定还塞不塞得进 context
  synced_at     timestamptz not null default now(),
  unique (user_id, content_hash)
);

-- 原文件与可供模型读取的 crumb 分开：可重跑提取、可独立清除，也不把存储地址暴露给前端
create type extraction_state as enum ('pending','ready','unsupported','failed');
create table attachment (
  id                uuid primary key,
  user_id           uuid not null references "user"(id) on delete cascade,
  crumb_id          uuid unique references crumb(id) on delete cascade,
  original_name     text not null,
  media_type        text not null,
  byte_size         bigint not null check (byte_size >= 0),
  storage_key       text not null unique,       -- 私有对象存储 key，不是公开 URL
  sha256            text not null,
  extraction_status extraction_state not null default 'pending',
  extraction_error  text,
  created_at        timestamptz not null default now(),
  unique (user_id, sha256)
);
create index on attachment (user_id, created_at desc);

-- ── 一场拷问 ───────────────────────────────────────────
create table thread (
  id            uuid primary key,
  user_id       uuid not null references "user"(id) on delete cascade,
  title         text not null,
  goal          text not null,              -- 'for X'：投简历 / LinkedIn / 面试自我介绍
  baseline_text text not null,              -- 用户原文，一个字都不改，成果页要对比
  state         thread_state not null default 'draft',
  crumb_ids     uuid[] not null default '{}',   -- 这一场装载了哪些材料（快照，材料后来改了不影响这场）
  created_at    timestamptz not null default now(),
  finished_at   timestamptz
);
create index on thread (user_id, created_at desc);

-- ── 一轮问答 ───────────────────────────────────────────
create table turn (
  id            uuid primary key,
  thread_id     uuid not null references thread(id) on delete cascade,
  round         int  not null,
  dimension     text not null references tag(name),   -- 问的是哪个维度
  question      text not null,
  why_asked     text not null,              -- 「我为什么问这个」，必填
  why_refs      uuid[] not null default '{}',-- 理由指向哪几条 crumb —— 空数组要在应用层拦掉
  grip_level    smallint not null,          -- 0 低 / 1 中 / 2 高
  grip_evidence text not null,              -- '8 条材料里 1 条提到过，0 条写了结局'
  guess         text,                       -- 猜测答案，可为空
  answer        text,
  outcome       turn_outcome not null default 'pending',
  answered_at   timestamptz,
  unique (thread_id, round)
);
```

**`why_refs` 不允许为空数组**，这是产品定义写进 schema 的一条：一个指不出材料依据的问题，不该被问出去。demo 里第 5 轮那个废问（`why_refs = {}`）就是故意留的反例——它在真实系统里应该在生成阶段被拦下，拦不住就等着被用户点「这问题没意义」。

```sql
-- ── ★ 事实库：整个产品的资产 ─────────────────────────────
create table fact (
  id            uuid primary key,
  user_id       uuid not null references "user"(id) on delete cascade,
  turn_id       uuid not null references turn(id) on delete cascade,  -- 出处：硬绑，不可为空
  dimension     text not null references tag(name),
  text          text not null,              -- 一条独立、可数、能单独撤回的事实
  destination   fact_dest not null default 'candidate',
  promoted_text text,                       -- 用户把 candidate 拖进简历时写成的那句话
  promoted_by   text,                       -- 'model' | 'user' —— 拖拽是 'user'
  promoted_at   timestamptz,
  retracted_at  timestamptz,                -- 软删除：撤回不是 delete，撤回本身是数据
  created_at    timestamptz not null default now()
);
create index on fact (user_id) where retracted_at is null;
create index on fact (user_id, dimension) where retracted_at is null;
create index on fact (user_id, destination) where retracted_at is null and destination = 'candidate';
```

四件事都在这张表里：

| 前端行为 | 落在哪 |
|---|---|
| 账本按维度分组、显示条数 | `group by dimension where retracted_at is null` |
| 「撤回这一条」 | `retracted_at = now()`（不 delete —— 用户撤回了什么，本身是评测信号） |
| **把候补拖进简历** | `destination: candidate → resume`，`promoted_by='user'`，写入 `promoted_text` |
| 事实库跨简历复用 | 按 `user_id` 查，跟 `thread_id` 无关 |

`promoted_by` 分 `model` / `user` 两种值，是为了以后能回答一个问题：**模型判定的去向，用户改了多少次？** 改得越多说明去向判断越不准，这是一个不用额外标注就能拿到的评测指标。

```sql
-- ── 标签：封闭词表 ──────────────────────────────────────
create type tag_kind as enum ('dimension','attribute');
create table tag (
  name        text primary key,             -- '量化结果' / '数字' / '取舍'
  kind        tag_kind not null,
  description text not null,                -- 喂给模型的定义，也是给用户看的 tooltip
  sort        int not null default 0,
  active      bool not null default true
);
create table fact_tag (
  fact_id uuid not null references fact(id) on delete cascade,
  tag     text not null references tag(name),
  primary key (fact_id, tag)
);
```

维度和属性放同一张表、用 `kind` 区分，是因为它们的生命周期一样（都要能加、能停用、能改定义），只是使用位置不同：维度是分组主键（一条 fact 恰好一个），属性是 N 个。

种子数据（就是 demo 里在用的那批）：

```sql
insert into tag (name, kind, description) values
 ('动机',      'dimension','为什么是你做这件事：被分配的还是主动争取的'),
 ('角色边界',  'dimension','你具体负责到哪、带没带人、和谁协作'),
 ('关键决策',  'dimension','在两条路之间选了哪条、依据是什么'),
 ('量化结果',  'dimension','可验证的数字：指标、规模、成本、时间'),
 ('真实困难',  'dimension','真的卡住过的地方和根因，不是“遇到了一些挑战”'),
 ('判断与协作','dimension','分歧怎么解决的、拿什么说服人'),
 ('数字','attribute','含具体数值，简历上最难被质疑的那种'),
 ('业务指标','attribute','不是模型指标，是业务侧的变化'),
 ('性能','attribute','延迟 / 吞吐 / 资源'),
 ('取舍','attribute','在成本和收益之间做了权衡'),
 ('成本意识','attribute','算过账才决定花不花钱'),
 ('实验','attribute','跑过对照实验或 A/B'),
 ('事故','attribute','线上出过问题'),
 ('根因','attribute','定位到了根本原因，而不只是现象'),
 ('冲突','attribute','和人有过分歧'),
 ('说服','attribute','改变了别人的决定'),
 ('沟通','attribute','怎么把事情讲清楚的'),
 ('证据','attribute','用材料/数据支撑观点'),
 ('带人','attribute','带过人或做过 review'),
 ('起因','attribute','事情是怎么开始的'),
 ('主动性','attribute','没人要求你做，你自己做了'),
 ('稳定性','attribute','可用性 / 错误率相关');
```

**为什么是封闭词表而不是让模型自由生成：** 自由生成的话「数字」「量化」「有数据」会变成三个标签，分组立刻失效，也没法按标签做筛选和统计。代价是会漏——所以留了 `event` 里的 `tag_miss` 类型：模型想打一个不在表里的标签时记一笔，攒够了人工加进词表。这是一条可运营的扩表路径，而不是一次性拍死。

```sql
-- ── 产出物 + 三色出处 ───────────────────────────────────
create table artifact (
  id          uuid primary key,
  user_id     uuid not null references "user"(id) on delete cascade,
  thread_id   uuid references thread(id) on delete set null,  -- 可以由多场 thread 攒出来
  kind        artifact_kind not null,
  title       text not null,
  version     int not null default 1,
  created_at  timestamptz not null default now()
);

create table artifact_segment (
  id          uuid primary key,
  artifact_id uuid not null references artifact(id) on delete cascade,
  block_index int  not null,                -- 第几条 bullet / 第几句
  seq         int  not null,                -- 块内顺序
  text        text not null,
  origin      segment_origin not null,
  crumb_id    uuid references crumb(id),    -- origin='source' 时必填
  note        text,                         -- origin='inferred' 时给用户看的解释
  verified    bool,                         -- 用户确认过没有
  unique (artifact_id, block_index, seq),
  constraint source_needs_crumb check (origin <> 'source' or crumb_id is not null)
);

create table segment_fact (                 -- 前端那个 hs 数组
  segment_id uuid not null references artifact_segment(id) on delete cascade,
  fact_id    uuid not null references fact(id) on delete cascade,
  primary key (segment_id, fact_id)
);
```

**这里是「模型不能自说自话」的落点。** 前端那句「金色片段硬绑 turn_id，指不出来源就自动降级成红色」，在库里是两条约束加一个视图：

```sql
-- grill 片段必须至少挂一条还没被撤回的 fact，否则它就不是 grill
create view segment_effective as
select s.*,
  case
    when s.origin = 'grill' and not exists (
      select 1 from segment_fact sf join fact f on f.id = sf.fact_id
      where sf.segment_id = s.id and f.retracted_at is null
    ) then 'inferred'::segment_origin      -- 依赖的事实被撤回了 → 自动降级
    else s.origin
  end as effective_origin
from artifact_segment s;
```

于是前端「撤回一条事实 → 简历里那句话退回骨架」不是前端特技，是这个视图的自然结果。**撤回逻辑只存在一处。**

```sql
-- ── 评测样本 ───────────────────────────────────────────
create table event (
  id         bigserial primary key,
  user_id    uuid not null,
  thread_id  uuid,
  turn_id    uuid,
  fact_id    uuid,
  segment_id uuid,
  type       text not null,   -- 见下
  payload    jsonb not null default '{}',
  at         timestamptz not null default now()
);
create index on event (type, at desc);
```

| `type` | 触发点 | 它是什么样本 |
|---|---|---|
| `question_flagged_useless` | 【这问题没意义】 | Good-Question-Rate **负样本** |
| `question_skipped` | 【跳过这题】 | 弱负样本 |
| `segment_deleted` | 【删掉这条】红色片段 | **幻觉样本** |
| `segment_confirmed` | 【我确认，属实】 | 正样本 |
| `fact_retracted` | 账本里【撤回】 | 抽取质量负样本 |
| `fact_promoted` | **候补拖进简历** | 去向判断负样本（模型判 candidate，用户不同意） |
| `fact_demoted` | 从简历移走 | 去向判断负样本（反向） |
| `artifact_exported` / `copied` / `shared` | 成果页三个按钮 | **H3 成功样本，唯一的北极星** |
| `tag_miss` | 模型想打表里没有的标签 | 扩词表的输入 |

用户不觉得自己在标注，评测集自己长出来。

---

## Dashboard 的三个查询

```sql
-- Threads
select t.*, count(f.id) filter (where f.retracted_at is null) as fact_count
from thread t left join turn tu on tu.thread_id = t.id
              left join fact f  on f.turn_id   = tu.id
where t.user_id = $1 group by t.id order by t.created_at desc;

-- 事实库（按维度分组，跨 thread）
select dimension, count(*) as n,
       array_agg(id order by created_at desc) as fact_ids
from fact where user_id = $1 and retracted_at is null
group by dimension order by n desc;

-- 候补：还没进任何一份简历的料
select * from fact
where user_id = $1 and retracted_at is null and destination = 'candidate'
order by created_at desc;
```

第三条就是 Dashboard 上那个「候补事实 · 待你决定」的数字，也是工作台里能被拖进简历的那批。

---

## 三个我拿不准、要你们定的

1. **`crumb` 存不存原文？** 现在存了（`content`）。日记和私人笔记是最敏感的一类，存原文意味着要做加密和删除策略。另一条路是只存 embedding + 摘要，但那样「悬停蓝色片段看原文」这个功能就没了——而这个功能是产品可信度的一部分。**我倾向存原文 + 列级加密 + 用户可一键清除**，但这是隐私决策不是技术决策。

2. **`fact` 要不要做跨 thread 去重？** 同一件事在两场 grill 里被问到两次，会产生两条 fact。加一个 `similar_to uuid` 自引用做软合并，还是允许重复、让用户在 Dashboard 里手动合？我倾向先允许重复——过早合并会丢掉「同一件事第二次讲得更好」这个信息。

3. **`artifact` 是快照还是活文档？** 现在设计成快照（有 `version`）。如果事实库更新了，旧简历要不要提示「有 2 条新事实可以加进来」？这决定了 Dashboard 上 artifact 卡片要不要一个「可更新」角标。

---

## 追加：Target（JD）三张表

一个 JD 就是一个 `target`，拆出来的每条要求是一个 `requirement`。**缺口 = 没有任何 match 的 requirement**，一句 SQL 就能查出来喂给出题器。

```sql
create type target_kind as enum ('internship','ra','fulltime','cofounder');
create type req_kind    as enum ('hard','preferred','implicit');
create type match_kind  as enum ('strong','weak');

create table target (
  id         uuid primary key,
  user_id    uuid not null references "user"(id) on delete cascade,
  kind       target_kind not null,
  title      text not null,
  org        text,
  raw_text   text not null,          -- JD 原文，要求要能点回这里
  source_url text,
  created_at timestamptz not null default now()
);

create table requirement (
  id         uuid primary key,
  target_id  uuid not null references target(id) on delete cascade,
  text       text not null,
  span_start int, span_end int,      -- 指回 raw_text 的字符位置 → 点得回原文
  kind       req_kind not null,
  ord        int not null,
  fillable   bool not null default true,   -- false = 「你确实没有」，问不出来
  unique (target_id, ord)
);

create table requirement_match (
  requirement_id uuid not null references requirement(id) on delete cascade,
  fact_id  uuid references fact(id)  on delete cascade,
  crumb_id uuid references crumb(id) on delete cascade,
  strength match_kind not null,
  rationale text,                    -- weak 的时候必须说清「差在哪」
  check (fact_id is not null or crumb_id is not null)
);
```

外加两个可空外键：`thread.target_id`（这一场是为谁做的）和 `artifact_segment.requirement_id`（前端那个 `↳ JD #3`）。

### 四种状态是算出来的，不是存出来的

```sql
create view requirement_state as
select r.*,
  case
    when exists (select 1 from requirement_match m join fact f on f.id = m.fact_id
                 where m.requirement_id = r.id and m.strength='strong' and f.retracted_at is null)
      or exists (select 1 from requirement_match m
                 where m.requirement_id = r.id and m.strength='strong' and m.crumb_id is not null)
      then 'ok'
    when exists (select 1 from requirement_match m where m.requirement_id = r.id and m.strength='weak')
      then 'weak'
    when r.fillable then 'none'      -- 还没有，但问得出来
    else 'gap'                        -- 你确实没有
  end as state
from requirement r;
```

**撤回一条 fact，对应要求会自己从 `ok` 退回 `none`** —— 和成稿片段降级是同一个机制，不用写第二遍。

### `fillable=false` 是一条产品红线，写进了 schema

出稿的时候必须过滤：

```sql
-- 只有 state <> 'gap' 的要求才允许有对应的成稿片段
select 1 from artifact_segment s
join requirement_state rs on rs.id = s.requirement_id
where s.artifact_id = $1 and rs.state = 'gap';   -- 这个查询必须永远返回 0 行
```

把它做成一条 CI 断言或者插入触发器。**为一条「你确实没有」的要求生成文案，是这个产品唯一不能犯的错。**

### 提问预算 4 : 2

`turn` 表加两列：

```sql
alter table turn add column source text not null default 'general';  -- 'jd' | 'general'
alter table turn add column driven_by uuid[] default '{}';           -- 这一题打的是哪几条 requirement
```

出题器按 `4:2` 分配：4 轮从 `state in ('none','weak')` 的要求里挑，2 轮从「材料里 0 条证据的通用维度」里挑。比例可配，因为**只盯着 JD 会把用户身上最独特的东西漏掉**。
