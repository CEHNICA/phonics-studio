/**
 * Cloudflare Worker：音标小铺的极简状态后端
 *
 * 接口：
 * - GET  /api/health                       → { ok: true }
 * - GET  /api/state                        → { version, userKey, state, updatedAt }，无数据时 404
 * - PUT  /api/state                        → 覆盖写入整份状态
 *
 * 身份：请求头 x-phonics-key（即用户同步码或设备密钥），服务端只当不透明字符串。
 * 部署：npx wrangler d1 execute phonics-studio --file=./schema.sql
 *       npx wrangler deploy
 */

interface Env {
  DB: D1Database;
}

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'content-type, x-phonics-key',
  'Access-Control-Allow-Methods': 'GET, PUT, OPTIONS',
  'Access-Control-Max-Age': '86400',
};

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json; charset=utf-8' },
  });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: CORS_HEADERS });
    }

    const url = new URL(request.url);
    const userKey = (request.headers.get('x-phonics-key') ?? '').trim();

    if (url.pathname === '/api/health') {
      return json({ ok: true });
    }

    if (url.pathname !== '/api/state') {
      return json({ error: 'not found' }, 404);
    }

    if (!userKey || userKey.length < 8) {
      return json({ error: 'missing or invalid x-phonics-key' }, 400);
    }

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

      return json({
        version: 1,
        userKey,
        state,
        updatedAt: row.updated_at,
      });
    }

    if (request.method === 'PUT' || request.method === 'POST') {
      let body: { state?: unknown };
      try {
        body = (await request.json()) as { state?: unknown };
      } catch {
        return json({ error: 'invalid json body' }, 400);
      }

      const state = JSON.stringify(body.state ?? {});
      const updatedAt = new Date().toISOString();

      await env.DB.prepare(
        `INSERT INTO phonics_user_state (user_key, state, updated_at)
         VALUES (?, ?, ?)
         ON CONFLICT(user_key) DO UPDATE SET state = excluded.state, updated_at = excluded.updated_at`,
      )
        .bind(userKey, state, updatedAt)
        .run();

      return json({ ok: true, updatedAt });
    }

    return json({ error: 'method not allowed' }, 405);
  },
};
