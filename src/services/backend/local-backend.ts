/**
 * 本地影子后端
 *
 * 作用：
 * 1. 没有配置任何远端时，前端的「远端」就是它自己（纯本地模式，不发任何网络请求）；
 * 2. 配置了远端时，缓存最后一次拉取到的远端快照，断网时仍能恢复上次的数据，避免用户看到空进度。
 *
 * 本模式下没有账号概念，任何账号相关操作都直接抛错（界面根本不会走到这里）。
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
} from './types';
import { STATE_VERSION } from './types';

const CACHE_PREFIX = 'phonics-studio-remote-cache-v2';

function cacheKey(accountId: string): string {
  return `${CACHE_PREFIX}:${accountId}`;
}

function notConfigured(what: string): Error {
  return new Error(`${what}：当前是本地模式，没有接入云端`);
}

export const localBackend: BackendProvider = {
  id: 'local',
  label: '本地模式（未接入云端）',

  isConfigured(): boolean {
    // 本地模式不算「已接入远端」，UI 据此显示「未配置云端」提示
    return false;
  },

  async register(_input: RegisterInput): Promise<AuthResult> {
    throw notConfigured('注册失败');
  },

  async login(_input: LoginInput): Promise<AuthResult> {
    throw notConfigured('登录失败');
  },

  async logout(_token: string): Promise<void> {
    // 本地模式没有服务端会话，登出只是清本机
  },

  async me(_token: string) {
    throw notConfigured('读取账号信息失败');
  },

  async changePassword(_token: string, _oldPassword: string, _newPassword: string): Promise<void> {
    throw notConfigured('修改密码失败');
  },

  async load(accountId: string): Promise<UserStatePayload | null> {
    try {
      const raw = localStorage.getItem(cacheKey(accountId));
      if (!raw) {
        return null;
      }
      const parsed = JSON.parse(raw) as UserStatePayload;
      if (!parsed || typeof parsed !== 'object' || !parsed.state) {
        return null;
      }
      return { ...parsed, version: parsed.version ?? STATE_VERSION };
    } catch {
      return null;
    }
  },

  async save(accountId: string, payload: UserStatePayload): Promise<void> {
    try {
      localStorage.setItem(cacheKey(accountId), JSON.stringify(payload));
    } catch {
      // 存储不可用时忽略：缓存只是加速与兜底，不是数据本体
    }
  },

  async ping(): Promise<boolean> {
    return true;
  },

  async createClass(_token: string, _name: string): Promise<ClassCreateResult> {
    throw notConfigured('创建班级失败');
  },

  async joinClass(_token: string, _joinCode: string): Promise<ClassJoinResult> {
    throw notConfigured('加入班级失败');
  },

  async classOverview(_token: string): Promise<ClassOverview> {
    throw notConfigured('读取班级看板失败');
  },

  async removeMember(_token: string, _accountId: string): Promise<void> {
    throw notConfigured('移出成员失败');
  },

  async resetMemberPassword(_token: string, _accountId: string): Promise<string> {
    throw notConfigured('重置密码失败');
  },

  async revokeClass(_token: string): Promise<void> {
    throw notConfigured('撤销班级失败');
  },

  async leaveClass(_token: string): Promise<ClassLeaveResult> {
    throw notConfigured('退出班级失败');
  },
};
