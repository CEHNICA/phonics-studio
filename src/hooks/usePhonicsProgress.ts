import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { PHONEMES } from '../data/phonics-catalog';
import { applyQuizOutcome, CONSOLIDATE_THRESHOLD } from '../utils/consolidation';
import { getBackend } from '../services/backend';
import { localBackend } from '../services/backend/local-backend';
import { mergeProgressState, MAX_ATTEMPTS } from '../services/backend/merge';
import { STATE_VERSION } from '../services/backend/types';
import type { BackendState } from '../services/backend/types';
import { getOrCreateDeviceKey } from '../services/backend/user-key';
import {
  buildDeviceHash,
  clearIdentity,
  loadIdentity,
  normalizeJoinCode,
  saveIdentity,
} from '../services/backend/space-client';
import type { SpaceIdentity } from '../services/backend/space-client';
import type { PhonemeProgress, QuizAttempt, UserProgressState } from '../types/phonics';

const STORAGE_KEY = 'phonics-studio-progress-v1';

export { CONSOLIDATE_THRESHOLD };

const DEFAULT_PROGRESS: UserProgressState = {
  phonemes: {},
  checkedDays: [],
  quizStats: {
    totalAnswered: 0,
    totalCorrect: 0,
    bestCombo: 0,
  },
  favorites: {},
  favoriteTombstones: {},
  attempts: [],
};

const EMPTY_PHONEME_PROGRESS: PhonemeProgress = {
  representativeWord: '',
  completed: false,
  mistakeCount: 0,
  consecutiveCorrect: 0,
};

/** 推送到云端的防抖间隔（毫秒） */
const PUSH_DEBOUNCE_MS = 1200;

/** 身份相关操作的结果 */
export interface IdentityActionResult {
  ok: boolean;
  message?: string;
}

/**
 * 获取本地当天的 YYYY-MM-DD 日期字符串
 */
function getTodayDateString(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * 兼容旧版本存档：补齐缺失的 consecutiveCorrect 字段
 */
function normalizePhonemeProgress(raw: Partial<PhonemeProgress>): PhonemeProgress {
  return {
    representativeWord: raw.representativeWord ?? '',
    completed: raw.completed ?? false,
    mistakeCount: raw.mistakeCount ?? 0,
    consecutiveCorrect: raw.consecutiveCorrect ?? 0,
    lastStudiedAt: raw.lastStudiedAt,
  };
}

/**
 * 安全读取本地存储的学习进度
 */
function loadInitialProgress(): UserProgressState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return DEFAULT_PROGRESS;
    }
    const parsed = JSON.parse(raw) as Partial<UserProgressState>;
    const source = parsed.phonemes ?? {};
    const phonemes: Record<string, PhonemeProgress> = {};
    for (const [id, record] of Object.entries(source)) {
      phonemes[id] = normalizePhonemeProgress(record ?? {});
    }
    return {
      phonemes,
      checkedDays: Array.isArray(parsed.checkedDays) ? parsed.checkedDays : [],
      quizStats: {
        totalAnswered: parsed.quizStats?.totalAnswered ?? 0,
        totalCorrect: parsed.quizStats?.totalCorrect ?? 0,
        bestCombo: parsed.quizStats?.bestCombo ?? 0,
      },
      favorites: parsed.favorites && typeof parsed.favorites === 'object' ? parsed.favorites : {},
      favoriteTombstones:
        parsed.favoriteTombstones && typeof parsed.favoriteTombstones === 'object'
          ? parsed.favoriteTombstones
          : {},
      attempts: Array.isArray(parsed.attempts) ? parsed.attempts : [],
    };
  } catch {
    // NOTE: 本地数据损坏时回退到空进度，避免页面崩溃
    return DEFAULT_PROGRESS;
  }
}

/**
 * 判断某个音标当前是否处于收藏状态（取消收藏的墓碑时间更新时视为已取消）
 */
function isFavoriteIn(state: UserProgressState, phonemeId: string): boolean {
  const addedAt = state.favorites?.[phonemeId];
  if (!addedAt) {
    return false;
  }
  const removedAt = state.favoriteTombstones?.[phonemeId] ?? 0;
  return removedAt <= addedAt;
}

/**
 * 管理 48 个音标学习进度、代表词、打卡、测验统计、收藏与答题明细的自定义 Hook
 *
 * 数据策略：本地优先 + 后台同步。
 * - 所有操作先落 localStorage，界面立刻响应；
 * - 加入班级 / 创建个人空间之后，本地进度整份推上云端，换设备用恢复密钥拉回；
 * - 未加入任何空间时不发起任何网络请求，行为与原版完全一致。
 */
export function usePhonicsProgress() {
  const [progress, setProgress] = useState<UserProgressState>(loadInitialProgress);
  const [identity, setIdentity] = useState<SpaceIdentity | null>(() => loadIdentity());
  const [identityError, setIdentityError] = useState<string | null>(null);
  const [identityBusy, setIdentityBusy] = useState<boolean>(false);
  const [deviceKey] = useState<string>(() => getOrCreateDeviceKey());
  const [backendState, setBackendState] = useState<BackendState>(() =>
    getBackend().isConfigured() && loadIdentity() ? 'connecting' : 'local',
  );
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);

  const progressRef = useRef<UserProgressState>(progress);
  const lastPushedRef = useRef<string>('');
  const hydratedRef = useRef<boolean>(false);

  useEffect(() => {
    progressRef.current = progress;
  }, [progress]);

  // 本地持久化
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(progress));
    } catch {
      // 忽略无痕模式或存储空间不足导致的写入失败
    }
  }, [progress]);

  const getPhonemeProgress = useCallback(
    (phonemeId: string): PhonemeProgress => {
      return progress.phonemes[phonemeId] ?? EMPTY_PHONEME_PROGRESS;
    },
    [progress.phonemes],
  );

  const updatePhoneme = useCallback(
    (phonemeId: string, updater: (prev: PhonemeProgress) => PhonemeProgress) => {
      const today = getTodayDateString();
      setProgress((prev) => {
        const current = prev.phonemes[phonemeId] ?? EMPTY_PHONEME_PROGRESS;
        const nextItem = updater(current);
        const hasCheckedToday = prev.checkedDays.includes(today);

        return {
          ...prev,
          phonemes: {
            ...prev.phonemes,
            [phonemeId]: {
              ...nextItem,
              lastStudiedAt: new Date().toISOString(),
            },
          },
          checkedDays: hasCheckedToday ? prev.checkedDays : [...prev.checkedDays, today],
        };
      });
    },
    [],
  );

  const setRepresentativeWord = useCallback(
    (phonemeId: string, word: string) => {
      updatePhoneme(phonemeId, (prev) => ({
        ...prev,
        representativeWord: word,
        completed: true,
      }));
    },
    [updatePhoneme],
  );

  const toggleCompleted = useCallback(
    (phonemeId: string) => {
      updatePhoneme(phonemeId, (prev) => ({
        ...prev,
        completed: !prev.completed,
      }));
    },
    [updatePhoneme],
  );

  const recordQuizAttempt = useCallback(
    (phonemeId: string, isCorrect: boolean, currentCombo: number) => {
      const today = getTodayDateString();
      const attempt: QuizAttempt = {
        id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`,
        phonemeId,
        correct: isCorrect,
        combo: currentCombo,
        at: new Date().toISOString(),
      };
      setProgress((prev) => {
        const current = prev.phonemes[phonemeId] ?? EMPTY_PHONEME_PROGRESS;
        const hasCheckedToday = prev.checkedDays.includes(today);

        // 答对累加连对次数，答错则清零并重新计入待巩固
        const outcome = applyQuizOutcome(current, isCorrect);

        const attempts = [attempt, ...(prev.attempts ?? [])].slice(0, MAX_ATTEMPTS);

        return {
          ...prev,
          phonemes: {
            ...prev.phonemes,
            [phonemeId]: {
              ...current,
              mistakeCount: outcome.mistakeCount,
              consecutiveCorrect: outcome.consecutiveCorrect,
              lastStudiedAt: new Date().toISOString(),
            },
          },
          checkedDays: hasCheckedToday ? prev.checkedDays : [...prev.checkedDays, today],
          quizStats: {
            totalAnswered: prev.quizStats.totalAnswered + 1,
            totalCorrect: prev.quizStats.totalCorrect + (isCorrect ? 1 : 0),
            bestCombo: Math.max(prev.quizStats.bestCombo, currentCombo),
          },
          attempts,
        };
      });
    },
    [],
  );

  /**
   * 收藏 / 取消收藏某个音标
   */
  const toggleFavorite = useCallback((phonemeId: string) => {
    const now = Date.now();
    setProgress((prev) => {
      const favorites = { ...(prev.favorites ?? {}) };
      const favoriteTombstones = { ...(prev.favoriteTombstones ?? {}) };
      if (isFavoriteIn(prev, phonemeId)) {
        delete favorites[phonemeId];
        favoriteTombstones[phonemeId] = now;
      } else {
        favorites[phonemeId] = now;
        delete favoriteTombstones[phonemeId];
      }
      return { ...prev, favorites, favoriteTombstones };
    });
  }, []);

  const isFavorite = useCallback(
    (phonemeId: string) => isFavoriteIn(progress, phonemeId),
    [progress],
  );

  const favoriteIds = useMemo(
    () => Object.keys(progress.favorites ?? {}).filter((id) => isFavoriteIn(progress, id)),
    [progress],
  );

  const resetAllProgress = useCallback(() => {
    setProgress(DEFAULT_PROGRESS);
  }, []);

  /**
   * 写入新的本机身份（加入班级 / 创建空间 / 恢复进度后调用）
   */
  const applyIdentity = useCallback((next: SpaceIdentity) => {
    saveIdentity(next);
    // 身份变了，内容也要重新推一次，避免沿用上一次的「已推送」标记
    lastPushedRef.current = '';
    setIdentity(next);
  }, []);

  /**
   * 把当前状态推送到云端（没有身份 = 纯本机，不推送）
   */
  const pushToCloud = useCallback(
    async (state: UserProgressState): Promise<boolean> => {
      const backend = getBackend();
      if (!backend.isConfigured() || !identity) {
        return false;
      }
      const serialized = JSON.stringify(state);
      if (serialized === lastPushedRef.current) {
        return true;
      }
      const payload = {
        version: STATE_VERSION,
        userKey: identity.memberId,
        state,
        updatedAt: new Date().toISOString(),
      };
      try {
        setBackendState('connecting');
        await backend.save(payload);
        await localBackend.save(payload);
        lastPushedRef.current = serialized;
        setLastSyncedAt(payload.updatedAt);
        setBackendState('synced');
        return true;
      } catch {
        setBackendState('error');
        return false;
      }
    },
    [identity],
  );

  /**
   * 手动触发一次同步（拉取 + 合并 + 推送）
   */
  const syncNow = useCallback(async () => {
    const backend = getBackend();
    if (!backend.isConfigured() || !identity) {
      setBackendState('local');
      return;
    }
    setBackendState('connecting');
    try {
      const remote = await backend.load();
      const merged = remote ? mergeProgressState(progressRef.current, remote.state) : progressRef.current;
      progressRef.current = merged;
      setProgress(merged);
      const ok = await pushToCloud(merged);
      if (!ok) {
        setBackendState('offline');
      }
    } catch (error) {
      setBackendState('offline');
      setIdentityError(error instanceof Error ? error.message : '云端连不上，先用本机数据');
    }
  }, [identity, pushToCloud]);

  /**
   * 启动时拉取并合并；后续变更防抖推送
   */
  useEffect(() => {
    let cancelled = false;
    const backend = getBackend();

    if (!backend.isConfigured() || !identity) {
      // 未配置远端或尚未加入空间：保持纯本地，不发起任何网络请求
      hydratedRef.current = true;
      return () => {
        cancelled = true;
      };
    }

    (async () => {
      setBackendState('connecting');
      try {
        const remote = await backend.load();
        if (cancelled) {
          return;
        }
        const merged = remote
          ? mergeProgressState(progressRef.current, remote.state)
          : progressRef.current;
        progressRef.current = merged;
        setProgress(merged);
        // 合并结果立刻回写云端，保证两端一致
        await pushToCloud(merged);
        if (!cancelled) {
          hydratedRef.current = true;
        }
      } catch (error) {
        if (!cancelled) {
          setBackendState('offline');
          setIdentityError(error instanceof Error ? error.message : '云端连不上，先用本机数据');
          hydratedRef.current = true;
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [identity, pushToCloud]);

  /**
   * 状态变化后防抖推送
   */
  useEffect(() => {
    if (!hydratedRef.current) {
      return;
    }
    const backend = getBackend();
    if (!backend.isConfigured() || !identity) {
      return;
    }
    const timer = setTimeout(() => {
      void pushToCloud(progress);
    }, PUSH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [progress, identity, pushToCloud]);

  /**
   * 用班级码加入班级
   */
  const joinClass = useCallback(
    async (rawCode: string): Promise<IdentityActionResult> => {
      const backend = getBackend();
      if (!backend.joinSpace) {
        return { ok: false, message: '当前后端不支持班级功能' };
      }
      const joinCode = normalizeJoinCode(rawCode);
      setIdentityBusy(true);
      setIdentityError(null);
      try {
        const deviceHash = await buildDeviceHash(deviceKey);
        const result = await backend.joinSpace({ joinCode, deviceHash });
        applyIdentity({
          spaceId: result.spaceId,
          spaceName: result.spaceName,
          kind: result.kind,
          role: result.role,
          memberId: result.memberId,
          recoveryKey: result.recoveryKey,
          joinCode,
          deviceHash,
          joinedAt: new Date().toISOString(),
        });
        return { ok: true };
      } catch (error) {
        const message = error instanceof Error ? error.message : '加入班级失败';
        setIdentityError(message);
        return { ok: false, message };
      } finally {
        setIdentityBusy(false);
      }
    },
    [applyIdentity, deviceKey],
  );

  /**
   * 用恢复密钥找回自己的进度（换设备）
   */
  const recoverProgress = useCallback(
    async (recoveryKey: string): Promise<IdentityActionResult> => {
      const backend = getBackend();
      if (!backend.recoverMember) {
        return { ok: false, message: '当前后端不支持恢复功能' };
      }
      setIdentityBusy(true);
      setIdentityError(null);
      try {
        const deviceHash = await buildDeviceHash(deviceKey);
        const result = await backend.recoverMember({ recoveryKey: recoveryKey.trim(), deviceHash });
        applyIdentity({
          spaceId: result.spaceId,
          spaceName: result.spaceName,
          kind: result.kind,
          role: result.role,
          memberId: result.memberId,
          recoveryKey: recoveryKey.trim(),
          deviceHash,
          joinedAt: new Date().toISOString(),
        });
        // 云端已有进度立刻合并进本地，界面马上能看到
        if (result.state) {
          const merged = mergeProgressState(progressRef.current, result.state);
          progressRef.current = merged;
          setProgress(merged);
        }
        return { ok: true };
      } catch (error) {
        const message = error instanceof Error ? error.message : '恢复进度失败';
        setIdentityError(message);
        return { ok: false, message };
      } finally {
        setIdentityBusy(false);
      }
    },
    [applyIdentity, deviceKey],
  );

  /**
   * 创建班级（老师）：拿到班级码 + 管理码
   */
  const createClass = useCallback(
    async (name: string): Promise<IdentityActionResult> => {
      const backend = getBackend();
      if (!backend.createSpace) {
        return { ok: false, message: '当前后端不支持班级功能' };
      }
      setIdentityBusy(true);
      setIdentityError(null);
      try {
        const deviceHash = await buildDeviceHash(deviceKey);
        const result = await backend.createSpace({
          kind: 'class',
          name: name.trim(),
          deviceHash,
        });
        applyIdentity({
          spaceId: result.spaceId,
          spaceName: result.spaceName,
          kind: result.kind,
          role: result.role,
          memberId: result.memberId,
          recoveryKey: result.recoveryKey,
          ownerKey: result.ownerKey,
          joinCode: result.joinCode,
          deviceHash,
          joinedAt: new Date().toISOString(),
        });
        return { ok: true };
      } catch (error) {
        const message = error instanceof Error ? error.message : '创建班级失败';
        setIdentityError(message);
        return { ok: false, message };
      } finally {
        setIdentityBusy(false);
      }
    },
    [applyIdentity, deviceKey],
  );

  /**
   * 创建个人空间：本地进度整份上云，换设备用恢复密钥拉回
   */
  const createPersonalSpace = useCallback(async (): Promise<IdentityActionResult> => {
    const backend = getBackend();
    if (!backend.createSpace) {
      return { ok: false, message: '当前后端不支持云端身份' };
    }
    setIdentityBusy(true);
    setIdentityError(null);
    try {
      const deviceHash = await buildDeviceHash(deviceKey);
      const result = await backend.createSpace({
        kind: 'personal',
        name: '我的个人空间',
        deviceHash,
      });
      applyIdentity({
        spaceId: result.spaceId,
        spaceName: result.spaceName,
        kind: result.kind,
        role: result.role,
        memberId: result.memberId,
        recoveryKey: result.recoveryKey,
        ownerKey: result.ownerKey,
        deviceHash,
        joinedAt: new Date().toISOString(),
      });
      return { ok: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : '创建个人空间失败';
      setIdentityError(message);
      return { ok: false, message };
    } finally {
      setIdentityBusy(false);
    }
  }, [applyIdentity, deviceKey]);

  /**
   * 退出当前空间，回到纯本机模式（云端数据保留）
   */
  const leaveSpace = useCallback(() => {
    clearIdentity();
    lastPushedRef.current = '';
    setIdentity(null);
    setIdentityError(null);
    setBackendState('local');
  }, []);

  const summary = useMemo(() => {
    let completedCount = 0;
    let needReviewCount = 0;

    for (const item of PHONEMES) {
      const record = progress.phonemes[item.id];
      if (!record) {
        continue;
      }
      if (record.completed) {
        completedCount += 1;
      }
      if (record.mistakeCount > 0) {
        needReviewCount += 1;
      }
    }

    return {
      totalCount: PHONEMES.length,
      completedCount,
      needReviewCount,
      checkedDaysCount: progress.checkedDays.length,
      favoriteCount: favoriteIds.length,
    };
  }, [progress.checkedDays.length, progress.phonemes, favoriteIds.length]);

  return {
    progress,
    summary,
    backendState,
    lastSyncedAt,
    favoriteIds,
    identity,
    identityError,
    identityBusy,
    getPhonemeProgress,
    setRepresentativeWord,
    toggleCompleted,
    recordQuizAttempt,
    toggleFavorite,
    isFavorite,
    resetAllProgress,
    syncNow,
    joinClass,
    recoverProgress,
    createClass,
    createPersonalSpace,
    leaveSpace,
  };
}
