/* ============================================================
   面板 ③：简历活稿。每答一题，这里就多一块金色。

   顶部报的是「片段个数」而不是完成度百分比 —— 没人能确定你把一件事
   讲完了没有，但谁都能数清有几句指得出出处。
   ============================================================ */
import { useEffect, useRef, useState } from 'react';
import Panel from './Panel';
import Segment from '../common/Segment';
import { jdChipsFor } from '../../domain/target';
import { useSession } from '../../state/SessionContext';
import { useProvenancePopover } from '../../hooks/useProvenancePopover';
import { useUI } from '../../state/UIContext';

function Bullet({ bullet, target, activeFacts, buildPopover, onFocusSegment, actions }) {
  const chips = jdChipsFor(bullet.reqIds, target, activeFacts);
  return (
    <div
      className={`bul${bullet.thin ? ' thin' : ''}${bullet.promotedFactId ? ' promoted' : ''}`}
      data-b={bullet.index ?? undefined}
      data-p={bullet.promotedFactId}
    >
      <span className="bd" aria-hidden="true">
        —
      </span>
      <span>
        {bullet.segments.map((segment) => (
          <Segment
            key={segment.key}
            segment={segment}
            buildPopover={buildPopover}
            onFocusSegment={onFocusSegment}
          />
        ))}
        {bullet.promotedFactId ? <span className="pbadge">你手动加的</span> : null}
        {chips.length ? (
          <div className="jdrow" style={{ paddingLeft: 0 }}>
            {chips.map((chip) => (
              <span className="jdchip" key={chip.id} title={`JD 第 ${chip.index} 条：${chip.text}`}>
                ↳ JD #{chip.index}
              </span>
            ))}
          </div>
        ) : null}
        {bullet.needsConfirm ? (
          <div className="rowacts">
            <button type="button" className="mini del" onClick={() => actions.killBullet(bullet.index)}>
              删掉这条
            </button>
            <button type="button" className="mini" onClick={() => actions.track('confirm_segment')}>
              我确认，属实
            </button>
          </div>
        ) : null}
        {bullet.promotedFactId ? (
          <div className="rowacts">
            <button
              type="button"
              className="mini del"
              onClick={() => actions.demote(bullet.promotedFactId)}
            >
              从简历移走
            </button>
          </div>
        ) : null}
      </span>
    </div>
  );
}

export default function DraftPanel({ panels, dragging }) {
  const { draft, target, activeFacts, actions } = useSession();
  const { buildPopover, onFocusSegment } = useProvenancePopover({ aim: true });
  const { setAimedCrumbIds } = useUI();
  const [dropOver, setDropOver] = useState(false);
  const [bump, setBump] = useState(null);
  const lastGold = useRef(null);

  const counts = draft?.counts;

  /* 金色片段变多时冒一个小提示 —— 「你刚才那一句，在这儿变成了什么」。 */
  useEffect(() => {
    if (!counts) return;
    if (lastGold.current !== null && counts.gold > lastGold.current) {
      setBump(`稿子里 ${counts.gold} 处金色`);
      const id = setTimeout(() => setBump(null), 1600);
      lastGold.current = counts.gold;
      return () => clearTimeout(id);
    }
    lastGold.current = counts.gold;
    return undefined;
  }, [counts]);

  if (!draft) return null;
  const { total } = counts;

  const flash = (kind) => {
    panels.openPanel('draft');
    setAimedCrumbIds([]);
    actions.track(`highlight_${kind}`);
  };

  return (
    <Panel
      id="draft"
      icon="▤"
      count={counts.gold}
      title="DYNAMIC RESUME · 活稿"
      headCount={counts.gold}
      headExtra={{ hot: true }}
      panels={panels}
      bodyClassName="panel-b out-b"
      beforeBody={
        <div className="out-h">
          <div className="cbar" aria-hidden="true">
            <i className="s" style={{ width: `${(counts.source / total) * 100}%` }} />
            <i className="g" style={{ width: `${(counts.gold / total) * 100}%` }} />
            <i className="f" style={{ width: `${(counts.ghost / total) * 100}%` }} />
          </div>
          <div className="clegend">
            <button type="button" className="cl" onClick={() => flash('source')}>
              <i className="sw s" />
              有材料出处 <b className="num">{counts.source}</b>
            </button>
            <button type="button" className="cl hot" onClick={() => flash('grill')}>
              <i className="sw g" />
              刚挖出来的 <b className="num">{counts.gold}</b>
            </button>
            <button type="button" className="cl" onClick={() => flash('ghost')}>
              <i className="sw f" />
              还没挖到 <b className="num">{counts.ghost}</b>
            </button>
            <button type="button" className="cl" onClick={() => flash('inferred')}>
              <i className="sw i" />
              无出处 <b className="num">{counts.inferred}</b>
            </button>
            <span
              className="denom"
              tabIndex={0}
              title="报的是片段个数，不是完成度 —— 没人能确定你把一件事讲完了没有，但谁都能数清有几句指得出出处。"
            >
              共 {counts.rawTotal} 个片段 ⓘ
            </span>
          </div>
          {bump ? <div className="bump on">{bump}</div> : null}
        </div>
      }
      footer={
        <>
          <button
            type="button"
            className="gbtn"
            style={{ padding: '4px 11px', fontSize: 12 }}
            onClick={() => actions.track('copy_artifact')}
          >
            复制
          </button>
          <button
            type="button"
            className="gbtn"
            style={{ padding: '4px 11px', fontSize: 12 }}
            onClick={() => actions.track('export_md')}
          >
            导出
          </button>
          <small>每答一题，这里就多一块金色</small>
        </>
      }
    >
      <div className="view on" id="viewA">
        <div className="sheet">
          <h4>RESUME · EXPERIENCE</h4>
          <div data-testid="draft-bullets">
            {draft.bullets.map((bullet) => (
              <Bullet
                key={bullet.key}
                bullet={bullet}
                target={target}
                activeFacts={activeFacts}
                buildPopover={buildPopover}
                onFocusSegment={onFocusSegment}
                actions={actions}
              />
            ))}
          </div>

          <div
            className={`dz${dropOver ? ' over' : ''}`}
            data-testid="dropzone"
            style={dragging ? { display: 'flex' } : undefined}
            onDragOver={(e) => {
              e.preventDefault();
              e.dataTransfer.dropEffect = 'copy';
              setDropOver(true);
            }}
            onDragLeave={() => setDropOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDropOver(false);
              const data = e.dataTransfer.getData('text/plain') || '';
              if (data.startsWith('fact:')) actions.promote(data.slice(5));
            }}
          >
            ⤓　把候补事实拖到这里，它就变成简历里的一条 bullet（可撤回）
          </div>

          <h4>自我介绍 · 60 秒版</h4>
          <div className="intro">
            {draft.intro.map((segment) => (
              <Segment
                key={segment.key}
                segment={segment}
                buildPopover={buildPopover}
                onFocusSegment={onFocusSegment}
              />
            ))}
          </div>
        </div>
      </div>
    </Panel>
  );
}
