/**
 * 音频加载性能体检器
 *
 * 背景：国内网络下「口型演示实验室」的音标发音与单词朗读要「点了就响」。
 * 真因不是 CDN 带宽，是三件事叠加：
 *   1. 源站 `Cache-Control: no-store` → 浏览器不缓存，体积就是下载延迟；
 *   2. 音频规格冗余（音标音频曾用 44.1kHz 立体声，语音根本用不上）；
 *   3. 预加载无并发上限，弱网下多个预载互相抢带宽，把「马上要听的那个」拖慢。
 *
 * 本脚本是「尺子」：改音频素材或播放逻辑前后各跑一次，缺陷必须归零。
 * 运行：npm run check:audio
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const SOUND_DIR = join(ROOT, 'public', 'assets', 'sound');
const WORDS_DIR = join(ROOT, 'public', 'assets', 'words');
const CATALOG = join(ROOT, 'src', 'data', 'phonics-catalog.ts');
const PHONETICS = join(ROOT, 'src', 'data', 'phonetics.json');
const HOOK = join(ROOT, 'src', 'hooks', 'useAudioPlayer.ts');

/** 单个音标音频体积预算（字节） */
const MAX_SOUND_BYTES = 12 * 1024;
/** 单个单词音频体积预算（字节） */
const MAX_WORD_BYTES = 8 * 1024;
/** 音标音频总体积预算（字节） */
const MAX_SOUND_TOTAL = 400 * 1024;
/** 单词音频总体积预算（字节） */
const MAX_WORDS_TOTAL = 1024 * 1024;
/** 预加载并发上限上限（超过就会在弱网下互相抢带宽） */
const MAX_ALLOWED_PARALLEL = 3;

type Result = { name: string; ok: boolean; detail: string };
const results: Result[] = [];
const check = (name: string, ok: boolean, detail: string) => {
  results.push({ name, ok, detail });
};

/* ---------- 1. 素材层：文件数量、版本、体积 ---------- */
const listDir = (dir: string) =>
  existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.mp3')) : null;

const soundFiles = listDir(SOUND_DIR);
const wordFiles = listDir(WORDS_DIR);

if (!soundFiles) {
  check('音标音频目录存在', false, `缺少 ${SOUND_DIR}`);
} else {
  const legacy = soundFiles.filter((f) => !f.endsWith('.v2.mp3'));
  check('音标音频 48 个', soundFiles.length === 48, `实际 ${soundFiles.length} 个`);
  check(
    '音标音频全部为 .v2.mp3 版本',
    legacy.length === 0,
    legacy.length === 0 ? '' : `遗留旧版：${legacy.slice(0, 5).join(', ')}`,
  );
  let total = 0;
  let max = 0;
  let maxName = '';
  const over: string[] = [];
  for (const f of soundFiles) {
    const size = statSync(join(SOUND_DIR, f)).size;
    total += size;
    if (size > max) {
      max = size;
      maxName = f;
    }
    if (size > MAX_SOUND_BYTES) over.push(`${f}(${Math.round(size / 1024)}KB)`);
  }
  check(
    '单个音标音频在预算内',
    over.length === 0,
    over.length === 0 ? `最大 ${maxName} ${Math.round(max / 1024)}KB` : `${over.length} 个超预算`,
  );
  check(
    '音标音频总体积在预算内',
    total <= MAX_SOUND_TOTAL,
    `${Math.round(total / 1024)}KB / 预算 ${Math.round(MAX_SOUND_TOTAL / 1024)}KB`,
  );
}

if (!wordFiles) {
  check('单词音频目录存在', false, `缺少 ${WORDS_DIR}`);
} else {
  const legacy = wordFiles.filter((f) => !f.endsWith('.v2.mp3'));
  check('单词音频不少于 221 个（含最小对立扩充词）', wordFiles.length >= 221, `实际 ${wordFiles.length} 个`);
  check(
    '单词音频全部为 .v2.mp3 版本',
    legacy.length === 0,
    legacy.length === 0 ? '' : `遗留旧版：${legacy.slice(0, 5).join(', ')}`,
  );
  let total = 0;
  const over: string[] = [];
  for (const f of wordFiles) {
    const size = statSync(join(WORDS_DIR, f)).size;
    total += size;
    if (size > MAX_WORD_BYTES) over.push(`${f}(${Math.round(size / 1024)}KB)`);
  }
  check(
    '单个单词音频在预算内',
    over.length === 0,
    over.length === 0 ? '' : `${over.length} 个超预算：${over.slice(0, 5).join(', ')}`,
  );
  check(
    '单词音频总体积在预算内',
    total <= MAX_WORDS_TOTAL,
    `${Math.round(total / 1024)}KB / 预算 ${Math.round(MAX_WORDS_TOTAL / 1024)}KB`,
  );
}

/* ---------- 2. 覆盖层：卡片词 / 例词 必须都有音频文件 ---------- */
const wordSet = new Set((wordFiles ?? []).map((f) => f.replace(/\.v2\.mp3$/, '')));

const catalogSrc = existsSync(CATALOG) ? readFileSync(CATALOG, 'utf8') : '';
const mapStart = catalogSrc.indexOf('CARD_WORDS_MAP');
const mapEnd = mapStart >= 0 ? catalogSrc.indexOf('};', mapStart) : -1;
const cardWords =
  mapStart >= 0 && mapEnd > mapStart
    ? Array.from(
        new Set(
          Array.from(catalogSrc.slice(mapStart, mapEnd).matchAll(/'([a-zA-Z]+)'/g)).map((m) =>
            m[1].toLowerCase(),
          ),
        ),
      )
    : [];
const missingCardWords = cardWords.filter((w) => !wordSet.has(w));
check(
  '卡片代表词全部有音频',
  cardWords.length > 0 && missingCardWords.length === 0,
  missingCardWords.length === 0 ? `${cardWords.length} 词全覆盖` : `缺：${missingCardWords.join(', ')}`,
);

let exampleWords: string[] = [];
if (existsSync(PHONETICS)) {
  try {
    const data = JSON.parse(readFileSync(PHONETICS, 'utf8')) as {
      phonemes: { examples?: { word: string }[] }[];
    };
    exampleWords = Array.from(
      new Set(
        data.phonemes.flatMap((p) => (p.examples ?? []).map((e) => e.word.trim().toLowerCase())),
      ),
    );
  } catch {
    check('phonetics.json 可解析', false, 'JSON 解析失败');
  }
}
const missingExampleWords = exampleWords.filter((w) => !wordSet.has(w));
check(
  '闯关赛例词全部有音频',
  exampleWords.length > 0 && missingExampleWords.length === 0,
  missingExampleWords.length === 0
    ? `${exampleWords.length} 词全覆盖`
    : `缺：${missingExampleWords.join(', ')}`,
);

/* ---------- 3. 代码层：路径版本化 + 预加载并发上限 ---------- */
check(
  'catalog 的 localAudioSrc 指向 .v2.mp3',
  /localAudioSrc:\s*`\/assets\/sound\/\$\{item\.id\}\.v2\.mp3`/.test(catalogSrc),
  catalogSrc ? '' : '缺少 src/data/phonics-catalog.ts',
);

const hookSrc = existsSync(HOOK) ? readFileSync(HOOK, 'utf8') : '';
check(
  'useAudioPlayer 的单词音频路径为 .v2.mp3',
  /\/assets\/words\/\$\{encodeURIComponent\(normalized\)\}\.v2\.mp3/.test(hookSrc),
  hookSrc ? '' : '缺少 src/hooks/useAudioPlayer.ts',
);

const parallelMatch = hookSrc.match(/MAX_PARALLEL_PRELOAD\s*=\s*(\d+)/);
check(
  '预加载有并发上限且不超过 3',
  parallelMatch !== null && Number(parallelMatch[1]) <= MAX_ALLOWED_PARALLEL,
  parallelMatch ? `MAX_PARALLEL_PRELOAD = ${parallelMatch[1]}` : '未找到并发上限常量',
);

check(
  '播放未就绪时有「加载中」反馈',
  /pendingKey/.test(hookSrc),
  hookSrc ? '' : '缺少 src/hooks/useAudioPlayer.ts',
);

/* ---------- 4. UI 层：pending 分支必须排在 playing 分支前面 ---------- */
/*
 * 反面教材（2026-11 已修）：hook 里 setPlayingId 是在 play() 之前调用的，
 * 所以「正在播放...」会立刻盖住「加载中...」，pending 反馈形同虚设。
 * 弱网下用户点了没声、按钮却说在播 —— 正是「点了没反应」的错觉来源。
 */
const CARD_STUDIO = join(ROOT, 'src', 'components', 'CardStudio.tsx');
const cardSrc = existsSync(CARD_STUDIO) ? readFileSync(CARD_STUDIO, 'utf8') : '';
/** 归一化空白：JSX 三元链常被 prettier 拆成多行，直接 indexOf 会假阳性 */
const cardFlat = cardSrc.replace(/\s+/g, ' ');

const pendingBtnIdx = cardFlat.indexOf("isPendingPhoneme ? '加载中...'");
const playingBtnIdx = cardFlat.indexOf("isPlayingCurrentAudio ? '正在播放...'");
check(
  '主按钮「加载中」优先于「正在播放」',
  cardSrc !== '' && pendingBtnIdx >= 0 && playingBtnIdx >= 0 && pendingBtnIdx < playingBtnIdx,
  cardSrc === ''
    ? '缺少 src/components/CardStudio.tsx'
    : pendingBtnIdx < 0
      ? '未找到 isPendingPhoneme ? \'加载中...\' 分支'
      : playingBtnIdx < 0
        ? '未找到 isPlayingCurrentAudio ? \'正在播放...\' 分支'
        : `pending@${pendingBtnIdx} vs playing@${playingBtnIdx}`,
);

const BLENDER_STAGE = join(ROOT, 'src', 'components', 'PhonicsBlenderStage.tsx');
const blenderSrc = existsSync(BLENDER_STAGE) ? readFileSync(BLENDER_STAGE, 'utf8') : '';
const blenderFlat = blenderSrc.replace(/\s+/g, ' ');
const pendingWordIdx = blenderFlat.indexOf("isPendingCardWord ? '加载中'");
const speakingWordIdx = blenderFlat.indexOf("isSpeakingCardWord ? '朗读中'");
check(
  '单词热点「加载中」优先于「朗读中」',
  blenderSrc !== '' && pendingWordIdx >= 0 && speakingWordIdx >= 0 && pendingWordIdx < speakingWordIdx,
  blenderSrc === ''
    ? '缺少 src/components/PhonicsBlenderStage.tsx'
    : pendingWordIdx < 0
      ? '未找到 isPendingCardWord ? \'加载中\' 分支'
      : speakingWordIdx < 0
        ? '未找到 isSpeakingCardWord ? \'朗读中\' 分支'
        : `pending@${pendingWordIdx} vs speaking@${speakingWordIdx}`,
);

/* ---------- 输出 ---------- */
let failed = 0;
for (const r of results) {
  if (!r.ok) failed += 1;
  console.log(`[${r.ok ? 'PASS' : 'FAIL'}] ${r.name}${r.detail ? ` — ${r.detail}` : ''}`);
}
console.log(`\n${results.length - failed}/${results.length} 通过`);
if (failed > 0) {
  console.error(`\n${failed} 项缺陷未解决。`);
  process.exit(1);
}
