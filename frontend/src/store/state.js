/* ============================================================
   全局状态 + reducer

   原型把状态摊在模块级变量里，再靠 renderXxx() 手动把 DOM 刷一遍；
   计数甚至是去数 DOM 节点（`$$('#viewA .sg.source:not(.orphan)').length`）。
   这一版把状态收进一个 reducer，所有计数改成从状态推导（selectors.js），
   于是「稿子」不再是第二份状态，而是 active / promoted / killed / sessionCrumbs
   四个集合的函数。
   ============================================================ */
import { BASELINE, CRUMBS, GOALS, TURNS } from '../data/demo.js';

export const PANELS = ['crumbs', 'grill', 'draft', 'ledger', 'target'];
export const PANEL_LABEL = {
  crumbs: '材料', grill: '拷问', draft: '简历活稿', ledger: '收获账本', target: '目标 JD',
};
/* 目标面板默认收起：Target 的上下文由顶部常驻条负责，
   这个面板只在需要和简历并排比对时才展开。 */
export const PANEL_DEFAULT = {
  crumbs: 'norm', grill: 'norm', draft: 'norm', ledger: 'norm', target: 'min',
};

const sessionDefault = () => new Set(CRUMBS.filter((c) => !c.off).map((c) => c.id));

export function initialState() {
  return {
    screen: 'landing',

    /* ── 拷问 ── */
    cursor: 0,
    rounds: [],          // [{ ti, kind:'answered'|'skipped'|'flagged', text }]
    answering: false,
    pending: null,       // 正在落地的一轮 { ti, text, ids, showHarvest }
    active: new Set(),   // 生效中的新事实 id —— 撤回、计数、稿子长短全靠它
    promoted: new Set(), // 被手动拖进简历的候补事实
    killed: new Set(),   // 被删掉的无出处 bullet 下标
    undoStack: [],
    sessionSaved: false,

    /* ── 投喂 ── */
    intakeWay: 'write',
    pickedExp: 'e1',
    goal: GOALS[0],
    baseline: BASELINE,
    targetId: 'tg1',
    jdPasting: false,    // 是否展开「贴一段 JD」输入框

    /* ── 材料（演示样例 + 后端上传的） ── */
    crumbs: CRUMBS,
    sessionCrumbs: sessionDefault(),

    /* ── 工作台布局 ── */
    panelState: { ...PANEL_DEFAULT },
    panelTouched: {},    // 用户手动点过的面板，不再被窄屏自动收起覆盖
    barHidden: false,
    ledgerKey: 'dim',

    /* ── 后端 ── */
    backend: { status: 'unknown', error: null },

    /* ── 瞬时 UI 提示（由组件消费后自然过期） ── */
    lastHarvest: [],     // 刚落账的事实 id，用来做 born / 翻牌动画
  };
}

const withSet = (set, id, on) => {
  const next = new Set(set);
  if (on) next.add(id); else next.delete(id);
  return next;
};

export function reducer(state, action) {
  switch (action.type) {
    /* ═══════ 导航 ═══════ */
    case 'go':
      return { ...state, screen: action.screen };

    case 'setGoal':
      return { ...state, goal: action.goal };

    /* ═══════ 投喂 ═══════ */
    case 'setWay':
      return { ...state, intakeWay: action.way };

    case 'pickExp':
      return { ...state, pickedExp: action.id };

    case 'setBaseline':
      return { ...state, baseline: action.text };

    case 'setTarget':
      return { ...state, targetId: action.id, jdPasting: action.jdPasting ?? false };

    /* ═══════ 材料 ═══════ */
    case 'addCrumb': {
      const exists = state.crumbs.some((c) => c.id === action.crumb.id);
      return {
        ...state,
        crumbs: exists
          ? state.crumbs.map((c) => (c.id === action.crumb.id ? { ...c, ...action.crumb } : c))
          : [...state.crumbs, action.crumb],
        sessionCrumbs: new Set(state.sessionCrumbs).add(action.crumb.id),
      };
    }

    case 'removeCrumb': {
      const sessionCrumbs = new Set(state.sessionCrumbs);
      sessionCrumbs.delete(action.id);
      return {
        ...state,
        crumbs: state.crumbs.filter((c) => c.id !== action.id),
        sessionCrumbs,
      };
    }

    case 'toggleCrumb': {
      const on = state.sessionCrumbs.has(action.id);
      return {
        ...state,
        sessionCrumbs: withSet(state.sessionCrumbs, action.id, !on),
        undoStack: [...state.undoStack, { k: 'crumb', id: action.id, was: on }],
      };
    }

    /* ═══════ 拷问 ═══════ */
    case 'setAnswering':
      return { ...state, answering: action.value };

    /* ── 一轮作答分三拍落地 ──
       事实立刻进账本（右边稿子当场变金），但问题卡要多留两秒把
       「拆出了几条」讲清楚，再折进历史。所以 pending 是一个真实的中间态，
       不是动画糖：这两秒里 active 已经变了，rounds 还没变。 */
    case 'beginCommit': {
      const active = new Set(state.active);
      action.ids.forEach((id) => active.add(id));
      return {
        ...state,
        active,
        answering: true,
        lastHarvest: action.ids,
        pending: { ti: action.ti, text: action.text, ids: action.ids, showHarvest: false },
        undoStack: [
          ...state.undoStack,
          { k: 'round', ti: action.ti, kind: 'answered', text: action.text, ids: action.ids },
        ],
      };
    }

    case 'revealHarvest':
      if (!state.pending) return state;
      return { ...state, pending: { ...state.pending, showHarvest: true } };

    case 'finishCommit': {
      if (!state.pending) return state;
      const { ti, text } = state.pending;
      return {
        ...state,
        rounds: [...state.rounds, { ti, kind: 'answered', text }],
        cursor: ti + 1,
        answering: false,
        pending: null,
      };
    }

    /* 跳过 / 判定没意义：没有中间态，直接进历史。 */
    case 'passRound':
      return {
        ...state,
        rounds: [...state.rounds, { ti: action.ti, kind: action.kind, text: '' }],
        cursor: action.ti + 1,
        answering: false,
        undoStack: [
          ...state.undoStack,
          { k: 'round', ti: action.ti, kind: action.kind, text: '', ids: [] },
        ],
      };

    /* ═══════ 候补 → 简历 ═══════ */
    case 'promote':
      if (!state.active.has(action.id) || state.promoted.has(action.id)) return state;
      return {
        ...state,
        promoted: new Set(state.promoted).add(action.id),
        undoStack: [...state.undoStack, { k: 'promote', id: action.id }],
      };

    case 'demote':
      if (!state.promoted.has(action.id)) return state;
      return {
        ...state,
        promoted: withSet(state.promoted, action.id, false),
        undoStack: [...state.undoStack, { k: 'demote', id: action.id }],
      };

    case 'dropItem': {
      if (!state.active.has(action.id)) return state;
      return {
        ...state,
        active: withSet(state.active, action.id, false),
        promoted: withSet(state.promoted, action.id, false),
        undoStack: [...state.undoStack, { k: 'item', id: action.id }],
      };
    }

    case 'killSeg':
      return {
        ...state,
        killed: new Set(state.killed).add(action.index),
        undoStack: [...state.undoStack, { k: 'kill', i: action.index }],
      };

    /* ═══════ 撤回 ═══════
       每种操作自带回退语义；稿子不用回退，它是集合的函数。 */
    case 'undo': {
      const undoStack = [...state.undoStack];
      const u = undoStack.pop();
      if (!u) return state;
      const base = { ...state, undoStack };

      if (u.k === 'round') {
        const active = new Set(state.active);
        const promoted = new Set(state.promoted);
        u.ids.forEach((id) => { active.delete(id); promoted.delete(id); });
        return {
          ...base,
          active,
          promoted,
          rounds: state.rounds.filter((r) => r.ti !== u.ti),
          cursor: u.ti,
          answering: false,
          pending: null,
          lastHarvest: [],
        };
      }
      if (u.k === 'item') {
        return { ...base, active: new Set(state.active).add(u.id), lastHarvest: [u.id] };
      }
      if (u.k === 'kill') {
        return { ...base, killed: withSet(state.killed, u.i, false) };
      }
      if (u.k === 'promote') {
        return { ...base, promoted: withSet(state.promoted, u.id, false) };
      }
      if (u.k === 'demote') {
        return { ...base, promoted: new Set(state.promoted).add(u.id) };
      }
      if (u.k === 'crumb') {
        return { ...base, sessionCrumbs: withSet(state.sessionCrumbs, u.id, u.was) };
      }
      return base;
    }

    /* 撤回指定轮：只允许倒着退，否则稿子和轮次对不上。 */
    case 'truncateUndoTo': {
      const idx = state.undoStack.map((u) => (u.k === 'round' ? u.ti : -1)).lastIndexOf(action.ti);
      if (idx < 0) return state;
      return { ...state, undoStack: state.undoStack.slice(0, idx + 1) };
    }

    /* ═══════ 面板 ═══════ */
    case 'cyclePanel': {
      const cur = state.panelState[action.key];
      return {
        ...state,
        panelState: { ...state.panelState, [action.key]: cur === 'min' ? 'norm' : 'min' },
        panelTouched: { ...state.panelTouched, [action.key]: true },
      };
    }

    case 'maxPanel': {
      const was = state.panelState[action.key] === 'max';
      const panelState = { ...state.panelState };
      PANELS.forEach((p) => { if (panelState[p] === 'max') panelState[p] = 'norm'; });
      panelState[action.key] = was ? 'norm' : 'max';
      return { ...state, panelState, panelTouched: { ...state.panelTouched, [action.key]: true } };
    }

    case 'openPanel':
      if (state.panelState[action.key] !== 'min') return state;
      return { ...state, panelState: { ...state.panelState, [action.key]: 'norm' } };

    case 'setPanelState':
      return { ...state, panelState: { ...state.panelState, ...action.patch } };

    case 'resetLayout':
      return { ...state, panelState: { ...PANEL_DEFAULT }, panelTouched: {} };

    case 'toggleBar':
      return { ...state, barHidden: !state.barHidden };

    case 'setLedgerKey':
      return { ...state, ledgerKey: action.key };

    /* ═══════ 会话 ═══════ */
    case 'saveSession':
      return { ...state, sessionSaved: true };

    case 'restart': {
      const fresh = initialState();
      /* 保留后端来的材料和后端状态——重开一场不该把上传过的东西弄丢。 */
      return {
        ...fresh,
        screen: state.screen,
        crumbs: state.crumbs,
        sessionCrumbs: new Set([
          ...sessionDefault(),
          ...state.crumbs.filter((c) => c.remote).map((c) => c.id),
        ]),
        backend: state.backend,
        goal: state.goal,
      };
    }

    /* 直接跳到「已经答了 n 轮」的状态，供 URL hash 深链使用。 */
    case 'seek': {
      const active = new Set();
      const rounds = [];
      const undoStack = [];
      let cursor = 0;
      for (let i = 0; i < action.n && cursor < TURNS.length; i += 1) {
        const t = TURNS[cursor];
        const kind = t.status === 'flagged_useless' ? 'flagged' : 'answered';
        const ids = kind === 'answered' ? t.harvest.slice() : [];
        const text = kind === 'answered' ? t.answer : '';
        ids.forEach((id) => active.add(id));
        undoStack.push({ k: 'round', ti: cursor, kind, text, ids });
        rounds.push({ ti: cursor, kind, text });
        cursor += 1;
      }
      return {
        ...state, active, rounds, undoStack, cursor, answering: false, pending: null, lastHarvest: [],
      };
    }

    case 'hydrate':
      return { ...state, ...action.patch };

    case 'setBackend':
      return { ...state, backend: action.backend };

    default:
      return state;
  }
}
