/* ============================================================
   面板 ②：拷问。一次一问。

   每张问题卡带三样东西，缺一不可：
     · 把握度 —— 不是裸百分比，是「材料里有几条提到过」，可数、可点
     · 我为什么问这个 —— 理由必须指向具体某几条材料
     · 我的猜测 —— 点头就行，不用从头写
   ============================================================ */
import { useEffect, useRef } from 'react';
import Panel from './Panel';
import Composer from './Composer';
import RichText from '../common/RichText';
import { useSession } from '../../state/SessionContext';
import { useToast } from '../../state/ToastContext';
import { useUI } from '../../state/UIContext';

export default function GrillPanel({ panels, composerRef, tip, onTip, onSend, onGoToResult }) {
  const { state, target, budget, actions } = useSession();
  const { push: toast } = useToast();
  const { setAimedCrumbIds } = useUI();
  const bodyRef = useRef(null);

  const finished = state.cursor >= budget;
  const turn = finished ? null : state.turns[state.cursor];
  const dead = turn?.status === 'flagged_useless';

  /* 每答一题就滚到底，让新问题落在视野里。 */
  useEffect(() => {
    const body = bodyRef.current;
    if (body) body.scrollTop = body.scrollHeight;
  }, [state.cursor, state.pending?.harvestShown]);

  useEffect(() => {
    onTip(
      finished
        ? { text: '问完了。也可以撤回任意一轮，稿子会跟着回退。', hot: false }
        : dead
          ? { text: '这一轮它问砸了——点「这问题没意义」，它会承认并换一个。', hot: false }
          : { text: '想自己说？直接在下面的输入框里写，回车发送。', hot: false },
    );
  }, [finished, dead, onTip]);

  async function fillAnswer() {
    if (!turn) return;
    onTip({ text: '正在把你的回答打进输入框…（演示：真实产品里这里是你自己敲）', hot: true });
    await composerRef.current?.typeInto(turn.answer);
    onTip({ text: '写好了 → 按「发送」，或者继续改。', hot: true });
  }

  async function acceptGuess() {
    if (!turn) return;
    onTip({ text: '把它的猜测填进输入框——你可以直接发，也可以先改两个字。', hot: true });
    const text = await composerRef.current?.typeInto(turn.guess.replace(/[？?]$/, '，对。'));
    actions.answer(text);
    composerRef.current?.clear();
  }

  const askedKinds = state.rounds.map((r) => state.turns[r.ti].src);

  return (
    <Panel
      id="grill"
      icon="◈"
      count={state.rounds.length}
      title="GRILL · 一次一问"
      headCount={`${Math.min(state.cursor, budget)} / ${budget}`}
      panels={panels}
      bodyClassName="panel-b mid-b"
      bodyRef={bodyRef}
      afterBody={
        <Composer
          ref={composerRef}
          tip={tip.text}
          hot={tip.hot}
          disabled={finished || Boolean(state.pending)}
          onSend={onSend}
        />
      }
    >
      <div data-testid="grill-history">
        {state.rounds.map((round) => {
          const t = state.turns[round.ti];
          const sub =
            round.kind === 'flagged'
              ? '你判定：这问题没意义 → 已记为负样本'
              : round.kind === 'skipped'
                ? '（跳过）'
                : round.text;
          return (
            <div
              className={`past${round.kind === 'flagged' ? ' dead' : ''}`}
              data-ti={round.ti}
              key={`${round.ti}-${round.kind}`}
            >
              <button type="button" className="pu" onClick={() => actions.undoRound(round.ti)}>
                撤回这一轮
              </button>
              <div className="pq">
                第 {t.round} 轮 · {t.question}
              </div>
              <div className="pa">{sub}</div>
            </div>
          );
        })}
      </div>

      {finished ? (
        <div className="finish" data-testid="grill-finished">
          <h4>问完了。右边那份稿子，就是刚才这几轮的产物。</h4>
          <p>没有“揭晓”动作——因为你一路都看着它长出来。</p>
          <div style={{ marginTop: 14, display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap' }}>
            <button type="button" className="act go" onClick={onGoToResult}>
              看成果 →
            </button>
            <button type="button" className="act" onClick={actions.undo}>
              撤回上一轮
            </button>
          </div>
        </div>
      ) : (
        <>
          <div className="qcard" data-testid="question-card">
            <div className="qc-h">
              <span className="dimtag">{turn.dim}</span>第 {turn.round} 轮 · 共 {budget} 轮
              <span style={{ marginLeft: 'auto' }}>
                <span className={`qsrc ${turn.src}`}>
                  {turn.src === 'jd' && target ? 'JD 缺口驱动' : '通用维度'}
                </span>
              </span>
            </div>
            <div className="qc-b">
              <div className="q">{turn.question}</div>

              <div className="grip">
                <span className={`lv${turn.grip.lv === '中' ? ' mid' : ''}`}>
                  把握 {turn.grip.lv}
                </span>
                <span className="ev">
                  <RichText text={turn.grip.ev} />
                </span>
                {turn.grip.refs.length ? (
                  <button
                    type="button"
                    className="ref"
                    onClick={() => {
                      panels.openPanel('crumbs');
                      setAimedCrumbIds(turn.grip.refs);
                      toast(
                        `高亮了 ${turn.grip.refs.length} 条材料 —— 它就是靠这几条判断自己有没有把握。`,
                      );
                    }}
                  >
                    看是哪 {turn.grip.refs.length} 条 →
                  </button>
                ) : null}
              </div>

              {!dead && turn.jdLine && target && turn.src === 'jd' ? (
                <div className="jdwhy">
                  <span className="h6">这一题是 JD 逼出来的</span>
                  <RichText text={turn.jdLine} />
                </div>
              ) : null}
              {!dead && turn.src === 'general' && target ? (
                <div
                  className="jdwhy"
                  style={{
                    borderLeftColor: 'var(--gold)',
                    background: 'var(--gold-bg)',
                    color: 'var(--gold-ink)',
                  }}
                >
                  <span className="h6" style={{ color: 'var(--gold)' }}>
                    这一题不是 JD 逼出来的
                  </span>
                  <RichText
                    text={
                      turn.jdLine ||
                      '预算里留了 2 轮打「只有你有」的东西——只盯着 JD 会把你身上最独特的部分漏掉。'
                    }
                  />
                </div>
              ) : null}

              {dead ? null : (
                <>
                  <div className="why">
                    <b>我为什么问这个</b>
                    {turn.why}
                  </div>
                  <div className="guess">
                    <b>我的猜测 · 点头就行，不用从头写</b>
                    <div className="gbox">{turn.guess}</div>
                  </div>
                </>
              )}

              {state.pending ? (
                <div className="ublock" data-testid="pending-answer">
                  <button type="button" className="uu" onClick={actions.undo}>
                    撤回
                  </button>
                  <div className="uh">
                    <span className="av" aria-hidden="true">
                      你
                    </span>
                    你的回答
                  </div>
                  <div className="ut">{state.pending.text}</div>
                  {state.pending.harvestShown ? (
                    <div className="harv">
                      <span className="hl">拆出 {state.pending.factIds.length} 条 →</span>
                      {state.pending.factIds.map((id) => (
                        <span className="tg dim" key={id}>
                          #{state.harvest[id].dim}
                        </span>
                      ))}
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>
          </div>

          {state.pending ? null : (
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
                  <button type="button" className="act" onClick={actions.skip}>
                    跳过这题
                  </button>
                </>
              ) : (
                <>
                  <button type="button" className="act go" onClick={fillAnswer}>
                    我来补充
                  </button>
                  <button type="button" className="act" onClick={acceptGuess}>
                    就按你猜的算
                  </button>
                  <button type="button" className="act" onClick={actions.skip}>
                    跳过这题
                  </button>
                  <button type="button" className="act bad" onClick={actions.flagBad}>
                    这问题没意义
                  </button>
                </>
              )}
            </div>
          )}

          {target ? (
            <div className="budget">
              <span>
                提问预算 <b>4 : 2</b>（JD 缺口 : 只有你有）
              </span>
              <span className="bseg">
                {state.turns.slice(0, budget).map((tn, i) => (
                  <i
                    className={`bs2 ${tn.src === 'jd' ? 'jd' : 'gen'}${i >= state.cursor ? ' pend' : ''}`}
                    key={tn.id}
                    title={`第 ${tn.round} 轮 · ${tn.src === 'jd' ? 'JD 驱动' : '通用维度'}`}
                  />
                ))}
              </span>
              <span>
                已用 {askedKinds.filter((x) => x === 'jd').length} :{' '}
                {askedKinds.filter((x) => x === 'general').length}
              </span>
            </div>
          ) : null}
        </>
      )}
    </Panel>
  );
}
