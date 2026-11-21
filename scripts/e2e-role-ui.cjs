/**
 * 账号身份 / 班级权限 · 线上 UI E2E
 *
 * 验证四件事：
 * 1. 注册表单有「学生 / 老师」身份选择，只有老师才出现邀请码输入框，且没填不能提交；
 * 2. 学生账号面板里完全没有「创建班级」，文案是「还没加入班级」；
 * 3. 老师账号面板里有「创建班级」，文案是「还没建班级」；
 * 4. 老师建班拿到班级码，学生用班级码加入后状态变成「已加入」。
 *
 * 用法：
 *   npm run check:role-e2e
 *   # 或指定站点 / 邀请码
 *   set TARGET_SITE=https://xxx.space.mcode.cn
 *   set PHONICS_TEACHER_CODE=XXXX
 *   node scripts/e2e-role-ui.cjs
 *
 * 教师邀请码来源优先级：环境变量 PHONICS_TEACHER_CODE → <repo>/../_secrets/teacher-invite-code.txt
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

/** playwright 可能装在全局，仓库本身不依赖它，所以这里做兜底解析 */
function loadPlaywright() {
  try {
    return require('playwright');
  } catch {
    const candidates = [];
    if (process.env.NODE_PATH) {
      candidates.push(...process.env.NODE_PATH.split(path.delimiter));
    }
    candidates.push(
      path.join(os.homedir(), 'AppData', 'Roaming', 'npm', 'node_modules'),
      path.join(os.homedir(), '.npm-global', 'lib', 'node_modules'),
      '/usr/local/lib/node_modules',
    );
    for (const base of candidates) {
      const target = path.join(base, 'playwright');
      if (fs.existsSync(target)) return require(target);
    }
    throw new Error(
      '找不到 playwright：先 npm i -D playwright，或设置 NODE_PATH 指向全局 node_modules',
    );
  }
}

const { chromium } = loadPlaywright();

const SITE = process.env.TARGET_SITE || 'https://5p3wt4cgcivtd.space.mcode.cn';

function readTeacherCode() {
  const fromEnv = (process.env.PHONICS_TEACHER_CODE || '').trim();
  if (fromEnv) return fromEnv;
  const file = path.join(__dirname, '..', '_secrets', 'teacher-invite-code.txt');
  if (!fs.existsSync(file)) return '';
  const raw = fs.readFileSync(file, 'utf8');
  const line = raw
    .split(/\r?\n/)
    .map((l) => l.trim())
    .find((l) => l && !l.startsWith('#'));
  if (!line) return '';
  // 兼容 "TEACHER_INVITE_CODE=XXXX" 和纯 "XXXX"
  const eq = line.indexOf('=');
  return (eq >= 0 ? line.slice(eq + 1) : line).trim();
}

const TEACHER_CODE = readTeacherCode();

let passed = 0;
let failed = 0;
const failures = [];
function check(name, cond, detail = '') {
  if (cond) {
    passed += 1;
    console.log(`  PASS  ${name}`);
  } else {
    failed += 1;
    failures.push(`${name}  ${detail}`);
    console.log(`  FAIL  ${name}  ${detail}`);
  }
}

const suffix = Date.now().toString(36);
const STUDENT_USER = `ui_stu_${suffix}`;
const TEACHER_USER = `ui_tea_${suffix}`;
const PASSWORD = 'pass1234';

async function openPanel(page) {
  await page.goto(`${SITE}/?cb=${Date.now()}`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('button[title^="我的数据"]', { timeout: 30000 });
  if (await page.$('.user-data-panel')) return;
  await page.click('button[title^="我的数据"]');
  await page.waitForSelector('.user-data-panel', { timeout: 20000 });
  await page.waitForTimeout(300);
}

async function textOf(page, selector) {
  const el = await page.$(selector);
  return el ? (await el.textContent()) || '' : null;
}

async function register(page, username, role, code) {
  await openPanel(page);
  await page.click('.user-data-tabs button:nth-child(2)'); // 注册
  await page.waitForSelector('#account-username', { timeout: 10000 });
  await page.fill('#account-username', username);
  await page.fill('#account-password', PASSWORD);
  if (role === 'teacher') {
    await page.click('.user-data-role-switch button:nth-child(2)');
    await page.waitForSelector('#account-teacher-code', { timeout: 8000 });
    await page.fill('#account-teacher-code', code);
  }
  await page.click('.user-data-primary-btn-block');
  // 登录成功后面板会切到已登录视图（.user-data-sync-time 只在已登录时渲染）
  await page.waitForSelector('.user-data-sync-time', { timeout: 30000 });
  await page.waitForTimeout(600);
}

async function waitForStatus(page, keyword, timeout = 30000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    const t = await textOf(page, '.user-data-sync-time');
    if (t && t.includes(keyword)) return t;
    await page.waitForTimeout(400);
  }
  return await textOf(page, '.user-data-sync-time');
}

(async () => {
  if (!TEACHER_CODE) {
    console.error('缺少教师邀请码：设置 PHONICS_TEACHER_CODE 或 _secrets\\teacher-invite-code.txt');
    process.exit(2);
  }
  console.log(`站点：${SITE}`);

  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1440, height: 960 } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));

  /* ---------- 1. 注册表单的身份选择 ---------- */
  console.log('\n[1] 注册表单的身份选择');
  await openPanel(page);
  await page.click('.user-data-tabs button:nth-child(2)');
  await page.waitForSelector('#account-username', { timeout: 10000 });
  const studentBtn = await page.$('.user-data-role-switch button:nth-child(1)');
  const teacherBtn = await page.$('.user-data-role-switch button:nth-child(2)');
  check('注册表单有「学生 / 老师」身份选择', Boolean(studentBtn && teacherBtn));
  check('默认是学生（不显示邀请码输入框）', (await page.$('#account-teacher-code')) === null);

  await teacherBtn.click();
  await page.waitForSelector('#account-teacher-code', { timeout: 8000 });
  check('选「老师」后出现教师邀请码输入框', true);

  await studentBtn.click();
  await page.waitForTimeout(300);
  check('选回「学生」后邀请码输入框消失', (await page.$('#account-teacher-code')) === null);

  // 选老师但不填邀请码 → 提交按钮必须禁用
  await teacherBtn.click();
  await page.waitForSelector('#account-teacher-code', { timeout: 8000 });
  await page.fill('#account-username', `ui_probe_${suffix}`);
  await page.fill('#account-password', PASSWORD);
  await page.waitForTimeout(200);
  const disabled = await (await page.$('.user-data-primary-btn-block')).getAttribute('disabled');
  check('老师身份没填邀请码时不能提交注册', disabled !== null, `disabled=${disabled}`);

  /* ---------- 2. 学生账号 ---------- */
  console.log('\n[2] 学生账号面板');
  await register(page, STUDENT_USER, 'student');
  const stuName = await textOf(page, '.user-data-sync-state');
  check('学生登录后显示身份为「学生」', (stuName || '').includes('学生'), stuName || '');
  const stuStatus = await textOf(page, '.user-data-sync-time');
  check('学生显示「还没加入班级」', (stuStatus || '').includes('还没加入班级'), stuStatus || '');
  check(
    '学生不再看到「还没进班级」这种看不懂的说法',
    !(stuStatus || '').includes('还没进班级'),
    stuStatus || '',
  );
  const stuBtnCount = await page.$$eval('.user-data-ghost-btn', (els) =>
    els.filter((e) => e.textContent.includes('创建班级')).length,
  );
  check('学生面板里没有「创建班级」按钮', stuBtnCount === 0, `找到 ${stuBtnCount} 个`);
  const panelText = await textOf(page, '.user-data-panel');
  check(
    '学生面板全文里都不出现「创建班级」',
    !(panelText || '').includes('创建班级'),
    (panelText || '').slice(0, 120),
  );
  const hint = await textOf(page, '.user-data-hint');
  check('学生看到「向老师要班级码」的说明', (hint || '').includes('班级码'), hint || '');
  check('学生看得到输入班级码的输入框', (await page.$('#join-code-input')) !== null);

  /* ---------- 3. 老师账号 ---------- */
  console.log('\n[3] 老师账号面板');
  const ctx2 = await browser.newContext({ viewport: { width: 1440, height: 960 } });
  const p2 = await ctx2.newPage();
  p2.on('pageerror', (e) => errors.push(String(e)));
  await register(p2, TEACHER_USER, 'teacher', TEACHER_CODE);
  const teaName = await textOf(p2, '.user-data-sync-state');
  check('老师登录后显示身份为「老师」', (teaName || '').includes('老师'), teaName || '');
  const teaStatus = await textOf(p2, '.user-data-sync-time');
  check('老师显示「还没建班级」', (teaStatus || '').includes('还没建班级'), teaStatus || '');
  const teaHint = await textOf(p2, '.user-data-hint');
  check('老师看到「建班把班级码发给学生」的说明', (teaHint || '').includes('班级码'), teaHint || '');
  const teaBtnCount = await p2.$$eval('.user-data-ghost-btn', (els) =>
    els.filter((e) => e.textContent.includes('创建班级')).length,
  );
  check('老师面板里有「创建班级」按钮', teaBtnCount === 1, `找到 ${teaBtnCount} 个`);

  /* ---------- 4. 老师建班 → 学生加入 ---------- */
  console.log('\n[4] 老师建班 + 学生加入');
  await p2.click('.user-data-ghost-btn:has-text("创建班级")');
  await p2.waitForSelector('.user-data-modal input', { timeout: 10000 });
  await p2.fill('.user-data-modal input', `UI 测试班 ${suffix}`);
  await p2.click('.user-data-modal-actions .user-data-primary-btn');
  await p2.waitForSelector('.user-data-joincode-value', { timeout: 20000 });
  const codeText = await textOf(p2, '.user-data-joincode-value');
  const joinCode = (codeText || '').replace(/[^A-Za-z0-9]/g, '');
  check('老师建班后拿到班级码', joinCode.length >= 4, codeText || '');
  const teaStatus2 = await waitForStatus(p2, '已加入');
  check('建班后老师状态变成「已加入」', (teaStatus2 || '').includes('已加入'), teaStatus2 || '');

  await page.fill('#join-code-input', joinCode);
  await page.click('.user-data-code-btn');
  const stuStatus2 = await waitForStatus(page, '已加入');
  check('学生用班级码加入成功', (stuStatus2 || '').includes('已加入'), stuStatus2 || '');

  check('全程没有 JS 报错', errors.length === 0, errors.join(' | '));

  await browser.close();
  console.log(`\n${passed} 通过 / ${failed} 失败`);
  if (failed > 0) {
    console.error('\n失败项：\n' + failures.map((f) => '  - ' + f).join('\n'));
    process.exit(1);
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
