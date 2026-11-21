/**
 * 「圈出最顺口的词」· 浏览器端到端验证（Playwright）
 *
 * 尺子（scripts/check-card-circle.ts）证明的是「槽位数据和源码接线对不对」，
 * 这个脚本证明的是「在真实浏览器里，红圈真的套在卡片上那个词上」。
 *
 * 关键一项是像素级验证：把卡片区域截图下来，找出红色像素的位置，
 * 换算回 1050x623 的卡片坐标系，和原图里那个词的暗像素包围盒比对 ——
 * 这才是「圈真的圈住了词」的硬证据，不是看代码猜的。
 *
 * 运行：
 *   node scripts/e2e-card-circle.ts
 *   # 或指定站点
 *   set TARGET_SITE=http://localhost:4173
 */
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { CARD_SLOT_DATA } from '../src/data/card-word-slots.ts';
import { analyzeCard, decodeGray, pickThree, resolveFfmpeg } from './derive-card-word-slots.ts';

const require = createRequire(import.meta.url);

/** playwright 可能装在全局，仓库本身不依赖它，这里做兜底解析 */
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
const ROOT = process.cwd();
const CARDS_DIR = join(ROOT, 'public', 'assets', 'cards');
const SHOT_DIR = join(ROOT, 'shots-circle');

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

/**
 * 在 RGB 原始像素里找「红笔」像素，返回包围盒。
 * win 限定查找窗口 —— 卡片插画里本来就有大面积红色（苹果、船…），
 * 不限定窗口就会把插画当成圈（尺子自己的假阳性）。
 */
function findRedBox(
  rgb: Buffer,
  w: number,
  h: number,
  win: { x0: number; x1: number; y0: number; y1: number },
): { x0: number; x1: number; y0: number; y1: number; count: number } | null {
  let x0 = Number.POSITIVE_INFINITY;
  let x1 = -1;
  let y0 = Number.POSITIVE_INFINITY;
  let y1 = -1;
  let count = 0;
  for (let y = win.y0; y <= win.y1; y++) {
    for (let x = win.x0; x <= win.x1; x++) {
      const i = (y * w + x) * 3;
      const r = rgb[i];
      const g = rgb[i + 1];
      const b = rgb[i + 2];
      // 圈色 #e0384a：红通道明显高，绿蓝低（抗锯齿边缘放宽）
      if (r > 150 && g < 130 && b < 130 && r - g > 60) {
        count += 1;
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  if (count === 0) return null;
  return { x0, x1, y0, y1, count };
}

async function main() {
  if (!existsSync(SHOT_DIR)) mkdirSync(SHOT_DIR, { recursive: true });
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();

  const consoleErrors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', (err) => consoleErrors.push(String(err)));

  await page.goto(`${SITE}/?cb=${Date.now()}`, { waitUntil: 'domcontentloaded' });
  // 清掉上一次跑的本地进度，保证从零开始
  await page.evaluate(() => window.localStorage.clear());
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.illustrated-card-img', { timeout: 20000 });

  /* ---------- 1. 圈出区的文案与三个选项 ---------- */
  const titleText = (await page.textContent('.codename-title-block .homework-title')) ?? '';
  check('圈出区标题是「圈出读起来最顺口的那个词」', titleText.includes('圈出读起来最顺口的那个词'), titleText);

  const chips = await page.$$('.rep-choice-chips .rep-chip');
  check('有 3 个候选词（A/B/C）', chips.length === 3, `实际 ${chips.length}`);

  const cardSrc = (await page.getAttribute('.illustrated-card-img', 'src')) ?? '';
  const cardId = cardSrc.match(/cards\/(.+)\.v2\.webp/)?.[1] ?? '';
  check('能从卡片图 src 推出音标 id', Boolean(cardId), cardSrc);
  const slots = CARD_SLOT_DATA.cards[cardId] ?? CARD_SLOT_DATA.fallback;

  /* ---------- 2. 初始状态没有圈 ---------- */
  check('初始状态没有红圈', (await page.$$('.card-circle-layer')).length === 0);

  /* ---------- 3. 点 A → 出现圈，坐标等于 A 槽位 ---------- */
  await chips[0].click();
  await page.waitForSelector('.card-circle-layer', { timeout: 5000 }).catch(() => null);
  let circles = await page.$$('.card-circle-layer');
  check('点 A 后出现红圈层', circles.length === 1, `实际 ${circles.length}`);

  const ellipseA = await page.evaluate(() => {
    const el = document.querySelector('.card-circle-layer ellipse');
    if (!el) return null;
    return {
      cx: Number(el.getAttribute('cx')),
      cy: Number(el.getAttribute('cy')),
      rx: Number(el.getAttribute('rx')),
      ry: Number(el.getAttribute('ry')),
    };
  });
  check(
    '圈的坐标等于该卡 A 槽位',
    Boolean(ellipseA) && ellipseA!.cx === slots[0].cx && ellipseA!.cy === slots[0].cy,
    `实测 ${JSON.stringify(ellipseA)} 期望 ${JSON.stringify(slots[0])}`,
  );

  const pe = await page.evaluate(
    () => getComputedStyle(document.querySelector('.card-circle-layer')!).pointerEvents,
  );
  check('圈层 pointer-events: none（不挡点词朗读）', pe === 'none', pe);

  /* ---------- 4. 再点 A → 取消圈 ---------- */
  await chips[0].click();
  await page.waitForTimeout(150);
  check('再点同一个词 = 取消圈', (await page.$$('.card-circle-layer')).length === 0);

  /* ---------- 5. 点 B → 圈跟着换到 B ---------- */
  await chips[1].click();
  await page.waitForSelector('.card-circle-layer', { timeout: 5000 }).catch(() => null);
  const ellipseB = await page.evaluate(() => {
    const el = document.querySelector('.card-circle-layer ellipse');
    if (!el) return null;
    return { cx: Number(el.getAttribute('cx')), cy: Number(el.getAttribute('cy')) };
  });
  check(
    '点 B 后圈换到 B 的位置',
    Boolean(ellipseB) && ellipseB!.cx === slots[1].cx && ellipseB!.cy === slots[1].cy,
    `实测 ${JSON.stringify(ellipseB)} 期望 ${JSON.stringify(slots[1])}`,
  );

  /* ---------- 6. 点卡片上的词热点 → 不产生圈（点词只朗读） ---------- */
  await chips[1].click(); // 先取消
  await page.waitForTimeout(120);
  const hotspot = await page.$('.card-word-hotspot');
  await hotspot!.click();
  await page.waitForTimeout(200);
  check('点卡片上的词只朗读，不产生圈', (await page.$$('.card-circle-layer')).length === 0);

  /* ---------- 7. 自己写一个词 → 不画圈（卡片上没有） ---------- */
  await page.click('.codename-custom-toggle');
  await page.waitForSelector('.custom-word-input', { timeout: 5000 });
  await page.fill('.custom-word-input', 'zebra');
  await page.click('.save-word-btn');
  await page.waitForTimeout(250);
  check('自己写的词不在卡片上 → 不画圈', (await page.$$('.card-circle-layer')).length === 0);
  const badgeText = (await page.textContent('.selected-rep-badge')) ?? '';
  check('自己写的词仍然被记住', badgeText.includes('zebra'), badgeText);

  /* ---------- 8. 换音标 → 圈不跟着串 ---------- */
  await chips[2].click(); // 选 C
  await page.waitForTimeout(150);
  const navButtons = await page.$$('.icon-nav-btn');
  if (navButtons.length >= 2) {
    await navButtons[1].click(); // 下一个
    await page.waitForTimeout(400);
    check('换到下一个音标后没有圈（圈是每个音标各自的）', (await page.$$('.card-circle-layer')).length === 0);
  } else {
    check('换到下一个音标后没有圈（圈是每个音标各自的）', false, '找不到翻页按钮');
  }

  /* ---------- 9. 像素级验证：红圈真的套在词上 ---------- */
  const ffmpeg = resolveFfmpeg();
  if (!ffmpeg) {
    console.log('  SKIP  像素级验证（找不到 ffmpeg）');
  } else {
    // 回到第一个音标，选 A，截图
    await page.goto(`${SITE}/?cb=${Date.now()}`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.illustrated-card-img', { timeout: 20000 });
    await page.evaluate(() => window.localStorage.clear());
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.illustrated-card-img', { timeout: 20000 });
    const chipList = await page.$$('.rep-choice-chips .rep-chip');
    await chipList[0].click();
    await page.waitForSelector('.card-circle-layer', { timeout: 5000 });
    await page.waitForTimeout(450); // 等圈画完

    const cardEl = await page.$('.illustrated-card-inner');
    const shotPath = join(SHOT_DIR, `circle-${cardId}.png`);
    await cardEl!.screenshot({ path: shotPath });

    // 页面几何：图片盒子 / 卡片容器盒子 / 圈的屏幕矩形
    // 注意：卡片插画里本来就有大面积红色（苹果、船…），
    // 直接全图找红像素会被插画带偏 —— 必须只在「圈自己的屏幕矩形」里找红。
    const geom = await page.evaluate(() => {
      const inner = document.querySelector('.illustrated-card-inner')!.getBoundingClientRect();
      const img = document.querySelector('.illustrated-card-img')!.getBoundingClientRect();
      const ell = document.querySelector('.card-circle-layer ellipse')!.getBoundingClientRect();
      return {
        inner: { x: inner.x, y: inner.y, w: inner.width, h: inner.height },
        img: { x: img.x, y: img.y, w: img.width, h: img.height },
        ell: { x: ell.x, y: ell.y, w: ell.width, h: ell.height },
      };
    });
    check(
      '卡片图铺满容器（截图坐标 = 图片坐标）',
      Math.abs(geom.img.w - geom.inner.w) <= 1 && Math.abs(geom.img.h - geom.inner.h) <= 1,
      `img ${geom.img.w.toFixed(1)}x${geom.img.h.toFixed(1)} / inner ${geom.inner.w.toFixed(1)}x${geom.inner.h.toFixed(1)}`,
    );

    // 截图尺寸从 PNG 头读，rawvideo 解成 rgb24
    const png = readFileSyncBuffer(shotPath);
    const pngW = png.readUInt32BE(16);
    const pngH = png.readUInt32BE(20);
    const rgbRaw = decodeRgb(shotPath, ffmpeg, pngW, pngH);

    // 圈所在窗口（截图坐标）：椭圆屏幕矩形外扩 8px
    const toShotX = (pageX: number) => pageX - geom.inner.x;
    const toShotY = (pageY: number) => pageY - geom.inner.y;
    const win = {
      x0: Math.max(0, Math.floor(toShotX(geom.ell.x) - 8)),
      x1: Math.min(pngW - 1, Math.ceil(toShotX(geom.ell.x + geom.ell.w) + 8)),
      y0: Math.max(0, Math.floor(toShotY(geom.ell.y) - 8)),
      y1: Math.min(pngH - 1, Math.ceil(toShotY(geom.ell.y + geom.ell.h) + 8)),
    };
    const red = findRedBox(rgbRaw, pngW, pngH, win);
    check('圈的屏幕矩形里能检出红笔像素', Boolean(red), red ? `${red.count} 个` : '圈内没有红色像素（圈没画出来）');

    if (red) {
      // 截图坐标 → 卡片原始像素坐标（1050x623）
      // x/y 已是「相对容器左上角」的截图坐标，图片在容器内的偏移要单独减掉
      const imgOffsetX = geom.img.x - geom.inner.x;
      const imgOffsetY = geom.img.y - geom.inner.y;
      const toCardX = (x: number) => ((x - imgOffsetX) / geom.img.w) * CARD_SLOT_DATA.canvas.w;
      const toCardY = (y: number) => ((y - imgOffsetY) / geom.img.h) * CARD_SLOT_DATA.canvas.h;
      const redBox = {
        x0: toCardX(red.x0),
        x1: toCardX(red.x1),
        y0: toCardY(red.y0),
        y1: toCardY(red.y1),
      };

      const originalFile = readdirSync(CARDS_DIR).find((f) => f.startsWith(`${cardId}.`));
      const gray = decodeGray(join(CARDS_DIR, originalFile!), ffmpeg);
      const groups = pickThree(analyzeCard(gray).groups);
      const word = groups[0];
      const overlapX = Math.min(redBox.x1, word.x1) - Math.max(redBox.x0, word.x0);
      const wordWidth = word.x1 - word.x0;
      const coverage = wordWidth > 0 ? overlapX / wordWidth : 0;
      const cy = (redBox.y0 + redBox.y1) / 2;
      const wordCy = (word.y0 + word.y1) / 2;
      check(
        '红笔水平范围盖住了那个词（重叠 ≥ 85%）',
        coverage >= 0.85,
        `重叠 ${(coverage * 100).toFixed(1)}%（红 ${redBox.x0.toFixed(0)}~${redBox.x1.toFixed(0)}，词 ${word.x0}~${word.x1}）`,
      );
      check(
        '红笔垂直中心与词行对齐（±30px）',
        Math.abs(cy - wordCy) <= 30,
        `圈心 y=${cy.toFixed(0)}，词心 y=${wordCy.toFixed(0)}`,
      );
    }
  }

  check('整轮操作没有控制台报错', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '));

  await browser.close();

  console.log(`\n${passed} 通过 / ${failed} 失败`);
  if (failed > 0) {
    console.error(failures.join('\n'));
    process.exit(1);
  }
}

function readFileSyncBuffer(file: string): Buffer {
  return require('node:fs').readFileSync(file) as Buffer;
}

function decodeRgb(file: string, ffmpeg: string, _w: number, _h: number): Buffer {
  const out = require('node:child_process').spawnSync(
    ffmpeg,
    ['-hide_banner', '-loglevel', 'error', '-i', file, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'],
    { maxBuffer: 64 * 1024 * 1024 },
  );
  return out.stdout as Buffer;
}

void decodeGray;
await main();
