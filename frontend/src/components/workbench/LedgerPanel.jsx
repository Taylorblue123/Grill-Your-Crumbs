import { useEffect, useState } from 'react';
import Panel from './Panel.jsx';
import { HARVEST, TURN_BY_ID } from '../../data/demo.js';
import { useDispatch, useStore } from '../../store/StoreContext.jsx';
import { isCandidate, ledgerGroups } from '../../store/selectors.js';
import { useUi } from '../../hooks/useUi.jsx';
import useActions from '../../hooks/useActions.js';

/* ============================================================
   面板 ④ 收获账本（原「Thread 成果」已并入）

   栏目 = matrices，可按维度也可按标签。按维度是固定六栏——空栏保留，
   因为「这场没问到这个角度」本身是信息，不是「完成度 0%」。
   每条只标「第 N 轮 ↗」，不复述问题：问题原文在左边拷问栏，这里不抄第二遍。
   ============================================================ */
export default function LedgerPanel({ mode, onCycle, onMax }) {
  const state = useStore();
  const dispatch = useDispatch();
  const actions = useActions();
  const ui = useUi();
  const groups = ledgerGroups(state);
  const [open, setOpen] = useState(() => new Set());

  /* 新落账的事实所在的栏目自动展开——刚挖到的东西不该藏在折叠里。 */
  useEffect(() => {
    if (!state.lastHarvest.length) return;
    setOpen((cur) => {
      const next = new Set(cur);
      state.lastHarvest.forEach((id) => {
        next.add(state.ledgerKey === 'dim' ? HARVEST[id].dim : HARVEST[id].tags[0]);
        if (state.ledgerKey === 'tag') HARVEST[id].tags.forEach((t) => next.add(t));
      });
      return next;
    });
  }, [state.lastHarvest, state.ledgerKey]);

  const toggleGroup = (k) => setOpen((cur) => {
    const next = new Set(cur);
    if (next.has(k)) next.delete(k); else next.add(k);
    return next;
  });

  const hasAny = groups.some(([, list]) => list.length);

  return (
    <Panel
      id="p-ledger"
      tone
      mode={mode}
      icon="◱"
      label="收获账本"
      minCount={state.active.size}
      title="收获账本"
      count={state.active.size}
      countHot
      onCycle={onCycle}
      onMax={onMax}
      headerExtra={(
        <div className="lgKey" style={{ marginRight: 4 }}>
          <button
            type="button"
            className={state.ledgerKey === 'dim' ? 'on' : ''}
            onClick={() => dispatch({ type: 'setLedgerKey', key: 'dim' })}
          >
            按维度
          </button>
          <button
            type="button"
            className={state.ledgerKey === 'tag' ? 'on' : ''}
            onClick={() => dispatch({ type: 'setLedgerKey', key: 'tag' })}
          >
            按标签
          </button>
        </div>
      )}
      footer={<small>每条只标它来自第几轮 —— 问题本身在左边拷问栏，不重复一遍</small>}
    >
      <div className="ledger">
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '0 2px 9px' }}>
          <span className="lgHint" style={{ padding: 0 }}>
            {state.ledgerKey === 'dim' ? (
              <>按<b>维度</b>分栏。空栏＝这场还没问到那个角度，不是「完成度 0%」。</>
            ) : (
              <>按<b>标签</b>分栏。同一条事实可以同时出现在几个标签下。</>
            )}
          </span>
        </div>

        {!hasAny ? (
          <p className="lgHint">
            还没有收获。
            <br />
            每答完一题，这里按栏目长出可数的条目——
            <b>问题本身在左边拷问栏，这里不重复一遍</b>
            。
          </p>
        ) : groups.map(([k, list]) => {
          const isOpen = list.length > 0 && (open.has(k) || open.size === 0);
          return (
            <div className={`lgroup${list.length ? '' : ' empty'}${isOpen ? ' open' : ''}`} key={k}>
              <button type="button" className="lg-h" onClick={() => toggleGroup(k)}>
                <span className="caret">▶</span>
                <span className="k">{k}</span>
                <span className={`b${list.length ? ' has' : ''} num`}>{list.length}</span>
              </button>
              <div className="lg-b">
                {list.map((id) => {
                  const h = HARVEST[id];
                  const turn = TURN_BY_ID[h.turn];
                  const cand = isCandidate(state, id);
                  const dest = state.promoted.has(id) ? '简历（你加的）' : h.dest;
                  const born = state.lastHarvest.includes(id);
                  const tags = state.ledgerKey === 'dim' ? h.tags : [h.dim, ...h.tags];
                  return (
                    <div
                      className={`item${cand ? ' cand' : ''}${born ? ' born' : ''}`}
                      key={id}
                      draggable={cand}
                      onDragStart={(e) => {
                        if (!cand) return;
                        e.dataTransfer.setData('text/plain', `fact:${id}`);
                        e.dataTransfer.effectAllowed = 'copy';
                        dispatch({ type: 'openPanel', key: 'draft' });
                      }}
                    >
                      {cand && <span className="grip2">⠿</span>}
                      <div className="tx">{h.text}</div>
                      <div className="tagrow">
                        {tags.map((x, i) => (
                          <span
                            className={`tg${state.ledgerKey === 'tag' && i === 0 ? ' dim' : ''}`}
                            key={x}
                          >
                            {`#${x}`}
                          </span>
                        ))}
                      </div>
                      <div className="meta">
                        <button type="button" title="跳到左边那一轮" onClick={() => { dispatch({ type: 'openPanel', key: 'grill' }); ui.requestPeek(h.turn); }}>
                          {`第 ${turn.round} 轮 ↗`}
                        </button>
                        <span className="s">·</span>
                        <span className="dest">{`→ ${dest}`}</span>
                        {cand && (
                          <>
                            <span className="s">·</span>
                            <button type="button" className="add" onClick={() => actions.promote(id)}>拖进简历 ＋</button>
                          </>
                        )}
                        <span className="s">·</span>
                        <button type="button" className="undo" onClick={() => actions.dropItem(id)}>撤回</button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </Panel>
  );
}
