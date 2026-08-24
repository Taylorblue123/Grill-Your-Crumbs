import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import TopBar from '../shell/TopBar.jsx';
import UploadBox from '../setup/UploadBox.jsx';
import RepoBox from '../setup/RepoBox.jsx';
import QuestionCard from './QuestionCard.jsx';
import FactLedger from './FactLedger.jsx';
import RewriteView from './RewriteView.jsx';
import {
  AnswerConflictError,
  SessionGoneError,
  fetchGrillSession,
  startGrillSession,
  stopGrillSession,
  submitGrillAnswer,
} from '../../api/client.js';
import { useDispatch, useStore } from '../../store/StoreContext.jsx';

/* ============================================================
   Live · 真实拷问链路（#screen=live）

   这一屏是「这不是录像，是真的」的证明：所有内容来自后端和真 LLM，
   一个字都不来自 data/demo.js 的剧本。

   「自包含」的边界要说清楚：
     - **拷问会话状态**（JD、进场的料、当前题、账本、加载/错误）全在本组件
       局部 state 里，不进全局 store——剧本 demo 的 reducer 一行不动。
     - **材料列表**读全局 store，上传走 UploadBox、连仓走 RepoBox。料是全应用共享的
       资产（上传一次，剧本和真链路都看得见），不该在这里再存一份。
     - 会话进行中**不写 hash 参数**：深链是给剧本演示用的复现工具，
       真会话是有服务端状态的一次性对象，塞进 URL 只会造出复现不了的链接。

   会话恢复用 sessionStorage 而不是 hash 或 localStorage：
     - 刷新页面丢的是组件 state，不是服务端会话，所以只要记住 session_id
       就能靠 GET 投影把现场原样拿回来。
     - **不用 hash**：理由同上，会话不是可分享的链接。
     - **不用 localStorage**：会话活在后端内存里，重启即丢。跨标签页、跨天
       留着一个多半已经不存在的 id，只会让用户每次进来都吃一次「重开一场」。
       sessionStorage 的生命周期（这个标签页）恰好和会话的生命周期对齐。

   阶段性文案的存在理由：开场那一次 LLM 调用要读完全部料再规划挖掘树，
   十几秒起步。什么都不说的话用户会以为卡死了。
   ============================================================ */

const STAGES = [
  '正在读你的料……',
  '正在对着 JD 找缺口……',
  '正在规划想挖的点……',
  '正在想第一个问题……',
];

const SESSION_KEY = 'grill.live.session';

/* sessionStorage 在隐私模式/被禁 cookie 的浏览器里会抛。恢复现场是锦上添花，
   不能因为它把整屏拖垮——存不进就当没这功能，拷问照样能做完。 */
function rememberSession(sessionId) {
  try {
    if (sessionId) window.sessionStorage.setItem(SESSION_KEY, sessionId);
    else window.sessionStorage.removeItem(SESSION_KEY);
  } catch {
    /* 存不住就算了 */
  }
}

function recallSession() {
  try {
    return window.sessionStorage.getItem(SESSION_KEY);
  } catch {
    return null;
  }
}

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
  /* setup 定靶 | loading 开场中 | restoring 重连中 | asking 问答中 | closed 已收口 */
  const [phase, setPhase] = useState('setup');
  const [stage, setStage] = useState(0);
  const [error, setError] = useState(null);
  const [session, setSession] = useState(null);
  const [facts, setFacts] = useState([]);
  const [freshIds, setFreshIds] = useState([]);   // 刚落账的那几条，用来高亮
  const [answering, setAnswering] = useState(false);
  const [answerError, setAnswerError] = useState(null);
  const [gone, setGone] = useState(false);        // 会话没了 → 出「重开一场」提示
  /* 已答轮数由后端说了算（投影里的 answered_count，作答后本地 +1）。不能拿
     事实数去推：答「想不起来」的那一轮抽不出事实，账本里一条不留，可它确确
     实实是一轮。事实自己带 `round`，账本的「来自第 N 问」也就不用前端推算。 */
  const [answered, setAnswered] = useState(0);

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
      setSession({ ...result, done: false });
      setFacts([]);
      setFreshIds([]);
      setAnswered(0);
      setAnswerError(null);
      setGone(false);
      rememberSession(result.session_id);
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

  /* 把一份会话投影铺进本地 state。恢复现场和「够了」收口都走它。 */
  const adopt = useCallback((projection) => {
    setSession({
      session_id: projection.session_id,
      baseline_crumb_id: projection.baseline_crumb_id,
      question: projection.question,
      done: projection.done,
      closed_by: projection.closed_by,
    });
    setJdText(projection.jd_text);
    setFacts(projection.facts);
    setFreshIds([]);
    setAnswered(projection.answered_count);
    setAnswerError(null);
    setPhase(projection.done || !projection.question ? 'closed' : 'asking');
  }, []);

  /* 会话恢复：进 Live 屏时拿 sessionStorage 里的 id 试着重连。

     会话 404（后端重启丢了）不是错误路径的一种，是有明确出路的一种状态——
     出「重开一场」提示，而不是把它混进红色报错里吓人。 */
  const restoredRef = useRef(false);
  useEffect(() => {
    if (restoredRef.current) return;
    restoredRef.current = true;
    const saved = recallSession();
    if (!saved) return;

    let cancelled = false;
    setPhase('restoring');
    fetchGrillSession(saved)
      .then((projection) => {
        if (!cancelled) adopt(projection);
      })
      .catch((err) => {
        if (cancelled) return;
        rememberSession(null);
        setPhase('setup');
        if (err instanceof SessionGoneError) setGone(true);
        else setError(err.message);
      });
    return () => { cancelled = true; };
  }, [adopt]);

  const submitAnswer = async ({ questionId, answerText, chosenOption }) => {
    setAnswering(true);
    setAnswerError(null);
    try {
      const result = await submitGrillAnswer(session.session_id, {
        questionId, answerText, chosenOption,
      });
      setFacts((cur) => [...cur, ...result.facts]);
      setFreshIds(result.facts.map((fact) => fact.id));
      setAnswered((n) => n + 1);
      setSession((cur) => ({
        ...cur,
        question: result.question,
        done: result.done,
        closed_by: result.done ? 'exhausted' : null,
      }));
      if (result.done) setPhase('closed');
    } catch (err) {
      if (err instanceof SessionGoneError) {
        rememberSession(null);
        setSession(null);
        setPhase('setup');
        setGone(true);
      } else if (err instanceof AnswerConflictError) {
        /* 这道题已经答过了（重复提交、两个标签页各答各的）。后端把当前状态
           一起交回来了，直接对齐——用户看到的是「进度往前跳了」，不是报错。 */
        if (err.session) adopt(err.session);
        else setAnswerError(err.message);
      } else {
        /* 502 之类：会话没动过（服务端保证失败原子性），同一答案可以直接重发，
           所以作答框里的字一个不动地留着。 */
        setAnswerError(err.message);
      }
    } finally {
      setAnswering(false);
    }
  };

  /* 「够了，去改写」：中断是用户的权利，任何时刻都能行使。

     中断要写进服务端，不能只在前端把屏幕切走——会话恢复读的是服务端投影，
     前端单方面切屏的话，刷新一次就把用户送回他刚走开的那道题。
     会话不删：账本要留给改写那一片用。 */
  const stopEarly = async () => {
    setAnswering(true);
    setAnswerError(null);
    try {
      adopt(await stopGrillSession(session.session_id));
    } catch (err) {
      if (err instanceof SessionGoneError) {
        rememberSession(null);
        setSession(null);
        setPhase('setup');
        setGone(true);
      } else {
        setAnswerError(err.message);
      }
    } finally {
      setAnswering(false);
    }
  };

  const restart = () => {
    rememberSession(null);
    setSession(null);
    setFacts([]);
    setFreshIds([]);
    setAnswered(0);
    setError(null);
    setAnswerError(null);
    setGone(false);
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
        {/* 收口之后这一屏换一种身份：不再是「一次一题」的阅读栏，而是
            左右对照的工作台，所以撑到全宽，定靶那套抬头也不再显示——
            刚问完的人不需要再看一遍「贴一段 JD」。 */}
        <div className={`lwrap live-wrap${phase === 'closed' ? ' wide' : ''}`}>
          {phase !== 'closed' && (
            <>
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
            </>
          )}

          {phase === 'restoring' ? (
            <div className="live-loading" aria-live="polite">
              <span className="live-spin" />
              <div>
                <b>正在接回刚才那一场……</b>
                <small>问到哪、挖到了什么，都在后端存着。</small>
              </div>
            </div>
          ) : null}

          {(phase === 'asking' || phase === 'closed') && session ? (
            <>
              {phase === 'asking' && (
                <div className="live-baseline">
                  <span className="h6">本场底稿</span>
                  {baselineName || session.baseline_crumb_id}
                  <small>新简历会拿它当对比基准——多份简历时取最新的那一份。</small>
                </div>
              )}

              {phase === 'asking' && session.question && (
                <QuestionCard
                  key={session.question.id}
                  question={session.question}
                  round={answered + 1}
                  pending={answering}
                  error={answerError}
                  onSubmit={submitAnswer}
                />
              )}

              {phase === 'closed' && (
                <RewriteView
                  sessionId={session.session_id}
                  crumbs={crumbs}
                  facts={facts}
                  baselineName={baselineName || session.baseline_crumb_id}
                  closedBy={session.closed_by}
                  answered={answered}
                  onRestart={restart}
                />
              )}

              {/* 账本和动作条只在作答阶段显示：收口后账本搬进了成稿对比的
                  出处边栏，「重开一场」搬进了它的工具条——同一个东西不画两遍。 */}
              {phase === 'asking' && (
                <>
                  <FactLedger facts={facts} freshIds={freshIds} />

                  <div className="acts live-acts">
                    {/* 「够了，去改写」任何时刻可用，包括第一题还没答的时候。
                        拷问是用户的工具，不是关卡——不给出口的产品会让人不敢开始。 */}
                    <button type="button" className="act" onClick={stopEarly} disabled={answering}>
                      够了，去改写 →
                    </button>
                    <button type="button" className="act" onClick={restart}>换个 JD 重开一场</button>
                  </div>
                </>
              )}

              <p className="live-note">
                这场拷问的账本存在后端的会话里，session_id 是
                {' '}
                <code>{session.session_id}</code>
                {' '}
                。刷新页面会自动接回来；后端重启会丢掉进行中的会话。
              </p>
            </>
          ) : phase !== 'restoring' && (
            <>
              {gone && (
                /* 会话丢了不是报错，是有出路的一种状态：后端重启会丢掉进行中的
                   会话（内存仓，本切片接受的代价）。所以这里给的是台阶，不是
                   红色警告——JD 还在框里，重贴一次就能接着来。 */
                <div className="live-gone" role="status">
                  <b>刚才那一场不在了</b>
                  后端重启会丢掉进行中的会话。你选的料还在，重开一场就行——
                  已经答过的那几轮得重来。
                </div>
              )}

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
                <RepoBox />

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
