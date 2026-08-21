/* ============================================================
   句子里的一个下拉。三项配置塌缩成一句话 —— 句子本身就是表单，
   这是「不像表单」的关键动作，所以它是一个 <button> + 菜单，
   不是 <select>：设计稿要的是句子里的一个词，不是一个控件。

   键盘可用性按 menu/menuitem 模式补齐（Esc 关、方向键移动、
   焦点回到触发按钮），否则句子表单对键盘用户是死的。
   ============================================================ */
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

export default function SlotMenu({ label, options, value, onPick }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ left: -9999, top: -9999 });
  const triggerRef = useRef(null);
  const menuRef = useRef(null);

  useLayoutEffect(() => {
    if (!open || !menuRef.current || !triggerRef.current) return;
    const menu = menuRef.current.getBoundingClientRect();
    const anchor = triggerRef.current.getBoundingClientRect();
    setPos({
      left: Math.max(10, Math.min(anchor.left, window.innerWidth - menu.width - 16)),
      top:
        anchor.bottom + 6 > window.innerHeight - menu.height
          ? Math.max(10, anchor.top - menu.height - 6)
          : anchor.bottom + 6,
    });
    menuRef.current.querySelector('button[data-on="true"], button')?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    const onDocDown = (event) => {
      if (!menuRef.current?.contains(event.target) && !triggerRef.current?.contains(event.target)) {
        setOpen(false);
      }
    };
    const onKey = (event) => {
      if (event.key === 'Escape') {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    document.addEventListener('mousedown', onDocDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const current = options.find((o) => o.id === value);

  return (
    <>
      <button
        type="button"
        ref={triggerRef}
        className={`slot${open ? ' open' : ''}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`${label}：${current?.label || ''}，点击更改`}
        onClick={() => setOpen((v) => !v)}
      >
        {current?.label || '—'}
        <span className="car" aria-hidden="true">
          ▾
        </span>
      </button>
      {open
        ? createPortal(
            <div
              className="smenu on"
              role="menu"
              aria-label={label}
              ref={menuRef}
              style={{ left: pos.left, top: pos.top }}
              onKeyDown={(event) => {
                const items = [...(menuRef.current?.querySelectorAll('button') || [])];
                const index = items.indexOf(document.activeElement);
                if (event.key === 'ArrowDown') {
                  event.preventDefault();
                  items[(index + 1) % items.length]?.focus();
                }
                if (event.key === 'ArrowUp') {
                  event.preventDefault();
                  items[(index - 1 + items.length) % items.length]?.focus();
                }
              }}
            >
              {options.map((option) => (
                <button
                  type="button"
                  role="menuitemradio"
                  aria-checked={option.id === value}
                  data-on={option.id === value}
                  className={option.id === value ? 'on2' : ''}
                  key={option.id}
                  onClick={() => {
                    onPick(option.id);
                    setOpen(false);
                    triggerRef.current?.focus();
                  }}
                >
                  {option.label}
                  <span className="d2">{option.desc}</span>
                </button>
              ))}
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
