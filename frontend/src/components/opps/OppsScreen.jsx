import TopBar from '../shell/TopBar.jsx';
import { PEERS, TARGETS, VISIBILITY } from '../../data/demo.js';
import { useDispatch, useStore } from '../../store/StoreContext.jsx';
import { reqState, reqTally } from '../../store/selectors.js';
import { useToast, useTrackEvent } from '../../hooks/useToast.jsx';

/* 岗位和人本质是同一件事：拿我的事实去对外部的要求。
   所以这一页和工作区共用同一个事实库，只是换了个方向看。 */
function bestExpFor(target, active) {
  if (target.id === 'tg2') {
    return { title: '校园二手交易平台 · 推荐系统', note: '双塔召回 + 精排，方向完全对得上' };
  }
  return {
    title: '校园二手交易平台 · 推荐系统',
    note: `本场正在挖，已经补上 ${reqTally(target, active).ok} 条`,
  };
}

export default function OppsScreen() {
  const state = useStore();
  const dispatch = useDispatch();
  const track = useTrackEvent();
  const { show } = useToast();
  const go = (screen) => dispatch({ type: 'go', screen });

  const real = TARGETS.filter((t) => !t.entryOnly);
  const entry = TARGETS.find((t) => t.entryOnly);
  const totalNone = real.reduce((a, t) => {
    const n = reqTally(t, state.active);
    return a + n.none + n.weak;
  }, 0);

  /* 「去补缺口」＝ 开一场以这个目标为锚的拷问 —— 岗位和拷问在这里合流 */
  const startFromTarget = (id) => {
    dispatch({ type: 'setTarget', id });
    go('setup');
    const t = TARGETS.find((x) => x.id === id);
    setTimeout(() => show(`目标换成「${t.title}」了。下面的经历列表已经按「能对上几条」重排。`), 300);
  };

  const previewTarget = (id) => {
    dispatch({ type: 'setTarget', id });
    go('wb');
    dispatch({ type: 'openPanel', key: 'target' });
    dispatch({ type: 'maxPanel', key: 'target' });
  };

  return (
    <section className="screen on" id="s-opps">
      <TopBar
        nav={(
          <nav className="topnav" style={{ display: 'flex', gap: 2, marginLeft: 6 }}>
            <button type="button" className="navlink" onClick={() => go('dash')}>工作区</button>
            <button type="button" className="navlink on">机会</button>
            <button type="button" className="navlink" onClick={() => go('landing')}>首页</button>
          </nav>
        )}
      >
        <button type="button" className="gbtn" onClick={() => track('add_target')}>＋ 贴一个 JD</button>
        <button type="button" className="gbtn pri" onClick={() => go('setup')}>＋ 开一场新的 Grill</button>
      </TopBar>

      <div className="scroll">
        <div className="opps">
          <div className="dhead">
            <div>
              <h1>机会</h1>
              <p>
                岗位和人，本质是同一件事——<b>拿你的事实去对外部的要求</b>。
                <br />
                所以这一页和工作区共用同一个事实库，只是换了个方向看。
              </p>
            </div>
          </div>

          <div className={totalNone ? 'inbox' : 'inbox calm'}>
            {totalNone ? (
              <>
                <span className="t">
                  待你决定：<b>{`${real.length} 个机会`}</b>还有 <b>{`${totalNone} 条要求`}</b>能靠拷问补上。
                  <br />
                  <span style={{ opacity: 0.8 }}>补缺口不是改文案——是把你其实做过、但从没说出口的事挖出来。</span>
                </span>
                <span className="a">
                  <button type="button" className="mini2 gold" onClick={() => startFromTarget(real[0].id)}>
                    {`从「${real[0].title}」开始补`}
                  </button>
                </span>
              </>
            ) : (
              <span className="t">所有机会的缺口都补完了。剩下的是你确实没有的，那不是文案能解决的。</span>
            )}
          </div>

          <div className="shelfhead">
            <h2>岗位 / 机会</h2>
            <span className="c num">{TARGETS.length}</span>
            <p>
              每张卡都是可数的：<b>对上几条 · 弱几条 · 还能问出几条 · 你确实没有几条</b>。
              <br />
              点「去补缺口」＝开一场以这个目标为锚的拷问。
            </p>
          </div>

          <div className="oppgrid">
            {real.map((t) => {
              const n = reqTally(t, state.active);
              const best = bestExpFor(t, state.active);
              const gaps = t.reqs.filter((r) => reqState(r, state.active) === 'gap');
              return (
                <div className="opp" key={t.id}>
                  <div className="opp-h">
                    <div className="t1">
                      {t.title}
                      <span className={`kindtag ${t.kind === 'RA' ? 'ra' : ''}`}>{t.kind}</span>
                    </div>
                    <div className="t2">{`${t.org} · 共 ${t.reqs.length} 条要求`}</div>
                  </div>
                  <div className="opp-score">
                    <span className="rstat ok"><i className="d" />对上 <b>{n.ok}</b></span>
                    <span className="rstat weak"><i className="d" />弱 <b>{n.weak}</b></span>
                    <span className="rstat none"><i className="d" />还能问出 <b>{n.none}</b></span>
                    <span className="rstat gap"><i className="d" />确实没有 <b>{n.gap}</b></span>
                  </div>
                  <div className="opp-rel">
                    最相关的经历：<b>{best.title}</b>
                    {best.note && ` · ${best.note}`}
                    <br />
                    {n.gap > 0 && (
                      <>
                        那 <b>{n.gap}</b> 条确实没有的（
                        {gaps.map((r) => r.text.replace(/（.*?）/g, '')).join(' / ')}
                        ）<b>不会被写进稿子</b>。
                      </>
                    )}
                  </div>
                  <div className="opp-f">
                    <button type="button" className="mini2 pri" onClick={() => startFromTarget(t.id)}>去补缺口</button>
                    <button type="button" className="mini2" onClick={() => previewTarget(t.id)}>看要求清单</button>
                    <button type="button" className="mini2" onClick={() => track('tailor_resume')}>出一版稿子</button>
                    <span className="when">{t.when}</span>
                  </div>
                </div>
              );
            })}

            {entry && (
              <div className="opp entry">
                <div className="opp-h">
                  <div className="t1">
                    {entry.title}
                    <span className="kindtag soon">先留个入口</span>
                  </div>
                  <div className="t2">对称匹配 · 和实习/RA 走的不是同一条路</div>
                </div>
                <div className="opp-rel" style={{ paddingTop: 4 }}>
                  实习和 RA 是<b>不对称</b>的：对方发布要求，你去对。
                  <br />
                  合伙人是<b>对称</b>的：双方都是一堆事实，要互相看。
                  <br />
                  这一版先不做设计——它更接近下面「同频的人」那条路，而不是上面的要求清单。
                </div>
                <div className="opp-f">
                  <button type="button" className="mini2" onClick={() => track('cofounder_waitlist')}>留个位置</button>
                  <span className="when">未开始</span>
                </div>
              </div>
            )}
          </div>

          <div className="shelfhead">
            <h2>同频的人</h2>
            <span className="c num">3</span>
            <p>
              不是「猜你喜欢」。每张卡都写清<b>为什么给你看他</b>——
              <br />
              你们哪几个标签重叠、各自的哪一条事实撞在一起。
            </p>
          </div>
          <div className="peerwrap">
            <div className="phdr">
              ⚠ <b>示意 · 数据虚构。</b>
              这一块是 placeholder：真实的匹配需要双边网络，现在还没有。
              放在这里是为了先把<b>「匹配用什么算」</b>这件事定下来 —— 见下面的可见性分层。
            </div>
            <div className="peergrid">
              {PEERS.map((p) => (
                <div className="peer" key={p.id}>
                  <div className="ph">
                    <span className="av2">{p.handle[1].toUpperCase()}</span>
                    <span>
                      <span className="hn">{p.handle}</span>
                      <span className="ln2">{p.line}</span>
                    </span>
                  </div>
                  <div className="why2">为什么给你看他</div>
                  <div className="ovl">
                    {p.overlap.map((x) => <span className="tg dim" key={x}>{`#${x}`}</span>)}
                  </div>
                  <div className="quote">{p.theirs}</div>
                  <div className="mine">{`↳ ${p.mineHint}`}</div>
                  <div className="a2">
                    <button type="button" className="mini2" onClick={() => track('open_peer_thread')}>看他的 thread</button>
                    <button type="button" className="mini2" onClick={() => track('say_hi')}>打招呼</button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="shelfhead">
            <h2>可见性</h2>
            <span className="c">placeholder</span>
            <p>
              你敢把日记丢进来，是因为我们承诺它只用来问问题。
              <br />
              所以<b>匹配只在标签层发生</b>，事实原文默认不公开、逐条放行。
            </p>
          </div>
          <div className="vis">
            {VISIBILITY.map((v) => (
              <div className={`vlayer${v.locked ? ' lock' : ''}`} key={v.key}>
                <div className="vh">
                  <span className="vn">{v.name}</span>
                  <span className={`toggle2${v.on ? ' on' : ''}${v.locked ? ' dis' : ''}`}><i /></span>
                </div>
                <div className="vd">{v.desc}</div>
                <span className={`vs ${v.locked ? 'lockv' : (v.on ? 'on' : 'off')}`}>{v.state}</span>
              </div>
            ))}
          </div>
          <p className="hint" style={{ maxWidth: '70ch', marginTop: 12 }}>
            这三层现在是静态展示。真做的时候，每条事实旁边会有一个可见性小图标，
            工作区顶部会常驻一句「你有 N 条事实是公开的」并能一键收回。
            <b>如果这层没做完，社交那块就不该上线</b>——它会给出一个我们不打算兑现的承诺。
          </p>
        </div>
      </div>
    </section>
  );
}
