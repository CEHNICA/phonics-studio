/**
 * 「圈出最顺口的词」的槽位匹配
 *
 * 卡片图上印着三个英文词（A/B/C），用户选中哪个，就要在图上那个词的位置画一个红圈。
 * 这个纯函数只干一件事：把「选中的词」映射成「卡片上第几个词」（0/1/2）。
 *
 * 取不到就返回 -1（不画圈）——比如用户自己写了个词，卡片上根本没有。
 */
export type CircleSlot = { cx: number; cy: number; rx: number; ry: number };

/** 归一化：去首尾空格、转小写 */
function normalize(word: string): string {
  return word.trim().toLowerCase();
}

/**
 * 找出这个词在卡片第几个位置。
 * @param word 用户选中的词（可能是自己写的）
 * @param cardWords 卡片上的三个词（顺序即 A/B/C）
 * @returns 0/1/2；不在卡片上返回 -1
 */
export function circleSlotFor(word: string | null | undefined, cardWords: string[]): number {
  if (!word) {
    return -1;
  }
  const target = normalize(word);
  if (!target) {
    return -1;
  }
  const index = cardWords.findIndex((candidate) => normalize(candidate) === target);
  return index;
}
