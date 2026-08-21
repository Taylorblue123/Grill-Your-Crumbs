import { expect, test } from '@playwright/test';
import { answerOneRound, expandPanel, expectClean, gotoWorkbench, watchPage } from './helpers';

test.describe('作战板 → 工作台 → 成果', () => {
  test('作战板不是海报：改轮次，工作台就真的少问一轮', async ({ page }) => {
    const problems = watchPage(page);
    await page.goto('/setup');

    await expect(page.getByTestId('plan-rounds-p1')).toHaveText('6 轮');
    await page.getByTestId('plan-board').locator('[data-p="p1"] .pstep button', { hasText: '−' }).click();
    await page.getByTestId('plan-board').locator('[data-p="p1"] .pstep button', { hasText: '−' }).click();
    await page.getByTestId('plan-board').locator('[data-p="p1"] .pstep button', { hasText: '−' }).click();
    await expect(page.getByTestId('plan-rounds-p1')).toHaveText('3 轮');

    await page.getByRole('button', { name: /就按这个开始/ }).click();
    await expect(page.locator('#p-grill .pc')).toHaveText('0 / 3');
    // 预算条只画 3 格
    await expect(page.locator('.budget .bs2')).toHaveCount(3);
    expectClean(problems);
  });

  test('句子就是表单：换目标之后，作战板和 JD 缺口一起重算', async ({ page }) => {
    const problems = watchPage(page);
    await page.goto('/setup');

    await expect(page.getByTestId('config-sentence')).toContainText('后端开发实习生');
    await page.getByRole('button', { name: /目标：后端开发实习生/ }).click();
    await page.getByRole('menuitemradio', { name: /推荐系统方向 Research Assistant/ }).click();
    await expect(page.getByTestId('config-sentence')).toContainText('Research Assistant');
    await expect(page.getByTestId('plan-board')).toContainText('推荐系统方向 Research Assistant');

    // 换成「先不设目标」，JD 相关的东西整块消失
    await page.getByRole('button', { name: /目标：推荐系统方向/ }).click();
    await page.getByRole('menuitemradio', { name: /先不设目标/ }).click();
    await expect(page.getByTestId('plan-board')).toContainText('这一场没设目标');
    await expect(page.locator('.gapbox2')).toHaveCount(0);
    expectClean(problems);
  });

  test('答一题：账本长出条目、稿子变金、JD 要求从 ○ 翻 ✓、撤回全部退回去', async ({ page }) => {
    const problems = watchPage(page);
    await gotoWorkbench(page);

    // 起点：账本空的，稿子里 0 处金色
    await expect(page.locator('#p-ledger .pc')).toHaveText('0');
    await expect(page.locator('#p-draft .pc')).toHaveText('0');
    const okBefore = Number(await page.getByTestId('tally-ok').innerText());

    await answerOneRound(page);

    // 账本：第 1 轮拆出 2 条事实
    await expect(page.locator('#p-ledger .pc')).toHaveText('2');
    await expect(page.getByTestId('ledger')).toContainText('人均停留时长 +40%');
    await expect(page.getByTestId('ledger').getByText('第 1 轮 ↗').first()).toBeVisible();
    // 账本不复述问题原文
    await expect(page.getByTestId('ledger')).not.toContainText('具体是哪个指标');

    // 稿子：对应片段不再是灰骨架
    await expect(page.locator('#p-draft .pc')).not.toHaveText('0');
    await expect(page.locator('#viewA .sg.grill:not(.ghost)').first()).toBeVisible();

    // JD：对上的条数变多了
    const okAfter = Number(await page.getByTestId('tally-ok').innerText());
    expect(okAfter).toBeGreaterThan(okBefore);

    // 撤回：账本、稿子、JD 一起退回去
    await page.getByTestId('undo-button').click();
    await expect(page.locator('#p-ledger .pc')).toHaveText('0');
    await expect(page.locator('#p-draft .pc')).toHaveText('0');
    await expect(page.getByTestId('tally-ok')).toHaveText(String(okBefore));
    await expect(page.getByTestId('question-card')).toContainText('第 1 轮');

    expectClean(problems);
  });

  test('材料被拖出本场：引用它的句子当场标红，撤回后恢复', async ({ page }) => {
    const problems = watchPage(page);
    await gotoWorkbench(page);
    await expandPanel(page, 'crumbs');

    const orphanBefore = await page.locator('#viewA .sg.source.orphan').count();
    expect(orphanBefore).toBe(0);

    await page
      .locator('#p-crumbs .src[data-id="c4"]')
      .getByRole('button', { name: /移出本场/ })
      .click();

    await expect(page.locator('#viewA .sg.source.orphan')).toHaveCount(1);
    await expect(page.locator('#viewA .sg.source.orphan .badge')).toHaveText('出处已移出');

    await page.getByTestId('undo-button').click();
    await expect(page.locator('#viewA .sg.source.orphan')).toHaveCount(0);
    expectClean(problems);
  });

  test('候补事实要手动进简历，能加也能撤', async ({ page }) => {
    const problems = watchPage(page);
    await gotoWorkbench(page);

    // 答到第 3 轮，才会出现候补事实 h10
    await answerOneRound(page);
    await answerOneRound(page);
    await answerOneRound(page);

    const candidate = page.locator('#p-ledger .item.cand').first();
    await expect(candidate).toBeVisible();
    await candidate.getByRole('button', { name: '拖进简历 ＋' }).click();

    await expect(page.locator('#viewA .bul.promoted')).toHaveCount(1);
    await expect(page.locator('#viewA .bul.promoted .pbadge')).toHaveText('你手动加的');

    await page.locator('#viewA .bul.promoted').getByRole('button', { name: '从简历移走' }).click();
    await expect(page.locator('#viewA .bul.promoted')).toHaveCount(0);
    expectClean(problems);
  });

  test('那句无出处的套话被标红并能删掉；红线：gap 永远不进成稿', async ({ page }) => {
    const problems = watchPage(page);
    await gotoWorkbench(page);

    const unsourced = page.locator('#viewA .sg.inferred .badge', { hasText: '无出处' });
    await expect(unsourced).toHaveCount(1);
    await page.getByRole('button', { name: '删掉这条' }).click();
    await expect(page.locator('#viewA .sg.inferred .badge', { hasText: '无出处' })).toHaveCount(0);

    // 目标面板：那两条「你确实没有」的要求，明说不会生成文案
    await expandPanel(page, 'target');
    await expect(page.getByTestId('req-list')).toContainText('熟悉 Kubernetes / 容器化部署');
    await expect(page.locator('.req.gap').first()).toContainText('不会为它生成任何文案');
    // 成稿里不会出现这几条 gap 的内容
    await expect(page.locator('#viewA')).not.toContainText('Kubernetes');
    await expect(page.locator('#viewA')).not.toContainText('Kafka');
    expectClean(problems);
  });

  test('成果页：BEFORE/AFTER 并排，诚实交代 gap，然后能存回工作区', async ({ page }) => {
    const problems = watchPage(page);
    await page.goto('/setup');
    // 只跑 2 轮，够验证成果页的数字了
    const minus = page.getByTestId('plan-board').locator('[data-p="p1"] .pstep button', { hasText: '−' });
    for (let i = 0; i < 4; i += 1) await minus.click();
    await expect(page.getByTestId('plan-rounds-p1')).toHaveText('2 轮');
    await page.getByRole('button', { name: /就按这个开始/ }).click();

    await answerOneRound(page);
    await answerOneRound(page);
    await expect(page.getByTestId('grill-finished')).toBeVisible();

    await page.getByRole('button', { name: '看成果 →' }).click();
    await expect(page).toHaveURL(/\/result/);

    await expect(page.getByTestId('reveal-headline')).toContainText('是刚刚从你嘴里挖出来的');
    await expect(page.locator('.pn.before')).toContainText('你现在简历上的原话');
    await expect(page.getByTestId('final-bullets')).toBeVisible();
    // 没挖到的部分如实说出来，不假装稿子已经满了
    await expect(page.getByTestId('final-bullets')).toContainText('没挖到');
    await expect(page.getByTestId('jd-board')).toContainText('我们没有替你圆这几条');

    await page.getByRole('button', { name: '完成，存进工作区 →' }).first().click();
    await expect(page).toHaveURL(/\/workspace/);
    await expect(page.locator('.exp.now')).toContainText('已成型');
    expectClean(problems);
  });
});
