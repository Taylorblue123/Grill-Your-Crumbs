/* ④ 成果。原文和成稿并排；然后明确把人送回工作区，不留在死胡同里。 */
import { useNavigate } from 'react-router-dom';
import TopBar from '../components/shell/TopBar';
import Screen from '../components/shell/Screen';
import Stepper from '../components/shell/Stepper';
import Segment from '../components/common/Segment';
import { sourceIcons } from '../api';
import { reqState } from '../domain/target';
import { useCrumbLibrary } from '../state/CrumbLibraryContext';
import { useSession } from '../state/SessionContext';
import { useToast } from '../state/ToastContext';
import { useProvenancePopover } from '../hooks/useProvenancePopover';
import { ROUTES } from '../routes';

export default function DonePage() {
  const navigate = useNavigate();
  const { state, finalDraft, target, activeFacts, promotedFacts, gold, actions } = useSession();
  const { byId } = useCrumbLibrary();
  const { push: toast } = useToast();
  const { buildPopover } = useProvenancePopover();

  if (!finalDraft) return null;

  const inferred = state.artifact.stats.n_inferred - state.killedBullets.length;
  const answered = state.rounds.filter((r) => r.kind === 'answered').length;
  const flagged = state.rounds.filter((r) => r.kind === 'flagged').length;
  const totalGrill = state.artifact.stats.n_grill + promotedFacts.size;
  const missing = totalGrill - gold;
  const fromZero = state.baseId === 'b3';
  const firstPlan = state.plan[0];

  const matched = target ? target.reqs.filter((r) => reqState(r, activeFacts) === 'ok') : [];
  const gaps = target ? target.reqs.filter((r) => reqState(r, activeFacts) === 'gap') : [];
  const left = target
    ? target.reqs.filter((r) => ['none', 'weak'].includes(reqState(r, activeFacts)))
    : [];

  function finishToDashboard() {
    actions.saveSession();
    navigate(ROUTES.dashboard);
    setTimeout(
      () =>
        toast(
          `存好了。「${firstPlan?.title}」这段经历多了 ${state.activeIds.length} 条事实，产出物挂在它下面。`,
        ),
      400,
    );
  }

  return (
    <Screen name="done" title="成果">
      <TopBar nav={<Stepper current={ROUTES.done} />}>
        <button type="button" className="gbtn" onClick={() => navigate(ROUTES.workbench)}>
          ← 回工作台继续问
        </button>
        <button type="button" className="gbtn" onClick={() => actions.track('export_md')}>
          导出 Markdown
        </button>
        <button type="button" className="gbtn pri" onClick={finishToDashboard}>
          完成，存进工作区 →
        </button>
      </TopBar>

      <div className="rv">
        <div className="rv-h">
          <h2 data-testid="reveal-headline">
            {gold ? (
              <>
                同一段经历，<em>{gold} 处</em>是刚刚从你嘴里挖出来的——
                <br />
                你现在这份简历里，一个都没有。
              </>
            ) : (
              <>
                你一题都没答，所以成稿里只剩<em>材料里本来就有的东西</em>。
                <br />
                回工作台答两题，这一栏就会变样。
              </>
            )}
          </h2>
          <div className="legend">
            <span className="lg2">
              <i className="sw s" />
              来自你已有的材料 <b className="num">{state.artifact.stats.n_source}</b>
            </span>
            <span className="lg2 gold">
              <i className="sw g" />
              刚刚从你嘴里挖出来的 <b className="num">{gold}</b>
            </span>
            <span className="lg2">
              <i className="sw i" />
              AI 补的，请你确认 <b className="num">{inferred}</b>
            </span>
            <span className="lg2" style={{ borderStyle: 'dashed' }}>
              悬停任意高亮 → 看它的出处
            </span>
          </div>
        </div>

        <div className="rv-b">
          <div className="panes">
            <div className="pn before">
              <div className="pn-t">
                <span>BEFORE</span>
                {fromZero
                  ? '你的材料里只有这些'
                  : `${state.baseId === 'b2' ? '你刚上传的那份简历' : '你现在这份简历'}里的那几条`}
              </div>
              <div className="old">
                {fromZero
                  ? (firstPlan?.crumbs || []).map((id) => {
                      const crumb = byId[id];
                      if (!crumb) return null;
                      return (
                        <div key={id} style={{ marginBottom: 8, fontSize: 13 }}>
                          <b style={{ color: 'var(--fg-mute)', fontSize: 11 }}>
                            {sourceIcons[crumb.type]} {crumb.name}
                          </b>
                          <br />
                          {crumb.text}
                        </div>
                      );
                    })
                  : state.oldResume.map((row) => (
                      <div
                        key={row.n}
                        style={{
                          marginBottom: 9,
                          fontSize: 13.5,
                          lineHeight: 1.8,
                          opacity: row.target ? 1 : 0.5,
                        }}
                      >
                        <b style={{ color: 'var(--fg-mute)', fontSize: 11 }}>
                          第 {row.n} 条{row.target ? ' · 这一场要改的就是它' : ''}
                        </b>
                        <br />
                        {row.t}
                      </div>
                    ))}
              </div>
              <div className="old-note">
                {fromZero ? (
                  <>
                    {(firstPlan?.crumbs || []).length} 条材料，全是<b>事实碎片</b>
                    ：有代码、有事故、有一句吵架记录，
                    <br />
                    但没有一条说清了<b>结局、取舍和你的角色</b>。你一个字都没写，这一整段是问出来的。
                  </>
                ) : (
                  <>
                    这是<b>你现在简历上的原话</b>，一个字都没动过。
                    <br />第 2 条 26 个字，零个数字、零个决策、零个困难——
                    <b>不是你写得差，是没人问过你正确的问题</b>。
                  </>
                )}
              </div>
              <div className="bstat">
                <div className="bs">
                  <b className="num">{state.activeIds.length}</b>
                  <span>挖到的新事实（条）</span>
                </div>
                <div className="bs">
                  <b className="num">{answered}</b>
                  <span>你回答过的轮次</span>
                </div>
                <div className="bs">
                  <b className="num">{flagged}</b>
                  <span>被你判为「没意义」</span>
                </div>
                <div className="bs">
                  <b className="num">{inferred}</b>
                  <span>还没有出处，等你确认</span>
                </div>
              </div>
            </div>

            <div className="pn">
              <div className="pn-t">
                <span className="aft">AFTER</span>
                {state.rounds.length} 轮拷问之后
              </div>
              <div className="sheet">
                <h4>RESUME · EXPERIENCE</h4>
                <div data-testid="final-bullets">
                  {finalDraft.bullets.map((bullet) => (
                    <div className={`bul${bullet.promotedFactId ? ' promoted' : ''}`} key={bullet.key}>
                      <span className="bd" aria-hidden="true">
                        —
                      </span>
                      <span>
                        {bullet.segments.map((segment) => (
                          <Segment key={segment.key} segment={segment} buildPopover={buildPopover} />
                        ))}
                        {bullet.promotedFactId ? <span className="pbadge">你手动加的</span> : null}
                      </span>
                    </div>
                  ))}
                  {missing > 0 ? (
                    <div className="hint" style={{ marginTop: 12 }}>
                      还有 <b>{missing} 处</b>没挖到，所以这份稿子比它能有的样子薄。
                      <button
                        type="button"
                        className="mini"
                        style={{ marginLeft: 6 }}
                        onClick={() => navigate(ROUTES.workbench)}
                      >
                        回工作台继续问 →
                      </button>
                    </div>
                  ) : null}
                </div>
                <h4>自我介绍 · 60 秒版</h4>
                <div className="intro">
                  {finalDraft.intro.map((segment) => (
                    <Segment key={segment.key} segment={segment} buildPopover={buildPopover} />
                  ))}
                </div>
              </div>
              <div className="exports">
                <button type="button" className="gbtn pri" onClick={() => actions.track('copy_artifact')}>
                  复制全文
                </button>
                <button type="button" className="gbtn" onClick={() => actions.track('export_md')}>
                  导出 Markdown
                </button>
                <button type="button" className="gbtn" onClick={() => actions.track('save_thread')}>
                  存为我的 Thread
                </button>
                <small>↑ 这三个按钮的点击率＝唯一的成功度量点</small>
              </div>
            </div>
          </div>

          <div className="harvestboard">
            <div className="hb-h">
              <h3>这一场挖到了什么 · 按维度分组</h3>
              <small>
                共 {state.activeIds.length} 条新事实，来自 {answered} 轮回答
              </small>
            </div>
            <div className="hb-b">
              {state.dims.map((dim) => {
                const ids = state.activeIds.filter((id) => state.harvest[id].dim === dim);
                return (
                  <div className="hcol" key={dim}>
                    <h5>
                      {dim}
                      <span className={`b${ids.length ? '' : ' zero'} num`}>{ids.length}</span>
                    </h5>
                    {ids.length ? (
                      <ul>
                        {ids.map((id) => {
                          const fact = state.harvest[id];
                          const round = state.turns.find((t) => t.id === fact.turn)?.round;
                          return (
                            <li key={id}>
                              <i aria-hidden="true">◆</i>
                              <span>
                                {fact.text}
                                <span className="tagrow" style={{ marginTop: 4 }}>
                                  {fact.tags.map((tag) => (
                                    <span className="tg" key={tag}>
                                      #{tag}
                                    </span>
                                  ))}
                                  <span className="tg ref">第 {round} 轮</span>
                                  <span className="tg">
                                    → {promotedFacts.has(id) ? '简历（你加的）' : fact.dest}
                                  </span>
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

          {target ? (
            <div className="jdboard" data-testid="jd-board">
              <div className="hb-h">
                <h3>对上这个 JD 了吗 · {target.title}</h3>
                <small>
                  {target.org} · 共 {target.reqs.length} 条要求
                </small>
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
                    {matched.map((req) => (
                      <li key={req.id}>
                        <i style={{ color: 'var(--blue)' }}>✓</i>
                        <span>
                          {req.text}
                          {(req.fills || []).some((h) => activeFacts.has(h)) ? (
                            <span className="tg dim">
                              第{' '}
                              {
                                state.turns.find(
                                  (t) =>
                                    t.id === state.harvest[req.fills.find((h) => activeFacts.has(h))].turn,
                                )?.round
                              }{' '}
                              轮挖到的
                            </span>
                          ) : (
                            <span className="tg ref">材料里本来就有</span>
                          )}
                        </span>
                      </li>
                    ))}
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
                      {left.map((req) => (
                        <li key={req.id}>
                          <i>○</i>
                          <span>
                            {req.text}
                            <span className="tg">问得出来 · 回工作台</span>
                          </span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="none" style={{ fontStyle: 'italic', fontSize: 11.5 }}>
                      能问出来的都问完了。
                    </p>
                  )}
                </div>
                <div className="honest">
                  <b>
                    这份稿子对上了 {matched.length} / {target.reqs.length} 条。
                  </b>
                  剩下 {target.reqs.length - matched.length} 条里，有{' '}
                  <b>{gaps.length} 条是你确实没有的</b>：
                  {gaps.map((r) => `「${r.text}」`).join('、')}。
                  <br />
                  我们<b>没有替你圆这几条</b>——市面上按 JD 改简历的工具会给你编一句出来。
                  把它留在这儿，是因为你需要知道自己真正缺什么：那是去补技能的信号，不是去补文案的信号。
                </div>
              </div>
            </div>
          ) : null}

          <div className="landing-strip">
            <div className="m">
              <h4>这一场就到这儿。接下来去哪？</h4>
              <p>
                这一场挖到的 <b className="num">{state.activeIds.length}</b> 条事实会挂到
                <b>「{firstPlan?.title}」</b>这段经历下面，产出物也挂在它下面。
                <br />
                这段经历因此变厚了一截——下次写别的简历直接从它取料，不用把同样的问题再答一遍。
              </p>
            </div>
            <div className="a">
              <button type="button" className="btn" onClick={finishToDashboard}>
                完成，存进工作区 →
              </button>
              <button type="button" className="btn ghost" onClick={() => navigate(ROUTES.workbench)}>
                再问几轮
              </button>
              <button type="button" className="btn ghost" onClick={() => navigate(ROUTES.setup)}>
                换一段经历再来一场
              </button>
            </div>
          </div>
        </div>
      </div>
    </Screen>
  );
}
