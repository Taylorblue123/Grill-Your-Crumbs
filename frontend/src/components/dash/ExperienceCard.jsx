import { useState } from 'react';
import { DIMS } from '../../data/demo.js';

const STATE_WORD = { done: '已成型', live: '进行中', thin: '还很薄', new: '待开始' };
const STATE_CLASS = { done: 'done', live: 'live', thin: 'draft', new: 'draft' };

/* Dashboard 的主体单位是「经历」，不是我们的数据结构。
   六格维度矩阵：填了几格是数出来的，空格＝这段还没被问到那个角度——
   它是信息，不是「完成度 0%」。 */
export default function ExperienceCard({ exp, actions }) {
  const [open, setOpen] = useState(false);
  const total = Object.values(exp.dims).reduce((a, b) => a + b, 0);
  const filled = Object.keys(exp.dims).filter((k) => exp.dims[k]).length;

  return (
    <div className={`exp${exp.now ? ' now' : ''}${open ? ' open' : ''}`}>
      <div className="exp-h">
        <div className="t1">
          {exp.title}
          <span className={`state ${STATE_CLASS[exp.state] || 'draft'}`}>{STATE_WORD[exp.state] || ''}</span>
        </div>
        <div className="t2">{exp.span}</div>
      </div>

      <div className="matrix">
        {DIMS.map((d) => {
          const n = exp.dims[d] || 0;
          return (
            <div className={`mcell${n ? ' has' : ''}`} key={d} title={`${d}：${n} 条`}>
              <b>{n || '·'}</b>
              <span>{d}</span>
            </div>
          );
        })}
      </div>

      <div className="exp-stat">
        <span>材料 <b>{exp.crumbs}</b> 条</span>
        <span>事实 <b>{total}</b> 条</span>
        <span>维度 <b>{filled}</b> / 6</span>
        <span>问过 <b>{exp.rounds}</b> 轮</span>
      </div>

      <div className="exp-arts">
        {exp.arts.length
          ? exp.arts.map((a) => <span className="artchip" key={a}>{a}</span>)
          : <span className="artchip none">还没喂给任何一份稿子</span>}
      </div>

      <div className="expfacts">
        {DIMS.filter((d) => exp.facts.some((f) => f.dim === d)).length === 0 && (
          <p className="lgHint" style={{ padding: 0 }}>这段还没有事实。开一场 Grill 就会开始攒。</p>
        )}
        {DIMS.filter((d) => exp.facts.some((f) => f.dim === d)).map((d) => (
          <div key={d}>
            <div className="dimgroup">
              {d}
              <span className="ln" />
              <span className="c num">{exp.facts.filter((f) => f.dim === d).length}</span>
            </div>
            {exp.facts.filter((f) => f.dim === d).map((f) => (
              <div className={`fb${String(f.dest).startsWith('候补') ? ' cand' : ''}`} key={f.id || f.text}>
                <div className="tx">{f.text}</div>
                <div className="mt">
                  {f.tags.map((x) => <span className="tg" key={x}>{`#${x}`}</span>)}
                  <span className="s">·</span>
                  {f.from}
                  <span className="s">·</span>
                  {`→ ${f.dest}`}
                </div>
              </div>
            ))}
          </div>
        ))}
      </div>

      <div className="exp-f">
        {actions}
        <button type="button" className="mini2" onClick={() => setOpen((v) => !v)}>
          {`看事实 (${total})`}
        </button>
        <span className="when">{exp.when}</span>
      </div>
    </div>
  );
}
