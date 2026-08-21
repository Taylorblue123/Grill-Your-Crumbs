/* 撤回是补偿操作，不是客户端状态回卷 —— 这几条断言就是在守这句话。 */
import { describe, expect, it } from 'vitest';
import { initialState, sessionReducer, turnBudget } from './sessionReducer';

const session = {
  dims: ['量化结果', '关键决策'],
  turns: [
    { id: 't1', round: 1, dim: '量化结果', status: 'answered', harvest: ['h1', 'h2'], answer: 'A1' },
    { id: 't2', round: 2, dim: '关键决策', status: 'answered', harvest: ['h3'], answer: 'A2' },
    { id: 't3', round: 3, dim: '关键决策', status: 'flagged_useless', harvest: [], answer: '' },
  ],
  harvest: {},
  artifact: { stats: {} },
  oldResume: [],
  plan: [{ id: 'p1', rounds: 3, max: 3, on: true }],
  bases: [],
  goals: ['简历 bullet'],
};

const loaded = sessionReducer(initialState, {
  type: 'LOADED',
  payload: { session, targets: [], reqKind: {}, sessionCrumbIds: ['c1', 'c2'] },
});

const answer = (state, text = '我的回答') => {
  let next = sessionReducer(state, { type: 'ANSWER_START', text });
  next = sessionReducer(next, { type: 'ANSWER_HARVEST' });
  return sessionReducer(next, { type: 'ANSWER_DONE' });
};

describe('轮次与事实', () => {
  it('答一题：事实生效、轮次入账、游标前进', () => {
    const next = answer(loaded);
    expect(next.activeIds).toEqual(['h1', 'h2']);
    expect(next.rounds).toHaveLength(1);
    expect(next.cursor).toBe(1);
    expect(next.pending).toBeNull();
  });

  it('撤回一轮：事实退回去，游标回到那一轮', () => {
    const next = sessionReducer(answer(loaded), { type: 'UNDO' });
    expect(next.activeIds).toEqual([]);
    expect(next.rounds).toEqual([]);
    expect(next.cursor).toBe(0);
  });

  it('撤回某一轮会连带丢掉它之后的所有记录，稿子不会和轮次对不上', () => {
    let state = answer(loaded, 'A1');
    state = answer(state, 'A2');
    state = sessionReducer(state, { type: 'PROMOTE', id: 'h3' });
    expect(state.undoStack).toHaveLength(3);

    const undone = sessionReducer(state, { type: 'UNDO_ROUND', ti: 1 });
    expect(undone.cursor).toBe(1);
    expect(undone.activeIds).toEqual(['h1', 'h2']);
    expect(undone.promotedIds).toEqual([]); // 那条候补依赖的事实没了，它也得下来
    expect(undone.undoStack).toHaveLength(1);
  });

  it('撤回一条事实，同时把它从简历里摘掉', () => {
    let state = answer(loaded);
    state = sessionReducer(state, { type: 'PROMOTE', id: 'h1' });
    state = sessionReducer(state, { type: 'DROP_FACT', id: 'h1' });
    expect(state.activeIds).toEqual(['h2']);
    expect(state.promotedIds).toEqual([]);
  });
});

describe('本场材料', () => {
  it('拖出再撤回，回到原样', () => {
    const out = sessionReducer(loaded, { type: 'TOGGLE_CRUMB', id: 'c1' });
    expect(out.sessionCrumbIds).toEqual(['c2']);
    expect(sessionReducer(out, { type: 'UNDO' }).sessionCrumbIds).toEqual(['c2', 'c1']);
  });

  it('后端新上传的材料自动进本场，删掉后自动退出', () => {
    const added = sessionReducer(loaded, { type: 'ADOPT_CRUMB', id: 'uploaded-1' });
    expect(added.sessionCrumbIds).toContain('uploaded-1');
    expect(sessionReducer(added, { type: 'FORGET_CRUMB', id: 'uploaded-1' }).sessionCrumbIds).not.toContain(
      'uploaded-1',
    );
  });
});

describe('作战板不是海报', () => {
  it('第 ① 段的轮次直接决定工作台问几轮', () => {
    expect(turnBudget(loaded)).toBe(3);
    const fewer = sessionReducer(loaded, { type: 'BUMP_PLAN', id: 'p1', delta: -2 });
    expect(turnBudget(fewer)).toBe(1);
  });

  it('轮次夹在 1..max 之间', () => {
    let state = loaded;
    for (let i = 0; i < 5; i += 1) state = sessionReducer(state, { type: 'BUMP_PLAN', id: 'p1', delta: -1 });
    expect(state.planRounds.p1).toBe(1);
    for (let i = 0; i < 9; i += 1) state = sessionReducer(state, { type: 'BUMP_PLAN', id: 'p1', delta: 1 });
    expect(state.planRounds.p1).toBe(3);
  });
});

describe('深链 SEEK', () => {
  it('直接跳到「已经答了 n 轮」，被判没意义的那轮不产事实', () => {
    const state = sessionReducer(loaded, { type: 'SEEK', n: 3 });
    expect(state.cursor).toBe(3);
    expect(state.rounds.map((r) => r.kind)).toEqual(['answered', 'answered', 'flagged']);
    expect(state.activeIds).toEqual(['h1', 'h2', 'h3']);
  });
});
