/* ============================================================
   作战板 —— 一份产出物由好几段经历组成。

   它不是海报：第 ① 段的轮次直接决定工作台问几轮、预算条画几格、
   成果页据此重算缺口。改这里，后面全跟着变。
   ============================================================ */
import { sourceIcons } from '../../api';
import { reqState, reqTally } from '../../domain/target';
import RichText from '../common/RichText';

export default function PlanBoard({
  plan,
  planOn,
  planRounds,
  target,
  activeFacts,
  outputLabel,
  crumbById,
  onToggle,
  onBump,
  onStart,
  onOnlyFirst,
}) {
  const gaps = target ? target.reqs.filter((r) => reqState(r, activeFacts) === 'gap') : [];
  const firstId = plan[0]?.id;
  const canStart = Boolean(planOn[firstId]);
  const totalRounds = plan
    .filter((p) => planOn[p.id])
    .reduce((sum, p) => sum + (planRounds[p.id] ?? p.rounds), 0);
  const onCount = plan.filter((p) => planOn[p.id]).length;

  return (
    <div className="plan" data-testid="plan-board">
      <div className="plan-h">
        <h3>
          {target ? `为「${target.title}」组这份${outputLabel}，我打算这样` : '这一场没设目标 · 通用打磨'}
        </h3>
        <span className="sum">
          {target ? (
            <>
              共 <b className="num">{target.reqs.length}</b> 条要求 · 现在对上{' '}
              <b className="num">{reqTally(target, activeFacts).ok}</b> ·{' '}
            </>
          ) : null}
          计划挖 <b className="num">{totalRounds}</b> 轮
        </span>
      </div>

      {plan.map((segment, index) => {
        const hits = target ? segment.hits[target.id] || 0 : null;
        const on = Boolean(planOn[segment.id]);
        const rounds = planRounds[segment.id] ?? segment.rounds;
        return (
          <div className={`pseg${on ? ' on2' : ' off'}`} data-p={segment.id} key={segment.id}>
            <span className="idx" aria-hidden="true">
              {index + 1}
            </span>
            <span className="m">
              <span className="t1">
                {segment.title}
                <small>{segment.span}</small>
                {hits !== null ? (
                  <>
                    <span className="dots" aria-hidden="true">
                      {[0, 1, 2, 3, 4, 5].map((k) => (
                        <i className={k < hits ? 'f' : ''} key={k} />
                      ))}
                    </span>
                    <span className={`pheat ${segment.heat}`}>
                      {hits ? `对上 JD ${hits} 条` : '对不上'}
                    </span>
                  </>
                ) : null}
              </span>
              <span className="p2">
                {on ? (
                  <>
                    建议挖 <b>{rounds}</b> 轮：{segment.plan}
                  </>
                ) : (
                  <span style={{ color: 'var(--fg-mute)' }}>{segment.plan}</span>
                )}
              </span>
              <span className="base">
                底子：
                <RichText text={segment.base} />
              </span>
              <span className="froms">
                <span className="lb">聚自</span>
                {segment.crumbs.map((id) => {
                  const crumb = crumbById[id];
                  if (!crumb) return null;
                  return (
                    <span className="tg ref" key={id}>
                      {sourceIcons[crumb.type] || '◆'} {crumb.name}
                    </span>
                  );
                })}
              </span>
            </span>
            <span className="r2">
              <button
                type="button"
                className={`ptog${on ? ' on3' : ''}`}
                aria-pressed={on}
                onClick={() => onToggle(segment.id)}
              >
                {on ? '✓ 放进这份' : '＋ 我还是想放'}
              </button>
              {on ? (
                <span className="pstep" role="group" aria-label={`${segment.title} 的轮次`}>
                  <button
                    type="button"
                    onClick={() => onBump(segment.id, -1)}
                    disabled={rounds <= 1}
                    aria-label="少问一轮"
                  >
                    −
                  </button>
                  <span className="v2" data-testid={`plan-rounds-${segment.id}`}>
                    {rounds} 轮
                  </span>
                  <button
                    type="button"
                    onClick={() => onBump(segment.id, 1)}
                    disabled={rounds >= segment.max}
                    aria-label="多问一轮"
                  >
                    ＋
                  </button>
                </span>
              ) : null}
              {segment.scripted ? null : <span className="noscript">本原型无脚本</span>}
            </span>
          </div>
        );
      })}

      {gaps.length ? (
        <div className="gapbox2">
          <b>JD 里有 {gaps.length} 条你确实没有</b>：{gaps.map((r) => r.text).join('、')}。
          <br />
          <b>不会替你编。</b>
          这几条不会出现在成稿里，成果页会明说——那是去补技能的信号，不是去补文案的信号。
        </div>
      ) : null}

      <div className="plan-f">
        <button type="button" className="go" onClick={onStart} disabled={!canStart}>
          {canStart
            ? `就按这个开始 · 先跑第 ① 段的 ${planRounds[firstId] ?? plan[0]?.rounds} 轮`
            : '第 ① 段被关掉了，没得跑'}
        </button>
        <button type="button" className="ghost" onClick={onOnlyFirst}>
          先只挖第 ① 段
        </button>
        <small>
          {onCount} 段经历 · 第 ① 段这一场就问，其余留作下一场
          <br />
          <b>你一个字都不用打</b> —— 底子来自简历和已有材料
        </small>
      </div>
    </div>
  );
}
