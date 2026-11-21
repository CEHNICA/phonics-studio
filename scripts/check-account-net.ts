/**
 * 第 9 轮体检器：账号链路在「国内弱网」下的健壮性
 *
 * 背景（第 9 轮实测拿到的真缺陷）：
 * 1) 建班请求偶发挂死 >8s，浏览器把请求掐断（net::ERR_ABORTED），
 *    班级没建出来 —— 8 秒超时对国内到 *.pages.dev 的跨境首连太短；
 * 2) 掐断后把 AbortError 原文甩给用户看：「signal is aborted without reason」；
 * 3) 页面加载时不信服务端，只信 localStorage 里那份旧会话 ——
 *    明明已经在班里了，界面还写「还没建班级」，点「创建班级」被服务端 409 顶回来。
 *
 * 本脚本是「尺子」：这三个坑任何一处被摘掉都要红。
 * 运行：npm run check:account-net
 * 退回验证用：node scripts/check-account-net.ts --root=<改坏了的源码副本>
 */
import { createServer } from 'node:http';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = resolve(
  process.argv.find((a) => a.startsWith('--root='))?.slice('--root='.length) ?? process.cwd(),
);

type Result = { name: string; ok: boolean; detail: string };
const results: Result[] = [];
const check = (name: string, ok: boolean, detail = '') => {
  results.push({ name, ok, detail: ok ? '' : detail });
};

const read = (rel: string): string => {
  const file = join(ROOT, rel);
  if (!existsSync(file)) return '';
  return readFileSync(file, 'utf8');
};

/** 递归收集 src/ 下所有源码（文案类断言必须全仓扫，只盯一个文件迟早漏） */
function collectSrcSources(dir = join(ROOT, 'src')): Array<{ rel: string; text: string }> {
  const out: Array<{ rel: string; text: string }> = [];
  const walk = (current: string) => {
    if (!existsSync(current)) return;
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const full = join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.(ts|tsx)$/.test(entry.name)) {
        out.push({
          rel: full.slice(ROOT.length + 1).replace(/\\/g, '/'),
          text: readFileSync(full, 'utf8'),
        });
      }
    }
  };
  walk(dir);
  return out;
}

/** 用户看得懂的文案里不该出现的英文技术串 */
const TECH_JUNK = /abort|signal|fail(ed)? to fetch|network error|timeout|timed out|ECONN|ERR_/i;

/* ---------- 1. 错误归一化纯函数（真跑） ---------- */

type ErrorModule = {
  normalizeBackendError?: (error: unknown, fallback: string) => string;
};

let errorMod: ErrorModule | null = null;
try {
  errorMod = (await import(
    pathToFileURL(join(ROOT, 'src/services/backend/error-messages.ts')).href
  )) as ErrorModule;
} catch (error) {
  errorMod = null;
  check(
    '错误归一化模块存在且可载入（src/services/backend/error-messages.ts）',
    false,
    `载入失败：${(error as Error).message}`,
  );
}

if (errorMod?.normalizeBackendError) {
  check('错误归一化模块存在且可载入（src/services/backend/error-messages.ts）', true);

  const normalize = errorMod.normalizeBackendError;

  // 掐断（AbortError）：Chromium 给 "signal is aborted without reason"，
  // Node 给 "This operation was aborted" —— 两种都得归一化
  const abortErr = new Error('signal is aborted without reason');
  abortErr.name = 'AbortError';
  const abortText = normalize(abortErr, '创建班级失败');
  check(
    'AbortError → 中文人话（不把 signal is aborted 甩给用户）',
    abortText !== 'signal is aborted without reason' &&
      /[一-龥]/.test(abortText) &&
      !TECH_JUNK.test(abortText),
    `得到：${abortText}`,
  );

  const abortErr2 = new Error('This operation was aborted');
  abortErr2.name = 'AbortError';
  const abortText2 = normalize(abortErr2, '创建班级失败');
  check(
    'AbortError（另一平台措辞）同样归一化',
    !TECH_JUNK.test(abortText2) && /[一-龥]/.test(abortText2),
    `得到：${abortText2}`,
  );

  const fetchErr = new TypeError('Failed to fetch');
  const fetchText = normalize(fetchErr, '创建班级失败');
  check(
    '网络不可达（Failed to fetch）→ 中文人话',
    !/Failed to fetch/i.test(fetchText) && /[一-龥]/.test(fetchText),
    `得到：${fetchText}`,
  );

  const serverText = '你已经在一个班级里了，先退出再建';
  const serverErr = new Error(serverText);
  check(
    '服务端给的中文提示原样保留（不能被归一化吃掉）',
    normalize(serverErr, '创建班级失败') === serverText,
    `得到：${normalize(serverErr, '创建班级失败')}`,
  );

  check(
    '看不懂的英文错误回落到调用方的中文兜底',
    normalize(new Error('boom'), '创建班级失败') === '创建班级失败',
    `得到：${normalize(new Error('boom'), '创建班级失败')}`,
  );
  check(
    '空错误回落到调用方的中文兜底',
    normalize(null, '创建班级失败') === '创建班级失败',
    `得到：${normalize(null, '创建班级失败')}`,
  );
  check(
    '归一化结果里不残留英文技术串',
    !TECH_JUNK.test(abortText) && !TECH_JUNK.test(fetchText),
    `abort=${abortText} / fetch=${fetchText}`,
  );
}

/* ---------- 2. 客户端超时（真读常量） ---------- */

type WorkerModule = {
  createWorkerBackend?: (
    baseUrl: string,
    options?: { timeoutMs?: number },
  ) => {
    createClass: (token: string, name: string) => Promise<unknown>;
  };
  REQUEST_TIMEOUT_MS?: number;
};

let workerMod: WorkerModule | null = null;
try {
  workerMod = (await import(
    pathToFileURL(join(ROOT, 'src/services/backend/worker-backend.ts')).href
  )) as WorkerModule;
} catch (error) {
  workerMod = null;
  check('后端客户端模块可载入', false, `载入失败：${(error as Error).message}`);
}

if (workerMod?.createWorkerBackend) {
  check('后端客户端模块可载入', true);

  const timeout = workerMod.REQUEST_TIMEOUT_MS;
  check(
    '默认超时 ≥ 15000ms（国内到 *.pages.dev 的跨境首连 8 秒会被掐断）',
    typeof timeout === 'number' && timeout >= 15000,
    `实际 ${String(timeout)}ms`,
  );

  /* ---------- 3. 真跑：对着会挂死的服务器建班 ---------- */
  // 起一个「收到请求但不回任何东西」的本地服务器，模拟跨境链路抖动
  const server = createServer(() => {
    /* 故意不响应 */
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;

  let thrown: unknown = null;
  try {
    const backend = workerMod!.createWorkerBackend!(`http://127.0.0.1:${port}`, {
      timeoutMs: 400,
    });
    await backend.createClass('token-test', '挂死测试班');
  } catch (error) {
    thrown = error;
  }
  await new Promise<void>((resolve) => server.close(() => resolve()));

  const thrownText = thrown instanceof Error ? thrown.message : String(thrown ?? '');
  check(
    '服务器挂死 → 抛出的是中文人话，不是 AbortError 原文',
    /[一-龥]/.test(thrownText) && !TECH_JUNK.test(thrownText),
    `得到：${thrownText}`,
  );
}

/* ---------- 4. 加载时要跟服务端校准（源码断言） ---------- */

const hookSrc = read('src/hooks/usePhonicsProgress.ts');
if (hookSrc) {
  // 注意：不能只看整个文件里有没有 .me( ——
  // refreshMembership 里本来就有 .me(，那样这条断言在修复前就是假绿。
  // 必须确认「同一个同步逻辑里既有 ping 预热、又有 me 校准」。
  const callbackChunks = hookSrc.split('useCallback(').slice(1);
  const syncChunk = callbackChunks.find((c) => c.includes('.ping(') && c.includes('.me('));
  check(
    '有「预热 + 校准」一体的账号同步逻辑（同一个回调里既有 ping 也有 me）',
    Boolean(syncChunk),
    '没找到同时调用 ping() 与 me() 的同步逻辑',
  );

  // useEffect 的函数体：形如 useEffect(() => { ... }, [deps])
  const effectBodies = [...hookSrc.matchAll(/useEffect\(\(\) => \{([\s\S]*?)\n  \}, \[/g)].map(
    (m) => m[1],
  );
  check(
    '挂载时真的会触发账号状态同步（不是只定义了没人调）',
    effectBodies.some((b) => b.includes('syncAccountState(')),
    `共 ${effectBodies.length} 个 useEffect，没一个调用 syncAccountState`,
  );

  const createBody = hookSrc.slice(
    hookSrc.indexOf('const createClass = useCallback'),
    hookSrc.indexOf('const leaveClass = useCallback'),
  );
  const catchBody = createBody.slice(createBody.indexOf('catch'));
  check(
    '建班失败后回头刷新班级状态（请求其实成功但响应丢了也能自愈）',
    catchBody.includes('refreshMembership('),
    'catch 分支里没有 refreshMembership',
  );
} else {
  check('进度 Hook 源码可读', false, '缺少 src/hooks/usePhonicsProgress.ts');
}

/* ---------- 4.5 打开账号面板时也要预热 + 校准 ---------- */

const appSrc = read('src/App.tsx');
if (appSrc) {
  // 只保留「接在入口上」这一条：再加一条弱断言会在同一处改动时红两条，
  // 逐项退回就对不上号了。
  const openIdx = appSrc.indexOf('onOpenUserData');
  const around = openIdx >= 0 ? appSrc.slice(openIdx, openIdx + 400) : '';
  check(
    '账号同步接在「我的数据」入口上（用户点按钮前连接已就绪）',
    around.includes('syncAccountState('),
    'onOpenUserData 附近没看到 syncAccountState',
  );
} else {
  check('App 源码可读', false, '缺少 src/App.tsx');
}

/* ---------- 5. 全仓不许把技术串直接给用户 ---------- */

/**
 * 剥注释再扫。
 *
 * 为什么必须剥：注释里为了说明问题会原样引用技术串
 * （worker-backend.ts 里就写着「signal is aborted without reason」），
 * 那是给人看的说明，不是给用户看的文案 —— 不剥就会假红。
 */
function stripComments(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

const TECH_STRINGS = ['signal is aborted', 'Failed to fetch'];
// 检测器本身（error-messages.ts）必须包含这些串才能识别它们，扫它等于自己告自己
const srcSources = collectSrcSources().filter((s) => !s.rel.endsWith('error-messages.ts'));
const junkHits: string[] = [];
for (const { rel, text } of srcSources) {
  const code = stripComments(text);
  for (const needle of TECH_STRINGS) {
    if (code.includes(needle)) junkHits.push(`${rel} → 「${needle}」`);
  }
}
check(
  'src/ 的实际代码里不出现直接给用户的技术错误串（注释与检测器除外）',
  srcSources.length > 0 && junkHits.length === 0,
  junkHits.join('; ') || 'src/ 下没扫到源码，检查器本身有问题',
);

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
