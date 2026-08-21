/* ============================================================
   一个可数的稿子片段。三色出处的全部语义都在这一个组件里：
     蓝 = 有材料出处（材料被移出本场 → 当场标红「出处已移出」）
     金 = 刚从你嘴里挖出来的（还没挖到时是灰骨架）
     红 = AI 补的，等你确认

   可访问性补充（设计稿只做了鼠标悬停）：片段可聚焦、可用键盘唤出出处浮层，
   并用 aria-label 说明它是哪一类出处 —— 否则读屏用户拿不到三色携带的信息。
   ============================================================ */
import { useCallback } from 'react';
import { useUI } from '../../state/UIContext';
import { SEGMENT_KIND } from '../../domain/provenance';

const KIND_LABEL = {
  [SEGMENT_KIND.SOURCE]: '来自你已有的材料',
  [SEGMENT_KIND.GRILL]: '刚从你嘴里挖出来的',
  [SEGMENT_KIND.INFERRED]: 'AI 补的，请你确认',
};

export default function Segment({ segment, buildPopover, onFocusSegment }) {
  const { showPopover, hidePopover } = useUI();

  const open = useCallback(
    (event) => {
      if (segment.kind === SEGMENT_KIND.GRILL && segment.ghost) return;
      const content = buildPopover?.(segment);
      if (content) showPopover(content, event.currentTarget);
      onFocusSegment?.(segment);
    },
    [segment, buildPopover, showPopover, onFocusSegment],
  );

  const className = [
    'sg',
    segment.kind,
    segment.ghost ? 'ghost' : '',
    segment.orphan ? 'orphan' : '',
  ]
    .filter(Boolean)
    .join(' ');

  const label = segment.orphan
    ? '出处已移出'
    : segment.ghost
      ? '还没挖到'
      : KIND_LABEL[segment.kind];

  return (
    <>
      <span
        className={className}
        tabIndex={segment.ghost ? -1 : 0}
        role="button"
        aria-label={`${label}：${segment.text}`}
        onMouseEnter={open}
        onFocus={open}
        onMouseLeave={hidePopover}
        onBlur={hidePopover}
      >
        {segment.text}
        {segment.orphan ? <span className="badge">出处已移出</span> : null}
        {segment.kind === SEGMENT_KIND.INFERRED && segment.unsourced ? (
          <span className="badge">无出处</span>
        ) : null}
      </span>{' '}
    </>
  );
}
