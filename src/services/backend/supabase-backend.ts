/**
 * Supabase（PostgREST）后端
 *
 * 配套建表脚本见 backend/supabase/schema.sql：
 *   create table phonics_user_state (
 *     user_key text primary key,
 *     state jsonb not null default '{}'::jsonb,
 *     updated_at timestamptz not null default now()
 *   );
 *   alter table phonics_user_state enable row level security;
 *   create policy "own row" on phonics_user_state for all
 *     using (user_key = current_setting('request.headers', true)::json->>'x-phonics-key')
 *     with check (user_key = current_setting('request.headers', true)::json->>'x-phonics-key');
 *
 * 前端只使用 anon key，配合上面的行级策略做到「只能读写自己那一行」。
 */

import type { BackendProvider, UserStatePayload } from './types';
import { STATE_VERSION } from './types';
import { currentUserKey } from './user-key';

const REQUEST_TIMEOUT_MS = 8000;
const USER_KEY_HEADER = 'x-phonics-key';
const TABLE = 'phonics_user_state';

async function fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

export function createSupabaseBackend(projectUrl: string, anonKey: string): BackendProvider {
  const base = projectUrl.trim().replace(/\/+$/, '');

  const buildHeaders = (userKey: string): HeadersInit => ({
    apikey: anonKey,
    Authorization: `Bearer ${anonKey}`,
    'Content-Type': 'application/json',
    [USER_KEY_HEADER]: userKey,
  });

  return {
    id: 'supabase',
    label: 'Supabase',

    isConfigured(): boolean {
      return base.length > 0 && anonKey.trim().length > 0;
    },

    async load(): Promise<UserStatePayload | null> {
      const userKey = currentUserKey();
      const url = `${base}/rest/v1/${TABLE}?user_key=eq.${encodeURIComponent(userKey)}&select=state,updated_at`;
      const response = await fetchWithTimeout(url, {
        method: 'GET',
        headers: buildHeaders(userKey),
      });
      if (response.status === 404) {
        return null;
      }
      if (!response.ok) {
        throw new Error(`读取云端数据失败：HTTP ${response.status}`);
      }
      const rows = (await response.json()) as Array<{
        state: UserStatePayload['state'];
        updated_at: string;
      }>;
      if (!Array.isArray(rows) || rows.length === 0) {
        return null;
      }
      const row = rows[0];
      return {
        version: STATE_VERSION,
        userKey,
        state: row.state,
        updatedAt: row.updated_at,
      };
    },

    async save(payload: UserStatePayload): Promise<void> {
      const url = `${base}/rest/v1/${TABLE}?on_conflict=user_key`;
      const response = await fetchWithTimeout(url, {
        method: 'POST',
        headers: {
          ...buildHeaders(payload.userKey),
          Prefer: 'resolution=merge-duplicates,return=minimal',
        },
        body: JSON.stringify({
          user_key: payload.userKey,
          state: payload.state,
          updated_at: payload.updatedAt,
        }),
      });
      if (!response.ok) {
        throw new Error(`保存云端数据失败：HTTP ${response.status}`);
      }
    },

    async ping(): Promise<boolean> {
      try {
        const url = `${base}/rest/v1/${TABLE}?select=user_key&limit=1`;
        const response = await fetchWithTimeout(url, {
          method: 'GET',
          headers: buildHeaders(currentUserKey()),
        });
        return response.ok;
      } catch {
        return false;
      }
    },
  };
}
