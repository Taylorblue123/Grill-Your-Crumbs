import { useMemo, useState } from 'react';
import TopBar from '../shell/TopBar.jsx';
import UploadBox from '../setup/UploadBox.jsx';
import QuestionCard from './QuestionCard.jsx';
import { startGrillSession } from '../../api/client.js';
import { useDispatch, useStore } from '../../store/StoreContext.jsx';

/* ============================================================
   Live · 真实拷问链路（#screen=live）

   这一屏是「这不是录像，是真的」的证明：所有内容来自后端和真 LLM，
   一个字都不来自 data/demo.js 的剧本。

   「自包含」的边界要说清楚，免得下一片踩空：
     - **拷问会话状态**（JD、进场的料、首题、加载/错误）全在本组件局部
       state 里，不进全局 store——剧本 demo 的 reducer 一行不动。
     - **材料列表**读全局 store，上传也照常走 UploadBox。料是全应用共享的
       资产（上传一次，剧本和真链路都看得见），不该在这里再存一份。
     - 会话进行中**不写 hash 参数**：深链是给剧本演示用的复现工具，
       真会话是有服务端状态的一次性对象，塞进 URL 只会造出复现不了的链接。

   阶段性文案的存在理由：开场那一次 LLM 调用要读完全部料再规划挖掘树，
   十几秒起步。什么都不说的话用户会以为卡死了。
   ============================================================ */

const STAGES = [
  '正在读你的料……',
  '正在对着 JD 找缺口……',
  '正在规划想挖的点……',
  '正在想第一个问题……',
];

/* 材料类型 → 中文标签。后端的 kind 直接透出来对用户没意义。 */
const KIND_LABEL = {
  resume: '简历',
  repo: '代码仓库',
  notes: '笔记',
  diary: '日记',
  social: '社交动态',
  linkedin: 'LinkedIn',
  manual: '其他',
};

export default function LiveScreen() {
  const state = useStore();
  const dispatch = useDispatch();

  const [jdText, setJdText] = useState('');
  const [excluded, setExcluded] = useState(() => new Set());   // 默认全选 → 只记剔除的
  const [phase, setPhase] = useState('setup');                 // setup | loading | asking
  const [stage, setStage] = useState(0);
  const [error, setError] = useState(null);
  const [session, setSession] = useState(null);

  /* 只有后端来的料能进场：剧本样例是假数据，喂给真 LLM 会问出假问题。 */
  const crumbs = useMemo(() => state.crumbs.filter((c) => c.remote), [state.crumbs]);
  const picked = useMemo(
    () => crumbs.filter((c) => !excluded.has(c.id)),
    [crumbs, excluded],
  );
  const hasResume = picked.some((c) => c.type === 'resume');

  const toggle = (id) => setExcluded((cur) => {
    const next = new Set(cur);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const start = async () => {
    setError(null);
    setPhase('loading');
    setStage(0);
    /* 阶段文案按固定节奏走完就停在最后一句——它讲的是「正在做什么」，
       不是进度条，所以不假装知道还剩多久。 */
    const ticker = setInterval(
      () => setStage((s) => Math.min(s + 1, STAGES.length - 1)),
      4000,
    );
    try {
      const result = await startGrillSession(jdText, picked.map((c) => c.id));
      setSession(result);
      setPhase('asking');
    } catch (err) {
      setError(err.message);
      setPhase('setup');
      if (/连不上后端/.test(err.message)) {
        dispatch({ type: 'setBackend', backend: { status: 'offline', error: err.message } });
      }
    } finally {
      clearInterval(ticker);
    }
  };

  const restart = () => {
    setSession(null);
    setError(null);
    setPhase('setup');
  };

  const baselineName = session
    ? crumbs.find((c) => c.id === session.baseline_crumb_id)?.name
    : null;

  return (
    <section className="screen on" id="s-live">
      <TopBar>
        <button
          type="button"
          className="btn ghost sm"
          onClick={() => dispatch({ type: 'go', screen: 'landing' })}
        >
          回落地页
        </button>
      </TopBar>

      <div className="scroll">
        <div className="lwrap live-wrap">
          <span className="kick">LIVE · 真实链路</span>
          <h2 className="live-h1">
            这一屏没有剧本。
            <em>问题是现问的。</em>
          </h2>
          <p className="live-lede">
            贴一段目标岗位的 JD，勾掉不想让它看的料。它会先把你选的料读完，
            对着 JD 找缺口，规划出「想挖的点」，然后问出第一个问题——
            <b>料里已经写清楚的东西，它不会再问你一遍</b>
            。
          </p>

          {phase === 'asking' && session ? (
            <>
              <div className="live-baseline">
                <span className="h6">本场底稿</span>
                {baselineName || session.baseline_crumb_id}
                <small>新简历会拿它当对比基准——多份简历时取最新的那一份。</small>
              </div>

              <QuestionCard question={session.question} />

              <div className="acts live-acts">
                <button type="button" className="act" onClick={restart}>换个 JD 重开一场</button>
              </div>

              <p className="live-note">
                作答与追问是下一片的事（本切片只到首题）。这道题、这棵挖掘树都已经存进了
                后端的会话里，session_id 是
                {' '}
                <code>{session.session_id}</code>
                。
              </p>
            </>
          ) : (
            <>
              <div className="live-block">
                <h3>① 你的料</h3>
                <p className="live-sub">
                  默认全选。勾掉和这个岗位无关的，免得把拷问带偏。
                  {crumbs.length > 0 && (
                    <b>
                      {` 已选 ${picked.length} / ${crumbs.length} 份`}
                    </b>
                  )}
                </p>

                <UploadBox />

                {crumbs.length === 0 ? (
                  <div className="live-empty">
                    还没有料。先上传一份简历——拷问要拿它当底稿。
                  </div>
                ) : (
                  <div className="live-crumbs">
                    {crumbs.map((c) => {
                      const on = !excluded.has(c.id);
                      return (
                        <button
                          type="button"
                          className={`cr live-cr${on ? ' on' : ''}`}
                          key={c.id}
                          onClick={() => toggle(c.id)}
                          aria-pressed={on}
                        >
                          <span className="ic">{on ? '✓' : '　'}</span>
                          <span style={{ minWidth: 0, flex: 1 }}>
                            <span className="nm">{c.name}</span>
                            <span className="tx">{(c.text || '').slice(0, 90)}</span>
                          </span>
                          <span className="live-kind">{KIND_LABEL[c.type] || c.type}</span>
                        </button>
                      );
                    })}
                  </div>
                )}

                {crumbs.length > 0 && !hasResume && (
                  <div className="live-warn">
                    选中的料里没有简历。拷问要拿一份简历当底稿，才有「原简历 vs 新简历」的对比基准。
                  </div>
                )}
              </div>

              <div className="live-block">
                <h3>② 目标岗位 JD</h3>
                <p className="live-sub">整段粘贴原文就行，不用整理格式。</p>
                <textarea
                  className="live-jd"
                  value={jdText}
                  onChange={(e) => setJdText(e.target.value)}
                  placeholder="把招聘页面上的岗位描述整段复制过来……"
                  rows={9}
                  aria-label="目标岗位 JD 原文"
                />
              </div>

              {error && (
                <div className="live-err" role="alert">
                  <b>没能开场</b>
                  {error}
                </div>
              )}

              {phase === 'loading' ? (
                <div className="live-loading" aria-live="polite">
                  <span className="live-spin" />
                  <div>
                    <b>{STAGES[stage]}</b>
                    <small>开场要把你选的料整份读完，通常十几秒到半分钟。</small>
                  </div>
                </div>
              ) : (
                <div className="live-go">
                  <button
                    type="button"
                    className="btn"
                    onClick={start}
                    disabled={!jdText.trim() || picked.length === 0 || !hasResume}
                  >
                    开始拷问 →
                  </button>
                  <span className="live-gate">
                    {!jdText.trim() && '贴一段 JD 才能开始 · '}
                    {picked.length === 0 && '至少留一份料 · '}
                    {crumbs.length > 0 && !hasResume && '需要一份简历当底稿 · '}
                    一次一问，随时可以停
                  </span>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </section>
  );
}
