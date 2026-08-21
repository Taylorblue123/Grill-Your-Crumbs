import { useCallback, useMemo, useRef } from 'react';
import {
  HARVEST, TURNS, TURN_BY_ID,
} from '../data/demo.js';
import { useDispatch, useStore } from '../store/StoreContext.jsx';
import { buildSheet, counts, curTarget, justFilled } from '../store/selectors.js';
import { useToast } from './useToast.jsx';
import { useUi } from './useUi.jsx';

const sleep = (ms) => new Promise((r) => { setTimeout(r, ms); });

/* ============================================================
   带用户反馈的动作层

   reducer 只管状态怎么变；「变完要跟用户说什么」放在这里。
   分开的好处是 reducer 保持纯函数可推理，而每个动作的 toast / 撤回入口
   只写一次，键盘、按钮、拖放、自动演示四个入口共用。
   ============================================================ */
export default function useActions() {
  const state = useStore();
  const dispatch = useDispatch();
  const { show } = useToast();
  const ui = useUi();

  /* 异步流程要读最新状态，用 ref 避开闭包快照。 */
  const stateRef = useRef(state);
  stateRef.current = state;

  const undo = useCallback(() => {
    const cur = stateRef.current;
    const u = cur.undoStack[cur.undoStack.length - 1];
    if (!u) { show('没有可撤回的了。'); return; }
    dispatch({ type: 'undo' });

    if (u.k === 'round') {
      show(`撤回了第 ${TURNS[u.ti].round} 轮${u.ids.length
        ? `，账本少了 ${u.ids.length} 条，稿子里对应的金色片段已退回骨架` : ''}。`);
    } else if (u.k === 'item') {
      show(`「${HARVEST[u.id].text.slice(0, 14)}…」放回来了。`);
    } else if (u.k === 'kill') {
      show('那句无出处的套话放回来了。');
    } else if (u.k === 'promote') {
      show('从简历里移走了，事实仍然留在账本。');
    } else if (u.k === 'demote') {
      show('又加回简历了。');
    } else if (u.k === 'crumb') {
      show(u.was ? '材料放回本场了。' : '材料又移出去了。');
    }
  }, [dispatch, show]);

  const toggleCrumb = useCallback((id) => {
    const cur = stateRef.current;
    const on = cur.sessionCrumbs.has(id);
    /* 「有多少句引用了它」必须在移出之前算 —— 移出之后它们就变成 orphan 了。 */
    const sheet = buildSheet(cur, { force: false });
    const cited = [
      ...sheet.bullets.flatMap((b) => b.segs),
      ...sheet.intro,
    ].filter((s) => s.o === 'source' && s.ref === id).length;

    dispatch({ type: 'toggleCrumb', id });
    show(on
      ? (cited
        ? `移出本场。成稿里有 ${cited} 处引用了它，已标成「出处已移出」。`
        : '移出本场了。成稿里没有句子引用它，所以稿子没变化。')
      : '加进本场了。下一轮提问会把它算进「我读过的材料」。', undo);
  }, [dispatch, show, undo]);

  const promote = useCallback((id) => {
    const cur = stateRef.current;
    if (!cur.active.has(id)) { show('这条已经被撤回了，先放回来再加。'); return; }
    if (cur.promoted.has(id)) { show('它已经在简历里了。'); return; }
    dispatch({ type: 'promote', id });
    dispatch({ type: 'openPanel', key: 'draft' });
    show(`「${HARVEST[id].text.slice(0, 13)}…」写进简历了。出处仍然绑着第 ${
      TURN_BY_ID[HARVEST[id].turn].round} 轮。`, undo);
  }, [dispatch, show, undo]);

  const demote = useCallback((id) => {
    dispatch({ type: 'demote', id });
    show('移回候补了。事实还在账本里，只是不进这份简历。', undo);
  }, [dispatch, show, undo]);

  const dropItem = useCallback((id) => {
    dispatch({ type: 'dropItem', id });
    show('撤回了 1 条新事实，稿子里依赖它的句子已退回骨架。', undo);
  }, [dispatch, show, undo]);

  const killSeg = useCallback((index) => {
    dispatch({ type: 'killSeg', index });
    show('删掉了。已写入 events.jsonl → 幻觉样本，这就是评测集的原料。', undo);
  }, [dispatch, show, undo]);

  /* 撤回指定轮：只能倒着退，否则稿子和轮次会对不上。 */
  const undoRound = useCallback((ti) => {
    const cur = stateRef.current;
    const last = cur.rounds[cur.rounds.length - 1];
    if (!last || last.ti !== ti) {
      show(`要先撤回第 ${TURNS[last?.ti ?? ti].round} 轮——回退是按顺序来的，不然稿子会对不上。`);
      return;
    }
    dispatch({ type: 'truncateUndoTo', ti });
    /* truncate 之后栈顶一定是这一轮，下一拍再撤。 */
    setTimeout(undo, 0);
  }, [dispatch, show, undo]);

  const skip = useCallback(() => {
    const cur = stateRef.current;
    if (cur.cursor >= TURNS.length || cur.answering) return;
    dispatch({ type: 'passRound', ti: cur.cursor, kind: 'skipped' });
    show('跳过了。跳过不会丢——回头还能从「撤回上一步」倒回来。');
  }, [dispatch, show]);

  const flagBad = useCallback(() => {
    const cur = stateRef.current;
    if (cur.cursor >= TURNS.length || cur.answering) return;
    dispatch({ type: 'passRound', ti: cur.cursor, kind: 'flagged' });
    show('已写入 events.jsonl → Good-Question-Rate 负样本。评测集长在交互里，不用另外标注。');
  }, [dispatch, show]);

  /* 一轮作答的三拍：立刻落账 → 420ms 后说明拆出了什么 → 1.5s 后折进历史。 */
  const commit = useCallback(async (text) => {
    const cur = stateRef.current;
    if (cur.cursor >= TURNS.length || cur.answering) return;
    const t = TURNS[cur.cursor];
    const ids = t.harvest.slice();

    dispatch({ type: 'beginCommit', ti: cur.cursor, text, ids });
    await sleep(420);
    dispatch({ type: 'revealHarvest' });

    const after = stateRef.current;
    const target = curTarget(after);
    const nFill = target
      ? target.reqs.filter((r) => justFilled(r, ids, after.active)).length
      : 0;
    if (nFill) setTimeout(() => show(`这一轮补上了 JD 的 ${nFill} 条要求。`), 900);
    ui.requestBump(`+${ids.length} 条 · 稿子里 ${counts(after).gold} 处金色`);

    await sleep(1500);
    dispatch({ type: 'finishCommit' });
  }, [dispatch, show, ui]);

  const finishToDash = useCallback(() => {
    dispatch({ type: 'saveSession' });
    dispatch({ type: 'go', screen: 'dash' });
    const n = stateRef.current.active.size;
    setTimeout(() => show(
      `存好了。「校园二手交易平台 · 推荐系统」这段经历多了 ${n} 条事实，产出物也挂在它下面。`,
    ), 400);
  }, [dispatch, show]);

  return useMemo(() => ({
    undo, undoRound, toggleCrumb, promote, demote, dropItem, killSeg,
    skip, flagBad, commit, finishToDash,
  }), [undo, undoRound, toggleCrumb, promote, demote, dropItem, killSeg,
    skip, flagBad, commit, finishToDash]);
}
