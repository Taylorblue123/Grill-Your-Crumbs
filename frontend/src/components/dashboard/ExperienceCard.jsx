import { useState } from 'react';

const STATE_WORD = { done: '已成型', live: '进行中', thin: '还很薄', new: '待开始' };
const STATE_CLASS = { done: 'done', live: 'live', thin: 'draft', new: 'draft' };

/**
 * 一段经历 —— 工作区的主体单位。
 * 六格维度矩阵里填了几格是数出来的，空格＝这段还没被问到那个角度，
 * 刻意不换算成完成度百分比。
 */
export default function ExperienceCard({ experience, dims, actions }) {
  const [open, setOpen] = useState(false);
  const totalFacts = Object.values(experience.dims).reduce((a, b) => a + b, 0);
  const filledDims = Object.keys(experience.dims).filter((k) => experience.dims[k]).length;

  return (
    <article className={`exp${experience.now ? ' now' : ''}${open ? ' open' : ''}`} data-e={experience.id}>
      <div className="exp-h">
        <div className="t1">
          {experience.title}
          <span className={`state ${STATE_CLASS[experience.state] || 'draft'}`}>
            {STATE_WORD[experience.state] || ''}
          </span>
        </div>
        <div className="t2">{experience.span}</div>
      </div>

      <div className="matrix" role="group" aria-label="维度矩阵">
        {dims.map((dim) => {
          const n = experience.dims[dim] || 0;
          return (
            <div className={`mcell${n ? ' has' : ''}`} key={dim} title={`${dim}：${n} 条`}>
              <b>{n || '·'}</b>
              <span>{dim}</span>
            </div>
          );
        })}
      </div>

      <div className="exp-stat">
        <span>
          材料 <b>{experience.crumbs}</b> 条
        </span>
        <span>
          事实 <b>{totalFacts}</b> 条
        </span>
        <span>
          维度 <b>{filledDims}</b> / 6
        </span>
        <span>
          问过 <b>{experience.rounds}</b> 轮
        </span>
      </div>

      <div className="exp-arts">
        {experience.arts.length ? (
          experience.arts.map((art) => (
            <span className="artchip" key={art}>
              {art}
            </span>
          ))
        ) : (
          <span className="artchip none">还没喂给任何一份稿子</span>
        )}
      </div>

      {open ? (
        <div className="expfacts">
          {dims.filter((d) => experience.facts.some((f) => f.dim === d)).length ? (
            dims
              .filter((d) => experience.facts.some((f) => f.dim === d))
              .map((dim) => {
                const facts = experience.facts.filter((f) => f.dim === dim);
                return (
                  <div key={dim}>
                    <div className="dimgroup">
                      {dim}
                      <span className="ln" />
                      <span className="c num">{facts.length}</span>
                    </div>
                    {facts.map((fact) => (
                      <div
                        className={`fb${String(fact.dest).startsWith('候补') ? ' cand' : ''}`}
                        key={`${dim}-${fact.text}`}
                      >
                        <div className="tx">{fact.text}</div>
                        <div className="mt">
                          {fact.tags.map((tag) => (
                            <span className="tg" key={tag}>
                              #{tag}
                            </span>
                          ))}
                          <span className="s">·</span>
                          {fact.from}
                          <span className="s">·</span>→ {fact.dest}
                        </div>
                      </div>
                    ))}
                  </div>
                );
              })
          ) : (
            <p className="lgHint" style={{ padding: 0 }}>
              这段还没有事实。开一场 Grill 就会开始攒。
            </p>
          )}
        </div>
      ) : null}

      <div className="exp-f">
        {actions}
        <button
          type="button"
          className="mini2"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        >
          {open ? '收起事实' : `看事实 (${totalFacts})`}
        </button>
        <span className="when">{experience.when}</span>
      </div>
    </article>
  );
}
