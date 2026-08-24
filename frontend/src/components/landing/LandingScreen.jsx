import { useRef } from 'react';
import TopBar from '../shell/TopBar.jsx';
import Segment from '../common/Segment.jsx';
import { ARTIFACT } from '../../data/demo.js';
import { useDispatch } from '../../store/StoreContext.jsx';

const WHY = [
  {
    n: '01 · 它先说出它不知道什么',
    h: '每个问题都带一句「我为什么问这个」，理由必须指向具体的某一条材料。',
    p: '它不会问「能再多讲讲吗」。它会告诉你：这件事在你的 8 份材料里出现过几次、缺的是哪一块。',
    ex: (
      <>
        「你的 X 动态里已经写了 CTR 1.8%→3.1%，
        <b>所以这段我不问</b>
        。我不确定的是：这个提升换算成业务是什么——
        <b>八份材料里没有一份提到过</b>
        。」
      </>
    ),
  },
  {
    n: '02 · 每一句话都指得出出处',
    h: '三色标注贯穿全稿：蓝色来自材料，金色来自你刚说的原话，红色是 AI 补的。',
    p: '金色片段硬绑到「第几轮、你的哪句原话」。指不出来源的句子会自动降级成红色并要求你确认——模型没法自说自话。',
    ex: (
      <>
        成稿最后一条是句无出处的套话，我们
        <b>故意没有藏起来</b>
        ：它标红、挂着「无出处」角标、旁边就是【删掉这条】。
      </>
    ),
  },
  {
    n: '03 · 挖到的东西留得下来',
    h: '每条新事实是可数、带标签、可撤回的独立条目，攒进你自己的事实库。',
    p: (
      <>
        我们不给「完成度 78%」这种没人能验证的数字——没人能确定性地知道你「讲完」了没有。我们只给
        <b>能数清的东西</b>
        ，而且这些条目下次写别的简历还能接着用。
      </>
    ),
    ex: (
      <>
        这也是为什么会有一个
        {' '}
        <b>Dashboard</b>
        ：Thread、简历版本、事实库都在那儿沉淀，而不是聊完就没了。
      </>
    ),
  },
];

const FLOW = [
  { t: '40 秒', i: '①', h: '投喂', p: '粘一段你写得最烂的经历，勾上要用的 crumbs，选一个目标（投简历 / LinkedIn / 面试自我介绍）。' },
  { t: '3 分钟', i: '②', h: '拷问', p: '一次一问，每题先给你一个猜测答案——点头就行，不用从头写。不想答可以跳过，问得烂可以骂它。' },
  { t: '同步发生', i: '③', h: '活稿在右边长', p: '不用等到最后。你每答一题，右边稿子里对应的灰色骨架就当场变成金色，左边账本多出几条。' },
  { t: '30 秒', i: '④', h: '成果，然后回工作区', p: '原文和成稿并排。导出之后，这场 Thread、这份简历、这些事实都会落进你的 Dashboard。' },
];

const PROMISES = [
  '你的原文一个字都不会被改，它是最后的对比基准',
  '任何一轮都能撤回，稿子跟着回退',
  '问得烂就点「这问题没意义」，它会承认并换一个',
  '结束时你拿到：简历 bullet ＋ 60 秒自我介绍 ＋ 一条可分享的 Thread',
];

export default function LandingScreen({ onTour, tourRunning }) {
  const dispatch = useDispatch();
  const scrollRef = useRef(null);
  const whyRef = useRef(null);
  const howRef = useRef(null);

  const goDash = () => dispatch({ type: 'go', screen: 'dash' });
  /* 真实链路的独立入口。和「进入我的工作区」并列而不是藏在里面——
     它要能证明「这不是录像」，就得自己有一个门。 */
  const goLive = () => dispatch({ type: 'go', screen: 'live' });
  const scrollTo = (ref) => {
    if (scrollRef.current && ref.current) {
      scrollRef.current.scrollTo({ top: ref.current.offsetTop - 40, behavior: 'smooth' });
    }
  };

  return (
    <section className="screen on" id="s-landing">
      <TopBar
        nav={(
          <nav className="topnav" style={{ display: 'flex', gap: 2, marginLeft: 6 }}>
            <button type="button" className="navlink" onClick={() => scrollTo(whyRef)}>它凭什么不一样</button>
            <button type="button" className="navlink" onClick={() => scrollTo(howRef)}>5 分钟里发生什么</button>
          </nav>
        )}
      >
        <button type="button" className="btn ghost sm" onClick={onTour}>
          {tourRunning ? '停止演示 ❚❚' : '看一遍完整演示 ▶'}
        </button>
        <button type="button" className="btn ghost sm" onClick={goLive}>真实拷问 ⚡</button>
        <button type="button" className="btn sm" onClick={goDash}>进入我的工作区</button>
      </TopBar>

      <div className="scroll" ref={scrollRef}>
        <div className="herowrap">
          <div className="lwrap">
            <div className="hero">
              <div>
                <span className="kick">RESUME · NETWORKING · 面试自我介绍</span>
                <h1>
                  你的经历写得干巴巴，
                  <br />
                  不是因为你写得差——
                  <br />
                  是
                  <em>没人问过你正确的问题</em>
                  。
                </h1>
                <p className="lede">
                  把简历、GitHub、笔记、日记、社交动态全丢进来。我先读一遍，然后
                  <b>只问那些你不说就没人知道</b>
                  的问题。你答一句，右边那份稿子就长一块——
                  <b>每一句都能点开看出处</b>
                  。
                </p>
                <div className="hcta">
                  <button type="button" className="btn" onClick={goDash}>进入我的工作区 →</button>
                  <button type="button" className="btn ghost" onClick={onTour}>先看一遍完整演示</button>
                  <button type="button" className="btn ghost" onClick={goLive}>
                    真实拷问 ⚡
                  </button>
                </div>
                <p className="hnote">
                  约 5 分钟 · 5～6 个问题 · 全程可撤回 · 无需注册
                  <code>demo 数据为虚构样例</code>
                  <code>「真实拷问」走真模型，问题是现问的</code>
                </p>
              </div>

              <div className="spec">
                <div className="st">
                  AFTER · 6 轮拷问之后
                  <span className="pill">悬停任意高亮 → 看出处</span>
                </div>
                <div className="body">
                  {ARTIFACT.self_intro.map((s, i) => (
                    <Segment key={`${s.o}-${i}`} seg={{ ...s, on: true }} panelAware={false} />
                  ))}
                </div>
                <div className="foot">
                  <span><i style={{ background: 'var(--blue)' }} />来自你已有的材料</span>
                  <span><i style={{ background: 'var(--gold)' }} />刚从你嘴里挖出来的</span>
                  <span><i style={{ border: '1.5px dashed var(--red)' }} />AI 补的，请你确认</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="band" ref={whyRef}>
          <div className="lwrap">
            <h2>「这不就是 ChatGPT 帮你改简历吗？」</h2>
            <p className="sub">不是。差别就三条，而且每一条都长在界面上，不在话术里。</p>
            <div className="cards3">
              {WHY.map((c) => (
                <div className="c3" key={c.n}>
                  <div className="n">{c.n}</div>
                  <h3>{c.h}</h3>
                  <p>{c.p}</p>
                  <div className="ex">{c.ex}</div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="band" ref={howRef}>
          <div className="lwrap">
            <h2>接下来这 5 分钟会发生什么</h2>
            <p className="sub">先把预期讲清楚，再开始。你随时知道自己在第几步、还剩几步。</p>
            <div className="flow">
              {FLOW.map((f) => (
                <div className="fs" key={f.i}>
                  <span className="t">{f.t}</span>
                  <div className="i">{f.i}</div>
                  <h4>{f.h}</h4>
                  <p>{f.p}</p>
                </div>
              ))}
            </div>
            <div className="promise">
              {PROMISES.map((p) => (
                <span className="pm" key={p}>
                  <em>✓</em>
                  {' '}
                  {p}
                </span>
              ))}
            </div>
          </div>
        </div>

        <div className="endcta">
          <div className="lwrap">
            <h2>把那 73 个字，换成一份指得出出处的稿子。</h2>
            <p>不用注册，数据留在本地。演示用的是一份虚构样例。</p>
            <div className="row">
              <button type="button" className="btn" onClick={goDash}>进入我的工作区 →</button>
              <button type="button" className="btn ghost" onClick={onTour}>看一遍完整演示</button>
            </div>
          </div>
          <p className="lfoot">Grill Your Crumbs · React 前端 · FastAPI 后端 · 演示数据为虚构样例</p>
        </div>
      </div>
    </section>
  );
}
