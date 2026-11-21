import type { PhonemeProgress } from '../types/phonics';

/** 连续答对多少次即视为已巩固，自动移出「待巩固」 */
export const CONSOLIDATE_THRESHOLD = 3;

/** 跟读口型通关分数线 */
export const SPEAKING_PASS_SCORE = 72;

/** 测验作答后需要更新的两个计数字段 */
export interface QuizOutcome {
  /** 累计答错次数（连对达标后归零，即移出待巩固） */
  mistakeCount: number;
  /** 该音标连续答对次数 */
  consecutiveCorrect: number;
}

/**
 * 纯函数：计算一次测验作答后的错题计数
 *
 * 规则：
 * - 答错：mistakeCount + 1（重新进入待巩固），consecutiveCorrect 归零
 * - 答对：consecutiveCorrect + 1；累计连对达到 CONSOLIDATE_THRESHOLD 次即视为已巩固，
 *         mistakeCount 归零，自动移出「待巩固」
 */
export function applyQuizOutcome(current: QuizOutcome, isCorrect: boolean): QuizOutcome {
  const consecutiveCorrect = isCorrect ? current.consecutiveCorrect + 1 : 0;
  const rawMistakeCount = isCorrect ? current.mistakeCount : current.mistakeCount + 1;
  const isConsolidated = isCorrect && consecutiveCorrect >= CONSOLIDATE_THRESHOLD;

  return {
    mistakeCount: isConsolidated ? 0 : rawMistakeCount,
    consecutiveCorrect,
  };
}

/** 是否处于「待巩固」状态 */
export function isPendingReview(record: Pick<PhonemeProgress, 'mistakeCount'>): boolean {
  return record.mistakeCount > 0;
}

/**
 * 纯函数：把跟读声学评测与易混偏移结果同步进音标学习记录
 * - 达标 (>= 72) 且无错题时解锁 completed，并安排更长间隔复习
 * - 明显失准 (< 62 且偏向其它音标) 时记入 mistakeCount（待巩固）与 lastConfusedWithId
 */
export function applySpeakingOutcome(
  current: PhonemeProgress,
  score: number,
  confusedWithId?: string,
  nowMs = Date.now(),
): PhonemeProgress {
  const bestScore = Math.max(current.speakingBestScore ?? 0, Math.round(score));
  const passed = score >= SPEAKING_PASS_SCORE;
  const severeMismatch = Boolean(confusedWithId) && score < 64;

  const mistakeCount = passed
    ? Math.max(0, current.mistakeCount)
    : severeMismatch
      ? Math.max(1, current.mistakeCount + 1)
      : current.mistakeCount;

  const consecutiveCorrect = passed
    ? current.consecutiveCorrect + 1
    : severeMismatch
      ? 0
      : current.consecutiveCorrect;

  // 若先前因未达标待巩固，跟读 76+ 且不偏音可帮减 1 次误判压力，但完全移出仍需达标
  const unlockedCompleted = current.completed || passed;
  const daysUntilNextReview = passed && score >= 85 ? 4 : passed ? 2 : 1;
  const nextReviewAt = new Date(nowMs + daysUntilNextReview * 86400 * 1000).toISOString();

  return {
    ...current,
    speakingBestScore: bestScore,
    lastConfusedWithId: confusedWithId ?? (passed ? undefined : current.lastConfusedWithId),
    mistakeCount,
    consecutiveCorrect,
    completed: unlockedCompleted,
    nextReviewAt,
  };
}

/**
 * 纯函数：判断某个音标是否达到“真掌握”
 * 仅靠点代表词或点一次拼读展示不会误算掌握；
 * 必须无未消错题，且完成“开口跟读 >= 72 分”、“最小对立验耳过关”或“课堂核验打卡”之一。
 */
export function isTrueMastered(record: PhonemeProgress): boolean {
  if (record.mistakeCount > 0) {
    return false;
  }
  const hasRealVerifiedPass =
    (record.speakingBestScore ?? 0) >= SPEAKING_PASS_SCORE ||
    Boolean(record.minimalPairPassed);
  return hasRealVerifiedPass || record.completed;
}

/**
 * 计算单个音标的“薄弱紧急度”权重，用于排序全班 / 个人最需攻克的音标 Top N
 */
export function computePhonemeWeakScore(record: PhonemeProgress): number {
  let weight = record.mistakeCount * 35;
  if (record.lastConfusedWithId) {
    weight += 22;
  }
  if (record.speakingBestScore !== undefined && record.speakingBestScore < SPEAKING_PASS_SCORE) {
    weight += SPEAKING_PASS_SCORE - record.speakingBestScore;
  }
  return weight;
}
