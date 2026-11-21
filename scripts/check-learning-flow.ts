/**
 * 学习流程顺序体检器（第 8 轮追加）
 *
 * 背景：卡片上印着「听一遍，跟读一遍，再圈出读起来最顺口的词」，
 * 网站上的三步顺序必须一眼可见，跟读内部也必须先听后读。
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

/* ---------- 1. 三步编号存在 ---------- */
for (const [step, text] of [
  ['1', '听发音'],
  ['2', '跟读一遍'],
  ['3', '圈出最顺口的词'],
] as const) {
  const ok = clean.includes(`step-num">${step}<`) && clean.includes(text);
  check(
    `第 ${step} 步有编号徽标（${text}）`,
    ok,
    ok ? `第 ${step} 步 = ${text}` : `找不到第 ${step} 步「${text}」的编号徽标`,
  );
}

/* ---------- 2. 圈出在跟读之后（源码 DOM 顺序） ---------- */
const recorderIdx = clean.indexOf('recorder-center-card');
const circleIdx = clean.indexOf('codename-box');
check(
  '圈出区排在跟读区之后（DOM 顺序）',
  recorderIdx > 0 && circleIdx > recorderIdx,
  recorderIdx > 0 && circleIdx > recorderIdx
    ? `跟读 @${recorderIdx} → 圈出 @${circleIdx}`
    : `顺序不对：跟读 @${recorderIdx} / 圈出 @${circleIdx}`,
);
const cardIdx = clean.indexOf('illustrated-card-frame');
check(
  '跟读区排在卡片之后（DOM 顺序）',
  cardIdx > 0 && recorderIdx > cardIdx,
  cardIdx > 0 && recorderIdx > cardIdx
    ? `卡片 @${cardIdx} → 跟读 @${recorderIdx}`
    : `顺序不对：卡片 @${cardIdx} / 跟读 @${recorderIdx}`,
);

/* ---------- 3. 跟读区按钮顺序：先听原声 → 再录音 ---------- */
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

/* ---------- 4. 跟读两小步编号（① 先听 → ② 跟我读） ---------- */
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

/* ---------- 5. 编号徽标样式存在 ---------- */
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
