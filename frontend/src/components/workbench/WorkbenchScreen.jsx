import { useEffect, useMemo, useState } from 'react';
import TopBar from '../shell/TopBar.jsx';
import Stepper from '../shell/Stepper.jsx';
import CrumbsPanel from './CrumbsPanel.jsx';
import GrillPanel from './GrillPanel.jsx';
import DraftPanel from './DraftPanel.jsx';
import LedgerPanel from './LedgerPanel.jsx';
import TargetPanel from './TargetPanel.jsx';
import { useDispatch, useStore } from '../../store/StoreContext.jsx';
import { PANELS, PANEL_LABEL } from '../../store/state.js';
import { curTarget, reqTally } from '../../store/selectors.js';
import { useToast } from '../../hooks/useToast.jsx';
import { useUi } from '../../hooks/useUi.jsx';
import useActions from '../../hooks/useActions.js';

/* 列宽全在这里算。注意 .panels 上不要放 transition:grid-template-columns：
   Safari / Firefox 根本不动画这个属性，而 Chromium 里它会让「面板现在多宽」
   在动画期间读不出来。改成宽度直接吸附 + 内容淡入，跨浏览器一致，也可测。 */
const BASE = {
  crumbs: 'minmax(196px,236px)',
  grill: 'minmax(300px,1.05fr)',
  draft: 'minmax(320px,1.25fr)',
  ledger: 'minmax(260px,0.95fr)',
  target: 'minmax(260px,0.95fr)',
};
const MAXW = {
  crumbs: 'minmax(320px,0.9fr)',
  grill: 'minmax(460px,2.4fr)',
  draft: 'minmax(460px,2.4fr)',
  ledger: 'minmax(400px,2.2fr)',
  target: 'minmax(400px,2.2fr)',
};

function useViewportWidth() {
  const [w, setW] = useState(() => (typeof window === 'undefined' ? 1440 : window.innerWidth));
  useEffect(() => {
    const onResize = () => setW(window.innerWidth);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  return w;
}

export default function WorkbenchScreen({ onTour, tourRunning, composerRef }) {
  const state = useStore();
  const dispatch = useDispatch();
  const actions = useActions();
  const { show } = useToast();
  const ui = useUi();
  const width = useViewportWidth();
  const target = curTarget(state);

  /* 窄屏按优先级自动收，但用户手动点过的面板不会被自动改。 */
  const effective = useMemo(() => {
    const auto = { ...state.panelState };
    if (width < 1180 && auto.crumbs === 'norm' && !state.panelTouched.crumbs) auto.crumbs = 'min';
    if (width < 900 && auto.ledger === 'norm' && !state.panelTouched.ledger) auto.ledger = 'min';
    if (width < 700 && auto.draft === 'norm' && !state.panelTouched.draft) auto.draft = 'min';
    return auto;
  }, [state.panelState, state.panelTouched, width]);

  const gridTemplateColumns = PANELS
    .map((k) => (effective[k] === 'min' ? '46px' : effective[k] === 'max' ? MAXW[k] : BASE[k]))
    .join(' ');

  const cyclePanel = (k) => dispatch({ type: 'cyclePanel', key: k });
  const maxPanel = (k) => {
    const was = state.panelState[k] === 'max';
    dispatch({ type: 'maxPanel', key: k });
    show(was ? `${PANEL_LABEL[k]}恢复正常宽度。` : `${PANEL_LABEL[k]}放大了。再点 ⤢ 恢复。`);
  };

  /* 工作台快捷键：1–5 收放面板，⌘Z 撤回。 */
  useEffect(() => {
    const onKey = (e) => {
      const typingNow = e.target.closest('[contenteditable],input,textarea,select');
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        actions.undo();
        return;
      }
      if (!typingNow && ['1', '2', '3', '4', '5'].includes(e.key)) {
        e.preventDefault();
        cyclePanel(PANELS[+e.key - 1]);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  });

  const panelProps = (key) => ({
    mode: effective[key],
    onCycle: () => cyclePanel(key),
    onMax: () => maxPanel(key),
  });

  const n = target ? reqTally(target, state.active) : null;

  return (
    <section className="screen on" id="s-wb">
      <TopBar nav={<Stepper />}>
        <div className="goal">
          Grill for
          {' '}
          <b>{state.goal}</b>
        </div>
        <button type="button" className="gbtn" disabled={!state.undoStack.length} onClick={actions.undo}>
          撤回上一步
          <kbd>⌘Z</kbd>
        </button>
        <button type="button" className="gbtn" onClick={onTour}>
          {tourRunning ? '停止演示 ❚❚' : '自动演示 ▶'}
        </button>
        <button type="button" className="gbtn pri" onClick={() => dispatch({ type: 'go', screen: 'done' })}>够了，出稿 →</button>
      </TopBar>

      <div className="wb">
        {/* 常驻 Target 条：这一场是为谁做的，永远可见 */}
        <div className="tbar">
          <span className="lb">目标</span>
          {target ? (
            <>
              <span className="tt">
                {target.title}
                <small>{target.org}</small>
              </span>
              <span className="score">
                <button type="button" className="rstat ok jump" onClick={() => { dispatch({ type: 'openPanel', key: 'target' }); ui.requestJump('ok'); }}>
                  <i className="d" />
                  对上
                  {' '}
                  <b>{n.ok}</b>
                </button>
                <button type="button" className="rstat weak jump" onClick={() => { dispatch({ type: 'openPanel', key: 'target' }); ui.requestJump('weak'); }}>
                  <i className="d" />
                  弱
                  {' '}
                  <b>{n.weak}</b>
                </button>
                <button type="button" className="rstat none jump" onClick={() => { dispatch({ type: 'openPanel', key: 'target' }); ui.requestJump('none'); }}>
                  <i className="d" />
                  还能问出
                  {' '}
                  <b>{n.none}</b>
                </button>
                <button type="button" className="rstat gap jump" onClick={() => { dispatch({ type: 'openPanel', key: 'target' }); ui.requestJump('gap'); }}>
                  <i className="d" />
                  确实没有
                  {' '}
                  <b>{n.gap}</b>
                </button>
                <button
                  type="button"
                  className="gbtn"
                  style={{ padding: '3px 10px', fontSize: 11.5 }}
                  onClick={() => { dispatch({ type: 'openPanel', key: 'target' }); maxPanel('target'); }}
                >
                  看清单 →
                </button>
              </span>
            </>
          ) : (
            <>
              <span className="tt none2">这一场没有设定目标 —— 只做通用打磨</span>
              <span className="score">
                <button
                  type="button"
                  className="gbtn"
                  style={{ padding: '3px 10px', fontSize: 11.5 }}
                  onClick={() => dispatch({ type: 'go', screen: 'setup' })}
                >
                  去挑一个目标
                </button>
              </span>
            </>
          )}
        </div>

        <div className={`panelbar${state.barHidden ? ' hid' : ''}`}>
          <span className="pbLabel">面板</span>
          {PANELS.map((k, i) => (
            <button
              type="button"
              className={`pchip${effective[k] !== 'min' ? ' on' : ''}${effective[k] === 'max' ? ' big' : ''}`}
              key={k}
              title={effective[k] === 'min' ? `展开${PANEL_LABEL[k]}` : `收起${PANEL_LABEL[k]}`}
              onClick={() => cyclePanel(k)}
            >
              <span className="sq" />
              {PANEL_LABEL[k]}
              <span className="k">{i + 1}</span>
            </button>
          ))}
          <div className="pbRight">
            <span className="pbLabel" style={{ letterSpacing: '.3px', fontWeight: 500, textTransform: 'none' }}>
              点一下收起 · 再点展开 · ⤢ 放大
            </span>
            <button
              type="button"
              className="gbtn"
              style={{ padding: '3px 10px', fontSize: 11.5 }}
              onClick={() => {
                dispatch({ type: 'resetLayout' });
                show('布局重置了。目标面板默认收起——顶上那条已经告诉你这场是为谁做的。');
              }}
            >
              重置布局
            </button>
          </div>
        </div>

        <div className="panelsWrap">
          <button type="button" className="barToggle" onClick={() => dispatch({ type: 'toggleBar' })}>
            {state.barHidden ? '▼ 展开面板条' : '▲ 收起面板条'}
          </button>
          <div className="panels" style={{ gridTemplateColumns }}>
            <CrumbsPanel {...panelProps('crumbs')} />
            <GrillPanel {...panelProps('grill')} composerRef={composerRef} />
            <DraftPanel {...panelProps('draft')} />
            <LedgerPanel {...panelProps('ledger')} />
            <TargetPanel {...panelProps('target')} />
          </div>
        </div>
      </div>
    </section>
  );
}
