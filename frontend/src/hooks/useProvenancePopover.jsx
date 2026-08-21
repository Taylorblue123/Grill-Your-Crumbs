/* ============================================================
   「这句话是哪来的」——一个片段对应的出处浮层内容。
   金色片段指回第几轮的原话，蓝色片段指回具体某条材料，
   红色片段直接把「我编的，请你确认」写在脸上。
   ============================================================ */
import { useCallback } from 'react';
import { sourceIcons, sourceLabels } from '../api';
import { SEGMENT_KIND } from '../domain/provenance';
import { useCrumbLibrary } from '../state/CrumbLibraryContext';
import { useSession } from '../state/SessionContext';
import { useUI } from '../state/UIContext';

export function useProvenancePopover({ aim = false } = {}) {
  const { byId } = useCrumbLibrary();
  const { state, sessionCrumbs } = useSession();
  const { setAimedCrumbIds, workbench } = useUI();

  const buildPopover = useCallback(
    (segment) => {
      if (segment.kind === SEGMENT_KIND.SOURCE) {
        const crumb = byId[segment.ref];
        if (!crumb) return null;
        const gone = !sessionCrumbs.has(crumb.id);
        return (
          <>
            <div className="h">
              <em>
                {sourceIcons[crumb.type] || '◆'} {crumb.name}
              </em>{' '}
              · {sourceLabels[crumb.type] || crumb.type} · {crumb.id}
            </div>
            {crumb.text}
            {gone ? (
              <div
                style={{
                  marginTop: 8,
                  paddingTop: 8,
                  borderTop: '1px solid var(--pop-line)',
                  color: 'var(--red)',
                }}
              >
                ⚠ 这条材料已被移出本场，所以这句话现在没有出处。
              </div>
            ) : null}
          </>
        );
      }
      if (segment.kind === SEGMENT_KIND.GRILL) {
        const turn = state.turns.find((t) => t.id === segment.turnId);
        if (!turn) return null;
        return (
          <>
            <div className="h">
              🔥{' '}
              <em>
                第 {turn.round} 轮 · {turn.id}
              </em>{' '}
              · 你的原话
            </div>
            {turn.answer}
            <div
              style={{
                marginTop: 8,
                paddingTop: 8,
                borderTop: '1px solid var(--pop-line)',
                opacity: 0.72,
              }}
            >
              依赖 {segment.hs.length} 条新事实：
              {segment.hs.map((id) => state.harvest[id]?.text).join(' ／ ')}
            </div>
          </>
        );
      }
      return (
        <>
          <div className="h">
            ⚠ <em>无出处</em>
          </div>
          {segment.note}
        </>
      );
    },
    [byId, sessionCrumbs, state.turns, state.harvest],
  );

  /* 悬停蓝色片段时，左边材料面板展开并高亮那张卡 —— 出处不是一句话，是一处可核对的东西。 */
  const onFocusSegment = useCallback(
    (segment) => {
      if (!aim) return;
      if (segment.kind === SEGMENT_KIND.SOURCE) {
        setAimedCrumbIds([segment.ref]);
        workbench.current?.openPanel?.('crumbs');
      } else {
        setAimedCrumbIds([]);
      }
    },
    [aim, setAimedCrumbIds, workbench],
  );

  return { buildPopover, onFocusSegment };
}
