/**
 * 后端选择入口
 *
 * 依据环境变量挑选 provider：
 * - VITE_BACKEND_KIND=worker + VITE_BACKEND_URL → Cloudflare Pages Functions + D1
 * - 其余情况                                          → 本地模式（不发起任何网络请求）
 *
 * 未配置远端时前端功能完全不变，只是数据不离开本机。
 */

import type { BackendProvider } from './types';
import { localBackend } from './local-backend';
import { createWorkerBackend } from './worker-backend';

let cached: BackendProvider | null = null;

/**
 * 读取当前生效的后端 provider（结果缓存，避免每次渲染重建）
 */
export function getBackend(): BackendProvider {
  if (cached) {
    return cached;
  }

  const kind = (import.meta.env.VITE_BACKEND_KIND ?? '').trim().toLowerCase();
  const url = (import.meta.env.VITE_BACKEND_URL ?? '').trim();

  if (kind === 'worker' && url) {
    cached = createWorkerBackend(url);
  } else {
    cached = localBackend;
  }

  return cached;
}

/**
 * 是否已经接入远端后端
 */
export function hasRemoteBackend(): boolean {
  return getBackend().isConfigured();
}
