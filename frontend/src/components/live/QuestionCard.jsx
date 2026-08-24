import { useEffect, useRef, useState } from 'react';

/* ============================================================
   问题卡（真链路版）

   和剧本版（workbench/GrillPanel）长得一样，是故意的：交互语言照抄，
   只是数据来自后端而不是 data/demo.js。卡上常驻四块，每一块都在回答
   用户心里的一个问题：

     why         你凭什么问我这个    → 必须指向具体某份料 / JD 某条要求
     options     我想不起来怎么办    → 3-4 个选项，把回忆题变成辨认题
     recommended 我该选哪个          → 推荐项 + 理由，给个台阶
     remaining   这场还有多久到头    → 还剩 n 个想挖的点

   作答的核心设计：**点选项 = 把那句话填进作答框，不是提交**。

   选项若直接提交，用户就只能在三四条预设里选一个，而选项本来是「想不起来
   时的抓手」，不是穷举。填进框里之后，那句话立刻变成可以改的草稿——用户
   顺手补一句「其实是 800ms 压到 120ms」，一条模糊的辨认就变成了一条能写进
   简历的事实。完全无视选项自己写，也照走同一个框。
   ============================================================ */
export default function QuestionCard({
  question, round, pending, error, onSubmit,
}) {
  const {
    id, text, why, options, recommended, remaining,
  } = question;

  const [answer, setAnswer] = useState('');
  const [chosen, setChosen] = useState(null);
  const boxRef = useRef(null);

  /* 换题就清空作答框：上一题的草稿留在框里，用户会以为它还没提交成功。
     焦点跟着落进框里——这一屏此刻唯一要做的事就是回答。 */
  useEffect(() => {
    setAnswer('');
    setChosen(null);
    boxRef.current?.focus();
  }, [id]);

  const pick = (option) => {
    setChosen(option.key);
    /* 已经写了东西就往后接，不覆盖：用户自己敲的字比选项原文金贵。 */
    setAnswer((cur) => (cur.trim() ? `${cur.trim()}\n${option.text}` : option.text));
    boxRef.current?.focus();
  };

  const submit = () => {
    if (!answer.trim() || pending) return;
    onSubmit({ questionId: id, answerText: answer.trim(), chosenOption: chosen });
  };

  /* ⌘/Ctrl+Enter 提交：作答框是多行的，光按 Enter 得留给换行。 */
  const onKeyDown = (event) => {
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      submit();
    }
  };

  return (
    <div className="qcard">
      <div className="qc-h">
        <span className="dimtag">{`第 ${round} 问`}</span>
        {round === 1 ? '开场' : '追问'}
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
            <b>想不起来？从这几个里认一个 · 点一下会填进下面的框，可以随便改</b>
            <div className="live-opts">
              {options.map((option) => {
                const isPick = option.key === recommended.key;
                return (
                  <button
                    type="button"
                    className={`live-opt${isPick ? ' pick' : ''}${chosen === option.key ? ' on' : ''}`}
                    key={option.key}
                    onClick={() => pick(option)}
                    disabled={pending}
                  >
                    <span className="k">{option.key.toUpperCase()}</span>
                    <span className="t">{option.text}</span>
                    {isPick && <span className="tag">我猜是这个</span>}
                  </button>
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

        <div className="live-answer">
          <textarea
            ref={boxRef}
            className="live-ans-box"
            value={answer}
            onChange={(event) => setAnswer(event.target.value)}
            onKeyDown={onKeyDown}
            placeholder="用自己的话说就行——想到什么写什么，不用组织语言。"
            rows={4}
            disabled={pending}
            aria-label="你的回答"
          />

          {error && (
            <div className="live-err" role="alert">
              <b>没能提交</b>
              {error}
            </div>
          )}

          <div className="live-ans-acts">
            <button
              type="button"
              className="btn"
              onClick={submit}
              disabled={!answer.trim() || pending}
            >
              {pending ? '正在往下挖……' : '答完了，继续 →'}
            </button>
            <span className="live-gate">
              {pending
                ? '它在读你这一答、抽事实、想下一题'
                : '⌘/Ctrl + Enter 也能提交 · 想不起来就写「想不起来」，它会换个角度问'}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
