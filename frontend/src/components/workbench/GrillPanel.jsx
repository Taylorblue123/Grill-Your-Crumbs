import { useEffect, useLayoutEffect, useRef } from 'react';
import Panel from './Panel.jsx';
import Composer from './Composer.jsx';
import RichText from '../common/RichText.jsx';
import { HARVEST, TURNS, isCand } from '../../data/demo.js';
import { useDispatch, useStore } from '../../store/StoreContext.jsx';
import { curTarget } from '../../store/selectors.js';
import { useToast } from '../../hooks/useToast.jsx';
import { useHighlight, useUi } from '../../hooks/useUi.jsx';
import useActions from '../../hooks/useActions.js';

/* ============================================================
   面板 ② 拷问：一次一问

   每张问题卡都要能回答「你凭什么问我这个」——所以卡上常驻三块：
     grip   我对这块的把握，用「几条材料提到过」表达，不是裸百分比
     why    我为什么问这个，必须指向具体某一条材料
     guess  我的猜测，点头就行，不用从头写
   ============================================================ */
export default function GrillPanel({ mode, onCycle, onMax, composerRef }) {
  const state = useStore();
  const dispatch = useDispatch();
  const { show } = useToast();
  const ui = useUi();
  const highlight = useHighlight();
  const actions = useActions();
  const bodyRef = useRef(null);
  const target = curTarget(state);

  const done = state.cursor >= TURNS.length;
  const t = done ? null : TURNS[state.cursor];
  const dead = t?.status === 'flagged_useless';

  /* 新内容永远贴着底部 —— 拷问是一条向下生长的时间线。 */
  useLayoutEffect(() => {
    if (bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
  }, [state.rounds.length, state.cursor, state.pending?.showHarvest]);

  /* 账本里点「第 N 轮 ↗」→ 把那一轮滚到视野中央并高亮，而不是把问题再抄一遍。 */
  useEffect(() => {
    if (!ui.peek) return;
    const ti = TURNS.findIndex((x) => x.id === ui.peek.turnId);
    const node = bodyRef.current?.querySelector(`[data-ti="${ti}"]`)
      || (state.cursor === ti ? bodyRef.current?.querySelector('.qcard') : null);
    highlight(node, { style: 'tint', ms: 1400 });
  }, [ui.peek, highlight, state.cursor]);

  const showRefs = (ids) => {
    dispatch({ type: 'openPanel', key: 'crumbs' });
    ui.setAimed(ids);
    show(`高亮了 ${ids.length} 条材料 —— 它就是靠这几条判断自己有没有把握。`);
  };

  return (
    <Panel
      id="p-grill"
      mode={mode}
      icon="◈"
      label="拷问"
      minCount={state.rounds.length}
      title="GRILL · 一次一问"
      count={`${Math.min(state.cursor, TURNS.length)} / ${TURNS.length}`}
      onCycle={onCycle}
      onMax={onMax}
      bodyClassName="panel-b mid-b"
      bodyRef={bodyRef}
      afterBody={<Composer ref={composerRef} />}
    >
      {state.rounds.map((r) => {
        const turn = TURNS[r.ti];
        const sub = r.kind === 'flagged' ? '你判定：这问题没意义 → 已记为负样本'
          : r.kind === 'skipped' ? '（跳过）' : r.text;
        return (
          <div className={`past${r.kind === 'flagged' ? ' dead' : ''}`} data-ti={r.ti} key={r.ti}>
            <button type="button" className="pu" onClick={() => actions.undoRound(r.ti)}>撤回这一轮</button>
            <div className="pq">{`第 ${turn.round} 轮 · ${turn.question}`}</div>
            <div className="pa">{sub}</div>
          </div>
        );
      })}

      {done ? (
        <div className="finish">
          <h4>问完了。右边那份稿子，就是刚才这几轮的产物。</h4>
          <p>没有“揭晓”动作——因为你一路都看着它长出来。</p>
          <div style={{
            marginTop: 14, display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap',
          }}
          >
            <button type="button" className="act go" onClick={() => dispatch({ type: 'go', screen: 'done' })}>看成果 →</button>
            <button type="button" className="act" onClick={actions.undo}>撤回上一轮</button>
          </div>
        </div>
      ) : (
        <>
          <div className="qcard">
            <div className="qc-h">
              <span className="dimtag">{t.dim}</span>
              {`第 ${t.round} 轮 · 共 ${TURNS.length} 轮`}
              <span style={{ marginLeft: 'auto' }}>
                <span className={`qsrc ${t.src}`}>
                  {t.src === 'jd' && target ? 'JD 缺口驱动' : '通用维度'}
                </span>
              </span>
            </div>
            <div className="qc-b">
              <div className="q">{t.question}</div>
              <div className="grip">
                <span className={`lv${t.grip.lv === '中' ? ' mid' : ''}`}>{`把握 ${t.grip.lv}`}</span>
                <RichText className="ev" html={t.grip.ev} />
                {t.grip.refs.length > 0 && (
                  <button type="button" className="ref" onClick={() => showRefs(t.grip.refs)}>
                    {`看是哪 ${t.grip.refs.length} 条 →`}
                  </button>
                )}
              </div>

              {!dead && t.jdLine && target && t.src === 'jd' && (
                <div className="jdwhy">
                  <span className="h6">这一题是 JD 逼出来的</span>
                  <RichText html={t.jdLine} />
                </div>
              )}
              {!dead && t.src === 'general' && target && (
                <div
                  className="jdwhy"
                  style={{
                    borderLeftColor: 'var(--gold)',
                    background: 'var(--gold-bg)',
                    color: 'var(--gold-ink)',
                  }}
                >
                  <span className="h6" style={{ color: 'var(--gold)' }}>这一题不是 JD 逼出来的</span>
                  <RichText html={t.jdLine || '预算里留了 2 轮打「只有你有」的东西——只盯着 JD 会把你身上最独特的部分漏掉。'} />
                </div>
              )}

              {!dead && (
                <>
                  <div className="why">
                    <b>我为什么问这个</b>
                    {t.why}
                  </div>
                  <div className="guess">
                    <b>我的猜测 · 点头就行，不用从头写</b>
                    <div className="gbox">{t.guess}</div>
                  </div>
                </>
              )}

              {/* 正在落地的这一轮：用户原话 + 拆出了什么 */}
              {state.pending && state.pending.ti === state.cursor && (
                <div className="ublock">
                  <button type="button" className="uu" onClick={actions.undo}>撤回</button>
                  <div className="uh">
                    <span className="av">你</span>
                    你的回答
                  </div>
                  <div className="ut">{state.pending.text}</div>
                  {state.pending.showHarvest && (
                    <div className="harv">
                      <span className="hl">{`拆出 ${state.pending.ids.length} 条 →`}</span>
                      {state.pending.ids.map((id) => (
                        <span className="tg dim" key={id}>{`#${HARVEST[id].dim}`}</span>
                      ))}
                      {state.pending.ids.filter(isCand).length > 0 && (
                        <span className="tg">{`${state.pending.ids.filter(isCand).length} 条列为候补`}</span>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          {!state.pending && (
            <div className="acts">
              {dead ? (
                <>
                  <button
                    type="button"
                    className="act bad"
                    style={{
                      background: 'var(--red-bg)',
                      borderColor: 'var(--red-bd)',
                      color: 'var(--red)',
                      fontWeight: 600,
                    }}
                    onClick={actions.flagBad}
                  >
                    这问题没意义 ✕
                  </button>
                  <button type="button" className="act" onClick={actions.skip}>跳过这题</button>
                </>
              ) : (
                <>
                  <button type="button" className="act go" onClick={() => composerRef.current?.startAnswer()}>我来补充</button>
                  <button type="button" className="act" onClick={() => composerRef.current?.acceptGuess()}>就按你猜的算</button>
                  <button type="button" className="act" onClick={actions.skip}>跳过这题</button>
                  <button type="button" className="act bad" onClick={actions.flagBad}>这问题没意义</button>
                </>
              )}
            </div>
          )}

          {target && (
            <div className="budget">
              <span>
                提问预算
                {' '}
                <b>4 : 2</b>
                （JD 缺口 : 只有你有）
              </span>
              <span className="bseg">
                {TURNS.map((tn, i) => (
                  <i
                    key={tn.id}
                    className={`bs2 ${tn.src === 'jd' ? 'jd' : 'gen'}${i >= state.cursor ? ' pend' : ''}`}
                    title={`第 ${tn.round} 轮 · ${tn.src === 'jd' ? 'JD 驱动' : '通用维度'}`}
                  />
                ))}
              </span>
              <span>
                {`已用 ${state.rounds.filter((r) => TURNS[r.ti].src === 'jd').length} : ${
                  state.rounds.filter((r) => TURNS[r.ti].src === 'general').length}`}
              </span>
            </div>
          )}
        </>
      )}
    </Panel>
  );
}
