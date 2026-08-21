import { useEffect, useRef } from 'react';
import Panel from './Panel.jsx';
import RichText from '../common/RichText.jsx';
import {
  HARVEST, REQ_KIND, SOURCE_ICON, TURNS, TURN_BY_ID,
} from '../../data/demo.js';
import { useDispatch, useStore } from '../../store/StoreContext.jsx';
import { crumbById, curTarget, justFilled, reqState, reqTally } from '../../store/selectors.js';
import { useToast } from '../../hooks/useToast.jsx';
import { useHighlight, useUi } from '../../hooks/useUi.jsx';

export const REQ_MARK = { ok: '✓', weak: '◐', none: '○', gap: '✕' };
export const REQ_WORD = {
  ok: '已对上', weak: '只有弱证据', none: '还没有 · 问得出来', gap: '你确实没有',
};

/* ============================================================
   面板 ⑤ 目标 JD（默认收起）

   JD 摊开成一张要求清单，不是一个匹配分。四种状态里最重要的是 gap：
   「你确实没有」的要求永远不会被写成简历文案 —— JD 是检查表，不是模板。
   ============================================================ */
export default function TargetPanel({ mode, onCycle, onMax }) {
  const state = useStore();
  const dispatch = useDispatch();
  const { show } = useToast();
  const ui = useUi();
  const highlight = useHighlight();
  const bodyRef = useRef(null);
  const target = curTarget(state);
  const crumbs = crumbById(state);

  /* 顶部 Target 条上的四个数字都能点，跳到清单里对应的分组。 */
  useEffect(() => {
    if (!ui.jump || !target) return;
    const st = ui.jump.status;
    const n = reqTally(target, state.active)[st];
    if (!n) { show(`「${REQ_WORD[st]}」现在是 0 条。`); return; }
    const first = target.reqs.find((r) => reqState(r, state.active) === st);
    highlight(bodyRef.current?.querySelector(`[data-r="${first.id}"]`));
    show(`${REQ_WORD[st]}：${n} 条`);
  }, [ui.jump, target, state.active, highlight, show]);

  /* 从要求清单直接跳到会补上它的那一轮 */
  const askFor = (rid) => {
    const r = target.reqs.find((x) => x.id === rid);
    const turn = TURNS.find((tn) => tn.jdReq && tn.jdReq.includes(rid))
      || TURNS.find((tn) => (tn.harvest || []).some((h) => (r.fills || []).includes(h)));
    if (!turn) { show('这条没有对应的问题——它属于「问不出来」那一类。'); return; }
    dispatch({ type: 'openPanel', key: 'grill' });
    if (TURNS.indexOf(turn) < state.cursor) {
      ui.requestPeek(turn.id);
      show(`第 ${turn.round} 轮已经问过了，它补的就是这一条。`);
    } else {
      show(`这条会在第 ${turn.round} 轮问到：${turn.question.slice(0, 34)}…`);
    }
  };

  if (!target) {
    return (
      <Panel
        id="p-target"
        tone
        mode={mode}
        icon="◎"
        label="目标 JD"
        minCount="—"
        title="目标 · 要求清单"
        count="—"
        onCycle={onCycle}
        onMax={onMax}
        footer={<small>无证据的要求永远不会被写成简历文案</small>}
      >
        <div className="reqlist">
          <p className="reqnote">
            这一场没设目标。
            <br />
            <br />
            设了目标之后，这里会是一张
            <b>要求清单</b>
            ：哪几条你已经有证据、哪几条只有你能补、哪几条你确实没有。提问也会按缺口排优先级。
          </p>
        </div>
      </Panel>
    );
  }

  const n = reqTally(target, state.active);
  const order = ['none', 'weak', 'ok', 'gap'];

  return (
    <Panel
      id="p-target"
      tone
      mode={mode}
      icon="◎"
      label="目标 JD"
      minCount={n.ok}
      title="目标 · 要求清单"
      count={`${n.ok}/${target.reqs.length}`}
      onCycle={onCycle}
      onMax={onMax}
      bodyRef={bodyRef}
      footer={<small>无证据的要求永远不会被写成简历文案</small>}
    >
      <div className="reqlist">
        <p className="reqnote">
          {`${target.title} · ${target.org}　共 `}
          <b>{`${target.reqs.length} 条`}</b>
          要求。
          <br />
          这里报的是
          <b>可数的状态</b>
          ，不是「匹配度 78%」。
        </p>

        {order.map((st) => {
          const list = target.reqs.filter((r) => reqState(r, state.active) === st);
          if (!list.length) return null;
          return (
            <div className="reqsec" key={st}>
              <h6>
                {REQ_WORD[st]}
                <span className="ln" />
                {list.length}
              </h6>
              {list.map((r) => {
                const jf = justFilled(r, state.lastHarvest, state.active);
                const ev = (r.fills || []).filter((h) => state.active.has(h));
                return (
                  <div className={`req ${st}${jf ? ' just' : ''}`} data-r={r.id} key={r.id}>
                    <div className="rh">
                      <span className="mk">{REQ_MARK[st]}</span>
                      <span className="rt">{r.text}</span>
                      <span className={`kd ${r.kind}`}>{REQ_KIND[r.kind]}</span>
                    </div>

                    {st === 'ok' && ev.length > 0 && (
                      <div className="ev2">
                        {`↳ 第 ${TURN_BY_ID[HARVEST[ev[0]].turn].round} 轮挖到：${
                          ev.map((h) => HARVEST[h].text).join(' ／ ')}`}
                      </div>
                    )}
                    {st === 'ok' && !ev.length && r.ev && (
                      <div className="ev2">
                        ↳
                        {' '}
                        {r.ev.map((c) => (
                          <span className="tg src" key={c}>
                            {crumbs[c] ? `${SOURCE_ICON[crumbs[c].type]} ${crumbs[c].name}` : c}
                          </span>
                        ))}
                      </div>
                    )}
                    {st === 'weak' && (
                      <div className="ev2">
                        ↳ <b>差在哪：</b>
                        <RichText html={r.weak.text} />
                        {(r.weak.refs || []).map((c) => (
                          <span className="tg src" key={c}>{crumbs[c]?.name || c}</span>
                        ))}
                        {r.fills && (
                          <button type="button" className="ask" onClick={() => askFor(r.id)}>去问这条 →</button>
                        )}
                      </div>
                    )}
                    {st === 'none' && (
                      <div className="ev2">
                        ↳ 材料里 <b>0 条</b>证据，但这件事<b>问得出来</b>
                        <button type="button" className="ask" onClick={() => askFor(r.id)}>去问这条 →</button>
                      </div>
                    )}
                    {st === 'gap' && (
                      <div className="ev2">↳ 这条<b>问不出来</b>——你确实没有。不会为它生成任何文案。</div>
                    )}
                  </div>
                );
              })}
            </div>
          );
        })}

        {n.gap > 0 && (
          <div className="gapnote">
            <b>{`那 ${n.gap} 条「确实没有」的，我们不会替你圆。`}</b>
            <br />
            市面上按 JD 改简历的工具会给你编一句出来。我们把它留在这儿，是因为
            <b>你需要知道自己真正缺什么</b>
            ——那是去补技能的信号，不是去补文案的信号。
          </div>
        )}
      </div>
    </Panel>
  );
}
