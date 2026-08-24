/* ============================================================
   事实账本（真链路版）

   和剧本版（workbench/LedgerPanel）刻意不同：那边按维度/标签分栏、可拖进
   简历，因为它演示的是完整工作台。这里是一条平铺的流水，按落账顺序排——
   真链路此刻只需要证明一件事：**你刚才那一答，变成了这么几条可数的东西。**

   分栏、拖拽、提升进简历是改写那一片的事。这里提前搭出来只会做出一个空壳
   交互（拖到哪去？还没有简历草稿），不如先不做。

   刚落账的那几条打 `born` 标记高亮一下：用户按下提交后要立刻看见「+n 条」
   在哪里落下去，否则账本涨了他也不知道涨在哪。
   ============================================================ */
export default function FactLedger({ facts, freshIds }) {
  return (
    <div className="live-ledger">
      <div className="live-ledger-h">
        <span className="h6">事实账本</span>
        <span className={`b num${facts.length ? ' has' : ''}`}>{facts.length}</span>
        <small>每答一题，这里长出可数的条目——问题原文在上面，这里不抄第二遍。</small>
      </div>

      {facts.length === 0 ? (
        <p className="live-ledger-empty">
          还是空的。
          <br />
          答完第一题，你会看见它从你那段话里抽出的事实一条条落进来。
        </p>
      ) : (
        <div className="live-facts">
          {facts.map((fact) => (
            <div
              className={`live-fact${freshIds.includes(fact.id) ? ' born' : ''}`}
              key={fact.id}
            >
              <div className="tx">{fact.text}</div>
              <div className="meta">{`来自第 ${fact.round} 问`}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
