/* ============================================================
   Target（JD）—— JD 是检查表，不是模板。

   一条要求的状态完全由「你有没有证据」决定，不由匹配分决定：
     ok    已有材料证据，或依赖的事实已经挖到
     weak  只有沾边的证据（说清差在哪）
     none  还没有，但问得出来
     gap   你确实没有 —— 永远补不上，绝不为它生成文案
   最后一种是这一版最重要的东西，所以它是一个纯函数，
   不是一句 UI 文案：generateable() 在组稿时就把 gap 挡在外面。
   ============================================================ */

export const REQ_STATES = ['ok', 'weak', 'none', 'gap'];
export const REQ_MARK = { ok: '✓', weak: '◐', none: '○', gap: '✕' };
export const REQ_WORD = {
  ok: '已对上',
  weak: '只有弱证据',
  none: '还没有 · 问得出来',
  gap: '你确实没有',
};
/* 清单的排序：先给能动的，再给已经稳的，最后才是动不了的。 */
export const REQ_ORDER = ['none', 'weak', 'ok', 'gap'];

export function reqState(req, activeFacts) {
  if (req.fills?.length && req.fills.every((h) => activeFacts.has(h))) return 'ok';
  if (req.ev?.length) return 'ok';
  if (req.weak) return 'weak';
  return req.gap ? 'gap' : 'none';
}

export function reqTally(target, activeFacts) {
  const tally = { ok: 0, weak: 0, none: 0, gap: 0 };
  (target?.reqs || []).forEach((r) => {
    tally[reqState(r, activeFacts)] += 1;
  });
  return tally;
}

/** 这条要求是不是刚被这一轮补上的 —— 用来做 ○ → ✓ 的翻牌。 */
export function justFilled(req, newFactIds, activeFacts) {
  return Boolean(
    req.fills?.length &&
      newFactIds?.length &&
      req.fills.some((h) => newFactIds.includes(h)) &&
      reqState(req, activeFacts) === 'ok',
  );
}

/**
 * 一条要求能不能被写进稿子。gap 永远返回 false —— 这是产品红线，
 * 检查发生在组稿的时候，不是靠 prompt 措辞。
 */
export function generateable(req, activeFacts) {
  return reqState(req, activeFacts) === 'ok';
}

/** 简历片段上的 ↳ JD #n 标记：只挂已经对上的要求。 */
export function jdChipsFor(reqIds, target, activeFacts) {
  if (!target || !reqIds?.length) return [];
  return reqIds
    .map((id) => {
      const req = target.reqs.find((r) => r.id === id);
      if (!req || !generateable(req, activeFacts)) return null;
      return { id, index: target.reqs.indexOf(req) + 1, text: req.text };
    })
    .filter(Boolean);
}

export function groupReqsByState(target, activeFacts) {
  return REQ_ORDER.map((state) => [
    state,
    (target?.reqs || []).filter((r) => reqState(r, activeFacts) === state),
  ]).filter(([, list]) => list.length);
}
