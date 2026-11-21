/**
 * 卡片图片加载性能体检器
 *
 * 背景：手绘卡片图是首屏最大单项负载。原图 1500x890 PNG，而展示区只有 463x275 CSS px，
 * 属于 3.2 倍超采样——绝大多数像素在浏览器里被直接丢弃，纯烧带宽。
 *
 * 本脚本是「尺子」：改卡片素材或引用路径前后各跑一次，缺陷必须归零。
 * 运行：npm run check:cards
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const CARDS_DIR = join(ROOT, 'public', 'assets', 'cards');
const CATALOG = join(ROOT, 'src', 'data', 'phonics-catalog.ts');

/** 单张卡片图体积预算（字节）——48 张全量加载，超过这个值首屏会被拖垮 */
const MAX_CARD_BYTES = 60 * 1024;
/** 卡片图总体积预算（字节） */
const MAX_TOTAL_BYTES = 2.2 * 1024 * 1024;
/** 目标宽度上限：展示区 463px @2x DPR 需要 926px，留 20% 余量 */
const TARGET_WIDTH = 1125;

type Result = { name: string; ok: boolean; detail: string };
const results: Result[] = [];
const check = (name: string, ok: boolean, detail: string) => {
  results.push({ name, ok, detail });
};

/* ---------- 1. 素材层 ---------- */
if (!existsSync(CARDS_DIR)) {
  check('卡片图目录存在', false, `缺少 ${CARDS_DIR}`);
} else {
  const files = readdirSync(CARDS_DIR).filter((f) => f.endsWith('.webp'));
  const legacy = readdirSync(CARDS_DIR).filter((f) => f.endsWith('.png'));

  check('卡片图 48 张', files.length === 48, `实际 ${files.length} 张`);
  check(
    '旧版 PNG 已全部移除',
    legacy.length === 0,
    legacy.length === 0 ? '' : `残留 ${legacy.length} 张：${legacy.slice(0, 3).join(', ')}`,
  );
  check(
    '卡片图全部为 .v3.webp 版本',
    files.every((f) => f.endsWith('.v3.webp')),
    files.filter((f) => !f.endsWith('.v3.webp')).slice(0, 3).join(', '),
  );

  let total = 0;
  let max = 0;
  let maxName = '';
  const over: string[] = [];
  for (const f of files) {
    const size = statSync(join(CARDS_DIR, f)).size;
    total += size;
    if (size > max) {
      max = size;
      maxName = f;
    }
    if (size > MAX_CARD_BYTES) over.push(`${f}(${Math.round(size / 1024)}KB)`);
  }
  check(
    '单张卡片图在预算内',
    over.length === 0,
    over.length === 0 ? `最大 ${maxName} ${Math.round(max / 1024)}KB` : `${over.length} 张超预算：${over.slice(0, 3).join(', ')}`,
  );
  check(
    '卡片图总体积在预算内',
    total <= MAX_TOTAL_BYTES,
    `${(total / 1024 / 1024).toFixed(2)}MB / 预算 ${(MAX_TOTAL_BYTES / 1024 / 1024).toFixed(2)}MB`,
  );
}

/* ---------- 2. 引用层：路径必须指向 .v3.webp，且不能带 query ---------- */
const catalogSrc = existsSync(CATALOG) ? readFileSync(CATALOG, 'utf8') : '';
check(
  'catalog 的 cardSrc 指向 .v3.webp',
  /cardSrc:\s*`\/assets\/cards\/\$\{item\.id\}\.v3\.webp`/.test(catalogSrc),
  catalogSrc ? '' : '缺少 src/data/phonics-catalog.ts',
);
check(
  'cardSrc 不再带 query 参数（CDN 对带 query 的静态资源可能回源到 SPA fallback）',
  !/cardSrc:[^\n]*\?v=/.test(catalogSrc),
  /cardSrc:[^\n]*\?v=/.test(catalogSrc) ? 'cardSrc 仍带 ?v= 参数' : '已改为文件名版本化',
);

/* ---------- 3. 尺寸层：真实解析 WebP 头，校验像素尺寸与宽高比 ---------- */
/**
 * 原图 1500x890 PNG，比例 150:89。缩放后的卡片图必须**严格同比例**，
 * 否则卡片上的单词热区（按百分比定位）会整体偏移。
 * 1050x623 = 150:89 × 7，是最接近且精确同比例的整数尺寸。
 */
const ORIGIN_W = 1500;
const ORIGIN_H = 890;
const EXPECTED_W = 1050;
const EXPECTED_H = 623;

/** 解析 WebP 文件头的像素尺寸（支持 VP8X / VP8 / VP8L 三种 chunk） */
function readWebpSize(file: string): { width: number; height: number } | null {
  const buf = readFileSync(file);
  if (buf.length < 30) return null;
  if (buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WEBP') {
    return null;
  }
  const fourcc = buf.toString('ascii', 12, 16);

  if (fourcc === 'VP8X') {
    // flags(1) + reserved(3) + canvas_width-1(3 LE) + canvas_height-1(3 LE)
    return { width: 1 + (buf[24] | (buf[25] << 8) | (buf[26] << 16)), height: 1 + (buf[27] | (buf[28] << 8) | (buf[29] << 16)) };
  }
  if (fourcc === 'VP8 ') {
    // 有损：找帧同步码 0x9d012a，其后 2 字节宽(14bit)、2 字节高(14bit)
    const idx = buf.indexOf(Buffer.from([0x9d, 0x01, 0x2a]), 20);
    if (idx < 0 || idx + 7 > buf.length) return null;
    const w = buf.readUInt16LE(idx + 3) & 0x3fff;
    const h = buf.readUInt16LE(idx + 5) & 0x3fff;
    return { width: w, height: h };
  }
  if (fourcc === 'VP8L') {
    // 无损：signature 0x2f 后 4 字节打包尺寸
    if (buf[20] !== 0x2f) return null;
    const bits = buf.readUInt32LE(21);
    return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
  }
  return null;
}

if (existsSync(CARDS_DIR)) {
  const webps = readdirSync(CARDS_DIR).filter((f) => f.endsWith('.v3.webp'));
  const wrongSize: string[] = [];
  const wrongRatio: string[] = [];
  let parsed = 0;

  for (const f of webps) {
    const size = readWebpSize(join(CARDS_DIR, f));
    if (!size) {
      wrongSize.push(`${f}(解析失败)`);
      continue;
    }
    parsed += 1;
    if (size.width !== EXPECTED_W || size.height !== EXPECTED_H) {
      wrongSize.push(`${f}(${size.width}x${size.height})`);
    }
    // 宽高比必须与原图严格一致，否则热区会偏移
    const origRatio = ORIGIN_W / ORIGIN_H;
    const newRatio = size.width / size.height;
    if (Math.abs(newRatio - origRatio) / origRatio > 0.0005) {
      wrongRatio.push(`${f}(${newRatio.toFixed(6)} vs ${origRatio.toFixed(6)})`);
    }
  }

  check(
    '卡片图像素尺寸为 1050x623',
    wrongSize.length === 0,
    wrongSize.length === 0 ? `已解析 ${parsed} 张` : `${wrongSize.length} 张异常：${wrongSize.slice(0, 3).join(', ')}`,
  );
  check(
    '宽高比与原图 1500:890 严格一致（热区按百分比定位，不能偏移）',
    wrongRatio.length === 0,
    wrongRatio.length === 0 ? '偏差 < 0.05%' : `${wrongRatio.length} 张比例偏差过大：${wrongRatio.slice(0, 3).join(', ')}`,
  );
  check(
    '缩放后宽度不超采样',
    EXPECTED_W <= TARGET_WIDTH,
    `${EXPECTED_W}px ≤ ${TARGET_WIDTH}px（展示区 463px @2x DPR 需 926px）`,
  );
}

/* ---------- 输出 ---------- */
let failed = 0;
for (const r of results) {
  if (!r.ok) failed += 1;
  console.log(`[${r.ok ? 'PASS' : 'FAIL'}] ${r.name}${r.detail ? ` — ${r.detail}` : ''}`);
}
console.log(`\n${results.length - failed}/${results.length} 通过`);
if (failed > 0) {
  console.error(`\n${failed} 项缺陷未解决。`);
  process.exit(1);
}
