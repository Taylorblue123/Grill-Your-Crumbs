/* 出处规则是这个产品的底线，所以它必须是可测的纯函数，
   而不是散在渲染里的 if。 */
import { describe, expect, it } from 'vitest';
import { buildDraft, goldCount } from './provenance';

const harvest = {
  h1: { dim: '量化结果', turn: 't1', text: '+40% 停留时长', tags: ['数字'], dest: '简历' },
  h2: { dim: '真实困难', turn: 't2', text: '冷启动 40s', tags: ['事故'], dest: '候补', promote: 'Root-caused a cold start.' },
};
const artifact = {
  bullet_req: [['r1'], []],
  promoted_req: { h2: ['r2'] },
  resume_bullets: [
    [
      { t: '来自材料的一句', o: 'source', ref: 'c1' },
      { t: '挖出来的一句', o: 'grill', turn: 't1', hs: ['h1'] },
    ],
    [{ t: '一句无出处的套话', o: 'inferred', verified: false, note: '我编的' }],
  ],
  self_intro: [{ t: '自我介绍第一句', o: 'source', ref: 'c1' }],
  stats: { n_source: 2, n_grill: 1, n_inferred: 1 },
};

const build = (overrides = {}) =>
  buildDraft({
    artifact,
    harvest,
    activeFacts: new Set(),
    promotedFacts: new Set(),
    killedBullets: new Set(),
    sessionCrumbs: new Set(['c1']),
    ...overrides,
  });

describe('活稿：事实集合变了，稿子跟着变', () => {
  it('还没挖到的金色片段是灰骨架，那条 bullet 不算薄（它还有蓝色）', () => {
    const draft = build();
    const grill = draft.bullets[0].segments[1];
    expect(grill.ghost).toBe(true);
    expect(draft.bullets[0].thin).toBe(false);
    expect(draft.counts.gold).toBe(0);
    expect(draft.counts.ghost).toBe(1);
  });

  it('事实进了 active，对应片段当场变金', () => {
    const draft = build({ activeFacts: new Set(['h1']) });
    expect(draft.bullets[0].segments[1].ghost).toBe(false);
    expect(draft.counts.gold).toBe(1);
    expect(draft.counts.ghost).toBe(0);
  });

  it('材料被移出本场：引用它的句子从「有出处」挪到「无出处」', () => {
    const before = build();
    const after = build({ sessionCrumbs: new Set() });
    expect(before.counts.source).toBe(2);
    expect(after.counts.source).toBe(0);
    expect(after.counts.orphan).toBe(2);
    // 无出处 = 原有的 inferred ＋ 掉了出处的两句
    expect(after.counts.inferred).toBe(before.counts.inferred + 2);
    expect(after.bullets[0].segments[0].orphan).toBe(true);
  });

  it('删掉那句无出处的套话，无出处计数少一个', () => {
    const draft = build({ killedBullets: new Set([1]) });
    expect(draft.bullets).toHaveLength(1);
    expect(draft.counts.inferred).toBe(0);
  });

  it('候补事实被拖进简历后，多出一条带出处的 bullet', () => {
    const draft = build({ activeFacts: new Set(['h2']), promotedFacts: new Set(['h2']) });
    const promoted = draft.bullets.find((b) => b.promotedFactId === 'h2');
    expect(promoted).toBeTruthy();
    expect(promoted.segments[0].turnId).toBe('t2');
    expect(promoted.segments[0].ghost).toBe(false);
  });

  it('成果页模式：没挖到的片段整段不出现，空 bullet 直接丢掉', () => {
    const final = buildDraft({
      artifact,
      harvest,
      activeFacts: new Set(),
      promotedFacts: new Set(),
      killedBullets: new Set(),
      sessionCrumbs: new Set(['c1']),
      mode: 'final',
      force: true,
    });
    expect(final.bullets[0].segments).toHaveLength(1);
    expect(final.counts.ghost).toBe(0);
  });
});

describe('goldCount', () => {
  it('数的是「挖到并且还生效」的片段，包括手动拖进去的候补', () => {
    expect(goldCount({ artifact, activeFacts: new Set(), promotedFacts: new Set() })).toBe(0);
    expect(goldCount({ artifact, activeFacts: new Set(['h1']), promotedFacts: new Set() })).toBe(1);
    expect(
      goldCount({ artifact, activeFacts: new Set(['h1', 'h2']), promotedFacts: new Set(['h2']) }),
    ).toBe(2);
  });
});
