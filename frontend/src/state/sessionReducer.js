/* ============================================================
   一场 Grill 的全部状态。

   设计稿里那句「稿子不是另一份状态」在这里落成规则：
   reducer 只维护几个集合（生效中的事实 / 被拖进简历的候补 / 本场材料 /
   被删掉的无出处片段），稿子和所有计数都由 domain/ 里的纯函数从这些集合算出来。
   所以撤回不需要「反向修改稿子」，只要把集合退回去。

   撤回是补偿操作（compensating command），不是客户端的状态回卷 ——
   这一点和 docs/backend-api.md 里对 undo 的要求是同一条。
   ============================================================ */

export const initialState = {
  status: 'loading',
  error: null,

  // 来自 API 的这一场投影
  dims: [],
  turns: [],
  harvest: {},
  artifact: null,
  oldResume: [],
  plan: [],
  bases: [],
  goals: [],
  targets: [],
  reqKind: {},

  // 三项配置（作战板那句话里的三个下拉）
  targetId: 'tg1',
  outputId: 'g0',
  baseId: 'b1',

  // 作战板
  planOn: {},
  planRounds: {},

  // 拷问进度
  cursor: 0,
  rounds: [],
  pending: null, // { text, factIds, harvestShown }

  // 集合（用数组存，保持插入顺序；Set 由 selector 派生）
  activeIds: [],
  promotedIds: [],
  killedBullets: [],
  sessionCrumbIds: [],

  undoStack: [],
  ledgerKey: 'dim',
  sessionSaved: false,
};

const without = (list, value) => list.filter((item) => item !== value);
const withOne = (list, value) => (list.includes(value) ? list : [...list, value]);

/** 这一场实际问几轮 = 作战板上第一段的轮次（原型只有它有脚本）。 */
export function turnBudget(state) {
  const firstId = state.plan[0]?.id;
  if (!firstId) return state.turns.length;
  return Math.max(1, Math.min(state.turns.length, state.planRounds[firstId] ?? state.turns.length));
}

export const currentTarget = (state) =>
  state.targetId ? state.targets.find((t) => t.id === state.targetId) || null : null;

function freshSession(state) {
  return {
    ...state,
    cursor: 0,
    rounds: [],
    pending: null,
    activeIds: [],
    promotedIds: [],
    killedBullets: [],
    undoStack: [],
    sessionSaved: false,
    baseId: 'b1',
    outputId: 'g0',
    planOn: Object.fromEntries(state.plan.map((p) => [p.id, p.on])),
    planRounds: Object.fromEntries(state.plan.map((p) => [p.id, p.rounds])),
    sessionCrumbIds: state.defaultCrumbIds || state.sessionCrumbIds,
  };
}

/**
 * 撤回 undoStack 里第 index 条，并把它之后的记录一起丢掉。
 * 每一种撤回都是「把集合退回去」，没有一处是反向去改稿子。
 */
export function applyUndo(state, index) {
  const entry = state.undoStack[index];
  if (!entry) return state;
  const undoStack = state.undoStack.slice(0, index);
  switch (entry.k) {
    case 'round':
      return {
        ...state,
        undoStack,
        activeIds: state.activeIds.filter((id) => !entry.ids.includes(id)),
        promotedIds: state.promotedIds.filter((id) => !entry.ids.includes(id)),
        rounds: state.rounds.filter((r) => r.ti !== entry.ti),
        cursor: entry.ti,
        pending: null,
      };
    case 'item':
      return { ...state, undoStack, activeIds: withOne(state.activeIds, entry.id) };
    case 'kill':
      return { ...state, undoStack, killedBullets: without(state.killedBullets, entry.index) };
    case 'promote':
      return { ...state, undoStack, promotedIds: without(state.promotedIds, entry.id) };
    case 'demote':
      return { ...state, undoStack, promotedIds: withOne(state.promotedIds, entry.id) };
    case 'crumb':
      return {
        ...state,
        undoStack,
        sessionCrumbIds: entry.was
          ? withOne(state.sessionCrumbIds, entry.id)
          : without(state.sessionCrumbIds, entry.id),
      };
    default:
      return { ...state, undoStack };
  }
}

export function sessionReducer(state, action) {
  switch (action.type) {
    case 'LOAD_ERROR':
      return { ...state, status: 'error', error: action.error };

    case 'LOADED': {
      const { session, targets, reqKind, sessionCrumbIds } = action.payload;
      const next = {
        ...state,
        status: 'ready',
        error: null,
        dims: session.dims,
        turns: session.turns,
        harvest: session.harvest,
        artifact: session.artifact,
        oldResume: session.oldResume,
        plan: session.plan,
        bases: session.bases,
        goals: session.goals,
        targets,
        reqKind,
        defaultCrumbIds: sessionCrumbIds,
        sessionCrumbIds,
        planOn: Object.fromEntries(session.plan.map((p) => [p.id, p.on])),
        planRounds: Object.fromEntries(session.plan.map((p) => [p.id, p.rounds])),
      };
      return next;
    }

    /* 后端返回的新材料进入材料库时，默认装进本场。 */
    case 'ADOPT_CRUMB':
      return { ...state, sessionCrumbIds: withOne(state.sessionCrumbIds, action.id) };

    case 'FORGET_CRUMB':
      return { ...state, sessionCrumbIds: without(state.sessionCrumbIds, action.id) };

    /* ── 三项配置 ── */
    case 'SET_TARGET':
      return { ...state, targetId: action.id };
    case 'SET_OUTPUT':
      return { ...state, outputId: action.id };
    case 'SET_BASE':
      return { ...state, baseId: action.id };

    /* ── 作战板 ── */
    case 'TOGGLE_PLAN':
      return { ...state, planOn: { ...state.planOn, [action.id]: !state.planOn[action.id] } };
    case 'BUMP_PLAN': {
      const segment = state.plan.find((p) => p.id === action.id);
      if (!segment) return state;
      const value = Math.max(
        1,
        Math.min(segment.max, (state.planRounds[action.id] ?? segment.rounds) + action.delta),
      );
      return { ...state, planRounds: { ...state.planRounds, [action.id]: value } };
    }
    case 'ONLY_FIRST': {
      const first = state.plan[0]?.id;
      return { ...state, planOn: Object.fromEntries(state.plan.map((p) => [p.id, p.id === first])) };
    }
    case 'START_PLAN':
      // 上一场问完了才重置，否则「回工作台继续问」会把进度冲掉
      return state.cursor > turnBudget(state) ? { ...state, cursor: 0, rounds: [] } : state;

    /* ── 一轮问答 ── */
    case 'ANSWER_START': {
      const turn = state.turns[state.cursor];
      const factIds = turn.harvest.slice();
      return {
        ...state,
        pending: { text: action.text, factIds, harvestShown: false },
        activeIds: factIds.reduce(withOne, state.activeIds),
        undoStack: [
          ...state.undoStack,
          { k: 'round', ti: state.cursor, kind: 'answered', text: action.text, ids: factIds },
        ],
      };
    }
    case 'ANSWER_HARVEST':
      return state.pending
        ? { ...state, pending: { ...state.pending, harvestShown: true } }
        : state;
    case 'ANSWER_DONE': {
      if (!state.pending) return state;
      return {
        ...state,
        rounds: [...state.rounds, { ti: state.cursor, kind: 'answered', text: state.pending.text }],
        cursor: state.cursor + 1,
        pending: null,
      };
    }
    case 'SKIP':
    case 'FLAG_BAD': {
      const kind = action.type === 'SKIP' ? 'skipped' : 'flagged';
      return {
        ...state,
        rounds: [...state.rounds, { ti: state.cursor, kind, text: '' }],
        cursor: state.cursor + 1,
        undoStack: [...state.undoStack, { k: 'round', ti: state.cursor, kind, text: '', ids: [] }],
      };
    }

    /* ── 候补 → 简历 ── */
    case 'PROMOTE':
      return {
        ...state,
        promotedIds: withOne(state.promotedIds, action.id),
        undoStack: [...state.undoStack, { k: 'promote', id: action.id }],
      };
    case 'DEMOTE':
      return {
        ...state,
        promotedIds: without(state.promotedIds, action.id),
        undoStack: [...state.undoStack, { k: 'demote', id: action.id }],
      };

    /* ── 撤回一条事实 / 删掉一句无出处的套话 ── */
    case 'DROP_FACT':
      return {
        ...state,
        activeIds: without(state.activeIds, action.id),
        promotedIds: without(state.promotedIds, action.id),
        undoStack: [...state.undoStack, { k: 'item', id: action.id }],
      };
    case 'KILL_BULLET':
      return {
        ...state,
        killedBullets: withOne(state.killedBullets, action.index),
        undoStack: [...state.undoStack, { k: 'kill', index: action.index }],
      };

    /* ── 材料拖进拖出本场 ── */
    case 'TOGGLE_CRUMB': {
      const on = state.sessionCrumbIds.includes(action.id);
      return {
        ...state,
        sessionCrumbIds: on
          ? without(state.sessionCrumbIds, action.id)
          : withOne(state.sessionCrumbIds, action.id),
        undoStack: [...state.undoStack, { k: 'crumb', id: action.id, was: on }],
      };
    }

    /* ── 撤回 ── */
    case 'UNDO':
      return applyUndo(state, state.undoStack.length - 1);

    /* 撤回某一轮：只能按顺序退，否则稿子会和轮次对不上。
       先把这一轮之后的 undo 记录削掉，再撤它 —— 一步做完，
       中间态不会漏给渲染。 */
    case 'UNDO_ROUND': {
      const index = state.undoStack.map((u) => (u.k === 'round' ? u.ti : -1)).lastIndexOf(action.ti);
      if (index < 0) return state;
      return applyUndo({ ...state, undoStack: state.undoStack.slice(0, index + 1) }, index);
    }

    case 'SET_LEDGER_KEY':
      return { ...state, ledgerKey: action.key };

    case 'SAVE_SESSION':
      return { ...state, sessionSaved: true };

    case 'RESTART':
      return freshSession(state);

    /* 深链：直接跳到「已经答了 n 轮」的状态。 */
    case 'SEEK': {
      let next = freshSession(state);
      const budget = turnBudget(next);
      for (let i = 0; i < action.n && next.cursor < budget; i += 1) {
        const turn = next.turns[next.cursor];
        const kind = turn.status === 'flagged_useless' ? 'flagged' : 'answered';
        const ids = kind === 'answered' ? turn.harvest.slice() : [];
        next = {
          ...next,
          activeIds: ids.reduce(withOne, next.activeIds),
          rounds: [...next.rounds, { ti: next.cursor, kind, text: kind === 'answered' ? turn.answer : '' }],
          undoStack: [
            ...next.undoStack,
            { k: 'round', ti: next.cursor, kind, text: kind === 'answered' ? turn.answer : '', ids },
          ],
          cursor: next.cursor + 1,
        };
      }
      return next;
    }

    default:
      return state;
  }
}
