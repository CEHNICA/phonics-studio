/**
 * 学习流程顺序 · 浏览器端到端验证（Playwright）
 *
 * 尺子（scripts/check-learning-flow.ts）证明的是「源码里顺序对不对」，
 * 这个脚本证明的是「真实浏览器里，用户看到的顺序对不对」。
 *
 * 验证四件事：
 *   1. 左栏只有**两步**编号徽标：1「听一遍，圈一圈」 → 2「跟读一遍」
 *   2. 物理顺序：卡片 → 圈出区 → 跟读区（跟读是最后一步）
 *   3. 跟读区第一个按钮是「先听一遍原声」，录音按钮排在它后面
 *   4. 圈出区视觉上（像素位置）在跟读区**上面**
 *
 * 运行：
 *   node scripts/e2e-learning-flow.ts
 *   # 或指定站点
 *   set TARGET_SITE=http://localhost:4173
 */
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const require = createRequire(import.meta.url);

function loadPlaywright() {
  const candidates: string[] = [];
  if (process.env.NODE_PATH) {
    candidates.push(...process.env.NODE_PATH.split(';'));
  }
  candidates.push(
    join(homedir(), 'AppData', 'Roaming', 'npm', 'node_modules'),
    join(homedir(), '.npm-global', 'lib', 'node_modules'),
  );
  for (const base of candidates) {
    const target = join(base, 'playwright');
    if (existsSync(target)) return require(target);
  }
  return require('playwright');
}

const { chromium } = loadPlaywright();

const SITE = process.env.TARGET_SITE || 'https://5p3wt4cgcivtd.space.mcode.cn';

let passed = 0;
let failed = 0;
const failures: string[] = [];
function check(name: string, cond: boolean, detail = '') {
  if (cond) {
    passed += 1;
    console.log(`  PASS  ${name}`);
  } else {
    failed += 1;
    failures.push(`${name}  ${detail}`);
    console.log(`  FAIL  ${name}  ${detail}`);
  }
}

async function main() {
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();

  const consoleErrors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', (err) => consoleErrors.push(String(err)));

  await page.goto(`${SITE}/?cb=${Date.now()}`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.illustrated-card-img', { timeout: 20000 });
  await page.waitForTimeout(800);

  /* ---------- 1. 两步编号徽标 ---------- */
  const badges = await page.$$eval('.card-stage-panel .step-badge', (els) =>
    els.map((el) => ({
      num: el.querySelector('.step-num')?.textContent?.trim() ?? '',
      text: el.querySelector('.step-text')?.textContent?.trim() ?? '',
      top: Math.round(el.getBoundingClientRect().top + window.scrollY),
    })),
  );
  check('左栏只有 2 个步骤编号徽标（圈出不是独立一步）', badges.length === 2, `实际 ${badges.length}`);
  check('步骤编号依次是 1 / 2', badges.map((b) => b.num).join(',') === '1,2', badges.map((b) => b.num).join(','));
  check(
    '第 1 步是「听一遍，圈一圈」',
    /听一遍/.test(badges[0]?.text ?? '') && /圈一圈/.test(badges[0]?.text ?? ''),
    badges[0]?.text ?? '',
  );
  check('第 2 步是「跟读一遍」', (badges[1]?.text ?? '').includes('跟读一遍'), badges[1]?.text ?? '');
  check(
    '两步在页面上从上到下排列',
    badges.length === 2 && badges[0].top < badges[1].top,
    badges.map((b) => `${b.num}@${b.top}`).join(' '),
  );

  /* ---------- 2. 物理顺序：卡片 → 圈出区 → 跟读区 ---------- */
  const geo = await page.evaluate(() => {
    const rec = document.querySelector('.recorder-center-card');
    const cir = document.querySelector('.codename-box');
    const card = document.querySelector('.illustrated-card-frame');
    const r = (el: Element | null) =>
      el ? Math.round(el.getBoundingClientRect().top + window.scrollY) : -1;
    return { card: r(card), cir: r(cir), rec: r(rec) };
  });
  check(
    '卡片在最上，圈出区居中，跟读区在最下',
    geo.card > 0 && geo.card < geo.cir && geo.cir < geo.rec,
    JSON.stringify(geo),
  );
  check(
    '圈出区视觉上在跟读区上面（圈出属于第一步）',
    geo.cir > 0 && geo.rec > 0 && geo.cir < geo.rec,
    `圈出 @${geo.cir} / 跟读 @${geo.rec}`,
  );

  /* ---------- 3. 跟读区按钮顺序 ---------- */
  const btns = await page.$$eval('.recorder-actions > button', (els) =>
    els.map((el) => ({
      text: el.textContent?.trim().replace(/\s+/g, ' ') ?? '',
      left: Math.round(el.getBoundingClientRect().left),
      top: Math.round(el.getBoundingClientRect().top),
    })),
  );
  const texts = btns.map((b) => b.text);
  const listenIdx = texts.findIndex((t) => t.includes('先听一遍原声'));
  const recordIdx = texts.findIndex((t) => t.includes('跟读录音') || t.includes('重新录音'));
  check('跟读区有「先听一遍原声」按钮', listenIdx >= 0, texts.join(' | '));
  check('跟读区有录音按钮', recordIdx >= 0, texts.join(' | '));
  check(
    '「先听一遍原声」排在录音按钮之前',
    listenIdx >= 0 && recordIdx >= 0 && listenIdx < recordIdx,
    `听原声 @${listenIdx} / 录音 @${recordIdx}`,
  );
  check('「先听一遍原声」是第一个按钮', listenIdx === 0, `实际在第 ${listenIdx + 1} 个`);
  check(
    '跟读区不再有旧的「只听原声」按钮',
    !texts.some((t) => t === '只听原声'),
    texts.join(' | '),
  );

  /* ---------- 4. 跟读小步提示 ---------- */
  const stepLine = (await page.textContent('.recorder-step-line')) ?? '';
  check(
    '跟读区有 ① 先听原声 → ② 跟我读 提示',
    stepLine.includes('先听原声') && stepLine.includes('跟我读'),
    stepLine.replace(/\s+/g, ' '),
  );

  /* ---------- 5. 圈出仍然可用（搬了位置不能把功能搬坏） ---------- */
  const chips = await page.$$('.rep-choice-chips .rep-chip');
  check('圈出区的 3 个候选词还在', chips.length === 3, `实际 ${chips.length}`);
  if (chips.length === 3) {
    await chips[0].click();
    await page.waitForSelector('.card-circle-layer', { timeout: 5000 }).catch(() => null);
    check('搬了位置后点词仍然能画圈', (await page.$$('.card-circle-layer')).length === 1);
    await chips[0].click();
    await page.waitForTimeout(150);
    check('再点一次仍然能取消圈', (await page.$$('.card-circle-layer')).length === 0);
  }

  /* ---------- 6. 没有控制台报错 ---------- */
  check('整轮操作没有控制台报错', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' // '));

  await browser.close();

  console.log(`\n${passed} 通过 / ${failed} 失败`);
  if (failed > 0) {
    console.log('\n失败项：');
    failures.forEach((f) => console.log(`  - ${f}`));
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('E2E 运行失败：', err);
  process.exit(1);
});
