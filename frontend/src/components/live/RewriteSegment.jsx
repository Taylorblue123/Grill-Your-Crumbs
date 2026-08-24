import { useCallback } from 'react';
import { useUi } from '../../hooks/useUi.jsx';

/* ============================================================
   成稿里的一段，以及它的出处染色。

   为什么不复用 `common/Segment.jsx`：那一个吃的是剧本假数据的形状
   （`{t, o, ref, turn, hs}`，并且直接 import `data/demo.js` 里的 `TURN_BY_ID`
   与 `HARVEST` 去反查），后端的 `SegmentView` 是另一套形状。让一个组件同时吃
   两种形状，等于把剧本 demo 和真链路焊在一起——正是 issue #22 明确要避免的。
   复用的是**样式**（`.sg` 那套三色出处的 CSS）和**交互语言**（同一个 popover），
   不是组件本身，`live/QuestionCard.jsx` 与 `workbench/GrillPanel.jsx` 也是这么分的。

   染色规则直接读后端的 `source`：
     - `original`  原简历本来就有 → 不染色，普通正文
     - `turn:<id>` 拷问某一轮挖出来的 → 金色（`.sg.grill`）
     - `crumb:<id>` 某份料里读到的 → 蓝色（`.sg.source`）
   三色语义是设计系统的硬约束（design-system.css 里点明过），这里不另发明颜色。

   hover 卡片的内容全部来自后端随段落一起下发的 `round / question_text /
   answer_text`——前端不再去账本里反查。反查要前端自己维护「fact_id → 事实」
   的索引，而那份索引在改稿推进版本之后极容易和成稿对不上。
   ============================================================ */

const SOURCE_ORIGINAL = 'original';
const TURN_PREFIX = 'turn:';
export const CRUMB_PREFIX = 'crumb:';

export default function RewriteSegment({ segment, crumbName }) {
  const ui = useUi();

  const handleEnter = useCallback((event) => {
    const node = event.currentTarget;
    if (segment.source.startsWith(TURN_PREFIX)) {
      ui.showPop({
        kind: 'grill',
        title: segment.round
          ? `🔥 第 ${segment.round} 问 · 你的原话`
          : '🔥 拷问挖到的 · 你的原话',
        /* 问和答都给：光有答案，用户想不起来当时被问的是什么。

           传节点而不是带 \n 的字符串：`#pop` 没有 `white-space: pre-line`，
           换行会被折掉，问和答糊成一行。 */
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
    if (segment.source.startsWith(CRUMB_PREFIX)) {
      ui.showPop({
        kind: 'source',
        title: `📄 来自你的料 · ${crumbName || segment.source.slice(CRUMB_PREFIX.length)}`,
        body: '这句话是从你上传的材料里读到的，不是拷问问出来的。',
      }, node);
    }
  }, [segment, crumbName, ui]);

  if (segment.source === SOURCE_ORIGINAL) {
    /* 原简历本来就有的话不加任何标记：染色是用来指认「新挖出来的」的，
       满屏都染等于什么都没指认。 */
    return <span>{segment.text}</span>;
  }

  const grilled = segment.source.startsWith(TURN_PREFIX);
  return (
    <span
      className={grilled ? 'sg grill' : 'sg source'}
      onMouseEnter={handleEnter}
      onMouseLeave={ui.hidePop}
      onFocus={handleEnter}
      onBlur={ui.hidePop}
      tabIndex={0}
      role="note"
    >
      {segment.text}
    </span>
  );
}
