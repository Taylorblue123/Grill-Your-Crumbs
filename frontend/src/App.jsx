import { useCallback, useEffect, useRef } from 'react';
import LandingScreen from './components/landing/LandingScreen.jsx';
import DashScreen from './components/dash/DashScreen.jsx';
import OppsScreen from './components/opps/OppsScreen.jsx';
import SetupScreen from './components/setup/SetupScreen.jsx';
import WorkbenchScreen from './components/workbench/WorkbenchScreen.jsx';
import DoneScreen from './components/done/DoneScreen.jsx';
import LiveScreen from './components/live/LiveScreen.jsx';
import Toast from './components/common/Toast.jsx';
import Popover from './components/common/Popover.jsx';
import { useDispatch, useStore } from './store/StoreContext.jsx';
import { PANELS } from './store/state.js';
import { useAppearance } from './hooks/useAppearance.jsx';
import { useUi } from './hooks/useUi.jsx';
import useBackendSync from './hooks/useBackend.js';
import useTour from './hooks/useTour.js';

/* 深链：#screen=wb&round=3&way=pick&ledger=tag&panel=crumbs:min,draft:max&promote=h10&drop=c4&theme=dark&saved=1
   直接跳到某个状态 —— 评审、截图、回归都靠它。

   和原型的区别：原型每次都是整页加载，读一次 hash 就够了；SPA 改 hash 不会
   重新挂载，所以这里也监听 hashchange，让深链真的能当链接用（贴给别人、
   在地址栏改一下就跳）。带参数的 hash 会先 restart，保证落到干净的目标状态。 */
function useHashRoute() {
  const dispatch = useDispatch();
  const { setTheme, setSkin } = useAppearance();
  const applied = useRef(null);

  const apply = useCallback((first) => {
    const raw = window.location.hash.slice(1);
    if (raw === applied.current) return;
    applied.current = raw;
    const p = new URLSearchParams(raw);
    if (!p.toString()) return;
    if (!first) dispatch({ type: 'restart' });

    if (p.get('skin')) setSkin(p.get('skin'));
    if (p.get('theme') === 'dark') setTheme('dark');
    if (p.has('round')) dispatch({ type: 'seek', n: +p.get('round') });
    if (p.has('way')) dispatch({ type: 'setWay', way: p.get('way') });
    if (p.has('ledger')) dispatch({ type: 'setLedgerKey', key: p.get('ledger') });
    if (p.has('target')) {
      dispatch({ type: 'setTarget', id: p.get('target') === 'none' ? null : p.get('target') });
    }
    if (p.has('saved')) dispatch({ type: 'saveSession' });
    if (p.has('promote')) {
      p.get('promote').split(',').forEach((id) => dispatch({ type: 'promote', id }));
    }
    if (p.has('drop')) {
      p.get('drop').split(',').forEach((id) => dispatch({ type: 'toggleCrumb', id }));
    }
    if (p.has('panel')) {
      const patch = {};
      p.get('panel').split(',').forEach((x) => {
        const [k, v] = x.split(':');
        if (PANELS.includes(k)) patch[k] = v || 'min';
      });
      dispatch({ type: 'setPanelState', patch });
    }
    if (p.get('screen')) dispatch({ type: 'go', screen: p.get('screen') });
  }, [dispatch, setTheme, setSkin]);

  useEffect(() => {
    apply(true);
    const onHashChange = () => apply(false);
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, [apply]);
}

export default function App() {
  const state = useStore();
  const ui = useUi();
  const { cycleSkin } = useAppearance();
  const composerRef = useRef(null);
  const jdBoardRef = useRef(null);
  const doneScrollRef = useRef(null);

  useBackendSync();
  useHashRoute();

  const tour = useTour({ composerRef, jdBoardRef, doneScrollRef });

  /* 全局键位：Esc 接管演示 / 关 popover，s 换皮肤（不在输入时）。 */
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') {
        tour.stop();
        ui.hidePop();
        return;
      }
      const typingNow = e.target.closest('[contenteditable],input,textarea,select');
      if (!typingNow && e.key.toLowerCase() === 's' && !e.metaKey && !e.ctrlKey) cycleSkin();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [tour, ui, cycleSkin]);

  /* 进工作台时把焦点放进输入框 —— 这一屏的主要动作就是回答。 */
  useEffect(() => {
    if (state.screen === 'wb') composerRef.current?.focus();
  }, [state.screen]);

  const tourProps = { onTour: tour.start, tourRunning: tour.running };

  return (
    <>
      <div className="stage">
        {state.screen === 'landing' && <LandingScreen {...tourProps} />}
        {state.screen === 'dash' && <DashScreen {...tourProps} />}
        {state.screen === 'opps' && <OppsScreen />}
        {state.screen === 'setup' && <SetupScreen {...tourProps} />}
        {state.screen === 'wb' && <WorkbenchScreen {...tourProps} composerRef={composerRef} />}
        {state.screen === 'done' && (
          <DoneScreen jdBoardRef={jdBoardRef} scrollRef={doneScrollRef} />
        )}
        {/* 真实链路。剧本 demo 的所有屏共用全局 store，这一屏只借它的材料列表，
            拷问会话状态全在组件内部——两条路互不干扰。 */}
        {state.screen === 'live' && <LiveScreen />}
      </div>

      <Popover />
      <Toast />

      <div className={`autobar${tour.running ? ' on' : ''}`}>
        <span className="t">
          自动演示 ·
          {' '}
          <b>{tour.caption}</b>
        </span>
        <button type="button" onClick={tour.stop}>停止并接管</button>
      </div>
    </>
  );
}
