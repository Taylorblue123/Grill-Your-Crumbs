/* ============================================================
   主题（深/浅）＋ 皮肤（编辑部 / 控制台 / 高饱和）。
   两者都只改 <html> 上的 data-* —— 组件层一个字都不用动，
   这正是设计稿「一套 token，三套皮肤」的实现方式。
   ============================================================ */
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

export const SKINS = [
  { key: 'paper', name: '编辑部', note: '衬线标题 · 纸面 · 留白 —— 靠排版建立可信' },
  { key: 'terminal', name: '控制台', note: '等宽 · 直角 · 发丝线 —— 把数据密集当成优点' },
  { key: 'bold', name: '高饱和', note: '品牌紫 · 大字重 · 圆润块面 —— 用记忆点对抗同质化' },
];

const STORAGE_KEY = 'grill.appearance';
const ThemeContext = createContext(null);

function readStored() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
  } catch {
    return {};
  }
}

export function ThemeProvider({ children }) {
  const stored = useMemo(readStored, []);
  const [theme, setTheme] = useState(stored.theme === 'dark' ? 'dark' : 'light');
  const [skinKey, setSkinKey] = useState(
    SKINS.some((s) => s.key === stored.skin) ? stored.skin : 'paper',
  );

  useEffect(() => {
    const root = document.documentElement;
    root.dataset.theme = theme;
    root.dataset.skin = skinKey;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ theme, skin: skinKey }));
    } catch {
      /* 隐私模式下写不进去也不影响功能 */
    }
  }, [theme, skinKey]);

  const toggleTheme = useCallback(() => setTheme((t) => (t === 'dark' ? 'light' : 'dark')), []);
  const cycleSkin = useCallback(() => {
    let next = SKINS[0];
    setSkinKey((key) => {
      const index = SKINS.findIndex((s) => s.key === key);
      next = SKINS[(index + 1) % SKINS.length];
      return next.key;
    });
    return next;
  }, []);

  const value = useMemo(
    () => ({
      theme,
      setTheme,
      skin: SKINS.find((s) => s.key === skinKey) || SKINS[0],
      cycleSkin,
      toggleTheme,
    }),
    [theme, skinKey, cycleSkin, toggleTheme],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useAppearance() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useAppearance 必须在 ThemeProvider 内使用');
  return ctx;
}
