import { expect, test } from '@playwright/test';
import { expectClean, watchPage } from './helpers';

test.describe('核心导航', () => {
  test('五屏能走通，刷新 / 后退 / 前进都停在对的地方', async ({ page }) => {
    const problems = watchPage(page);

    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('没人问过你正确的问题');

    await page.getByRole('button', { name: '进入我的工作区 →' }).first().click();
    await expect(page).toHaveURL(/\/workspace/);
    await expect(page.getByRole('heading', { name: 'Chen 的工作区' })).toBeVisible();

    await page.getByRole('link', { name: '机会' }).click();
    await expect(page).toHaveURL(/\/opportunities/);
    await expect(page.getByRole('heading', { name: '机会', level: 1 })).toBeVisible();

    await page.getByRole('button', { name: '＋ 开一场新的 Grill' }).click();
    await expect(page).toHaveURL(/\/setup/);
    await expect(page.getByTestId('plan-board')).toBeVisible();

    // 刷新之后仍然是作战板这一屏，不会被打回落地页
    await page.reload();
    await expect(page).toHaveURL(/\/setup/);
    await expect(page.getByTestId('plan-board')).toBeVisible();

    // 后退两步回到工作区，再前进回作战板
    await page.goBack();
    await expect(page).toHaveURL(/\/opportunities/);
    await page.goBack();
    await expect(page).toHaveURL(/\/workspace/);
    await page.goForward();
    await expect(page).toHaveURL(/\/opportunities/);

    expectClean(problems);
  });

  test('未知路径回落地页，不是白屏', async ({ page }) => {
    const problems = watchPage(page);
    await page.goto('/no-such-page');
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    expectClean(problems);
  });

  test('深色 / 皮肤切换作用在整套系统上，并且刷新后还在', async ({ page }) => {
    const problems = watchPage(page);
    await page.goto('/workspace');

    await page.getByRole('button', { name: '切换到深色主题' }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');

    await page.getByRole('button', { name: /当前视觉：编辑部/ }).click();
    await expect(page.locator('html')).toHaveAttribute('data-skin', 'terminal');

    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await expect(page.locator('html')).toHaveAttribute('data-skin', 'terminal');

    // 换回来，免得影响后面的用例截图
    await page.getByRole('button', { name: '切换到浅色主题' }).click();
    expectClean(problems);
  });
});
