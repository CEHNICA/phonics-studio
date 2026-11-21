/**
 * 班级看板数据缓存（stale-while-revalidate）
 *
 * 为什么需要（2026-11-21 第 10 轮实测）：
 * 后端在 Cloudflare Pages（境外），前端在国内，
 * 单次跨网络往返实测 223~3151ms，抖动极大 —— 老师点「打开班级看板」要等 1.2~1.5 秒。
 * 这个延迟靠优化接口是压不掉的（瓶颈在跨境网络上，不在代码里）。
 *
 * 能做的是「别让用户干等」：
 *   1. 上一次看过的数据存在本机 —— 再打开立刻亮出来，同时后台刷新（秒开）；
 *   2. 提前预取 —— 用户点按钮之前数据就已经在路上了；
 *   3. 预取节流 —— 短时间内不重复打接口，别把跨境带宽耗在自己身上。
 *
 * 缓存按班级隔离：换班 / 退班不会把上一个班的成绩串过来。
 */
import type { ClassOverview } from './types';

export const CLASS_OVERVIEW_CACHE_KEY = 'phonics-studio-class-overview-v1';

/** 缓存有效期：5 分钟。过期了就当没有，宁可显示「正在读」也不给过期数据 */
export const CLASS_OVERVIEW_CACHE_TTL_MS = 5 * 60_000;

/** 预取节流窗口：30 秒内不重复打同一个接口 */
export const CLASS_OVERVIEW_PREFETCH_THROTTLE_MS = 30_000;

/**
 * 缓存「够新」的门槛：这么久以内拉过的数据，不用再跑一趟跨境
 *
 * 预取回来的数据正好赶上老师点看板时，别再发一次请求 —— 一次往返 300~3000ms，
 * 白跑一趟就是白等好几秒。
 */
export const CLASS_OVERVIEW_FRESH_MS = 30_000;

/** 最小存储接口（浏览器 localStorage 与测试假存储都满足） */
export interface CacheStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** 缓存文件结构 */
interface CacheFile {
  /** 按班级分桶 */
  spaces: Record<string, { cachedAt: number; data: ClassOverview }>;
  /** 最近一次写入的班级（不知道当前班级时用它） */
  lastSpaceId?: string;
  /** 上次预取时间（节流用） */
  lastPrefetchAt?: number;
}

/** 读到的缓存条目 */
export interface ClassOverviewCacheHit {
  data: ClassOverview;
  cachedAt: number;
}

/** 浏览器存储；没有 localStorage（如 Node / 隐私模式）时返回 null */
export function browserCacheStorage(): CacheStorage | null {
  try {
    if (typeof localStorage === 'undefined' || !localStorage) {
      return null;
    }
    return localStorage;
  } catch {
    return null;
  }
}

function emptyFile(): CacheFile {
  return { spaces: {} };
}

/** 读缓存文件；内容坏了就当没有，绝不抛错把页面搞崩 */
function readFile(storage: CacheStorage): CacheFile {
  try {
    const raw = storage.getItem(CLASS_OVERVIEW_CACHE_KEY);
    if (!raw) {
      return emptyFile();
    }
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object') {
      return emptyFile();
    }
    const file = parsed as Partial<CacheFile>;
    if (!file.spaces || typeof file.spaces !== 'object') {
      return emptyFile();
    }
    return {
      spaces: file.spaces as CacheFile['spaces'],
      lastSpaceId: typeof file.lastSpaceId === 'string' ? file.lastSpaceId : undefined,
      lastPrefetchAt: typeof file.lastPrefetchAt === 'number' ? file.lastPrefetchAt : undefined,
    };
  } catch {
    return emptyFile();
  }
}

function writeFile(storage: CacheStorage, file: CacheFile): void {
  try {
    storage.setItem(CLASS_OVERVIEW_CACHE_KEY, JSON.stringify(file));
  } catch {
    /* 存不进去（比如配额满了）就算了，不影响主流程 */
  }
}

/**
 * 读看板缓存
 *
 * @param spaceId 指定班级；不传就读最近一次缓存的那个班
 * @returns 命中就返回数据，没命中 / 过期 / 数据坏了都返回 null
 */
export function readClassOverviewCache(
  storage: CacheStorage,
  spaceId?: string,
): ClassOverviewCacheHit | null {
  const file = readFile(storage);
  const key = spaceId ?? file.lastSpaceId;
  if (!key) {
    return null;
  }
  const entry = file.spaces[key];
  if (!entry || typeof entry.cachedAt !== 'number' || !entry.data) {
    return null;
  }
  if (Date.now() - entry.cachedAt > CLASS_OVERVIEW_CACHE_TTL_MS) {
    return null;
  }
  return { data: entry.data, cachedAt: entry.cachedAt };
}

/** 写看板缓存（按班级分桶，顺便记住「最近是哪个班」） */
export function writeClassOverviewCache(
  storage: CacheStorage,
  spaceId: string,
  data: ClassOverview,
): void {
  const file = readFile(storage);
  file.spaces[spaceId] = { cachedAt: Date.now(), data };
  file.lastSpaceId = spaceId;
  writeFile(storage, file);
}

/** 上次预取的时间（没有就 0） */
export function readPrefetchAt(storage: CacheStorage): number {
  return readFile(storage).lastPrefetchAt ?? 0;
}

/** 记下这次预取的时间 */
export function writePrefetchAt(storage: CacheStorage, at: number): void {
  const file = readFile(storage);
  file.lastPrefetchAt = at;
  writeFile(storage, file);
}

/**
 * 该不该再预取一次
 *
 * 节流窗口内不重复打接口：预取是自己偷偷做的事，别把跨境带宽耗光。
 */
export function shouldPrefetchClassOverview(lastPrefetchedAt: number, now: number): boolean {
  if (!lastPrefetchedAt) {
    return true;
  }
  return now - lastPrefetchedAt > CLASS_OVERVIEW_PREFETCH_THROTTLE_MS;
}

/**
 * 缓存里的数据够不够新（够新就不用再跑一趟跨境）
 */
export function isClassOverviewFresh(cachedAt: number, now: number): boolean {
  if (!cachedAt) {
    return false;
  }
  return now - cachedAt < CLASS_OVERVIEW_FRESH_MS;
}
