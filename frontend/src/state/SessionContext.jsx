/* ============================================================
   一场 Grill 的对外接口：状态 + 派生投影 + 带反馈的动作。

   组件只调 actions 里的方法，不直接 dispatch —— 因为几乎每个动作都
   带一句「刚发生了什么、能不能撤回」的反馈，那属于这一层的职责。
   ============================================================ */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
} from 'react';
import { fetchGrillSession, fetchTargets, recordEvent } from '../api';
import { buildDraft, goldCount, isCandidateFact } from '../domain/provenance';
import { groupLedger, pendingCandidates } from '../domain/ledger';
import { reqTally } from '../domain/target';
import {
  currentTarget,
  initialState,
  sessionReducer,
  turnBudget,
} from './sessionReducer';
import { useCrumbLibrary } from './CrumbLibraryContext';
import { useToast } from './ToastContext';

const SessionContext = createContext(null);

const HARVEST_DELAY_MS = 420; // 拆出事实的那一行，稍慢于回答落地
const NEXT_TURN_DELAY_MS = 1500; // 让用户看清稿子长出来，再推下一题

export function SessionProvider({ children }) {
  const [state, dispatch] = useReducer(sessionReducer, initialState);
  const { push: toast } = useToast();
  const library = useCrumbLibrary();
  const timers = useRef([]);

  const later = useCallback((fn, ms) => {
    const id = setTimeout(fn, ms);
    timers.current.push(id);
    return id;
  }, []);
  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  /* ── 装载：一次把这一场需要的投影都取回来 ──
     只能装载一次。LOADED 会把作战板、本场材料等全部重置回默认值，
     所以哪怕依赖的引用变了也绝不能再来一遍 —— 那会在用户已经改过轮次、
     拖过材料之后，把他的编辑无声地冲掉（这个 bug 是 Playwright 验收抓出来的）。
     等 library.status 变 ready 之后再装载，那时默认材料集合已经定下来了。 */
  const loadRequested = useRef(false);
  const defaultCrumbIds = useRef(library.defaultSessionIds);
  defaultCrumbIds.current = library.defaultSessionIds;

  useEffect(() => {
    if (library.status !== 'ready' || loadRequested.current) return;
    loadRequested.current = true;
    Promise.all([fetchGrillSession(), fetchTargets()])
      .then(([session, targetsPayload]) => {
        dispatch({
          type: 'LOADED',
          payload: {
            session,
            targets: targetsPayload.targets,
            reqKind: targetsPayload.reqKind,
            sessionCrumbIds: defaultCrumbIds.current,
          },
        });
      })
      .catch((error) => dispatch({ type: 'LOAD_ERROR', error: error.message }));
  }, [library.status]);

  /* 后端新上传的材料自动进本场；被删掉的自动退出本场。
     材料库是真相，这里只跟着它走。 */
  const knownBackendIds = useRef(new Set());
  useEffect(() => {
    const ids = new Set(library.backendCrumbs.map((c) => c.id));
    library.backendCrumbs.forEach((crumb) => {
      if (!knownBackendIds.current.has(crumb.id)) dispatch({ type: 'ADOPT_CRUMB', id: crumb.id });
    });
    knownBackendIds.current.forEach((id) => {
      if (!ids.has(id)) dispatch({ type: 'FORGET_CRUMB', id });
    });
    knownBackendIds.current = ids;
  }, [library.backendCrumbs]);

  /* ── 派生投影 ── */
  const activeFacts = useMemo(() => new Set(state.activeIds), [state.activeIds]);
  const promotedFacts = useMemo(() => new Set(state.promotedIds), [state.promotedIds]);
  const killedBullets = useMemo(() => new Set(state.killedBullets), [state.killedBullets]);
  const sessionCrumbs = useMemo(() => new Set(state.sessionCrumbIds), [state.sessionCrumbIds]);

  const target = useMemo(() => currentTarget(state), [state]);
  const budget = useMemo(() => turnBudget(state), [state]);

  const draft = useMemo(() => {
    if (!state.artifact) return null;
    return buildDraft({
      artifact: state.artifact,
      harvest: state.harvest,
      activeFacts,
      promotedFacts,
      killedBullets,
      sessionCrumbs,
      mode: 'live',
    });
  }, [state.artifact, state.harvest, activeFacts, promotedFacts, killedBullets, sessionCrumbs]);

  const finalDraft = useMemo(() => {
    if (!state.artifact) return null;
    return buildDraft({
      artifact: state.artifact,
      harvest: state.harvest,
      activeFacts,
      promotedFacts,
      killedBullets,
      sessionCrumbs,
      mode: 'final',
      force: true,
    });
  }, [state.artifact, state.harvest, activeFacts, promotedFacts, killedBullets, sessionCrumbs]);

  /* 落地页那张 AFTER 卡片：展示「6 轮拷问之后」的完整样子，
     所以强制把所有片段都当成已挖到，不受当前进度影响。 */
  const showcase = useMemo(() => {
    if (!state.artifact) return null;
    return buildDraft({
      artifact: state.artifact,
      harvest: state.harvest,
      activeFacts,
      promotedFacts: new Set(),
      killedBullets: new Set(),
      sessionCrumbs,
      mode: 'live',
      force: true,
    });
  }, [state.artifact, state.harvest, activeFacts, sessionCrumbs]);

  const tally = useMemo(() => reqTally(target, activeFacts), [target, activeFacts]);
  const ledgerGroups = useMemo(
    () => groupLedger(state.activeIds, state.harvest, state.dims, state.ledgerKey),
    [state.activeIds, state.harvest, state.dims, state.ledgerKey],
  );
  const candidates = useMemo(
    () => pendingCandidates(state.activeIds, state.harvest, promotedFacts),
    [state.activeIds, state.harvest, promotedFacts],
  );
  const gold = useMemo(
    () =>
      state.artifact ? goldCount({ artifact: state.artifact, activeFacts, promotedFacts }) : 0,
    [state.artifact, activeFacts, promotedFacts],
  );

  /* ── 动作 ── */
  const undo = useCallback(() => {
    const entry = state.undoStack[state.undoStack.length - 1];
    if (!entry) {
      toast('没有可撤回的了。');
      return;
    }
    dispatch({ type: 'UNDO' });
    /* 每种撤回的说法不一样。必须按 entry.k 分支求值，不能先建一个
       消息字典再取一条 —— 那会把别的分支（比如 entry.ids）也一起算了。 */
    let message = '撤回了。';
    switch (entry.k) {
      case 'round':
        message = `撤回了第 ${state.turns[entry.ti]?.round} 轮${
          entry.ids.length ? `，账本少了 ${entry.ids.length} 条，稿子里对应的金色片段已退回骨架` : ''
        }。`;
        break;
      case 'item':
        message = '放回来了。';
        break;
      case 'kill':
        message = '那句无出处的套话放回来了。';
        break;
      case 'promote':
        message = '从简历里移走了，事实仍然留在账本。';
        break;
      case 'demote':
        message = '又加回简历了。';
        break;
      case 'crumb':
        message = entry.was ? '材料放回本场了。' : '材料又移出去了。';
        break;
      default:
        break;
    }
    toast(message);
  }, [state.undoStack, state.turns, toast]);

  const answer = useCallback(
    (text) => {
      if (state.cursor >= budget || state.pending) return;
      const turn = state.turns[state.cursor];
      if (turn.status === 'flagged_useless') {
        toast('这一轮我问砸了，你写什么我都接不住。点「这问题没意义」我换一个。');
        return;
      }
      dispatch({ type: 'ANSWER_START', text });
      later(() => dispatch({ type: 'ANSWER_HARVEST' }), HARVEST_DELAY_MS);
      later(() => dispatch({ type: 'ANSWER_DONE' }), HARVEST_DELAY_MS + NEXT_TURN_DELAY_MS);
      toast(`记进账本了：${turn.harvest.length} 条。不满意随时撤回，稿子会跟着退回去。`);
    },
    [state.cursor, state.pending, state.turns, budget, later, toast],
  );

  const skip = useCallback(() => {
    if (state.cursor >= budget || state.pending) return;
    dispatch({ type: 'SKIP' });
    toast('跳过了。跳过不会丢——回头还能从「撤回上一步」倒回来。');
  }, [state.cursor, state.pending, budget, toast]);

  const flagBad = useCallback(() => {
    if (state.cursor >= budget || state.pending) return;
    dispatch({ type: 'FLAG_BAD' });
    recordEvent('flag_useless', { turn: state.turns[state.cursor]?.id });
    toast('已写入 events.jsonl → Good-Question-Rate 负样本。评测集长在交互里，不用另外标注。');
  }, [state.cursor, state.pending, state.turns, budget, toast]);

  const undoRound = useCallback(
    (ti) => {
      const last = state.rounds[state.rounds.length - 1];
      if (!last || last.ti !== ti) {
        toast(`要先撤回第 ${state.turns[last?.ti]?.round} 轮——回退是按顺序来的，不然稿子会对不上。`);
        return;
      }
      dispatch({ type: 'UNDO_ROUND', ti });
      const undone = state.undoStack.find((u) => u.k === 'round' && u.ti === ti);
      toast(
        `撤回了第 ${state.turns[ti]?.round} 轮${
          undone?.ids.length ? `，账本少了 ${undone.ids.length} 条，稿子里对应的金色片段已退回骨架` : ''
        }。`,
      );
    },
    [state.rounds, state.turns, state.undoStack, toast],
  );

  const promote = useCallback(
    (id) => {
      if (!activeFacts.has(id)) {
        toast('这条已经被撤回了，先放回来再加。');
        return;
      }
      if (promotedFacts.has(id)) {
        toast('它已经在简历里了。');
        return;
      }
      dispatch({ type: 'PROMOTE', id });
      const fact = state.harvest[id];
      const round = state.turns.find((t) => t.id === fact.turn)?.round;
      toast(`「${fact.text.slice(0, 13)}…」写进简历了。出处仍然绑着第 ${round} 轮。`, undo);
    },
    [activeFacts, promotedFacts, state.harvest, state.turns, toast, undo],
  );

  const demote = useCallback(
    (id) => {
      if (!promotedFacts.has(id)) return;
      dispatch({ type: 'DEMOTE', id });
      toast('移回候补了。事实还在账本里，只是不进这份简历。', undo);
    },
    [promotedFacts, toast, undo],
  );

  const dropFact = useCallback(
    (id) => {
      if (!activeFacts.has(id)) return;
      dispatch({ type: 'DROP_FACT', id });
      toast('撤回了 1 条新事实，稿子里依赖它的句子已退回骨架。', undo);
    },
    [activeFacts, toast, undo],
  );

  const killBullet = useCallback(
    (index) => {
      dispatch({ type: 'KILL_BULLET', index });
      recordEvent('kill_unsourced_segment', { index });
      toast('删掉了。已写入 events.jsonl → 幻觉样本，这就是评测集的原料。', undo);
    },
    [toast, undo],
  );

  const toggleCrumb = useCallback(
    (id) => {
      const on = sessionCrumbs.has(id);
      const cited = draft
        ? draft.bullets
            .flatMap((b) => b.segments)
            .concat(draft.intro)
            .filter((s) => s.ref === id).length
        : 0;
      dispatch({ type: 'TOGGLE_CRUMB', id });
      toast(
        on
          ? cited
            ? `移出本场。成稿里有 ${cited} 处引用了它，已标成「出处已移出」。`
            : '移出本场了。成稿里没有句子引用它，所以稿子没变化。'
          : '加进本场了。下一轮提问会把它算进「我读过的材料」。',
        undo,
      );
    },
    [sessionCrumbs, draft, toast, undo],
  );

  const setTarget = useCallback((id) => dispatch({ type: 'SET_TARGET', id }), []);
  const setOutput = useCallback((id) => dispatch({ type: 'SET_OUTPUT', id }), []);
  const setBase = useCallback((id) => dispatch({ type: 'SET_BASE', id }), []);
  const setLedgerKey = useCallback((key) => dispatch({ type: 'SET_LEDGER_KEY', key }), []);
  const togglePlan = useCallback((id) => dispatch({ type: 'TOGGLE_PLAN', id }), []);

  const bumpPlan = useCallback(
    (id, delta) => {
      dispatch({ type: 'BUMP_PLAN', id, delta });
      if (id === state.plan[0]?.id) {
        const segment = state.plan[0];
        const next = Math.max(
          1,
          Math.min(segment.max, (state.planRounds[id] ?? segment.rounds) + delta),
        );
        toast(`第 ① 段改成 ${next} 轮 —— 工作台就只问这么多。`);
      }
    },
    [state.plan, state.planRounds, toast],
  );

  const onlyFirst = useCallback(() => {
    dispatch({ type: 'ONLY_FIRST' });
    toast('只挖第 ① 段。其余几段留给下一场。');
  }, [toast]);

  const startPlan = useCallback(() => dispatch({ type: 'START_PLAN' }), []);
  const restart = useCallback(() => dispatch({ type: 'RESTART' }), []);
  const seek = useCallback((n) => dispatch({ type: 'SEEK', n }), []);

  const saveSession = useCallback(() => {
    dispatch({ type: 'SAVE_SESSION' });
    recordEvent('save_thread');
  }, []);

  const track = useCallback(
    (type) => {
      recordEvent(type);
      toast(`已埋点 events.jsonl → {"type":"${type}"}　这就是评测集的原料`);
    },
    [toast],
  );

  const value = useMemo(
    () => ({
      state,
      // 派生
      activeFacts,
      promotedFacts,
      killedBullets,
      sessionCrumbs,
      target,
      tally,
      budget,
      draft,
      finalDraft,
      showcase,
      ledgerGroups,
      candidates,
      gold,
      isCandidate: (id) => isCandidateFact(state.harvest[id]),
      // 动作
      actions: {
        answer,
        skip,
        flagBad,
        undo,
        undoRound,
        promote,
        demote,
        dropFact,
        killBullet,
        toggleCrumb,
        setTarget,
        setOutput,
        setBase,
        setLedgerKey,
        togglePlan,
        bumpPlan,
        onlyFirst,
        startPlan,
        restart,
        seek,
        saveSession,
        track,
      },
    }),
    [
      state, activeFacts, promotedFacts, killedBullets, sessionCrumbs, target, tally, budget,
      draft, finalDraft, showcase, ledgerGroups, candidates, gold,
      answer, skip, flagBad, undo, undoRound, promote, demote, dropFact, killBullet, toggleCrumb,
      setTarget, setOutput, setBase, setLedgerKey, togglePlan, bumpPlan, onlyFirst, startPlan,
      restart, seek, saveSession, track,
    ],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession() {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error('useSession 必须在 SessionProvider 内使用');
  return ctx;
}
