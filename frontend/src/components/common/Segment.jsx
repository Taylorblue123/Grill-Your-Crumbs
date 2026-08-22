import { useCallback } from 'react';
import { HARVEST, SOURCE_ICON, SOURCE_LABEL, TURN_BY_ID } from '../../data/demo.js';
import { useDispatch, useStore } from '../../store/StoreContext.jsx';
import { crumbById } from '../../store/selectors.js';
import { useUi } from '../../hooks/useUi.jsx';

/* ============================================================
   三色出处片段

     蓝 source   来自你已有的材料 —— 材料被移出本场就降级成「出处已移出」
     金 grill    刚从你嘴里挖出来的 —— 依赖的事实一撤回就退回灰色骨架
     红 inferred AI 补的，指不出出处，旁边就是「删掉这条」

   悬停任意片段 → 弹出它的出处，并高亮左边对应的材料卡。
   ============================================================ */
export default function Segment({ seg, panelAware = true }) {
  const state = useStore();
  const dispatch = useDispatch();
  const ui = useUi();
  const crumbs = crumbById(state);

  const handleEnter = useCallback((e) => {
    const node = e.currentTarget;
    if (seg.o === 'grill') {
      if (!seg.on) { ui.hidePop(); return; }
      const turn = TURN_BY_ID[seg.turn];
      ui.setAimed([]);
      ui.showPop({
        kind: 'grill',
        title: `🔥 第 ${turn.round} 轮 · ${turn.id} · 你的原话`,
        body: turn.answer,
        facts: seg.hs.map((h) => HARVEST[h].text),
      }, node);
      return;
    }
    if (seg.o === 'inferred') {
      ui.setAimed([]);
      ui.showPop({ kind: 'inferred', title: '⚠ 无出处', body: seg.note }, node);
      return;
    }
    const c = crumbs[seg.ref];
    if (!c) return;
    ui.setAimed([seg.ref]);
    if (panelAware && state.screen === 'wb') dispatch({ type: 'openPanel', key: 'crumbs' });
    ui.showPop({
      kind: 'source',
      title: `${SOURCE_ICON[c.type]} ${c.name} · ${SOURCE_LABEL[c.type]} · ${c.id}`,
      body: c.text,
      gone: !state.sessionCrumbs.has(c.id),
    }, node);
  }, [seg, crumbs, state.screen, state.sessionCrumbs, ui, dispatch, panelAware]);

  const handleLeave = useCallback(() => {
    ui.hidePop();
    ui.setAimed([]);
  }, [ui]);

  const common = { onMouseEnter: handleEnter, onMouseLeave: handleLeave };

  if (seg.o === 'grill') {
    return (
      <>
        <span className={`sg grill${seg.on ? '' : ' ghost'}`} {...common}>{seg.t}</span>
        {' '}
      </>
    );
  }
  if (seg.o === 'inferred') {
    return (
      <>
        <span className="sg inferred" {...common}>
          {seg.t}
          {seg.verified === false && <span className="badge">无出处</span>}
        </span>
        {' '}
      </>
    );
  }
  return (
    <>
      <span className={`sg source${seg.orphan ? ' orphan' : ''}`} {...common}>
        {seg.t}
        {seg.orphan && <span className="badge">出处已移出</span>}
      </span>
      {' '}
    </>
  );
}
