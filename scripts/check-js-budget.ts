/**
 * 首屏 JS 负载体检器
 *
 * 背景：线上实测（3G 限速）首屏 12 秒，真凶是 416KB 的单块 JS——
 * 实测阿里 CDN 对 .js **不启用 gzip/br**（HTML/CSS 会压，JS 不会），
 * 所以产物字节数就是线上真实传输字节数，压缩不掉，只能靠「少加载」。
 *
 * 本脚本是「尺子」：改分包策略前后各跑一次，缺陷必须归零。
 * 它自己跑一份带 sourcemap 的构建（不影响正式 dist），
 * 用 manifest 精确算出「首屏入口 + 其静态依赖」到底加载了哪些 chunk、多大、含哪些源码。
 *
 * 运行：npm run check:js
 */
import { execSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const OUT_DIR = 'dist-jsbudget';

/** 首屏 JS 未压缩总量预算（字节）——CDN 不压 JS，这个数就是线上真实下载量 */
const MAX_FIRST_LOAD_JS = 300 * 1024;
/** 单个 chunk 上限——防止所有代码又滚回一个大家伙 */
const MAX_CHUNK_BYTES = 240 * 1024;
/** 期望的 chunk 数量下限（拆分是否生效） */
const MIN_CHUNKS = 6;

/** 非首屏组件：这些只有在用户切到对应 tab / 打开浮层时才需要，不该进首屏 chunk */
const LAZY_COMPONENTS = [
  'ListeningQuiz',
  'ClassDashboard',
  'UserDataPanel',
  'FourteenDayPlan',
  'ConfusablePairsLab',
];

/** 首屏必须包含的源码（拆多了会白屏，拆少了没意义） */
const MUST_BE_FIRST = [
  'src/components/CardStudio.tsx',
  'src/data/phonics-catalog.ts',
];

type Result = { name: string; ok: boolean; detail: string };
const results: Result[] = [];
const check = (name: string, ok: boolean, detail: string) => {
  results.push({ name, ok, detail });
};

/* ---------- 0. 跑一份带 sourcemap 的构建 ---------- */
console.log(`[体检] 构建 ${OUT_DIR}（带 sourcemap）…`);
try {
  execSync(`npx vite build --outDir ${OUT_DIR} --sourcemap --emptyOutDir`, {
    cwd: ROOT,
    stdio: 'ignore',
    shell: true,
  });
} catch {
  console.error(`[体检] 构建失败：npx vite build --outDir ${OUT_DIR}`);
  process.exit(1);
}

const MANIFEST = join(ROOT, OUT_DIR, '.vite', 'manifest.json');
if (!existsSync(MANIFEST)) {
  check('构建产物含 manifest.json', false, `缺少 ${MANIFEST}`);
  console.log('\n[FAIL] 构建产物含 manifest.json');
  process.exit(1);
}
check('构建产物含 manifest.json', true, '');

const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8')) as Record<
  string,
  {
    file: string;
    src?: string;
    isEntry?: boolean;
    isDynamicEntry?: boolean;
    imports?: string[];
    css?: string[];
  }
>;

/* ---------- 1. 首屏 chunk 集合 = 入口 + 其静态依赖（递归） ---------- */
const entryKey = Object.keys(manifest).find((k) => manifest[k].isEntry);
if (!entryKey) {
  check('manifest 含入口条目', false, '找不到 isEntry');
  console.log('\n[FAIL] manifest 含入口条目');
  process.exit(1);
}

const firstLoad = new Set<string>();
const walk = (key: string) => {
  if (firstLoad.has(key)) return;
  firstLoad.add(key);
  for (const dep of manifest[key]?.imports ?? []) walk(dep);
};
walk(entryKey);

const firstLoadFiles = [...firstLoad].map((k) => manifest[k].file);
let firstLoadBytes = 0;
for (const f of firstLoadFiles) {
  const p = join(ROOT, OUT_DIR, f);
  if (existsSync(p)) firstLoadBytes += statSync(p).size;
}

const allChunkFiles = [...new Set(Object.values(manifest).map((m) => m.file))];

check(
  '首屏 JS 未压缩总量在预算内',
  firstLoadBytes <= MAX_FIRST_LOAD_JS,
  `${(firstLoadBytes / 1024).toFixed(1)}KB / 预算 ${(MAX_FIRST_LOAD_JS / 1024).toFixed(0)}KB（${firstLoadFiles.length} 个 chunk）`,
);

const biggest = firstLoadFiles
  .map((f) => ({ f, b: existsSync(join(ROOT, OUT_DIR, f)) ? statSync(join(ROOT, OUT_DIR, f)).size : 0 }))
  .sort((a, b) => b.b - a.b)[0];
check(
  '单个 chunk 未超预算',
  !biggest || biggest.b <= MAX_CHUNK_BYTES,
  biggest ? `最大 ${biggest.f} ${(biggest.b / 1024).toFixed(1)}KB / 预算 ${(MAX_CHUNK_BYTES / 1024).toFixed(0)}KB` : '',
);

check(
  '构建产物已拆分为多个 chunk',
  allChunkFiles.length >= MIN_CHUNKS,
  `${allChunkFiles.length} 个 chunk / 期望 ≥ ${MIN_CHUNKS}`,
);

/* ---------- 2. 非首屏组件必须是独立动态 chunk ---------- */
const notLazy: string[] = [];
for (const name of LAZY_COMPONENTS) {
  const key = Object.keys(manifest).find((k) => k.includes(`/${name}.tsx`));
  const entry = key ? manifest[key] : undefined;
  if (!entry) {
    notLazy.push(`${name}(无独立 chunk)`);
    continue;
  }
  if (!entry.isDynamicEntry) {
    notLazy.push(`${name}(非动态入口)`);
    continue;
  }
  if (firstLoadFiles.includes(entry.file)) {
    notLazy.push(`${name}(仍进首屏)`);
  }
}
check(
  '非首屏组件已拆为独立动态 chunk 且不进首屏',
  notLazy.length === 0,
  notLazy.length === 0 ? `${LAZY_COMPONENTS.length} 个组件全部拆出` : notLazy.join(', '),
);

/* ---------- 3. 首屏 chunk 里到底装了哪些源码 ---------- */
const firstLoadSources = new Set<string>();
for (const f of firstLoadFiles) {
  const mapPath = join(ROOT, OUT_DIR, f + '.map');
  if (!existsSync(mapPath)) continue;
  const map = JSON.parse(readFileSync(mapPath, 'utf8')) as { sources?: string[] };
  for (const s of map.sources ?? []) {
    const i = s.indexOf('/src/');
    if (i >= 0) firstLoadSources.add(s.slice(i + 1));
  }
}

const leaked = LAZY_COMPONENTS.filter((n) =>
  [...firstLoadSources].some((s) => s.endsWith(`${n}.tsx`)),
);
check(
  '首屏 chunk 的源码清单不含非首屏组件',
  leaked.length === 0,
  leaked.length === 0 ? `首屏含 ${firstLoadSources.size} 个项目源文件` : `泄漏：${leaked.join(', ')}`,
);

const missing = MUST_BE_FIRST.filter((s) => ![...firstLoadSources].some((x) => x.endsWith(s)));
check(
  '首屏 chunk 含首屏必需源码',
  missing.length === 0,
  missing.length === 0 ? MUST_BE_FIRST.join(', ') : `缺：${missing.join(', ')}`,
);

/* ---------- 输出 ---------- */
console.log('\n=== 首屏加载的 chunk ===');
for (const f of firstLoadFiles) {
  const p = join(ROOT, OUT_DIR, f);
  const b = existsSync(p) ? statSync(p).size : 0;
  console.log(`  ${f.padEnd(44)} ${(b / 1024).toFixed(1).padStart(8)}KB`);
}
console.log('\n=== 全部 chunk ===');
for (const f of allChunkFiles) {
  const p = join(ROOT, OUT_DIR, f);
  const b = existsSync(p) ? statSync(p).size : 0;
  const tag = firstLoadFiles.includes(f) ? ' ← 首屏' : '';
  console.log(`  ${f.padEnd(44)} ${(b / 1024).toFixed(1).padStart(8)}KB${tag}`);
}

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
