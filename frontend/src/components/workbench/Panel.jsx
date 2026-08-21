import { forwardRef } from 'react';

/* ============================================================
   面板三态外壳：正常 / 收成边上的竖条（带竖排标签和计数）/ ⤢ 放大

   收起态不是「隐藏」——它保留一条 46px 的竖条，上面有标签和计数，
   所以「这个面板现在有多少东西」在收起时依然可读。
   ============================================================ */
const Panel = forwardRef(({
  id, tone, mode, icon, label, minCount, title, count, countHot,
  onCycle, onMax, headerExtra, children, footer, bodyClassName = 'panel-b', bodyRef,
  beforeBody, afterBody,
}, ref) => (
  <section className={`panel${tone ? ' tone' : ''}${mode === 'min' ? ' min' : ''}`} id={id} ref={ref}>
    <button type="button" className="panel-min" onClick={onCycle} title={`展开${label}`}>
      <span className="ic0">{icon}</span>
      <span className="lbl">{label}</span>
      <span className="n0 num">{minCount}</span>
    </button>

    <div className="panel-h">
      <h3>{title}</h3>
      <span className={`pc${countHot ? ' hot' : ''} num`}>{count}</span>
      <span className="pa">
        {headerExtra}
        <button type="button" className="picon" onClick={onMax} title="放大">⤢</button>
        <button type="button" className="picon" onClick={onCycle} title="收起">‹</button>
      </span>
    </div>

    {beforeBody}
    <div className={bodyClassName} ref={bodyRef}>{children}</div>
    {afterBody}
    {footer && <div className="panel-f">{footer}</div>}
  </section>
));

Panel.displayName = 'Panel';
export default Panel;
