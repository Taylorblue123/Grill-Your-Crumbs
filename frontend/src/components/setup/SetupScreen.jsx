import { useState } from 'react';
import TopBar from '../shell/TopBar.jsx';
import Stepper from '../shell/Stepper.jsx';
import RichText from '../common/RichText.jsx';
import UploadBox from './UploadBox.jsx';
import RepoBox from './RepoBox.jsx';
import GitHubBox from './GitHubBox.jsx';
import TargetPicker from './TargetPicker.jsx';
import { EXPERIENCES, GOALS, SOURCE_ICON } from '../../data/demo.js';
import { useDispatch, useStore } from '../../store/StoreContext.jsx';
import { crumbById, expCovers } from '../../store/selectors.js';
import { deleteCrumb } from '../../api/client.js';
import { useToast } from '../../hooks/useToast.jsx';

const EXPECT = [
  { i: '①', h: '投喂', p: '你现在在这里。' },
  { i: '②', h: '一次一问', p: '6 轮，每题带「我为什么问这个」和一个猜测答案。' },
  { i: '③', h: '四个面板同步长', p: '材料 · 拷问 · 简历活稿 · 收获账本。每个都能收到边上或放大。' },
  { i: '④', h: '成果 → 回工作区', p: '这段经历会变厚一截，产出物挂在它下面。' },
];

export default function SetupScreen({ onTour, tourRunning }) {
  const state = useStore();
  const dispatch = useDispatch();
  const { show } = useToast();
  const [removing, setRemoving] = useState(null);
  const crumbs = crumbById(state);
  const go = (screen) => dispatch({ type: 'go', screen });

  const sorted = [...EXPERIENCES].sort((a, b) => (expCovers(state, b) || 0) - (expCovers(state, a) || 0));
  const picked = EXPERIENCES.find((x) => x.id === state.pickedExp);
  /* 原型只跑通了第一段的拷问脚本，其余两段选中后禁用「开始」并说明原因，不假装能跑。 */
  const scriptMissing = state.pickedExp !== 'e1';
  const startDisabled = state.intakeWay === 'pick' && scriptMissing;

  const sessionList = state.crumbs.filter((c) => state.sessionCrumbs.has(c.id));
  const uploadedTokens = sessionList
    .filter((c) => c.tokenCount)
    .reduce((sum, c) => sum + c.tokenCount, 0);

  /* 删除是后端能力（DELETE /api/v1/crumbs/{id}），只对上传来的材料开放；
     演示样例没有后端记录，删了会造成前后端不一致。 */
  const removeCrumb = async (c) => {
    setRemoving(c.id);
    try {
      await deleteCrumb(c.id);
      dispatch({ type: 'removeCrumb', id: c.id });
      show(`已删除「${c.name}」，后端的原文件和抽取文本一起清掉了。`);
    } catch (error) {
      show(error.message);
    } finally {
      setRemoving(null);
    }
  };

  return (
    <section className="screen on" id="s-setup">
      <TopBar nav={<Stepper />}>
        <button type="button" className="gbtn" onClick={() => go('dash')}>← 回工作区</button>
        <button type="button" className="gbtn" onClick={onTour}>
          {tourRunning ? '停止演示 ❚❚' : '自动演示 ▶'}
        </button>
      </TopBar>

      <div className="scroll">
        <div className="setup">
          <div className="kick2">第 ① 步 · 投喂</div>
          <h1>这一场，我们从<em>哪儿</em>开始？</h1>
          <p className="lede">
            两条路都行。你心里已经有那段想改的经历，就自己写；
            <b>没想好写哪段，就让我从你的材料里挑</b>。
          </p>

          <div className="ways">
            <button
              type="button"
              className={`way${state.intakeWay === 'write' ? ' on' : ''}`}
              onClick={() => dispatch({ type: 'setWay', way: 'write' })}
            >
              <span className="wt"><span className="i">A</span>我有一段想改的经历</span>
              <p>粘一段你自己写的（通常很干巴），它会成为最后对比用的基准。适合已经有简历、想改某一条的人。</p>
            </button>
            <button
              type="button"
              className={`way${state.intakeWay === 'pick' ? ' on' : ''}`}
              onClick={() => dispatch({ type: 'setWay', way: 'pick' })}
            >
              <span className="wt"><span className="i">B</span>从我的材料里挑一段</span>
              <p>
                <b>一个字都不用写。</b>
                我先把你的 crumbs 聚成几段能讲的经历，告诉你每段有多厚、缺口在哪，你挑一个就开始。
              </p>
            </button>
          </div>

          {/* ── 方式 A ── */}
          <div className={`wayBody${state.intakeWay === 'write' ? ' on' : ''}`}>
            <div className="blk">
              <div className="blab">这段经历 <i>必填</i></div>
              <textarea
                className="ta"
                aria-label="你的原始经历"
                value={state.baseline}
                onChange={(e) => dispatch({ type: 'setBaseline', text: e.target.value })}
              />
              <div className="hint">
                ↑ 这段是<b>基准</b>：一个字都不会被改动，最后要和成稿并排对比。
                <span className="num">{`　当前 ${state.baseline.length} 字。`}</span>
              </div>
            </div>
          </div>

          {/* ── 方式 B ── */}
          <div className={`wayBody${state.intakeWay === 'pick' ? ' on' : ''}`}>
            <div className="blk">
              <div className="blab">
                {`我从 ${state.crumbs.length} 条材料里聚出了这几段 `}
                <i>点一个开始</i>
              </div>
              <div className="expopts">
                {sorted.map((e) => {
                  const covers = expCovers(state, e);
                  return (
                    <button
                      type="button"
                      className={`eopt${state.pickedExp === e.id ? ' on' : ''}${e.id !== 'e1' ? ' na' : ''}`}
                      key={e.id}
                      onClick={() => dispatch({ type: 'pickExp', id: e.id })}
                    >
                      <span className="et">
                        {e.title}
                        <span className="span">{e.span}</span>
                        <span className={`heat ${e.heat}`}>{`材料${e.heat}`}</span>
                        {covers !== null && <span className="heat 中">{`能对上 JD ${covers} 条`}</span>}
                        {e.recommend && <span className="heat 厚">建议先挖这段</span>}
                      </span>
                      <RichText className="why" as="div" html={e.why} />
                      <div className="fromrow">
                        <span className="lb">聚自</span>
                        {e.crumbs.map((c) => (
                          <span className="tg src" key={c}>
                            {crumbs[c] ? `${SOURCE_ICON[crumbs[c].type]} ${crumbs[c].name}` : c}
                          </span>
                        ))}
                      </div>
                      <span className="est">{e.id !== 'e1' ? 'demo 未含这段脚本' : e.est}</span>
                    </button>
                  );
                })}
              </div>
              <div className="picked">
                {scriptMissing ? (
                  <>
                    <h5>{`已选：${picked.title}`}</h5>
                    <p className="note">
                      这个原型只跑通了第一段的拷问脚本（6 轮问答是手写的假数据）。
                      <b>换回「校园二手交易平台」才能开始</b>——真实产品里三段都能问。
                    </p>
                  </>
                ) : (
                  <>
                    <h5>{`已选：${picked.title} · 这就是本场的基准`}</h5>
                    <div className="bl">
                      {picked.crumbs.map((id) => crumbs[id]?.text).filter(Boolean).join(' ／ ')}
                    </div>
                    <p className="note">
                      注意：<b>这段基准是从你材料里拼的，不是你写的</b>。所以最后的对比不是「你写的 vs 成稿」，
                      而是「<b>材料里本来有的 vs 问出来之后的</b>」。成果页会照这个口径展示。
                    </p>
                  </>
                )}
              </div>
            </div>
          </div>

          <div className="blk">
            <div className="blab">① 产出什么 <i>格式</i></div>
            <div className="chips">
              {GOALS.map((g) => (
                <button
                  type="button"
                  className={`chip${state.goal === g ? ' on' : ''}`}
                  key={g}
                  onClick={() => dispatch({ type: 'setGoal', goal: g })}
                >
                  {g}
                </button>
              ))}
            </div>
          </div>

          <div className="blk">
            <div className="blab">② 为谁做 <i>TARGET · 可留空</i></div>
            <TargetPicker />
          </div>

          <div className="blk">
            <div className="blab">本场装载的 Crumbs <i>进了工作台还能随时增减</i></div>
            <UploadBox />
            <RepoBox />
            <GitHubBox />
            <div className="crumbgrid">
              {sessionList.map((c) => (
                <div className="cr" key={c.id}>
                  <span className="ic">{SOURCE_ICON[c.type]}</span>
                  <span style={{ minWidth: 0 }}>
                    <span className="nm">{c.name}</span>
                    <span className="tx">{c.text}</span>
                  </span>
                  {c.remote ? (
                    <button
                      type="button"
                      className="crx"
                      title="从后端删除这条材料（连同原文件）"
                      disabled={removing === c.id}
                      onClick={() => removeCrumb(c)}
                    >
                      {removing === c.id ? '…' : '✕'}
                    </button>
                  ) : (
                    <span className="ck">✓</span>
                  )}
                </div>
              ))}
            </div>
            <div className="hint">
              本场装了 <b>{state.sessionCrumbs.size}</b> 条（库里共 {state.crumbs.length} 条），
              {uploadedTokens
                ? `样例约 4,200 ＋ 新材料约 ${uploadedTokens.toLocaleString()} tokens`
                : '样例约 4,200 tokens'}
              。真实后端会按预算检索，不会把材料无限塞进 context。进了工作台还能随时拖进拖出。
            </div>
          </div>

          <div className="expect">
            <div className="eh">
              接下来会发生什么
              <em>约 5 分钟 · 6 轮 · 随时可退出</em>
            </div>
            <div className="esteps">
              {EXPECT.map((s) => (
                <div className="es" key={s.i}>
                  <div className="i">{s.i}</div>
                  <h5>{s.h}</h5>
                  <p>{s.p}</p>
                </div>
              ))}
            </div>
            <div className="ep">
              <ul>
                <li><i>✓</i><span>每题都先给<b>猜测答案</b>——点头就行，不用从头打字。</span></li>
                <li><i>✓</i><span>任何一轮、任何一条新事实都能<b>撤回</b>，简历稿会跟着回退（<b>⌘Z / Ctrl+Z</b>）。</span></li>
                <li><i>✓</i><span>问得烂就点<b>「这问题没意义」</b>——它会承认，并换一个只有你能答的。</span></li>
                <li>
                  <i>✓</i>
                  <span>
                    我们不会给你「完成度 78%」这种数字。<b>没人能确定你讲完了没有</b>，
                    所以我们只报能数清的：多挖到了几条、进稿几句。
                  </span>
                </li>
              </ul>
            </div>
          </div>

          <div className="gostrip">
            <button
              type="button"
              className="go"
              disabled={startDisabled}
              style={{
                opacity: startDisabled ? 0.45 : 1,
                pointerEvents: startDisabled ? 'none' : 'auto',
              }}
              onClick={() => go('wb')}
            >
              开始拷问 →
            </button>
            <small>
              预计 6 轮 · 中途随时可以点「够了，出稿」
              <br />
              不满意可以回到这里换一段，已挖到的内容不会丢
            </small>
          </div>
        </div>
      </div>
    </section>
  );
}
