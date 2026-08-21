/* ③ 工作台 · 五面板：材料 — 拷问 — 简历活稿 — 收获账本 — 目标 JD。 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import TopBar from '../components/shell/TopBar';
import Screen from '../components/shell/Screen';
import Stepper from '../components/shell/Stepper';
import PanelBar from '../components/workbench/PanelBar';
import TargetBar from '../components/workbench/TargetBar';
import CrumbsPanel from '../components/workbench/CrumbsPanel';
import GrillPanel from '../components/workbench/GrillPanel';
import DraftPanel from '../components/workbench/DraftPanel';
import LedgerPanel from '../components/workbench/LedgerPanel';
import TargetPanel from '../components/workbench/TargetPanel';
import { PANELS, usePanels } from '../hooks/usePanels';
import { REQ_WORD, reqState } from '../domain/target';
import { useSession } from '../state/SessionContext';
import { useToast } from '../state/ToastContext';
import { useUI } from '../state/UIContext';
import { ROUTES } from '../routes';

export default function WorkbenchPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { state, target, tally, budget, actions } = useSession();
  const { push: toast } = useToast();
  const { registerWorkbench } = useUI();
  const panels = usePanels();
  const composerRef = useRef(null);
  const targetPanelRef = useRef(null);
  const [tip, setTip] = useState({ text: '想自己说？直接在下面的输入框里写，回车发送。', hot: false });
  const [dragging, setDragging] = useState(false);

  const outputLabel = state.goals[Number(state.outputId.slice(1))] || state.goals[0] || '';

  /* 跨组件的祈使动作（悬停蓝色片段展开材料面板等）从这里拿到入口。 */
  useEffect(() => registerWorkbench({ openPanel: panels.openPanel }), [registerWorkbench, panels.openPanel]);

  /* 深链：/workbench?panel=ledger 直接把某个面板打开。 */
  const requestedPanel = searchParams.get('panel');
  useEffect(() => {
    if (requestedPanel && PANELS.includes(requestedPanel)) panels.openPanel(requestedPanel);
    // 只在首次带参进入时执行
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestedPanel]);

  useEffect(() => {
    composerRef.current?.focus();
  }, []);

  /* 快捷键：1–5 收放面板，⌘Z 撤回。输入框里不抢键。 */
  useEffect(() => {
    const onKey = (event) => {
      const typing = event.target.closest('input,textarea,[contenteditable]');
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        actions.undo();
        return;
      }
      if (!typing && ['1', '2', '3', '4', '5'].includes(event.key)) {
        event.preventDefault();
        panels.cyclePanel(PANELS[Number(event.key) - 1]);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [actions, panels]);

  useEffect(() => {
    const stop = () => setDragging(false);
    document.addEventListener('dragend', stop);
    document.addEventListener('drop', stop);
    return () => {
      document.removeEventListener('dragend', stop);
      document.removeEventListener('drop', stop);
    };
  }, []);

  const peekTurn = useCallback(
    (turnId) => {
      panels.openPanel('grill');
      const turn = state.turns.find((t) => t.id === turnId);
      if (!turn) return;
      const index = state.turns.indexOf(turn);
      const node =
        document.querySelector(`#p-grill .past[data-ti="${index}"]`) ||
        (state.cursor === index ? document.querySelector('#p-grill .qcard') : null);
      if (node) {
        node.scrollIntoView({ block: 'center', behavior: 'smooth' });
        node.style.background = 'var(--gold-bg)';
        node.style.borderRadius = '8px';
        setTimeout(() => {
          node.style.background = '';
        }, 1400);
      }
      toast(`第 ${turn.round} 轮：${turn.question.slice(0, 42)}…`);
    },
    [panels, state.turns, state.cursor, toast],
  );

  const jumpReq = useCallback(
    (groupState) => {
      panels.openPanel('target');
      if (!target) return;
      if (!tally[groupState]) {
        toast(`「${REQ_WORD[groupState]}」现在是 0 条。`);
        return;
      }
      const first = target.reqs.find((r) => reqState(r, new Set(state.activeIds)) === groupState);
      if (first) setTimeout(() => targetPanelRef.current?.scrollToReq(first.id), 60);
      toast(`${REQ_WORD[groupState]}：${tally[groupState]} 条`);
    },
    [panels, target, tally, state.activeIds, toast],
  );

  /* 从要求清单跳到会补上它的那一轮 —— 清单不是死的，它指得回提问。 */
  const askFor = useCallback(
    (reqId) => {
      const req = target?.reqs.find((r) => r.id === reqId);
      if (!req) return;
      const turn =
        state.turns.find((t) => t.jdReq?.includes(reqId)) ||
        state.turns.find((t) => (t.harvest || []).some((h) => (req.fills || []).includes(h)));
      if (!turn) {
        toast('这条没有对应的问题——它属于「问不出来」那一类。');
        return;
      }
      panels.openPanel('grill');
      if (state.turns.indexOf(turn) < state.cursor) {
        peekTurn(turn.id);
        toast(`第 ${turn.round} 轮已经问过了，它补的就是这一条。`);
      } else {
        toast(`这条会在第 ${turn.round} 轮问到：${turn.question.slice(0, 34)}…`);
      }
    },
    [target, state.turns, state.cursor, panels, peekTurn, toast],
  );

  return (
    <Screen name="wb" title="工作台">
      <TopBar nav={<Stepper current={ROUTES.workbench} />}>
        <div className="goal">
          Grill for <b>{outputLabel}</b>
        </div>
        <button
          type="button"
          className="gbtn"
          onClick={actions.undo}
          disabled={!state.undoStack.length}
          data-testid="undo-button"
        >
          撤回上一步<kbd>⌘Z</kbd>
        </button>
        <button type="button" className="gbtn pri" onClick={() => navigate(ROUTES.done)}>
          够了，出稿 →
        </button>
      </TopBar>

      <div className="wb">
        <TargetBar
          onJump={jumpReq}
          onOpenList={() => {
            panels.openPanel('target');
            panels.maxPanel('target');
          }}
          onPickTarget={() => navigate(ROUTES.setup)}
        />
        <PanelBar panels={panels} />

        <div className="panelsWrap">
          {panels.stacked ? null : (
            <button type="button" className="barToggle" onClick={panels.toggleBar}>
              {panels.barHidden ? '▼ 展开面板条' : '▲ 收起面板条'}
            </button>
          )}
          <div
            className={`panels${panels.stacked ? ' stacked' : ''}`}
            id="panels"
            style={panels.stacked ? undefined : { gridTemplateColumns: panels.gridTemplateColumns }}
          >
            <CrumbsPanel panels={panels} />
            <GrillPanel
              panels={panels}
              composerRef={composerRef}
              tip={tip}
              onTip={setTip}
              onSend={(text) => {
                if (state.cursor >= budget) {
                  toast('已经问完了。可以去成果页，或者撤回某一轮再答一次。');
                  return;
                }
                actions.answer(text);
              }}
              onGoToResult={() => navigate(ROUTES.done)}
            />
            <DraftPanel panels={panels} dragging={dragging} />
            <LedgerPanel panels={panels} onPeekTurn={peekTurn} onDragStateChange={setDragging} />
            <TargetPanel panels={panels} ref={targetPanelRef} onAskFor={askFor} />
          </div>
        </div>
      </div>
    </Screen>
  );
}
