import {
  createContext, useCallback, useContext, useEffect, useMemo, useState,
} from 'react';

/* 三套皮肤 · 同一个组件层，只换 token。
   三套都必须守住蓝 / 金 / 红三色出处的语义。 */
export const SKINS = [
  { key: 'paper', name: '编辑部', note: '衬线标题 · 纸面 · 留白 —— 靠排版建立可信' },
  { key: 'terminal', name: '控制台', note: '等宽 · 直角 · 发丝线 —— 把数据密集当成优点' },
  { key: 'bold', name: '高饱和', note: '品牌紫 · 大字重 · 圆润块面 —— 用记忆点对抗同质化' },
];

const AppearanceContext = createContext(null);

const initial = (key, fallback) => {
  if (typeof document === 'undefined') return fallback;
  return document.documentElement.dataset[key] || fallback;
};

export function AppearanceProvider({ children }) {
  const [theme, setTheme] = useState(() => initial('theme', 'light'));
  const [skin, setSkin] = useState(() => initial('skin', 'paper'));

  /* token 挂在 <html> 上，所以换主题 / 换皮肤不需要任何组件重渲染样式。 */
  useEffect(() => { document.documentElement.dataset.theme = theme; }, [theme]);
  useEffect(() => { document.documentElement.dataset.skin = skin; }, [skin]);

  /* 下一个值当场算出来再 set —— 调用方要拿它写 toast 文案。
     不能在 setState 的 updater 里算：那个函数是 React 稍后才执行的，
     同步 return 出去只会是 undefined。 */
  const toggleTheme = useCallback(() => {
    const next = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    return next;
  }, [theme]);

  const cycleSkin = useCallback(() => {
    const i = SKINS.findIndex((s) => s.key === skin);
    const next = SKINS[(i + 1) % SKINS.length];
    setSkin(next.key);
    return next;
  }, [skin]);

  const value = useMemo(() => ({
    theme,
    skin,
    skinMeta: SKINS.find((s) => s.key === skin) || SKINS[0],
    setTheme,
    setSkin,
    toggleTheme,
    cycleSkin,
  }), [theme, skin, toggleTheme, cycleSkin]);

  return <AppearanceContext.Provider value={value}>{children}</AppearanceContext.Provider>;
}

export function useAppearance() {
  const ctx = useContext(AppearanceContext);
  if (!ctx) throw new Error('useAppearance 必须在 AppearanceProvider 内使用');
  return ctx;
}
