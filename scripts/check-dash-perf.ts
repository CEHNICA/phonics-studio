/**
 * 第 10 轮 · 班级看板读取慢 —— 体检器
 *
 * 背景：老师点「打开班级看板」要等 1.2~1.5 秒才出表格。
 * 实测结论（2026-11-21，见破甲\_tools\_ops_dash_perf.js / _ops_perf_seed.js）：
 *   - 后端 D1 查询本身极快（单条 0.26ms），health 空接口在本机 Node 直连也要 ~223ms；
 *   - 慢在**跨境往返抖动**：同一接口单次 223~3151ms，且 disable-quic 无差别；
 *   - 所以单次请求耗时不可控，能做的是：①减少往返次数 ②别让用户干等。
 *
 * 本脚本是「尺子」：上面四件事任何一处被摘掉都要红。
 * 运行：npm run check:dash-perf
 * 退回验证用：npx tsx scripts/check-dash-perf.ts --root=<改坏了的源码副本>
 */
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = resolve(
  process.argv.find((a) => a.startsWith('--root='))?.slice('--root='.length) ?? process.cwd(),
);

type Result = { name: string; ok: boolean; detail: string; skipped?: boolean };
const results: Result[] = [];
const check = (name: string, ok: boolean, detail = '') => {
  results.push({ name, ok, detail: ok ? '' : detail });
};
/**
 * 跳过：这条断言依赖的前提已经被别的断言判红（模块整个没了），
 * 再报一次红是重复计数，不是新问题。
 */
const skip = (name: string, detail: string) => {
  results.push({ name, ok: true, detail: `跳过：${detail}`, skipped: true });
};

const read = (rel: string): string => {
  const file = join(ROOT, rel);
  if (!existsSync(file)) return '';
  return readFileSync(file, 'utf8');
};

const BACKEND_REL = 'backend/cloudflare/pages/functions/api/[[path]].ts';
const DASH_REL = 'src/components/ClassDashboard.tsx';
const APP_REL = 'src/App.tsx';
const CACHE_REL = 'src/services/backend/class-overview-cache.ts';

/** 剥掉注释，避免把注释里的话当真（上一轮踩过） */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

/** 截取某个函数体（按大括号配平） */
function functionBody(src: string, signature: string): string {
  const start = src.indexOf(signature);
  if (start < 0) return '';
  const open = src.indexOf('{', start);
  if (open < 0) return '';
  let depth = 0;
  for (let i = open; i < src.length; i += 1) {
    if (src[i] === '{') depth += 1;
    else if (src[i] === '}') {
      depth -= 1;
      if (depth === 0) return src.slice(open, i + 1);
    }
  }
  return src.slice(open);
}

/** 截取箭头函数体：`onOpenUserData={() => { ... }}` */
function arrowBody(src: string, marker: string): string {
  const start = src.indexOf(marker);
  if (start < 0) return '';
  const open = src.indexOf('{', start);
  if (open < 0) return '';
  let depth = 0;
  for (let i = open; i < src.length; i += 1) {
    if (src[i] === '{') depth += 1;
    else if (src[i] === '}') {
      depth -= 1;
      if (depth === 0) return src.slice(open, i + 1);
    }
  }
  return src.slice(open);
}

/* ---------- 载入后端纯函数（真跑，不靠正则猜） ---------- */

type BackendModule = {
  AUTH_LOOKUP_SQL?: string;
  CLASS_MEMBERS_SQL?: string;
};
let backend: BackendModule = {};
try {
  backend = (await import(
    pathToFileURL(join(ROOT, BACKEND_REL)).href
  )) as unknown as BackendModule;
} catch {
  backend = {};
}

/* ---------- 载入看板缓存模块（真跑） ---------- */

type CacheModule = {
  CLASS_OVERVIEW_CACHE_KEY?: string;
  CLASS_OVERVIEW_CACHE_TTL_MS?: number;
  readClassOverviewCache?: (storage: StorageLike, spaceId: string) => CachedOverview | null;
  writeClassOverviewCache?: (storage: StorageLike, spaceId: string, data: unknown) => void;
  shouldPrefetchClassOverview?: (lastPrefetchedAt: number, now: number) => boolean;
  isClassOverviewFresh?: (cachedAt: number, now: number) => boolean;
  CLASS_OVERVIEW_FRESH_MS?: number;
};
type CachedOverview = { data: unknown; cachedAt: number } | null;
type StorageLike = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
};

let cache: CacheModule = {};
try {
  cache = (await import(
    pathToFileURL(join(ROOT, CACHE_REL)).href
  )) as unknown as CacheModule;
} catch {
  cache = {};
}

/** 假 localStorage */
function fakeStorage(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => {
      map.set(k, v);
    },
    removeItem: (k: string) => {
      map.delete(k);
    },
    dump: () => Object.fromEntries(map),
  };
}

/* ================================================================== */
/* 一、后端：把串行往返合并掉                                            */
/* ================================================================== */

const backendSrc = stripComments(read(BACKEND_REL));

// 1. requireAuth 只查一次
const authBody = functionBody(backendSrc, 'async function requireAuth');
const authQueryCount = (authBody.match(/env\.DB\.prepare\(/g) ?? []).length;
check(
  '后端：鉴权只用一条查询（requireAuth 内 prepare ≤ 1 次）',
  authBody !== '' && authQueryCount === 1,
  `requireAuth 内 prepare 出现 ${authQueryCount} 次（应合并成 1 次）`,
);

// 2. 那条查询确实把四张表 JOIN 起来了
const authSql = typeof backend.AUTH_LOOKUP_SQL === 'string' ? backend.AUTH_LOOKUP_SQL : '';
check(
  '后端：鉴权查询一次 JOIN 齐 session+account+member+space',
  ['phonics_sessions', 'phonics_accounts', 'phonics_members', 'phonics_spaces'].every((t) =>
    authSql.includes(t),
  ) && /join/i.test(authSql),
  `AUTH_LOOKUP_SQL 未同时 JOIN 四张表：${authSql.slice(0, 160)}`,
);

// 3. 看板接口不再额外查 space（space 由鉴权那条带出来）
const overviewBody = functionBody(backendSrc, 'async function handleClassOverview');
const overviewQueryCount = (overviewBody.match(/env\.DB\.prepare\(/g) ?? []).length;
check(
  '后端：看板接口只查一次成员表（不重复查班级信息）',
  overviewBody !== '' && overviewQueryCount === 1,
  `handleClassOverview 内 prepare 出现 ${overviewQueryCount} 次（应为 1 次）`,
);

// 4. 成员查询是 JOIN accounts，不是 N+1
const membersSql = typeof backend.CLASS_MEMBERS_SQL === 'string' ? backend.CLASS_MEMBERS_SQL : '';
check(
  '后端：成员列表一条 JOIN 拿完（无 N+1）',
  membersSql.includes('phonics_members') &&
    membersSql.includes('phonics_accounts') &&
    /left\s+join/i.test(membersSql),
  `CLASS_MEMBERS_SQL 缺 accounts 的 LEFT JOIN：${membersSql.slice(0, 160)}`,
);

// 5. 看板接口仍然限制成员数上限（防止班级爆量把响应撑大）
check(
  '后端：成员查询仍有限制条数上限',
  /limit\s+\d+/i.test(membersSql),
  'CLASS_MEMBERS_SQL 没有 LIMIT',
);

/* ================================================================== */
/* 二、前端：缓存 + 秒开                                                */
/* ================================================================== */

// 6. 缓存模块存在且导出齐全
check(
  '前端：存在看板缓存模块并导出读写函数',
  typeof cache.readClassOverviewCache === 'function' &&
    typeof cache.writeClassOverviewCache === 'function',
  `class-overview-cache.ts 缺少 read/write 导出（${CACHE_REL}）`,
);

// 7. 缓存 key 固定且带班级维度
check(
  '前端：缓存 key 固定为 phonics-studio-class-overview-v1',
  cache.CLASS_OVERVIEW_CACHE_KEY === 'phonics-studio-class-overview-v1',
  `缓存 key 是 ${String(cache.CLASS_OVERVIEW_CACHE_KEY)}`,
);

// 8. 缓存按班级隔离（不同班的数据不能串）
if (typeof cache.readClassOverviewCache === 'function' && typeof cache.writeClassOverviewCache === 'function') {
  const storage = fakeStorage();
  const overview = {
    space: { id: 'sp_a', name: '甲班', joinCode: 'AAAA1111', createdAt: '2026-01-01T00:00:00.000Z' },
    members: [{ accountId: 'u1', name: '学生一' }],
  };
  cache.writeClassOverviewCache(storage, 'sp_a', overview);
  const hitA = cache.readClassOverviewCache(storage, 'sp_a');
  const hitB = cache.readClassOverviewCache(storage, 'sp_b');
  check(
    '前端：缓存按班级隔离（换个班读不到别的班数据）',
    hitA !== null && hitB === null,
    `同班读到 ${hitA === null ? 'null' : '有值'}，异班读到 ${hitB === null ? 'null' : '有值'}`,
  );
} else {
  skip('前端：缓存按班级隔离（换个班读不到别的班数据）', '缓存模块没导出读写函数（已由上一条判红）');
}

// 9. 缓存内容损坏时安全退化（不炸）
if (typeof cache.readClassOverviewCache === 'function') {
  const storage = fakeStorage({ [String(cache.CLASS_OVERVIEW_CACHE_KEY)]: '{ 这不是 JSON' });
  let crashed = false;
  let out: unknown = '未执行';
  try {
    out = cache.readClassOverviewCache(storage, 'sp_a');
  } catch {
    crashed = true;
  }
  check(
    '前端：缓存内容损坏时安全退化成空（不崩）',
    !crashed && out === null,
    `损坏缓存读取抛错或返回了 ${String(out)}`,
  );
} else {
  skip('前端：缓存内容损坏时安全退化成空（不崩）', '缓存模块没导出读函数（已由上一条判红）');
}

// 10. 缓存 TTL 至少 30 秒（避免过期太短等于没缓存）
check(
  '前端：缓存 TTL 不短于 30 秒',
  typeof cache.CLASS_OVERVIEW_CACHE_TTL_MS === 'number' &&
    cache.CLASS_OVERVIEW_CACHE_TTL_MS >= 30_000,
  `TTL = ${String(cache.CLASS_OVERVIEW_CACHE_TTL_MS)}`,
);

// 11. 预取有节流：短时间内不重复打接口
if (typeof cache.shouldPrefetchClassOverview === 'function') {
  const t = 1_700_000_000_000;
  const first = cache.shouldPrefetchClassOverview(0, t);
  const tooSoon = cache.shouldPrefetchClassOverview(t, t + 1000);
  const later = cache.shouldPrefetchClassOverview(t, t + 60_000);
  check(
    '前端：预取有节流（1 分钟内不重复打接口）',
    first === true && tooSoon === false && later === true,
    `节流判定不对：首调=${first} 立刻再调=${tooSoon} 1分钟后=${later}`,
  );
} else {
  check('前端：预取有节流（1 分钟内不重复打接口）', false, '缓存模块没导出 shouldPrefetchClassOverview');
}

/* ================================================================== */
/* 三、看板组件：先亮缓存，再后台刷新                                    */
/* ================================================================== */

const dashSrc = stripComments(read(DASH_REL));

// 12. 看板组件先读缓存、再发请求（同一处改动，合成一条断言）
//     注意要断言**调用**（带括号），不是光看 import 里出现过名字 ——
//     只 import 不调用，一样是废的（这条曾经假绿过）
const cacheReadAt = dashSrc.indexOf('readClassOverviewCache(');
const requestAt = dashSrc.indexOf('classOverview(');
check(
  '前端：看板组件先读缓存再发请求（先亮旧数据）',
  cacheReadAt >= 0 && requestAt >= 0 && cacheReadAt < requestAt,
  `缓存读取位置 ${cacheReadAt}，请求位置 ${requestAt}`,
);

// 14. 有「正在刷新」的状态提示（拿旧数据时用户知道在更新）
check(
  '前端：拿旧数据时明确显示「正在更新」',
  /正在更新|刷新中|最新数据/.test(read(DASH_REL)),
  'ClassDashboard.tsx 没有「正在更新 / 刷新中」提示',
);

// 15. 慢的时候给提示（不能干转圈）
const slowMs = Number(
  (read(DASH_REL).match(/SLOW_LOAD_HINT_MS\s*=\s*(\d+)/) ?? [])[1] ?? '0',
);
check(
  '前端：超过 600ms 还没拿到数据就给「网络慢」提示',
  slowMs >= 600,
  `SLOW_LOAD_HINT_MS = ${slowMs}（应 ≥ 600）`,
);

// 16. 看板组件写缓存（刷新完存下来，下次秒开）
//     同样要断言**调用**，只 import 不调用等于没写
check(
  '前端：看板组件会写缓存',
  dashSrc.includes('writeClassOverviewCache('),
  'ClassDashboard.tsx 没有调用 writeClassOverviewCache',
);

// 16b. 缓存够新就不重复打接口（预取已经回来了，别再白跑一趟跨境）
check(
  '前端：缓存够新时不重复打接口',
  typeof cache.isClassOverviewFresh === 'function' &&
    dashSrc.includes('isClassOverviewFresh(') &&
    dashSrc.indexOf('isClassOverviewFresh(') < dashSrc.indexOf('backend.classOverview('),
  '看板组件没有在发请求前判断缓存新不新',
);

// 16c. 手动刷新 / 改名单之后必须强制拉最新（不能拿缓存糊弄）
check(
  '前端：手动刷新与改名单后强制拉最新',
  dashSrc.includes('load(true)'),
  'ClassDashboard.tsx 没有 load(true) 强制刷新',
);

/* ================================================================== */
/* 四、预取：不等用户点按钮                                            */
/* ================================================================== */

const appSrc = stripComments(read(APP_REL));

// 17. 打开「我的数据」面板时就预取看板数据
//     要断言**调用点在打开面板的回调里**：只看全文有没有调用是不行的
//     （别处也有调用时，这条会假绿）
const openPanelBody = arrowBody(appSrc, 'onOpenUserData={() =>');
check(
  '前端：打开「我的数据」面板就预取看板数据（不等点按钮）',
  openPanelBody.includes('prefetchClassOverview();'),
  'App.tsx 的 onOpenUserData 回调里没有调用 prefetchClassOverview()',
);

// 17b. 页面一加载就预取（老师点按钮前往往只隔几百毫秒，那时候才拉来不及）
const prefetchCallAt: number[] = [];
{
  let idx = appSrc.indexOf('prefetchClassOverview();');
  while (idx >= 0) {
    prefetchCallAt.push(idx);
    idx = appSrc.indexOf('prefetchClassOverview();', idx + 1);
  }
}
const callInOpenPanel = (at: number) =>
  openPanelBody !== '' && at >= appSrc.indexOf('onOpenUserData={() =>');
const hasLoadTimePrefetch = prefetchCallAt.some((at) => !callInOpenPanel(at));
check(
  '前端：页面加载后就预取看板数据（不等用户点按钮）',
  hasLoadTimePrefetch,
  `预取调用只在 onOpenUserData 里（调用点 ${prefetchCallAt.length} 个，全在面板打开回调内）`,
);

// 18. 预取用的是同一个缓存模块（预取和看板组件共用一份数据）
check(
  '前端：预取与看板组件共用同一份缓存模块',
  appSrc.includes('class-overview-cache'),
  'App.tsx 没有引用 class-overview-cache',
);

/* ================================================================== */
/* 五、回归：看板该有的东西还在                                          */
/* ================================================================== */

const dashRaw = read(DASH_REL);
// 表头要按**完整文案**匹配：只查「打卡」的话，把「打卡(天)」改成「打卡」照样过（假绿）
const HEADERS = ['成员', '身份', '已学(个)', '打卡(天)', '答题(道)', '正确率', '最近活跃', '操作'];
check(
  '回归：看板表格 8 列表头还在',
  HEADERS.every((t) => new RegExp(`<th[^>]*>${t.replace(/[()%]/g, '\\$&')}</th>`).test(dashRaw)),
  `ClassDashboard.tsx 表头缺列：${HEADERS.filter(
    (t) => !new RegExp(`<th[^>]*>${t.replace(/[()%]/g, '\\$&')}</th>`).test(dashRaw),
  ).join('、')}`,
);
check(
  '回归：4 张汇总卡还在',
  ['在册学生', '平均已学', '平均正确率', '今天活跃'].every((t) => dashRaw.includes(t)),
  'ClassDashboard.tsx 汇总卡缺项',
);
check(
  '回归：看板仍然只统计学生（老师不拉低平均分）',
  /!member\.revoked\s*&&\s*member\.role\s*!==\s*'owner'/.test(dashRaw),
  'ClassDashboard.tsx 不再排除 owner',
);
check(
  '回归：后端看板返回体结构不变（space + members）',
  /\bmembers,/.test(overviewBody) && overviewBody.includes('space:'),
  'handleClassOverview 不再返回 space + members',
);

/* ---------- 输出 ---------- */

const failed = results.filter((r) => !r.ok);
const skipped = results.filter((r) => r.skipped);
for (const r of results) {
  const mark = r.skipped ? ' skip ' : r.ok ? '  ok  ' : ' FAIL ';
  console.log(`${mark} ${r.name}${r.detail ? ` —— ${r.detail}` : ''}`);
}
console.log(
  `\n第10轮 看板性能体检：${results.length - failed.length - skipped.length}/${results.length - skipped.length} 通过` +
    (skipped.length ? `（${skipped.length} 条跳过）` : ''),
);
if (failed.length) {
  process.exitCode = 1;
}
