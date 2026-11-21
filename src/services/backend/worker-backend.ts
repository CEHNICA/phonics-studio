/**
 * Cloudflare Pages Functions + D1 后端（账号体系）
 *
 * 接口（配套实现见 backend/cloudflare/pages/functions/api/[[path]].ts）：
 * - POST /api/auth/register        {username,password,displayName?} → {token,account,membership}
 * - POST /api/auth/login           {username,password}             → {token,account,membership}
 * - POST /api/auth/logout          (token)                        → {ok}
 * - POST /api/auth/password        (token) {oldPassword,newPassword} → {ok}
 * - GET  /api/me                   (token)                        → {account,membership}
 * - GET  /api/state                (token)                        → {version,accountId,state,updatedAt} | 404
 * - PUT  /api/state                (token) {state}                → {ok,updatedAt}
 * - POST /api/class/create         (token) {name}                 → {spaceId,name,joinCode}
 * - POST /api/member/join          (token) {joinCode}             → {spaceId,spaceName,role}
 * - GET  /api/class/overview       (token, 仅老师)                → {space,members}
 * - POST /api/member/remove        (token, 仅老师) {accountId}    → {ok}
 * - POST /api/member/reset-password(token, 仅老师) {accountId}    → {ok,tempPassword}
 * - POST /api/class/revoke         (token, 仅老师)                → {ok}
 * - POST /api/class/leave          (token)                        → {ok,revokedClass}
 *
 * 鉴权：请求头 x-phonics-token（或 Authorization: Bearer）。
 */

import type {
  AuthResult,
  BackendProvider,
  ClassCreateResult,
  ClassJoinResult,
  ClassLeaveResult,
  ClassOverview,
  LoginInput,
  RegisterInput,
  UserStatePayload,
} from './types.ts';
import { STATE_VERSION } from './types.ts';
import { normalizeBackendError } from './error-messages.ts';

/**
 * 请求超时
 *
 * 为什么是 15 秒不是 8 秒（第 9 轮实测）：
 * 后端在 *.pages.dev（跨境），首次连接碰上丢包会走 TCP 重传，
 * 实测有请求整整挂了 9 秒才被掐断 —— 8 秒一刀切下去，
 * 用户点「创建班级」会看到「signal is aborted without reason」，
 * 班级根本没建出来。留够 15 秒，弱网下也能把请求送到。
 *
 * 宁可多等几秒，也不要把用户的操作判死。
 */
export const REQUEST_TIMEOUT_MS = 15000;

/** 健康检查（也是预热连接用的）只探连通性，超时短一点，别在后台挂太久 */
const PING_TIMEOUT_MS = 5000;

const TOKEN_HEADER = 'x-phonics-token';

function trimBase(url: string): string {
  return url.trim().replace(/\/+$/, '');
}

/**
 * 带超时的 fetch，避免弱网下请求长期挂起拖慢界面
 */
async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number = REQUEST_TIMEOUT_MS,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (error) {
    // 掐断 / 网络不可达 → 翻译成人话。
    // 绝不能把 AbortError 的原文（「signal is aborted without reason」）
    // 甩到界面上，用户看不懂也不知道该干嘛。
    throw new Error(normalizeBackendError(error, '连接服务器失败'));
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 读取服务端返回的错误文案，界面直接展示人话
 */
async function readError(response: Response, fallback: string): Promise<Error> {
  try {
    const data = (await response.json()) as { error?: string; code?: string };
    if (data?.code === 'revoked') {
      return new Error('你已被移出这个班级，云端不再接收数据');
    }
    if (data?.error) {
      return new Error(data.error);
    }
  } catch {
    // 忽略解析失败，用兜底文案
  }
  return new Error(`${fallback}：HTTP ${response.status}`);
}

export function createWorkerBackend(
  baseUrl: string,
  options?: { timeoutMs?: number },
): BackendProvider {
  const base = trimBase(baseUrl);
  const timeoutMs = options?.timeoutMs ?? REQUEST_TIMEOUT_MS;

  /**
   * 发一个 JSON 请求并解析响应；非 2xx 时抛出带服务端文案的错误
   */
  async function requestJson<T>(
    path: string,
    init: RequestInit,
    fallback: string,
    token?: string,
  ): Promise<T> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...((init.headers as Record<string, string>) ?? {}),
    };
    if (token) {
      headers[TOKEN_HEADER] = token;
    }
    try {
      const response = await fetchWithTimeout(`${base}${path}`, { ...init, headers }, timeoutMs);
      if (!response.ok) {
        throw await readError(response, fallback);
      }
      return (await response.json()) as T;
    } catch (error) {
      // readError 抛的是服务端给的中文提示，归一化时原样保留；
      // 网络类错误在这里翻成人话。
      throw new Error(normalizeBackendError(error, fallback));
    }
  }

  return {
    id: 'worker',
    label: 'Cloudflare Worker + D1',

    isConfigured(): boolean {
      return base.length > 0;
    },

    async register(input: RegisterInput): Promise<AuthResult> {
      return requestJson<AuthResult>(
        '/api/auth/register',
        {
          method: 'POST',
          body: JSON.stringify({
            username: input.username,
            password: input.password,
            displayName: input.displayName,
            role: input.role ?? 'student',
            teacherCode: input.teacherCode,
          }),
        },
        '注册失败',
      );
    },

    async login(input: LoginInput): Promise<AuthResult> {
      return requestJson<AuthResult>(
        '/api/auth/login',
        {
          method: 'POST',
          body: JSON.stringify({ username: input.username, password: input.password }),
        },
        '登录失败',
      );
    },

    async logout(token: string): Promise<void> {
      await requestJson<{ ok: boolean }>(
        '/api/auth/logout',
        { method: 'POST' },
        '退出登录失败',
        token,
      );
    },

    async me(token: string) {
      return requestJson<{ account: AuthResult['account']; membership: AuthResult['membership'] }>(
        '/api/me',
        { method: 'GET' },
        '读取账号信息失败',
        token,
      );
    },

    async changePassword(token: string, oldPassword: string, newPassword: string): Promise<void> {
      await requestJson<{ ok: boolean }>(
        '/api/auth/password',
        {
          method: 'POST',
          body: JSON.stringify({ oldPassword, newPassword }),
        },
        '修改密码失败',
        token,
      );
    },

    async load(token: string): Promise<UserStatePayload | null> {
      try {
        const response = await fetchWithTimeout(
          `${base}/api/state`,
          {
            method: 'GET',
            headers: { [TOKEN_HEADER]: token },
          },
          timeoutMs,
        );
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
      } catch (error) {
        throw new Error(normalizeBackendError(error, '读取云端数据失败'));
      }
    },

    async save(token: string, payload: UserStatePayload): Promise<void> {
      try {
        const response = await fetchWithTimeout(
          `${base}/api/state`,
          {
            method: 'PUT',
            headers: {
              'Content-Type': 'application/json',
              [TOKEN_HEADER]: token,
            },
            body: JSON.stringify({
              version: STATE_VERSION,
              state: payload.state,
              updatedAt: payload.updatedAt,
            }),
          },
          timeoutMs,
        );
        if (!response.ok) {
          throw await readError(response, '保存云端数据失败');
        }
      } catch (error) {
        throw new Error(normalizeBackendError(error, '保存云端数据失败'));
      }
    },

    async ping(): Promise<boolean> {
      try {
        // 健康检查用短超时：它只是「探一下能不能连上」，
        // 不值得在后台挂 15 秒（页面加载时会用它预热连接）
        const response = await fetchWithTimeout(
          `${base}/api/health`,
          { method: 'GET' },
          PING_TIMEOUT_MS,
        );
        return response.ok;
      } catch {
        return false;
      }
    },

    async createClass(token: string, name: string): Promise<ClassCreateResult> {
      return requestJson<ClassCreateResult>(
        '/api/class/create',
        { method: 'POST', body: JSON.stringify({ name }) },
        '创建班级失败',
        token,
      );
    },

    async joinClass(token: string, joinCode: string): Promise<ClassJoinResult> {
      return requestJson<ClassJoinResult>(
        '/api/member/join',
        { method: 'POST', body: JSON.stringify({ joinCode }) },
        '加入班级失败',
        token,
      );
    },

    async classOverview(token: string): Promise<ClassOverview> {
      return requestJson<ClassOverview>(
        '/api/class/overview',
        { method: 'GET' },
        '读取班级看板失败',
        token,
      );
    },

    async removeMember(token: string, accountId: string): Promise<void> {
      await requestJson<{ ok: boolean }>(
        '/api/member/remove',
        { method: 'POST', body: JSON.stringify({ accountId }) },
        '移出成员失败',
        token,
      );
    },

    async resetMemberPassword(token: string, accountId: string): Promise<string> {
      const data = await requestJson<{ ok: boolean; tempPassword: string }>(
        '/api/member/reset-password',
        { method: 'POST', body: JSON.stringify({ accountId }) },
        '重置密码失败',
        token,
      );
      return data.tempPassword;
    },

    async revokeClass(token: string): Promise<void> {
      await requestJson<{ ok: boolean }>(
        '/api/class/revoke',
        { method: 'POST', body: JSON.stringify({}) },
        '撤销班级失败',
        token,
      );
    },

    async leaveClass(token: string): Promise<ClassLeaveResult> {
      const data = await requestJson<ClassLeaveResult>(
        '/api/class/leave',
        { method: 'POST', body: JSON.stringify({}) },
        '退出班级失败',
        token,
      );
      return data;
    },
  };
}
