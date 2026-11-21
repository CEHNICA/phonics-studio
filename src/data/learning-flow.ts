/**
 * 学习流程的**唯一文案源**
 *
 * 为什么要有这个文件：卡片上**印着**一行教学指令，网站上也有一套步骤文案。
 * 这两处以前各写各的，改了一边另一边不跟 —— 结果就是孩子照着卡片做，
 * 跟网站上看到的步骤对不上（本项目第 8 轮就踩过这个坑）。
 *
 * 所以：卡片印刷语和网站步骤都从这里取，`scripts/check-card-print.ts`
 * 会断言「卡片上的印刷语」与「网站步骤」**关键词一致且顺序一致**，
 * 谁单独改了，尺子立刻红。
 *
 * 改动这里之后必须：
 *   1. 同步 `scripts/reprint_card_instruction.py` 的 NEW 常量（尺子会查）
 *   2. 重新生成卡片图：python scripts/reprint_card_instruction.py --cards public/assets/cards --out public/assets/cards
 *   3. 重新推导圈槽位：node scripts/derive-card-word-slots.ts --write src/data/card-word-slots.ts
 *   4. npm run check:print && npm run check:circle && npm run check:cards
 */

/** 第 1 步：听发音 + 圈最顺口的词（都在卡片上完成） */
export const STEP_LISTEN_CIRCLE = '听一遍，圈一圈';

/** 第 2 步：跟读（最后一步） */
export const STEP_READ_ALONG = '跟读一遍';

/**
 * 卡片上印刷的那行指令。
 * 必须包含每一步的全部关键词，且关键词顺序与步骤顺序一致。
 */
export const CARD_INSTRUCTION = '听一遍、圈一圈，再跟读一遍。';

/** 步骤定义（keywords 用于和卡片印刷语做一致性核对） */
export const LEARNING_STEPS: Array<{ num: number; label: string; keywords: string[] }> = [
  { num: 1, label: STEP_LISTEN_CIRCLE, keywords: ['听一遍', '圈一圈'] },
  { num: 2, label: STEP_READ_ALONG, keywords: ['跟读一遍'] },
];
