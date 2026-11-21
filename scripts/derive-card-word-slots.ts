/**
 * 推导卡片上三个英文词的「圈」槽位坐标（开发工具，产出常量表）
 *
 * 背景：手绘卡片图印刷着「听一遍，跟读一遍，再圈出读起来最顺口的那个词」，
 * 网站上要把「圈」画在卡片里那个词上，就必须知道词在 1050x623 画布里的位置。
 *
 * 做法：ffmpeg 把 webp 解成灰度原始像素 → 逐行统计暗像素 → 找出「词文字行」
 *       → 在该行带里按列分组，得到三个词块的包围盒 → 全 48 张取中位数。
 *
 * 运行：
 *   node scripts/derive-card-word-slots.ts            # 打印推导结果 + 常量表
 *   node scripts/derive-card-word-slots.ts --profile long-i   # 打印某张卡的逐行剖面
 *
 * 需要 ffmpeg：先看环境变量 FFMPEG_PATH，否则从 PATH / C:\ffmpeg\ffmpeg-*\bin 里找。
 * 找不到就退出码 2（是「环境缺工具」，不是「推导失败」）。
 */
import { existsSync, readdirSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

const ROOT = process.cwd();
const CARDS_DIR = join(ROOT, 'public', 'assets', 'cards');

/** 卡片图固定像素尺寸（与 check-cards-perf.ts 的硬约束一致） */
export const CARD_W = 1050;
export const CARD_H = 623;
/** 判定「暗像素」的阈值（0=黑 255=白） */
const DARK = 120;
/** 词文字行的最小暗像素数（低于这个认为是插画/装饰） */
const MIN_TEXT_DARK = 25;

export function resolveFfmpeg(): string | null {
  const fromEnv = process.env.FFMPEG_PATH;
  if (fromEnv && existsSync(fromEnv)) return fromEnv;
  const onPath = spawnSync('ffmpeg', ['-hide_banner', '-version'], { encoding: 'utf8' });
  if (onPath.status === 0) return 'ffmpeg';
  const roots = ['C:\\ffmpeg'];
  for (const root of roots) {
    if (!existsSync(root)) continue;
    let dirs: string[] = [];
    try {
      dirs = readdirSync(root);
    } catch {
      continue;
    }
    for (const d of dirs) {
      const candidate = join(root, d, 'bin', 'ffmpeg.exe');
      if (existsSync(candidate)) return candidate;
    }
  }
  return null;
}

/** 把卡片图解成灰度原始像素（1050x623，每像素 1 字节） */
export function decodeGray(file: string, ffmpeg: string): Buffer {
  const res = spawnSync(
    ffmpeg,
    ['-hide_banner', '-loglevel', 'error', '-i', file, '-f', 'rawvideo', '-pix_fmt', 'gray', '-'],
    { maxBuffer: 64 * 1024 * 1024 },
  );
  if (res.status !== 0 || res.stdout.length < CARD_W * CARD_H) {
    throw new Error(`ffmpeg 解码失败：${file}`);
  }
  return res.stdout.subarray(0, CARD_W * CARD_H);
}

export type Box = { x0: number; x1: number; y0: number; y1: number };

/**
 * 逐行统计暗像素，找出「词文字行」与其上的三个词块。
 * 卡片版式（固定模板）：
 *   顶部色块标题 → 插画 → 英文词（大字）→ 音标（小字）
 */
export function analyzeCard(buf: Buffer): { bands: number[]; groups: Box[] } {
  const rowDark: number[] = [];
  for (let y = 0; y < CARD_H; y++) {
    let c = 0;
    const off = y * CARD_W;
    for (let x = 0; x < CARD_W; x++) {
      if (buf[off + x] < DARK) c++;
    }
    rowDark.push(c);
  }

  // 连续暗行合并成带（横贯全卡的分隔线不算文字，要排除）
  const bands: number[] = [];
  let start = -1;
  const MAX_TEXT_DARK = CARD_W * 0.6;
  for (let y = 0; y <= CARD_H; y++) {
    const isText = y < CARD_H && rowDark[y] >= MIN_TEXT_DARK && rowDark[y] <= MAX_TEXT_DARK;
    if (isText && start < 0) start = y;
    if (!isText && start >= 0) {
      bands.push(start, y - 1);
      start = -1;
    }
  }

  // 候选带：下半部分所有文字带（英文词行 + 音标行）
  const candidates: Array<[number, number]> = [];
  for (let i = 0; i < bands.length; i += 2) {
    const y0 = bands[i];
    const y1 = bands[i + 1];
    if (y0 > CARD_H * 0.6) candidates.push([y0, y1]);
  }
  if (candidates.length === 0) {
    return { bands, groups: [] };
  }

  // 英文词的字高明显大于音标行 → 取「带高最大」的那条带；等高时取更靠下的那条
  let wordBand: [number, number] = candidates[0];
  let bestHeight = -1;
  for (const [y0, y1] of candidates) {
    const h = y1 - y0 + 1;
    if (h >= bestHeight) {
      bestHeight = h;
      wordBand = [y0, y1];
    }
  }

  // 在词行带里按列聚合暗像素，容忍字间空隙 → 三个词块
  const colDark: number[] = [];
  for (let x = 0; x < CARD_W; x++) {
    let c = 0;
    for (let y = wordBand[0]; y <= wordBand[1]; y++) {
      if (buf[y * CARD_W + x] < DARK) c++;
    }
    colDark.push(c);
  }
  const groups: Box[] = [];
  let gStart = -1;
  for (let x = 0; x <= CARD_W; x++) {
    const on = x < CARD_W && colDark[x] > 0;
    if (on && gStart < 0) gStart = x;
    if (!on && gStart >= 0) {
      groups.push({ x0: gStart, x1: x - 1, y0: wordBand[0], y1: wordBand[1] });
      gStart = -1;
    }
  }
  // 把相邻小块并成三个词块（英文单词之间会有较大空隙，按空隙 > 30px 切）
  const merged: Box[] = [];
  for (const g of groups) {
    const last = merged[merged.length - 1];
    if (last && g.x0 - last.x1 <= 30) {
      last.x1 = g.x1;
      last.y0 = Math.min(last.y0, g.y0);
      last.y1 = Math.max(last.y1, g.y1);
    } else {
      merged.push({ ...g });
    }
  }
  void rowDark;
  return { bands, groups: merged };
}

/**
 * 圈覆盖率：椭圆圈住的黑像素占该词块黑像素的比例。
 * 这是「圈有没有真的套在词上」的可验证指标，必须够高（否则圈歪了/套住别的东西）。
 */
export function slotCoverage(buf: Buffer, group: Box, slot: { cx: number; cy: number; rx: number; ry: number }): number {
  let inside = 0;
  let total = 0;
  for (let y = group.y0; y <= group.y1; y++) {
    for (let x = group.x0; x <= group.x1; x++) {
      if (buf[y * CARD_W + x] >= DARK) continue;
      total++;
      const dx = (x - slot.cx) / slot.rx;
      const dy = (y - slot.cy) / slot.ry;
      if (dx * dx + dy * dy <= 1) inside++;
    }
  }
  return total === 0 ? 0 : inside / total;
}

/** 卡片上的词通常 3 个；取最靠左/中间/最右三块 */
export function pickThree(groups: Box[]): Box[] {
  if (groups.length < 3) return groups;
  const sorted = [...groups].sort((a, b) => a.x0 - b.x0);
  if (sorted.length === 3) return sorted;
  // 超过 3 块：按 x 间隔做聚类，挑三簇中心
  const clusters: Box[][] = [];
  let cur: Box[] = [];
  for (const g of sorted) {
    if (cur.length === 0 || g.x0 - cur[cur.length - 1].x1 <= 60) cur.push(g);
    else {
      clusters.push(cur);
      cur = [g];
    }
  }
  if (cur.length) clusters.push(cur);
  const mergedClusters = clusters.map((c) => ({
    x0: Math.min(...c.map((g) => g.x0)),
    x1: Math.max(...c.map((g) => g.x1)),
    y0: Math.min(...c.map((g) => g.y0)),
    y1: Math.max(...c.map((g) => g.y1)),
  }));
  return mergedClusters.slice(0, 3);
}

function main() {
  const profileArg = process.argv.indexOf('--profile');
  const ffmpeg = resolveFfmpeg();
  if (!ffmpeg) {
    console.error('找不到 ffmpeg。设置 FFMPEG_PATH 环境变量，或把 ffmpeg 装到 PATH 里。');
    process.exit(2);
  }
  if (!existsSync(CARDS_DIR)) {
    console.error(`缺少卡片目录：${CARDS_DIR}`);
    process.exit(2);
  }
  const files = readdirSync(CARDS_DIR).filter((f) => f.endsWith('.v2.webp')).sort();

  if (profileArg >= 0) {
    const id = process.argv[profileArg + 1];
    const file = join(CARDS_DIR, `${id}.v2.webp`);
    const buf = decodeGray(file, ffmpeg);
    const { bands, groups } = analyzeCard(buf);
    console.log(`== ${id} 词块 =`);
    for (const g of pickThree(groups)) console.log(JSON.stringify(g));
    console.log(`== 行带（成对 y0,y1）==`);
    console.log(bands.join(','));
    return;
  }

  const toSlot = (g: Box) => ({
    cx: Math.round((g.x0 + g.x1) / 2),
    cy: Math.round((g.y0 + g.y1) / 2),
    rx: Math.round((g.x1 - g.x0) / 2 + 12),
    ry: Math.round((g.y1 - g.y0) / 2 + 10),
  });

  const perCard: { id: string; groups: Box[]; buf: Buffer; coverage: number[] }[] = [];
  for (const f of files) {
    const buf = decodeGray(join(CARDS_DIR, f), ffmpeg);
    const { groups } = analyzeCard(buf);
    const picked = pickThree(groups);
    perCard.push({ id: f.replace('.v2.webp', ''), groups: picked, buf, coverage: [] });
    if (picked.length !== 3) {
      console.error(`[WARN] ${f} 只定位到 ${picked.length} 个词块`);
    }
  }

  // 每个槽位的圈覆盖率（套住词块黑像素的比例）
  for (const c of perCard) {
    c.coverage = c.groups.map((g) => slotCoverage(c.buf, g, toSlot(g)));
  }
  const minCoverage = Math.min(...perCard.flatMap((c) => c.coverage));
  console.log(`== 最低圈覆盖率：${(minCoverage * 100).toFixed(1)}% ==`);
  for (const c of perCard) {
    if (c.coverage.some((v) => v < 0.85)) {
      console.error(`[WARN] ${c.id} 圈覆盖率偏低：${c.coverage.map((v) => `${(v * 100).toFixed(0)}%`).join(' / ')}`);
    }
  }

  const med = (nums: number[]) => {
    const s = [...nums].sort((a, b) => a - b);
    return s[Math.floor(s.length / 2)];
  };
  const fallback = [0, 1, 2].map((i) => {
    const boxes = perCard.filter((c) => c.groups[i]).map((c) => c.groups[i]);
    const b = {
      cx: med(boxes.map((g) => (g.x0 + g.x1) / 2)),
      cy: med(boxes.map((g) => (g.y0 + g.y1) / 2)),
      rx: med(boxes.map((g) => (g.x1 - g.x0) / 2 + 12)),
      ry: med(boxes.map((g) => (g.y1 - g.y0) / 2 + 10)),
    };
    return { cx: Math.round(b.cx), cy: Math.round(b.cy), rx: Math.round(b.rx), ry: Math.round(b.ry) };
  });

  const cards: Record<string, typeof fallback> = {};
  for (const c of perCard) {
    cards[c.id] = c.groups.length === 3 ? c.groups.map(toSlot) : fallback;
  }

  const payload = {
    canvas: { w: CARD_W, h: CARD_H },
    fallback,
    cards,
  };

  const jsonArg = process.argv.indexOf('--json');
  if (jsonArg >= 0) {
    console.log(JSON.stringify(payload, null, 2));
    return;
  }
  const writeArg = process.argv.indexOf('--write');
  if (writeArg >= 0) {
    const out = process.argv[writeArg + 1];
    const header = `// 自动生成，请勿手改。\n// 重新生成：node scripts/derive-card-word-slots.ts --write ${out.replace(/\\/g, '/')}\n//\n// 卡片上三个英文词在 ${CARD_W}x${CARD_H} 画布里的「圈」槽位（红笔圈画在这里）。\n`;
    const body = `${header}export type CircleSlot = { cx: number; cy: number; rx: number; ry: number };\n\nexport const CARD_SLOT_DATA: {\n  canvas: { w: number; h: number };\n  fallback: CircleSlot[];\n  cards: Record<string, CircleSlot[]>;\n} = ${JSON.stringify(payload, null, 2)};\n`;
    writeFileSync(out, body, 'utf8');
    console.log(`已写入 ${out}（${Object.keys(cards).length} 张卡）`);
    return;
  }

  console.log('== 每张卡定位到的词块中心 ==');
  for (const c of perCard) {
    console.log(
      `${c.id.padEnd(18)} ${c.groups
        .map((g) => `x${Math.round((g.x0 + g.x1) / 2)} y${Math.round((g.y0 + g.y1) / 2)} w${g.x1 - g.x0} h${g.y1 - g.y0}`)
        .join('  |  ')}`,
    );
  }
  console.log('\n== 兜底常量（取不到该卡词块时用这个）==');
  console.log(fallback.map((c, i) => `  { cx: ${c.cx}, cy: ${c.cy}, rx: ${c.rx}, ry: ${c.ry} },  // ${'ABC'[i]}`).join('\n'));
}

if (import.meta.url.endsWith(process.argv[1]?.replace(/\\/g, '/') ?? '')) {
  main();
}
