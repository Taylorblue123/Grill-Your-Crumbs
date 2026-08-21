import { useLayoutEffect, useRef, useState } from 'react';
import { useUi } from '../../hooks/useUi.jsx';

/* 出处 popover：贴着触发元素放，放不下就翻到上方。 */
export default function Popover() {
  const { pop } = useUi();
  const ref = useRef(null);
  const [pos, setPos] = useState({ left: -9999, top: -9999 });

  useLayoutEffect(() => {
    if (!pop || !ref.current) return;
    const box = ref.current;
    const r = pop.rect;
    const left = Math.max(10, Math.min(r.left, window.innerWidth - box.offsetWidth - 14));
    const top = r.bottom + 8 > window.innerHeight - 130
      ? r.top - box.offsetHeight - 8
      : r.bottom + 8;
    setPos({ left, top });
  }, [pop]);

  if (!pop) return null;
  const { content } = pop;

  return (
    <div id="pop" role="tooltip" ref={ref} style={{ display: 'block', left: pos.left, top: pos.top }}>
      <div className="h"><em>{content.title}</em></div>
      {content.body}
      {content.kind === 'source' && content.gone && (
        <div style={{
          marginTop: 8, paddingTop: 8, borderTop: '1px solid var(--pop-line)', color: 'var(--red)',
        }}
        >
          ⚠ 这条材料已被移出本场，所以这句话现在没有出处。
        </div>
      )}
      {content.kind === 'grill' && content.facts?.length > 0 && (
        <div style={{
          marginTop: 8, paddingTop: 8, borderTop: '1px solid var(--pop-line)', opacity: 0.72,
        }}
        >
          {`依赖 ${content.facts.length} 条新事实：${content.facts.join(' ／ ')}`}
        </div>
      )}
      {content.kind === 'denom' && content.extra}
    </div>
  );
}
