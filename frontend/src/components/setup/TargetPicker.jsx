import { useRef, useState } from 'react';
import { REQ_KIND, TARGETS } from '../../data/demo.js';
import { useDispatch, useStore } from '../../store/StoreContext.jsx';
import { curTarget, reqState, reqTally } from '../../store/selectors.js';
import { useToast } from '../../hooks/useToast.jsx';

const REQ_MARK = { ok: '✓', weak: '◐', none: '○', gap: '✕' };

/* 「① 产出什么（格式）」和「② 为谁做（Target）」是正交的两件事。
   拆开之后事实库能跨 Target 复用：同一段经历挖过一次，对第二个 JD 只补差额。 */
export default function TargetPicker() {
  const state = useStore();
  const dispatch = useDispatch();
  const { show } = useToast();
  const [jdText, setJdText] = useState('');
  const summaryRef = useRef(null);

  const target = curTarget(state);
  const real = TARGETS.filter((t) => !t.entryOnly);

  const parseJD = () => {
    if (jdText.trim().length < 20) {
      show('粘一段真的 JD 进来——职责和要求都要，我才拆得出条目。');
      return;
    }
    dispatch({ type: 'setTarget', id: 'tg1', jdPasting: false });
    show('拆成 14 条要求了。demo 里解析结果是预设的，真实产品里这一步是模型做的。');
    setTimeout(() => summaryRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' }), 200);
  };

  return (
    <>
      <div className="tgopts">
        {real.map((t) => {
          const n = reqTally(t, state.active);
          return (
            <button
              type="button"
              className={`tgopt${state.targetId === t.id && !state.jdPasting ? ' on' : ''}`}
              key={t.id}
              onClick={() => dispatch({ type: 'setTarget', id: t.id, jdPasting: false })}
            >
              <span className="tk">{`${t.kind} · 已收藏`}</span>
              <h5>{t.title}</h5>
              <p>
                {`${t.org} · ${t.reqs.length} 条要求`}
                <br />
                现在对上 <b>{n.ok}</b> · 还能问出 <b>{n.none + n.weak}</b> · 确实没有 <b>{n.gap}</b>
              </p>
            </button>
          );
        })}

        <button
          type="button"
          className={`tgopt${state.jdPasting ? ' on' : ''}`}
          onClick={() => dispatch({ type: 'setTarget', id: state.targetId, jdPasting: true })}
        >
          <span className="tk">＋ 新的</span>
          <h5>贴一段 JD</h5>
          <p>把岗位描述整段粘进来，我拆成一条一条的要求。</p>
        </button>

        <button
          type="button"
          className={`tgopt${state.targetId === null && !state.jdPasting ? ' on' : ''}`}
          onClick={() => dispatch({ type: 'setTarget', id: null, jdPasting: false })}
        >
          <span className="tk none">不设目标</span>
          <h5>只做通用打磨</h5>
          <p>不对任何岗位，就把这段经历本身讲清楚。提问全部走通用维度。</p>
        </button>
      </div>

      {state.jdPasting && (
        <div className="jdpaste" style={{ display: 'block' }}>
          <textarea
            className="ta"
            aria-label="粘贴 JD 原文"
            value={jdText}
            onChange={(e) => setJdText(e.target.value)}
            placeholder="把岗位描述整段粘进来——职责、要求、加分项都要。我会拆成一条一条的要求，再告诉你哪几条你其实有、哪几条只有你能补、哪几条你确实没有。"
          />
          <div className="hint" style={{ display: 'flex', gap: 9, alignItems: 'center', flexWrap: 'wrap' }}>
            <button type="button" className="gbtn" onClick={parseJD}>解析这段 JD →</button>
            <span>解析完你会看到一张<b>要求清单</b>，不是一句「匹配度 78%」。</span>
          </div>
        </div>
      )}

      <div ref={summaryRef}>
        {!target ? (
          <div className="hint">没设目标也能跑——提问会全部走通用维度，成果页不会有 JD 对齐那一栏。</div>
        ) : (
          <div className="picked" style={{ marginTop: 14 }}>
            <h5>{`${target.title} · ${target.org}　共 ${target.reqs.length} 条要求`}</h5>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 10 }}>
              {(() => {
                const n = reqTally(target, state.active);
                return (
                  <>
                    <span className="rstat ok"><i className="d" />已对上 <b>{n.ok}</b></span>
                    <span className="rstat weak"><i className="d" />只有弱证据 <b>{n.weak}</b></span>
                    <span className="rstat none"><i className="d" />还没有，但问得出来 <b>{n.none}</b></span>
                    <span className="rstat gap"><i className="d" />你确实没有 <b>{n.gap}</b></span>
                  </>
                );
              })()}
            </div>
            <div className="reqlist" style={{ padding: '12px 0 0' }}>
              {['weak', 'none', 'gap'].flatMap((st) => target.reqs
                .filter((r) => reqState(r, state.active) === st)
                .slice(0, st === 'gap' ? 2 : 3)
                .map((r) => (
                  <div className={`req ${st}`} key={r.id}>
                    <div className="rh">
                      <span className="mk">{REQ_MARK[st]}</span>
                      <span className="rt">{r.text}</span>
                      <span className={`kd ${r.kind}`}>{REQ_KIND[r.kind]}</span>
                    </div>
                    <div className="ev2">
                      {st === 'gap'
                        ? '↳ 这条问不出来，不会为它生成任何文案。'
                        : <>↳ 这条<b>只有你能补</b>，拷问时会优先问。</>}
                    </div>
                  </div>
                )))}
              <p className="reqnote" style={{ paddingTop: 6 }}>
                …完整清单在工作台右边第五个面板里，随时能展开。
              </p>
            </div>
            <p className="note">
              提问预算 <b>4 : 2</b> —— 6 轮里 4 轮打 JD 缺口，2 轮打「只有你有」的东西。
              只盯着 JD 会把你身上最独特的部分漏掉。
            </p>
          </div>
        )}
      </div>
    </>
  );
}
