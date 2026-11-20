/**
 * 云同步合并逻辑回归测试（同步相关的「尺子」）
 * 运行方式：node scripts/test-backend-sync.ts
 *
 * 直接调用生产代码 src/services/backend/merge.ts，验证：
 * 1. 音标进度：最近学习的一方胜出
 * 2. 打卡日期：取并集，不丢任何一天
 * 3. 闯关统计：各项取最大值，只增不减
 * 4. 收藏：取消收藏（墓碑时间较新）可以跨设备生效
 * 5. 答题明细：按 ID 去重后取并集，且不超过条数上限
 */

import {
  MAX_ATTEMPTS,
  mergeAttempts,
  mergeFavorites,
  mergePhonemeProgress,
  mergeProgressState,
} from '../src/services/backend/merge.ts';
import type { PhonemeProgress, QuizAttempt, UserProgressState } from '../src/types/phonics.ts';

let failed = 0;
let passed = 0;

function check(label: string, actual: unknown, expected: unknown): void {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) {
    passed += 1;
    console.log(`  ✓ ${label}`);
  } else {
    failed += 1;
    console.error(`  ✗ ${label}`);
    console.error(`      期望: ${JSON.stringify(expected)}  实际: ${JSON.stringify(actual)}`);
  }
}

function progressRecord(overrides: Partial<PhonemeProgress>): PhonemeProgress {
  return {
    representativeWord: '',
    completed: false,
    mistakeCount: 0,
    consecutiveCorrect: 0,
    ...overrides,
  };
}

function emptyState(): UserProgressState {
  return {
    phonemes: {},
    checkedDays: [],
    quizStats: { totalAnswered: 0, totalCorrect: 0, bestCombo: 0 },
    favorites: {},
    favoriteTombstones: {},
    attempts: [],
  };
}

function attempt(id: string, at: string, correct = true): QuizAttempt {
  return { id, phonemeId: 'phoneme-a', correct, combo: 1, at };
}

console.log('\n[同步] 本地与云端状态合并\n');

// 1. 音标进度以最近学习时间较新的一方为准
{
  const older = progressRecord({
    representativeWord: 'cat',
    completed: true,
    mistakeCount: 2,
    lastStudiedAt: '2026-01-01T00:00:00.000Z',
  });
  const newer = progressRecord({
    representativeWord: 'dog',
    completed: false,
    mistakeCount: 0,
    lastStudiedAt: '2026-02-01T00:00:00.000Z',
  });
  const merged = mergePhonemeProgress(older, newer);
  check('较新的一方胜出（代表词）', merged.representativeWord, 'dog');
  check('较新的一方胜出（已学标记）', merged.completed, false);
  check('较新的一方胜出（错题数）', merged.mistakeCount, 0);
  check('保留最近学习时间', merged.lastStudiedAt, '2026-02-01T00:00:00.000Z');

  const reversed = mergePhonemeProgress(newer, older);
  check('交换顺序结果一致', reversed.representativeWord, 'dog');
}

// 2. 只有一侧有数据时保留该侧
{
  const only = progressRecord({ completed: true, lastStudiedAt: '2026-01-01T00:00:00.000Z' });
  check('仅远端有数据 => 保留远端', mergePhonemeProgress(undefined, only).completed, true);
  check('仅本地有数据 => 保留本地', mergePhonemeProgress(only, undefined).completed, true);
}

// 3. 打卡取并集、统计取最大值
{
  const local = emptyState();
  local.checkedDays = ['2026-03-01', '2026-03-02'];
  local.quizStats = { totalAnswered: 10, totalCorrect: 7, bestCombo: 5 };

  const remote = emptyState();
  remote.checkedDays = ['2026-03-02', '2026-03-03'];
  remote.quizStats = { totalAnswered: 4, totalCorrect: 9, bestCombo: 3 };

  const merged = mergeProgressState(local, remote);
  check('打卡取并集', merged.checkedDays, ['2026-03-01', '2026-03-02', '2026-03-03']);
  check('答题总数取较大值', merged.quizStats.totalAnswered, 10);
  check('答对总数取较大值', merged.quizStats.totalCorrect, 9);
  check('最高连对取较大值', merged.quizStats.bestCombo, 5);
}

// 4. 收藏：取消收藏可以跨设备生效
{
  const added = 1000;
  const removed = 2000;

  const localFavorites = { 'phoneme-a': added };
  const localTombstones = { 'phoneme-a': removed };
  const remoteFavorites = { 'phoneme-a': added };
  const remoteTombstones = {};

  const merged = mergeFavorites(localFavorites, localTombstones, remoteFavorites, remoteTombstones);
  const isFavorite =
    !!merged.favorites['phoneme-a'] && merged.favoriteTombstones['phoneme-a'] <= merged.favorites['phoneme-a'];
  check('本机取消收藏（时间较新）=> 不再收藏', isFavorite, false);

  const stale = mergeFavorites(localFavorites, {}, remoteFavorites, { 'phoneme-a': added - 1 });
  const staleFavorite =
    !!stale.favorites['phoneme-a'] && stale.favoriteTombstones['phoneme-a'] <= stale.favorites['phoneme-a'];
  check('旧的取消记录不会误伤收藏', staleFavorite, true);
}

// 5. 答题明细去重与上限
{
  const a = attempt('a1', '2026-03-01T10:00:00.000Z');
  const b = attempt('b1', '2026-03-01T11:00:00.000Z');
  const merged = mergeAttempts([a, b], [a]);
  check('相同 ID 只保留一条', merged.length, 2);

  const many = Array.from({ length: MAX_ATTEMPTS + 50 }, (_, i) =>
    attempt(`x${i}`, new Date(Date.UTC(2026, 0, 1, 0, 0, i)).toISOString()),
  );
  const capped = mergeAttempts(many, []);
  check(`明细条数不超过上限 ${MAX_ATTEMPTS}`, capped.length, MAX_ATTEMPTS);
}

console.log(`\n结果: ${passed} 通过 / ${failed} 失败\n`);

if (failed > 0) {
  process.exit(1);
}
