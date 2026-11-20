import { useCallback, useEffect, useMemo, useState } from 'react';
import { PHONEMES } from '../data/phonics-catalog';
import { applyQuizOutcome, CONSOLIDATE_THRESHOLD } from '../utils/consolidation';
import type { PhonemeProgress, UserProgressState } from '../types/phonics';

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
};

const EMPTY_PHONEME_PROGRESS: PhonemeProgress = {
  representativeWord: '',
  completed: false,
  mistakeCount: 0,
  consecutiveCorrect: 0,
};

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
    };
  } catch {
    // NOTE: 本地数据损坏时回退到空进度，避免页面崩溃
    return DEFAULT_PROGRESS;
  }
}

/**
 * 管理 48 个音标学习进度、代表词、打卡与测验统计的自定义 Hook
 */
export function usePhonicsProgress() {
  const [progress, setProgress] = useState<UserProgressState>(loadInitialProgress);

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
      setProgress((prev) => {
        const current = prev.phonemes[phonemeId] ?? EMPTY_PHONEME_PROGRESS;
        const hasCheckedToday = prev.checkedDays.includes(today);

        // 答对累加连对次数，答错则清零并重新计入待巩固
        const outcome = applyQuizOutcome(current, isCorrect);

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
        };
      });
    },
    [],
  );

  const resetAllProgress = useCallback(() => {
    setProgress(DEFAULT_PROGRESS);
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
    };
  }, [progress.checkedDays.length, progress.phonemes]);

  return {
    progress,
    summary,
    getPhonemeProgress,
    setRepresentativeWord,
    toggleCompleted,
    recordQuizAttempt,
    resetAllProgress,
  };
}
