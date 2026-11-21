/**
 * 学习流程顺序体检器
 *
 * 背景：卡片上印着「听一遍，跟读一遍，再圈出读起来最顺口的那个词」，
 * 但网站上的流程是**两步**，不是三步：
 *
 *   第 1 步：听一遍 + 圈一圈（都在卡片上完成 —— 听音标、听单词、圈出最顺口的那个词）
 *   第 2 步：跟读一遍（最后一步）
 *
 * 「圈出」是第 1 步的一部分，不是独立的第 3 步。
 * 物理顺序：卡片 → 圈出区 → 跟读区（跟读在最后）。
 * 跟读区内部还必须是先听后读。
 *
 * 本脚本是「尺子」：改这块前后各跑一次，缺陷必须归零。
 *
 * 运行：npm run check:flow
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const STUDIO = join(ROOT, 'src', 'components', 'CardStudio.tsx');
const CSS = join(ROOT, 'src', 'index.css');

type Result = { name: string; ok: boolean; detail: string; skip?: boolean };
const results: Result[] = [];
const check = (name: string, ok: boolean, detail: string) => {
  results.push({ name, ok, detail });
};

const src = readFileSync(STUDIO, 'utf8');
const css = readFileSync(CSS, 'utf8');

/**
 * 剥掉注释再断言。
 *
 * 踩过的坑：JSX 注释里也写着按钮文案，全文 grep 会把注释当成真按钮 ——
 * 改坏了按钮文案尺子照样全绿（假绿）。
 * 所有「某个文案不该出现 / 该出现在第几个」的断言都必须在剥干净的源码上做。
 */
function stripComments(text: string): string {
  return text
    .replace(/\{\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}
const clean = stripComments(src);

/* ---------- 1. 两步编号存在（第 1 步 = 听一遍 + 圈一圈） ---------- */
check(
  '第 1 步编号徽标是「听一遍，圈一圈」',
  clean.includes('step-num">1<') && /听一遍[，,]\s*圈一圈/.test(clean),
  /听一遍[，,]\s*圈一圈/.test(clean) ? '第 1 步 = 听一遍，圈一圈' : '找不到「听一遍，圈一圈」',
);
check(
  '第 2 步编号徽标是「跟读一遍」',
  clean.includes('step-num">2<') && clean.includes('跟读一遍'),
  clean.includes('跟读一遍') ? '第 2 步 = 跟读一遍' : '找不到「跟读一遍」',
);
check(
  '没有第 3 步（圈出不是独立一步）',
  !clean.includes('step-num">3<'),
  clean.includes('step-num">3<') ? '还有第 3 步徽标' : '只有两步',
);

/* ---------- 2. 物理顺序：卡片 → 圈出区 → 跟读区 ---------- */
const cardIdx = clean.indexOf('illustrated-card-frame');
const circleIdx = clean.indexOf('codename-box');
const recorderIdx = clean.indexOf('recorder-center-card');
check(
  '圈出区紧跟卡片（在卡片之后）',
  cardIdx > 0 && circleIdx > cardIdx,
  cardIdx > 0 && circleIdx > cardIdx
    ? `卡片 @${cardIdx} → 圈出 @${circleIdx}`
    : `顺序不对：卡片 @${cardIdx} / 圈出 @${circleIdx}`,
);
check(
  '跟读区在圈出区之后（跟读是最后一步）',
  circleIdx > 0 && recorderIdx > circleIdx,
  circleIdx > 0 && recorderIdx > circleIdx
    ? `圈出 @${circleIdx} → 跟读 @${recorderIdx}`
    : `顺序不对：圈出 @${circleIdx} / 跟读 @${recorderIdx}`,
);
check(
  '跟读区在卡片之后',
  cardIdx > 0 && recorderIdx > cardIdx,
  cardIdx > 0 && recorderIdx > cardIdx
    ? `卡片 @${cardIdx} → 跟读 @${recorderIdx}`
    : `顺序不对：卡片 @${cardIdx} / 跟读 @${recorderIdx}`,
);

/* ---------- 3. 第 1 步徽标在卡片之前（编号徽标统领卡片 + 圈出） ---------- */
/**
 * 注意：下面两条顺序断言都加了「徽标存在才判」的守卫。
 * 否则「删掉徽标」这个缺陷会同时红在「有编号徽标」和「徽标在卡片之前」两条上，
 * 逐项退回时就无法精确对上一条（用户铁律：每条缺陷精确红在自己那条）。
 * 存在性由第 1 组断言管，顺序由这两条管，各司其职。
 */
const badge1Idx = clean.indexOf('step-num">1<');
const badge2Idx = clean.indexOf('step-num">2<');
check(
  '第 1 步徽标在卡片之前',
  badge1Idx < 0 || (cardIdx > 0 && badge1Idx < cardIdx),
  badge1Idx < 0
    ? '第 1 步徽标不存在（由「有编号徽标」那条负责）'
    : badge1Idx < cardIdx
      ? `徽标1 @${badge1Idx} → 卡片 @${cardIdx}`
      : `顺序不对：徽标1 @${badge1Idx} / 卡片 @${cardIdx}`,
);
check(
  '第 2 步徽标在跟读区之前',
  badge2Idx < 0 || (recorderIdx > 0 && badge2Idx < recorderIdx && badge2Idx > circleIdx),
  badge2Idx < 0
    ? '第 2 步徽标不存在（由「有编号徽标」那条负责）'
    : badge2Idx < recorderIdx && badge2Idx > circleIdx
      ? `徽标2 @${badge2Idx} → 跟读 @${recorderIdx}`
      : `顺序不对：徽标2 @${badge2Idx} / 跟读 @${recorderIdx}`,
);

/* ---------- 4. 跟读区按钮顺序：先听原声 → 再录音 ---------- */
/** 取跟读区 recorder-actions 的 JSX 片段（用剥干净的源码，避免注释喂饱断言） */
const actionsStart = clean.indexOf('recorder-actions');
const actionsEnd = clean.indexOf('</div>', clean.indexOf('recorder.errorMessage'));
const actions = clean.slice(
  actionsStart,
  actionsEnd > actionsStart ? actionsEnd : actionsStart + 4000,
);

const listenBtnIdx = actions.indexOf('先听一遍原声');
const recordBtnIdx = actions.indexOf('className="record-btn"');
check(
  '跟读区第一个动作是「先听一遍原声」',
  listenBtnIdx > 0 && recordBtnIdx > 0 && listenBtnIdx < recordBtnIdx,
  listenBtnIdx > 0 && recordBtnIdx > 0
    ? `听原声 @${listenBtnIdx} / 录音 @${recordBtnIdx}`
    : `按钮缺失：听原声 @${listenBtnIdx} / 录音 @${recordBtnIdx}`,
);
check(
  '跟读区有「先听一遍原声」按钮',
  /先听一遍原声/.test(actions),
  /先听一遍原声/.test(actions) ? '已提供' : '没有这个按钮',
);
check(
  '旧文案「只听原声」不再作为主按钮出现',
  !actions.includes('只听原声'),
  actions.includes('只听原声') ? '跟读区还留着「只听原声」' : '已统一为「先听一遍原声」',
);

/* ---------- 5. 跟读两小步编号（① 先听 → ② 跟我读） ---------- */
check(
  '跟读区有 ① 先听原声 小步提示',
  /先听原声/.test(clean),
  /先听原声/.test(clean) ? '有' : '没有',
);
check(
  '跟读区有 ② 跟我读 小步提示',
  /跟我读/.test(clean),
  /跟我读/.test(clean) ? '有' : '没有',
);

/* ---------- 6. 圈出区归第 1 步（文案点明它属于「听一遍，圈一圈」） ---------- */
check(
  '第 1 步提示里点明包含「圈」',
  /听一遍[，,]\s*圈一圈/.test(clean) && /圈出|圈一圈/.test(clean),
  '第 1 步文案已包含圈出',
);
check(
  '圈出区标题仍是「圈出读起来最顺口的那个词」',
  clean.includes('圈出读起来最顺口的那个词'),
  clean.includes('圈出读起来最顺口的那个词') ? '标题正确' : '标题被改了',
);

/* ---------- 7. 编号徽标样式存在 ---------- */
check(
  'CSS 有步骤编号徽标样式',
  /\.step-badge/.test(css) && /\.step-num/.test(css),
  /\.step-badge/.test(css) && /\.step-num/.test(css) ? '已定义' : '缺 .step-badge / .step-num',
);

/* ---------- 输出 ---------- */
let failed = 0;
for (const r of results) {
  if (r.ok) {
    console.log(`[PASS] ${r.name} — ${r.detail}`);
  } else {
    failed++;
    console.log(`[FAIL] ${r.name} — ${r.detail}`);
  }
}
console.log(`\n${results.length - failed}/${results.length} 通过`);
if (failed > 0) process.exit(1);
