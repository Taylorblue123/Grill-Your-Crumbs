/* ============================================================
   五面板系统：材料 — 拷问 — 简历活稿 — 收获账本 — 目标 JD。
   每个面板三态：min（收成边上的竖条）/ norm / max（顶开其他）。

   列宽由 JS 拼成 grid-template-columns —— 和原型同一条理由：
   不给它加 transition。Safari / Firefox 根本不动画这个属性，
   Chromium 里又会让「面板现在多宽」在动画期间读不出来（断言会被骗过去）。

   窄屏（<=760px）另走一套：五栏放不下，改成一次只显示一个面板，
   面板条变成选项卡。这是设计稿没覆盖的情况，属于必要的响应式调整。
   ============================================================ */
import { useCallback, useEffect, useMemo, useState } from 'react';

export const PANELS = ['crumbs', 'grill', 'draft', 'ledger', 'target'];
export const PANEL_LABEL = {
  crumbs: '材料',
  grill: '拷问',
  draft: '简历活稿',
  ledger: '收获账本',
  target: '目标 JD',
};
const BASE_WIDTH = {
  crumbs: 'minmax(196px,236px)',
  grill: 'minmax(300px,1.05fr)',
  draft: 'minmax(320px,1.25fr)',
  ledger: 'minmax(260px,0.95fr)',
  target: 'minmax(260px,0.95fr)',
};
const MAX_WIDTH = {
  crumbs: 'minmax(320px,0.9fr)',
  grill: 'minmax(460px,2.4fr)',
  draft: 'minmax(460px,2.4fr)',
  ledger: 'minmax(400px,2.2fr)',
  target: 'minmax(400px,2.2fr)',
};
/* 目标面板默认收起：Target 的上下文由顶部常驻条负责，
   这个面板只在需要和简历并排比对时才展开。 */
export const PANEL_DEFAULT = {
  crumbs: 'norm',
  grill: 'norm',
  draft: 'norm',
  ledger: 'norm',
  target: 'min',
};
const STACK_BREAKPOINT = 760;

function useViewportWidth() {
  const [width, setWidth] = useState(() =>
    typeof window === 'undefined' ? 1440 : window.innerWidth,
  );
  useEffect(() => {
    const onResize = () => setWidth(window.innerWidth);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  return width;
}

export function usePanels() {
  const [state, setState] = useState(PANEL_DEFAULT);
  const [touched, setTouched] = useState({});
  const [stackedPanel, setStackedPanel] = useState('grill');
  const [barHidden, setBarHidden] = useState(false);
  const width = useViewportWidth();
  const stacked = width <= STACK_BREAKPOINT;

  /* 窄屏自动把优先级低的收起，但用户手动点过的面板不会被自动改。 */
  const effective = useMemo(() => {
    const next = { ...state };
    if (width < 1180 && next.crumbs === 'norm' && !touched.crumbs) next.crumbs = 'min';
    if (width < 900 && next.ledger === 'norm' && !touched.ledger) next.ledger = 'min';
    if (width < 700 && next.draft === 'norm' && !touched.draft) next.draft = 'min';
    return next;
  }, [state, touched, width]);

  const gridTemplateColumns = useMemo(
    () =>
      PANELS.map((key) =>
        effective[key] === 'min' ? '46px' : effective[key] === 'max' ? MAX_WIDTH[key] : BASE_WIDTH[key],
      ).join(' '),
    [effective],
  );

  const cyclePanel = useCallback(
    (key) => {
      if (stacked) {
        setStackedPanel(key);
        return;
      }
      setTouched((t) => ({ ...t, [key]: true }));
      setState((s) => ({ ...s, [key]: s[key] === 'min' ? 'norm' : 'min' }));
    },
    [stacked],
  );

  const maxPanel = useCallback(
    (key) => {
      if (stacked) {
        setStackedPanel(key);
        return false;
      }
      let was = false;
      setState((s) => {
        was = s[key] === 'max';
        const next = Object.fromEntries(
          PANELS.map((p) => [p, s[p] === 'max' ? 'norm' : s[p]]),
        );
        next[key] = was ? 'norm' : 'max';
        return next;
      });
      return was;
    },
    [stacked],
  );

  const openPanel = useCallback(
    (key) => {
      if (stacked) {
        setStackedPanel(key);
        return;
      }
      setState((s) => (s[key] === 'min' ? { ...s, [key]: 'norm' } : s));
    },
    [stacked],
  );

  const resetLayout = useCallback(() => {
    setState(PANEL_DEFAULT);
    setTouched({});
    setStackedPanel('grill');
  }, []);

  return {
    state: effective,
    stacked,
    stackedPanel,
    gridTemplateColumns,
    barHidden,
    toggleBar: () => setBarHidden((v) => !v),
    cyclePanel,
    maxPanel,
    openPanel,
    resetLayout,
  };
}
