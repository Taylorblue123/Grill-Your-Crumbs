import { useAppearance } from '../../hooks/useAppearance.jsx';
import { useToast } from '../../hooks/useToast.jsx';

export function Brand() {
  return (
    <div className="brand">
      <span className="dot" />
      Grill Your Crumbs
    </div>
  );
}

export function ThemeToggle() {
  const { theme, toggleTheme } = useAppearance();
  const { show } = useToast();
  return (
    <button
      type="button"
      className="theme"
      title="切换深色 / 浅色"
      aria-label="切换主题"
      onClick={() => {
        const next = toggleTheme();
        show(next === 'dark'
          ? '深色：整套系统一起换，落地页也一样。'
          : '浅色：整套系统一起换，落地页也一样。');
      }}
    >
      <span>{theme === 'dark' ? '☀' : '◐'}</span>
    </button>
  );
}

export function SkinToggle() {
  const { skinMeta, cycleSkin } = useAppearance();
  const { show } = useToast();
  return (
    <button
      type="button"
      className="skin"
      title="换一套视觉（编辑部 / 控制台 / 高饱和）"
      onClick={() => {
        const next = cycleSkin();
        show(`视觉：${next.name} —— ${next.note}`);
      }}
    >
      <i />
      <span className="skinName">{skinMeta.name}</span>
    </button>
  );
}

export default function TopBar({ children, nav }) {
  return (
    <div className="top">
      <Brand />
      {nav}
      <div className="tr">
        <ThemeToggle />
        <SkinToggle />
        {children}
      </div>
    </div>
  );
}
