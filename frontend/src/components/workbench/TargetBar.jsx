/* 常驻 Target 条：这一场是为谁做的，永远可见。
   四个数字都能点，跳到清单对应分组。 */
import { REQ_WORD } from '../../domain/target';
import { useSession } from '../../state/SessionContext';

const STATS = [
  ['ok', '对上'],
  ['weak', '弱'],
  ['none', '还能问出'],
  ['gap', '确实没有'],
];

export default function TargetBar({ onJump, onOpenList, onPickTarget }) {
  const { target, tally } = useSession();

  if (!target) {
    return (
      <div className="tbar" data-testid="target-bar">
        <span className="lb">目标</span>
        <span className="tt none2">这一场没有设定目标 —— 只做通用打磨</span>
        <span className="score">
          <button
            type="button"
            className="gbtn"
            style={{ padding: '3px 10px', fontSize: 11.5 }}
            onClick={onPickTarget}
          >
            去挑一个目标
          </button>
        </span>
      </div>
    );
  }

  return (
    <div className="tbar" data-testid="target-bar">
      <span className="lb">目标</span>
      <span className="tt">
        {target.title}
        <small>{target.org}</small>
      </span>
      <span className="score">
        {STATS.map(([key, label]) => (
          <button
            type="button"
            className={`rstat ${key} jump`}
            key={key}
            onClick={() => onJump(key)}
            aria-label={`${REQ_WORD[key]}：${tally[key]} 条，点击跳到清单`}
          >
            <i className="d" aria-hidden="true" />
            {label} <b data-testid={`tally-${key}`}>{tally[key]}</b>
          </button>
        ))}
        <button
          type="button"
          className="gbtn"
          style={{ padding: '3px 10px', fontSize: 11.5 }}
          onClick={onOpenList}
        >
          看清单 →
        </button>
      </span>
    </div>
  );
}
