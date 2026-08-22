import { useEffect, useRef, useState } from 'react';
import Panel from './Panel.jsx';
import Segment from '../common/Segment.jsx';
import { useDispatch, useStore } from '../../store/StoreContext.jsx';
import { buildSheet, counts, curTarget } from '../../store/selectors.js';
import { useToast, useTrackEvent } from '../../hooks/useToast.jsx';
import { useHighlight, useUi } from '../../hooks/useUi.jsx';
import useActions from '../../hooks/useActions.js';

/* JD 对齐标记：和三色出处正交的第二个轴。
   三色回答「这句可信吗」，JD chip 回答「这句有用吗」。
   刻意没做成第四种颜色，否则会和 provenance 打架。 */
function JdChips({ reqIds }) {
  const state = useStore();
  const target = curTarget(state);
  if (!target || !reqIds?.length) return null;
  return reqIds.map((id) => {
    const r = target.reqs.find((x) => x.id === id);
    if (!r) return null;
    const i = target.reqs.indexOf(r) + 1;
    return (
      <span className="jdchip" key={id} title={`JD 第 ${i} 条：${r.text}`}>
        {`↳ JD #${i}`}
      </span>
    );
  });
}

export default function DraftPanel({ mode, onCycle, onMax }) {
  const state = useStore();
  const dispatch = useDispatch();
  const actions = useActions();
  const track = useTrackEvent();
  const { show } = useToast();
  const ui = useUi();
  const highlight = useHighlight();
  const bodyRef = useRef(null);
  const [dzOver, setDzOver] = useState(false);
  const [bump, setBump] = useState(null);

  const sheet = buildSheet(state, { force: false });
  const n = counts(state);

  useEffect(() => {
    if (!ui.bump) return undefined;
    setBump(ui.bump.text);
    const timer = setTimeout(() => setBump(null), 2200);
    return () => clearTimeout(timer);
  }, [ui.bump]);

  /* 点图例 → 把那一类片段全部闪一下，并把第一处滚进视野。 */
  useEffect(() => {
    if (!ui.flash) return;
    const sel = {
      source: '.sg.source:not(.orphan)',
      grill: '.sg.grill:not(.ghost)',
      ghost: '.sg.grill.ghost',
      inferred: '.sg.inferred',
    }[ui.flash.kind];
    const nodes = [...(bodyRef.current?.querySelectorAll(sel) || [])];
    if (!nodes.length) { show('这一类现在是 0 个。'); return; }
    nodes.forEach((node, i) => highlight(node, { scroll: i === 0, ms: 1200 }));
  }, [ui.flash, highlight, show]);

  const flash = (kind) => {
    dispatch({ type: 'openPanel', key: 'draft' });
    ui.requestFlash(kind);
  };

  return (
    <Panel
      id="p-draft"
      mode={mode}
      icon="▤"
      label="简历活稿"
      minCount={n.gold}
      title="DYNAMIC RESUME · 活稿"
      count={n.gold}
      countHot
      onCycle={onCycle}
      onMax={onMax}
      bodyClassName="panel-b out-b"
      bodyRef={bodyRef}
      beforeBody={(
        <div className="out-h">
          <div className="cbar">
            <i className="s" style={{ width: `${(n.srcOK / n.total) * 100}%` }} />
            <i className="g" style={{ width: `${(n.gold / n.total) * 100}%` }} />
            <i className="f" style={{ width: `${(n.ghost / n.total) * 100}%` }} />
          </div>
          <div className="clegend">
            <button type="button" className="cl" onClick={() => flash('source')}>
              <i className="sw s" />
              有材料出处
              {' '}
              <b className="num">{n.srcOK}</b>
            </button>
            <button type="button" className="cl hot" onClick={() => flash('grill')}>
              <i className="sw g" />
              刚挖出来的
              {' '}
              <b className="num">{n.gold}</b>
            </button>
            <button type="button" className="cl" onClick={() => flash('ghost')}>
              <i className="sw f" />
              还没挖到
              {' '}
              <b className="num">{n.ghost}</b>
            </button>
            <button type="button" className="cl" onClick={() => flash('inferred')}>
              <i className="sw i" />
              无出处
              {' '}
              <b className="num">{n.inferred}</b>
            </button>
            <span
              className="denom"
              tabIndex={0}
              role="button"
              onMouseEnter={(e) => ui.showPop({
                kind: 'denom',
                title: '分母是怎么来的',
                body: `成稿被切成 ${n.total} 个可数片段（句子/从句级），每个只有三种归属：`
                  + '有材料出处、刚从你嘴里挖出来、AI 自己补的。',
                extra: (
                  <div style={{ marginTop: 8 }}>
                    报的是<b>片段个数</b>，不是「完成度」——没人能确定你把一件事讲完了没有，
                    但谁都能数清有几句指得出出处。
                    {n.orphan > 0 && (
                      <>
                        <br />
                        <br />
                        其中 <b>{n.orphan} 处</b>的材料被你移出了本场，所以它们现在算「无出处」。
                      </>
                    )}
                  </div>
                ),
              }, e.currentTarget)}
              onMouseLeave={() => ui.hidePop()}
            >
              {`共 ${n.total} 个片段 ⓘ`}
            </span>
          </div>
          <div className={`bump${bump ? ' on' : ''}`}>{bump}</div>
        </div>
      )}
      footer={(
        <>
          <button type="button" className="gbtn" style={{ padding: '4px 11px', fontSize: 12 }} onClick={() => track('copy_artifact')}>复制</button>
          <button type="button" className="gbtn" style={{ padding: '4px 11px', fontSize: 12 }} onClick={() => track('export_md')}>导出</button>
          <small>每答一题，这里就多一块金色</small>
        </>
      )}
    >
      <div className="view on" id="viewA">
        <div className="sheet">
          <h4>RESUME · EXPERIENCE</h4>

          {sheet.bullets.map((b) => (
            <div className={`bul${b.thin ? ' thin' : ''}`} key={b.index}>
              <span className="bd">—</span>
              <span>
                {b.segs.map((s, i) => <Segment key={`${b.index}-${i}`} seg={s} />)}
                {b.reqIds.length > 0 && (
                  <div className="jdrow" style={{ paddingLeft: 0 }}>
                    <JdChips reqIds={b.reqIds} />
                  </div>
                )}
                {b.bad && (
                  <div className="rowacts">
                    <button type="button" className="mini del" onClick={() => actions.killSeg(b.index)}>删掉这条</button>
                    <button type="button" className="mini" onClick={() => track('confirm_segment')}>我确认，属实</button>
                  </div>
                )}
              </span>
            </div>
          ))}

          {sheet.promoted.map((p) => (
            <div className="bul promoted" key={p.id}>
              <span className="bd">—</span>
              <span>
                <Segment seg={p.seg} />
                <span className="pbadge">你手动加的</span>
                <JdChips reqIds={p.reqIds} />
                <div className="rowacts">
                  <button type="button" className="mini del" onClick={() => actions.demote(p.id)}>从简历移走</button>
                </div>
              </span>
            </div>
          ))}

          <div
            className={`dz${dzOver ? ' over' : ''}`}
            onDragOver={(e) => {
              if (!(e.dataTransfer.types || []).includes('text/plain')) return;
              e.preventDefault();
              e.dataTransfer.dropEffect = 'copy';
              setDzOver(true);
            }}
            onDragLeave={() => setDzOver(false)}
            onDrop={(e) => {
              const data = e.dataTransfer.getData('text/plain') || '';
              if (!data.startsWith('fact:')) return;
              e.preventDefault();
              setDzOver(false);
              actions.promote(data.slice(5));
            }}
          >
            ⤓　把候补事实拖到这里，它就变成简历里的一条 bullet（可撤回）
          </div>

          <h4>自我介绍 · 60 秒版</h4>
          <div className="intro">
            {sheet.intro.map((s, i) => <Segment key={`intro-${i}`} seg={s} />)}
          </div>
        </div>
      </div>
    </Panel>
  );
}
