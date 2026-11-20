/**
 * 本地与远端状态的合并策略
 *
 * 目标：多设备同时学习时不丢数据，且不产生「回退」——同一份数据在任意设备上都只增不减。
 * - 音标进度：以最近学习时间（lastStudiedAt）较新的一方为准；
 * - 打卡日期：取并集；
 * - 闯关统计：各项取最大值（只会累加，不会回退）；
 * - 收藏：取并集（取消收藏只在同一台设备上生效，跨设备合并后仍保留，另一端下次推送时会被覆盖）；
 * - 答题明细：按 ID 去重后取并集，按时间倒序保留最近若干条。
 */

import type { PhonemeProgress, QuizAttempt, UserProgressState } from '../../types/phonics';

/** 本地与云端各自保留的答题明细上限 */
export const MAX_ATTEMPTS = 500;

const EMPTY_PHONEME_PROGRESS: PhonemeProgress = {
  representativeWord: '',
  completed: false,
  mistakeCount: 0,
  consecutiveCorrect: 0,
};

function timestampOf(record: PhonemeProgress | undefined): number {
  if (!record?.lastStudiedAt) {
    return 0;
  }
  const parsed = Date.parse(record.lastStudiedAt);
  return Number.isNaN(parsed) ? 0 : parsed;
}

/**
 * 合并单个音标的进度记录
 */
export function mergePhonemeProgress(
  local: PhonemeProgress | undefined,
  remote: PhonemeProgress | undefined,
): PhonemeProgress {
  if (!local) {
    return remote ?? EMPTY_PHONEME_PROGRESS;
  }
  if (!remote) {
    return local;
  }

  const localTime = timestampOf(local);
  const remoteTime = timestampOf(remote);
  const base = localTime >= remoteTime ? local : remote;

  return {
    representativeWord: base.representativeWord,
    completed: base.completed,
    mistakeCount: base.mistakeCount,
    consecutiveCorrect: base.consecutiveCorrect,
    lastStudiedAt:
      localTime >= remoteTime
        ? local.lastStudiedAt ?? remote.lastStudiedAt
        : remote.lastStudiedAt ?? local.lastStudiedAt,
  };
}

/**
 * 合并答题明细
 */
export function mergeAttempts(local: QuizAttempt[], remote: QuizAttempt[]): QuizAttempt[] {
  const byId = new Map<string, QuizAttempt>();
  for (const attempt of [...local, ...remote]) {
    if (!attempt || typeof attempt.id !== 'string') {
      continue;
    }
    const existing = byId.get(attempt.id);
    if (!existing) {
      byId.set(attempt.id, attempt);
      continue;
    }
    const localTime = Date.parse(existing.at) || 0;
    const remoteTime = Date.parse(attempt.at) || 0;
    if (remoteTime > localTime) {
      byId.set(attempt.id, attempt);
    }
  }
  return Array.from(byId.values())
    .sort((a, b) => (Date.parse(b.at) || 0) - (Date.parse(a.at) || 0))
    .slice(0, MAX_ATTEMPTS);
}

/**
 * 合并收藏与取消收藏（按时间戳决胜，取消收藏可以跨设备生效）
 */
export function mergeFavorites(
  localFavorites: Record<string, number>,
  localTombstones: Record<string, number>,
  remoteFavorites: Record<string, number>,
  remoteTombstones: Record<string, number>,
): { favorites: Record<string, number>; favoriteTombstones: Record<string, number> } {
  const ids = new Set([
    ...Object.keys(localFavorites),
    ...Object.keys(localTombstones),
    ...Object.keys(remoteFavorites),
    ...Object.keys(remoteTombstones),
  ]);

  const favorites: Record<string, number> = {};
  const favoriteTombstones: Record<string, number> = {};

  for (const id of ids) {
    const addedAt = Math.max(localFavorites[id] ?? 0, remoteFavorites[id] ?? 0);
    const removedAt = Math.max(localTombstones[id] ?? 0, remoteTombstones[id] ?? 0);
    if (addedAt > 0) {
      favorites[id] = addedAt;
    }
    if (removedAt > 0) {
      favoriteTombstones[id] = removedAt;
    }
  }

  return { favorites, favoriteTombstones };
}

/**
 * 合并两份完整学习状态
 */
export function mergeProgressState(
  local: UserProgressState,
  remote: UserProgressState,
): UserProgressState {
  const phonemeIds = new Set([...Object.keys(local.phonemes), ...Object.keys(remote.phonemes)]);
  const phonemes: Record<string, PhonemeProgress> = {};
  for (const id of phonemeIds) {
    phonemes[id] = mergePhonemeProgress(local.phonemes[id], remote.phonemes[id]);
  }

  const checkedDays = Array.from(new Set([...local.checkedDays, ...remote.checkedDays])).sort();

  const { favorites, favoriteTombstones } = mergeFavorites(
    local.favorites ?? {},
    local.favoriteTombstones ?? {},
    remote.favorites ?? {},
    remote.favoriteTombstones ?? {},
  );

  return {
    phonemes,
    checkedDays,
    quizStats: {
      totalAnswered: Math.max(local.quizStats.totalAnswered, remote.quizStats.totalAnswered),
      totalCorrect: Math.max(local.quizStats.totalCorrect, remote.quizStats.totalCorrect),
      bestCombo: Math.max(local.quizStats.bestCombo, remote.quizStats.bestCombo),
    },
    favorites,
    favoriteTombstones,
    attempts: mergeAttempts(local.attempts ?? [], remote.attempts ?? []),
  };
}

/**
 * 判断两份状态是否完全一致（用于避免无意义的网络写入）
 */
export function isSameState(a: UserProgressState, b: UserProgressState): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
