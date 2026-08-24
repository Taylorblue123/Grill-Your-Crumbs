/* ============================================================
   作答循环端到端冒烟：真前端 + 真后端 + 假 LLM。

   验收标准全是行为性的——点选项要填进作答框、事实要看得见落进账本、刷新要
   接得回现场——只有把整套系统跑起来点一遍才算数。LLM 是唯一的假件（剧本在
   backend/scripts/fake_llm_server.py），其余全真。

   用法：
     .venv/bin/python -m uvicorn backend.scripts.fake_llm_server:app --port 8000
     node frontend/smoke-live.mjs [baseURL]
   ============================================================ */
import { chromium } from 'playwright';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const BASE = process.argv[2] || 'http://127.0.0.1:8000';
const SHOTS = process.env.SHOT_DIR || mkdtempSync(join(tmpdir(), 'grill-live-'));

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

/* ── 备料：上传一份 HTML 简历（真 multipart，走真抽取） ────────────── */
await page.goto(`${BASE}/#screen=live`, { waitUntil: 'networkidle' });

const resumeHtml = `<html><body><h1>张三</h1>
<p>后端工程师，五年经验。负责订单系统。</p>
<ul><li>优化了接口性能</li><li>用过 Redis、MySQL</li></ul>
</body></html>`;

await page.setInputFiles('input[type=file]', {
  name: '我的简历.html',
  mimeType: 'text/html',
  buffer: Buffer.from(resumeHtml, 'utf-8'),
});
await page.waitForSelector('.live-cr', { timeout: 15000 });
check('简历上传后出现在料列表', (await page.locator('.live-cr').count()) >= 1);

/* ── ① 定靶 → 首题 ───────────────────────────────────────────── */
await page.locator('.live-jd').fill('招高级后端工程师，要求有性能调优经验，能带人，能 on-call。');
await page.getByRole('button', { name: '开始拷问 →' }).click();
await page.waitForSelector('.qcard', { timeout: 30000 });

check('首题出现', await page.locator('.qcard .q').isVisible());
check('问题卡带作答框', await page.locator('.live-ans-box').isVisible());
check('账本一开始是空的', await page.locator('.live-ledger-empty').isVisible());
check('「够了，去改写」第一题就可用',
  await page.getByRole('button', { name: '够了，去改写 →' }).isEnabled());
await shot('01-first-question');

/* ── ② 点选项自动填入作答框，且可继续编辑 ───────────────────── */
const optionText = await page.locator('.live-opt').first().locator('.t').innerText();
await page.locator('.live-opt').first().click();
const filled = await page.locator('.live-ans-box').inputValue();
check('点选项自动填入作答框', filled === optionText, `框里是「${filled.slice(0, 20)}…」`);

await page.locator('.live-ans-box').fill(`${filled}，把 P99 从 800ms 压到 120ms`);
const edited = await page.locator('.live-ans-box').inputValue();
check('填入后可继续编辑', edited.includes('800ms'));
await shot('02-option-filled');

/* ── ③ 提交 → 事实落进账本 + 下一题 ──────────────────────────── */
const q1 = await page.locator('.qcard .q').innerText();
await page.getByRole('button', { name: '答完了，继续 →' }).click();
await page.waitForSelector('.live-fact', { timeout: 30000 });

const factCount = await page.locator('.live-fact').count();
check('答完立刻看到事实落进账本', factCount === 2, `${factCount} 条`);
check('新落账的事实有高亮标记', (await page.locator('.live-fact.born').count()) === 2);
check('账本计数跟着更新',
  (await page.locator('.live-ledger-h .b').innerText()).trim() === '2');
check('事实标着来自第几问',
  (await page.locator('.live-fact .meta').first().innerText()).includes('第 1 问'));

const q2 = await page.locator('.qcard .q').innerText();
check('下一题咬住上一答往深处追', q2 !== q1 && q2.includes('92%'), q2.slice(0, 30));
check('第二题编号是「第 2 问」',
  (await page.locator('.qcard .dimtag').innerText()).includes('第 2 问'));
check('作答框换题后清空', (await page.locator('.live-ans-box').inputValue()) === '');
check('remaining 随树缩小',
  (await page.locator('.qcard .qsrc').innerText()).includes('还剩 1 个'));
await shot('03-facts-landed');

/* ── ④ 自由作答（完全无视选项） ─────────────────────────────── */
await page.locator('.live-ans-box').fill('自己埋点上了 Grafana 面板，全组都在看。');
await page.getByRole('button', { name: '答完了，继续 →' }).click();
await page.waitForFunction(() => document.querySelectorAll('.live-fact').length === 3,
  null, { timeout: 30000 });
check('自由作答同样能提交并落账', (await page.locator('.live-fact').count()) === 3);
check('账本是累加的，不覆盖前几轮',
  (await page.locator('.live-fact').first().innerText()).includes('800ms'));

/* ── ⑤ 刷新 → 会话自动重连恢复现场 ──────────────────────────── */
const beforeReload = await page.locator('.qcard .q').innerText();
await page.reload({ waitUntil: 'networkidle' });
await page.waitForSelector('.qcard', { timeout: 30000 });

check('刷新后恢复到同一道题',
  (await page.locator('.qcard .q').innerText()) === beforeReload);
check('刷新后账本原样还在', (await page.locator('.live-fact').count()) === 3);
check('刷新后 JD 也回来了',
  (await page.locator('.qcard .dimtag').innerText()).includes('第 3 问'));
await shot('04-restored');

/* ── ⑥ 树问空 → 自动收口 ────────────────────────────────────── */
await page.locator('.live-ans-box').fill('出过一次缓存击穿，加了互斥锁。');
await page.getByRole('button', { name: '答完了，继续 →' }).click();
await page.waitForSelector('.live-rewrite', { timeout: 30000 });

check('树空时自动收口', await page.locator('.live-rewrite').isVisible());
check('收口后没有问题卡了', (await page.locator('.qcard').count()) === 0);
check('收口那一轮的事实照样入账本', (await page.locator('.live-fact').count()) === 4);
/* 答了 3 轮，挖出 4 条——轮数和事实数不是一回事（一轮可以抽出好几条）。 */
const sumText = await page.locator('.live-rewrite-h h3').innerText();
check('收口文案报出问了几轮、挖到几条', sumText.includes('3 问') && sumText.includes('4 条'), sumText);
/* 收口之后这一屏换了身份：定靶那套抬头不该还在。 */
check('收口后不再显示「贴一段 JD」的抬头', (await page.locator('.live-h1').count()) === 0);
await shot('05-closed');

/* ── ⑥b 成稿对比：初稿自动出、金色溯源、改稿、版本、Markdown ──── */
await page.waitForSelector('.live-rewrite .live-cmp', { timeout: 30000 });

check('收口后自动出初稿，不用先点一个「生成」',
  (await page.locator('.live-rewrite .pn').count()) === 2);
check('左边是原简历',
  (await page.locator('.live-rewrite .pn.before .old').innerText()).includes('优化了接口性能'));
check('右边标着当前版本号',
  (await page.locator('.live-rewrite .pn:not(.before) .pn-t').innerText()).includes('v1'));

/* 金色片段＝拷问挖出来的那几段。原简历本来就有的不染色——满屏都染
   等于什么都没指认。 */
const goldCount = await page.locator('.live-rewrite .sg.grill').count();
check('拷问挖出来的段落染成金色', goldCount > 0, `${goldCount} 处`);
check('原简历本来就有的段落不染色',
  (await page.locator('.live-rewrite .sheet .bul').count()) > goldCount);
check('金色段落的沟槽里标着它来自第几问',
  (await page.locator('.live-rewrite .sheet .bul.gold .rd').count()) === goldCount);
check('账本搬进了出处边栏', (await page.locator('.live-rail .live-fact').count()) === 4);

/* hover 金色片段 → 弹出它来自的那一轮问答。 */
await page.locator('.live-rewrite .sg.grill').first().hover();
await page.waitForSelector('#pop', { timeout: 5000 });
const popText = await page.locator('#pop').innerText();
check('hover 金色片段显示它来自第几问', /第 \d+ 问/.test(popText), popText.slice(0, 40));
check('hover 卡片带出当轮的问和答', popText.includes('问：') && popText.includes('答：'));
/* 出处那条线的两头：hover 段落点亮它依据的事实，hover 事实点亮引用它的段落。 */
check('hover 金色段落，账本里它依据的事实亮起来',
  (await page.locator('.live-rail .live-fact.lit').count()) > 0);
await page.locator('.live-rail .live-fact').last().hover();
check('hover 一条事实，引用它的段落亮起来',
  (await page.locator('.live-rewrite .sheet .bul.lit').count()) > 0);
await page.mouse.move(0, 0);
await shot('05b-draft');

/* 一键复制 Markdown。剪贴板权限在 headless 里要显式授予。 */
await page.context().grantPermissions(['clipboard-read', 'clipboard-write'], { origin: BASE });
await page.getByRole('button', { name: '复制 Markdown' }).click();
const clipboard = await page.evaluate(() => navigator.clipboard.readText());
const sheetText = await page.locator('.live-rewrite .sheet').innerText();
const copied = clipboard.split('\n\n').map((line) => line.trim()).filter(Boolean);
const bullets = await page.locator('.live-rewrite .sheet .bul').allInnerTexts();
check('复制出来的 Markdown 不是空的', copied.length > 0);
/* 两个方向都要验：只验「复制的每段都在成稿里」，漏掉一半段落的复制照样通过。 */
check('复制的每一段都在右侧成稿里',
  copied.every((line) => sheetText.includes(line)));
check('右侧成稿的每一段都被复制到了',
  bullets.length === copied.length
    && bullets.every((b) => copied.some((line) => b.replace(/^—\s*/, '').includes(line))),
  `成稿 ${bullets.length} 段 / 复制 ${copied.length} 段`);

/* 自然语言指令改稿 → 版本推进，出处标记不丢。 */
await page.locator('.live-input').fill('口语一点');
await page.getByRole('button', { name: '改一版' }).click();
await page.waitForSelector('.live-versions', { timeout: 30000 });
check('指令改稿推进到 v2',
  (await page.locator('.live-rewrite .pn:not(.before) .pn-t').innerText()).includes('v2'));
check('改稿后金色溯源没丢',
  (await page.locator('.live-rewrite .sg.grill').count()) === goldCount);
/* 正常指令不该被拒——之前的 smoke 没验这一条，假 LLM 把每条指令都拒了也照样全绿。 */
check('正常指令没有被拒', (await page.locator('.live-refusal').count()) === 0);
check('改稿之后正文确实变了',
  (await page.locator('.live-rewrite .sheet').innerText()).includes('改稿版'));
check('改稿成功后指令框清空', (await page.locator('.live-input').inputValue()) === '');
check('版本条列出 v1 和 v2', (await page.locator('.live-ver').count()) >= 2);
await shot('05c-revised');

/* 回看旧版：纯读，不把旧版复制成新版。 */
await page.getByRole('tab', { name: 'v1', exact: true }).click();
await page.waitForSelector('.live-stale', { timeout: 10000 });
check('可以回看 v1',
  (await page.locator('.live-rewrite .pn:not(.before) .pn-t').innerText()).includes('v1'));
check('回看时明说改稿改的仍是最新版',
  (await page.locator('.live-revise .live-stale').innerText()).includes('v2'));
await page.getByRole('button', { name: '回到最新版' }).click();

/* 违规指令（要求编造）被拒绝并说明原因——产品唯一红线的出口。 */
await page.locator('.live-input').fill('再加一段字节跳动的实习经历');
await page.getByRole('button', { name: '改一版' }).click();
await page.waitForSelector('.live-refusal', { timeout: 30000 });
check('要求编造的指令被拒绝', await page.locator('.live-refusal').isVisible());
check('拒绝时说清了为什么不写',
  (await page.locator('.live-refusal p').innerText()).includes('没有任何事实支撑'));
check('被拒之后成稿没被搅乱',
  (await page.locator('.live-rewrite .sg.grill').count()) === goldCount);
check('被拒的那一版标题说明它没改',
  (await page.locator('.live-rewrite .pn.after .pn-t').innerText()).includes('没改'));
check('被拒的指令留在框里等用户改', (await page.locator('.live-input').inputValue()).includes('实习'));
await shot('05d-refused');

/* ── ⑦ 会话丢失 → 「重开一场」提示 ──────────────────────────── */
await page.evaluate(() => {
  window.sessionStorage.setItem('grill.live.session', '00000000-0000-0000-0000-0000000000aa');
});
await page.reload({ waitUntil: 'networkidle' });
await page.waitForSelector('.live-gone', { timeout: 15000 });
check('会话不在了给「重开一场」提示', await page.locator('.live-gone').isVisible());
check('提示不是红色报错，而是台阶',
  (await page.locator('.live-gone').innerText()).includes('重开一场'));
check('回到定靶界面可以重来', await page.locator('.live-jd').isVisible());
await shot('06-session-gone');

/* ── ⑧ 「够了」中断 ─────────────────────────────────────────── */
await page.locator('.live-jd').fill('再来一场，招后端。');
await page.getByRole('button', { name: '开始拷问 →' }).click();
await page.waitForSelector('.qcard', { timeout: 30000 });
await page.getByRole('button', { name: '够了，去改写 →' }).click();
await page.waitForSelector('.live-rewrite', { timeout: 10000 });
check('「够了」一题未答也能中断', await page.locator('.live-rewrite').isVisible());
check('中断的文案和问完的不同',
  (await page.locator('.live-rewrite-h p').innerText()).includes('你叫停'));
await shot('07-stopped-early');

/* 中断必须写进服务端：否则刷新一次就把用户送回他刚走开的那道题。 */
await page.reload({ waitUntil: 'networkidle' });
await page.waitForSelector('.live-rewrite', { timeout: 15000 });
check('中断后刷新仍是收口状态，不会被送回原题',
  (await page.locator('.qcard').count()) === 0);
check('刷新后仍认得出是「叫停」而不是「问完了」',
  (await page.locator('.live-rewrite-h p').innerText()).includes('你叫停'));

/* ── 收尾 ───────────────────────────────────────────────────── */
/* ⑦ 是故意往 sessionStorage 里塞一个不存在的会话 id，那一次 GET 必然 404，
   浏览器会把它记成一条 console error。这条是剧本自己造的，不算失败——其余
   一条都不许有。 */
const unexpected = consoleErrors.filter((e) => !/404/.test(e));
check('全程没有意料之外的 console error', unexpected.length === 0, unexpected.slice(0, 3).join(' | '));

await browser.close();

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} 通过 · 截图在 ${SHOTS}`);
process.exit(failed.length ? 1 : 0);
