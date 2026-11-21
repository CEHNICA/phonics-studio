/**
 * 卡片印刷语 ↔ 网站学习步骤 的一致性体检器
 *
 * 背景：卡片上**印着**一行教学指令，网站上也有一套步骤文案。
 * 这两处以前各写各的 —— 改了一边另一边不跟，结果孩子照着卡片做，
 * 跟网站上看到的步骤对不上（第 8 轮踩过：卡片印「听→跟读→圈出」三步，
 * 网站却是另一套顺序）。
 *
 * 本脚本是「尺子」，守三件事：
 *   1. 卡片印刷语与网站步骤**关键词一致、顺序一致**（都从 src/data/learning-flow.ts 取）
 *   2. 重印脚本里的印刷语文案与 learning-flow.ts **一字不差**
 *   3. 实际印在 48 张卡上的那一行**墨迹特征**符合新句（旧句是 547px 宽，新句约 336px）
 *
 * 运行：npm run check:print
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { CARD_INSTRUCTION, LEARNING_STEPS } from '../src/data/learning-flow.ts';
import { CARD_H, CARD_W, decodeGray, resolveFfmpeg } from './derive-card-word-slots.ts';

const ROOT = process.cwd();
const CARDS_DIR = join(ROOT, 'public', 'assets', 'cards');
const CATALOG = join(ROOT, 'src', 'data', 'phonics-catalog.ts');
const REPRINT = join(ROOT, 'scripts', 'reprint_card_instruction.py');

type Result = { name: string; ok: boolean; detail: string; skip?: boolean };
const results: Result[] = [];
const check = (name: string, ok: boolean, detail: string) => {
  results.push({ name, ok, detail });
};
const skip = (name: string, detail: string) => {
  results.push({ name, ok: true, detail, skip: true });
};

/* ---------- 1. 卡片印刷语包含每一步的关键词，且顺序一致 ---------- */
/**
 * 关键词断言**每个关键词一条**，不合并成一条。
 * 合并的话「丢了一个关键词」会同时红在「含全部关键词」和别的连带断言上，
 * 逐项退回时对不上号（用户铁律：每条缺陷精确红在自己那条）。
 */
const positions: number[] = [];
for (const step of LEARNING_STEPS) {
  for (const kw of step.keywords) {
    const idx = CARD_INSTRUCTION.indexOf(kw);
    positions.push(idx);
    check(
      `印刷语含第 ${step.num} 步关键词「${kw}」`,
      idx >= 0,
      idx >= 0 ? `在第 ${idx} 个字` : `印刷语「${CARD_INSTRUCTION}」里没有「${kw}」`,
    );
  }
}
const ordered = positions.every((p, i) => p >= 0 && (i === 0 || p > positions[i - 1]));
check(
  '卡片印刷语的关键词顺序与网站步骤顺序一致',
  positions.some((p) => p < 0) ? true : ordered,
  positions.some((p) => p < 0)
    ? '有关键词缺失，顺序由「含关键词」那几条负责'
    : ordered
      ? '顺序一致'
      : `位置 ${positions.join(',')} 乱序`,
);
check(
  '卡片印刷语不含旧的三步式表述',
  !/跟读一遍[，,]\s*再圈出/.test(CARD_INSTRUCTION),
  /跟读一遍[，,]\s*再圈出/.test(CARD_INSTRUCTION) ? '还写着「跟读一遍，再圈出…」' : '已是两步式',
);

/* ---------- 2. 重印脚本的文案与 learning-flow.ts 一字不差 ---------- */
const reprintSrc = existsSync(REPRINT) ? readFileSync(REPRINT, 'utf8') : '';
const pyNew = reprintSrc.match(/^NEW\s*=\s*['"](.+?)['"]\s*$/m)?.[1] ?? '';
check(
  '重印脚本的印刷语文案与 learning-flow.ts 一致',
  Boolean(pyNew) && pyNew === CARD_INSTRUCTION,
  pyNew ? (pyNew === CARD_INSTRUCTION ? '一字不差' : `脚本=「${pyNew}」 常量=「${CARD_INSTRUCTION}」`) : '重印脚本里找不到 NEW 常量',
);
const pyOld = reprintSrc.match(/^OLD\s*=\s*['"](.+?)['"]\s*$/m)?.[1] ?? '';
check(
  '重印脚本保留了旧句作为校准基准',
  pyOld.includes('再圈出'),
  pyOld ? '旧句在列' : '找不到 OLD 常量',
);

/* ---------- 3. 素材版本 ---------- */
const files = existsSync(CARDS_DIR) ? readdirSync(CARDS_DIR).filter((f) => f.endsWith('.webp')) : [];
check(
  '卡片素材共 48 张且全部为 .v3.webp',
  files.length === 48 && files.every((f) => f.endsWith('.v3.webp')),
  `${files.length} 张，非 v3 的：${files.filter((f) => !f.endsWith('.v3.webp')).slice(0, 3).join(', ') || '无'}`,
);
const catalogSrc = existsSync(CATALOG) ? readFileSync(CATALOG, 'utf8') : '';
check(
  'catalog 的 cardSrc 指向 .v3.webp',
  /cardSrc:\s*`\/assets\/cards\/\$\{item\.id\}\.v3\.webp`/.test(catalogSrc),
  catalogSrc ? '' : '缺少 src/data/phonics-catalog.ts',
);

/* ---------- 4. 实际印在卡上的那一行：墨迹特征 ---------- */
/**
 * 新句「听一遍、圈一圈，再跟读一遍。」实测墨迹宽 ≈ 336px、左边界 x=39、高 ≈ 25px；
 * 旧句「听一遍，跟读一遍，再圈出读起来最顺口的那个词。」宽 547px。
 * 所以宽度是最灵敏的判据：没重印 / 印错句子 / 印回旧句，宽度都会跑出区间。
 */
const INK_WIDTH_RANGE = [315, 360];
const INK_HEIGHT_RANGE = [20, 30];
const INK_LEFT_RANGE = [34, 44];
/** 印刷语所在行带（避开上方紫色卡头底边） */
const BAND_TOP = 234;
const BAND_BOT = 285;

const ff = resolveFfmpeg();
if (!ff) {
  skip('印刷语墨迹特征符合新句', '找不到 ffmpeg，跳过素材层');
} else {
  const offSpec: string[] = [];
  const decodes: string[] = [];
  for (const f of files) {
    let gray: Buffer;
    try {
      gray = decodeGray(join(CARDS_DIR, f), ff);
    } catch {
      decodes.push(f);
      continue;
    }
    // 背景是暖白 (~247)，墨迹是深紫黑 (~50)。阈值取 170。
    let x0 = Number.POSITIVE_INFINITY;
    let x1 = -1;
    let y0 = Number.POSITIVE_INFINITY;
    let y1 = -1;
    for (let y = BAND_TOP; y < BAND_BOT; y++) {
      for (let x = 0; x < CARD_W; x++) {
        if (gray[y * CARD_W + x] < 170) {
          if (x < x0) x0 = x;
          if (x > x1) x1 = x;
          if (y < y0) y0 = y;
          if (y > y1) y1 = y;
        }
      }
    }
    if (x1 < 0) {
      offSpec.push(`${f}(无墨迹)`);
      continue;
    }
    const w = x1 - x0 + 1;
    const h = y1 - y0 + 1;
    if (
      w < INK_WIDTH_RANGE[0] ||
      w > INK_WIDTH_RANGE[1] ||
      h < INK_HEIGHT_RANGE[0] ||
      h > INK_HEIGHT_RANGE[1] ||
      x0 < INK_LEFT_RANGE[0] ||
      x0 > INK_LEFT_RANGE[1]
    ) {
      offSpec.push(`${f}(x${x0} w${w} h${h})`);
    }
  }
  check('48 张卡的印刷语都能解出来', decodes.length === 0, decodes.length === 0 ? '全部解码正常' : decodes.slice(0, 3).join(', '));
  check(
    '印刷语墨迹特征符合新句（宽度 315~360 / 高度 20~30 / 左边距 34~44）',
    offSpec.length === 0,
    offSpec.length === 0 ? '48 张全对（旧句宽度 547 会被这条抓住）' : `${offSpec.length} 张异常：${offSpec.slice(0, 3).join(', ')}`,
  );
  void CARD_H;
}

/* ---------- 输出 ---------- */
let failed = 0;
for (const r of results) {
  const tag = r.skip ? 'SKIP' : r.ok ? 'PASS' : 'FAIL';
  console.log(`[${tag}] ${r.name}${r.detail ? ` — ${r.detail}` : ''}`);
  if (!r.ok) failed += 1;
}
console.log(`\n${results.length - failed}/${results.length} 通过`);
if (failed > 0) process.exit(1);
