/**
 * 音标学习应用核心类型定义
 */

export type PhonemeFamily = 'vowel' | 'consonant';

export interface PhonemeCategory {
  id: string;
  family: PhonemeFamily;
  title: string;
  description: string;
}

export interface PhonemeExample {
  word: string;
  phonetic: string;
  meaning: string;
}

export interface RawPhonemeItem {
  id: string;
  symbol: string;
  category: string;
  audioSrc: string;
  videoSrc: string;
  pronunciationTips: string[];
  confusionNote: string;
  examples: PhonemeExample[];
}

export interface RawPhoneticsDataset {
  categories: PhonemeCategory[];
  phonemes: RawPhonemeItem[];
}

export interface PhonemeItem extends RawPhonemeItem {
  /** 1 到 48 的序号 */
  order: number;
  /** 所属元音/辅音大类 */
  family: PhonemeFamily;
  /** 分类中文标题 */
  categoryTitle: string;
  /** 本地插画卡片路径 */
  cardSrc: string;
  /** 本地标准发音音频路径 */
  localAudioSrc: string;
  /** 本地口型演示视频路径 */
  localVideoSrc: string;
  /** 口型演示视频首帧封面（视频加载完成前显示） */
  posterSrc: string;
  /** 手绘插画卡片上自带的 A/B/C 三个代表词 */
  cardWords: string[];
}

export interface PhonemeProgress {
  /** 选择或输入的“我的代表词” */
  representativeWord: string;
  /** 是否已完成学习（真掌握或完成口型/拼读通关后解锁） */
  completed: boolean;
  /** 测验累计答错次数，用于筛选待巩固音标；连续答对达标后自动清零 */
  mistakeCount: number;
  /** 该音标连续答对次数，达到阈值即自动移出待巩固 */
  consecutiveCorrect: number;
  /** 最近学习时间戳 */
  lastStudiedAt?: string;
  /** 跟读历史最高匹配分（0-99） */
  speakingBestScore?: number;
  /** 最近一次跟读被声学引擎判定偏向的易混音标 ID */
  lastConfusedWithId?: string;
  /** 是否已完成至少一次本音素的字母拼读拆解练习 */
  blendedCompleted?: boolean;
  /** 是否已通过本音相关的最小对立词辨音检验 */
  minimalPairPassed?: boolean;
  /** 建议下次复习的时间戳（ISO，用于间隔复习队列） */
  nextReviewAt?: string;
}

export interface QuizStats {
  totalAnswered: number;
  totalCorrect: number;
  bestCombo: number;
}

/** 单次答题明细记录（用于跨设备同步与回顾） */
export interface QuizAttempt {
  /** 唯一 ID，合并时用于去重 */
  id: string;
  /** 题目对应的音标 ID */
  phonemeId: string;
  /** 本次是否答对 */
  correct: boolean;
  /** 答对时的连对数 */
  combo: number;
  /** 答题时间（ISO 字符串） */
  at: string;
}

export interface UserProgressState {
  phonemes: Record<string, PhonemeProgress>;
  /** 打卡日期列表 (YYYY-MM-DD) */
  checkedDays: string[];
  quizStats: QuizStats;
  /** 收藏的音标 ID → 收藏时间戳(ms)，取消收藏后记录墓碑时间以便跨设备合并 */
  favorites: Record<string, number>;
  /** 取消收藏的音标 ID → 取消时间戳(ms) */
  favoriteTombstones: Record<string, number>;
  /** 答题明细（本地最多保留最近 MAX_ATTEMPTS 条） */
  attempts: QuizAttempt[];
}

export interface ConfusablePair {
  id: string;
  title: string;
  leftId: string;
  rightId: string;
  tag: string;
  keyDifference: string;
}

export interface StudyDayPlan {
  day: number;
  title: string;
  subtitle: string;
  phonemeIds: string[];
  goalTip: string;
}

export type AppTab = 'studio' | 'plan' | 'pairs' | 'quiz';
