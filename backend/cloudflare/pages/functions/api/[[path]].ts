/**
 * 48 音标小铺 · 后端 API（Cloudflare Pages Functions + D1）
 *
 * 账号体系：用户名 + 密码（PBKDF2-SHA256），会话令牌，班级码加入，老师看板。
 *
 * 接口：
 *   GET  /api/health              → { ok: true }
 *   POST /api/auth/register       → { token, account, membership }
 *   POST /api/auth/login          → { token, account, membership }
 *   POST /api/auth/logout         → { ok: true }
 *   POST /api/auth/password       → { ok: true }（自己改密码）
 *   POST /api/member/reset-password → { tempPassword }（老师重置学生密码）
 *   GET  /api/me                  → { account, membership }
 *   GET  /api/state               → { version, state, updatedAt }（登录用户自己的）
 *   PUT  /api/state               → { ok: true, updatedAt }（覆盖写入 + 冗余统计）
 *   POST /api/class/create        → { spaceId, name, joinCode }
 *   GET  /api/class/overview      → { space, members }（仅班级所有者）
 *   POST /api/member/remove       → { ok: true }（仅班级所有者）
 *   POST /api/class/revoke        → { ok: true }（仅班级所有者）
 *
 * 兼容期：旧同步码机制仍走 x-phonics-key 头 + phonics_user_state 表。
 *
 * 注意：这里的密码哈希 / 令牌 / 班级码算法必须与
 * src/services/backend/account-client.ts 保持一致（那份是浏览器侧副本）。
 */

interface Env {
  DB: D1Database;
  /**
   * 教师邀请码（Pages secret，不进前端包）。
   * 注册时选「老师」必须填对；没配置时任何人都注册不了老师账号。
   */
  TEACHER_INVITE_CODE?: string;
}

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, PUT, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'content-type, x-phonics-key, x-phonics-token',
  'Access-Control-Max-Age': '86400',
};

const PBKDF2_ITERATIONS = 20000;
const PBKDF2_BITS = 256;
const SALT_BYTES = 16;
const TOKEN_BYTES = 32;

const WEAK_CODES = new Set([
  '0000',
  '1111',
  '2222',
  '3333',
  '4444',
  '5555',
  '6666',
  '7777',
  '8888',
  '9999',
  'AAAA',
  'BBBB',
  'CCCC',
  'DDDD',
  'EEEE',
  'FFFF',
  'ADMIN',
  'TEST',
  'ROOT',
  'USER',
  'GUEST',
  'CLASS',
  'TEACH',
]);

export interface AccountRow {
  account_id: string;
  username: string;
  password_hash: string;
  salt: string;
  display_name: string;
  /** 账号身份：teacher（老师）/ student（学生）；老库没有这列时按 student 处理 */
  role?: string;
  created_at: string;
}

/** 账号身份（跟班级里的 owner/student 不是一回事，是账号级权限） */
export type AccountKind = 'teacher' | 'student';

export function accountKind(row: AccountRow): AccountKind {
  return row.role === 'teacher' ? 'teacher' : 'student';
}

/**
 * 账号能不能建班（纯函数，体检器直接跑它）
 *
 * 学生不能建班 —— 前端不给入口，后端也兜死。
 */
export function canCreateClass(account: AccountRow): boolean {
  return accountKind(account) === 'teacher';
}

/**
 * 注册时的身份判定（纯函数，体检器直接跑它）
 *
 * - 学生：不需要任何码，直接注册；
 * - 老师：必须带上和部署方配置一致的教师邀请码。
 */
export function resolveRegisterRole(
  rawRole: string,
  teacherCode: string,
  configuredCode: string | undefined,
): { ok: true; role: AccountKind } | { ok: false; status: number; message: string } {
  const wanted = rawRole.trim().toLowerCase();
  if (wanted !== 'teacher') {
    return { ok: true, role: 'student' };
  }
  const expected = (configuredCode ?? '').trim();
  if (!expected) {
    return { ok: false, status: 503, message: '服务端还没配置教师邀请码，现在注册不了老师账号' };
  }
  if (teacherCode.trim().toUpperCase() !== expected.toUpperCase()) {
    return { ok: false, status: 403, message: '教师邀请码不对，问一下要建班的老师' };
  }
  return { ok: true, role: 'teacher' };
}

/** 账号对外暴露的字段（三个接口共用，保证前端拿到的身份一致） */
export function accountPayload(row: AccountRow): {
  username: string;
  displayName: string;
  role: AccountKind;
} {
  return {
    username: row.username,
    displayName: row.display_name || row.username,
    role: accountKind(row),
  };
}

interface SessionRow {
  token_hash: string;
  account_id: string;
}

interface SpaceRow {
  space_id: string;
  kind: string;
  join_code: string | null;
  name: string;
  owner_account_id: string | null;
  created_at: string;
  revoked_at: string | null;
}

interface MemberRow {
  account_id: string;
  space_id: string;
  role: string;
  name: string;
  stats_json: string;
  created_at: string;
  last_seen_at: string | null;
  revoked_at: string | null;
}

/* ---------- 基础工具 ---------- */

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json; charset=utf-8' },
  });
}

function fail(message: string, status = 400, code?: string): Response {
  return json({ error: message, code: code ?? 'error' }, status);
}

function nowIso(): string {
  return new Date().toISOString();
}

function randomHex(bytes: number): string {
  const buffer = new Uint8Array(bytes);
  crypto.getRandomValues(buffer);
  return Array.from(buffer)
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

function toHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

function fromHex(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i += 1) {
    bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

function toBase64Url(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/* ---------- 账号 / 密码 / 令牌 ---------- */

function normalizeUsername(raw: string): string {
  return raw.trim().replace(/\s+/g, '').toLowerCase();
}

function validateUsername(username: string): boolean {
  if (!username) {
    return false;
  }
  const length = Array.from(username).length;
  if (length < 2 || length > 20) {
    return false;
  }
  // 大小写都允许（存储时统一转小写），但不含任何空白
  return /^[A-Za-z0-9_\u4e00-\u9fa5]+$/.test(username);
}

function validatePassword(password: string): boolean {
  return password.length >= 6 && password.length <= 200;
}

async function makeSalt(): Promise<string> {
  const buffer = new Uint8Array(SALT_BYTES);
  crypto.getRandomValues(buffer);
  return toHex(buffer.buffer);
}

async function hashPassword(password: string, salt: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveBits'],
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: fromHex(salt) as unknown as BufferSource,
      iterations: PBKDF2_ITERATIONS,
      hash: 'SHA-256',
    },
    key,
    PBKDF2_BITS,
  );
  return toHex(bits);
}

async function verifyPassword(
  password: string,
  salt: string,
  expectedHash: string,
): Promise<boolean> {
  const actual = await hashPassword(password, salt);
  if (actual.length !== expectedHash.length) {
    return false;
  }
  let diff = 0;
  for (let i = 0; i < actual.length; i += 1) {
    diff |= actual.charCodeAt(i) ^ expectedHash.charCodeAt(i);
  }
  return diff === 0;
}

function generateToken(): string {
  const buffer = new Uint8Array(TOKEN_BYTES);
  crypto.getRandomValues(buffer);
  return toBase64Url(buffer.buffer);
}

async function hashToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  return toHex(digest);
}

/* ---------- 班级码 ---------- */

function normalizeJoinCode(raw: string): string {
  return raw.replace(/[^a-z0-9]/gi, '').toUpperCase();
}

function isValidJoinCode(code: string): boolean {
  return /^[A-Z0-9]{4,12}$/.test(code);
}

function randomJoinCode(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const buffer = new Uint8Array(8);
    crypto.getRandomValues(buffer);
    let code = '';
    buffer.forEach((byte) => {
      code += alphabet[byte % alphabet.length];
    });
    if (WEAK_CODES.has(code)) {
      continue;
    }
    if (new Set(code.split('')).size < 4) {
      continue;
    }
    return code;
  }
  return `C${randomHex(6).toUpperCase()}`;
}

/* ---------- 会话 ---------- */

interface AuthContext {
  account: AccountRow;
  membership: MemberRow | null;
  space: SpaceRow | null;
}

async function readToken(request: Request): Promise<string> {
  const header = request.headers.get('x-phonics-token');
  if (header && header.trim()) {
    return header.trim();
  }
  const auth = request.headers.get('authorization');
  if (auth && auth.toLowerCase().startsWith('bearer ')) {
    return auth.slice(7).trim();
  }
  return '';
}

async function requireAuth(request: Request, env: Env): Promise<AuthContext | null> {
  const token = await readToken(request);
  if (!token) {
    return null;
  }
  const tokenHash = await hashToken(token);
  const session = await env.DB.prepare(
    'SELECT token_hash, account_id FROM phonics_sessions WHERE token_hash = ?',
  )
    .bind(tokenHash)
    .first<SessionRow>();
  if (!session) {
    return null;
  }
  const account = await env.DB.prepare(
    'SELECT * FROM phonics_accounts WHERE account_id = ?',
  )
    .bind(session.account_id)
    .first<AccountRow>();
  if (!account) {
    return null;
  }
  const membership = await env.DB.prepare(
    'SELECT * FROM phonics_members WHERE account_id = ?',
  )
    .bind(account.account_id)
    .first<MemberRow>();
  let space: SpaceRow | null = null;
  if (membership) {
    space = await env.DB.prepare('SELECT * FROM phonics_spaces WHERE space_id = ?')
      .bind(membership.space_id)
      .first<SpaceRow>();
  }
  return { account, membership, space };
}

function membershipPayload(membership: MemberRow | null, space: SpaceRow | null) {
  if (!membership || !space) {
    return null;
  }
  return {
    spaceId: space.space_id,
    spaceName: space.name,
    role: membership.role,
    joinCode: membership.role === 'owner' && space.join_code ? space.join_code : null,
    memberName: membership.name,
    revoked: Boolean(membership.revoked_at),
    spaceRevoked: Boolean(space.revoked_at),
  };
}

async function createSession(env: Env, accountId: string): Promise<string> {
  const token = generateToken();
  const tokenHash = await hashToken(token);
  await env.DB.prepare(
    'INSERT INTO phonics_sessions (token_hash, account_id, created_at) VALUES (?, ?, ?)',
  )
    .bind(tokenHash, accountId, nowIso())
    .run();
  return token;
}

async function dropSessions(env: Env, accountId: string): Promise<void> {
  await env.DB.prepare('DELETE FROM phonics_sessions WHERE account_id = ?').bind(accountId).run();
}

/* ---------- 注册 / 登录 ---------- */

async function readJson(request: Request): Promise<Record<string, unknown>> {
  try {
    const raw = await request.text();
    if (!raw) {
      return {};
    }
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

async function handleRegister(request: Request, env: Env): Promise<Response> {
  const body = await readJson(request);
  const rawUsername = String(body.username ?? '');
  const password = String(body.password ?? '');
  const displayName = String(body.displayName ?? '').trim().slice(0, 24);
  const rawJoinCode = String(body.joinCode ?? '').trim();

  // 账号身份：学生随便注册；老师必须拿着教师邀请码
  const roleResult = resolveRegisterRole(
    String(body.role ?? ''),
    String(body.teacherCode ?? ''),
    env.TEACHER_INVITE_CODE,
  );
  if (!roleResult.ok) {
    return fail(roleResult.message, roleResult.status);
  }
  const accountRole: AccountKind = roleResult.role;

  // 校验用原始输入（含空白即非法），存储用规范化形式（小写），
  // 这样 "Teacher01" 与 "teacher01" 是同一个账号
  const trimmed = rawUsername.trim();
  if (!validateUsername(trimmed)) {
    return fail('用户名要 2–20 位，字母、数字、下划线或中文', 400);
  }
  if (!validatePassword(password)) {
    return fail('密码至少 6 位', 400);
  }
  const username = normalizeUsername(rawUsername);
  const exists = await env.DB.prepare('SELECT account_id FROM phonics_accounts WHERE username = ?')
    .bind(username)
    .first<{ account_id: string }>();
  if (exists) {
    return fail('这个用户名已经有人用了，换一个', 409);
  }

  const accountId = `ac_${randomHex(12)}`;
  const salt = await makeSalt();
  const passwordHash = await hashPassword(password, salt);
  const createdAt = nowIso();

  await env.DB.prepare(
    `INSERT INTO phonics_accounts (account_id, username, password_hash, salt, display_name, role, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      accountId,
      username,
      passwordHash,
      salt,
      displayName || username,
      accountRole,
      createdAt,
    )
    .run();

  let membership: MemberRow | null = null;
  let space: SpaceRow | null = null;
  if (rawJoinCode) {
    const code = normalizeJoinCode(rawJoinCode);
    if (!isValidJoinCode(code)) {
      return fail('班级码格式不对', 400);
    }
    space = await env.DB.prepare('SELECT * FROM phonics_spaces WHERE join_code = ?')
      .bind(code)
      .first<SpaceRow>();
    if (!space) {
      return fail('班级码不存在，检查一下有没有输错', 404);
    }
    if (space.revoked_at) {
      return fail('这个班级已经被撤销了', 403);
    }
    const current = await env.DB.prepare('SELECT * FROM phonics_members WHERE account_id = ?')
      .bind(accountId)
      .first<MemberRow>();
    if (current && !current.revoked_at) {
      return fail('你已经在一个班级里了', 409);
    }
    if (current) {
      await env.DB.prepare('DELETE FROM phonics_members WHERE account_id = ?').bind(accountId).run();
    }
    await env.DB.prepare(
      `INSERT INTO phonics_members (account_id, space_id, role, name, stats_json, created_at, last_seen_at, revoked_at)
       VALUES (?, ?, 'student', ?, '{}', ?, NULL, NULL)`,
    )
      .bind(accountId, space.space_id, displayName || username, createdAt)
      .run();
    membership = await env.DB.prepare('SELECT * FROM phonics_members WHERE account_id = ?')
      .bind(accountId)
      .first<MemberRow>();
  }

  const token = await createSession(env, accountId);
  return json({
    token,
    account: { username, displayName: displayName || username, role: accountRole },
    membership: membershipPayload(membership, space),
  });
}

async function handleLogin(request: Request, env: Env): Promise<Response> {
  const body = await readJson(request);
  const username = normalizeUsername(String(body.username ?? ''));
  const password = String(body.password ?? '');

  const account = await env.DB.prepare('SELECT * FROM phonics_accounts WHERE username = ?')
    .bind(username)
    .first<AccountRow>();
  if (!account) {
    return fail('用户名或密码不对', 401);
  }
  const ok = await verifyPassword(password, account.salt, account.password_hash);
  if (!ok) {
    return fail('用户名或密码不对', 401);
  }

  const membership = await env.DB.prepare('SELECT * FROM phonics_members WHERE account_id = ?')
    .bind(account.account_id)
    .first<MemberRow>();
  let space: SpaceRow | null = null;
  if (membership) {
    space = await env.DB.prepare('SELECT * FROM phonics_spaces WHERE space_id = ?')
      .bind(membership.space_id)
      .first<SpaceRow>();
  }
  const token = await createSession(env, account.account_id);
  return json({
    token,
    account: accountPayload(account),
    membership: membershipPayload(membership, space),
  });
}

async function handleLogout(request: Request, env: Env): Promise<Response> {
  const token = await readToken(request);
  if (token) {
    const tokenHash = await hashToken(token);
    await env.DB.prepare('DELETE FROM phonics_sessions WHERE token_hash = ?').bind(tokenHash).run();
  }
  return json({ ok: true });
}

async function handleChangePassword(request: Request, env: Env): Promise<Response> {
  const auth = await requireAuth(request, env);
  if (!auth) {
    return fail('请先登录', 401);
  }
  const body = await readJson(request);
  const oldPassword = String(body.oldPassword ?? '');
  const newPassword = String(body.newPassword ?? '');
  if (!validatePassword(newPassword)) {
    return fail('新密码至少 6 位', 400);
  }
  const ok = await verifyPassword(oldPassword, auth.account.salt, auth.account.password_hash);
  if (!ok) {
    return fail('原密码不对', 401);
  }
  const salt = await makeSalt();
  const passwordHash = await hashPassword(newPassword, salt);
  await env.DB.prepare('UPDATE phonics_accounts SET password_hash = ?, salt = ? WHERE account_id = ?')
    .bind(passwordHash, salt, auth.account.account_id)
    .run();
  return json({ ok: true });
}

/* ---------- 班级 / 成员 ---------- */

async function handleCreateClass(request: Request, env: Env): Promise<Response> {
  const auth = await requireAuth(request, env);
  if (!auth) {
    return fail('请先登录', 401);
  }
  // 权限在服务端兜死：学生账号不能建班（前端只是不给入口）
  if (!canCreateClass(auth.account)) {
    return fail('只有老师才能创建班级，向老师要一个班级码就能加入', 403);
  }
  const body = await readJson(request);
  const name = String(body.name ?? '').trim().slice(0, 40) || '我的班级';

  const current = await env.DB.prepare('SELECT * FROM phonics_members WHERE account_id = ?')
    .bind(auth.account.account_id)
    .first<MemberRow>();
  if (current && !current.revoked_at) {
    return fail('你已经在一个班级里了，先退出再建', 409);
  }
  if (current) {
    await env.DB.prepare('DELETE FROM phonics_members WHERE account_id = ?')
      .bind(auth.account.account_id)
      .run();
  }

  const spaceId = `sp_${randomHex(12)}`;
  const createdAt = nowIso();
  let joinCode = randomJoinCode();
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const taken = await env.DB.prepare('SELECT space_id FROM phonics_spaces WHERE join_code = ?')
      .bind(joinCode)
      .first<{ space_id: string }>();
    if (!taken) {
      break;
    }
    joinCode = randomJoinCode();
  }

  await env.DB.prepare(
    `INSERT INTO phonics_spaces (space_id, kind, join_code, name, owner_account_id, created_at, revoked_at)
     VALUES (?, 'class', ?, ?, ?, ?, NULL)`,
  )
    .bind(spaceId, joinCode, name, auth.account.account_id, createdAt)
    .run();

  await env.DB.prepare(
    `INSERT INTO phonics_members (account_id, space_id, role, name, stats_json, created_at, last_seen_at, revoked_at)
     VALUES (?, ?, 'owner', ?, '{}', ?, NULL, NULL)`,
  )
    .bind(auth.account.account_id, spaceId, auth.account.display_name || auth.account.username, createdAt)
    .run();

  return json({ spaceId, name, joinCode });
}

async function handleJoinClass(request: Request, env: Env): Promise<Response> {
  const auth = await requireAuth(request, env);
  if (!auth) {
    return fail('请先登录', 401);
  }
  const body = await readJson(request);
  const code = normalizeJoinCode(String(body.joinCode ?? ''));
  if (!isValidJoinCode(code)) {
    return fail('班级码格式不对', 400);
  }
  const space = await env.DB.prepare('SELECT * FROM phonics_spaces WHERE join_code = ?')
    .bind(code)
    .first<SpaceRow>();
  if (!space) {
    return fail('班级码不存在，检查一下有没有输错', 404);
  }
  if (space.revoked_at) {
    return fail('这个班级已经被撤销了', 403);
  }
  const current = await env.DB.prepare('SELECT * FROM phonics_members WHERE account_id = ?')
    .bind(auth.account.account_id)
    .first<MemberRow>();
  if (current && !current.revoked_at) {
    if (current.space_id === space.space_id) {
      return fail('你已经在这个班级里了', 409);
    }
    return fail('你已经在一个班级里了，先退出再换班', 409);
  }
  if (current) {
    await env.DB.prepare('DELETE FROM phonics_members WHERE account_id = ?')
      .bind(auth.account.account_id)
      .run();
  }
  await env.DB.prepare(
    `INSERT INTO phonics_members (account_id, space_id, role, name, stats_json, created_at, last_seen_at, revoked_at)
     VALUES (?, ?, 'student', ?, '{}', ?, NULL, NULL)`,
  )
    .bind(
      auth.account.account_id,
      space.space_id,
      auth.account.display_name || auth.account.username,
      nowIso(),
    )
    .run();
  return json({
    spaceId: space.space_id,
    spaceName: space.name,
    role: 'student',
  });
}

async function handleClassOverview(request: Request, env: Env): Promise<Response> {
  const auth = await requireAuth(request, env);
  if (!auth) {
    return fail('请先登录', 401);
  }
  if (!auth.membership || !auth.space) {
    return fail('你还没有班级', 403);
  }
  if (auth.membership.role !== 'owner' || auth.space.owner_account_id !== auth.account.account_id) {
    return fail('只有班级老师能看看板', 403);
  }
  if (auth.space.revoked_at) {
    return fail('这个班级已经被撤销了', 403);
  }

  const result = await env.DB.prepare(
    `SELECT m.account_id, m.name AS display_name, a.username, m.role, m.stats_json,
            m.created_at, m.last_seen_at, m.revoked_at
       FROM phonics_members m
       LEFT JOIN phonics_accounts a ON a.account_id = m.account_id
      WHERE m.space_id = ? ORDER BY m.created_at ASC LIMIT 200`,
  )
    .bind(auth.space.space_id)
    .all<{
      account_id: string;
      display_name: string;
      username: string | null;
      role: string;
      stats_json: string;
      created_at: string;
      last_seen_at: string | null;
      revoked_at: string | null;
    }>();

  const members = (result.results ?? []).map((row) => {
    let stats: Record<string, number> = {};
    try {
      stats = JSON.parse(row.stats_json || '{}') as Record<string, number>;
    } catch {
      stats = {};
    }
    return {
      accountId: row.account_id,
      username: row.username || row.account_id,
      name: row.display_name || row.username || row.account_id,
      role: row.role,
      completed: stats.completed ?? 0,
      learned: stats.learned ?? 0,
      checkedDays: stats.checkedDays ?? 0,
      totalAnswered: stats.totalAnswered ?? 0,
      totalCorrect: stats.totalCorrect ?? 0,
      accuracy: stats.accuracy ?? 0,
      lastSeenAt: row.last_seen_at,
      createdAt: row.created_at,
      revoked: Boolean(row.revoked_at),
    };
  });

  return json({
    space: {
      id: auth.space.space_id,
      name: auth.space.name || '未命名班级',
      joinCode: auth.space.join_code,
      createdAt: auth.space.created_at,
    },
    members,
  });
}

async function handleRemoveMember(request: Request, env: Env): Promise<Response> {
  const auth = await requireAuth(request, env);
  if (!auth) {
    return fail('请先登录', 401);
  }
  if (!auth.membership || !auth.space || auth.membership.role !== 'owner') {
    return fail('只有班级老师能移出成员', 403);
  }
  const body = await readJson(request);
  const accountId = String(body.accountId ?? '').trim();
  if (!accountId) {
    return fail('没指定要移出谁', 400);
  }
  if (accountId === auth.account.account_id) {
    return fail('不能移出自己', 400);
  }
  const target = await env.DB.prepare('SELECT * FROM phonics_members WHERE account_id = ?')
    .bind(accountId)
    .first<MemberRow>();
  if (!target || target.space_id !== auth.space.space_id) {
    return fail('这个成员不在你的班级里', 404);
  }
  if (target.revoked_at) {
    return json({ ok: true });
  }
  await env.DB.prepare('UPDATE phonics_members SET revoked_at = ? WHERE account_id = ?')
    .bind(nowIso(), accountId)
    .run();
  return json({ ok: true });
}

async function handleResetPassword(request: Request, env: Env): Promise<Response> {
  const auth = await requireAuth(request, env);
  if (!auth) {
    return fail('请先登录', 401);
  }
  if (!auth.membership || !auth.space || auth.membership.role !== 'owner') {
    return fail('只有班级老师能重置密码', 403);
  }
  const body = await readJson(request);
  const accountId = String(body.accountId ?? '').trim();
  const target = await env.DB.prepare('SELECT * FROM phonics_members WHERE account_id = ?')
    .bind(accountId)
    .first<MemberRow>();
  if (!target || target.space_id !== auth.space.space_id) {
    return fail('这个成员不在你的班级里', 404);
  }
  const tempPassword = `ph${randomHex(3).toUpperCase()}${randomHex(2).toUpperCase()}`;
  const salt = await makeSalt();
  const passwordHash = await hashPassword(tempPassword, salt);
  await env.DB.prepare('UPDATE phonics_accounts SET password_hash = ?, salt = ? WHERE account_id = ?')
    .bind(passwordHash, salt, accountId)
    .run();
  await dropSessions(env, accountId);
  return json({ ok: true, tempPassword });
}

async function handleRevokeClass(request: Request, env: Env): Promise<Response> {
  const auth = await requireAuth(request, env);
  if (!auth) {
    return fail('请先登录', 401);
  }
  if (!auth.membership || !auth.space || auth.membership.role !== 'owner') {
    return fail('只有班级老师能撤销班级', 403);
  }
  if (auth.space.revoked_at) {
    return json({ ok: true });
  }
  const revokedAt = nowIso();
  await env.DB.prepare('UPDATE phonics_spaces SET revoked_at = ? WHERE space_id = ?')
    .bind(revokedAt, auth.space.space_id)
    .run();
  await env.DB.prepare(
    'UPDATE phonics_members SET revoked_at = ? WHERE space_id = ? AND revoked_at IS NULL',
  )
    .bind(revokedAt, auth.space.space_id)
    .run();
  return json({ ok: true });
}

/**
 * 退出当前班级：
 * - 学生：只删掉自己的成员行，云端进度保留（下次用同一个账号登录还能拉回来）
 * - 老师：等于撤销整个班级（班级一旦撤销就找不回来了）
 */
async function handleLeaveClass(request: Request, env: Env): Promise<Response> {
  const auth = await requireAuth(request, env);
  if (!auth) {
    return fail('请先登录', 401);
  }
  if (!auth.membership || !auth.space) {
    return fail('你还没有加入任何班级', 403);
  }
  if (auth.membership.revoked_at) {
    return fail('你已经被移出这个班级了', 403, 'revoked');
  }
  if (auth.space.revoked_at) {
    return fail('这个班级已经被撤销了', 403, 'revoked');
  }
  if (auth.membership.role === 'owner') {
    const revokedAt = nowIso();
    await env.DB.prepare('UPDATE phonics_spaces SET revoked_at = ? WHERE space_id = ?')
      .bind(revokedAt, auth.space.space_id)
      .run();
    await env.DB.prepare(
      'UPDATE phonics_members SET revoked_at = ? WHERE space_id = ? AND revoked_at IS NULL',
    )
      .bind(revokedAt, auth.space.space_id)
      .run();
    return json({ ok: true, revokedClass: true });
  }
  await env.DB.prepare('DELETE FROM phonics_members WHERE account_id = ?')
    .bind(auth.account.account_id)
    .run();
  return json({ ok: true, revokedClass: false });
}

/* ---------- 进度 ---------- */

async function handleMemberState(request: Request, env: Env): Promise<Response> {
  const auth = await requireAuth(request, env);
  if (!auth) {
    return fail('请先登录', 401);
  }
  if (!auth.membership || !auth.space) {
    // 还没进班级：读 = 没有云端状态（404），写 = 没有成员通道（403）
    if (request.method === 'GET') {
      return fail('你还没有加入任何班级', 404);
    }
    return fail('你还没有加入任何班级', 403);
  }
  if (auth.membership.revoked_at) {
    return fail('你已被移出这个班级，云端不再接收你的数据', 403, 'revoked');
  }
  if (auth.space.revoked_at) {
    return fail('这个班级已经被撤销了', 403, 'revoked');
  }

  const accountId = auth.account.account_id;
  const spaceId = auth.space.space_id;

  if (request.method === 'GET') {
    const row = await env.DB.prepare(
      'SELECT state, updated_at FROM phonics_member_state WHERE account_id = ? AND space_id = ?',
    )
      .bind(accountId, spaceId)
      .first<{ state: string; updated_at: string }>();
    if (!row) {
      return fail('还没有云端数据', 404);
    }
    return json({
      version: 2,
      state: JSON.parse(row.state) as unknown,
      updatedAt: row.updated_at,
    });
  }

  const body = await readJson(request);
  const state = body.state ?? {};
  const updatedAt = nowIso();
  await env.DB.prepare(
    `INSERT INTO phonics_member_state (account_id, space_id, state, updated_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(account_id, space_id) DO UPDATE SET state = excluded.state, updated_at = excluded.updated_at`,
  )
    .bind(accountId, spaceId, JSON.stringify(state), updatedAt)
    .run();

  const snapshot = (state ?? {}) as {
    phonemes?: Record<string, unknown>;
    checkedDays?: unknown;
    quizStats?: { totalAnswered?: number; totalCorrect?: number };
  };
  const phonemes = snapshot.phonemes ?? {};
  const learned = Object.values(phonemes).filter(
    (item) => (item as { completed?: boolean })?.completed,
  ).length;
  const checkedDays = Array.isArray(snapshot.checkedDays) ? snapshot.checkedDays.length : 0;
  const totalAnswered = snapshot.quizStats?.totalAnswered ?? 0;
  const totalCorrect = snapshot.quizStats?.totalCorrect ?? 0;
  const accuracy = totalAnswered > 0 ? Math.round((totalCorrect / totalAnswered) * 100) : 0;
  const statsJson = JSON.stringify({
    completed: learned,
    learned,
    checkedDays,
    totalAnswered,
    totalCorrect,
    accuracy,
  });

  await env.DB.prepare(
    'UPDATE phonics_members SET stats_json = ?, last_seen_at = ? WHERE account_id = ? AND space_id = ?',
  )
    .bind(statsJson, updatedAt, accountId, spaceId)
    .run();

  return json({ ok: true, updatedAt });
}

/* ---------- 旧同步码机制（兼容期） ---------- */

async function handleLegacyState(request: Request, env: Env): Promise<Response> {
  const userKey = (request.headers.get('x-phonics-key') ?? '').trim();
  if (!userKey) {
    return fail('缺少 x-phonics-key', 401);
  }
  if (request.method === 'GET') {
    const row = await env.DB.prepare(
      'SELECT state, updated_at FROM phonics_user_state WHERE user_key = ?',
    )
      .bind(userKey)
      .first<{ state: string; updated_at: string }>();
    if (!row) {
      return fail('还没有云端数据', 404);
    }
    return json({
      version: 1,
      userKey,
      state: JSON.parse(row.state) as unknown,
      updatedAt: row.updated_at,
    });
  }
  const body = await readJson(request);
  const state = body.state ?? {};
  const updatedAt = nowIso();
  await env.DB.prepare(
    `INSERT INTO phonics_user_state (user_key, state, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(user_key) DO UPDATE SET state = excluded.state, updated_at = excluded.updated_at`,
  )
    .bind(userKey, JSON.stringify(state), updatedAt)
    .run();
  return json({ ok: true, updatedAt });
}

/* ---------- 路由 ---------- */

export const onRequest: PagesFunction<Env> = async ({ request, env }) => {
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }
  // 注意：catch-all 路由下 context.path 可能是 undefined，一律从 request.url 解析
  let pathname = '/';
  try {
    pathname = new URL(request.url).pathname;
  } catch {
    pathname = '/';
  }
  const route = pathname.replace(/\/+$/, '') || '/';

  try {
    if (route === '/api/health' && request.method === 'GET') {
      return json({ ok: true });
    }
    if (route === '/api/auth/register' && request.method === 'POST') {
      return handleRegister(request, env);
    }
    if (route === '/api/auth/login' && request.method === 'POST') {
      return handleLogin(request, env);
    }
    if (route === '/api/auth/logout' && request.method === 'POST') {
      return handleLogout(request, env);
    }
    if (route === '/api/auth/password' && request.method === 'POST') {
      return handleChangePassword(request, env);
    }
    if (route === '/api/me' && request.method === 'GET') {
      const auth = await requireAuth(request, env);
      if (!auth) {
        return fail('请先登录', 401);
      }
      return json({
        account: accountPayload(auth.account),
        membership: membershipPayload(auth.membership, auth.space),
      });
    }
    if (route === '/api/state') {
      const hasToken = await readToken(request);
      if (hasToken) {
        return handleMemberState(request, env);
      }
      return handleLegacyState(request, env);
    }
    if (route === '/api/class/create' && request.method === 'POST') {
      return handleCreateClass(request, env);
    }
    if (route === '/api/member/join' && request.method === 'POST') {
      return handleJoinClass(request, env);
    }
    if (route === '/api/class/overview' && request.method === 'GET') {
      return handleClassOverview(request, env);
    }
    if (route === '/api/member/remove' && request.method === 'POST') {
      return handleRemoveMember(request, env);
    }
    if (route === '/api/member/reset-password' && request.method === 'POST') {
      return handleResetPassword(request, env);
    }
    if (route === '/api/class/revoke' && request.method === 'POST') {
      return handleRevokeClass(request, env);
    }
    if (route === '/api/class/leave' && request.method === 'POST') {
      return handleLeaveClass(request, env);
    }
    return fail('没有这个接口', 404);
  } catch (error) {
    const message = error instanceof Error ? error.message : '服务器开小差了';
    return fail(message, 500);
  }
};
