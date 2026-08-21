/* ============================================================
   可访问性与加载 / 空 / 错误 / 成功状态。

   设计稿的三色出处只用颜色和悬停传达信息 —— 那对键盘和读屏用户是零。
   这里守住补上去的那几条：片段可聚焦、有 aria-label、菜单能用键盘走完。
   ============================================================ */
import { expect, test } from '@playwright/test';
import { expandPanel, expectClean, gotoWorkbench, watchPage } from './helpers';

test.describe('可访问性', () => {
  test('稿子里的片段能用键盘聚焦，并说出自己是哪一类出处', async ({ page }) => {
    const problems = watchPage(page);
    await gotoWorkbench(page);

    const source = page.locator('#viewA .sg.source').first();
    await source.focus();
    await expect(source).toBeFocused();
    await expect(source).toHaveAttribute('aria-label', /来自你已有的材料/);

    const inferred = page.locator('#viewA .sg.inferred').first();
    await expect(inferred).toHaveAttribute('aria-label', /AI 补的，请你确认/);

    // 还没挖到的灰骨架不该进 Tab 流 —— 它没有内容可读
    await expect(page.locator('#viewA .sg.grill.ghost').first()).toHaveAttribute('tabindex', '-1');

    // 聚焦即出出处浮层，不必用鼠标悬停
    await source.focus();
    await expect(page.locator('#pop')).toBeVisible();
    expectClean(problems);
  });

  test('作战板那句话里的下拉能用键盘走完', async ({ page }) => {
    const problems = watchPage(page);
    await page.goto('/setup');

    const slot = page.getByRole('button', { name: /目标：后端开发实习生/ });
    await slot.focus();
    await page.keyboard.press('Enter');
    const menu = page.getByRole('menu', { name: '目标' });
    await expect(menu).toBeVisible();

    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    await expect(menu).toBeHidden();
    await expect(page.getByTestId('config-sentence')).toContainText('Research Assistant');
    // 焦点回到触发它的那个词上，不会掉到页面顶部
    await expect(page.getByRole('button', { name: /目标：推荐系统方向/ })).toBeFocused();

    // Esc 关掉菜单
    await page.keyboard.press('Enter');
    await expect(page.getByRole('menu', { name: '目标' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('menu', { name: '目标' })).toBeHidden();
    expectClean(problems);
  });

  test('工作台快捷键 1–5 收放面板，输入框里不抢键', async ({ page }) => {
    const problems = watchPage(page);
    await gotoWorkbench(page);
    await expandPanel(page, 'crumbs');

    // 进工作台时焦点在输入框里（设计如此），所以先把焦点挪出来
    await page.getByTestId('composer-input').blur();
    await page.keyboard.press('1');
    await expect(page.locator('#p-crumbs')).toHaveAttribute('data-state', 'min');
    await page.keyboard.press('1');
    await expect(page.locator('#p-crumbs')).not.toHaveAttribute('data-state', 'min');

    // 在输入框里打「1」应该是输入，不是收面板
    await page.getByTestId('composer-input').fill('1');
    await expect(page.getByTestId('composer-input')).toHaveValue('1');
    await expect(page.locator('#p-crumbs')).not.toHaveAttribute('data-state', 'min');
    expectClean(problems);
  });

  test('每一屏都有唯一的 h1，语言标为中文', async ({ page }) => {
    const problems = watchPage(page);
    for (const path of ['/', '/workspace', '/opportunities', '/setup']) {
      await page.goto(path);
      await expect(page.locator('html')).toHaveAttribute('lang', 'zh-CN');
      await expect(page.locator('h1'), `${path} 应该只有一个 h1`).toHaveCount(1);
    }
    expectClean(problems);
  });
});

test.describe('加载 / 空 / 错误 / 成功状态', () => {
  test('装载中有明确的等待态，不是白屏', async ({ page }) => {
    const problems = watchPage(page);
    // 把材料列表拖慢，让装载态稳定可见
    await page.route('**/api/v1/crumbs', async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 1200));
      await route.continue();
    });
    await page.goto('/workspace');
    await expect(page.getByText('正在准备这一场…')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Chen 的工作区' })).toBeVisible({ timeout: 20_000 });
    expectClean(problems);
  });

  test('账本的空态说清「还没有收获」，不是一片空白', async ({ page }) => {
    const problems = watchPage(page);
    await gotoWorkbench(page);
    await expandPanel(page, 'ledger');
    await expect(page.getByTestId('ledger')).toContainText('还没有收获');
    await expect(page.locator('#p-ledger .pc')).toHaveText('0');
    expectClean(problems);
  });

  test('答完一题有明确的成功反馈：toast ＋ 拆出几条', async ({ page }) => {
    const problems = watchPage(page);
    await gotoWorkbench(page);

    await page.getByRole('button', { name: '我来补充' }).click();
    await expect(page.getByTestId('composer-send')).toBeEnabled();
    await page.getByTestId('composer-send').click();

    await expect(page.locator('.toast.on')).toContainText('记进账本了');
    await expect(page.getByTestId('pending-answer')).toContainText('拆出 2 条');
    expectClean(problems);
  });
});
