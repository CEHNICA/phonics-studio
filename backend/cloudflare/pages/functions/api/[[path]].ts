/**
 * Cloudflare Pages Function：音标小铺的状态后端 + 班级身份体系
 *
 * 与 backend/cloudflare/worker.ts 共用同一个 D1 库。
 * 之所以额外做一份 Pages Function：*.workers.dev 在中国大陆被 DNS 污染 + TLS 重置，
 * 国内用户根本访问不到；*.pages.dev 未被拦截，站点挂在 *.space.mcode.cn（国内），
 * 云同步接口必须放在国内可达的域名上。
 *
 * 身份模型（两段式 + 管理码）：
 * - 班级码 join_code：低熵入口码，任何人拿到都能加入班级，但成员之间数据互不可见；
 * - 恢复密钥 recovery_key：高熵个人密钥，换设备时用它找回自己的进度；
 * - 管理码 owner_key：高熵班级所有者密钥，用于打开看板、踢人、撤销班级。
 * 服务端只保存三类码的 SHA-256 哈希（带域分隔前缀），明文仅在创建/加入时返回一次。
 *
 * 接口：
 * - GET  /api/health         → { ok: true }
 * - GET  /api/state          → { version, userKey, state, updatedAt }（成员通道，404 表示还没数据）
 * - PUT  /api/state          → 覆盖写入整份状态，并冗余更新看板统计
 * - POST /api/space/create   → 创建班级 / 个人空间，返回班级码 + 管理码 + 恢复密钥
 * - POST /api/member/join    → 用班级码加入，返回本人恢复密钥
 * - POST /api/member/recover → 用恢复密钥找回本人身份与进度
 * - GET  /api/class/overview → 管理码查看班级看板
 * - POST /api/member/revoke  → 管理码移出某个成员
 * - POST /api/space/revoke   → 管理码撤销整个班级
 */

interface Env {
  DB: D1Database;
}

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'content-type, x-phonics-key, x-phonics-owner',
  'Access-Control-Allow-Methods': 'GET, PUT, POST, OPTIONS',
  'Access-Control-Max-Age': '86400',
};

const HASH_DOMAIN = {
  owner: 'ph-owner:',
  recovery: 'ph-rec:',
  device: 'ph-dev:',
};

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

const WEAK_JOIN_CODES = new Set([
  '1234',
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
  '123456',
  '654321',
  '111111',
  '000000',
  '12345678',
  '87654321',
  '112233',
  'ABCDEF',
  'QWERTY',
  'PASSWORD',
  'ADMIN',
]);

interface SpaceRow {
  space_id: string;
  kind: string;
  join_code: string;
  name: string;
  owner_hash: string;
  created_at: string;
  revoked_at: string | null;
}

interface MemberRow {
  member_id: string;
  space_id: string;
  role: string;
  recovery_hash: string;
  device_hash: string;
  name: string;
  stats_json: string;
  created_at: string;
  last_seen_at: string | null;
  revoked_at: string | null;
}

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json; charset=utf-8' },
  });
}

function fail(message: string, status: number, code = 'error'): Response {
  return json({ error: code, message }, status);
}

async function sha256Hex(text: string): Promise<string> {
  const data = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

function hashWith(domain: string, secret: string): Promise<string> {
  return sha256Hex(`${domain}${secret}`);
}

function randomHex(bytes: number): string {
  const buffer = new Uint8Array(bytes);
  crypto.getRandomValues(buffer);
  return Array.from(buffer, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function randomBase32(count: number): string {
  const buffer = new Uint8Array(count);
  crypto.getRandomValues(buffer);
  let out = '';
  for (const byte of buffer) {
    out += BASE32_ALPHABET[byte % 32];
  }
  return out;
}

function generateRecoveryKey(): string {
  return `PH-${randomBase32(20).replace(/(.{5})(?=.)/g, '$1-')}`;
}

function generateOwnerKey(): string {
  return `OW-${randomBase32(20).replace(/(.{5})(?=.)/g, '$1-')}`;
}

function normalizeJoinCode(raw: string): string {
  return String(raw ?? '')
    .trim()
    .replace(/[\s-]+/g, '')
    .toUpperCase();
}

function isValidJoinCode(code: string): boolean {
  if (!/^[A-Z0-9]{4,12}$/.test(code)) {
    return false;
  }
  if (WEAK_JOIN_CODES.has(code)) {
    return false;
  }
  if (/^(\d)\1+$/.test(code)) {
    return false;
  }
  return true;
}

function nowIso(): string {
  return new Date().toISOString();
}

/**
 * 从学习状态里抽出看板需要的冗余统计（服务端算好，看板只读这一列）
 */
function computeStats(state: unknown): Record<string, number> {
  const source = (state ?? {}) as {
    phonemes?: Record<string, { completed?: boolean }>;
    checkedDays?: unknown[];
    quizStats?: { totalAnswered?: number; totalCorrect?: number };
  };
  const phonemes = source.phonemes ?? {};
  let completed = 0;
  let learned = 0;
  for (const record of Object.values(phonemes)) {
    learned += 1;
    if (record?.completed) {
      completed += 1;
    }
  }
  const totalAnswered = source.quizStats?.totalAnswered ?? 0;
  const totalCorrect = source.quizStats?.totalCorrect ?? 0;
  const accuracy = totalAnswered > 0 ? Math.round((totalCorrect / totalAnswered) * 100) : 0;
  return {
    completed,
    learned,
    checkedDays: Array.isArray(source.checkedDays) ? source.checkedDays.length : 0,
    totalAnswered,
    totalCorrect,
    accuracy,
  };
}

async function readJson(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const parsed = (await request.json()) as Record<string, unknown>;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return null;
  }
}

/**
 * 按管理码找到它拥有的空间；找不到 / 已撤销都返回 null
 */
async function findSpaceByOwnerKey(env: Env, ownerKey: string): Promise<SpaceRow | null> {
  if (!ownerKey) {
    return null;
  }
  const ownerHash = await hashWith(HASH_DOMAIN.owner, ownerKey.trim().toUpperCase());
  const space = await env.DB.prepare('SELECT * FROM phonics_spaces WHERE owner_hash = ?')
    .bind(ownerHash)
    .first<SpaceRow>();
  if (!space || space.revoked_at) {
    return null;
  }
  return space;
}

async function handleCreateSpace(request: Request, env: Env): Promise<Response> {
  const body = await readJson(request);
  if (!body) {
    return fail('请求格式不对', 400);
  }
  const kind = body.kind === 'personal' ? 'personal' : 'class';
  const name = String(body.name ?? '').trim().slice(0, 40);
  const deviceHash = String(body.deviceHash ?? '').slice(0, 128);

  let joinCode = normalizeJoinCode(String(body.joinCode ?? ''));
  if (joinCode) {
    if (!isValidJoinCode(joinCode)) {
      return fail('班级码得是 4–12 位字母或数字，且不能是 1234 这类弱码', 400);
    }
    const existing = await env.DB.prepare('SELECT space_id FROM phonics_spaces WHERE join_code = ?')
      .bind(joinCode)
      .first<{ space_id: string }>();
    if (existing) {
      return fail('这个班级码已被占用，换一个', 409);
    }
  } else {
    // 没指定班级码就自动生成一个短码
    for (let attempt = 0; attempt < 12; attempt += 1) {
      const candidate = randomBase32(8);
      const taken = await env.DB.prepare('SELECT space_id FROM phonics_spaces WHERE join_code = ?')
        .bind(candidate)
        .first<{ space_id: string }>();
      if (!taken) {
        joinCode = candidate;
        break;
      }
    }
    if (!joinCode) {
      return fail('班级码生成失败，请重试', 500);
    }
  }

  const spaceId = `sp_${randomHex(12)}`;
  const ownerKey = generateOwnerKey();
  const ownerHash = await hashWith(HASH_DOMAIN.owner, ownerKey);
  const createdAt = nowIso();

  await env.DB.prepare(
    `INSERT INTO phonics_spaces (space_id, kind, join_code, name, owner_hash, created_at, revoked_at)
     VALUES (?, ?, ?, ?, ?, ?, NULL)`,
  )
    .bind(spaceId, kind, joinCode, name, ownerHash, createdAt)
    .run();

  // 创建者同时是班级里的一个成员（可以自己学，也出现在看板上）
  const memberId = `mb_${randomHex(12)}`;
  const recoveryKey = generateRecoveryKey();
  const recoveryHash = await hashWith(HASH_DOMAIN.recovery, recoveryKey);

  await env.DB.prepare(
    `INSERT INTO phonics_members
       (member_id, space_id, role, recovery_hash, device_hash, name, stats_json, created_at, last_seen_at, revoked_at)
     VALUES (?, ?, 'owner', ?, ?, ?, '{}', ?, NULL, NULL)`,
  )
    .bind(memberId, spaceId, recoveryHash, deviceHash, name, createdAt)
    .run();

  return json({
    ok: true,
    spaceId,
    spaceName: name,
    kind,
    joinCode,
    ownerKey,
    memberId,
    recoveryKey,
    role: 'owner',
  });
}

async function handleJoinSpace(request: Request, env: Env): Promise<Response> {
  const body = await readJson(request);
  if (!body) {
    return fail('请求格式不对', 400);
  }
  const joinCode = normalizeJoinCode(String(body.joinCode ?? ''));
  if (!joinCode) {
    return fail('请先填写班级码', 400);
  }

  const space = await env.DB.prepare('SELECT * FROM phonics_spaces WHERE join_code = ?')
    .bind(joinCode)
    .first<SpaceRow>();
  if (!space) {
    return fail('班级码不存在，检查一下有没有输错', 404);
  }
  if (space.revoked_at) {
    return fail('这个班级已经被撤销了', 403);
  }
  if (space.kind === 'personal') {
    return fail('这是个人空间，不能用班级码加入', 403);
  }

  const memberId = `mb_${randomHex(12)}`;
  const recoveryKey = generateRecoveryKey();
  const recoveryHash = await hashWith(HASH_DOMAIN.recovery, recoveryKey);
  const deviceHash = String(body.deviceHash ?? '').slice(0, 128);
  const name = String(body.name ?? '').trim().slice(0, 40);
  const createdAt = nowIso();

  await env.DB.prepare(
    `INSERT INTO phonics_members
       (member_id, space_id, role, recovery_hash, device_hash, name, stats_json, created_at, last_seen_at, revoked_at)
     VALUES (?, ?, 'student', ?, ?, ?, '{}', ?, NULL, NULL)`,
  )
    .bind(memberId, space.space_id, recoveryHash, deviceHash, name, createdAt)
    .run();

  return json({
    ok: true,
    memberId,
    spaceId: space.space_id,
    spaceName: space.name,
    kind: space.kind,
    recoveryKey,
    role: 'student',
  });
}

async function handleRecoverMember(request: Request, env: Env): Promise<Response> {
  const body = await readJson(request);
  if (!body) {
    return fail('请求格式不对', 400);
  }
  const recoveryKey = String(body.recoveryKey ?? '').trim().toUpperCase();
  if (!recoveryKey) {
    return fail('请先填写恢复密钥', 400);
  }
  const recoveryHash = await hashWith(HASH_DOMAIN.recovery, recoveryKey);

  const member = await env.DB.prepare('SELECT * FROM phonics_members WHERE recovery_hash = ?')
    .bind(recoveryHash)
    .first<MemberRow>();
  if (!member) {
    return fail('恢复密钥无效或已失效', 404);
  }
  if (member.revoked_at) {
    return fail('你已被移出这个班级', 403);
  }

  const space = await env.DB.prepare('SELECT * FROM phonics_spaces WHERE space_id = ?')
    .bind(member.space_id)
    .first<SpaceRow>();
  if (!space || space.revoked_at) {
    return fail('这个班级已经被撤销了', 403);
  }

  const deviceHash = String(body.deviceHash ?? '').slice(0, 128);
  if (deviceHash) {
    await env.DB.prepare('UPDATE phonics_members SET device_hash = ? WHERE member_id = ?')
      .bind(deviceHash, member.member_id)
      .run();
  }

  const stateRow = await env.DB.prepare(
    'SELECT state, updated_at FROM phonics_member_state WHERE member_id = ?',
  )
    .bind(member.member_id)
    .first<{ state: string; updated_at: string }>();

  let state: unknown = null;
  if (stateRow) {
    try {
      state = JSON.parse(stateRow.state);
    } catch {
      state = null;
    }
  }

  return json({
    ok: true,
    memberId: member.member_id,
    spaceId: member.space_id,
    spaceName: space.name,
    kind: space.kind,
    role: member.role,
    state,
    updatedAt: stateRow?.updated_at ?? null,
  });
}

async function handleClassOverview(request: Request, env: Env): Promise<Response> {
  const ownerKey = (request.headers.get('x-phonics-owner') ?? '').trim();
  if (!ownerKey) {
    return fail('缺少管理码', 400);
  }
  const space = await findSpaceByOwnerKey(env, ownerKey);
  if (!space) {
    return fail('管理码不对，或这个班级已被撤销', 403);
  }

  const result = await env.DB.prepare(
    `SELECT member_id, name, role, stats_json, created_at, last_seen_at, revoked_at
       FROM phonics_members WHERE space_id = ? ORDER BY created_at ASC LIMIT 200`,
  )
    .bind(space.space_id)
    .all<{
    member_id: string;
    name: string;
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
      memberId: row.member_id,
      name: row.name || '未命名成员',
      role: row.role === 'owner' ? 'owner' : 'student',
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
    space: { id: space.space_id, name: space.name || '未命名班级', createdAt: space.created_at },
    members,
  });
}

async function handleRevokeMember(request: Request, env: Env): Promise<Response> {
  const ownerKey = (request.headers.get('x-phonics-owner') ?? '').trim();
  if (!ownerKey) {
    return fail('缺少管理码', 400);
  }
  const space = await findSpaceByOwnerKey(env, ownerKey);
  if (!space) {
    return fail('管理码不对，或这个班级已被撤销', 403);
  }

  const body = await readJson(request);
  if (!body) {
    return fail('请求格式不对', 400);
  }
  const memberId = String(body.memberId ?? '').trim();
  if (!memberId) {
    return fail('缺少成员 ID', 400);
  }

  const target = await env.DB.prepare('SELECT * FROM phonics_members WHERE member_id = ?')
    .bind(memberId)
    .first<MemberRow>();
  if (!target || target.space_id !== space.space_id) {
    return fail('这个成员不在你的班级里', 404);
  }
  if (target.role === 'owner') {
    return fail('不能移出班级所有者', 400);
  }
  if (target.revoked_at) {
    return json({ ok: true });
  }

  await env.DB.prepare('UPDATE phonics_members SET revoked_at = ? WHERE member_id = ?')
    .bind(nowIso(), memberId)
    .run();

  return json({ ok: true });
}

async function handleRevokeSpace(request: Request, env: Env): Promise<Response> {
  const ownerKey = (request.headers.get('x-phonics-owner') ?? '').trim();
  if (!ownerKey) {
    return fail('缺少管理码', 400);
  }
  const ownerHash = await hashWith(HASH_DOMAIN.owner, ownerKey.trim().toUpperCase());
  const space = await env.DB.prepare('SELECT * FROM phonics_spaces WHERE owner_hash = ?')
    .bind(ownerHash)
    .first<SpaceRow>();
  if (!space) {
    return fail('管理码不对', 403);
  }
  if (space.revoked_at) {
    return json({ ok: true });
  }

  const revokedAt = nowIso();
  await env.DB.prepare('UPDATE phonics_spaces SET revoked_at = ? WHERE space_id = ?')
    .bind(revokedAt, space.space_id)
    .run();
  await env.DB.prepare('UPDATE phonics_members SET revoked_at = ? WHERE space_id = ? AND revoked_at IS NULL')
    .bind(revokedAt, space.space_id)
    .run();

  return json({ ok: true });
}

/**
 * 成员通道 + legacy 回退：
 * - 请求头里的 key 能对上 phonics_members.member_id → 走新通道（可被撤销）；
 * - 对不上 → 走旧表 phonics_user_state（deprecated，兼容期保留）。
 */
async function handleState(request: Request, env: Env): Promise<Response> {
  const userKey = (request.headers.get('x-phonics-key') ?? '').trim();
  if (!userKey || userKey.length < 8) {
    return fail('缺少有效的 x-phonics-key', 400);
  }

  const member = await env.DB.prepare('SELECT * FROM phonics_members WHERE member_id = ?')
    .bind(userKey)
    .first<MemberRow>();

  if (member) {
    if (member.revoked_at) {
      return fail('你已被移出这个班级，云端不再接收你的数据', 403, 'revoked');
    }
    const space = await env.DB.prepare('SELECT revoked_at FROM phonics_spaces WHERE space_id = ?')
      .bind(member.space_id)
      .first<{ revoked_at: string | null }>();
    if (space?.revoked_at) {
      return fail('这个班级已经被撤销了', 403, 'revoked');
    }

    if (request.method === 'GET') {
      const row = await env.DB.prepare(
        'SELECT state, updated_at FROM phonics_member_state WHERE member_id = ?',
      )
        .bind(userKey)
        .first<{ state: string; updated_at: string }>();
      if (!row) {
        return json({ error: 'not found' }, 404);
      }
      let state: unknown = {};
      try {
        state = JSON.parse(row.state);
      } catch {
        state = {};
      }
      return json({ version: 1, userKey, state, updatedAt: row.updated_at });
    }

    if (request.method === 'PUT' || request.method === 'POST') {
      const body = await readJson(request);
      if (!body) {
        return fail('invalid json body', 400);
      }
      const state = JSON.stringify(body.state ?? {});
      const updatedAt = nowIso();

      await env.DB.prepare(
        `INSERT INTO phonics_member_state (member_id, state, updated_at)
         VALUES (?, ?, ?)
         ON CONFLICT(member_id) DO UPDATE SET state = excluded.state, updated_at = excluded.updated_at`,
      )
        .bind(userKey, state, updatedAt)
        .run();

      // 冗余统计：看板只读这一列，不解析全量 state
      const stats = { ...computeStats(body.state), lastSeenAt: updatedAt };
      await env.DB.prepare(
        'UPDATE phonics_members SET stats_json = ?, last_seen_at = ? WHERE member_id = ?',
      )
        .bind(JSON.stringify(stats), updatedAt, userKey)
        .run();

      return json({ ok: true, updatedAt });
    }

    return fail('method not allowed', 405);
  }

  // ---- legacy 回退（deprecated） ----
  if (request.method === 'GET') {
    const row = await env.DB.prepare(
      'SELECT state, updated_at FROM phonics_user_state WHERE user_key = ?',
    )
      .bind(userKey)
      .first<{ state: string; updated_at: string }>();
    if (!row) {
      return json({ error: 'not found' }, 404);
    }
    let state: unknown = {};
    try {
      state = JSON.parse(row.state);
    } catch {
      state = {};
    }
    return json({ version: 1, userKey, state, updatedAt: row.updated_at });
  }

  if (request.method === 'PUT' || request.method === 'POST') {
    const body = await readJson(request);
    if (!body) {
      return fail('invalid json body', 400);
    }
    const state = JSON.stringify(body.state ?? {});
    const updatedAt = nowIso();
    await env.DB.prepare(
      `INSERT INTO phonics_user_state (user_key, state, updated_at)
       VALUES (?, ?, ?)
       ON CONFLICT(user_key) DO UPDATE SET state = excluded.state, updated_at = excluded.updated_at`,
    )
      .bind(userKey, state, updatedAt)
      .run();
    return json({ ok: true, updatedAt });
  }

  return fail('method not allowed', 405);
}

async function handle(request: Request, env: Env): Promise<Response> {
  if (request.method === 'OPTIONS') {
    return new Response(null, { headers: CORS_HEADERS });
  }

  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, '') || '/';

  if (path === '/api/health') {
    return json({ ok: true });
  }

  if (path === '/api/state') {
    return handleState(request, env);
  }

  if (path === '/api/space/create' && request.method === 'POST') {
    return handleCreateSpace(request, env);
  }

  if (path === '/api/member/join' && request.method === 'POST') {
    return handleJoinSpace(request, env);
  }

  if (path === '/api/member/recover' && request.method === 'POST') {
    return handleRecoverMember(request, env);
  }

  if (path === '/api/class/overview' && request.method === 'GET') {
    return handleClassOverview(request, env);
  }

  if (path === '/api/member/revoke' && request.method === 'POST') {
    return handleRevokeMember(request, env);
  }

  if (path === '/api/space/revoke' && request.method === 'POST') {
    return handleRevokeSpace(request, env);
  }

  return json({ error: 'not found' }, 404);
}

export const onRequest = async (ctx: { request: Request; env: Env }): Promise<Response> =>
  handle(ctx.request, ctx.env);
