import { useCallback, useEffect, useRef, useState } from 'react';
import { TURNS } from '../data/demo.js';
import { useDispatch } from '../store/StoreContext.jsx';
import useActions from './useActions.js';

const sleep = (ms) => new Promise((r) => { setTimeout(r, ms); });

/* ============================================================
   自动演示：从落地页一路跑到工作区（约 80 秒）

   它走的是和真人完全相同的动作入口（dispatch / actions / composer），
   没有任何「只有演示能走」的旁路 —— 所以演示跑得通，就等于这条路真的通。
   Esc 或再点一次按钮随时接管。
   ============================================================ */
export default function useTour({ composerRef, jdBoardRef, doneScrollRef }) {
  const dispatch = useDispatch();
  const actions = useActions();
  const [running, setRunning] = useState(false);
  const [caption, setCaption] = useState('落地页');
  const runningRef = useRef(false);

  const stop = useCallback(() => {
    runningRef.current = false;
    setRunning(false);
  }, []);

  useEffect(() => () => { runningRef.current = false; }, []);

  /* 分片等待：用户一接管就立刻从当前 await 处抛出，不会再多跑一步。 */
  const wait = useCallback(async (ms) => {
    const step = 60;
    for (let i = 0; i < ms; i += step) {
      if (!runningRef.current) throw new Error('tour-stopped');
      // eslint-disable-next-line no-await-in-loop
      await sleep(step);
    }
  }, []);

  const start = useCallback(async () => {
    if (runningRef.current) { stop(); return; }
    runningRef.current = true;
    setRunning(true);
    const say = (s) => setCaption(s);

    try {
      dispatch({ type: 'restart' });
      dispatch({ type: 'setWay', way: 'write' });
      dispatch({ type: 'setTarget', id: 'tg1' });
      dispatch({ type: 'go', screen: 'landing' });
      say('⓪ 落地页');
      await wait(4600);

      dispatch({ type: 'go', screen: 'dash' });
      say('① 工作区 · 按「经历」组织');
      await wait(3200);

      dispatch({ type: 'go', screen: 'opps' });
      say('①b 机会 · 岗位和人，都是拿事实去对外部要求');
      await wait(4200);

      dispatch({ type: 'go', screen: 'setup' });
      say('② 投喂 · ① 产出什么（格式） ② 为谁做（Target）');
      await wait(2400);
      say('② Target · JD 拆成 14 条要求：对上 / 弱 / 能问出 / 确实没有');
      await wait(4000);
      dispatch({ type: 'setWay', way: 'pick' });
      say('② 方式 B · 经历按「能对上 JD 几条」重排');
      await wait(3600);
      dispatch({ type: 'setWay', way: 'write' });

      dispatch({ type: 'go', screen: 'wb' });
      say('③ 工作台 · 顶上常驻 Target 条，五个面板');
      await wait(2600);
      dispatch({ type: 'openPanel', key: 'target' });
      dispatch({ type: 'maxPanel', key: 'target' });
      say('③ 第五面板 · 要求清单（默认收起，需要时展开）');
      await wait(3600);
      dispatch({ type: 'maxPanel', key: 'target' });
      dispatch({ type: 'cyclePanel', key: 'target' });
      await wait(900);

      for (let i = 0; i < TURNS.length; i += 1) {
        if (!runningRef.current) throw new Error('tour-stopped');
        const t = TURNS[i];
        say(`第 ${t.round}/6 轮 · ${t.dim}`);
        // eslint-disable-next-line no-await-in-loop
        await wait(1300);

        if (t.status === 'flagged_useless') {
          say(`第 ${t.round}/6 轮 · 它问砸了，用户判它没意义`);
          // eslint-disable-next-line no-await-in-loop
          await wait(1200);
          actions.flagBad();
          // eslint-disable-next-line no-await-in-loop
          await wait(1400);
          continue;
        }

        // eslint-disable-next-line no-await-in-loop
        await composerRef.current?.startAnswer();
        // eslint-disable-next-line no-await-in-loop
        await wait(600);
        composerRef.current?.send();
        // eslint-disable-next-line no-await-in-loop
        await wait(2600);

        if (i === 1) {
          say('面板可收可放：材料收到边上，简历放大');
          // eslint-disable-next-line no-await-in-loop
          await wait(400);
          dispatch({ type: 'cyclePanel', key: 'crumbs' });
          // eslint-disable-next-line no-await-in-loop
          await wait(1500);
          dispatch({ type: 'maxPanel', key: 'draft' });
          // eslint-disable-next-line no-await-in-loop
          await wait(2200);
          dispatch({ type: 'maxPanel', key: 'draft' });
          dispatch({ type: 'cyclePanel', key: 'crumbs' });
          // eslint-disable-next-line no-await-in-loop
          await wait(900);
        }
        if (i === 2) {
          say('账本可以按维度分栏，也可以按标签分栏');
          // eslint-disable-next-line no-await-in-loop
          await wait(1200);
          dispatch({ type: 'setLedgerKey', key: 'tag' });
          // eslint-disable-next-line no-await-in-loop
          await wait(2400);
          dispatch({ type: 'setLedgerKey', key: 'dim' });
          // eslint-disable-next-line no-await-in-loop
          await wait(1200);
          say('候补事实：默认不进简历，用户手动拖进去');
          // eslint-disable-next-line no-await-in-loop
          await wait(1200);
          actions.promote('h10');
          // eslint-disable-next-line no-await-in-loop
          await wait(2400);
        }
        if (i === 3) {
          say('答完 → JD 清单上那几条从 ○ 翻成 ✓');
          // eslint-disable-next-line no-await-in-loop
          await wait(1000);
          dispatch({ type: 'openPanel', key: 'target' });
          // eslint-disable-next-line no-await-in-loop
          await wait(2800);
          dispatch({ type: 'cyclePanel', key: 'target' });
          // eslint-disable-next-line no-await-in-loop
          await wait(700);
          say('把材料拖出本场 → 引用它的句子当场变成「无出处」');
          // eslint-disable-next-line no-await-in-loop
          await wait(1000);
          actions.toggleCrumb('c4');
          // eslint-disable-next-line no-await-in-loop
          await wait(2400);
          actions.toggleCrumb('c4');
          // eslint-disable-next-line no-await-in-loop
          await wait(1200);
        }
      }

      say('④ 成果 · 原文 vs 成稿');
      await wait(1200);
      dispatch({ type: 'go', screen: 'done' });
      await wait(2600);
      say('④ 诚实的收尾：对上 12/14，剩下 2 条你确实没有');
      if (doneScrollRef.current && jdBoardRef.current) {
        doneScrollRef.current.scrollTo({
          top: jdBoardRef.current.offsetTop - 120, behavior: 'smooth',
        });
      }
      await wait(4200);

      say('⑤ 存回工作区 —— 那段经历变厚了一截');
      actions.finishToDash();
      await wait(3800);
      say('演示结束 · 现在你可以自己点了');
      await wait(2400);
      stop();
    } catch {
      /* 用户接管（Esc / 再点一次按钮），什么都不用做。 */
    }
  }, [dispatch, actions, wait, stop, composerRef, jdBoardRef, doneScrollRef]);

  return { running, caption, start, stop };
}
