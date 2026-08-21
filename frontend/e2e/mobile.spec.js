/* ============================================================
   移动端（iPhone 13，390×664）。

   设计稿的五面板在这个宽度放不下，所以窄屏改成一次显示一个面板、
   面板条当选项卡。这套用例就是在守那条调整：不横向溢出、能切面板、
   拷问流程照样走得通。
   ============================================================ */
import { expect, test } from '@playwright/test';
import { answerOneRound, expectClean, watchPage } from './helpers';

async function expectNoHorizontalOverflow(page) {
  const overflow = await page.evaluate(() => {
    const doc = document.documentElement;
    return { scroll: doc.scrollWidth, client: doc.clientWidth };
  });
  // 允许 1px 的取整误差
  expect(overflow.scroll, '页面横向溢出').toBeLessThanOrEqual(overflow.client + 1);
}

test.describe('移动端', () => {
  test('落地页和工作区在窄屏可读、不横向溢出', async ({ page }) => {
    const problems = watchPage(page);
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expectNoHorizontalOverflow(page);

    await page.goto('/workspace');
    await expect(page.getByRole('heading', { name: 'Chen 的工作区' })).toBeVisible();
    await expect(page.getByTestId('material-grid')).toBeVisible();
    await expectNoHorizontalOverflow(page);
    expectClean(problems);
  });

  test('作战板在窄屏可用：改轮次、开始', async ({ page }) => {
    const problems = watchPage(page);
    await page.goto('/setup');
    await expect(page.getByTestId('plan-board')).toBeVisible();
    await expectNoHorizontalOverflow(page);

    const minus = page.getByTestId('plan-board').locator('[data-p="p1"] .pstep button', { hasText: '−' });
    await minus.click();
    await expect(page.getByTestId('plan-rounds-p1')).toHaveText('5 轮');

    await page.getByRole('button', { name: /就按这个开始/ }).click();
    await expect(page.getByTestId('question-card')).toBeVisible();
    expectClean(problems);
  });

  test('窄屏顶栏不藏动作：「够了，出稿」仍然点得到', async ({ page }) => {
    const problems = watchPage(page);
    await page.goto('/setup');
    await page.getByRole('button', { name: /就按这个开始/ }).click();
    await expect(page.getByTestId('question-card')).toBeVisible();

    const cta = page.getByRole('button', { name: '够了，出稿 →' });
    await cta.scrollIntoViewIfNeeded();
    await expect(cta).toBeInViewport();
    await cta.click();
    await expect(page).toHaveURL(/\/result/);
    await expectNoHorizontalOverflow(page);
    expectClean(problems);
  });

  test('工作台窄屏：一次一个面板，面板条当选项卡', async ({ page }) => {
    const problems = watchPage(page);
    await page.goto('/setup');
    await page.getByRole('button', { name: /就按这个开始/ }).click();
    await expect(page.getByTestId('question-card')).toBeVisible();
    await expectNoHorizontalOverflow(page);

    // 只有一个面板是可见的
    await expect(page.locator('.panels > .panel:not([hidden])')).toHaveCount(1);
    await expect(page.locator('#p-grill')).toBeVisible();

    // 面板条切到简历活稿
    await page.locator('#chip-draft').click();
    await expect(page.locator('#p-draft')).toBeVisible();
    await expect(page.locator('#p-grill')).toBeHidden();
    await expect(page.locator('.panels > .panel:not([hidden])')).toHaveCount(1);
    await expectNoHorizontalOverflow(page);

    // 回到拷问，答一题，账本里能看到结果
    await page.locator('#chip-grill').click();
    await answerOneRound(page);
    await page.locator('#chip-ledger').click();
    await expect(page.getByTestId('ledger')).toContainText('人均停留时长 +40%');
    await expectNoHorizontalOverflow(page);

    expectClean(problems);
  });

  test('成果页在窄屏是上下堆叠，不是并排挤成两条', async ({ page }) => {
    const problems = watchPage(page);
    await page.goto('/setup');
    const minus = page.getByTestId('plan-board').locator('[data-p="p1"] .pstep button', { hasText: '−' });
    for (let i = 0; i < 4; i += 1) await minus.click();
    await expect(page.getByTestId('plan-rounds-p1')).toHaveText('2 轮');
    await page.getByRole('button', { name: /就按这个开始/ }).click();

    await answerOneRound(page);
    await answerOneRound(page);
    await page.getByRole('button', { name: '看成果 →' }).click();

    await expect(page.getByTestId('reveal-headline')).toBeVisible();
    const before = await page.locator('.pn.before').boundingBox();
    const after = await page.locator('.pn').nth(1).boundingBox();
    expect(after.y, '窄屏应该上下堆叠').toBeGreaterThan(before.y + before.height - 10);
    await expectNoHorizontalOverflow(page);
    expectClean(problems);
  });
});
