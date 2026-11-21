/**
 * 后端错误归一化：把技术错误翻译成用户看得懂的人话
 *
 * 背景（第 9 轮实测）：
 * 建班请求撞上跨境链路抖动、被浏览器掐断时，AbortError 的原文
 * 「signal is aborted without reason」被原样甩到界面上 —— 用户看不懂，
 * 也不知道该重试还是该换网。类似的技术串还有「Failed to fetch」。
 *
 * 规则：
 * - 掐断 / 超时 → 固定话术，告诉用户「等一会儿再试」；
 * - 网络不可达 → 固定话术，告诉用户「检查网络」；
 * - 服务端返回的中文提示 → 原样保留（那本来就是人话，别改写）；
 * - 其他看不懂的英文错误 → 回落到调用方给的中文兜底。
 *
 * 纯函数，无副作用，体检器直接 import 真跑。
 */

export const TIMEOUT_ERROR_TEXT = '网络太慢没连上，等一会儿再试一次';
export const NETWORK_ERROR_TEXT = '连不上服务器，检查一下网络再试一次';

/** 有中文就算人话 */
const HAS_CHINESE = /[\u4e00-\u9fa5]/;

function messageOf(error: unknown): string {
  if (!error || typeof error !== 'object') return '';
  const message = (error as { message?: unknown }).message;
  return typeof message === 'string' ? message : '';
}

function nameOf(error: unknown): string {
  if (!error || typeof error !== 'object') return '';
  const name = (error as { name?: unknown }).name;
  return typeof name === 'string' ? name : '';
}

/** 掐断 / 超时：Chromium 说 "signal is aborted without reason"，Node 说 "This operation was aborted" */
export function isAbortError(error: unknown): boolean {
  if (nameOf(error) === 'AbortError') return true;
  return /abort/i.test(messageOf(error));
}

/** 网络不可达：浏览器 fetch 失败一律抛 TypeError("Failed to fetch") */
export function isNetworkError(error: unknown): boolean {
  const message = messageOf(error);
  if (/failed to fetch|networkerror|network error|load failed|econnrefused|enotfound|econnreset|err_internet|err_name_not_resolved/i.test(message)) {
    return true;
  }
  return nameOf(error) === 'TypeError' && /fetch|network/i.test(message);
}

/**
 * 把任意异常收敛成一句给用户看的话
 *
 * @param error   捕获到的异常
 * @param fallback 调用方给的中文兜底（「创建班级失败」这种）
 */
export function normalizeBackendError(error: unknown, fallback: string): string {
  if (isAbortError(error)) return TIMEOUT_ERROR_TEXT;
  if (isNetworkError(error)) return NETWORK_ERROR_TEXT;

  const message = messageOf(error).trim();
  if (message && HAS_CHINESE.test(message)) return message;

  return fallback;
}
