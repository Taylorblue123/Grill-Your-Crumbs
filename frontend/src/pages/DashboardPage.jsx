/* ① 工作区 —— 按「经历」组织，不按我们的数据结构组织。
   用户想的是「我有几段能拿去讲的经历」，不是「我有 3 个 thread 和 24 条 fact」。 */
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import TopBar, { TopNav } from '../components/shell/TopBar';
import Screen from '../components/shell/Screen';
import ExperienceCard from '../components/dashboard/ExperienceCard';
import MaterialUploader from '../components/common/MaterialUploader';
import BackendChip from '../components/common/BackendChip';
import { fetchWorkspace, sourceIcons, sourceLabels } from '../api';
import { dimensionMatrix } from '../domain/ledger';
import { useCrumbLibrary } from '../state/CrumbLibraryContext';
import { useSession } from '../state/SessionContext';
import { useToast } from '../state/ToastContext';
import { ROUTES } from '../routes';

export default function DashboardPage() {
  const navigate = useNavigate();
  const { state, promotedFacts, candidates, gold, actions } = useSession();
  const { crumbs, backend, remove } = useCrumbLibrary();
  const { push: toast } = useToast();
  const [workspace, setWorkspace] = useState({ experiences: [], artifacts: [] });
  const [removing, setRemoving] = useState(null);

  useEffect(() => {
    let alive = true;
    fetchWorkspace().then((payload) => {
      if (alive) setWorkspace({ experiences: payload.experiences, artifacts: payload.artifacts });
    });
    return () => {
      alive = false;
    };
  }, []);

  /* 正在进行的这一场，也是一段经历 —— 它的数字全部来自当前 session。 */
  const liveExperience = useMemo(() => {
    const first = state.plan[0];
    return {
      id: 'x1',
      now: true,
      title: first?.title || '本场经历',
      span: first?.span || '',
      crumbs: state.sessionCrumbIds.length,
      rounds: `${state.rounds.length} / ${Math.max(1, state.planRounds[first?.id] || 0)}`,
      when: state.sessionSaved ? '刚刚' : state.rounds.length ? '进行中' : '还没开始',
      state: state.sessionSaved ? 'done' : state.rounds.length ? 'live' : 'new',
      dims: dimensionMatrix(state.activeIds, state.harvest),
      arts: state.sessionSaved ? ['实习简历 · EXPERIENCE', '60 秒自我介绍'] : [],
      facts: state.activeIds.map((id) => ({
        ...state.harvest[id],
        id,
        dest: promotedFacts.has(id) ? '简历（你加的）' : state.harvest[id].dest,
        from: `第 ${state.turns.find((t) => t.id === state.harvest[id].turn)?.round} 轮`,
      })),
    };
  }, [state, promotedFacts]);

  const experiences = useMemo(
    () => [liveExperience, ...workspace.experiences],
    [liveExperience, workspace.experiences],
  );

  const pastCandidates = workspace.experiences.reduce(
    (n, e) => n + e.facts.filter((f) => f.dest === '候补').length,
    0,
  );
  const unfinished =
    workspace.experiences.filter((e) => e.state === 'thin').length +
    (state.rounds.length && !state.sessionSaved ? 1 : 0);

  const todo = [];
  if (candidates.length + pastCandidates) {
    todo.push(`${candidates.length + pastCandidates} 条候补事实还没进任何一份稿子`);
  }
  if (unfinished) todo.push(`${unfinished} 段经历问到一半`);

  const artifacts = useMemo(() => {
    const live = state.sessionSaved && state.artifact
      ? [
          {
            id: 'a_live',
            title: '实习简历 · EXPERIENCE ＋ 60 秒自我介绍',
            kind: '简历',
            exps: [liveExperience.title],
            when: '刚刚',
            now: true,
            prov: [
              state.artifact.stats.n_source,
              gold,
              state.artifact.stats.n_inferred - state.killedBullets.length,
            ],
          },
        ]
      : [];
    return [...live, ...workspace.artifacts];
  }, [state.sessionSaved, state.artifact, state.killedBullets.length, gold, liveExperience.title, workspace.artifacts]);

  async function handleRemove(crumb) {
    setRemoving(crumb.id);
    try {
      await remove(crumb.id);
      toast(`「${crumb.name}」已从材料库删除，原文件也一并删掉了。`);
    } catch (error) {
      toast(`删除失败：${error.message}`);
    } finally {
      setRemoving(null);
    }
  }

  return (
    <Screen name="dash" title="我的工作区">
      <TopBar nav={<TopNav />}>
        <BackendChip />
        <button type="button" className="gbtn pri" onClick={() => navigate(ROUTES.setup)}>
          ＋ 开一场新的 Grill
        </button>
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

          <div className={`inbox ${todo.length ? '' : 'calm'}`} data-testid="inbox">
            {todo.length ? (
              <>
                <span className="t">
                  待你决定：{todo.join('　·　')}。
                  <br />
                  <span style={{ opacity: 0.8 }}>
                    候补不是垃圾——是「这次用不上，但面试被追问能展开」的料。
                  </span>
                </span>
                <span className="a">
                  <button
                    type="button"
                    className="mini2 gold"
                    onClick={() => navigate(`${ROUTES.workbench}?panel=ledger`)}
                  >
                    去处理候补
                  </button>
                  {state.rounds.length && !state.sessionSaved ? (
                    <button type="button" className="mini2" onClick={() => navigate(ROUTES.workbench)}>
                      继续没问完的那场
                    </button>
                  ) : null}
                </span>
              </>
            ) : (
              <>
                <span className="t">
                  没有待办。挖到的每条事实都有去处，每段经历都问到了自然停下的地方。
                </span>
                <span className="a">
                  <button type="button" className="mini2" onClick={() => navigate(ROUTES.setup)}>
                    ＋ 开一场新的
                  </button>
                </span>
              </>
            )}
          </div>

          <div className="shelfhead">
            <h2>我的经历</h2>
            <span className="c num">{experiences.length}</span>
            <p>
              下面那 6 个格子是<b>维度矩阵</b>：填了几格是数出来的，不是完成度。
              <br />
              空格＝这段还没被问到那个角度。
            </p>
          </div>
          <div className="expgrid">
            {experiences.map((experience) => (
              <ExperienceCard
                key={experience.id}
                experience={experience}
                dims={state.dims}
                actions={
                  experience.now ? (
                    <>
                      <button
                        type="button"
                        className={`mini2 ${state.sessionSaved ? '' : 'pri'}`}
                        onClick={() =>
                          navigate(state.rounds.length ? ROUTES.workbench : ROUTES.setup)
                        }
                      >
                        {state.rounds.length && !state.sessionSaved ? '继续拷问' : '再挖几轮'}
                      </button>
                      {state.sessionSaved ? (
                        <button type="button" className="mini2" onClick={() => navigate(ROUTES.done)}>
                          看成果
                        </button>
                      ) : null}
                    </>
                  ) : (
                    <button
                      type="button"
                      className="mini2"
                      onClick={() => actions.track('resume_thread')}
                    >
                      继续拷问
                    </button>
                  )
                }
              />
            ))}
          </div>

          <div className="shelfhead">
            <h2>产出物</h2>
            <span className="c num">{artifacts.length}</span>
            <p>每份稿子由哪几段经历喂出来 · 三色条＝这份稿子有多少是有出处的</p>
          </div>
          <div className="strip">
            {artifacts.map((artifact) => {
              const total = artifact.prov.reduce((a, b) => a + b, 0) || 1;
              return (
                <article className="scard" key={artifact.id}>
                  <div className="t1">
                    {artifact.title}
                    {artifact.now ? <span className="state done">刚刚生成</span> : null}
                  </div>
                  <div className="t2">
                    {artifact.kind} · 由 {artifact.exps.map((e) => <b key={e}>{e}</b>)} 喂出来 ·{' '}
                    {artifact.when}
                    <br />
                    <b>{artifact.prov[0]}</b> 有材料出处 / <b>{artifact.prov[1]}</b> 挖出来的 /{' '}
                    <b>{artifact.prov[2]}</b> 待确认
                  </div>
                  <div className="provbar" aria-hidden="true">
                    <i className="s" style={{ width: `${(artifact.prov[0] / total) * 100}%` }} />
                    <i className="g" style={{ width: `${(artifact.prov[1] / total) * 100}%` }} />
                    <i className="f" style={{ width: `${(artifact.prov[2] / total) * 100}%` }} />
                  </div>
                  <div className="a">
                    <button
                      type="button"
                      className="mini2"
                      onClick={() =>
                        artifact.now ? navigate(ROUTES.done) : actions.track('open_artifact')
                      }
                    >
                      打开
                    </button>
                    <button type="button" className="mini2" onClick={() => actions.track('export_md')}>
                      导出
                    </button>
                  </div>
                </article>
              );
            })}
          </div>

          <div className="shelfhead">
            <h2>材料</h2>
            <span className="c num">{crumbs.length}</span>
            <p>
              原料层。同一条材料可以喂给多段经历。
              <br />
              带「已入库」的是真的上传到后端存下来的，其余是演示样例。
            </p>
          </div>

          <MaterialUploader />

          <div className="srcgrid" data-testid="material-grid">
            {crumbs.map((crumb) => (
              <div className="scell" key={crumb.id}>
                <div className="t1">
                  <span className="ic" aria-hidden="true">
                    {sourceIcons[crumb.type] || '◆'}
                  </span>
                  <span
                    style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                  >
                    {crumb.name}
                  </span>
                  <span className={`origin-tag ${crumb.origin === 'backend' ? 'live' : 'sample'}`}>
                    {crumb.origin === 'backend' ? '已入库' : '样例'}
                  </span>
                </div>
                <div className="t2">
                  {sourceLabels[crumb.type] || crumb.type}
                  {state.sessionCrumbIds.includes(crumb.id) ? ' · 本场使用中' : ''}
                </div>
                {crumb.origin === 'backend' ? (
                  <div className="a2">
                    <button
                      type="button"
                      className="mini2"
                      disabled={removing === crumb.id}
                      onClick={() => handleRemove(crumb)}
                    >
                      {removing === crumb.id ? '删除中…' : '删除'}
                    </button>
                  </div>
                ) : null}
              </div>
            ))}
          </div>

          {!backend.online && backend.checked ? (
            <p className="hint" style={{ maxWidth: '70ch', marginTop: 12 }}>
              后端没连上，所以现在看到的材料全是演示样例。启动 <code>backend/</code> 之后，
              上传的文件会真的落库，并出现在这张列表里。
            </p>
          ) : null}
        </div>
      </div>
    </Screen>
  );
}
