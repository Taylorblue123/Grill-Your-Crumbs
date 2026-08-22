import TopBar from '../shell/TopBar.jsx';
import ExperienceCard from './ExperienceCard.jsx';
import {
  ARTIFACT, PAST_ARTIFACTS, PAST_EXP, SOURCE_ICON, SOURCE_LABEL,
} from '../../data/demo.js';
import { useDispatch, useStore } from '../../store/StoreContext.jsx';
import { goldCount, isCandidate, liveExperience } from '../../store/selectors.js';
import { useTrackEvent } from '../../hooks/useToast.jsx';

export default function DashScreen({ onTour, tourRunning }) {
  const state = useStore();
  const dispatch = useDispatch();
  const track = useTrackEvent();
  const go = (screen) => dispatch({ type: 'go', screen });

  const live = liveExperience(state);
  const exps = [live, ...PAST_EXP];

  /* 待办不是分类，是动作：名词按心智分（经历/产出物/材料），动作单列一条。 */
  const candNow = [...state.active].filter((id) => isCandidate(state, id)).length;
  const candPast = PAST_EXP.reduce((n, e) => n + e.facts.filter((f) => f.dest === '候补').length, 0);
  const unfinished = PAST_EXP.filter((e) => e.state === 'thin').length
    + (state.rounds.length && !state.sessionSaved ? 1 : 0);
  const bits = [];
  if (candNow + candPast) bits.push(<><b>{`${candNow + candPast} 条候补事实`}</b>还没进任何一份稿子</>);
  if (unfinished) bits.push(<><b>{`${unfinished} 段经历`}</b>问到一半</>);

  const arts = [
    ...(state.sessionSaved ? [{
      id: 'a_live',
      title: '实习简历 · EXPERIENCE ＋ 60 秒自我介绍',
      kind: '简历',
      exps: ['校园二手交易平台 · 推荐系统'],
      when: '刚刚',
      now: true,
      prov: [ARTIFACT.stats.n_source, goldCount(state), ARTIFACT.stats.n_inferred - state.killed.size],
    }] : []),
    ...PAST_ARTIFACTS,
  ];

  return (
    <section className="screen on" id="s-dash">
      <TopBar
        nav={(
          <nav className="topnav" style={{ display: 'flex', gap: 2, marginLeft: 6 }}>
            <button type="button" className="navlink on">工作区</button>
            <button type="button" className="navlink" onClick={() => go('opps')}>机会</button>
            <button type="button" className="navlink" onClick={() => go('landing')}>首页</button>
          </nav>
        )}
      >
        <button type="button" className="gbtn" onClick={onTour}>
          {tourRunning ? '停止演示 ❚❚' : '自动演示 ▶'}
        </button>
        <button type="button" className="gbtn pri" onClick={() => go('setup')}>＋ 开一场新的 Grill</button>
      </TopBar>

      <div className="scroll">
        <div className="dash">
          <div className="dhead">
            <div>
              <h1>Chen 的工作区</h1>
              <p>
                按<b>经历</b>组织，不按我们的数据结构组织。
                <br />
                每张卡是你能拿去讲的一段事——它现在有多厚、喂了哪几份稿子、还缺哪几个维度。
              </p>
            </div>
          </div>

          <div className={bits.length ? 'inbox' : 'inbox calm'}>
            {bits.length ? (
              <>
                <span className="t">
                  待你决定：
                  {bits.map((b, i) => (
                    <span key={i}>
                      {i > 0 && '　·　'}
                      {b}
                    </span>
                  ))}
                  。
                  <br />
                  <span style={{ opacity: 0.8 }}>候补不是垃圾——是「这次用不上，但面试被追问能展开」的料。</span>
                </span>
                <span className="a">
                  <button
                    type="button"
                    className="mini2 gold"
                    onClick={() => { go('wb'); dispatch({ type: 'openPanel', key: 'ledger' }); }}
                  >
                    去处理候补
                  </button>
                  {state.rounds.length > 0 && !state.sessionSaved && (
                    <button type="button" className="mini2" onClick={() => go('wb')}>继续没问完的那场</button>
                  )}
                </span>
              </>
            ) : (
              <>
                <span className="t">没有待办。挖到的每条事实都有去处，每段经历都问到了自然停下的地方。</span>
                <span className="a">
                  <button type="button" className="mini2" onClick={() => go('setup')}>＋ 开一场新的</button>
                </span>
              </>
            )}
          </div>

          <div className="shelfhead">
            <h2>我的经历</h2>
            <span className="c num">{exps.length}</span>
            <p>
              下面那 6 个格子是<b>维度矩阵</b>：填了几格是数出来的，不是完成度。
              <br />
              空格＝这段还没被问到那个角度。
            </p>
          </div>
          <div className="expgrid">
            {exps.map((e) => (
              <ExperienceCard
                key={e.id}
                exp={e}
                actions={e.now ? (
                  <>
                    <button
                      type="button"
                      className={`mini2 ${state.sessionSaved ? '' : 'pri'}`}
                      onClick={() => go(state.rounds.length ? 'wb' : 'setup')}
                    >
                      {state.rounds.length && !state.sessionSaved ? '继续拷问' : '再挖几轮'}
                    </button>
                    {state.sessionSaved && (
                      <button type="button" className="mini2" onClick={() => go('done')}>看成果</button>
                    )}
                  </>
                ) : (
                  <button type="button" className="mini2" onClick={() => track('resume_thread')}>继续拷问</button>
                )}
              />
            ))}
          </div>

          <div className="shelfhead">
            <h2>产出物</h2>
            <span className="c num">{arts.length}</span>
            <p>每份稿子由哪几段经历喂出来 · 三色条＝这份稿子有多少是有出处的</p>
          </div>
          <div className="strip">
            {arts.map((a) => {
              const tot = a.prov[0] + a.prov[1] + a.prov[2] || 1;
              return (
                <div className="scard" key={a.id}>
                  <div className="t1">
                    {a.title}
                    {a.now && <span className="state done">刚刚生成</span>}
                  </div>
                  <div className="t2">
                    {`${a.kind} · 由 `}
                    {a.exps.map((x, i) => (
                      <span key={x}>
                        {i > 0 && ' ＋ '}
                        <b>{x}</b>
                      </span>
                    ))}
                    {` 喂出来 · ${a.when}`}
                    <br />
                    <b>{a.prov[0]}</b>{' 有材料出处 / '}
                    <b>{a.prov[1]}</b>{' 挖出来的 / '}
                    <b>{a.prov[2]}</b>{' 待确认'}
                  </div>
                  <div className="provbar">
                    <i className="s" style={{ width: `${(a.prov[0] / tot) * 100}%` }} />
                    <i className="g" style={{ width: `${(a.prov[1] / tot) * 100}%` }} />
                    <i className="f" style={{ width: `${(a.prov[2] / tot) * 100}%` }} />
                  </div>
                  <div className="a">
                    <button
                      type="button"
                      className="mini2"
                      onClick={() => (a.now ? go('done') : track('open_artifact'))}
                    >
                      打开
                    </button>
                    <button type="button" className="mini2" onClick={() => track('export_md')}>导出</button>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="shelfhead">
            <h2>材料</h2>
            <span className="c num">{state.crumbs.length}</span>
            <p>原料层。同一条材料可以喂给多段经历。</p>
          </div>
          <div className="srcgrid">
            {state.crumbs.map((c) => (
              <div className="scell" key={c.id}>
                <div className="t1">
                  <span className="ic">{SOURCE_ICON[c.type]}</span>
                  {c.name}
                </div>
                <div className="t2">
                  {SOURCE_LABEL[c.type]}
                  {state.sessionCrumbs.has(c.id) && ' · 本场使用中'}
                  {c.remote && ' · 已上传后端'}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
