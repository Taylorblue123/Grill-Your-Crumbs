/* ============================================================
   收获账本 —— 栏目 = 维度或标签，每条只标它来自第几轮。
   空栏保留：「这场没问到这个角度」本身就是信息，不是「完成度 0%」。
   ============================================================ */

import { isCandidateFact } from './provenance';

export const LEDGER_KEYS = { DIM: 'dim', TAG: 'tag' };

/**
 * @param {string[]} activeIds 生效中的事实 id（保持插入顺序）
 * @param {object} harvest 事实字典
 * @param {string[]} dims 六个维度
 * @param {'dim'|'tag'} key 分栏方式
 */
export function groupLedger(activeIds, harvest, dims, key) {
  if (key === LEDGER_KEYS.DIM) {
    return dims.map((dim) => [dim, activeIds.filter((id) => harvest[id].dim === dim)]);
  }
  // 按标签分栏是动态栏目：只出现有内容的栏，同一条事实可以落在几个栏里
  const seen = [];
  activeIds.forEach((id) =>
    harvest[id].tags.forEach((tag) => {
      if (!seen.includes(tag)) seen.push(tag);
    }),
  );
  return seen.map((tag) => [tag, activeIds.filter((id) => harvest[id].tags.includes(tag))]);
}

/** 一条事实在账本里显示的标签行。按标签分栏时把维度顶到最前面。 */
export function ledgerTags(fact, key) {
  return key === LEDGER_KEYS.DIM ? fact.tags : [fact.dim, ...fact.tags];
}

/** 这条事实的去向：被拖进简历之后口径要变。 */
export function factDestination(factId, harvest, promotedFacts) {
  return promotedFacts.has(factId) ? '简历（你加的）' : harvest[factId].dest;
}

/** 还没进任何一份稿子的候补事实 —— 工作区待办栏那个数字。 */
export function pendingCandidates(activeIds, harvest, promotedFacts) {
  return activeIds.filter((id) => isCandidateFact(harvest[id]) && !promotedFacts.has(id));
}

/** 按维度统计，喂给工作区经历卡上的六格矩阵。 */
export function dimensionMatrix(activeIds, harvest) {
  const matrix = {};
  activeIds.forEach((id) => {
    const dim = harvest[id].dim;
    matrix[dim] = (matrix[dim] || 0) + 1;
  });
  return matrix;
}
