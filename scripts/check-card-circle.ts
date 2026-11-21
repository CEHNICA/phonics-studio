/**
 * 「圈出最顺口的词」体检器
 *
 * 背景：手绘卡片上印着「听一遍，跟读一遍，再圈出读起来最顺口的那个词」，
 * 网站上必须真的能把那个词圈出来。本脚本是「尺子」：改这块前后各跑一次，缺陷必须归零。
 *
 * 运行：npm run check:circle
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { circleSlotFor } from '../src/utils/card-circle.ts';
import { CARD_SLOT_DATA } from '../src/data/card-word-slots.ts';
import {
  CARD_H,
  CARD_W,
  analyzeCard,
  decodeGray,
  pickThree,
  resolveFfmpeg,
  slotCoverage,
} from './derive-card-word-slots.ts';

/** 逐项退回验证时会把仓库复制一份再改坏，用 --root=<副本路径> 指到副本上跑 */
const rootArg = process.argv.find((a) => a.startsWith('--root='));
const ROOT = rootArg ? rootArg.slice('--root='.length) : process.cwd();
const CARDS_DIR = join(ROOT, 'public', 'assets', 'cards');
const STUDIO = join(ROOT, 'src', 'components', 'CardStudio.tsx');
const CSS = join(ROOT, 'src', 'index.css');
const QUIZ = join(ROOT, 'src', 'components', 'ListeningQuiz.tsx');

type Result = { name: string; ok: boolean; detail: string; skip?: boolean };
const results: Result[] = [];
const check = (name: string, ok: boolean, detail: string) => {
  results.push({ name, ok, detail });
};
const skip = (name: string, detail: string) => {
  results.push({ name, ok: true, detail, skip: true });
};

/* ---------- 1. 槽位数据 ---------- */
const cards = Object.keys(CARD_SLOT_DATA.cards);
/**
 * 键集合必须和素材目录里的卡片文件**完全一致**（既不能少，也不能多）。
 * 只查数量是不够的：把一张卡的键改名，键数还是 48，偷懒的断言照样绿。
 */
const cardFileIds = existsSync(CARDS_DIR)
  ? readdirSync(CARDS_DIR)
      .filter((f) => f.endsWith('.v2.webp'))
      .map((f) => f.replace('.v2.webp', ''))
      .sort()
  : [];
const missingSlots = cardFileIds.filter((id) => !CARD_SLOT_DATA.cards[id]);
const extraSlots = cards.filter((id) => !cardFileIds.includes(id));
check(
  '槽位数据与卡片素材一一对应（48 张不多不少）',
  missingSlots.length === 0 && extraSlots.length === 0 && cards.length === 48,
  missingSlots.length === 0 && extraSlots.length === 0
    ? `${cards.length} 张全齐`
    : `缺 ${missingSlots.slice(0, 3).join(', ') || '无'} / 多 ${extraSlots.slice(0, 3).join(', ') || '无'}`,
);
check(
  '画布尺寸与卡片图一致（1050x623）',
  CARD_SLOT_DATA.canvas.w === CARD_W && CARD_SLOT_DATA.canvas.h === CARD_H,
  `${CARD_SLOT_DATA.canvas.w}x${CARD_SLOT_DATA.canvas.h}`,
);
check(
  '兜底槽位恰好 3 个',
  CARD_SLOT_DATA.fallback.length === 3,
  `实际 ${CARD_SLOT_DATA.fallback.length} 个`,
);
const badSlotCount = cards.filter((id) => CARD_SLOT_DATA.cards[id].length !== 3);
check(
  '每张卡片都有 3 个槽位',
  badSlotCount.length === 0,
  badSlotCount.length === 0 ? '48 张全齐' : `异常：${badSlotCount.slice(0, 3).join(', ')}`,
);
const outOfCanvas: string[] = [];
for (const id of cards) {
  for (const s of CARD_SLOT_DATA.cards[id]) {
    if (s.cx - s.rx < 0 || s.cx + s.rx > CARD_W || s.cy - s.ry < 0 || s.cy + s.ry > CARD_H) {
      outOfCanvas.push(id);
      break;
    }
  }
}
check(
  '所有槽位都在画布内',
  outOfCanvas.length === 0,
  outOfCanvas.length === 0 ? '无越界' : `越界：${outOfCanvas.slice(0, 3).join(', ')}`,
);
const badBand = cards.filter((id) =>
  CARD_SLOT_DATA.cards[id].some((s) => s.cy < 450 || s.cy > 545),
);
check(
  '槽位纵向落在词文字行（450~545）',
  badBand.length === 0,
  badBand.length === 0 ? '全部命中词行' : `异常：${badBand.slice(0, 3).join(', ')}`,
);

/* ---------- 2. 素材层实测（需要 ffmpeg） ---------- */
const ffmpeg = resolveFfmpeg();
/**
 * CIRCLE_CHECK_FAST=1 → 跳过素材层实测（每次要解码 48 张卡片，耗时长）。
 * 用途：逐项退回验证时，只改源码/数据类缺陷时用快模式，
 * 免得每退一项都等一遍 ffmpeg。改素材槽位的那几条必须全量跑。
 */
const skipAssetLayer = process.env.CIRCLE_CHECK_FAST === '1';
if (!ffmpeg || skipAssetLayer) {
  skip(
    '槽位坐标与素材实测一致（需要 ffmpeg）',
    !ffmpeg ? '本机找不到 ffmpeg，跳过素材层实测' : 'CIRCLE_CHECK_FAST=1 快模式，跳过素材层实测',
  );
  skip('圈覆盖率 ≥ 85%（需要 ffmpeg）', !ffmpeg ? '本机找不到 ffmpeg，跳过素材层实测' : 'CIRCLE_CHECK_FAST=1 快模式，跳过素材层实测');
} else {
  const files = readdirSync(CARDS_DIR).filter((f) => f.endsWith('.v2.webp')).sort();
  const drift: string[] = [];
  const lowCoverage: string[] = [];
  let minCov = 1;
  for (const f of files) {
    const id = f.replace('.v2.webp', '');
    const buf = decodeGray(join(CARDS_DIR, f), ffmpeg);
    const { groups } = analyzeCard(buf);
    const picked = pickThree(groups);
    if (picked.length !== 3) {
      drift.push(`${id}(只定位到 ${picked.length} 块)`);
      continue;
    }
    const committed = CARD_SLOT_DATA.cards[id];
    picked.forEach((g, i) => {
      const cx = Math.round((g.x0 + g.x1) / 2);
      const cy = Math.round((g.y0 + g.y1) / 2);
      if (Math.abs(cx - committed[i].cx) > 4 || Math.abs(cy - committed[i].cy) > 4) {
        drift.push(`${id}[${i}] 实测(${cx},${cy}) vs 提交(${committed[i].cx},${committed[i].cy})`);
      }
      const cov = slotCoverage(buf, g, committed[i]);
      minCov = Math.min(minCov, cov);
      if (cov < 0.85) lowCoverage.push(`${id}[${i}] ${(cov * 100).toFixed(0)}%`);
    });
  }
  check(
    '槽位坐标与素材实测一致（误差 ≤ 4px）',
    drift.length === 0,
    drift.length === 0 ? `48 张 × 3 槽全部一致` : `${drift.length} 处偏差：${drift.slice(0, 3).join('；')}`,
  );
  check(
    '圈覆盖率 ≥ 85%（圈真的套在词上）',
    lowCoverage.length === 0,
    lowCoverage.length === 0 ? `最低 ${(minCov * 100).toFixed(1)}%` : `偏低：${lowCoverage.slice(0, 3).join('；')}`,
  );
}

/* ---------- 3. 源码层：圈层与坐标系 ---------- */
const studioSrc = existsSync(STUDIO) ? readFileSync(STUDIO, 'utf8') : '';
const cssSrc = existsSync(CSS) ? readFileSync(CSS, 'utf8') : '';
const quizSrc = existsSync(QUIZ) ? readFileSync(QUIZ, 'utf8') : '';

check('CardStudio.tsx 存在', studioSrc.length > 0, STUDIO);
check(
  '圈层 SVG 使用 viewBox="0 0 1050 623"（与卡片图同坐标系）',
  studioSrc.includes('viewBox="0 0 1050 623"'),
  studioSrc.includes('viewBox="0 0 1050 623"') ? '已锁定坐标系' : '圈与图片会对不齐',
);
check(
  '圈层 SVG 使用 preserveAspectRatio="none"（铺满卡片，保持等比定位）',
  studioSrc.includes('preserveAspectRatio="none"'),
  studioSrc.includes('preserveAspectRatio="none"') ? '已设置' : '缺失会导致圈变形偏移',
);
check(
  '存在圈层容器 className="card-circle-layer"',
  studioSrc.includes('className="card-circle-layer"'),
  studioSrc.includes('className="card-circle-layer"') ? '已挂载' : '圈层没渲染出来',
);
check(
  '圈层 CSS 设为 pointer-events: none（不能挡住卡片热点的点击）',
  /\.card-circle-layer\s*\{[^}]*pointer-events:\s*none/.test(cssSrc),
  /\.card-circle-layer\s*\{[^}]*pointer-events:\s*none/.test(cssSrc) ? '已设置' : '圈会挡住「点词朗读」',
);
check(
  '圈由 currentProgress.representativeWord 驱动（不引入第二个状态源）',
  studioSrc.includes('currentProgress.representativeWord') &&
    /circleSlotFor\(\s*currentProgress\.representativeWord/.test(studioSrc),
  studioSrc.includes('currentProgress.representativeWord') ? '已绑定进度状态' : '圈没跟进度状态联动',
);
check(
  '卡片热点点击仍是「朗读」（圈不抢听的动作）',
  /onClick=\{\(\)\s*=>\s*\{\s*speakWord\(word\)/.test(studioSrc),
  '点词只朗读，圈由下方 A/B/C 触发',
);

/* ---------- 4. 纯函数真跑 ---------- */
check(
  'circleSlotFor 命中卡片上的词 → 返回下标',
  circleSlotFor('sea', ['tea', 'sea', 'bee']) === 1,
  `实测 ${circleSlotFor('sea', ['tea', 'sea', 'bee'])}`,
);
check(
  'circleSlotFor 忽略大小写与空格',
  circleSlotFor(' SEA ', ['tea', 'sea', 'bee']) === 1,
  `实测 ${circleSlotFor(' SEA ', ['tea', 'sea', 'bee'])}`,
);
check(
  'circleSlotFor 自己写的词（不在卡片上）→ -1（不画圈）',
  circleSlotFor('myown', ['tea', 'sea', 'bee']) === -1,
  `实测 ${circleSlotFor('myown', ['tea', 'sea', 'bee'])}`,
);
check(
  'circleSlotFor 空值 → -1',
  circleSlotFor('', ['tea', 'sea', 'bee']) === -1 && circleSlotFor('   ', ['tea']) === -1,
  '空值不画圈',
);

/* ---------- 5. 文案口径：旧口径全仓清零 ---------- */
function collectSrcSources(dir: string): Array<{ file: string; text: string }> {
  const out: Array<{ file: string; text: string }> = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...collectSrcSources(full));
    } else if (/\.(ts|tsx|css|html)$/.test(entry.name)) {
      out.push({ file: full.slice(ROOT.length + 1), text: readFileSync(full, 'utf8') });
    }
  }
  return out;
}
const srcFiles = collectSrcSources(join(ROOT, 'src'));
const bannedPhrases = ['给这个音起个代号（可选）', '自己写一个代号', '你的代号词'];
const bannedHits: string[] = [];
for (const f of srcFiles) {
  for (const phrase of bannedPhrases) {
    if (f.text.includes(phrase)) bannedHits.push(`${f.file} → 「${phrase}」`);
  }
}
check(
  '旧口径文案全仓清零（src/ 递归扫）',
  bannedHits.length === 0,
  bannedHits.length === 0 ? `扫了 ${srcFiles.length} 个文件，无残留` : bannedHits.join('；'),
);
check(
  '测验页文案改成「你圈出的词」',
  quizSrc.includes('你圈出的词'),
  quizSrc.includes('你圈出的词') ? '已改口径' : '测验页仍写「你的代号词」',
);
check(
  '圈出区标题改成「圈出读起来最顺口的那个词」',
  studioSrc.includes('圈出读起来最顺口的那个词'),
  studioSrc.includes('圈出读起来最顺口的那个词') ? '与卡片印刷文案对齐' : '标题仍是旧口径',
);

/* ---------- 6. 素材体积没有被这一轮弄大 ---------- */
if (existsSync(CARDS_DIR)) {
  let total = 0;
  for (const f of readdirSync(CARDS_DIR).filter((x) => x.endsWith('.v2.webp'))) {
    total += statSync(join(CARDS_DIR, f)).size;
  }
  check(
    '卡片素材总体积未超预算（2.2MB）',
    total <= 2.2 * 1024 * 1024,
    `${(total / 1024 / 1024).toFixed(2)}MB`,
  );
}

/* ---------- 输出 ---------- */
let failed = 0;
let skipped = 0;
for (const r of results) {
  if (r.skip) skipped += 1;
  if (!r.ok) failed += 1;
  console.log(
    `[${r.skip ? 'SKIP' : r.ok ? 'PASS' : 'FAIL'}] ${r.name}${r.detail ? ` — ${r.detail}` : ''}`,
  );
}
console.log(`\n${results.length - failed - skipped}/${results.length - skipped} 通过${skipped ? `（${skipped} 项跳过）` : ''}`);
if (failed > 0) {
  console.error(`\n${failed} 项缺陷未解决。`);
  process.exit(1);
}
