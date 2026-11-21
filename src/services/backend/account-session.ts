/**
 * 会话持久化：把「令牌 + 账号 + 班级状态」存在本机
 *
 * 做成 store 工厂是为了能在 Node 里用假存储测（scripts/test-account-session.ts），
 * 不给生产代码留测试专用后门。
 */

import type { AccountInfo, Membership } from './types';

const SESSION_KEY = 'phonics-studio-account-session-v1';

/** 一个已登录的会话 */
export interface AccountSession {
  token: string;
  account: AccountInfo;
  membership: Membership | null;
  /** 登录时间（ISO） */
  savedAt: string;
}

/** 最小存储接口（浏览器 localStorage 与测试假存储都满足） */
export interface SessionStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** 浏览器存储；无 localStorage（如 SSR / Node）时返回 null */
export function browserSessionStorage(): SessionStorage | null {
  try {
    if (typeof localStorage === 'undefined' || !localStorage) {
      return null;
    }
    return localStorage;
  } catch {
    return null;
  }
}

/**
 * 把任意解析结果收敛成一个合法会话；不合法就返回 null
 * （存储里的东西可能被手改、被旧版本写坏，必须能安全退化）
 */
export function parseSession(raw: string | null): AccountSession | null {
  if (!raw) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as Partial<AccountSession>;
    if (!parsed || typeof parsed !== 'object') {
      return null;
    }
    if (typeof parsed.token !== 'string' || !parsed.token.trim()) {
      return null;
    }
    if (!parsed.account || typeof parsed.account.username !== 'string') {
      return null;
    }
    const account: AccountInfo = {
      username: parsed.account.username,
      displayName:
        typeof parsed.account.displayName === 'string' && parsed.account.displayName.trim()
          ? parsed.account.displayName
          : parsed.account.username,
    };
    let membership: Membership | null = null;
    const rawMembership = parsed.membership;
    if (rawMembership && typeof rawMembership === 'object' && rawMembership.spaceId) {
      membership = {
        spaceId: String(rawMembership.spaceId),
        spaceName: String(rawMembership.spaceName ?? '未命名班级'),
        role: rawMembership.role === 'owner' ? 'owner' : 'student',
        joinCode: typeof rawMembership.joinCode === 'string' ? rawMembership.joinCode : null,
        memberName: String(rawMembership.memberName ?? account.username),
        revoked: Boolean(rawMembership.revoked),
        spaceRevoked: Boolean(rawMembership.spaceRevoked),
      };
    }
    return {
      token: parsed.token,
      account,
      membership,
      savedAt: typeof parsed.savedAt === 'string' ? parsed.savedAt : new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

/** 序列化成能存进 localStorage 的字符串 */
export function serializeSession(session: AccountSession): string {
  return JSON.stringify(session);
}

/** 会话存储 */
export function createSessionStore(storage: SessionStorage | null) {
  return {
    /** 读取本机会话；没有或坏了就返回 null */
    load(): AccountSession | null {
      if (!storage) {
        return null;
      }
      try {
        return parseSession(storage.getItem(SESSION_KEY));
      } catch {
        return null;
      }
    },
    /** 写入会话 */
    save(session: AccountSession): void {
      if (!storage) {
        return;
      }
      try {
        storage.setItem(SESSION_KEY, serializeSession(session));
      } catch {
        // 存储不可用时忽略：会话丢失只是要重新登录，不该让页面崩
      }
    },
    /** 清除会话 */
    clear(): void {
      if (!storage) {
        return;
      }
      try {
        storage.removeItem(SESSION_KEY);
      } catch {
        // 同上
      }
    },
  };
}

/** 全局会话存储 */
export const accountSession = createSessionStore(browserSessionStorage());
