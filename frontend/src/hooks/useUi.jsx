import {
  createContext, useCallback, useContext, useMemo, useState,
} from 'react';

/* ============================================================
   跨面板的瞬时 UI 信号

   有几个交互天生是跨组件的命令，而不是状态：
   「把左边那一轮滚到视野中央」「让所有蓝色片段闪一下」「高亮这几条材料」。
   把它们做成带 key 的信号，接收方 useEffect 监听 key 变化执行一次副作用——
   比用 ref 互相穿透干净，也不会因为重复请求同一个值而不触发。
   ============================================================ */
const UiContext = createContext(null);

const signal = (payload) => ({ ...payload, key: Date.now() + Math.random() });

export function UiProvider({ children }) {
  const [pop, setPop] = useState(null);        // 出处 popover
  const [aimed, setAimed] = useState([]);      // 被高亮的材料 id
  const [flash, setFlash] = useState(null);    // 让某一类片段闪一下
  const [peek, setPeek] = useState(null);      // 跳到某一轮
  const [jump, setJump] = useState(null);      // 跳到 JD 清单的某个分组
  const [bump, setBump] = useState(null);      // 简历面板上的浮动增量提示

  const value = useMemo(() => ({
    pop,
    showPop: (content, anchor) => setPop({ content, rect: anchor.getBoundingClientRect() }),
    hidePop: () => setPop(null),
    aimed,
    setAimed,
    flash,
    requestFlash: (kind) => setFlash(signal({ kind })),
    peek,
    requestPeek: (turnId) => setPeek(signal({ turnId })),
    jump,
    requestJump: (status) => setJump(signal({ status })),
    bump,
    requestBump: (text) => setBump(signal({ text })),
  }), [pop, aimed, flash, peek, jump, bump]);

  return <UiContext.Provider value={value}>{children}</UiContext.Provider>;
}

export function useUi() {
  const ctx = useContext(UiContext);
  if (!ctx) throw new Error('useUi 必须在 UiProvider 内使用');
  return ctx;
}

/* 给节点加一圈临时描边并滚进视野 —— 原型里到处在做这件事，收敛成一个工具。 */
export function useHighlight() {
  return useCallback((node, { scroll = true, style = 'outline', ms = 1300 } = {}) => {
    if (!node) return;
    if (scroll) node.scrollIntoView({ block: 'center', behavior: 'smooth' });
    if (style === 'outline') {
      node.style.outline = '2px solid var(--fg)';
      node.style.outlineOffset = '2px';
      setTimeout(() => { node.style.outline = ''; node.style.outlineOffset = ''; }, ms);
    } else {
      node.style.background = 'var(--gold-bg)';
      node.style.borderRadius = '8px';
      setTimeout(() => { node.style.background = ''; }, ms);
    }
  }, []);
}
