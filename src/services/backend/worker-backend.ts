/**
 * Cloudflare Workers + D1 后端
 *
 * 约定的 Worker 接口（配套实现见 backend/cloudflare/worker.ts）：
 * - GET  {base}/api/state   带请求头 x-phonics-key  → { version, userKey, state, updatedAt } 或 404
 * - PUT  {base}/api/state   带请求头 x-phonics-key  → 覆盖写入整份状态
 * - GET  {base}/api/health  → 200 表示服务在线
 */

import type { BackendProvider, UserStatePayload } from './types';
import { STATE_VERSION } from './types';
import { currentUserKey } from './user-key';

const REQUEST_TIMEOUT_MS = 8000;
const USER_KEY_HEADER = 'x-phonics-key';

function trimBase(url: string): string {
  return url.trim().replace(/\/+$/, '');
}

/**
 * 带超时的 fetch，避免弱网下请求长期挂起拖慢界面
 */
async function fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

export function createWorkerBackend(baseUrl: string): BackendProvider {
  const base = trimBase(baseUrl);

  return {
    id: 'worker',
    label: 'Cloudflare Worker + D1',

    isConfigured(): boolean {
      return base.length > 0;
    },

    async load(): Promise<UserStatePayload | null> {
      const response = await fetchWithTimeout(`${base}/api/state`, {
        method: 'GET',
        headers: { [USER_KEY_HEADER]: currentUserKey() },
      });
      if (response.status === 404) {
        return null;
      }
      if (!response.ok) {
        throw new Error(`读取云端数据失败：HTTP ${response.status}`);
      }
      const data = (await response.json()) as UserStatePayload;
      if (!data || !data.state) {
        return null;
      }
      return { ...data, version: data.version ?? STATE_VERSION };
    },

    async save(payload: UserStatePayload): Promise<void> {
      const response = await fetchWithTimeout(`${base}/api/state`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          [USER_KEY_HEADER]: payload.userKey,
        },
        body: JSON.stringify({
          version: STATE_VERSION,
          userKey: payload.userKey,
          state: payload.state,
          updatedAt: payload.updatedAt,
        }),
      });
      if (!response.ok) {
        throw new Error(`保存云端数据失败：HTTP ${response.status}`);
      }
    },

    async ping(): Promise<boolean> {
      try {
        const response = await fetchWithTimeout(`${base}/api/health`, { method: 'GET' });
        return response.ok;
      } catch {
        return false;
      }
    },
  };
}
