import { PANEL_LABEL } from '../../hooks/usePanels';

/**
 * 面板外壳。收起态是一条 46px 竖条（带竖排标签和计数）——
 * 收起不等于消失，计数还得看得见。
 */
export default function Panel({
  id,
  tone,
  icon,
  count,
  title,
  headCount,
  headExtra,
  footer,
  panels,
  children,
  bodyClassName = 'panel-b',
  beforeBody,
  afterBody,
  bodyRef,
}) {
  const min = !panels.stacked && panels.state[id] === 'min';
  const hidden = panels.stacked && panels.stackedPanel !== id;

  return (
    <section
      className={`panel${tone ? ' tone' : ''}${min ? ' min' : ''}`}
      id={`p-${id}`}
      data-panel={id}
      data-state={panels.stacked ? (hidden ? 'hidden' : 'norm') : panels.state[id]}
      hidden={hidden}
      aria-label={PANEL_LABEL[id]}
    >
      <button
        type="button"
        className="panel-min"
        onClick={() => panels.cyclePanel(id)}
        title={`展开${PANEL_LABEL[id]}面板`}
      >
        <span className="ic0" aria-hidden="true">
          {icon}
        </span>
        <span className="lbl">{PANEL_LABEL[id]}</span>
        <span className="n0 num">{count}</span>
      </button>

      <div className="panel-h">
        <h3>{title}</h3>
        {headCount != null ? <span className={`pc num ${headExtra?.hot ? 'hot' : ''}`}>{headCount}</span> : null}
        <span className="pa">
          {headExtra?.node}
          <button
            type="button"
            className="picon"
            onClick={() => panels.maxPanel(id)}
            title={`放大${PANEL_LABEL[id]}`}
            aria-label={`放大${PANEL_LABEL[id]}面板`}
          >
            ⤢
          </button>
          <button
            type="button"
            className="picon"
            onClick={() => panels.cyclePanel(id)}
            title={`收起${PANEL_LABEL[id]}`}
            aria-label={`收起${PANEL_LABEL[id]}面板`}
          >
            ‹
          </button>
        </span>
      </div>

      {beforeBody}
      <div className={bodyClassName} ref={bodyRef}>
        {children}
      </div>
      {afterBody}
      {footer ? <div className="panel-f">{footer}</div> : null}
    </section>
  );
}
