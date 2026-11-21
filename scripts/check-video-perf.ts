/**
 * 视频加载性能体检器
 *
 * 背景：国内网络下「口型演示实验室」视频播放极慢。
 * 根因组合：
 *   1. 源站响应头带 `Cache-Control: no-store` → 浏览器不缓存，每次重下整个文件；
 *   2. 视频规格冗余（1080p / 高码率），展示区却只有几百像素宽；
 *   3. `<video>` 缺 `preload` 与 `poster` → 切音标即重建元素重新请求，首帧前是黑屏。
 *
 * 另一条被实测抓出来的真缺陷：
 *   4. 重编码时丢了音轨 —— 口型示范视频本来就带示范发音，重编码成 640x360 后
 *      只剩一条 video stream，用户点播放「没声音」。见下方「素材层：音轨」。
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

/* ---------- 2. 素材层：音轨（口型示范视频必须有示范发音） ---------- */
/**
 * 纯 JS 解析 MP4 box，不依赖 ffprobe（体检器要能在任何机器上跑）。
 * 只需找出 moov/trak/mdia/hdlr 的 handler_type：'soun' 即音频轨。
 */
type Mp4Box = { type: string; dataStart: number; boxEnd: number };

function readBoxes(buf: Buffer, start: number, end: number): Mp4Box[] {
  const out: Mp4Box[] = [];
  let off = start;
  while (off + 8 <= end) {
    let size = buf.readUInt32BE(off);
    const type = buf.toString('latin1', off + 4, off + 8);
    let dataStart = off + 8;
    if (size === 1) {
      // 64 位长度
      const hi = buf.readUInt32BE(off + 8);
      const lo = buf.readUInt32BE(off + 12);
      size = hi * 2 ** 32 + lo;
      dataStart = off + 16;
    } else if (size === 0) {
      size = end - off;
    }
    if (size < 8) break;
    const boxEnd = Math.min(off + size, end);
    out.push({ type, dataStart, boxEnd });
    off += size;
  }
  return out;
}

function findBox(buf: Buffer, boxes: Mp4Box[], type: string): Mp4Box | undefined {
  return boxes.find((b) => b.type === type);
}

/** 返回该 mp4 的音频轨信息；无音轨返回 null。 */
function inspectAudioTrack(buf: Buffer): { handler: string; codec: string } | null {
  const top = readBoxes(buf, 0, buf.length);
  const moov = findBox(buf, top, 'moov');
  if (!moov) return null;
  for (const trak of readBoxes(buf, moov.dataStart, moov.boxEnd)) {
    if (trak.type !== 'trak') continue;
    const mdia = findBox(buf, readBoxes(buf, trak.dataStart, trak.boxEnd), 'mdia');
    if (!mdia) continue;
    const mdiaChildren = readBoxes(buf, mdia.dataStart, mdia.boxEnd);
    const hdlr = findBox(buf, mdiaChildren, 'hdlr');
    if (!hdlr) continue;
    // hdlr: version+flags(4) + pre_defined(4) + handler_type(4)
    const handler = buf.toString('latin1', hdlr.dataStart + 8, hdlr.dataStart + 12);
    if (handler !== 'soun') continue;
    // 找 codec：mdia/minf/stbl/stsd -> 第一个 sample entry 的 format
    let codec = '';
    const minf = findBox(buf, mdiaChildren, 'minf');
    if (minf) {
      const stbl = findBox(buf, readBoxes(buf, minf.dataStart, minf.boxEnd), 'stbl');
      if (stbl) {
        const stsd = findBox(buf, readBoxes(buf, stbl.dataStart, stbl.boxEnd), 'stsd');
        // stsd: version+flags(4) + entry_count(4) + entries
        if (stsd && stsd.dataStart + 12 <= buf.length) {
          codec = buf.toString('latin1', stsd.dataStart + 12, stsd.dataStart + 16);
        }
      }
    }
    return { handler, codec };
  }
  return null;
}

if (videoFiles.length > 0) {
  const noAudio: string[] = [];
  const badCodec: string[] = [];
  let withAudio = 0;
  for (const f of videoFiles) {
    const buf = readFileSync(join(VIDEO_DIR, f));
    const audio = inspectAudioTrack(buf);
    if (!audio) {
      noAudio.push(f);
      continue;
    }
    withAudio += 1;
    if (audio.codec !== 'mp4a') badCodec.push(`${f}(${audio.codec || '未知'})`);
  }
  check(
    '每个视频都带音轨（口型示范有示范发音）',
    noAudio.length === 0,
    noAudio.length === 0
      ? `${withAudio}/${videoFiles.length} 个有音轨`
      : `${noAudio.length}/${videoFiles.length} 个没有音轨：${noAudio.slice(0, 5).join(', ')}${noAudio.length > 5 ? ' …' : ''}`,
  );
  check(
    '音轨编码为 AAC(mp4a)',
    noAudio.length === 0 && badCodec.length === 0,
    noAudio.length > 0
      ? `${noAudio.length} 个缺音轨，无法验证 AAC 编码`
      : badCodec.length === 0
        ? ''
        : `${badCodec.length} 个非 AAC：${badCodec.slice(0, 5).join(', ')}`,
  );
}

/* ---------- 3. 素材层：poster 封面 ---------- */
if (!existsSync(POSTER_DIR)) {
  check('poster 封面目录存在', false, `缺少 ${POSTER_DIR}`);
} else {
  const posters = readdirSync(POSTER_DIR).filter((f) => /\.(jpg|jpeg|png)$/i.test(f));
  check('poster 封面数量为 48', posters.length === 48, `实际 ${posters.length} 个`);
  // 每个视频都要有对应封面，否则切音标会闪黑屏。
  // 按「基名」匹配而不是「完整文件名」：poster 内容没变时不必跟着视频升版本号
  // （换名会让 CDN 缓存全部失效，白白重下一遍）。
  const stripVer = (s: string) => s.replace(/\.(mp4|jpg|jpeg|png)$/i, '').replace(/\.v\d+$/, '');
  const posterBases = new Set(posters.map(stripVer));
  const noPoster = videoFiles.map(stripVer).filter((b) => !posterBases.has(b));
  check(
    '每个视频都有对应 poster',
    noPoster.length === 0,
    noPoster.length === 0 ? '' : `缺 ${noPoster.slice(0, 5).join(', ')}`,
  );
}

/* ---------- 4. 数据层：catalog 提供 posterSrc ---------- */
const catalogSrc = existsSync(CATALOG) ? readFileSync(CATALOG, 'utf8') : '';
check(
  'catalog 提供 posterSrc 字段',
  /posterSrc\s*[:=]/.test(catalogSrc),
  catalogSrc ? '' : '缺少 src/data/phonics-catalog.ts',
);

/* ---------- 5. 数据层：catalog 的视频路径版本 == 素材目录版本 ---------- */
// 光有文件还不够：catalog 指向的版本必须和 public/assets/video 里躺着的版本一致，
// 否则线上直接 404（CDN 还会把旧文件缓存 30 天，症状是「改了没生效」）。
if (catalogSrc && videoFiles.length > 0) {
  const m = catalogSrc.match(/localVideoSrc\s*:\s*`\/assets\/video\/\$\{item\.id\}\.(v\d+)\.mp4`/);
  if (!m) {
    check('catalog 的视频路径版本与素材目录一致', false, '无法从 catalog 解析 localVideoSrc 模板');
  } else {
    const declared = m[1];
    const fileVersions = new Set(
      videoFiles.map((f) => {
        const vm = f.match(/\.(v\d+)\.mp4$/);
        return vm ? vm[1] : '无版本';
      }),
    );
    const consistent = fileVersions.size === 1 && fileVersions.has(declared);
    check(
      'catalog 的视频路径版本与素材目录一致',
      consistent,
      consistent
        ? `catalog=${declared}，素材目录=${[...fileVersions].join(',')}`
        : `catalog 指向 ${declared}.mp4，素材目录里是 ${[...fileVersions].join(',')}`,
    );
  }
}

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
