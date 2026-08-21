/* ============================================================
   真实后端那条竖切的验收：上传 → 落库 → 出现在材料库 → 进本场 → 删除。
   这一条走的是 POST /api/v1/attachments，不是 mock。
   后端没起的时候整套用例会 skip，并且界面必须诚实地说「后端未连接」。
   ============================================================ */
import { expect, test } from '@playwright/test';
import { expandPanel, expectClean, watchPage } from './helpers';

const NOTE = `# 交接记录\n2025-09-20 把限流中间件交接给学弟，写了一份 runbook。\n上线后网关 5xx 从 0.9% 降到 0.05%。\n`;

async function backendUp(request) {
  try {
    const response = await request.get('/api/health');
    return response.ok();
  } catch {
    return false;
  }
}

test.describe('材料 API（真实后端）', () => {
  test.beforeEach(async ({ request }) => {
    test.skip(!(await backendUp(request)), '后端没启动，跳过真实接口验收');
  });

  test('顶栏如实标出后端已连接', async ({ page }) => {
    const problems = watchPage(page);
    await page.goto('/workspace');
    await expect(page.getByTestId('backend-chip')).toHaveClass(/online/);
    expectClean(problems);
  });

  test('上传一份材料：落库、进材料库、自动进本场，然后能删掉', async ({ page }) => {
    const problems = watchPage(page);
    const fileName = `e2e-note-${Date.now()}.md`;

    await page.goto('/workspace');
    await expect(page.getByTestId('backend-chip')).toHaveClass(/online/);
    const before = await page.locator('#root .scell').count();

    await page.locator('input[type="file"]').first().setInputFiles({
      name: fileName,
      mimeType: 'text/markdown',
      buffer: Buffer.from(NOTE, 'utf-8'),
    });

    // 进度行走到「已装载」
    await expect(page.locator('.upload-row.ok')).toContainText('已装载', { timeout: 20_000 });

    // 材料库多了一条，并且标着「已入库」而不是「样例」
    const card = page.locator('.scell').filter({ hasText: fileName });
    await expect(card).toHaveCount(1);
    await expect(card.locator('.origin-tag')).toHaveText('已入库');
    await expect(card).toContainText('本场使用中');
    expect(await page.locator('#root .scell').count()).toBe(before + 1);

    // 刷新之后它还在 —— 说明是后端持久化的，不是前端内存里的
    await page.reload();
    await expect(page.locator('.scell').filter({ hasText: fileName })).toHaveCount(1);

    // 它真的进了本场：工作台的材料面板里能找到
    await page.goto('/workbench');
    await expandPanel(page, 'crumbs');
    await expect(page.locator('#p-crumbs .csec-h').first()).toContainText('本场使用中');
    await expect(page.locator('#p-crumbs .src').filter({ hasText: fileName })).toHaveCount(1);

    // 删除：列表里没了，刷新之后也没了
    await page.goto('/workspace');
    await page.locator('.scell').filter({ hasText: fileName }).getByRole('button', { name: '删除' }).click();
    await expect(page.locator('.scell').filter({ hasText: fileName })).toHaveCount(0);
    await page.reload();
    await expect(page.locator('.scell').filter({ hasText: fileName })).toHaveCount(0);

    expectClean(problems);
  });

  test('同一份文件传两次：后端按内容去重，不会造出第二条出处', async ({ page, request }) => {
    const problems = watchPage(page);
    const fileName = `e2e-dup-${Date.now()}.md`;
    const file = { name: fileName, mimeType: 'text/markdown', buffer: Buffer.from(NOTE, 'utf-8') };

    await page.goto('/workspace');
    await expect(page.getByTestId('backend-chip')).toHaveClass(/online/);

    await page.locator('input[type="file"]').first().setInputFiles(file);
    await expect(page.locator('.upload-row.ok').first()).toContainText('已装载', { timeout: 20_000 });

    await page.locator('input[type="file"]').first().setInputFiles(file);
    await expect(page.locator('.upload-row.ok').first()).toContainText('已有，已装载', { timeout: 20_000 });
    await expect(page.locator('.scell').filter({ hasText: fileName })).toHaveCount(1);

    // 清理，别把状态留给下一条用例
    await page.locator('.scell').filter({ hasText: fileName }).getByRole('button', { name: '删除' }).click();
    await expect(page.locator('.scell').filter({ hasText: fileName })).toHaveCount(0);

    expect((await request.get('/api/v1/crumbs')).ok()).toBe(true);
    expectClean(problems);
  });

  test('后端返回错误时，界面把原因说出来而不是静默失败', async ({ page }) => {
    const problems = watchPage(page);
    await page.goto('/workspace');
    await expect(page.getByTestId('backend-chip')).toHaveClass(/online/);

    // 不受支持的扩展名 → 后端 415
    await page.route('**/api/v1/attachments', (route) =>
      route.fulfill({ status: 415, contentType: 'application/json', body: JSON.stringify({ detail: '不支持的文件类型' }) }),
    );
    await page.locator('input[type="file"]').first().setInputFiles({
      name: 'bad.md',
      mimeType: 'text/markdown',
      buffer: Buffer.from('x', 'utf-8'),
    });
    await expect(page.locator('.upload-row.err')).toContainText('不支持的文件类型');
    expectClean(problems, { expectNetworkFailures: true });
  });
});

test.describe('后端不在的时候', () => {
  test('整站仍然完整可演示，只是明说上传不可用', async ({ page }) => {
    const problems = watchPage(page);
    // 把材料 API 全部打断，模拟后端没起
    await page.route('**/api/health', (route) => route.abort('connectionrefused'));
    await page.route('**/api/v1/**', (route) => route.abort('connectionrefused'));

    await page.goto('/workspace');
    await expect(page.getByTestId('backend-chip')).toHaveClass(/offline/);
    await expect(page.getByTestId('material-grid').locator('.scell')).not.toHaveCount(0);
    await expect(page.locator('.upload-privacy')).toContainText('现在连不上后端，上传不可用');

    // 拷问流程完全不依赖后端
    await page.goto('/setup');
    await page.getByRole('button', { name: /就按这个开始/ }).click();
    await expect(page.getByTestId('question-card')).toBeVisible();

    expectClean(problems, { expectNetworkFailures: true });
  });
});
