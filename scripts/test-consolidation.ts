/**
 * 「待巩固」规则回归测试
 * 运行方式：node scripts/test-consolidation.ts
 *
 * 直接调用生产代码 src/utils/consolidation.ts，验证：
 * 1. 答错进入待巩固
 * 2. 连续答对 3 次自动移出待巩固
 * 3. 移出后再答错会重新回到待巩固
 * 4. 未达阈值时不会提前移出
 */

import {
  applyQuizOutcome,
  CONSOLIDATE_THRESHOLD,
  isPendingReview,
  type QuizOutcome,
} from '../src/utils/consolidation.ts';

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

const zero: QuizOutcome = { mistakeCount: 0, consecutiveCorrect: 0 };

console.log(`\n[规则] 连续答对 ${CONSOLIDATE_THRESHOLD} 次自动移出待巩固\n`);

// 1. 首次答错 -> 进入待巩固
{
  const r = applyQuizOutcome(zero, false);
  check('答错 1 次 => 待巩固', { mistakeCount: r.mistakeCount, pending: isPendingReview(r) }, {
    mistakeCount: 1,
    pending: true,
  });
  check('答错后连对次数归零', r.consecutiveCorrect, 0);
}

// 2. 连对未达阈值 -> 仍留在待巩固
{
  let state = applyQuizOutcome(zero, false);
  for (let i = 0; i < CONSOLIDATE_THRESHOLD - 1; i += 1) {
    state = applyQuizOutcome(state, true);
    check(
      `连对第 ${i + 1} 次仍未移出`,
      { mistakeCount: state.mistakeCount, pending: isPendingReview(state) },
      { mistakeCount: 1, pending: true },
    );
  }
  check('连对进度累计正确', state.consecutiveCorrect, CONSOLIDATE_THRESHOLD - 1);
}

// 3. 连续答对达标 -> 自动移出待巩固
{
  let state = applyQuizOutcome(zero, false);
  for (let i = 0; i < CONSOLIDATE_THRESHOLD; i += 1) {
    state = applyQuizOutcome(state, true);
  }
  check(
    `连对 ${CONSOLIDATE_THRESHOLD} 次 => 自动移出待巩固`,
    { mistakeCount: state.mistakeCount, pending: isPendingReview(state) },
    { mistakeCount: 0, pending: false },
  );
}

// 4. 移出后再答错 -> 重新回到待巩固
{
  let state = applyQuizOutcome(zero, false);
  for (let i = 0; i < CONSOLIDATE_THRESHOLD; i += 1) {
    state = applyQuizOutcome(state, true);
  }
  state = applyQuizOutcome(state, false);
  check(
    '巩固后再答错 => 回到待巩固',
    { mistakeCount: state.mistakeCount, pending: isPendingReview(state), consecutiveCorrect: state.consecutiveCorrect },
    { mistakeCount: 1, pending: true, consecutiveCorrect: 0 },
  );
}

// 5. 连对达标不会影响其它音标的错题计数（各自独立）
{
  let a = applyQuizOutcome(zero, false);
  let b = applyQuizOutcome(zero, false);
  a = applyQuizOutcome(a, false);
  for (let i = 0; i < CONSOLIDATE_THRESHOLD; i += 1) {
    a = applyQuizOutcome(a, true);
  }
  check('A 巩固后 B 的计数不受影响', { a: a.mistakeCount, b: b.mistakeCount }, { a: 0, b: 1 });
}

console.log(`\n结果: ${passed} 通过 / ${failed} 失败\n`);
if (failed > 0) {
  process.exit(1);
}
