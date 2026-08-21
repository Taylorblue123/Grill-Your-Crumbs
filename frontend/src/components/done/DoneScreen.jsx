import { useEffect, useRef } from 'react';
import TopBar from '../shell/TopBar.jsx';
import Stepper from '../shell/Stepper.jsx';
import Segment from '../common/Segment.jsx';
import {
  ARTIFACT, DIMS, EXPERIENCES, HARVEST, TURN_BY_ID,
} from '../../data/demo.js';
import { useDispatch, useStore } from '../../store/StoreContext.jsx';
import {
  buildSheet, crumbById, curTarget, goldCount, reqState,
} from '../../store/selectors.js';
import { useTrackEvent } from '../../hooks/useToast.jsx';
import useActions from '../../hooks/useActions.js';

export default function DoneScreen({ jdBoardRef, scrollRef }) {
  const state = useStore();
  const dispatch = useDispatch();
  const actions = useActions();
  const track = useTrackEvent();
  const crumbs = crumbById(state);
  const target = curTarget(state);
  const localRef = useRef(null);

  const gold = goldCount(state);
  const inferred = ARTIFACT.stats.n_inferred - state.killed.size;
  const ansRounds = state.rounds.filter((r) => r.kind === 'answered').length;
  const flagged = state.rounds.filter((r) => r.kind === 'flagged').length;
  const totalGrill = ARTIFACT.stats.n_grill + state.promoted.size;
  const missing = totalGrill - gold;

  /* 成果页口径：只渲染真正成立的片段，不画灰色骨架。 */
  const sheet = buildSheet(state, { force: true });

  /* 方式 B 没有用户原文，BEFORE 的口径要跟着换：
     不是「你写的 vs 成稿」，而是「材料里本来有的 vs 问出来之后的」。 */
  const fromPick = state.intakeWay === 'pick';
  const pickedExp = EXPERIENCES.find((x) => x.id === state.pickedExp) || EXPERIENCES[0];

  useEffect(() => {
    if (scrollRef) scrollRef.current = localRef.current;
  }, [scrollRef]);

  return (
    <section className="screen on" id="s-done">
      <TopBar nav={<Stepper />}>
        <button type="button" className="gbtn" onClick={() => dispatch({ type: 'go', screen: 'wb' })}>← 回工作台继续问</button>
        <button type="button" className="gbtn" onClick={() => track('export_md')}>导出 Markdown</button>
        <button type="button" className="gbtn pri" onClick={actions.finishToDash}>完成，存进工作区 →</button>
      </TopBar>

      <div className="rv">
        <div className="rv-h">
          <h2>
            {gold ? (
              <>
                同一段经历，
                <em>{`${gold} 处`}</em>
                是刚刚从你嘴里挖出来的——
                <br />
                {`你原来那${fromPick ? '堆材料里' : '  73 个字里'}，一个都没有。`}
              </>
            ) : (
              <>
                你一题都没答，所以成稿里只剩
                <em>材料里本来就有的东西</em>
                。
                <br />
                回工作台答两题，这一栏就会变样。
              </>
            )}
          </h2>
          <div className="legend">
            <span className="lg2">
              <i className="sw s" />
              来自你已有的材料
              {' '}
              <b className="num">{ARTIFACT.stats.n_source}</b>
            </span>
            <span className="lg2 gold">
              <i className="sw g" />
              刚刚从你嘴里挖出来的
              {' '}
              <b className="num">{gold}</b>
            </span>
            <span className="lg2">
              <i className="sw i" />
              AI 补的，请你确认
              {' '}
              <b className="num">{inferred}</b>
            </span>
            <span className="lg2" style={{ borderStyle: 'dashed' }}>悬停任意高亮 → 看它的出处</span>
          </div>
        </div>

        <div className="rv-b" ref={localRef}>
          <div className="panes">
            <div className="pn before">
              <div className="pn-t">
                <span>BEFORE</span>
                {fromPick ? '你的材料里只有这些' : '你自己写的那一版'}
              </div>
              <div className="old">
                {fromPick
                  ? pickedExp.crumbs.map((id) => crumbs[id] && (
                    <div key={id} style={{ marginBottom: 8, fontSize: 13 }}>
                      <b style={{ color: 'var(--fg-mute)', fontSize: 11 }}>{crumbs[id].name}</b>
                      <br />
                      {crumbs[id].text}
                    </div>
                  ))
                  : state.baseline}
              </div>
              <div className="old-note">
                {fromPick ? (
                  <>
                    {`${pickedExp.crumbs.length} 条材料，全是`}
                    <b>事实碎片</b>
                    ：有代码、有事故、有一句吵架记录，
                    <br />
                    但没有一条说清了
                    <b>结局、取舍和你的角色</b>
                    。
                    <br />
                    你一个字都没写，这一整段是问出来的。
                  </>
                ) : (
                  <>
                    {`${state.baseline.length} 个字，零个数字，零个决策，零个困难。`}
                    <br />
                    这不是你写得差——是
                    <b>没人问过你正确的问题</b>
                    。
                  </>
                )}
              </div>
              <div className="bstat">
                <div className="bs"><b className="num">{state.active.size}</b><span>挖到的新事实（条）</span></div>
                <div className="bs"><b className="num">{ansRounds}</b><span>你回答过的轮次</span></div>
                <div className="bs"><b className="num">{flagged}</b><span>被你判为「没意义」</span></div>
                <div className="bs"><b className="num">{inferred}</b><span>还没有出处，等你确认</span></div>
              </div>
            </div>

            <div className="pn">
              <div className="pn-t">
                <span className="aft">AFTER</span>
                {`${ansRounds} 轮拷问之后`}
              </div>
              <div className="sheet">
                <h4>RESUME · EXPERIENCE</h4>
                <div>
                  {sheet.bullets.map((b) => (
                    <div className="bul" key={b.index}>
                      <span className="bd">—</span>
                      <span>{b.segs.map((s, i) => <Segment key={`${b.index}-${i}`} seg={s} panelAware={false} />)}</span>
                    </div>
                  ))}
                  {sheet.promoted.map((p) => (
                    <div className="bul promoted" key={p.id}>
                      <span className="bd">—</span>
                      <span>
                        <Segment seg={p.seg} panelAware={false} />
                        <span className="pbadge">你手动加的</span>
                      </span>
                    </div>
                  ))}
                  {missing > 0 && (
                    <div className="hint" style={{ marginTop: 12 }}>
                      还有
                      {' '}
                      <b>{`${missing} 处`}</b>
                      没挖到，所以这份稿子比它能有的样子薄。
                      <button
                        type="button"
                        className="mini"
                        style={{ marginLeft: 6 }}
                        onClick={() => dispatch({ type: 'go', screen: 'wb' })}
                      >
                        回工作台继续问 →
                      </button>
                    </div>
                  )}
                </div>
                <h4>自我介绍 · 60 秒版</h4>
                <div className="intro">
                  {sheet.intro.map((s, i) => <Segment key={`intro-${i}`} seg={s} panelAware={false} />)}
                </div>
              </div>
              <div className="exports">
                <button type="button" className="gbtn pri" onClick={() => track('copy_artifact')}>复制全文</button>
                <button type="button" className="gbtn" onClick={() => track('export_md')}>导出 Markdown</button>
                <button type="button" className="gbtn" onClick={() => track('save_thread')}>存为我的 Thread</button>
                <small>↑ 这三个按钮的点击率＝唯一的成功度量点</small>
              </div>
            </div>
          </div>

          <div className="harvestboard">
            <div className="hb-h">
              <h3>这一场挖到了什么 · 按维度分组</h3>
              <small>{`共 ${state.active.size} 条新事实，来自 ${ansRounds} 轮回答`}</small>
            </div>
            <div className="hb-b">
              {DIMS.map((k) => {
                const items = [...state.active].filter((id) => HARVEST[id].dim === k);
                return (
                  <div className="hcol" key={k}>
                    <h5>
                      {k}
                      <span className={`b${items.length ? '' : ' zero'} num`}>{items.length}</span>
                    </h5>
                    {items.length ? (
                      <ul>
                        {items.map((id) => {
                          const h = HARVEST[id];
                          return (
                            <li key={id}>
                              <i>◆</i>
                              <span>
                                {h.text}
                                <span className="tagrow" style={{ marginTop: 4 }}>
                                  {h.tags.map((x) => <span className="tg" key={x}>{`#${x}`}</span>)}
                                  <span className="tg src">{`第 ${TURN_BY_ID[h.turn].round} 轮`}</span>
                                  <span className="tg">{`→ ${state.promoted.has(id) ? '简历（你加的）' : h.dest}`}</span>
                                </span>
                              </span>
                            </li>
                          );
                        })}
                      </ul>
                    ) : (
                      <p className="none">这一维度这次没挖到——不是“完成度 0%”，是这场没问到。</p>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* 诚实的收尾：对上几条、剩下的哪几条是你确实没有的 */}
          {target && (() => {
            const matched = target.reqs.filter((r) => reqState(r, state.active) === 'ok');
            const gaps = target.reqs.filter((r) => reqState(r, state.active) === 'gap');
            const left = target.reqs.filter((r) => ['none', 'weak'].includes(reqState(r, state.active)));
            return (
              <div className="jdboard" ref={jdBoardRef}>
                <div className="hb-h">
                  <h3>{`对上这个 JD 了吗 · ${target.title}`}</h3>
                  <small>{`${target.org} · 共 ${target.reqs.length} 条要求`}</small>
                </div>
                <div className="jdb-b">
                  <div className="jdcol">
                    <h5>
                      对上了
                      <span
                        className="b"
                        style={{
                          background: 'var(--blue-bg)',
                          color: 'var(--blue-ink)',
                          border: '1px solid var(--blue-bd)',
                        }}
                      >
                        {matched.length}
                      </span>
                    </h5>
                    <ul>
                      {matched.map((r) => {
                        const hit = (r.fills || []).find((h) => state.active.has(h));
                        return (
                          <li key={r.id}>
                            <i style={{ color: 'var(--blue)' }}>✓</i>
                            <span>
                              {r.text}
                              {hit
                                ? <span className="tg dim">{`第 ${TURN_BY_ID[HARVEST[hit].turn].round} 轮挖到的`}</span>
                                : <span className="tg src">材料里本来就有</span>}
                            </span>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                  <div className="jdcol">
                    <h5>
                      还没补上
                      <span className="b" style={{ background: 'var(--sunk2)', color: 'var(--fg-mute)' }}>
                        {left.length}
                      </span>
                    </h5>
                    {left.length ? (
                      <ul>
                        {left.map((r) => (
                          <li key={r.id}>
                            <i>○</i>
                            <span>
                              {r.text}
                              <span className="tg">问得出来 · 回工作台</span>
                            </span>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="hcol none" style={{ fontStyle: 'italic', color: 'var(--fg-mute)', fontSize: 11.5 }}>
                        能问出来的都问完了。
                      </p>
                    )}
                  </div>
                  <div className="honest">
                    <b>{`这份稿子对上了 ${matched.length} / ${target.reqs.length} 条。`}</b>
                    {`剩下 ${target.reqs.length - matched.length} 条里，有 `}
                    <b>{`${gaps.length} 条是你确实没有的`}</b>
                    {`：${gaps.map((r) => `「${r.text}」`).join('、')}。`}
                    <br />
                    我们
                    <b>没有替你圆这几条</b>
                    ——市面上按 JD 改简历的工具会给你编一句出来。
                    把它留在这儿，是因为你需要知道自己真正缺什么：那是去补技能的信号，不是去补文案的信号。
                  </div>
                </div>
              </div>
            );
          })()}

          {/* 明确的收尾动线：不要把人留在死胡同里 */}
          <div className="landing-strip">
            <div className="m">
              <h4>这一场就到这儿。接下来去哪？</h4>
              <p>
                这一场挖到的
                {' '}
                <b className="num">{state.active.size}</b>
                {' '}
                条事实会挂到
                <b>「校园二手交易平台 · 推荐系统」</b>
                这段经历下面，产出物也挂在它下面。
                <br />
                这段经历因此变厚了一截——下次写别的简历直接从它取料，不用把同样的问题再答一遍。
              </p>
            </div>
            <div className="a">
              <button type="button" className="btn" onClick={actions.finishToDash}>完成，存进工作区 →</button>
              <button type="button" className="btn ghost" onClick={() => dispatch({ type: 'go', screen: 'wb' })}>再问几轮</button>
              <button type="button" className="btn ghost" onClick={() => dispatch({ type: 'go', screen: 'setup' })}>换一段经历再来一场</button>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
