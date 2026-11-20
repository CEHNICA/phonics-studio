import type { PhonemeProgress } from '../types/phonics';

/** 连续答对多少次即视为已巩固，自动移出「待巩固」 */
export const CONSOLIDATE_THRESHOLD = 3;

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
