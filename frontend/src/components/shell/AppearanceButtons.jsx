import { useAppearance } from '../../state/ThemeContext';
import { useToast } from '../../state/ToastContext';

/** 主题 ◐ 和皮肤 ◧ 两个按钮，五个屏的顶栏都用它，不各写一份。 */
export default function AppearanceButtons() {
  const { theme, skin, toggleTheme, cycleSkin } = useAppearance();
  const { push: toast } = useToast();

  return (
    <>
      <button
        type="button"
        className="theme"
        onClick={() => {
          toggleTheme();
          toast(
            theme === 'dark'
              ? '浅色：整套系统一起换，落地页也一样。'
              : '深色：整套系统一起换，落地页也一样。',
          );
        }}
        title="切换深色 / 浅色"
        aria-label={theme === 'dark' ? '切换到浅色主题' : '切换到深色主题'}
      >
        <span aria-hidden="true">{theme === 'dark' ? '☀' : '◐'}</span>
      </button>
      <button
        type="button"
        className="skin"
        onClick={() => {
          const next = cycleSkin();
          toast(`视觉：${next.name} —— ${next.note}`);
        }}
        title="换一套视觉（编辑部 / 控制台 / 高饱和）"
        aria-label={`当前视觉：${skin.name}，点击切换`}
      >
        <i aria-hidden="true" />
        <span className="skinName">{skin.name}</span>
      </button>
    </>
  );
}
