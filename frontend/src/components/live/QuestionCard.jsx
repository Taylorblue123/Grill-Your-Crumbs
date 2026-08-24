/* ============================================================
   问题卡（真链路版）

   和剧本版（workbench/GrillPanel）长得一样，是故意的：交互语言照抄，
   只是数据来自后端而不是 data/demo.js。卡上常驻四块，每一块都在回答
   用户心里的一个问题：

     why         你凭什么问我这个    → 必须指向具体某份料 / JD 某条要求
     options     我想不起来怎么办    → 3-4 个选项，把回忆题变成辨认题
     recommended 我该选哪个          → 推荐项 + 理由，给个台阶
     remaining   这场还有多久到头    → 还剩 n 个想挖的点

   本片只渲染首题，作答由下一片接上——所以这里没有作答框。
   ============================================================ */
export default function QuestionCard({ question }) {
  const { text, why, options, recommended, remaining } = question;

  return (
    <div className="qcard">
      <div className="qc-h">
        <span className="dimtag">第 1 问</span>
        开场
        <span style={{ marginLeft: 'auto' }}>
          <span className="qsrc jd">
            {remaining > 0 ? `还剩 ${remaining} 个想挖的点` : '这是最后一个想挖的点'}
          </span>
        </span>
      </div>

      <div className="qc-b">
        <div className="q">{text}</div>

        <div className="why">
          <b>我为什么问这个</b>
          {why}
        </div>

        {options.length > 0 && (
          <div className="guess">
            <b>想不起来？从这几个里认一个 · 也可以完全无视，自己写</b>
            <div className="live-opts">
              {options.map((option) => {
                const isPick = option.key === recommended.key;
                return (
                  <div className={`live-opt${isPick ? ' pick' : ''}`} key={option.key}>
                    <span className="k">{option.key.toUpperCase()}</span>
                    <span className="t">{option.text}</span>
                    {isPick && <span className="tag">我猜是这个</span>}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {recommended.reason && (
          <div className="jdwhy">
            <span className="h6">我为什么猜这个</span>
            {recommended.reason}
          </div>
        )}
      </div>
    </div>
  );
}
