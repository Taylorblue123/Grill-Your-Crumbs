/* ============================================================
   PAT 三件套端到端冒烟：真前端 + 真后端 + 假 GitHub。

   验收标准全是行为性的——粘贴 PAT 后仓库列表要真的渲染出来（含私有标记）、
   勾选批量拉取后料列表要出现对应的 repo 料、失败项要各自展示具体错误和兜底
   指引——只有把整套系统跑起来点一遍才算数。

   GitHub 是唯一的假件（剧本在 backend/scripts/fake_llm_server.py 的
   ScriptedGitHub），其余全真。剧本里留了两个故意会失败的仓库
   （me/rate-limited 限流、me/empty-shell 空仓），因为「部分成功部分失败」
   正是批量拉取要验的那件事。

   用法：
     .venv/bin/python -m uvicorn backend.scripts.fake_llm_server:app --port 8000
     node frontend/smoke-github.mjs [baseURL]
   ============================================================ */
import { chromium } from 'playwright';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const BASE = process.argv[2] || 'http://127.0.0.1:8000';
const SHOTS = process.env.SHOT_DIR || mkdtempSync(join(tmpdir(), 'grill-github-'));
const TOKEN = 'ghp_smoketestingtoken1234567890';

const results = [];
const check = (name, pass, detail = '') => {
  results.push({ name, pass, detail });
  console.log(`${pass ? '  ok' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
};

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 1100 } });

const consoleErrors = [];
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
page.on('pageerror', (e) => consoleErrors.push(`pageerror: ${e.message}`));

const shot = (name) => page.screenshot({ path: join(SHOTS, `${name}.png`), fullPage: true });

/* 每次跑之前把上一轮的料清干净，否则「拉取后料列表出现两条」这类断言会被
   上一轮的残留喂饱，跑绿了也说明不了什么。 */
const wipe = async () => {
  const listed = await fetch(`${BASE}/api/v1/crumbs`).then((r) => r.json());
  for (const crumb of listed.crumbs) {
    await fetch(`${BASE}/api/v1/crumbs/${crumb.id}`, { method: 'DELETE' });
  }
  await fetch(`${BASE}/api/v1/github/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: '' }),
  });
};

await wipe();
await page.goto(`${BASE}/#screen=live`, { waitUntil: 'networkidle' });

/* ── 1. 贴 PAT → 仓库列表渲染（含私有标记） ────────────────────── */
const tokenInput = page.locator('input[aria-label="GitHub Personal Access Token"]');
check('未连接时显示贴 token 的输入框', await tokenInput.isVisible());
check('token 输入框是 password 类型（不在屏幕上明文显示）',
  (await tokenInput.getAttribute('type')) === 'password');

await tokenInput.fill(TOKEN);
await page.getByRole('button', { name: '连接 GitHub' }).click();

await page.locator('.gh-list').waitFor({ state: 'visible', timeout: 10000 });
await shot('01-repo-list');

const whoText = await page.locator('.gh-who').innerText();
check('连上后显示是谁的账号', /me/.test(whoText), whoText.replace(/\s+/g, ' ').trim());

const rows = page.locator('.gh-item');
check('四个仓库都列出来了', (await rows.count()) === 4, `实际 ${await rows.count()} 行`);

const listText = await page.locator('.gh-list').innerText();
check('私有仓带「私有」标记', /me\/internal-billing[\s\S]{0,20}私有/.test(listText));
check('公开仓不带私有标记',
  !/me\/second-hand[^\n]*私有/.test(listText));
check('显示最近推送时间（换算成人读得懂的相对时间）', /(天前|个月前|年前|今天|昨天)/.test(listText));

/* token 一存下来就该从组件状态里丢掉——留在输入框里只是让它多活在一个地方。 */
check('token 存下之后输入框被清空', (await tokenInput.count()) === 0 || (await tokenInput.inputValue()) === '');

/* ── 2. 勾选批量拉取 → 料列表出现对应 repo 料 ─────────────────── */
const pick = async (fullName) => {
  await page.locator('.gh-item', { hasText: fullName }).locator('input[type=checkbox]').check();
};
await pick('me/second-hand');
await pick('me/internal-billing');
await pick('me/rate-limited');
await pick('me/empty-shell');

const pullButton = page.getByRole('button', { name: /拉取选中的 4 个/ });
check('按钮上写着选了几个', await pullButton.isVisible());
await pullButton.click();

await page.locator('.repo-msg.ok').waitFor({ state: 'visible', timeout: 15000 });
await shot('02-batch-result');

const okText = await page.locator('.repo-msg.ok').innerText();
check('成功项报「2 个仓库已装载」', /2 个仓库已装载/.test(okText), okText.replace(/\s+/g, ' ').trim());

/* ── 3. 失败项各自展示具体错误 + 兜底指引 ──────────────────────── */
const errBox = page.locator('.repo-msg.err');
check('失败项单独成框', await errBox.isVisible());
const errText = await errBox.innerText();
check('报「2 个仓库没连上」', /2 个仓库没连上/.test(errText));
check('限流那个说的是限流', /me\/rate-limited[\s\S]{0,80}限流/.test(errText));
check('空仓那个说的是没有可拷问的内容', /me\/empty-shell[\s\S]{0,80}没有可拷问的内容/.test(errText));
/* 两种失败的处置完全不同，合成一句「有 2 个没连上」等于把依据丢掉。 */
check('两个失败项各说各的（不是共用一句话）',
  new Set(await page.locator('.gh-fails li').allInnerTexts()).size === 2);
check('限流给了「README 当文件上传」的兜底指引', /README 当文件上传/.test(errText));

/* ── 4. 料真的进了料列表，能被勾选进场 ─────────────────────────── */
const crumbs = await fetch(`${BASE}/api/v1/crumbs`).then((r) => r.json());
const names = crumbs.crumbs.map((c) => c.display_name).sort();
check('后端库里只有成功的那两份',
  JSON.stringify(names) === JSON.stringify(['me/internal-billing', 'me/second-hand']),
  names.join('、'));
check('都是 repo 料', crumbs.crumbs.every((c) => c.kind === 'repo'));
check('私有仓的 README 内容真的进了料',
  crumbs.crumbs.some((c) => c.content.includes('把月结耗时从 3s 压到 400ms')));

const liveText = await page.locator('.live-crumbs').innerText();
check('前端料列表里看得见这两份',
  liveText.includes('me/second-hand') && liveText.includes('me/internal-billing'));

/* 成功的取消勾选、失败的留着——用户直接再点一次就能重试。 */
const stillChecked = await page.locator('.gh-item input:checked').count();
check('成功的取消勾选、失败的留着重试', stillChecked === 2, `仍勾选 ${stillChecked} 个`);

/* ── 5. 有 token 时贴 URL 也能连私有仓 ─────────────────────────── */
await fetch(`${BASE}/api/v1/crumbs/${crumbs.crumbs.find((c) => c.display_name === 'me/internal-billing').id}`,
  { method: 'DELETE' });
await page.reload({ waitUntil: 'networkidle' });

/* 刷新后 token 还在后端内存里（前端状态没了，但那只影响界面显示）。
   贴一个私有仓地址，走的是 RepoBox 那条路——它会自动带上 token。 */
const urlBox = page.locator('input[aria-label="公开仓库地址"]');
await urlBox.fill('https://github.com/me/internal-billing');
await page.getByRole('button', { name: '连接仓库' }).click();
await page.locator('.repo .repo-msg.ok').waitFor({ state: 'visible', timeout: 10000 });
await shot('03-private-via-url');

const privateResult = await fetch(`${BASE}/api/v1/crumbs`).then((r) => r.json());
check('有 token 时贴 URL 能连私有仓',
  privateResult.crumbs.some((c) => c.display_name === 'me/internal-billing'));

/* ── 6. 断开之后私有仓就连不上了 ──────────────────────────────── */
await fetch(`${BASE}/api/v1/crumbs/${privateResult.crumbs.find((c) => c.display_name === 'me/internal-billing').id}`,
  { method: 'DELETE' });
await fetch(`${BASE}/api/v1/github/token`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ token: '' }),
});
const afterDisconnect = await fetch(`${BASE}/api/v1/repos`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ url: 'https://github.com/me/internal-billing' }),
}).then((r) => r.json());
check('断开之后私有仓连不上（token 确实是那扇门）',
  afterDisconnect.results[0].ok === false && afterDisconnect.results[0].error_kind === 'not_found');

/* ── 7. 红线：token 一次都没出现在页面上 ──────────────────────── */
const html = await page.content();
check('整页 HTML 里没有 token', !html.includes(TOKEN));
/* 找的是**长得像 token 的串**，不是 `ghp_` 三个字母：输入框的占位符本来就写着
   「ghp_…」，按前缀找会一直红着，红久了就没人看了。 */
check('整页 HTML 里没有任何 token 形状的串',
  !/gh[pousr]_[A-Za-z0-9_-]{10,}/.test(html),
  (html.match(/gh[pousr]_[A-Za-z0-9_-]{10,}/) || [''])[0]);

check('没有 console 报错', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '));

await browser.close();

const failed = results.filter((r) => !r.pass);
console.log(`\n截图：${SHOTS}`);
console.log(`${results.length - failed.length}/${results.length} 通过`);
process.exit(failed.length ? 1 : 0);
