import { useState } from 'react';
import Panel from './Panel.jsx';
import { SOURCE_ICON } from '../../data/demo.js';
import { useStore } from '../../store/StoreContext.jsx';
import { buildSheet } from '../../store/selectors.js';
import { useUi } from '../../hooks/useUi.jsx';
import useActions from '../../hooks/useActions.js';

/* ============================================================
   面板 ① 材料：本场使用中 / 材料库，两组之间可拖可点

   这里有一条真实的因果，不是装饰：把材料拖出本场，引用它的句子当场变红并
   标「出处已移出」，计数从「有材料出处」挪到「无出处」。它和后端 schema 里
   `source_needs_crumb` 那条约束是同一件事——出处没了，那句话就不再算有出处。
   ============================================================ */
function CrumbCard({ crumb, used, aimed, onToggle }) {
  const on = crumb.inSession;
  return (
    <div
      className={`src${on ? '' : ' off'}${used ? ' hit' : ''}${aimed ? ' aim' : ''}`}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData('text/plain', `crumb:${crumb.id}`);
        e.dataTransfer.effectAllowed = 'move';
      }}
    >
      <div className="top2">
        <span className="ic">{SOURCE_ICON[crumb.type]}</span>
        <span className="nm">{crumb.name}</span>
        <span className="n num">{used || 1}</span>
      </div>
      <div className="tx">{crumb.text}</div>
      <button
        type="button"
        className="pm2"
        title={on ? '移出本场' : '加进本场'}
        onClick={() => onToggle(crumb.id)}
      >
        {on ? '−' : '＋'}
      </button>
    </div>
  );
}

export default function CrumbsPanel({ mode, onCycle, onMax }) {
  const state = useStore();
  const { aimed } = useUi();
  const { toggleCrumb } = useActions();
  const [over, setOver] = useState(null);

  const inSession = state.crumbs.filter((c) => state.sessionCrumbs.has(c.id));
  const outSession = state.crumbs.filter((c) => !state.sessionCrumbs.has(c.id));

  /* 稿子里每条材料被引用了几次 —— 从稿子模型数，不去数 DOM。 */
  const sheet = buildSheet(state, { force: false });
  const usage = {};
  [...sheet.bullets.flatMap((b) => b.segs), ...sheet.intro]
    .filter((s) => s.o === 'source')
    .forEach((s) => { usage[s.ref] = (usage[s.ref] || 0) + 1; });

  const dropTo = (zone) => (e) => {
    const data = e.dataTransfer.getData('text/plain') || '';
    if (!data.startsWith('crumb:')) return;
    e.preventDefault();
    setOver(null);
    const id = data.slice(6);
    if (state.sessionCrumbs.has(id) !== (zone === 'in')) toggleCrumb(id);
  };

  const zoneProps = (zone) => ({
    className: `cdrop${over === zone ? ' over' : ''}`,
    onDragOver: (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; setOver(zone); },
    onDragLeave: () => setOver((cur) => (cur === zone ? null : cur)),
    onDrop: dropTo(zone),
  });

  return (
    <Panel
      id="p-crumbs"
      tone
      mode={mode}
      icon="◫"
      label="材料"
      minCount={inSession.length}
      title="CRUMBS · 原料"
      count={inSession.length}
      onCycle={onCycle}
      onMax={onMax}
      footer={<small>拖动卡片可以在「本场使用中」和「材料库」之间搬</small>}
    >
      <div className="crumbsec">
        <div className="csec-h">
          本场使用中
          <span className="n on num">{inSession.length}</span>
        </div>
        <div {...zoneProps('in')}>
          {inSession.length ? inSession.map((c) => (
            <CrumbCard
              key={c.id}
              crumb={{ ...c, inSession: true }}
              used={usage[c.id]}
              aimed={aimed.includes(c.id)}
              onToggle={toggleCrumb}
            />
          )) : (
            <p className="railnote" style={{ margin: '6px 2px' }}>
              一条都没有了。成稿里所有蓝色片段都会变成「出处已移出」。
            </p>
          )}
        </div>
      </div>

      <div className="crumbsec">
        <div className="csec-h">
          材料库 · 没进本场
          <span className="n num">{outSession.length}</span>
        </div>
        <div {...zoneProps('out')}>
          {outSession.length ? outSession.map((c) => (
            <CrumbCard
              key={c.id}
              crumb={{ ...c, inSession: false }}
              used={usage[c.id]}
              aimed={aimed.includes(c.id)}
              onToggle={toggleCrumb}
            />
          )) : (
            <p className="railnote" style={{ margin: '6px 2px' }}>全都装进本场了。</p>
          )}
        </div>
      </div>

      <p className="railnote">
        悬停右边稿子里的
        <b style={{ color: 'var(--blue)' }}>蓝色</b>
        片段 → 这里对应那条会高亮。
        <br />
        把材料拖出本场，引用它的句子会当场标红——
        <b>出处不在了，那句话就不再算「有出处」</b>
        。
      </p>
    </Panel>
  );
}
