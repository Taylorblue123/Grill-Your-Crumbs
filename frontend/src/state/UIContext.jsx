/* ============================================================
   跨屏的轻量 UI 状态：出处浮层、材料高亮，以及工作台暴露给外部的几个命令。

   为什么要有 workbench 这一小块「命令注册」：设计稿里，悬停一句蓝色片段
   会同时做两件事 —— 弹出处、并把左边材料面板展开且高亮对应那张卡。
   跨面板的这类祈使动作用回调注册表最直白，比把面板状态提到全局要小得多。
   ============================================================ */
import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';

const UIContext = createContext(null);

export function UIProvider({ children }) {
  const [popover, setPopover] = useState(null); // { content, rect }
  const [aimedCrumbIds, setAimedCrumbIds] = useState([]);
  const workbench = useRef({});

  const showPopover = useCallback((content, element) => {
    if (!element) return;
    setPopover({ content, rect: element.getBoundingClientRect() });
  }, []);
  const hidePopover = useCallback(() => setPopover(null), []);

  const registerWorkbench = useCallback((api) => {
    workbench.current = api || {};
    return () => {
      workbench.current = {};
    };
  }, []);

  const value = useMemo(
    () => ({
      popover,
      showPopover,
      hidePopover,
      aimedCrumbIds,
      setAimedCrumbIds,
      registerWorkbench,
      workbench,
    }),
    [popover, showPopover, hidePopover, aimedCrumbIds, registerWorkbench],
  );

  return <UIContext.Provider value={value}>{children}</UIContext.Provider>;
}

export function useUI() {
  const ctx = useContext(UIContext);
  if (!ctx) throw new Error('useUI 必须在 UIProvider 内使用');
  return ctx;
}
