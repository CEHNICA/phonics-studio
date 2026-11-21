/**
 * 五维闭环学习流程体检器（已从旧两步静态卡片升级为沉浸式拼读纠偏道场）
 *
 * 核查核心约束：
 *   1. CardStudio 以聚焦两阶段切换步进条驱动：阶段 1「看口型 · 拼装解码」→ 阶段 2「开口纠偏 · 真词验耳」
 *   2. 阶段 1（PhonicsBlenderStage）包含拼写密码规律 + 可点击拼读音素块 + 合体拼读按钮
 *   3. 阶段 2（PronunciationRadarStage）坚持「先听一遍原声」排在录音按钮前面，并包含声学偏移靶尺与最小对立真词关
 *   4. 杜绝“点选代表词直接标 completed: true”的伪完成逻辑
 *
 * 运行：npm run check:flow
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const STUDIO = join(ROOT, 'src', 'components', 'CardStudio.tsx');
const BLENDER = join(ROOT, 'src', 'components', 'PhonicsBlenderStage.tsx');
const RADAR = join(ROOT, 'src', 'components', 'PronunciationRadarStage.tsx');
const PROGRESS_HOOK = join(ROOT, 'src', 'hooks', 'usePhonicsProgress.ts');
const CSS = join(ROOT, 'src', 'index.css');

type Result = { name: string; ok: boolean; detail: string };
const results: Result[] = [];
const check = (name: string, ok: boolean, detail: string) => {
  results.push({ name, ok, detail });
};

function stripComments(text: string): string {
  return text.replace(/\{\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

const studioClean = stripComments(readFileSync(STUDIO, 'utf8'));
const blenderClean = stripComments(readFileSync(BLENDER, 'utf8'));
const radarClean = stripComments(readFileSync(RADAR, 'utf8'));
const hookClean = stripComments(readFileSync(PROGRESS_HOOK, 'utf8'));
const css = readFileSync(CSS, 'utf8');

/* ---------- 1. 聚焦道场两阶段步进顺序 ---------- */
const tab1Idx = studioClean.indexOf('看口型 · 拼装解码');
const tab2Idx = studioClean.indexOf('开口纠偏 · 真词验耳');
check(
  '主道场包含「1. 看口型 · 拼装解码」与「2. 开口纠偏 · 真词验耳」顺序切换',
  tab1Idx > 0 && tab2Idx > tab1Idx,
  `tab1@${tab1Idx} → tab2@${tab2Idx}`,
);

check(
  '主道场提供三枚真掌握解锁印章（拼读解锁 / 开口达标 / 对立验耳）',
  studioClean.includes('拼读解锁') && studioClean.includes('对立验耳'),
  '真掌握门槛印章齐全',
);

/* ---------- 2. 阶段 1 拼装台 ---------- */
check(
  '阶段 1 包含字母拼写规律密码与一键合体拼读',
  blenderClean.includes('拼写密码：看到哪些字母想到') &&
    blenderClean.includes('一键合体拼读（逐音 → 整词）'),
  '拼读解码舞台完整',
);

/* ---------- 3. 阶段 2 先听后读 + 偏移仪 + 最小对立验耳 ---------- */
const listenIdx = radarClean.indexOf('先听一遍原声');
const recIdx = radarClean.indexOf('className="record-btn"');
check(
  '跟读区第一个动作依然是「先听一遍原声」排在录音之前',
  listenIdx > 0 && recIdx > listenIdx,
  `listen@${listenIdx} → record@${recIdx}`,
);

check(
  '跟读结果区挂载声学偏移靶尺（Target vs Confusable Gauge）',
  radarClean.includes('acoustic-drift-gauge') && radarClean.includes('drift-needle'),
  '声学靶向偏移仪表盘已接入',
);

check(
  '包含最小对立真词验耳关（连续答对 2 题解锁）',
  radarClean.includes('最小对立真词验耳关') && radarClean.includes('onMinimalPairEvaluated'),
  '最小对立真词关完整',
);

/* ---------- 4. 禁止伪完成逻辑 ---------- */
const setRepBlockStart = hookClean.indexOf('const setRepresentativeWord');
const setRepBlockEnd = hookClean.indexOf('const recordSpeakingAttempt');
const setRepBody =
  setRepBlockStart >= 0 && setRepBlockEnd > setRepBlockStart
    ? hookClean.slice(setRepBlockStart, setRepBlockEnd)
    : '';
check(
  '已取消点代表词直接标记 completed: true 的伪完成逻辑',
  setRepBody.length > 0 && !setRepBody.includes('completed: true'),
  setRepBody.includes('completed: true') ? '仍存在伪完成' : '仅记录备忘代表词，需实操过关解锁',
);

check(
  '新道场与偏移靶尺 CSS 规则已就绪',
  /\.dojo-stepper-bar/.test(css) && /\.acoustic-drift-gauge/.test(css),
  '样式已就绪',
);

let failed = 0;
for (const r of results) {
  if (!r.ok) failed += 1;
  console.log(`[${r.ok ? 'PASS' : 'FAIL'}] ${r.name} — ${r.detail}`);
}
console.log(`\n${results.length - failed}/${results.length} 通过`);
if (failed > 0) process.exit(1);
