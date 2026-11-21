/**
 * 账号身份 / 班级权限体检器
 *
 * 背景：账号体系原来没有「老师 / 学生」之分，任何登录用户都能建班，
 * 于是学生账号里也冒出「创建班级」按钮，语义上是错的（学生凭什么建班）。
 * 这一轮改成：注册时定身份 —— 学生只能拿班级码加入，老师要凭邀请码才能建班。
 *
 * 本脚本是「尺子」：身份门禁任何一处被摘掉都要红。
 * 运行：npm run check:role
 * 退回验证用：npx tsx scripts/check-class-role.ts --root=<改坏了的源码副本>
 */
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

/**
 * 递归收集 src/ 下所有源码文件。
 *
 * 为什么要有这个：上一版尺子只扫 UserDataPanel.tsx 一个文件，
 * 结果 usePhonicsProgress.ts 里还留着「还没进班级」的旧文案 —— 尺子自己漏检了。
 * 文案这类东西要全仓扫，只盯一个文件迟早漏。
 */
function collectSrcSources(dir = join(ROOT, 'src')): Array<{ rel: string; text: string }> {
  const out: Array<{ rel: string; text: string }> = [];
  const walk = (current: string) => {
    if (!existsSync(current)) return;
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const full = join(current, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (/\.(ts|tsx)$/.test(entry.name)) {
        out.push({ rel: full.slice(ROOT.length + 1).replace(/\\/g, '/'), text: readFileSync(full, 'utf8') });
      }
    }
  };
  walk(dir);
  return out;
}

const BACKEND_REL = 'backend/cloudflare/pages/functions/api/[[path]].ts';
const PANEL_REL = 'src/components/UserDataPanel.tsx';

/* ---------- 载入后端纯函数（真跑，不靠正则猜） ---------- */

type BackendModule = {
  resolveRegisterRole: (
    rawRole: string,
    teacherCode: string,
    configuredCode: string | undefined,
  ) => { ok: true; role: string } | { ok: false; status: number; message: string };
  canCreateClass: (account: { role?: string }) => boolean;
  accountPayload: (row: { username: string; display_name: string; role?: string }) => {
    username: string;
    displayName: string;
    role: string;
  };
};

let backend: BackendModule | null = null;
try {
  const mod = (await import(pathToFileURL(join(ROOT, BACKEND_REL)).href)) as BackendModule;
  backend = mod;
} catch (error) {
  backend = null;
  check('后端模块可载入', false, `载入失败：${(error as Error).message}`);
}

if (backend) {
  check('后端模块可载入', true, '');

  /* ---------- 1. 注册身份判定（真跑） ---------- */
  const student = backend.resolveRegisterRole('student', '', 'SECRET-CODE');
  check(
    '注册选学生 → 直接放行成学生（不需要任何码）',
    student.ok && student.role === 'student',
    student.ok ? `得到 ${student.role}` : `被拒：${student.message}`,
  );

  const teacherOk = backend.resolveRegisterRole('teacher', 'SECRET-CODE', 'SECRET-CODE');
  check(
    '注册选老师 + 邀请码正确 → 老师',
    teacherOk.ok && teacherOk.role === 'teacher',
    teacherOk.ok ? `得到 ${teacherOk.role}` : `被拒：${teacherOk.message}`,
  );

  const teacherLower = backend.resolveRegisterRole('teacher', 'secret-code', 'SECRET-CODE');
  check(
    '邀请码大小写不敏感（老师手抄不会踩坑）',
    teacherLower.ok && teacherLower.role === 'teacher',
    teacherLower.ok ? '小写码也通过' : `被拒：${teacherLower.message}`,
  );

  const teacherWrong = backend.resolveRegisterRole('teacher', 'WRONG-CODE', 'SECRET-CODE');
  check(
    '注册选老师 + 邀请码不对 → 拒绝（403）',
    !teacherWrong.ok && teacherWrong.status === 403,
    teacherWrong.ok ? '竟然放行了' : `status=${teacherWrong.status} ${teacherWrong.message}`,
  );

  const teacherNoSecret = backend.resolveRegisterRole('teacher', 'SECRET-CODE', undefined);
  check(
    '服务端没配邀请码 → 老师注册被挡（503），不能默认放行',
    !teacherNoSecret.ok && teacherNoSecret.status === 503,
    teacherNoSecret.ok ? '竟然放行了' : `status=${teacherNoSecret.status}`,
  );

  /* ---------- 2. 建班权限（真跑） ---------- */
  check(
    '学生账号不能建班',
    backend.canCreateClass({ role: 'student' }) === false,
    '',
  );
  check('老师账号能建班', backend.canCreateClass({ role: 'teacher' }) === true, '');
  check(
    '老账号（没有 role 字段）按学生处理，不能建班',
    backend.canCreateClass({}) === false,
    '',
  );

  /* ---------- 3. account 载荷带身份 ---------- */
  const payload = backend.accountPayload({
    username: 'seneca',
    display_name: 'Seneca',
    role: 'teacher',
  });
  check(
    'account 载荷带 role（前端据此决定给不给「创建班级」）',
    payload.role === 'teacher' && payload.username === 'seneca',
    `role=${payload.role}`,
  );
}

/* ---------- 4. 后端接线：门禁真的接在接口上 ---------- */

const backendSrc = read(BACKEND_REL);
if (backendSrc) {
  const createClassBody = backendSrc.slice(
    backendSrc.indexOf('async function handleCreateClass'),
    backendSrc.indexOf('async function handleJoinClass'),
  );
  check(
    'handleCreateClass 里接了 canCreateClass 门禁',
    createClassBody.includes('canCreateClass('),
    '学生可能绕过前端直接调接口建班',
  );

  const registerBody = backendSrc.slice(
    backendSrc.indexOf('async function handleRegister'),
    backendSrc.indexOf('async function handleLogin'),
  );
  check(
    'handleRegister 里接了 resolveRegisterRole',
    registerBody.includes('resolveRegisterRole('),
    '注册没走身份判定',
  );
  check(
    '注册写入 role 列（身份要落库）',
    /INSERT INTO phonics_accounts \([^)]*role[^)]*\)/s.test(registerBody),
    'INSERT 语句里没有 role 列',
  );

  const meBlock = backendSrc.slice(
    backendSrc.indexOf("route === '/api/me'"),
    backendSrc.indexOf("route === '/api/state'"),
  );
  check(
    '/api/me 返回身份（accountPayload 带 role）',
    meBlock.includes('accountPayload('),
    '刷新会话时拿不到身份',
  );

  const loginBody = backendSrc.slice(
    backendSrc.indexOf('async function handleLogin'),
    backendSrc.indexOf('async function handleLogout'),
  );
  check(
    '登录返回身份',
    loginBody.includes('accountPayload('),
    '登录后前端不知道是老师还是学生',
  );
} else {
  check('后端源码可读', false, `缺少 ${BACKEND_REL}`);
}

/* ---------- 5. 前端：会话里保留身份（真跑 parseSession） ---------- */

type SessionModule = {
  parseSession: (raw: string | null) => {
    account: { username: string; displayName: string; role: string };
    membership: { role: string } | null;
  } | null;
};

try {
  const sessionMod = (await import(
    pathToFileURL(join(ROOT, 'src/services/backend/account-session.ts')).href
  )) as SessionModule;

  const teacherSession = sessionMod.parseSession(
    JSON.stringify({
      token: 't',
      account: { username: 'u', displayName: 'U', role: 'teacher' },
      membership: null,
      savedAt: new Date().toISOString(),
    }),
  );
  check(
    '会话保留老师身份',
    teacherSession?.account.role === 'teacher',
    `role=${teacherSession?.account.role}`,
  );

  const studentSession = sessionMod.parseSession(
    JSON.stringify({
      token: 't',
      account: { username: 'u', displayName: 'U', role: 'student' },
      membership: null,
      savedAt: new Date().toISOString(),
    }),
  );
  check(
    '会话保留学生身份',
    studentSession?.account.role === 'student',
    `role=${studentSession?.account.role}`,
  );

  const legacyOwner = sessionMod.parseSession(
    JSON.stringify({
      token: 't',
      account: { username: 'u', displayName: 'U' },
      membership: { spaceId: 's', spaceName: '班', role: 'owner' },
      savedAt: new Date().toISOString(),
    }),
  );
  check(
    '老会话（没有 role，但班级里是 owner）按老师处理',
    legacyOwner?.account.role === 'teacher',
    `role=${legacyOwner?.account.role}`,
  );
} catch (error) {
  check('会话模块可载入', false, `载入失败：${(error as Error).message}`);
}

/* ---------- 6. 前端 UI：学生看不到「创建班级」 ---------- */

const panelSrc = read(PANEL_REL);
if (panelSrc) {
  // 「创建班级」按钮必须被 isTeacher 门控：
  // 找到那个按钮的 onClick，往回看它所在的那段 JSX 条件里有没有 isTeacher
  const btnIdx = panelSrc.indexOf('setCreatingClass(true)');
  let gated = false;
  if (btnIdx >= 0) {
    const before = panelSrc.slice(Math.max(0, btnIdx - 800), btnIdx);
    // 取最后一个形如 `{条件 && (` 的开头，看这段条件里有没有 isTeacher
    const condIdx = before.lastIndexOf('{!inClass');
    const cond = condIdx >= 0 ? before.slice(condIdx) : before;
    gated = /isTeacher/.test(cond);
  }
  check(
    '「创建班级」按钮受 isTeacher 门控（学生看不到）',
    btnIdx >= 0 && gated,
    btnIdx < 0 ? '面板里找不到「创建班级」按钮' : '按钮所在的条件里没有 isTeacher',
  );

  check(
    '面板不再出现「还没进班级」这种看不懂的文案',
    !panelSrc.includes('还没进班级'),
    '改成「还没加入班级 / 还没建班级」这种说人话的',
  );
  check('面板有「还没建班级」（老师）', panelSrc.includes('还没建班级'), '');
  check('面板有「还没加入班级」（学生）', panelSrc.includes('还没加入班级'), '');
  check(
    '学生看到的是「还没加入班级」（老师学生文案没串）',
    /isTeacher\s*\?\s*'还没建班级'\s*:\s*'还没加入班级'/.test(panelSrc),
    '学生和老师的文案没分开',
  );

  check(
    '注册表单有身份选择（学生 / 老师）',
    // 注意：不能只 includes('user-data-role-switch')，子串匹配会被
    // 'user-data-role-switch-x' 这类假类名骗过去（尺子自己的假绿）
    panelSrc.includes('className="user-data-role-switch"') &&
      panelSrc.includes("regRole === 'teacher'"),
    '',
  );
  check(
    '注册老师要填教师邀请码',
    panelSrc.includes('account-teacher-code') && panelSrc.includes('teacherCode'),
    '',
  );
} else {
  check('账号面板源码可读', false, `缺少 ${PANEL_REL}`);
}

/* ---------- 6.5 全仓文案口径（不能只扫面板一个文件） ---------- */

const STALE_CLASS_COPY = ['还没进班级', '没进班级'];
const srcSources = collectSrcSources();
const staleCopyHits: string[] = [];
for (const { rel, text } of srcSources) {
  for (const stale of STALE_CLASS_COPY) {
    if (text.includes(stale)) {
      staleCopyHits.push(`${rel} → 「${stale}」`);
    }
  }
}
check(
  '整个 src/ 都不出现旧口径「进班级」（学生说「加入班级」，老师说「建班级」）',
  srcSources.length > 0 && staleCopyHits.length === 0,
  staleCopyHits.join('; ') || 'src/ 下没扫到任何源码，检查器本身有问题',
);

/* ---------- 7. 前端：请求体带上身份 ---------- */

const workerSrc = read('src/services/backend/worker-backend.ts');
if (workerSrc) {
  const registerBody = workerSrc.slice(
    workerSrc.indexOf('async register('),
    workerSrc.indexOf('async login('),
  );
  check(
    '注册请求带上 role',
    /role:\s*input\.role/.test(registerBody),
    '',
  );
  check(
    '注册请求带上 teacherCode',
    /teacherCode:\s*input\.teacherCode/.test(registerBody),
    '',
  );
} else {
  check('后端客户端源码可读', false, '缺少 src/services/backend/worker-backend.ts');
}

/* ---------- 8. 数据表：role 列存在 + 迁移脚本在 ---------- */

const schemaSrc = read('backend/cloudflare/schema.sql');
check(
  '建表 SQL 里有 role 列',
  /role\s+TEXT\s+NOT NULL\s+DEFAULT\s+'student'/.test(schemaSrc),
  '',
);

const migrationSrc = read('backend/cloudflare/migrations/0001_account_role.sql');
check(
  '有线上迁移脚本（老库加 role 列 + 老 owner 升级）',
  migrationSrc.includes('ALTER TABLE phonics_accounts ADD COLUMN role') &&
    migrationSrc.includes("SET role = 'teacher'"),
  '',
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
