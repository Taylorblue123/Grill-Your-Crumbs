/* ============================================================
   派生：稿子、计数、JD 状态

   原型里这些数字是去数 DOM 得来的，所以「稿子」和「计数」实际上是两份
   会各自漂移的状态。这里全部改成从 active / promoted / killed / sessionCrumbs
   推导出来的纯函数 —— 同一个集合永远只有一个答案。
   ============================================================ */
import {
  ARTIFACT, DIMS, HARVEST, TARGETS, TURNS, TURN_BY_ID, isCand,
} from '../data/demo.js';

export const crumbById = (state) => {
  const map = {};
  state.crumbs.forEach((c) => { map[c.id] = c; });
  return map;
};

export const curTarget = (state) => (state.targetId ? TARGETS.find((t) => t.id === state.targetId) : null);

/* ── 一条 JD 要求的状态，完全由「你有没有证据」决定，不是匹配分 ──
     ok    已有材料证据，或依赖的事实已经挖到
     weak  只有沾边的证据
     none  还没有，但问得出来
     gap   你确实没有 —— 永远不为它生成文案 */
export function reqState(r, active) {
  if (r.fills && r.fills.length && r.fills.every((h) => active.has(h))) return 'ok';
  if (r.ev && r.ev.length) return 'ok';
  if (r.weak) return 'weak';
  return r.gap ? 'gap' : 'none';
}

export function reqTally(target, active) {
  const n = { ok: 0, weak: 0, none: 0, gap: 0 };
  (target ? target.reqs : []).forEach((r) => { n[reqState(r, active)] += 1; });
  return n;
}

/* 这条要求是不是刚被这一轮补上的 —— 用来做 ○ → ✓ 的翻牌动画 */
export function justFilled(r, ids, active) {
  return !!(r.fills && r.fills.length && ids && ids.length
    && r.fills.some((h) => ids.includes(h)) && reqState(r, active) === 'ok');
}

export const promotedSeg = (id) => ({
  t: HARVEST[id].promote, o: 'grill', turn: HARVEST[id].turn, hs: [id],
});

/* 一个片段在当前集合下的呈现状态。force=true 是成果页口径：
   只渲染已经成立的片段，不画灰色骨架。 */
function annotate(seg, state, force) {
  if (seg.o === 'grill') {
    return { ...seg, on: force || seg.hs.every((h) => state.active.has(h)) };
  }
  if (seg.o === 'inferred') return { ...seg, on: true };
  return { ...seg, on: true, orphan: !force && !state.sessionCrumbs.has(seg.ref) };
}

/* ── 稿子 ──
   不是一份独立状态：bullet 的存在与否、金色片段亮不亮、JD chip 挂不挂，
   全部由集合算出来。 */
export function buildSheet(state, { force = false } = {}) {
  const target = curTarget(state);

  const bullets = ARTIFACT.resume_bullets.map((segs, index) => {
    if (state.killed.has(index)) return null;
    const annotated = segs.map((s) => annotate(s, state, force));
    /* 整条都靠新事实、且一条都还没挖到 → 骨架态 */
    const shown = annotated.some((s) => s.o !== 'grill' || s.on);
    const thin = annotated.every((s) => s.o === 'grill') && !annotated.some((s) => s.on);
    const bad = segs.some((s) => s.o === 'inferred' && s.verified === false);
    const reqIds = shown
      ? (ARTIFACT.bullet_req[index] || []).filter((rid) => {
        if (!target) return false;
        const r = target.reqs.find((x) => x.id === rid);
        return r ? reqState(r, state.active) === 'ok' : false;
      })
      : [];
    if (force && !annotated.some((s) => s.o !== 'grill' || s.on)) return null;
    return {
      index,
      segs: force ? annotated.filter((s) => s.o !== 'grill' || s.on) : annotated,
      thin,
      bad,
      reqIds,
    };
  }).filter(Boolean);

  const promoted = [...state.promoted]
    .filter((id) => force || state.active.has(id))
    .filter((id) => !force || state.active.has(id))
    .map((id) => ({
      id,
      seg: annotate(promotedSeg(id), state, force),
      reqIds: (ARTIFACT.promoted_req[id] || []).filter((rid) => {
        if (!target) return false;
        const r = target.reqs.find((x) => x.id === rid);
        return r ? reqState(r, state.active) === 'ok' : false;
      }),
    }));

  const intro = ARTIFACT.self_intro
    .map((s) => annotate(s, state, force))
    .filter((s) => !force || s.o !== 'grill' || s.on);

  return { bullets, promoted, intro };
}

/* ── 三色计数 ──
   分母是「成稿被切成几个可数片段」，不是完成度。
   报的是片段个数，因为没人能确定你把一件事讲完了没有，
   但谁都能数清有几句指得出出处。 */
export function counts(state) {
  const sheet = buildSheet(state, { force: false });
  const all = [
    ...sheet.bullets.flatMap((b) => b.segs),
    ...sheet.promoted.map((p) => p.seg),
    ...sheet.intro,
  ];
  const source = all.filter((s) => s.o === 'source');
  const grillSegs = all.filter((s) => s.o === 'grill');

  const srcOK = source.filter((s) => !s.orphan).length;
  const orphan = source.filter((s) => s.orphan).length;
  const totalGrill = grillSegs.length;
  const gold = grillSegs.filter((s) => s.on).length;
  /* 出处被移出本场的句子，现在也算「无出处」——出处没了，那句话就不再算有出处。 */
  const inferred = ARTIFACT.stats.n_inferred - state.killed.size + orphan;
  const total = srcOK + totalGrill + inferred;

  return {
    srcOK, orphan, totalGrill, gold, ghost: totalGrill - gold, inferred, total: total || 1,
  };
}

/* 成果页口径的金色数：只数真正成立的。 */
export function goldCount(state) {
  const base = ARTIFACT.resume_bullets.flat().concat(ARTIFACT.self_intro)
    .filter((s) => s.o === 'grill' && s.hs.every((h) => state.active.has(h))).length;
  return base + [...state.promoted].filter((id) => state.active.has(id)).length;
}

/* ── 收获账本分栏 ── */
export function ledgerGroups(state) {
  const ids = [...state.active];
  if (state.ledgerKey === 'dim') {
    return DIMS.map((k) => [k, ids.filter((id) => HARVEST[id].dim === k)]);
  }
  const seen = [];
  ids.forEach((id) => HARVEST[id].tags.forEach((t) => { if (!seen.includes(t)) seen.push(t); }));
  return seen.map((k) => [k, ids.filter((id) => HARVEST[id].tags.includes(k))]);
}

export const isCandidate = (state, id) => isCand(id) && !state.promoted.has(id);

/* ── Dashboard：本场这段经历 ── */
export function liveExperience(state) {
  const dims = {};
  [...state.active].forEach((id) => {
    const d = HARVEST[id].dim;
    dims[d] = (dims[d] || 0) + 1;
  });
  return {
    id: 'x1',
    now: true,
    title: '校园二手交易平台 · 推荐系统',
    span: '2025.03 – 2025.09',
    crumbs: state.sessionCrumbs.size,
    rounds: `${state.rounds.length} / ${TURNS.length}`,
    when: state.sessionSaved ? '刚刚' : (state.rounds.length ? '进行中' : '还没开始'),
    state: state.sessionSaved ? 'done' : (state.rounds.length ? 'live' : 'new'),
    dims,
    arts: state.sessionSaved ? ['实习简历 · EXPERIENCE', '60 秒自我介绍'] : [],
    facts: [...state.active].map((id) => ({
      ...HARVEST[id],
      id,
      dest: state.promoted.has(id) ? '简历（你加的）' : HARVEST[id].dest,
      from: `第 ${TURN_BY_ID[HARVEST[id].turn].round} 轮`,
    })),
  };
}

/* 这段经历能对上目标 JD 的哪几条：它自己的材料 + 它能问出来的事实 */
export function expCovers(state, e) {
  const target = curTarget(state);
  if (!target) return null;
  const own = new Set(e.crumbs);
  return target.reqs.filter((r) => (r.ev || []).some((c) => own.has(c))
    || (r.weak && (r.weak.refs || []).some((c) => own.has(c)))
    || (e.id === 'e1' && (r.fills || []).length)).length;
}
