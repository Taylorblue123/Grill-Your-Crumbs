import { useEffect, useRef } from 'react';

/**
 * 一屏。原型里五屏同时存在、靠 .on 切换；这里由路由决定渲染哪一屏，
 * 所以 .screen 永远带 .on —— 类名保持不变，样式层一个字都不用改。
 *
 * 换屏时把焦点移到主区域并滚回顶部：不这么做的话，键盘用户换页之后
 * 焦点还停在上一页的按钮上，读屏也不会宣读新页面。
 */
export default function Screen({ name, children, title }) {
  const main = useRef(null);

  useEffect(() => {
    main.current?.focus({ preventScroll: true });
  }, [name]);

  return (
    <section
      className="screen on"
      id={`s-${name}`}
      data-screen={name}
      ref={main}
      tabIndex={-1}
      aria-label={title}
    >
      {children}
    </section>
  );
}
