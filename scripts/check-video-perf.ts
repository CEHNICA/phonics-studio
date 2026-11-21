/**
 * 视频加载性能体检器
 *
 * 背景：国内网络下「口型演示实验室」视频播放极慢。
 * 根因组合：
 *   1. 源站响应头带 `Cache-Control: no-store` → 浏览器不缓存，每次重下整个文件；
 *   2. 视频规格冗余（1080p / 高码率），展示区却只有几百像素宽；
 *   3. `<video>` 缺 `preload` 与 `poster` → 切音标即重建元素重新请求，首帧前是黑屏。
 *
 * 本脚本是「尺子」：改视频相关代码前后各跑一次，缺陷必须归零。
 * 运行：npm run check:video
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const VIDEO_DIR = join(ROOT, 'public', 'assets', 'video');
const POSTER_DIR = join(ROOT, 'public', 'assets', 'poster');
const COMPONENTS_DIR = join(ROOT, 'src', 'components');
const CATALOG = join(ROOT, 'src', 'data', 'phonics-catalog.ts');

/** 单个视频体积预算（字节）。超了说明码率/分辨率没降下来。 */
const MAX_VIDEO_BYTES = 220 * 1024;
/** 48 个视频总体积预算（字节）。 */
const MAX_TOTAL_BYTES = 6 * 1024 * 1024;

type Result = { name: string; ok: boolean; detail: string };

const results: Result[] = [];
const check = (name: string, ok: boolean, detail: string) => {
  results.push({ name, ok, detail });
};

/* ---------- 1. 素材层：体积预算 ---------- */
let videoFiles: string[] = [];
if (!existsSync(VIDEO_DIR)) {
  check('素材目录存在', false, `缺少 ${VIDEO_DIR}`);
} else {
  const files = readdirSync(VIDEO_DIR).filter((f) => f.endsWith('.mp4'));
  videoFiles = files;
  let total = 0;
  let max = 0;
  let maxName = '';
  let oversized: string[] = [];
  for (const f of files) {
    const size = statSync(join(VIDEO_DIR, f)).size;
    total += size;
    if (size > max) {
      max = size;
      maxName = f;
    }
    if (size > MAX_VIDEO_BYTES) oversized.push(`${f}(${Math.round(size / 1024)}KB)`);
  }
  check('视频数量为 48', files.length === 48, `实际 ${files.length} 个`);
  check(
    '单个视频体积在预算内',
    oversized.length === 0,
    oversized.length === 0
      ? `最大 ${maxName} ${Math.round(max / 1024)}KB`
      : `${oversized.length} 个超预算：${oversized.slice(0, 5).join(', ')}${oversized.length > 5 ? ' …' : ''}`,
  );
  check(
    '视频总体积在预算内',
    total <= MAX_TOTAL_BYTES,
    `${(total / 1024 / 1024).toFixed(2)}MB / 预算 ${(MAX_TOTAL_BYTES / 1024 / 1024).toFixed(0)}MB`,
  );
}

/* ---------- 2. 素材层：poster 封面 ---------- */
if (!existsSync(POSTER_DIR)) {
  check('poster 封面目录存在', false, `缺少 ${POSTER_DIR}`);
} else {
  const posters = readdirSync(POSTER_DIR).filter((f) => /\.(jpg|jpeg|png)$/i.test(f));
  check('poster 封面数量为 48', posters.length === 48, `实际 ${posters.length} 个`);
  // 每个视频都要有同名封面，否则切音标会闪黑屏
  const noPoster = videoFiles
    .map((f) => f.replace(/\.mp4$/, '.jpg'))
    .filter((f) => !posters.includes(f));
  check(
    '每个视频都有同名 poster',
    noPoster.length === 0,
    noPoster.length === 0 ? '' : `缺 ${noPoster.slice(0, 5).join(', ')}`,
  );
}

/* ---------- 3. 数据层：catalog 提供 posterSrc ---------- */
const catalogSrc = existsSync(CATALOG) ? readFileSync(CATALOG, 'utf8') : '';
check(
  'catalog 提供 posterSrc 字段',
  /posterSrc\s*[:=]/.test(catalogSrc),
  catalogSrc ? '' : '缺少 src/data/phonics-catalog.ts',
);

/* ---------- 4. 组件层：每个 <video> 都有 preload 与 poster ---------- */
if (existsSync(COMPONENTS_DIR)) {
  const componentFiles = readdirSync(COMPONENTS_DIR).filter((f) => f.endsWith('.tsx'));
  let videoTags = 0;
  const missing: string[] = [];
  for (const f of componentFiles) {
    const src = readFileSync(join(COMPONENTS_DIR, f), 'utf8');
    // 逐个 <video ... > 开始标签做检查
    const tags = src.match(/<video\b[\s\S]*?>/g) ?? [];
    for (const tag of tags) {
      videoTags += 1;
      const file = `${f}`;
      const lacks: string[] = [];
      if (!/\bpreload=/.test(tag)) lacks.push('preload');
      if (!/\bposter=/.test(tag)) lacks.push('poster');
      if (lacks.length > 0) missing.push(`${file}: 缺 ${lacks.join('/')}`);
    }
  }
  check('组件里存在 video 标签', videoTags > 0, `共 ${videoTags} 个`);
  check(
    '每个 video 都声明 preload 与 poster',
    missing.length === 0,
    missing.length === 0 ? '' : missing.join('; '),
  );
}

/* ---------- 输出 ---------- */
let failed = 0;
for (const r of results) {
  if (!r.ok) failed += 1;
  const mark = r.ok ? 'PASS' : 'FAIL';
  console.log(`[${mark}] ${r.name}${r.detail ? ` — ${r.detail}` : ''}`);
}
console.log(`\n${results.length - failed}/${results.length} 通过`);
if (failed > 0) {
  console.error(`\n${failed} 项缺陷未解决。`);
  process.exit(1);
}
