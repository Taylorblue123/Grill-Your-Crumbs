/* ============================================================
   面板 ⑤：目标 JD 的要求清单。默认收起 —— 上下文由顶部的 Target 条负责，
   这个面板只在需要和简历并排比对时展开。

   报的是可数的状态（对上 / 弱 / 还能问出 / 确实没有），不是「匹配度 78%」。
   ============================================================ */
import { forwardRef, useImperativeHandle, useRef } from 'react';
import Panel from './Panel';
import { sourceIcons } from '../../api';
import { REQ_MARK, REQ_WORD, groupReqsByState, justFilled } from '../../domain/target';
import { useCrumbLibrary } from '../../state/CrumbLibraryContext';
import { useSession } from '../../state/SessionContext';

const TargetPanel = forwardRef(function TargetPanel({ panels, onAskFor }, ref) {
  const { state, target, activeFacts, tally } = useSession();
  const { byId } = useCrumbLibrary();
  const listRef = useRef(null);

  useImperativeHandle(ref, () => ({
    scrollToReq(reqId) {
      const node = listRef.current?.querySelector(`.req[data-r="${reqId}"]`);
      if (!node) return;
      node.scrollIntoView({ block: 'center', behavior: 'smooth' });
      node.style.outline = '2px solid var(--fg)';
      node.style.outlineOffset = '2px';
      setTimeout(() => {
        node.style.outline = '';
      }, 1300);
    },
  }));

  if (!target) {
    return (
      <Panel
        id="target"
        tone
        icon="◎"
        count="—"
        title="目标 · 要求清单"
        headCount="—"
        panels={panels}
        footer={<small>无证据的要求永远不会被写成简历文案</small>}
      >
        <div className="reqlist">
          <p className="reqnote">
            这一场没设目标。
            <br />
            <br />
            设了目标之后，这里会是一张<b>要求清单</b>
            ：哪几条你已经有证据、哪几条只有你能补、哪几条你确实没有。 提问也会按缺口排优先级。
          </p>
        </div>
      </Panel>
    );
  }

  const total = target.reqs.length;
  const newIds = state.pending?.factIds || [];

  return (
    <Panel
      id="target"
      tone
      icon="◎"
      count={tally.ok}
      title="目标 · 要求清单"
      headCount={`${tally.ok}/${total}`}
      panels={panels}
      footer={<small>无证据的要求永远不会被写成简历文案</small>}
    >
      <div className="reqlist" ref={listRef} data-testid="req-list">
        <p className="reqnote">
          {target.title} · {target.org}　共 <b>{total} 条</b>要求。
          <br />
          这里报的是<b>可数的状态</b>，不是「匹配度 78%」。
        </p>

        {groupReqsByState(target, activeFacts).map(([groupState, list]) => (
          <div className="reqsec" key={groupState}>
            <h6>
              {REQ_WORD[groupState]}
              <span className="ln" />
              {list.length}
            </h6>
            {list.map((req) => {
              const evidence = (req.fills || []).filter((h) => activeFacts.has(h));
              const filled = justFilled(req, newIds, activeFacts);
              return (
                <div
                  className={`req ${groupState}${filled ? ' just' : ''}`}
                  data-r={req.id}
                  key={req.id}
                >
                  <div className="rh">
                    <span className="mk" aria-hidden="true">
                      {REQ_MARK[groupState]}
                    </span>
                    <span className="rt">{req.text}</span>
                    <span className={`kd ${req.kind}`}>{state.reqKind[req.kind]}</span>
                  </div>

                  {groupState === 'ok' && evidence.length ? (
                    <div className="ev2">
                      ↳ 第 {state.turns.find((t) => t.id === state.harvest[evidence[0]].turn)?.round}{' '}
                      轮挖到：{evidence.map((h) => state.harvest[h].text).join(' ／ ')}
                    </div>
                  ) : null}

                  {groupState === 'ok' && !evidence.length && req.ev ? (
                    <div className="ev2">
                      ↳{' '}
                      {req.ev.map((cid) => {
                        const crumb = byId[cid];
                        return crumb ? (
                          <span className="tg ref" key={cid}>
                            {sourceIcons[crumb.type] || '◆'} {crumb.name}
                          </span>
                        ) : null;
                      })}
                    </div>
                  ) : null}

                  {groupState === 'weak' ? (
                    <div className="ev2">
                      ↳ <b>差在哪：</b>
                      {req.weak.text}
                      {(req.weak.refs || []).map((cid) =>
                        byId[cid] ? (
                          <span className="tg ref" key={cid}>
                            {byId[cid].name}
                          </span>
                        ) : null,
                      )}
                      {req.fills ? (
                        <button type="button" className="ask" onClick={() => onAskFor(req.id)}>
                          去问这条 →
                        </button>
                      ) : null}
                    </div>
                  ) : null}

                  {groupState === 'none' ? (
                    <div className="ev2">
                      ↳ 材料里 <b>0 条</b>证据，但这件事<b>问得出来</b>
                      <button type="button" className="ask" onClick={() => onAskFor(req.id)}>
                        去问这条 →
                      </button>
                    </div>
                  ) : null}

                  {groupState === 'gap' ? (
                    <div className="ev2">
                      ↳ 这条<b>问不出来</b>——你确实没有。不会为它生成任何文案。
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        ))}

        {tally.gap ? (
          <div className="gapnote">
            <b>那 {tally.gap} 条「确实没有」的，我们不会替你圆。</b>
            <br />
            市面上按 JD 改简历的工具会给你编一句出来。我们把它留在这儿，是因为
            <b>你需要知道自己真正缺什么</b>——那是去补技能的信号，不是去补文案的信号。
          </div>
        ) : null}
      </div>
    </Panel>
  );
});

export default TargetPanel;
