/* ============================================================
   出处（provenance）—— 稿子不是另一份状态。

   原型注释里写死的那条规则在这里变成纯函数：
     · 金色片段绑着 hs（依赖哪几条新事实）
     · 蓝色片段绑着 ref（依赖哪条材料）
   事实集合 / 本场材料集合一变，稿子自己跟着变，没有第二份真相。

   这一层不碰 DOM、不碰 React，可以直接跑单元测试。
   ============================================================ */

/** 片段的三种归属，加上两种降级态。 */
export const SEGMENT_KIND = {
  SOURCE: 'source', // 蓝：来自已有材料
  GRILL: 'grill', // 金：刚从用户嘴里挖出来的
  INFERRED: 'inferred', // 红：AI 补的，等确认
};

let segmentSerial = 0;
const nextKey = (prefix) => `${prefix}-${(segmentSerial += 1)}`;

/**
 * 把设计稿里的一个片段描述（data.js 的 segment）算成可渲染的模型。
 * @param {object} seg 原始片段
 * @param {object} ctx { activeFacts:Set, sessionCrumbs:Set, force:boolean }
 */
export function resolveSegment(seg, { activeFacts, sessionCrumbs, force = false }) {
  if (seg.o === SEGMENT_KIND.GRILL) {
    const on = force || seg.hs.every((h) => activeFacts.has(h));
    return {
      key: nextKey('g'),
      kind: SEGMENT_KIND.GRILL,
      text: seg.t,
      turnId: seg.turn,
      hs: seg.hs,
      ghost: !on,
    };
  }
  if (seg.o === SEGMENT_KIND.INFERRED) {
    return {
      key: nextKey('i'),
      kind: SEGMENT_KIND.INFERRED,
      text: seg.t,
      note: seg.note,
      unsourced: seg.verified === false,
    };
  }
  return {
    key: nextKey('s'),
    kind: SEGMENT_KIND.SOURCE,
    text: seg.t,
    ref: seg.ref,
    orphan: !force && !sessionCrumbs.has(seg.ref),
  };
}

/** 候补事实：默认不进简历，用户手动拖进去才算。 */
export const isCandidateFact = (fact) => String(fact?.dest || '').startsWith('候补');

/** 被拖进简历的候补事实，会写成 promote 那句话。 */
export function promotedSegment(factId, harvest) {
  const fact = harvest[factId];
  return { t: fact.promote, o: SEGMENT_KIND.GRILL, turn: fact.turn, hs: [factId] };
}

/**
 * 组一份活稿。
 * mode='live'  工作台：没挖到的金色片段留成灰骨架（ghost），让用户看着它长出来。
 * mode='final' 成果页：没挖到的直接不出现，空 bullet 整条丢掉。
 */
export function buildDraft({
  artifact,
  harvest,
  activeFacts,
  promotedFacts,
  killedBullets,
  sessionCrumbs,
  mode = 'live',
  force = false,
}) {
  const ctx = { activeFacts, sessionCrumbs, force };
  const final = mode === 'final';

  const bullets = [];
  artifact.resume_bullets.forEach((segs, index) => {
    if (killedBullets.has(index)) return;
    const kept = final
      ? segs.filter((s) => s.o !== SEGMENT_KIND.GRILL || s.hs.every((h) => activeFacts.has(h)))
      : segs;
    if (final && !kept.length) return;

    const segments = kept.map((s) => resolveSegment(s, ctx));
    const hasLiveContent = segments.some(
      (s) => s.kind !== SEGMENT_KIND.GRILL || !s.ghost,
    );
    bullets.push({
      key: `b${index}`,
      index,
      segments,
      // 全是还没挖到的金色 → 这条 bullet 现在是「薄」的
      thin: !final && !hasLiveContent,
      needsConfirm: segments.some((s) => s.kind === SEGMENT_KIND.INFERRED && s.unsourced),
      reqIds: artifact.bullet_req?.[index] || [],
    });
  });

  [...promotedFacts]
    .filter((id) => force || activeFacts.has(id))
    .forEach((id) => {
      bullets.push({
        key: `p${id}`,
        index: null,
        promotedFactId: id,
        segments: [resolveSegment(promotedSegment(id, harvest), ctx)],
        thin: false,
        needsConfirm: false,
        reqIds: artifact.promoted_req?.[id] || [],
      });
    });

  const introSource = final
    ? artifact.self_intro.filter(
        (s) => s.o !== SEGMENT_KIND.GRILL || s.hs.every((h) => activeFacts.has(h)),
      )
    : artifact.self_intro;
  const intro = introSource.map((s) => resolveSegment(s, ctx));

  return { bullets, intro, counts: countSegments({ bullets, intro }, artifact, killedBullets) };
}

/**
 * 三色计数。报的是「片段个数」，刻意不报完成度百分比 —— 没人能确定
 * 一件事讲完了没有，但谁都能数清有几句指得出出处。
 */
export function countSegments({ bullets, intro }, artifact, killedBullets) {
  const all = bullets.flatMap((b) => b.segments).concat(intro);
  const source = all.filter((s) => s.kind === SEGMENT_KIND.SOURCE && !s.orphan).length;
  const orphan = all.filter((s) => s.kind === SEGMENT_KIND.SOURCE && s.orphan).length;
  const grillTotal = all.filter((s) => s.kind === SEGMENT_KIND.GRILL).length;
  const gold = all.filter((s) => s.kind === SEGMENT_KIND.GRILL && !s.ghost).length;
  // 出处被移出本场的句子，从「有出处」挪到「无出处」——和后端
  // source_needs_crumb 那条约束是同一件事。
  const inferred = artifact.stats.n_inferred - killedBullets.size + orphan;
  const total = source + grillTotal + inferred;
  return {
    source,
    orphan,
    gold,
    ghost: grillTotal - gold,
    inferred,
    total: total || 1,
    rawTotal: total,
  };
}

/** 成果页标题里那个「N 处是刚挖出来的」。 */
export function goldCount({ artifact, activeFacts, promotedFacts }) {
  const base = artifact.resume_bullets
    .flat()
    .concat(artifact.self_intro)
    .filter((s) => s.o === SEGMENT_KIND.GRILL && s.hs.every((h) => activeFacts.has(h))).length;
  return base + [...promotedFacts].filter((id) => activeFacts.has(id)).length;
}
