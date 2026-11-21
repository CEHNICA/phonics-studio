/**
 * 学习主道场 · 浏览器端到端验证（Playwright）
 *
 * 尺子（scripts/check-learning-flow.ts）证明的是「源码里结构对不对」，
 * 这个脚本证明的是「真实浏览器里，用户看到 / 点得到的东西对不对」。
 *
 * 当前架构（第 11 轮升级为「五维闭环道场」）：
 *   阶段 1「看口型 · 拼装解码」——口型视频 + 字母拼写密码 + 音素拼装台 + 折叠记忆卡（圈出代表词在这）
 *   阶段 2「开口纠偏 · 真词验耳」——声学纠偏仪（先听后录）+ 最小对立真词关
 *
 * 运行：
 *   node scripts/e2e-learning-flow.ts
 *   # 或指定站点（复验线上必须带 ?cb=<毫秒时间戳>，否则会被 CDN 边缘缓存骗）
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
  const browser = await chromium.launch({
    args: ['--autoplay-policy=no-user-gesture-required', '--use-fake-ui-for-media-stream'],
  });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    permissions: ['microphone'],
  });
  const page = await context.newPage();

  const consoleErrors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', (err) => consoleErrors.push(String(err)));

  const failedReq: string[] = [];
  page.on('requestfailed', (r) => {
    if (r.url().startsWith(SITE)) failedReq.push(`${r.url()} :: ${r.failure()?.errorText}`);
  });

  await page.goto(`${SITE}/?cb=${Date.now()}`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.dojo-stage-tab', { timeout: 20000 });
  await page.waitForTimeout(800);

  /* ---------- 1. 阶段切换条 ---------- */
  const tabs = await page.$$('.dojo-stage-tab');
  check('阶段切换条有 2 个 tab', tabs.length === 2, `实际 ${tabs.length}`);
  const tabTexts = await page.$$eval('.dojo-stage-tab', (els) =>
    els.map((e) => e.textContent?.trim() ?? ''),
  );
  check(
    'tab1 是「看口型 · 拼装解码」',
    (tabTexts[0] ?? '').includes('看口型') && (tabTexts[0] ?? '').includes('拼装解码'),
    tabTexts.join(' | '),
  );
  check(
    'tab2 是「开口纠偏 · 真词验耳」',
    (tabTexts[1] ?? '').includes('开口纠偏') && (tabTexts[1] ?? '').includes('真词验耳'),
    tabTexts.join(' | '),
  );
  const activeIdx = await page.$$eval('.dojo-stage-tab', (els) =>
    els.findIndex((e) => e.className.includes('active')),
  );
  check('默认停在阶段 1（decode）', activeIdx === 0, `activeIdx=${activeIdx}`);

  /* ---------- 2. 阶段 1 的内容 ---------- */
  check('阶段 1 有字母拼写密码块', (await page.$('.spelling-patterns-box')) !== null);
  check('阶段 1 有口型视频', (await page.$('video.mouth-video')) !== null);
  check('阶段 1 有「一键合体拼读」按钮', (await page.$('text=一键合体拼读')) !== null);

  // 口型视频要真能播（不是只摆个标签）
  const videoState = await page.evaluate(async () => {
    const v = document.querySelector('video.mouth-video');
    if (!v) return 'no-video';
    const btn = Array.from(document.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('播放口型视频'),
    );
    btn?.click();
    await new Promise((r) => setTimeout(r, 900));
    return `${v.currentTime.toFixed(2)}`;
  });
  check('口型视频真能播放（currentTime > 0）', parseFloat(videoState) > 0, videoState);

  // 点「一键合体拼读」要走完并给出通关反馈
  const blendResult = await page.evaluate(async () => {
    const btn = Array.from(document.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('一键合体拼读'),
    );
    if (!btn) return 'no-btn';
    btn.click();
    await new Promise((r) => setTimeout(r, 4000));
    const done = Array.from(document.querySelectorAll('*')).some(
      (e) => e.children.length === 0 && /已完成拼读|拼读解锁/.test(e.textContent ?? ''),
    );
    return done ? 'unlocked' : 'not-unlocked';
  });
  check('点「一键合体拼读」后给出通关反馈', blendResult === 'unlocked', blendResult);

  /* ---------- 3. 圈出最顺口词（记忆卡抽屉里，默认折叠） ---------- */
  const expandState = await page.evaluate(async () => {
    const btn = Array.from(document.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('手绘记忆卡片'),
    );
    if (!btn) return 'no-toggle';
    btn.click();
    await new Promise((r) => setTimeout(r, 400));
    return 'clicked';
  });
  check('记忆卡抽屉可展开', expandState === 'clicked', expandState);

  const chips = await page.$$('.rep-choice-chips .rep-chip');
  check('代表词候选 chip 有 3 个', chips.length === 3, `实际 ${chips.length}`);
  if (chips.length === 3) {
    await chips[0].click();
    await page.waitForSelector('svg.card-circle-layer', { timeout: 5000 }).catch(() => null);
    check('选了代表词就画出圈', (await page.$$('svg.card-circle-layer')).length === 1);
    const circleInfo = await page.evaluate(() => {
      const svg = document.querySelector('svg.card-circle-layer');
      if (!svg) return { viewBox: '', pe: '' };
      return {
        viewBox: svg.getAttribute('viewBox') ?? '',
        pe: getComputedStyle(svg).pointerEvents,
      };
    });
    check(
      '圈层 viewBox 仍是 0 0 1050 623（与卡片图同坐标系）',
      circleInfo.viewBox === '0 0 1050 623',
      circleInfo.viewBox,
    );
    check('圈层 pointer-events:none（不挡「点词朗读」）', circleInfo.pe === 'none', circleInfo.pe);

    await chips[0].click();
    await page.waitForTimeout(200);
    check('再点一次仍然能取消圈', (await page.$$('svg.card-circle-layer')).length === 0);
  }

  /* ---------- 4. 切到阶段 2 ---------- */
  await page.click('.dojo-stage-tab:nth-of-type(2)');
  await page.waitForTimeout(800);
  const activeIdx2 = await page.$$eval('.dojo-stage-tab', (els) =>
    els.findIndex((e) => e.className.includes('active')),
  );
  check('能切到阶段 2', activeIdx2 === 1, `activeIdx=${activeIdx2}`);

  /* ---------- 5. 阶段 2：先听原声必须排在录音之前 ---------- */
  const btnOrder = await page.evaluate(() => {
    const all = Array.from(document.querySelectorAll('button'));
    const listen = all.find((b) => b.textContent?.includes('先听一遍原声'));
    const record = all.find((b) => b.textContent?.includes('按住/点击跟读录音'));
    if (!listen) return { listen: false };
    const l = listen.getBoundingClientRect();
    const r = record?.getBoundingClientRect() ?? null;
    return {
      listen: true,
      domListen: all.indexOf(listen),
      domRecord: record ? all.indexOf(record) : -1,
      listenX: l.left,
      recordX: r ? r.left : -1,
      sameRow: r ? Math.abs(l.top - r.top) < 4 : false,
      hasOldText: all.some((b) => b.textContent?.trim() === '只听原声'),
    };
  });
  check('阶段 2 有「先听一遍原声」按钮', btnOrder.listen === true, JSON.stringify(btnOrder));
  if (btnOrder.listen) {
    check(
      '「先听一遍原声」在录音按钮之前（DOM 序）',
      btnOrder.domRecord >= 0 && btnOrder.domListen < btnOrder.domRecord,
      `听 @${btnOrder.domListen} / 录 @${btnOrder.domRecord}`,
    );
    check(
      '「先听一遍原声」在录音按钮左边（同排时看 X）',
      btnOrder.sameRow ? btnOrder.listenX < btnOrder.recordX : true,
      `sameRow=${btnOrder.sameRow} listenX=${btnOrder.listenX} recordX=${btnOrder.recordX}`,
    );
    check('旧的「只听原声」按钮不再出现', btnOrder.hasOldText === false, '仍有旧按钮');
  }
  check('阶段 2 有声学纠偏仪', (await page.$('text=声学纠偏仪')) !== null);
  check('阶段 2 有最小对立真词关', (await page.$('text=最小对立')) !== null);

  /* ---------- 6. 整轮没有报错 ---------- */
  check('整轮操作没有控制台报错', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' // '));
  check('整轮操作没有站内资源加载失败', failedReq.length === 0, failedReq.slice(0, 3).join(' // '));

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
