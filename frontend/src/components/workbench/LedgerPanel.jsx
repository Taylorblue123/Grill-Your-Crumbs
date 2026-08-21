/* ============================================================
   面板 ④：收获账本（Thread 成果已并入）。

   两个刻意的决定：
     · 每条只标「第 N 轮 ↗」，不复述问题本身 —— 问题在左边拷问栏，
       抄一遍就是把同一份数据显示两次。
     · 空栏保留：「这场没问到这个角度」本身是信息，不是完成度 0%。
   ============================================================ */
import { useEffect, useState } from 'react';
import Panel from './Panel';
import { LEDGER_KEYS, factDestination, ledgerTags } from '../../domain/ledger';
import { useSession } from '../../state/SessionContext';

function LedgerItem({ id, fact, ledgerKey, round, isCandidate, destination, onPeek, onPromote, onDrop, onDragStart }) {
  return (
    <div
      className={`item${isCandidate ? ' cand' : ''}`}
      data-i={id}
      draggable={isCandidate}
      onDragStart={isCandidate ? onDragStart : undefined}
    >
      {isCandidate ? (
        <span className="grip2" aria-hidden="true">
          ⠿
        </span>
      ) : null}
      <div className="tx">{fact.text}</div>
      <div className="tagrow">
        {ledgerTags(fact, ledgerKey).map((tag, index) => (
          <span className={`tg${ledgerKey === LEDGER_KEYS.TAG && index === 0 ? ' dim' : ''}`} key={tag}>
            #{tag}
          </span>
        ))}
      </div>
      <div className="meta">
        <button type="button" onClick={onPeek} title="跳到左边那一轮">
          第 {round} 轮 ↗
        </button>
        <span className="s">·</span>
        <span className="dest">→ {destination}</span>
        {isCandidate ? (
          <>
            <span className="s">·</span>
            <button type="button" className="add" onClick={onPromote}>
              拖进简历 ＋
            </button>
          </>
        ) : null}
        <span className="s">·</span>
        <button type="button" className="undo" onClick={onDrop}>
          撤回
        </button>
      </div>
    </div>
  );
}

export default function LedgerPanel({ panels, onPeekTurn, onDragStateChange }) {
  const { state, ledgerGroups, promotedFacts, isCandidate, actions } = useSession();
  const [open, setOpen] = useState({});

  /* 新挖到的事实所在的栏自动展开 —— 用户刚答完，得看见它落在哪。 */
  useEffect(() => {
    if (!state.pending?.factIds?.length) return;
    setOpen((current) => {
      const next = { ...current };
      state.pending.factIds.forEach((id) => {
        const fact = state.harvest[id];
        if (state.ledgerKey === LEDGER_KEYS.DIM) next[fact.dim] = true;
        else fact.tags.forEach((tag) => { next[tag] = true; });
      });
      return next;
    });
  }, [state.pending?.factIds, state.harvest, state.ledgerKey]);

  const hasAny = state.activeIds.length > 0;

  return (
    <Panel
      id="ledger"
      tone
      icon="◱"
      count={state.activeIds.length}
      title="收获账本"
      headCount={state.activeIds.length}
      headExtra={{
        hot: true,
        node: (
          <div className="lgKey" style={{ marginRight: 4 }} role="group" aria-label="账本分栏方式">
            <button
              type="button"
              className={state.ledgerKey === LEDGER_KEYS.DIM ? 'on' : ''}
              aria-pressed={state.ledgerKey === LEDGER_KEYS.DIM}
              onClick={() => actions.setLedgerKey(LEDGER_KEYS.DIM)}
            >
              按维度
            </button>
            <button
              type="button"
              className={state.ledgerKey === LEDGER_KEYS.TAG ? 'on' : ''}
              aria-pressed={state.ledgerKey === LEDGER_KEYS.TAG}
              onClick={() => actions.setLedgerKey(LEDGER_KEYS.TAG)}
            >
              按标签
            </button>
          </div>
        ),
      }}
      panels={panels}
      footer={<small>每条只标它来自第几轮 —— 问题本身在左边拷问栏，不重复一遍</small>}
    >
      <div className="ledger" data-testid="ledger">
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '0 2px 9px' }}>
          <span className="lgHint" style={{ padding: 0 }}>
            {state.ledgerKey === LEDGER_KEYS.DIM ? (
              <>
                按<b>维度</b>分栏。空栏＝这场还没问到那个角度，不是「完成度 0%」。
              </>
            ) : (
              <>
                按<b>标签</b>分栏。同一条事实可以同时出现在几个标签下。
              </>
            )}
          </span>
        </div>

        {hasAny ? (
          ledgerGroups.map(([key, ids]) => {
            const isOpen = ids.length > 0 && (open[key] ?? true);
            return (
              <div
                className={`lgroup${ids.length ? '' : ' empty'}${isOpen ? ' open' : ''}`}
                data-k={key}
                key={key}
              >
                <button
                  type="button"
                  className="lg-h"
                  aria-expanded={isOpen}
                  onClick={() => setOpen((c) => ({ ...c, [key]: !(c[key] ?? true) }))}
                >
                  <span className="caret" aria-hidden="true">
                    ▶
                  </span>
                  <span className="k">{key}</span>
                  <span className={`b${ids.length ? ' has' : ''} num`}>{ids.length}</span>
                </button>
                <div className="lg-b">
                  {ids.map((id) => {
                    const fact = state.harvest[id];
                    const round = state.turns.find((t) => t.id === fact.turn)?.round;
                    const cand = isCandidate(id) && !promotedFacts.has(id);
                    return (
                      <LedgerItem
                        key={id}
                        id={id}
                        fact={fact}
                        ledgerKey={state.ledgerKey}
                        round={round}
                        isCandidate={cand}
                        destination={factDestination(id, state.harvest, promotedFacts)}
                        onPeek={() => onPeekTurn(fact.turn)}
                        onPromote={() => actions.promote(id)}
                        onDrop={() => actions.dropFact(id)}
                        onDragStart={(event) => {
                          event.dataTransfer.setData('text/plain', `fact:${id}`);
                          event.dataTransfer.effectAllowed = 'copy';
                          onDragStateChange(true);
                          panels.openPanel('draft');
                        }}
                      />
                    );
                  })}
                </div>
              </div>
            );
          })
        ) : (
          <p className="lgHint">
            还没有收获。
            <br />
            每答完一题，这里按栏目长出可数的条目——<b>问题本身在左边拷问栏，这里不重复一遍</b>。
          </p>
        )}
      </div>
    </Panel>
  );
}
