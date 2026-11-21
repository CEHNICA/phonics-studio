/**
 * 录音链路体检器
 *
 * 背景：手机版录音出过一串问题（录音没声音、被说成"有什么奇怪声音"）。
 * 实测发现移动端视口下整条链路其实是通的（真人读音能拿 99 分），
 * 所以真正的风险全在**移动端特有的环境差异**上：
 *
 *   1. iOS Safari 的 AudioContext 必须在用户手势里 resume，否则 suspended，
 *      decodeAudioData 会偶发返回空 buffer → 「录完没声音」
 *   2. MediaRecorder 不切片时，移动端长录音会丢尾段数据
 *   3. 非 HTTPS（isSecureContext 为假）浏览器直接禁用麦克风，
 *      提示若只写「请在电脑端打开」，用户在手机上等于死路
 *   4. 分析模块（78KB）若等到录完才 import，用户要干等一次下载
 *   5. 动态 import 必须带 .catch()，否则模块加载失败会变成未处理的 Promise 拒绝
 *
 * 本脚本是「尺子」：改录音相关代码前后各跑一次，缺陷必须归零。
 * 运行：npm run check:record
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const SRC_DIR = join(ROOT, 'src');
const HOOKS_DIR = join(SRC_DIR, 'hooks');
const UTILS_DIR = join(SRC_DIR, 'utils');
const COMPONENTS_DIR = join(SRC_DIR, 'components');

type Result = { name: string; ok: boolean; detail: string };

const results: Result[] = [];
const check = (name: string, ok: boolean, detail: string) => {
  results.push({ name, ok, detail });
};

/** 归一化空白，避免 JSX/TS 多行造成假阳性 */
const norm = (s: string) => s.replace(/\s+/g, ' ');

function readIfExists(p: string): string {
  return existsSync(p) ? readFileSync(p, 'utf8') : '';
}

const recorderSrc = readIfExists(join(HOOKS_DIR, 'useVoiceRecorder.ts'));
const analyzerSrc = readIfExists(join(UTILS_DIR, 'pronunciation-analyzer.ts'));
const ctxSrc = readIfExists(join(UTILS_DIR, 'audio-context.ts'));

/* ---------- 1. 文件存在 ---------- */
check('录音 Hook 存在', recorderSrc.length > 0, `src/hooks/useVoiceRecorder.ts`);
check('分析模块存在', analyzerSrc.length > 0, `src/utils/pronunciation-analyzer.ts`);
check(
  '共享 AudioContext 模块存在',
  ctxSrc.length > 0,
  'src/utils/audio-context.ts（单独抽出来，避免为激活 context 去加载 78KB 分析模块）',
);

/* ---------- 2. AudioContext 必须在用户手势里 resume ---------- */
{
  const normRecorder = norm(recorderSrc);
  const normCtx = norm(ctxSrc);
  check(
    '录音开始时激活 AudioContext（iOS suspended 会导致录完没声音）',
    /resumeSharedAudioContext\(\)/.test(normRecorder),
    recorderSrc.length ? 'startRecording 里未找到 resumeSharedAudioContext() 调用' : '缺少录音 Hook',
  );
  check(
    'resume 实现里有 ctx.resume() 且先判断 suspended 状态',
    /state === 'suspended'/.test(normCtx) && /ctx\.resume\(\)/.test(normCtx),
    normCtx ? '未找到 state === suspended / ctx.resume()' : '缺少 audio-context.ts',
  );
  const normAnalyzer = norm(analyzerSrc);
  check(
    '分析模块与录音链路共用同一个 AudioContext',
    /getSharedAudioContext/.test(normAnalyzer) && /from '\.\/audio-context/.test(normAnalyzer),
    'pronunciation-analyzer 未复用 audio-context.ts 的 context',
  );
}

/* ---------- 3. MediaRecorder 切片 ---------- */
{
  const normRecorder = norm(recorderSrc);
  // start(250) 之类带 timeslice 的调用；不接受裸 start()
  const sliced = /recorder\.start\(\s*\d+\s*\)/.test(normRecorder);
  check(
    'MediaRecorder 按片录制（避免移动端长录音丢尾段）',
    sliced && !/recorder\.start\(\s*\)/.test(normRecorder),
    sliced ? '已设置 timeslice' : 'recorder.start() 未带 timeslice',
  );
}

/* ---------- 4. 非 HTTPS 提示要说清怎么解决 ---------- */
{
  const normRecorder = norm(recorderSrc);
  check(
    '非安全上下文时给出可操作指引（提到 https 或线上地址）',
    /isSecureContext/.test(normRecorder) && /https/.test(normRecorder),
    '提示文案未给出可操作方案',
  );
}

/* ---------- 5. 分析模块预取 ---------- */
{
  const normRecorder = norm(recorderSrc);
  // 关键：必须区分「录音开始前预取」和「录完之后才 import」——
  // 光搜 import 会把 onstop 里那处也匹配上（它在语法位置上就位于 recorder.start() 之前），
  // 直接变成假绿。唯一可靠的特征是：预取是**独立语句**，import() 后面紧跟 .catch(
  // （链式写法后面紧跟的是 .then(）。
  const startCb = normRecorder.indexOf('const startRecording = useCallback(');
  const recStart = normRecorder.indexOf('recorder.start(', startCb);
  const beforeStart =
    startCb >= 0 && recStart > startCb ? normRecorder.slice(startCb, recStart) : '';
  const hasPrefetch = beforeStart.includes("import('../utils/pronunciation-analyzer').catch(");
  check(
    '录音开始时预取分析模块（录完不用干等 78KB 下载）',
    hasPrefetch,
    hasPrefetch
      ? 'import 出现在 recorder.start() 之前'
      : startCb < 0 || recStart < 0
        ? '找不到 startRecording / recorder.start() 位置'
        : 'recorder.start() 之前没有 pronunciation-analyzer 的 import（录完才加载 = 用户干等）',
  );
}

/* ---------- 6. 动态 import 必须有 .catch() ---------- */
{
  const normRecorder = norm(recorderSrc);
  // 注意：不能只认「紧跟在 import() 之后的 .catch」——
  // 链式写法 `import(...).then(...).then(...).catch(...)` 的 catch 在链尾，
  // 一样能兜住整条链的 reject。只判紧邻位置会假阳性。
  const importSites: { idx: number; hasCatch: boolean }[] = [];
  const re = /import\('\.\.\/utils\/pronunciation-analyzer'\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(normRecorder)) !== null) {
    // 从 import 处往后取 800 字符（覆盖整条 then/catch 链）
    const window = normRecorder.slice(m.index, m.index + 800);
    importSites.push({ idx: m.index, hasCatch: /\.catch\s*\(/.test(window) });
  }
  const missing = importSites.filter((s) => !s.hasCatch);
  check(
    '动态 import 全部带 .catch()（否则模块加载失败变成未处理拒绝）',
    importSites.length > 0 && missing.length === 0,
    importSites.length === 0
      ? '没找到 pronunciation-analyzer 的动态 import'
      : missing.length === 0
        ? `${importSites.length} 处动态 import 全部带 catch`
        : `${missing.length}/${importSites.length} 处缺少 .catch()`,
  );
}

/* ---------- 7. 组件层：录音按钮与错误提示 ---------- */
if (existsSync(COMPONENTS_DIR)) {
  const files = readdirSync(COMPONENTS_DIR).filter((f) => f.endsWith('.tsx'));
  let hasRecordBtn = false;
  let showsError = false;
  for (const f of files) {
    const src = norm(readFileSync(join(COMPONENTS_DIR, f), 'utf8'));
    if (/className="record-btn"/.test(src)) hasRecordBtn = true;
    if (/recorder\.errorMessage/.test(src) && /recorder-error/.test(src)) showsError = true;
  }
  check('组件里有录音按钮', hasRecordBtn, hasRecordBtn ? '' : '没找到 .record-btn');
  check('组件里有录音错误提示位', showsError, showsError ? '' : '没找到 .recorder-error 渲染');
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
