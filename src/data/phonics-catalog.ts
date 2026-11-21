import rawDataset from './phonetics.json';
import type {
  ConfusablePair,
  PhonemeCategory,
  PhonemeItem,
  RawPhoneticsDataset,
  StudyDayPlan,
} from '../types/phonics';

const dataset = rawDataset as RawPhoneticsDataset;

const categoryMap = new Map<string, PhonemeCategory>(
  dataset.categories.map((category) => [category.id, category]),
);

/**
 * 6 大音标分类元数据
 */
export const PHONEME_CATEGORIES: PhonemeCategory[] = dataset.categories;

/**
 * 每张手绘插画卡片上自带的 A / B / C 三个代表词
 */
const CARD_WORDS_MAP: Record<string, string[]> = {
  'long-i': ['tea', 'sea', 'bee'],
  'short-i': ['pig', 'fish', 'milk'],
  'short-e': ['bed', 'egg', 'red'],
  'short-ae': ['cat', 'apple', 'bag'],
  'long-er': ['bird', 'girl', 'skirt'],
  schwa: ['panda', 'banana', 'water'],
  'short-uh': ['cup', 'duck', 'sun'],
  'long-u': ['zoo', 'moon', 'cool'],
  'short-u': ['book', 'foot', 'look'],
  'long-aw': ['door', 'ball', 'horse'],
  'short-o': ['dog', 'box', 'hot'],
  'long-a': ['car', 'star', 'park'],
  'diphthong-ei': ['cake', 'face', 'rain'],
  'diphthong-ai': ['fly', 'kite', 'ice'],
  'diphthong-oi': ['boy', 'toy', 'joy'],
  'diphthong-oh': ['nose', 'rose', 'snow'],
  'diphthong-au': ['cow', 'cloud', 'house'],
  'diphthong-ia': ['ear', 'deer', 'hear'],
  'diphthong-ea': ['bear', 'pear', 'hair'],
  'diphthong-ua': ['poor', 'tour', 'sure'],
  p: ['pen', 'panda', 'pig'],
  b: ['book', 'bear', 'baby'],
  t: ['tea', 'tiger', 'two'],
  d: ['dog', 'door', 'duck'],
  k: ['cat', 'kite', 'cake'],
  g: ['girl', 'good', 'game'],
  f: ['fish', 'fox', 'five'],
  v: ['vest', 'seven', 'love'],
  'voiceless-th': ['three', 'mouth', 'maths'],
  'voiced-th': ['this', 'mother', 'brother'],
  s: ['sun', 'snake', 'bus'],
  z: ['zoo', 'zero', 'nose'],
  sh: ['ship', 'shoe', 'fish'],
  zh: ['television', 'usually', 'measure'],
  h: ['hat', 'hand', 'hot'],
  r: ['red', 'run', 'rabbit'],
  ch: ['chair', 'chicken', 'teacher'],
  j: ['juice', 'jump', 'orange'],
  tr: ['tree', 'train', 'truck'],
  dr: ['dress', 'dragon', 'draw'],
  ts: ['cats', 'kites', 'hats'],
  dz: ['birds', 'hands', 'beds'],
  m: ['monkey', 'milk', 'mum'],
  n: ['nose', 'nut', 'nine'],
  ng: ['sing', 'ring', 'spring'],
  l: ['lion', 'leg', 'apple'],
  w: ['water', 'window', 'white'],
  y: ['yes', 'yellow', 'yo-yo'],
};

/**
 * 完整的 48 个音标列表（已关联本地插画卡、音频与口型视频路径）
 */
export const PHONEMES: PhonemeItem[] = dataset.phonemes.map((item, index) => {
  const category = categoryMap.get(item.category);
  return {
    ...item,
    order: index + 1,
    family: category?.family ?? 'vowel',
    categoryTitle: category?.title ?? item.category,
    // NOTE: 附加版本参数防止浏览器缓存旧尺寸卡片导致热区错位
    cardSrc: `/assets/cards/${item.id}.png?v=2`,
    localAudioSrc: `/assets/sound/${item.id}.mp3`,
    localVideoSrc: `/assets/video/${item.id}.mp4`,
    // 首帧封面：视频本体加载完前先显示这张图，避免黑屏转圈被当成「加载很慢」
    posterSrc: `/assets/poster/${item.id}.jpg`,
    cardWords: CARD_WORDS_MAP[item.id] ?? [],
  };
});

/**
 * 通过音标 id 快速检索音标对象
 */
export const PHONEME_MAP: Record<string, PhonemeItem> = Object.fromEntries(
  PHONEMES.map((item) => [item.id, item]),
);

/**
 * 针对中国初一学生高频易混音打造的“双胞胎对比组”
 */
export const CONFUSABLE_PAIRS: ConfusablePair[] = [
  {
    id: 'pair-i',
    title: '长元音 /iː/ vs 短元音 /ɪ/',
    leftId: 'long-i',
    rightId: 'short-i',
    tag: '最常混元音',
    keyDifference: '/iː/ 嘴角向两边拉出微笑感且拉长；/ɪ/ 口型自然放松、短促收音，不是缩短版 /iː/。',
  },
  {
    id: 'pair-e-ae',
    title: '小口 /e/ vs 大口梅花音 /æ/',
    leftId: 'short-e',
    rightId: 'short-ae',
    tag: '中考高频辨音',
    keyDifference: '/e/ 嘴张开约一指宽（bed）；/æ/ 嘴张大到两指宽且舌尖抵下齿（bad），避免读成汉语“啊”。',
  },
  {
    id: 'pair-u',
    title: '长元音 /uː/ vs 短元音 /ʊ/',
    leftId: 'long-u',
    rightId: 'short-u',
    tag: '圆唇长短对',
    keyDifference: '/uː/ 双唇收圆向前突出（food）；/ʊ/ 嘴唇只微圆不前突，发音短松（book）。',
  },
  {
    id: 'pair-o',
    title: '长元音 /ɔː/ vs 短元音 /ɒ/',
    leftId: 'long-aw',
    rightId: 'short-o',
    tag: '英式口型对',
    keyDifference: '/ɔː/ 双唇明显收圆前突且饱满（door）；/ɒ/ 口腔打开短促发声（hot），不要拖长。',
  },
  {
    id: 'pair-a-uh',
    title: '长音 /ɑː/ vs 尖角短音 /ʌ/',
    leftId: 'long-a',
    rightId: 'short-uh',
    tag: '开口度对比',
    keyDifference: '/ɑː/ 口腔开阔、声音靠后浑厚（car）；/ʌ/ 口型更小、短促干脆（cup）。',
  },
  {
    id: 'pair-er-schwa',
    title: '重读 /ɜː/ vs 轻读中央音 /ə/',
    leftId: 'long-er',
    rightId: 'schwa',
    tag: '重音与弱读',
    keyDifference: '/ɜː/ 用于重读音节，拉长平稳（bird）；/ə/ 只在非重读音节轻快带过（about），全嘴完全放松。',
  },
  {
    id: 'pair-ia-ea',
    title: '双元音 /ɪə/ vs /eə/',
    leftId: 'diphthong-ia',
    rightId: 'diphthong-ea',
    tag: '集中双元音',
    keyDifference: '/ɪə/ 从高的 /ɪ/ 滑向 /ə/（ear）；/eə/ 从半开的 /e/ 滑向 /ə/（air），英式结尾都不卷舌。',
  },
  {
    id: 'pair-th',
    title: '清咬舌 /θ/ vs 浊咬舌 /ð/',
    leftId: 'voiceless-th',
    rightId: 'voiced-th',
    tag: '初一重点纠音',
    keyDifference: '两者都要轻咬舌尖露出一点点！/θ/ 只吹气声带不震（three）；/ð/ 摸喉咙能感到明显震动（this）。',
  },
  {
    id: 'pair-v-w',
    title: '咬唇 /v/ vs 圆唇 /w/',
    leftId: 'v',
    rightId: 'w',
    tag: '中国学生必纠',
    keyDifference: '/v/ 上门牙轻碰下唇内侧产生摩擦（very）；/w/ 双唇收圆往前送、牙齿绝不碰嘴唇（we）。',
  },
  {
    id: 'pair-f-v',
    title: '清唇齿 /f/ vs 浊唇齿 /v/',
    leftId: 'f',
    rightId: 'v',
    tag: '清浊配对',
    keyDifference: '口型完全一致（上齿轻触下唇），/f/ 只吹气不震动；/v/ 需要震动声带。',
  },
  {
    id: 'pair-s-z',
    title: '清齿龈 /s/ vs 浊齿龈 /z/',
    leftId: 's',
    rightId: 'z',
    tag: '清浊配对',
    keyDifference: '/s/ 像小蛇吐气不震喉；/z/ 像蜜蜂嗡嗡震动喉咙，注意和 /ð/ 区分（/z/ 不咬舌）。',
  },
  {
    id: 'pair-sh-zh',
    title: '清摩擦 /ʃ/ vs 浊摩擦 /ʒ/',
    leftId: 'sh',
    rightId: 'zh',
    tag: '卷舌双唇微圆',
    keyDifference: '/ʃ/ 类似安静手势“嘘”（fish）；/ʒ/ 嘴型相同但声带震动（usually）。',
  },
  {
    id: 'pair-n-ng',
    title: '前鼻音 /n/ vs 后鼻音 /ŋ/',
    leftId: 'n',
    rightId: 'ng',
    tag: '鼻音辨析',
    keyDifference: '/n/ 舌尖抵住上齿龈（sun）；/ŋ/ 舌后部抬起堵住口腔气流从鼻腔出（sing），不要额外带出 /ɡ/。',
  },
  {
    id: 'pair-p-b',
    title: '清爆破 /p/ vs 浊爆破 /b/',
    leftId: 'p',
    rightId: 'b',
    tag: '送气与震动',
    keyDifference: '/p/ 纸巾放嘴前会被明显吹动；/b/ 吹气极弱但声带明显震动，尾音别加“波”。',
  },
];

/**
 * 根据音标 id 查找其关联的易混对比音标 id
 * @param phonemeId 当前音标 id
 * @returns 对比音标列表
 */
export function getRelatedConfusableIds(phonemeId: string): string[] {
  const related = new Set<string>();
  for (const pair of CONFUSABLE_PAIRS) {
    if (pair.leftId === phonemeId) {
      related.add(pair.rightId);
    } else if (pair.rightId === phonemeId) {
      related.add(pair.leftId);
    }
  }
  return Array.from(related);
}

/**
 * 14 天小升初音标通关路线（第 1-12 天学完 48 音，第 13-14 天易混精炼复盘）
 */
export const FOURTEEN_DAY_PLAN: StudyDayPlan[] = [
  {
    day: 1,
    title: '长短元音 · 微笑与圆唇',
    subtitle: '先打通最核心的两对长短元音',
    phonemeIds: ['long-i', 'short-i', 'long-u', 'short-u'],
    goalTip: '重点体会“长音饱满不变形，短音放松干脆”。',
  },
  {
    day: 2,
    title: '前元音与开口音对比',
    subtitle: '攻克初一最容易混的 /e/ 与 /æ/',
    phonemeIds: ['short-e', 'short-ae', 'long-aw', 'short-o'],
    goalTip: '对着镜子或视频确认 /æ/ 的开口幅度明显大于 /e/。',
  },
  {
    day: 3,
    title: '央元音与轻声弱读密码',
    subtitle: '读准英语地道节奏的关键 /ə/',
    phonemeIds: ['long-er', 'schwa', 'short-uh', 'long-a'],
    goalTip: '/ə/ 是英语出现频率最高的音，读得越轻越自然。',
  },
  {
    day: 4,
    title: '双元音（上）· 平滑大滑动',
    subtitle: '从起音自然滑向收尾，不拆拍',
    phonemeIds: ['diphthong-ei', 'diphthong-ai', 'diphthong-oi', 'diphthong-oh'],
    goalTip: '注意 /əʊ/ 的起点偏轻，不要读成汉语拼音“欧”。',
  },
  {
    day: 5,
    title: '双元音（下）· 集中收尾音',
    subtitle: '完成全部 20 个元音拼图',
    phonemeIds: ['diphthong-au', 'diphthong-ia', 'diphthong-ea', 'diphthong-ua'],
    goalTip: '练 /ɪə/ /eə/ /ʊə/ 时，英式读法末尾不要刻意卷舌。',
  },
  {
    day: 6,
    title: '爆破音清浊配对（上）',
    subtitle: '摸一摸喉咙感受声带震动',
    phonemeIds: ['p', 'b', 't', 'd'],
    goalTip: '词尾的 /t/ /d/ 轻轻爆破即可，不要加出“特/得”。',
  },
  {
    day: 7,
    title: '爆破音（下）与前鼻音',
    subtitle: '清脆不拖音 + 鼻腔共鸣',
    phonemeIds: ['k', 'g', 'm', 'n'],
    goalTip: '闭嘴发 /m/，舌尖顶上齿龈发 /n/，把鼻音拉稳。',
  },
  {
    day: 8,
    title: '摩擦音核心难点 · 咬唇与咬舌',
    subtitle: '初一英语口语拉开差距的 4 个音',
    phonemeIds: ['f', 'v', 'voiceless-th', 'voiced-th'],
    goalTip: '看视频练咬唇（f/v）和轻咬舌尖（θ/ð），绝不用 /s/ /z/ 代替！',
  },
  {
    day: 9,
    title: '摩擦音 · 气流控制组',
    subtitle: '区分平舌 /s/ /z/ 与翘唇 /ʃ/ /ʒ/',
    phonemeIds: ['s', 'z', 'sh', 'zh'],
    goalTip: '/ʒ/ 只出现于少数词（如 usually），读准“震动感”即可。',
  },
  {
    day: 10,
    title: '轻气流与半元音滑音',
    subtitle: '纠正 /w/ 与 /v/，辨别 /j/ 的读法',
    phonemeIds: ['h', 'r', 'w', 'y'],
    goalTip: '记住音标 /j/ 读“耶”（yes），不是字母 j 的读音。',
  },
  {
    day: 11,
    title: '破擦音 · 爆破带摩擦',
    subtitle: '一气呵成不拆音',
    phonemeIds: ['ch', 'j', 'tr', 'dr'],
    goalTip: '/tʃ/ /dʒ/ 要双唇微圆；/tr/ /dr/ 在国内常作整体组合音拼读。',
  },
  {
    day: 12,
    title: '词尾组合音与后鼻音/边音',
    subtitle: '集齐全部 48 个国际音标！',
    phonemeIds: ['ts', 'dz', 'ng', 'l'],
    goalTip: '/ts/ /dz/ 常出现在名词复数词尾；/ŋ/ 读完不要额外冒出 /ɡ/。',
  },
  {
    day: 13,
    title: '考前巩固 · 元音易混精炼',
    subtitle: '重点回刷高频出错的 4 个元音',
    phonemeIds: ['long-i', 'short-i', 'short-e', 'short-ae'],
    goalTip: '在“双胞胎易混屋”中完成听盲盒辨音 100% 正确。',
  },
  {
    day: 14,
    title: '考前巩固 · 辅音纠音大通关',
    subtitle: '攻克中国学生最易错的 4 个辅音',
    phonemeIds: ['voiceless-th', 'voiced-th', 'v', 'ng'],
    goalTip: '用跟读录音逐个自检，把 48 个音标尽量都点亮“今日已学”！',
  },
];
