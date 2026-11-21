/**
 * Cloudflare Workers / Pages Functions + D1 后端
 *
 * 约定的接口（配套实现见 backend/cloudflare/pages/functions/api/[[path]].ts）：
 * - GET  {base}/api/state   带请求头 x-phonics-key  → { version, userKey, state, updatedAt } 或 404
 * - PUT  {base}/api/state   带请求头 x-phonics-key  → 覆盖写入整份状态
 * - GET  {base}/api/health  → 200 表示服务在线
 * - POST {base}/api/space/create   → 创建班级 / 个人空间，返回班级码 + 管理码 + 恢复密钥
 * - POST {base}/api/member/join    → 用班级码加入班级
 * - POST {base}/api/member/recover → 用恢复密钥找回本人身份
 * - GET  {base}/api/class/overview 带请求头 x-phonics-owner → 班级看板
 * - POST {base}/api/member/revoke  带请求头 x-phonics-owner → 移出某个成员
 * - POST {base}/api/space/revoke   带请求头 x-phonics-owner → 撤销整个班级
 */

import type {
  BackendProvider,
  ClassOverview,
  MemberRecoverInput,
  MemberRecoverResult,
  SpaceCreateInput,
  SpaceCreateResult,
  SpaceJoinInput,
  SpaceJoinResult,
  UserStatePayload,
} from './types';
import { STATE_VERSION } from './types';
import { loadIdentity } from './space-client';

const REQUEST_TIMEOUT_MS = 8000;
const USER_KEY_HEADER = 'x-phonics-key';
const OWNER_KEY_HEADER = 'x-phonics-owner';

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

/**
 * 读取服务端返回的错误文案，界面直接展示人话
 */
async function readError(response: Response, fallback: string): Promise<Error> {
  try {
    const data = (await response.json()) as { message?: string; error?: string };
    if (data?.message) {
      return new Error(data.message);
    }
    if (data?.error === 'revoked') {
      return new Error('你已被移出这个班级');
    }
  } catch {
    // 忽略解析失败，用兜底文案
  }
  return new Error(`${fallback}：HTTP ${response.status}`);
}

export function createWorkerBackend(baseUrl: string): BackendProvider {
  const base = trimBase(baseUrl);

  /**
   * 发一个 JSON 请求并解析响应；非 2xx 时抛出带服务端文案的错误
   */
  async function requestJson<T>(path: string, init: RequestInit, fallback: string): Promise<T> {
    const response = await fetchWithTimeout(`${base}${path}`, init);
    if (!response.ok) {
      throw await readError(response, fallback);
    }
    return (await response.json()) as T;
  }

  return {
    id: 'worker',
    label: 'Cloudflare Worker + D1',

    isConfigured(): boolean {
      return base.length > 0;
    },

    async load(): Promise<UserStatePayload | null> {
      // 还没加入任何空间 = 纯本机使用，不产生任何网络请求
      const identity = loadIdentity();
      if (!identity) {
        return null;
      }
      const response = await fetchWithTimeout(`${base}/api/state`, {
        method: 'GET',
        headers: { [USER_KEY_HEADER]: identity.memberId },
      });
      if (response.status === 404) {
        return null;
      }
      if (!response.ok) {
        throw await readError(response, '读取云端数据失败');
      }
      const data = (await response.json()) as UserStatePayload;
      if (!data || !data.state) {
        return null;
      }
      return { ...data, version: data.version ?? STATE_VERSION };
    },

    async save(payload: UserStatePayload): Promise<void> {
      const identity = loadIdentity();
      if (!identity) {
        // 未加入空间：数据只留在本机
        return;
      }
      const response = await fetchWithTimeout(`${base}/api/state`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          [USER_KEY_HEADER]: identity.memberId,
        },
        body: JSON.stringify({
          version: STATE_VERSION,
          userKey: identity.memberId,
          state: payload.state,
          updatedAt: payload.updatedAt,
        }),
      });
      if (!response.ok) {
        throw await readError(response, '保存云端数据失败');
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

    async createSpace(input: SpaceCreateInput): Promise<SpaceCreateResult> {
      return requestJson<SpaceCreateResult>(
        '/api/space/create',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(input),
        },
        '创建班级失败',
      );
    },

    async joinSpace(input: SpaceJoinInput): Promise<SpaceJoinResult> {
      return requestJson<SpaceJoinResult>(
        '/api/member/join',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(input),
        },
        '加入班级失败',
      );
    },

    async recoverMember(input: MemberRecoverInput): Promise<MemberRecoverResult> {
      return requestJson<MemberRecoverResult>(
        '/api/member/recover',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(input),
        },
        '恢复进度失败',
      );
    },

    async classOverview(ownerKey: string): Promise<ClassOverview> {
      return requestJson<ClassOverview>(
        '/api/class/overview',
        {
          method: 'GET',
          headers: { [OWNER_KEY_HEADER]: ownerKey },
        },
        '读取班级看板失败',
      );
    },

    async revokeMember(ownerKey: string, memberId: string): Promise<void> {
      await requestJson<{ ok: boolean }>(
        '/api/member/revoke',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            [OWNER_KEY_HEADER]: ownerKey,
          },
          body: JSON.stringify({ memberId }),
        },
        '移出成员失败',
      );
    },

    async revokeSpace(ownerKey: string): Promise<void> {
      await requestJson<{ ok: boolean }>(
        '/api/space/revoke',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            [OWNER_KEY_HEADER]: ownerKey,
          },
        },
        '撤销班级失败',
      );
    },
  };
}
