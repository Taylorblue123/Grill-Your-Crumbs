/* JD 是检查表不是模板 —— gap 永远不能被写成文案，这条得有断言守着。 */
import { describe, expect, it } from 'vitest';
import { generateable, jdChipsFor, reqState, reqTally } from './target';

const target = {
  id: 'tg1',
  title: '后端开发实习生',
  org: '某大厂',
  reqs: [
    { id: 'r1', kind: 'hard', text: '有后端开发经验', ev: ['c3'] },
    { id: 'r2', kind: 'hard', text: '高并发实践', weak: { text: '只有请求量' }, fills: ['h3'] },
    { id: 'r3', kind: 'pref', text: '能用业务指标衡量', fills: ['h1'] },
    { id: 'r4', kind: 'hard', text: '熟悉 Kubernetes', gap: true },
  ],
};

describe('要求状态', () => {
  it('有材料证据 → ok；依赖的事实还没挖到 → weak / none', () => {
    const none = new Set();
    expect(reqState(target.reqs[0], none)).toBe('ok');
    expect(reqState(target.reqs[1], none)).toBe('weak');
    expect(reqState(target.reqs[2], none)).toBe('none');
    expect(reqState(target.reqs[3], none)).toBe('gap');
  });

  it('挖到依赖的事实之后，从 ○ 翻成 ✓', () => {
    expect(reqState(target.reqs[2], new Set(['h1']))).toBe('ok');
    expect(reqState(target.reqs[1], new Set(['h3']))).toBe('ok');
  });

  it('gap 永远补不上 —— 挖再多事实也一样', () => {
    expect(reqState(target.reqs[3], new Set(['h1', 'h3', 'h99']))).toBe('gap');
    expect(generateable(target.reqs[3], new Set(['h1', 'h3']))).toBe(false);
  });

  it('tally 是四个可数的数字，不是一个匹配分', () => {
    expect(reqTally(target, new Set())).toEqual({ ok: 1, weak: 1, none: 1, gap: 1 });
    expect(reqTally(target, new Set(['h1', 'h3']))).toEqual({ ok: 3, weak: 0, none: 0, gap: 1 });
  });
});

describe('简历片段上的 JD 标记', () => {
  it('只给已经对上的要求挂 chip；gap 和没对上的不挂', () => {
    expect(jdChipsFor(['r1', 'r3', 'r4'], target, new Set()).map((c) => c.id)).toEqual(['r1']);
    expect(jdChipsFor(['r1', 'r3', 'r4'], target, new Set(['h1'])).map((c) => c.id)).toEqual([
      'r1',
      'r3',
    ]);
  });

  it('没有目标时不挂任何标记', () => {
    expect(jdChipsFor(['r1'], null, new Set())).toEqual([]);
  });
});
