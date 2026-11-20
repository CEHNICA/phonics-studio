/**
 * 本地影子后端
 *
 * 作用有两个：
 * 1. 没有配置任何远端时，前端的「远端」就是它自己（纯本地模式，不发任何网络请求）；
 * 2. 配置了远端时，缓存最后一次拉取到的远端快照，断网时仍能恢复上次的数据，避免用户看到空进度。
 */

import type { BackendProvider, UserStatePayload } from './types';
import { STATE_VERSION } from './types';
import { currentUserKey } from './user-key';

const CACHE_PREFIX = 'phonics-studio-remote-cache-v1';

function cacheKey(userKey: string): string {
  return `${CACHE_PREFIX}:${userKey}`;
}

export const localBackend: BackendProvider = {
  id: 'local',
  label: '本地模式（未接入云端）',

  isConfigured(): boolean {
    // 本地模式不算「已接入远端」，UI 据此显示「未配置云端」提示
    return false;
  },

  async load(): Promise<UserStatePayload | null> {
    try {
      const raw = localStorage.getItem(cacheKey(currentUserKey()));
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

  async save(payload: UserStatePayload): Promise<void> {
    try {
      localStorage.setItem(cacheKey(payload.userKey), JSON.stringify(payload));
    } catch {
      // 存储不可用时忽略：缓存只是加速与兜底，不是数据本体
    }
  },

  async ping(): Promise<boolean> {
    return true;
  },
};
