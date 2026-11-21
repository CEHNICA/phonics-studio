import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { PHONEMES } from '../data/phonics-catalog';
import {
  applyQuizOutcome,
  applySpeakingOutcome,
  computePhonemeWeakScore,
  CONSOLIDATE_THRESHOLD,
  isTrueMastered,
} from '../utils/consolidation';
import { getBackend } from '../services/backend';
import { localBackend } from '../services/backend/local-backend';
import { mergeProgressState, MAX_ATTEMPTS } from '../services/backend/merge';
import { STATE_VERSION } from '../services/backend/types';
import type { AccountKind, AuthResult, BackendState, Membership } from '../services/backend/types';
import { accountSession } from '../services/backend/account-session';
import type { AccountSession } from '../services/backend/account-session';
import { normalizeBackendError } from '../services/backend/error-messages';
import { normalizeJoinCode } from '../services/backend/account-client';
import type { PhonemeProgress, QuizAttempt, UserProgressState } from '../types/phonics';

const STORAGE_KEY = 'phonics-studio-progress-v1';
/** 登录后按账号分区存本机进度，避免同一台电脑上多个账号互相污染 */
const ACCOUNT_STORAGE_PREFIX = 'phonics-studio-progress-v2:';

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

/** 跟服务端对齐账号状态的最短间隔（毫秒）：别把后端打太勤 */
const ACCOUNT_SYNC_INTERVAL_MS = 30000;

/** 身份相关操作的结果 */
export interface AuthActionResult {
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
    ...(raw.speakingBestScore !== undefined ? { speakingBestScore: raw.speakingBestScore } : {}),
    ...(raw.lastConfusedWithId ? { lastConfusedWithId: raw.lastConfusedWithId } : {}),
    ...(raw.blendedCompleted ? { blendedCompleted: raw.blendedCompleted } : {}),
    ...(raw.minimalPairPassed ? { minimalPairPassed: raw.minimalPairPassed } : {}),
    ...(raw.nextReviewAt ? { nextReviewAt: raw.nextReviewAt } : {}),
  };
}

/**
 * 安全读取本地存储的学习进度
 */
function loadInitialProgress(storageKey: string): UserProgressState {
  try {
    const raw = localStorage.getItem(storageKey);
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
 * - 未登录时不发起任何网络请求，行为与原版完全一致；
 * - 登录后本地进度按账号分区，并与云端同名账号的进度合并；
 * - 登录 + 在班级里 = 进度同步到班级云端（成员之间互相隔离）。
 */
export function usePhonicsProgress() {
  const [session, setSession] = useState<AccountSession | null>(() => accountSession.load());
  const [progress, setProgress] = useState<UserProgressState>(() =>
    loadInitialProgress(STORAGE_KEY),
  );
  const [authError, setAuthError] = useState<string | null>(null);
  const [authBusy, setAuthBusy] = useState<boolean>(false);
  const [backendState, setBackendState] = useState<BackendState>(() =>
    getBackend().isConfigured() && accountSession.load() ? 'connecting' : 'local',
  );
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);

  /** 当前进度存在哪个 key：登录按账号分区，未登录用匿名分区 */
  const storageKey = session ? `${ACCOUNT_STORAGE_PREFIX}${session.account.username}` : STORAGE_KEY;

  const progressRef = useRef<UserProgressState>(progress);
  const lastPushedRef = useRef<string>('');
  const hydratedRef = useRef<boolean>(false);
  /** 会话最新值：异步回调里别拿闭包里的旧值 */
  const sessionRef = useRef<AccountSession | null>(session);
  /** 上次跟服务端对齐账号状态的时间（避免频繁请求） */
  const lastAccountSyncRef = useRef<number>(0);

  useEffect(() => {
    progressRef.current = progress;
  }, [progress]);

  // 本地持久化（跟着当前账号分区走）
  useEffect(() => {
    try {
      localStorage.setItem(storageKey, JSON.stringify(progress));
    } catch {
      // 忽略无痕模式或存储空间不足导致的写入失败
    }
  }, [progress, storageKey]);

  // 账号变了 → 换一份本机进度；同时重置「已推送」标记
  useEffect(() => {
    const next = loadInitialProgress(storageKey);
    progressRef.current = next;
    lastPushedRef.current = '';
    let cancelled = false;
    (async () => {
      if (cancelled) {
        return;
      }
      setProgress(next);
    })();
    return () => {
      cancelled = true;
    };
  }, [storageKey]);

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
      // NOTE: 选词/记代表词只是记忆线索，不直接标为“已学完成”；
      // 真正完成需经过拼读、跟读达标或最小对立词过关
      updatePhoneme(phonemeId, (prev) => ({
        ...prev,
        representativeWord: word,
      }));
    },
    [updatePhoneme],
  );

  /**
   * 将跟读声学评测与易混偏移结论写入进度与待巩固队列
   */
  const recordSpeakingAttempt = useCallback(
    (phonemeId: string, score: number, confusedWithId?: string) => {
      updatePhoneme(phonemeId, (prev) => applySpeakingOutcome(prev, score, confusedWithId));
    },
    [updatePhoneme],
  );

  /**
   * 记录完成该音标的字母拼装拆解练习
   */
  const markBlendedCompleted = useCallback(
    (phonemeId: string) => {
      updatePhoneme(phonemeId, (prev) => ({
        ...prev,
        blendedCompleted: true,
      }));
    },
    [updatePhoneme],
  );

  /**
   * 记录最小对立词辨音检验结果：达标解锁，失误计入待巩固
   */
  const markMinimalPairPassed = useCallback(
    (phonemeId: string, passed: boolean) => {
      updatePhoneme(phonemeId, (prev) => {
        if (passed) {
          return {
            ...prev,
            minimalPairPassed: true,
            completed: true,
          };
        }
        return {
          ...prev,
          mistakeCount: prev.mistakeCount + 1,
          consecutiveCorrect: 0,
        };
      });
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
   * 写入新的会话（登录 / 注册 / 刷新班级状态后调用）
   */
  const applySession = useCallback((next: AccountSession) => {
    accountSession.save(next);
    setSession(next);
  }, []);

  /**
   * 登录 / 注册成功后，把服务端返回的会话落地
   */
  const applyAuthResult = useCallback(
    (result: AuthResult) => {
      applySession({
        token: result.token,
        account: result.account,
        membership: result.membership,
        savedAt: new Date().toISOString(),
      });
    },
    [applySession],
  );

  /**
   * 刷新当前账号的班级状态（加入 / 建班 / 退出之后调用）
   */
  const refreshMembership = useCallback(async (): Promise<Membership | null> => {
    const backend = getBackend();
    if (!backend.isConfigured() || !session) {
      return null;
    }
    const data = await backend.me(session.token);
    applySession({ ...session, account: data.account, membership: data.membership });
    return data.membership;
  }, [applySession, session]);

  // 会话变化时同步给 ref（异步回调里用最新值）
  useEffect(() => {
    sessionRef.current = session;
  }, [session]);

  /**
   * 跟服务端对齐账号状态：先预热连接，再拉最新的身份与班级状态
   *
   * 为什么两件事都要做（第 9 轮实测拿到的坑）：
   * - 预热：后端在跨境（*.pages.dev），首次连接碰上丢包会挂好几秒。
   *   用户点「创建班级」时正好撞在这条冷启动路径上，请求被浏览器掐断，
   *   班级根本没建出来。提前把连接打通，点按钮时就是热连接。
   * - 校准：本地会话是登录那一刻的快照。用户在别的设备建过班、
   *   或者身份被改过，本地那份就是过期数据。界面一直拿它当真相的话，
   *   会出现「界面说还没建班级，服务端说已经在班里」的死结。
   *
   * 校准失败不打扰用户：保持本地会话，等用户主动操作时再报错。
   */
  const syncAccountState = useCallback(async (): Promise<void> => {
    const backend = getBackend();
    if (!backend.isConfigured()) {
      return;
    }
    const now = Date.now();
    if (now - lastAccountSyncRef.current < ACCOUNT_SYNC_INTERVAL_MS) {
      return;
    }
    lastAccountSyncRef.current = now;

    // 预热：只探连通性，不碰任何用户数据
    void backend.ping();

    const latest = sessionRef.current;
    if (!latest) {
      return;
    }
    try {
      const data = await backend.me(latest.token);
      const current = sessionRef.current;
      if (!current) {
        return;
      }
      applySession({ ...current, account: data.account, membership: data.membership });
    } catch {
      // 连不上就先不校准，保持本地会话
    }
  }, [applySession]);

  // 登录状态下，进页面就跟服务端对齐一次账号状态
  useEffect(() => {
    if (!session) {
      return;
    }
    void syncAccountState();
  }, [session, syncAccountState]);

  /**
   * 把当前状态推送到云端（没登录 / 还没加入班级 / 没接入远端 = 纯本机，不推送）
   */
  const pushToCloud = useCallback(
    async (state: UserProgressState): Promise<boolean> => {
      const backend = getBackend();
      if (!backend.isConfigured() || !session) {
        return false;
      }
      if (!session.membership) {
        // 还没加入班级：云端没有可写的成员通道，本机保存即可，不算同步失败
        setBackendState('local');
        return true;
      }
      const serialized = JSON.stringify(state);
      if (serialized === lastPushedRef.current) {
        return true;
      }
      const payload = {
        version: STATE_VERSION,
        accountId: session.account.username,
        state,
        updatedAt: new Date().toISOString(),
      };
      try {
        setBackendState('connecting');
        await backend.save(session.token, payload);
        await localBackend.save(session.account.username, payload);
        lastPushedRef.current = serialized;
        setLastSyncedAt(payload.updatedAt);
        setBackendState('synced');
        return true;
      } catch {
        setBackendState('error');
        return false;
      }
    },
    [session],
  );

  /**
   * 手动触发一次同步（拉取 + 合并 + 推送）
   */
  const syncNow = useCallback(async () => {
    const backend = getBackend();
    if (!backend.isConfigured() || !session) {
      setBackendState('local');
      return;
    }
    if (!session.membership) {
      // 还没加入班级：没有云端通道，别报同步失败
      setBackendState('local');
      setAuthError('还没加入班级，进班之后才会同步到云端');
      return;
    }
    setBackendState('connecting');
    try {
      const remote = await backend.load(session.token);
      const merged = remote ? mergeProgressState(progressRef.current, remote.state) : progressRef.current;
      progressRef.current = merged;
      setProgress(merged);
      const ok = await pushToCloud(merged);
      if (!ok) {
        setBackendState('offline');
      }
    } catch (error) {
      setBackendState('offline');
      setAuthError(error instanceof Error ? error.message : '云端连不上，先用本机数据');
    }
  }, [session, pushToCloud]);

  /**
   * 启动时拉取并合并；后续变更防抖推送
   */
  useEffect(() => {
    let cancelled = false;
    const backend = getBackend();

    if (!backend.isConfigured() || !session) {
      // 未接入远端或未登录：保持纯本地，不发起任何网络请求
      hydratedRef.current = true;
      return () => {
        cancelled = true;
      };
    }
    if (!session.membership) {
      // 已登录但还没加入班级：没有成员通道，不请求云端（也不算失败）
      hydratedRef.current = true;
      void (async () => {
        setBackendState('local');
      })();
      return () => {
        cancelled = true;
      };
    }

    (async () => {
      setBackendState('connecting');
      try {
        const remote = await backend.load(session.token);
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
          setAuthError(error instanceof Error ? error.message : '云端连不上，先用本机数据');
          hydratedRef.current = true;
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [session, pushToCloud]);

  /**
   * 状态变化后防抖推送
   */
  useEffect(() => {
    if (!hydratedRef.current) {
      return;
    }
    const backend = getBackend();
    if (!backend.isConfigured() || !session) {
      return;
    }
    const timer = setTimeout(() => {
      void pushToCloud(progress);
    }, PUSH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [progress, session, pushToCloud]);

  /**
   * 注册账号（不需要任何验证方式）
   *
   * 身份在注册时就定下来：
   * - 学生：随便注册，之后只能用班级码加入班级；
   * - 老师：必须带教师邀请码，服务端校验通过才算老师。
   */
  const register = useCallback(
    async (
      username: string,
      password: string,
      displayName?: string,
      role?: AccountKind,
      teacherCode?: string,
    ): Promise<AuthActionResult> => {
      const backend = getBackend();
      if (!backend.isConfigured()) {
        return { ok: false, message: '当前没有接入云端，账号功能不可用' };
      }
      setAuthBusy(true);
      setAuthError(null);
      try {
        const result = await backend.register({
          username: username.trim(),
          password,
          displayName: displayName?.trim() || undefined,
          role: role ?? 'student',
          teacherCode: teacherCode?.trim() || undefined,
        });
        applyAuthResult(result);
        return { ok: true };
      } catch (error) {
        const message = error instanceof Error ? error.message : '注册失败';
        setAuthError(message);
        return { ok: false, message };
      } finally {
        setAuthBusy(false);
      }
    },
    [applyAuthResult],
  );

  /**
   * 登录
   */
  const login = useCallback(
    async (username: string, password: string): Promise<AuthActionResult> => {
      const backend = getBackend();
      if (!backend.isConfigured()) {
        return { ok: false, message: '当前没有接入云端，账号功能不可用' };
      }
      setAuthBusy(true);
      setAuthError(null);
      try {
        const result = await backend.login({ username: username.trim(), password });
        applyAuthResult(result);
        return { ok: true };
      } catch (error) {
        const message = error instanceof Error ? error.message : '登录失败';
        setAuthError(message);
        return { ok: false, message };
      } finally {
        setAuthBusy(false);
      }
    },
    [applyAuthResult],
  );

  /**
   * 退出登录（本机进度保留，云端数据保留）
   */
  const logout = useCallback(async () => {
    const backend = getBackend();
    const token = session?.token;
    accountSession.clear();
    lastPushedRef.current = '';
    setSession(null);
    setAuthError(null);
    setBackendState('local');
    if (backend.isConfigured() && token) {
      try {
        await backend.logout(token);
      } catch {
        // 服务端会话没删掉也不影响本机登出
      }
    }
  }, [session]);

  /**
   * 修改自己的密码
   */
  const changePassword = useCallback(
    async (oldPassword: string, newPassword: string): Promise<AuthActionResult> => {
      const backend = getBackend();
      if (!backend.isConfigured() || !session) {
        return { ok: false, message: '请先登录' };
      }
      setAuthBusy(true);
      setAuthError(null);
      try {
        await backend.changePassword(session.token, oldPassword, newPassword);
        return { ok: true };
      } catch (error) {
        const message = error instanceof Error ? error.message : '修改密码失败';
        setAuthError(message);
        return { ok: false, message };
      } finally {
        setAuthBusy(false);
      }
    },
    [session],
  );

  /**
   * 用班级码加入班级
   */
  const joinClass = useCallback(
    async (rawCode: string): Promise<AuthActionResult> => {
      const backend = getBackend();
      if (!backend.isConfigured() || !session) {
        return { ok: false, message: '请先登录' };
      }
      setAuthBusy(true);
      setAuthError(null);
      try {
        await backend.joinClass(session.token, normalizeJoinCode(rawCode));
        await refreshMembership();
        return { ok: true };
      } catch (error) {
        const message = error instanceof Error ? error.message : '加入班级失败';
        setAuthError(message);
        return { ok: false, message };
      } finally {
        setAuthBusy(false);
      }
    },
    [refreshMembership, session],
  );

  /**
   * 创建班级（老师）：拿到班级码
   */
  const createClass = useCallback(
    async (name: string): Promise<AuthActionResult> => {
      const backend = getBackend();
      if (!backend.isConfigured() || !session) {
        return { ok: false, message: '请先登录' };
      }
      setAuthBusy(true);
      setAuthError(null);
      try {
        await backend.createClass(session.token, name.trim() || '我的班级');
        await refreshMembership();
        return { ok: true };
      } catch (error) {
        const message = normalizeBackendError(error, '创建班级失败');
        // 请求可能其实成功了（响应在路上丢了）：
        // 回头看一眼班级状态，真建出来了就把班级码显示出来，别让用户白等
        try {
          const membership = await refreshMembership();
          if (membership) {
            setAuthError(null);
            return { ok: true };
          }
        } catch {
          // 刷新也失败，就还是显示上面的错误
        }
        setAuthError(message);
        return { ok: false, message };
      } finally {
        setAuthBusy(false);
      }
    },
    [refreshMembership, session],
  );

  /**
   * 退出当前班级（学生只退自己；老师等于撤销班级）
   */
  const leaveClass = useCallback(async (): Promise<AuthActionResult> => {
    const backend = getBackend();
    if (!backend.isConfigured() || !session) {
      return { ok: false, message: '请先登录' };
    }
    setAuthBusy(true);
    setAuthError(null);
    try {
      await backend.leaveClass(session.token);
      await refreshMembership();
      return { ok: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : '退出班级失败';
      setAuthError(message);
      return { ok: false, message };
    } finally {
      setAuthBusy(false);
    }
  }, [refreshMembership, session]);

  const summary = useMemo(() => {
    let completedCount = 0;
    let trueMasteredCount = 0;
    let needReviewCount = 0;
    const weakRank: Array<{ id: string; score: number }> = [];

    for (const item of PHONEMES) {
      const record = progress.phonemes[item.id];
      if (!record) {
        continue;
      }
      if (record.completed) {
        completedCount += 1;
      }
      if (isTrueMastered(record)) {
        trueMasteredCount += 1;
      }
      if (record.mistakeCount > 0) {
        needReviewCount += 1;
      }
      const weakScore = computePhonemeWeakScore(record);
      if (weakScore > 0) {
        weakRank.push({ id: item.id, score: weakScore });
      }
    }

    const weakTopIds = weakRank
      .sort((a, b) => b.score - a.score)
      .slice(0, 6)
      .map((item) => item.id);

    return {
      totalCount: PHONEMES.length,
      completedCount,
      trueMasteredCount,
      needReviewCount,
      weakTopIds,
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
    /** 当前会话：null = 未登录（纯本机） */
    session,
    /** 当前账号的班级状态 */
    membership: session?.membership ?? null,
    authError,
    authBusy,
    getPhonemeProgress,
    setRepresentativeWord,
    recordSpeakingAttempt,
    markBlendedCompleted,
    markMinimalPairPassed,
    toggleCompleted,
    recordQuizAttempt,
    toggleFavorite,
    isFavorite,
    resetAllProgress,
    syncNow,
    register,
    login,
    logout,
    changePassword,
    joinClass,
    createClass,
    leaveClass,
    /** 跟服务端对齐账号状态（预热连接 + 校准身份与班级） */
    syncAccountState,
  };
}
