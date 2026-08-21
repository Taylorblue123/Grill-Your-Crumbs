import { expect } from '@playwright/test';

/**
 * 每条用例都盯着控制台错误、页面异常和失败请求。
 * 流程走通但控制台在报错，不算通过。
 */
export function watchPage(page) {
  const problems = { console: [], pageErrors: [], failedRequests: [] };
  page.on('console', (message) => {
    if (message.type() === 'error') problems.console.push(message.text());
  });
  page.on('pageerror', (error) => problems.pageErrors.push(String(error)));
  page.on('requestfailed', (request) => {
    // 浏览器取消的请求（换页/AbortController）不算失败
    const failure = request.failure()?.errorText || '';
    if (failure.includes('ERR_ABORTED') || failure.includes('NS_BINDING_ABORTED')) return;
    problems.failedRequests.push(`${request.method()} ${request.url()} — ${failure}`);
  });
  return problems;
}

/**
 * @param {object} problems watchPage 收集到的问题
 * @param {{ expectNetworkFailures?: boolean }} options
 *   故意把后端打断的用例传 true：浏览器自己会往控制台记一条
 *   「Failed to load resource」，那是我们制造的，不是应用出错。
 *   即便如此，未捕获异常和其他控制台错误仍然一条都不允许。
 */
export function expectClean(problems, options = {}) {
  expect(problems.pageErrors, '页面未捕获异常').toEqual([]);
  const consoleErrors = options.expectNetworkFailures
    ? problems.console.filter((line) => !line.startsWith('Failed to load resource'))
    : problems.console;
  expect(consoleErrors, '控制台 error').toEqual([]);
  if (!options.expectNetworkFailures) {
    expect(problems.failedRequests, '失败的网络请求').toEqual([]);
  }
}

/** 答完一轮：填答案 → 发送 → 等下一题（reducer 里有约 2s 的观察窗口）。 */
export async function answerOneRound(page) {
  const roundLabel = await page.getByTestId('question-card').locator('.qc-h').innerText();
  await page.getByRole('button', { name: '我来补充' }).click();
  await expect(page.getByTestId('composer-send')).toBeEnabled();
  await page.getByTestId('composer-send').click();
  await expect(page.getByTestId('pending-answer')).toBeVisible();
  // 下一题落地：问题卡的头部换了内容
  await expect(page.getByTestId('question-card').locator('.qc-h')).not.toHaveText(roundLabel, {
    timeout: 15_000,
  });
}

/** 从落地页走到工作台。 */
export async function gotoWorkbench(page) {
  await page.goto('/setup');
  await expect(page.getByTestId('plan-board')).toBeVisible();
  await page.getByRole('button', { name: /就按这个开始/ }).click();
  await expect(page).toHaveURL(/\/workbench/);
  await expect(page.getByTestId('question-card')).toBeVisible();
}

/** 面板条是「点一下收起、再点展开」，所以展开前先看它现在什么状态。 */
export async function expandPanel(page, key) {
  const panel = page.locator(`#p-${key}`);
  if ((await panel.getAttribute('data-state')) === 'min') {
    await page.locator(`#chip-${key}`).click();
  }
  await expect(panel).not.toHaveAttribute('data-state', 'min');
}
