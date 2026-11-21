/**
 * 动效体检器
 *
 * 背景：本项目加了一大批交互动效（卡片弹跳、庆祝音弹跳、连击爆发、选项抖动…）。
 * 踩到的两个真问题：
 *   1. `.combo-badge.hot` 的脉冲动画写成了 `infinite` —— 连击徽章一直挂在顶栏，
 *      无限重绘吃移动端 GPU，视觉上也是永远在闪。
 *   2. 所有动画都没有 `prefers-reduced-motion` 降级 —— 系统里开了「减弱动态效果」
 *      的用户（尤其前庭功能障碍用户）仍会看到全屏位移/缩放动画。
 *
 * 本脚本是「尺子」：加任何新动效后跑一次，缺陷必须归零。
 * 运行：npm run check:motion
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const CSS = join(ROOT, 'src', 'index.css');

type Result = { name: string; ok: boolean; detail: string };

const results: Result[] = [];
const check = (name: string, ok: boolean, detail: string) => {
  results.push({ name, ok, detail });
};

if (!existsSync(CSS)) {
  check('样式文件存在', false, `缺少 ${CSS}`);
} else {
  const css = readFileSync(CSS, 'utf8');

  /* ---------- 1. 收集所有 animation 声明 ---------- */
  // 只取 `animation:` 属性值，排除 animation-name 之类的误匹配
  const animDecls = [...css.matchAll(/(^|[;{\s])animation:\s*([^;}]+)[;}]/g)].map((m) => m[2].trim());

  /* ---------- 2. 不允许 infinite 无限动画 ---------- */
  const infinite = animDecls.filter((v) => /\binfinite\b/.test(v));
  check(
    '没有 infinite 无限循环动画（持续重绘吃 GPU，视觉上永远在闪）',
    infinite.length === 0,
    infinite.length === 0 ? `${animDecls.length} 条动画声明均非无限循环` : `${infinite.length} 条：${infinite.join(' | ')}`,
  );

  /* ---------- 3. 存在 prefers-reduced-motion 降级 ---------- */
  const hasReducedMotion = /@media\s*\(prefers-reduced-motion:\s*reduce\)/.test(css);
  check('存在 prefers-reduced-motion 降级块', hasReducedMotion, hasReducedMotion ? '' : '系统「减弱动态效果」开启后动画不会停');

  /* ---------- 4~5. 降级块的覆盖情况 ---------- */
  // 注意：降级块不存在时，第 4/5 条也要照常输出（明确 FAIL），
  // 不能静默跳过 —— 否则断言总数会变，「N/N 通过」的 N 忽大忽小没法当尺子用。
  if (!hasReducedMotion) {
    check(
      '所有带动画的类在 reduced-motion 下都被覆盖',
      false,
      '没有 reduced-motion 降级块，无从覆盖',
    );
    check(
      'forwards 终态的动画在降级时同时 display:none（否则永远留在屏幕上）',
      false,
      '没有 reduced-motion 降级块，无从处理',
    );
  } else {
    // 取出降级块内容
    const rmIdx = css.indexOf('@media (prefers-reduced-motion: reduce)');
    const rmBlock = css.slice(rmIdx);

    // 找出所有声明了 animation 的选择器
    const animatedSelectors = new Set<string>();
    // 逐条规则扫描：selector { ... animation: ... }
    const ruleRe = /([^{}]+)\{([^{}]*)\}/g;
    let m: RegExpExecArray | null;
    while ((m = ruleRe.exec(css)) !== null) {
      const selector = m[1].trim();
      const body = m[2];
      if (!/(^|[;{\s])animation:\s*[^;}]+[;}]/.test(body)) continue;
      // 跳过 @keyframes 内部（其选择器是百分比）
      if (/^\s*@/.test(selector) || /^\s*\d+%\s*,?\s*$/.test(selector)) continue;
      // 只取最后一个 class（够用：降级块里写的就是 class）
      const classes = selector.match(/\.[A-Za-z0-9_-]+/g);
      if (classes) for (const c of classes) animatedSelectors.add(c);
    }

    const uncovered = [...animatedSelectors].filter((c) => !rmBlock.includes(c));
    check(
      '所有带动画的类在 reduced-motion 下都被覆盖',
      uncovered.length === 0,
      uncovered.length === 0
        ? `${animatedSelectors.size} 个动画类全部覆盖`
        : `${uncovered.length} 个未覆盖：${uncovered.slice(0, 6).join(', ')}${uncovered.length > 6 ? ' …' : ''}`,
    );

    /* ---------- 5. forwards 终态的元素必须 display:none ---------- */
    // forwards 会把元素停在最后一帧；只 animation:none 会让它永远留在屏幕上。
    // 注意：降级块里常写成多选择器一行（`.a,\n.b { display:none }`），
    // 用「类名后面紧跟逗号再跟 {」的正则会匹配不上 —— 那是尺子自己的假阳性。
    // 正确做法：把降级块按规则切开，逐条看 selector 与 body。
    const rmRules: { selector: string; body: string }[] = [];
    const rmRuleRe = /([^{}]+)\{([^{}]*)\}/g;
    let rm: RegExpExecArray | null;
    while ((rm = rmRuleRe.exec(rmBlock)) !== null) {
      rmRules.push({ selector: rm[1].trim(), body: rm[2] });
    }
    const rmHasDisplayNone = (cls: string) =>
      rmRules.some(
        (r) => r.selector.includes(cls) && /display\s*:\s*none/.test(r.body),
      );

    const forwards = [...css.matchAll(/([^{}]+)\{([^{}]*animation:\s*[^;}]*forwards[^;}]*)[;}]/g)]
      .map((m) => ({ selector: m[1].trim(), body: m[2] }))
      .filter((x) => !/^\s*\d+%\s*,?\s*$/.test(x.selector));
    const forwardsUncovered = forwards.filter((x) => {
      const classes = x.selector.match(/\.[A-Za-z0-9_-]+/g) ?? [];
      if (classes.length === 0) return false;
      return !classes.some((c) => rmHasDisplayNone(c));
    });
    check(
      'forwards 终态的动画在降级时同时 display:none（否则永远留在屏幕上）',
      forwardsUncovered.length === 0,
      forwardsUncovered.length === 0
        ? `${forwards.length} 条 forwards 规则已处理`
        : `${forwardsUncovered.length} 条未处理：${forwardsUncovered.map((x) => x.selector).slice(0, 4).join(' | ')}`,
    );
  }
}

/* ---------- 输出 ---------- */
let failed = 0;
for (const r of results) {
  if (!r.ok) failed += 1;
  const mark = r.ok ? 'PASS' : 'FAIL';
  console.log(`[${mark}] ${r.name}${r.detail ? ` — ${r.detail}` : ''}`);
}
console.log(`\n${results.length - failed}/${results.length} 通过`);
if (failed > 0) {
  console.error(`\n${failed} 项缺陷未解决。`);
  process.exit(1);
}
