import { useCallback } from 'react';
import { useUi } from '../../hooks/useUi.jsx';

/* ============================================================
   成稿里的一段：正文 + 它的出处。

   为什么不复用 `common/Segment.jsx`：那一个吃的是剧本假数据的形状
   （`{t, o, ref, turn, hs}`，并且直接 import `data/demo.js` 去反查），后端的
   `SegmentView` 是另一套形状。让一个组件同时吃两种形状，等于把剧本 demo 和
   真链路焊在一起——正是 issue #22 明确要避免的。复用的是**样式**（`.sg` 那套
   三色出处）和**交互语言**（同一个 popover），不是组件本身。

   染色规则直接读后端的 `source`：
     - `original`  原简历本来就有 → 不染色
     - `turn:<id>` 拷问某一轮挖出来的 → 金色（`.sg.grill`），沟槽里标轮号
     - `crumb:<id>` 某份料里读到的 → 蓝色（`.sg.source`）
   三色语义是设计系统的硬约束，这里不另发明颜色。

   沟槽里的轮号是**结构即信息**：它不是装饰性的序号，是这一段的出处本身——
   「第 3 问挖出来的」。原简历本来就有的段落沟槽只有一个破折号。

   两条 hover 通道：
     - popover 显示当轮的问与答（内容随段落从后端下发，不反查账本）
     - `onAim(fact_ids)` 让右侧账本里对应的事实亮起来——出处不只是一张
       卡片，是成稿和账本之间看得见的那条线
   ============================================================ */

const SOURCE_ORIGINAL = 'original';
const TURN_PREFIX = 'turn:';
export const CRUMB_PREFIX = 'crumb:';

export default function RewriteSegment({
  segment, crumbName, lit, onAim, born, delay,
}) {
  const ui = useUi();
  const grilled = segment.source.startsWith(TURN_PREFIX);
  const fromCrumb = segment.source.startsWith(CRUMB_PREFIX);

  const handleEnter = useCallback((event) => {
    const node = event.currentTarget;
    onAim(segment.fact_ids);
    if (grilled) {
      ui.showPop({
        kind: 'grill',
        title: segment.round
          ? `第 ${segment.round} 问 · 你的原话`
          : '拷问挖到的 · 你的原话',
        /* 传节点而不是带 \n 的字符串：`#pop` 没有 `white-space: pre-line`。 */
        body: (
          <>
            {segment.question_text && (
              <div style={{ opacity: 0.72, marginBottom: 6 }}>{`问：${segment.question_text}`}</div>
            )}
            <div>
              {segment.answer_text
                ? `答：${segment.answer_text}`
                : '（这一轮的问答记录不在了）'}
            </div>
          </>
        ),
        facts: [],
      }, node);
      return;
    }
    if (fromCrumb) {
      ui.showPop({
        kind: 'source',
        title: `来自你的料 · ${crumbName || segment.source.slice(CRUMB_PREFIX.length)}`,
        body: '这句话是从你上传的材料里读到的，不是拷问问出来的。',
      }, node);
    }
  }, [segment, crumbName, ui, onAim, grilled, fromCrumb]);

  const handleLeave = useCallback(() => {
    onAim(null);
    ui.hidePop();
  }, [onAim, ui]);

  if (segment.source === SOURCE_ORIGINAL) {
    /* 原简历本来就有的话不加任何标记：染色是用来指认「新挖出来的」的，
       满屏都染等于什么都没指认。 */
    return (
      <div className="bul">
        <span className="bd">—</span>
        <span className="tx">{segment.text}</span>
      </div>
    );
  }

  return (
    <div className={`bul${grilled ? ' gold' : ' src'}${lit ? ' lit' : ''}`}>
      <span className="bd">
        {grilled && segment.round ? <i className="rd num">{segment.round}</i> : '—'}
      </span>
      {/* 高亮只裹着字，不铺满整行：这是记号笔的语义——「这几个字是挖出来的」，
          不是一块色板。所以 .sg 留在行内，撑满一行的是外面这层 .tx。 */}
      <span className="tx">
        <span
          className={`sg ${grilled ? 'grill' : 'source'}${born ? ' born' : ''}`}
          style={born ? { animationDelay: `${delay}ms` } : undefined}
          onMouseEnter={handleEnter}
          onMouseLeave={handleLeave}
          onFocus={handleEnter}
          onBlur={handleLeave}
          tabIndex={0}
          role="note"
        >
          {segment.text}
        </span>
      </span>
    </div>
  );
}
