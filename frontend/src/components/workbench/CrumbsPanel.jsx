/* ============================================================
   面板 ①：材料。两组 —— 本场使用中 / 材料库·没进本场，可以互拖。

   这里有一条因果不是装饰：把材料拖出本场，引用它的句子当场变红并标
   「出处已移出」，计数从「有材料出处」挪到「无出处」。
   它和后端 schema 里 source_needs_crumb 那条约束是同一件事。
   ============================================================ */
import Panel from './Panel';
import { sourceIcons } from '../../api';
import { useCrumbLibrary } from '../../state/CrumbLibraryContext';
import { useSession } from '../../state/SessionContext';
import { useUI } from '../../state/UIContext';

function CrumbCard({ crumb, inSession, citations, aimed, onToggle, onDragStart }) {
  return (
    <div
      className={`src${inSession ? '' : ' off'}${citations ? ' hit' : ''}${aimed ? ' aim' : ''}`}
      data-id={crumb.id}
      draggable
      onDragStart={onDragStart}
    >
      <div className="top2">
        <span className="ic" aria-hidden="true">
          {sourceIcons[crumb.type] || '◆'}
        </span>
        <span className="nm">{crumb.name}</span>
        {citations ? (
          <span className="n num" title={`成稿里有 ${citations} 处引用它`}>
            {citations}
          </span>
        ) : null}
      </div>
      <div className="tx">{crumb.text}</div>
      <button
        type="button"
        className="pm2"
        onClick={() => onToggle(crumb.id)}
        title={inSession ? '移出本场' : '加进本场'}
        aria-label={`${inSession ? '把' : '把'}${crumb.name}${inSession ? '移出本场' : '加进本场'}`}
      >
        {inSession ? '−' : '＋'}
      </button>
    </div>
  );
}

export default function CrumbsPanel({ panels }) {
  const { crumbs } = useCrumbLibrary();
  const { sessionCrumbs, draft, actions } = useSession();
  const { aimedCrumbIds } = useUI();

  const inSession = crumbs.filter((c) => sessionCrumbs.has(c.id));
  const outSession = crumbs.filter((c) => !sessionCrumbs.has(c.id));

  /* 「成稿里有几处引用了它」是从活稿模型数出来的，不是去数 DOM。 */
  const citations = {};
  draft?.bullets
    .flatMap((b) => b.segments)
    .concat(draft.intro)
    .forEach((segment) => {
      if (segment.ref) citations[segment.ref] = (citations[segment.ref] || 0) + 1;
    });

  const dropTo = (wantIn) => (event) => {
    event.preventDefault();
    const data = event.dataTransfer.getData('text/plain') || '';
    if (!data.startsWith('crumb:')) return;
    const id = data.slice(6);
    if (sessionCrumbs.has(id) !== wantIn) actions.toggleCrumb(id);
  };

  const startDrag = (id) => (event) => {
    event.dataTransfer.setData('text/plain', `crumb:${id}`);
    event.dataTransfer.effectAllowed = 'move';
  };

  const section = (label, list, wantIn, emptyText) => (
    <div className="crumbsec">
      <div className="csec-h">
        {label}
        <span className={`n num${wantIn ? ' on' : ''}`}>{list.length}</span>
      </div>
      <div
        className="cdrop"
        data-zone={wantIn ? 'in' : 'out'}
        onDragOver={(e) => e.preventDefault()}
        onDrop={dropTo(wantIn)}
      >
        {list.length ? (
          list.map((crumb) => (
            <CrumbCard
              key={crumb.id}
              crumb={crumb}
              inSession={wantIn}
              citations={citations[crumb.id] || 0}
              aimed={aimedCrumbIds.includes(crumb.id)}
              onToggle={actions.toggleCrumb}
              onDragStart={startDrag(crumb.id)}
            />
          ))
        ) : (
          <p className="railnote" style={{ margin: '6px 2px' }}>
            {emptyText}
          </p>
        )}
      </div>
    </div>
  );

  return (
    <Panel
      id="crumbs"
      tone
      icon="◫"
      count={inSession.length}
      title="CRUMBS · 原料"
      headCount={inSession.length}
      panels={panels}
      footer={<small>拖动卡片可以在「本场使用中」和「材料库」之间搬</small>}
    >
      {section(
        '本场使用中',
        inSession,
        true,
        '一条都没有了。成稿里所有蓝色片段都会变成「出处已移出」。',
      )}
      {section('材料库 · 没进本场', outSession, false, '全都装进本场了。')}
      <p className="railnote">
        悬停右边稿子里的<b style={{ color: 'var(--blue)' }}>蓝色</b>片段 → 这里对应那条会高亮。
        <br />
        把材料拖出本场，引用它的句子会当场标红——<b>出处不在了，那句话就不再算「有出处」</b>。
      </p>
    </Panel>
  );
}
