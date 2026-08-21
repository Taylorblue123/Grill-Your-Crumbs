/* ============================================================
   端到端冒烟：把 React 前端 + FastAPI 后端当成一个真实运行的系统来点。

   断言的是「行为」，不是「CSS 声明」：面板宽度读实际渲染宽度，计数读渲染出来
   的数字，上传走真实的 multipart 请求。全程收集 console error，一个都不许有。

   用法：node smoke.mjs [baseURL]   默认 http://127.0.0.1:8000
   ============================================================ */
import { chromium } from 'playwright';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const BASE = process.argv[2] || 'http://127.0.0.1:8000';
const SHOTS = process.env.SHOT_DIR || mkdtempSync(join(tmpdir(), 'grill-shots-'));

const results = [];
const check = (name, pass, detail = '') => {
  results.push({ name, pass, detail });
  console.log(`${pass ? '  ok' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
};

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });

const consoleErrors = [];
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
page.on('pageerror', (e) => consoleErrors.push(`pageerror: ${e.message}`));

const shot = async (name) => {
  await page.screenshot({ path: join(SHOTS, `${name}.png`), fullPage: false });
};

// ── ⓪ 落地页 ──────────────────────────────────────────────
await page.goto(BASE, { waitUntil: 'networkidle' });
check('落地页渲染', await page.locator('.hero h1').isVisible());
check('落地页示例稿有三色片段',
  (await page.locator('.spec .sg').count()) > 0,
  `${await page.locator('.spec .sg').count()} 个片段`);
await shot('01-landing');

// ── ① 工作区 ──────────────────────────────────────────────
await page.getByRole('button', { name: '进入我的工作区 →' }).first().click();
await page.waitForSelector('.expgrid .exp');
check('工作区按经历组织', (await page.locator('.expgrid .exp').count()) === 3);
check('维度矩阵是六格', (await page.locator('.expgrid .exp').first().locator('.mcell').count()) === 6);
await shot('02-dash');

// ── ①b 机会 ───────────────────────────────────────────────
await page.getByRole('button', { name: '机会', exact: true }).click();
await page.waitForSelector('.oppgrid .opp');
check('机会页三张卡（含合伙人入口）', (await page.locator('.oppgrid .opp').count()) === 3);
await shot('03-opps');

// ── ② 投喂 ────────────────────────────────────────────────
await page.getByRole('button', { name: '＋ 开一场新的 Grill' }).click();
await page.waitForSelector('.upload');
check('投喂页有上传入口', await page.locator('.upload').isVisible());
check('Target 选择器列出目标', (await page.locator('.tgopt').count()) >= 3);

// 真实上传：走 POST /api/v1/attachments
const uploadPath = join(SHOTS, 'chen-notes.md');
writeFileSync(uploadPath, '2025-11-02 把冷启动从 3s 压到 900ms，办法是把索引预热挪到健康检查之前。\n');
await page.setInputFiles('.upload input[type=file]', uploadPath);
await page.waitForSelector('.upload-row.ok', { timeout: 15000 });
check('上传成功并落库', (await page.locator('.upload-row.ok b').first().innerText()).includes('已装载'));

const uploadedCard = page.locator('.crumbgrid .cr', { hasText: 'chen-notes.md' });
check('上传的材料进入本场', await uploadedCard.count() === 1);
check('上传的材料可删除（后端 DELETE）', await uploadedCard.locator('.crx').isVisible());

// 后端真的存下来了吗
const listed = await page.evaluate(async () => (await fetch('/api/v1/crumbs')).json());
check('GET /api/v1/crumbs 返回它',
  listed.crumbs.some((c) => c.display_name === 'chen-notes.md'),
  `后端现有 ${listed.crumbs.length} 条`);

// 上传内容按文本渲染，不解析成 HTML
await page.setInputFiles('.upload input[type=file]',
  (() => {
    const p = join(SHOTS, 'xss.md');
    writeFileSync(p, '<img src=x onerror=alert(1)>结论：限流用令牌桶。\n');
    return p;
  })());
await page.waitForSelector('.crumbgrid .cr:has-text("xss.md")', { timeout: 15000 });
check('上传内容只按文本渲染', (await page.locator('.crumbgrid img').count()) === 0);
await shot('04-setup-upload');

// ── ③ 工作台 ──────────────────────────────────────────────
await page.getByRole('button', { name: '开始拷问 →' }).click();
await page.waitForSelector('.panels .panel');
check('五个面板，顺序为 材料–拷问–简历–账本–目标',
  (await page.locator('.panels .panel').evaluateAll(
    (ns) => ns.map((n) => n.id).join(','),
  )) === 'p-crumbs,p-grill,p-draft,p-ledger,p-target');

// 用实际渲染宽度断言，不看 CSS 声明
const widths = await page.locator('.panels .panel').evaluateAll(
  (ns) => ns.map((n) => Math.round(n.getBoundingClientRect().width)),
);
check('目标面板默认收成竖条', widths[4] <= 50, `实测 ${widths[4]}px`);

check('上传的材料出现在工作台材料面板',
  await page.locator('#p-crumbs .src', { hasText: 'chen-notes.md' }).count() === 1);

const goldBefore = Number(await page.locator('#p-draft .clegend .cl.hot b').innerText());
check('开局金色片段为 0', goldBefore === 0);
await shot('05-workbench-start');

// 答一轮：点「就按你猜的算」，它会自动填入并发送
await page.getByRole('button', { name: '就按你猜的算' }).click();
await page.waitForSelector('#p-grill .past', { timeout: 20000 });
await page.waitForTimeout(600);

const goldAfter = Number(await page.locator('#p-draft .clegend .cl.hot b').innerText());
check('答完一轮，稿子长出金色片段', goldAfter > goldBefore, `${goldBefore} → ${goldAfter}`);
check('账本记了可数的条目',
  Number(await page.locator('#p-ledger .pc').innerText()) === 2,
  await page.locator('#p-ledger .pc').innerText());
check('轮次计数前进', (await page.locator('#p-grill .pc').innerText()) === '1 / 6');

// 撤回：稿子必须跟着退回去
await page.getByRole('button', { name: /撤回上一步/ }).click();
await page.waitForTimeout(400);
check('撤回后金色片段退回骨架',
  Number(await page.locator('#p-draft .clegend .cl.hot b').innerText()) === goldBefore);
check('撤回后账本清空', (await page.locator('#p-ledger .pc').innerText()) === '0');

// 再答回来，继续验证「材料移出本场 → 引用它的句子失去出处」
await page.getByRole('button', { name: '就按你猜的算' }).click();
await page.waitForSelector('#p-grill .past', { timeout: 20000 });
await page.waitForTimeout(600);

const srcBefore = Number(await page.locator('#p-draft .clegend .cl').first().locator('b').innerText());
await page.locator('#p-crumbs .src', { hasText: 'campus-rec / README.md' }).locator('.pm2').click();
await page.waitForTimeout(400);
check('材料移出本场 → 引用它的句子标「出处已移出」',
  (await page.locator('#p-draft .sg.source.orphan').count()) > 0,
  `${await page.locator('#p-draft .sg.source.orphan').count()} 处`);
const srcAfter = Number(await page.locator('#p-draft .clegend .cl').first().locator('b').innerText());
check('「有材料出处」计数相应减少', srcAfter < srcBefore, `${srcBefore} → ${srcAfter}`);
await page.locator('#p-crumbs .src', { hasText: 'campus-rec / README.md' }).locator('.pm2').click();
await page.waitForTimeout(300);

// 面板三态
await page.getByRole('button', { name: /^材料1$/ }).click().catch(() => {});
await page.locator('.panelbar .pchip').first().click();
await page.waitForTimeout(350);
const w2 = await page.locator('#p-crumbs').evaluate((n) => Math.round(n.getBoundingClientRect().width));
check('面板可收成 46px 竖条', w2 <= 50, `实测 ${w2}px`);
await page.locator('.panelbar .pchip').first().click();
await page.waitForTimeout(350);

// 账本按标签分栏
await page.getByRole('button', { name: '按标签' }).click();
await page.waitForTimeout(300);
check('账本可切换到按标签分栏', (await page.locator('#p-ledger .lgroup').count()) > 0);
await page.getByRole('button', { name: '按维度' }).click();

// JD 清单
await page.getByRole('button', { name: '看清单 →' }).click();
await page.waitForTimeout(500);
check('JD 拆成 14 条要求', (await page.locator('#p-target .req').count()) === 14);
check('「你确实没有」的要求被单列', (await page.locator('#p-target .req.gap').count()) === 2);
await shot('06-workbench-answered');

// ── ④ 成果 ────────────────────────────────────────────────
await page.getByRole('button', { name: '够了，出稿 →' }).click();
await page.waitForSelector('.rv-b .panes');
check('成果页原文与成稿并排', (await page.locator('.panes .pn').count()) === 2);
check('成果页不画灰色骨架', (await page.locator('.rv-b .sg.grill.ghost').count()) === 0);
check('JD 对齐板出现', await page.locator('.jdboard').isVisible());

// 红线：gap 状态的要求绝不能出现在成稿文案里
const sheetText = await page.locator('.pn:not(.before) .sheet').innerText();
check('gap 要求没有被写成文案',
  !/Kubernetes|Kafka|Pulsar/i.test(sheetText));
await shot('07-done');

// ── ⑤ 存回工作区 ──────────────────────────────────────────
await page.getByRole('button', { name: '完成，存进工作区 →' }).first().click();
await page.waitForSelector('.expgrid .exp.now');
check('存回后经历卡标为已成型',
  (await page.locator('.expgrid .exp.now .state').innerText()) === '已成型');
await shot('08-saved');

// ── 深链 ──────────────────────────────────────────────────
await page.goto(`${BASE}/#screen=wb&round=4&theme=dark&ledger=tag&panel=target:norm`, { waitUntil: 'networkidle' });
await page.waitForSelector('.panels .panel');
check('深链直达已答 4 轮的工作台', (await page.locator('#p-grill .pc').innerText()) === '4 / 6');
check('深链切到深色主题',
  (await page.evaluate(() => document.documentElement.dataset.theme)) === 'dark');
await shot('09-deeplink-dark');

// ── 皮肤 ──────────────────────────────────────────────────
// 进工作台会把焦点放进输入框，此时 s 必须是「打一个 s」，不是换皮肤。
await page.locator('.cp-in').focus();
await page.keyboard.press('s');
await page.waitForTimeout(200);
check('输入框里按 s 是打字，不触发快捷键',
  (await page.evaluate(() => document.documentElement.dataset.skin)) === 'paper'
  && (await page.locator('.cp-in').inputValue()) === 's');

await page.locator('.cp-in').fill('');
await page.locator('.panelbar .pbLabel').first().click();  // 把焦点移出输入框
await page.keyboard.press('s');
await page.waitForTimeout(300);
check('输入框外按 s 换皮肤',
  (await page.evaluate(() => document.documentElement.dataset.skin)) === 'terminal');
await shot('10-skin-terminal');

// ── 窄屏 ──────────────────────────────────────────────────
await page.setViewportSize({ width: 720, height: 900 });
await page.waitForTimeout(500);
const narrow = await page.locator('.panels .panel').evaluateAll(
  (ns) => ns.map((n) => Math.round(n.getBoundingClientRect().width)),
);
check('窄屏自动把低优先级面板收起', narrow[0] <= 50 && narrow[3] <= 50, narrow.join('/'));
await shot('11-narrow');

check('全程 0 个 console error', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '));

await browser.close();

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} 通过　截图：${SHOTS}`);
process.exit(failed.length ? 1 : 0);
