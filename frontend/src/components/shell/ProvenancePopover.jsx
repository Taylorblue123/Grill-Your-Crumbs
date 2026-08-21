import { useLayoutEffect, useRef, useState } from 'react';
import { useUI } from '../../state/UIContext';

/** 出处浮层。先渲染再量自己的尺寸，才能贴着触发元素摆而不出屏。 */
export default function ProvenancePopover() {
  const { popover } = useUI();
  const ref = useRef(null);
  const [pos, setPos] = useState({ left: -9999, top: -9999 });

  useLayoutEffect(() => {
    if (!popover || !ref.current) return;
    const box = ref.current.getBoundingClientRect();
    const anchor = popover.rect;
    setPos({
      left: Math.max(10, Math.min(anchor.left, window.innerWidth - box.width - 14)),
      top:
        anchor.bottom + 8 > window.innerHeight - 130
          ? Math.max(10, anchor.top - box.height - 8)
          : anchor.bottom + 8,
    });
  }, [popover]);

  if (!popover) return null;
  return (
    <div id="pop" role="tooltip" ref={ref} style={{ display: 'block', left: pos.left, top: pos.top }}>
      {popover.content}
    </div>
  );
}
