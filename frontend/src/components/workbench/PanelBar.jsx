import { PANELS, PANEL_LABEL } from '../../hooks/usePanels';

/** 面板条：四（五）个开关一字排开，显示当前状态。窄屏时它是选项卡。 */
export default function PanelBar({ panels }) {
  return (
    <div
      className={`panelbar${panels.barHidden ? ' hid' : ''}`}
      role={panels.stacked ? 'tablist' : 'group'}
      aria-label="面板"
    >
      <span className="pbLabel">面板</span>
      {PANELS.map((key, index) => {
        const state = panels.stacked
          ? panels.stackedPanel === key
            ? 'norm'
            : 'min'
          : panels.state[key];
        return (
          <button
            type="button"
            className={`pchip${state !== 'min' ? ' on' : ''}${state === 'max' ? ' big' : ''}`}
            id={`chip-${key}`}
            key={key}
            role={panels.stacked ? 'tab' : undefined}
            aria-selected={panels.stacked ? state !== 'min' : undefined}
            aria-pressed={panels.stacked ? undefined : state !== 'min'}
            title={state === 'min' ? `展开${PANEL_LABEL[key]}` : `收起${PANEL_LABEL[key]}`}
            onClick={() => panels.cyclePanel(key)}
          >
            <span className="sq" aria-hidden="true" />
            {PANEL_LABEL[key]}
            <span className="k" aria-hidden="true">
              {index + 1}
            </span>
          </button>
        );
      })}
      <div className="pbRight">
        <span className="pbLabel" style={{ letterSpacing: '.3px', fontWeight: 500, textTransform: 'none' }}>
          点一下收起 · 再点展开 · ⤢ 放大
        </span>
        <button
          type="button"
          className="gbtn"
          style={{ padding: '3px 10px', fontSize: 11.5 }}
          onClick={panels.resetLayout}
        >
          重置布局
        </button>
      </div>
    </div>
  );
}
