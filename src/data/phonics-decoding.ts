/**
 * 48 国际音标「见词拼读解码图谱 + 最小对立真词库 + 防作弊干扰词群」
 *
 * 解决痛点：
 * 1. 把孤立的“认卡片”转化为“字母组合 → 音素拆解 → 滑动拼合朗读”的真实拼读能力；
 * 2. 将 14 组易混音升级为真实词上下文的最小对立训练（如 sheep/ship、bed/bad、vest/west）；
 * 3. 为“看音标猜单词”提供同一首字母或近似拼写的强干扰项，杜绝看首字母瞎蒙。
 */

export interface PhonemeSegment {
  /** 单词中对应的字母或字母组合（例如 ea、th、sh） */
  letters: string;
  /** 对应 48 音标库中的 phonemeId */
  phonemeId: string;
  /** 展示用音标符号（例如 /iː/） */
  symbol: string;
  /** 是否为当前正在学习的靶向音素 */
  isTarget?: boolean;
}

export interface BlendableWord {
  word: string;
  phonetic: string;
  meaning: string;
  segments: PhonemeSegment[];
}

export interface SpellingPattern {
  /** 常见拼写组合（例如 ea、ee、th） */
  grapheme: string;
  /** 典型例词 */
  examples: string[];
  /** 简短记法 */
  ruleHint: string;
}

export interface PhonemeDecodingSpec {
  patterns: SpellingPattern[];
  blendWords: BlendableWord[];
}

export interface MinimalWordPair {
  id: string;
  pairId: string;
  leftId: string;
  rightId: string;
  leftWord: string;
  leftPhonetic: string;
  leftMeaning: string;
  rightWord: string;
  rightPhonetic: string;
  rightMeaning: string;
  focusTip: string;
}

export interface WordDistractorGroup {
  /** 同音系或易混近形词（均已在本地备好 .v2.mp3） */
  words: Array<{ word: string; phonetic: string; meaning: string }>;
}

const S = (letters: string, phonemeId: string, symbol: string, isTarget = false): PhonemeSegment => ({
  letters,
  phonemeId,
  symbol,
  ...(isTarget ? { isTarget: true } : {}),
});

/**
 * 48 个音标的拼读规则与可点击拼装真词库
 * （所用单词均覆盖于 public/assets/words/*.v2.mp3）
 */
export const PHONEME_DECODING_MAP: Record<string, PhonemeDecodingSpec> = {
  'long-i': {
    patterns: [
      { grapheme: 'ea', examples: ['tea', 'sea', 'seat'], ruleHint: '常见组合 ea 常发长音 /iː/' },
      { grapheme: 'ee', examples: ['bee', 'green', 'sheep'], ruleHint: '双写 ee 几乎稳定发 /iː/' },
    ],
    blendWords: [
      { word: 'tea', phonetic: '/tiː/', meaning: '茶', segments: [S('t', 't', '/t/'), S('ea', 'long-i', '/iː/', true)] },
      { word: 'sheep', phonetic: '/ʃiːp/', meaning: '绵羊', segments: [S('sh', 'sh', '/ʃ/'), S('ee', 'long-i', '/iː/', true), S('p', 'p', '/p/')] },
    ],
  },
  'short-i': {
    patterns: [
      { grapheme: 'i', examples: ['sit', 'pig', 'ship'], ruleHint: '重读闭音节单写 i 常发短 /ɪ/' },
      { grapheme: 'y', examples: ['city', 'happy'], ruleHint: '双音节词尾 y 轻读为短 /ɪ/' },
    ],
    blendWords: [
      { word: 'sit', phonetic: '/sɪt/', meaning: '坐', segments: [S('s', 's', '/s/'), S('i', 'short-i', '/ɪ/', true), S('t', 't', '/t/')] },
      { word: 'ship', phonetic: '/ʃɪp/', meaning: '轮船', segments: [S('sh', 'sh', '/ʃ/'), S('i', 'short-i', '/ɪ/', true), S('p', 'p', '/p/')] },
    ],
  },
  'short-e': {
    patterns: [
      { grapheme: 'e', examples: ['bed', 'red', 'pen'], ruleHint: '闭音节单写 e 发小口 /e/' },
      { grapheme: 'ea', examples: ['head'], ruleHint: '少数高频词 ea 读短 /e/' },
    ],
    blendWords: [
      { word: 'bed', phonetic: '/bed/', meaning: '床', segments: [S('b', 'b', '/b/'), S('e', 'short-e', '/e/', true), S('d', 'd', '/d/')] },
      { word: 'pen', phonetic: '/pen/', meaning: '钢笔', segments: [S('p', 'p', '/p/'), S('e', 'short-e', '/e/', true), S('n', 'n', '/n/')] },
    ],
  },
  'short-ae': {
    patterns: [
      { grapheme: 'a', examples: ['cat', 'bad', 'bag'], ruleHint: '辅元辅闭音节里 a 常张大嘴读 /æ/' },
    ],
    blendWords: [
      { word: 'bad', phonetic: '/bæd/', meaning: '坏的', segments: [S('b', 'b', '/b/'), S('a', 'short-ae', '/æ/', true), S('d', 'd', '/d/')] },
      { word: 'cat', phonetic: '/kæt/', meaning: '猫', segments: [S('c', 'k', '/k/'), S('a', 'short-ae', '/æ/', true), S('t', 't', '/t/')] },
    ],
  },
  'long-er': {
    patterns: [
      { grapheme: 'ir / er / ur', examples: ['bird', 'girl'], ruleHint: '元音+r 在重读音节常拉长发 /ɜː/' },
      { grapheme: 'or / ear', examples: ['word', 'learn'], ruleHint: 'w 后的 or 与部分 ear 也发 /ɜː/' },
    ],
    blendWords: [
      { word: 'bird', phonetic: '/bɜːd/', meaning: '小鸟', segments: [S('b', 'b', '/b/'), S('ir', 'long-er', '/ɜː/', true), S('d', 'd', '/d/')] },
      { word: 'word', phonetic: '/wɜːd/', meaning: '单词', segments: [S('w', 'w', '/w/'), S('or', 'long-er', '/ɜː/', true), S('d', 'd', '/d/')] },
    ],
  },
  schwa: {
    patterns: [
      { grapheme: 'a / er / o', examples: ['about', 'teacher', 'panda'], ruleHint: '非重读音节里的元音常弱化成 /ə/' },
    ],
    blendWords: [
      { word: 'about', phonetic: '/əˈbaʊt/', meaning: '关于', segments: [S('a', 'schwa', '/ə/', true), S('b', 'b', '/b/'), S('ou', 'diphthong-au', '/aʊ/'), S('t', 't', '/t/')] },
      { word: 'away', phonetic: '/əˈweɪ/', meaning: '离开', segments: [S('a', 'schwa', '/ə/', true), S('w', 'w', '/w/'), S('ay', 'diphthong-ei', '/eɪ/')] },
    ],
  },
  'short-uh': {
    patterns: [
      { grapheme: 'u', examples: ['cup', 'duck', 'sun'], ruleHint: '闭音节字母 u 常发干脆的 /ʌ/' },
      { grapheme: 'o', examples: ['love', 'mother'], ruleHint: 'm/n/v 前部分 o 读 /ʌ/' },
    ],
    blendWords: [
      { word: 'cup', phonetic: '/kʌp/', meaning: '杯子', segments: [S('c', 'k', '/k/'), S('u', 'short-uh', '/ʌ/', true), S('p', 'p', '/p/')] },
      { word: 'duck', phonetic: '/dʌk/', meaning: '鸭子', segments: [S('d', 'd', '/d/'), S('u', 'short-uh', '/ʌ/', true), S('ck', 'k', '/k/')] },
    ],
  },
  'long-u': {
    patterns: [
      { grapheme: 'oo', examples: ['zoo', 'food', 'pool'], ruleHint: 'oo 在多数词里发饱满圆唇 /uː/' },
      { grapheme: 'ue / o', examples: ['blue', 'two'], ruleHint: '词尾 ue 与少数高频词发 /uː/' },
    ],
    blendWords: [
      { word: 'pool', phonetic: '/puːl/', meaning: '水池', segments: [S('p', 'p', '/p/'), S('oo', 'long-u', '/uː/', true), S('l', 'l', '/l/')] },
      { word: 'zoo', phonetic: '/zuː/', meaning: '动物园', segments: [S('z', 'z', '/z/'), S('oo', 'long-u', '/uː/', true)] },
    ],
  },
  'short-u': {
    patterns: [
      { grapheme: 'oo', examples: ['book', 'look', 'foot'], ruleHint: 'k/d/t 前的 oo 常变短读 /ʊ/' },
      { grapheme: 'u', examples: ['pull'], ruleHint: '少数词如 pull 中的 u 读 /ʊ/' },
    ],
    blendWords: [
      { word: 'book', phonetic: '/bʊk/', meaning: '书', segments: [S('b', 'b', '/b/'), S('oo', 'short-u', '/ʊ/', true), S('k', 'k', '/k/')] },
      { word: 'pull', phonetic: '/pʊl/', meaning: '拉', segments: [S('p', 'p', '/p/'), S('u', 'short-u', '/ʊ/', true), S('ll', 'l', '/l/')] },
    ],
  },
  'long-aw': {
    patterns: [
      { grapheme: 'or / oor', examples: ['port', 'door', 'horse'], ruleHint: 'or 与 oor 常发长圆唇 /ɔː/' },
      { grapheme: 'al / a', examples: ['ball', 'talk', 'small'], ruleHint: 'll/lk 前的 a 常发 /ɔː/' },
    ],
    blendWords: [
      { word: 'port', phonetic: '/pɔːt/', meaning: '港口', segments: [S('p', 'p', '/p/'), S('or', 'long-aw', '/ɔː/', true), S('t', 't', '/t/')] },
      { word: 'door', phonetic: '/dɔː/', meaning: '门', segments: [S('d', 'd', '/d/'), S('oor', 'long-aw', '/ɔː/', true)] },
    ],
  },
  'short-o': {
    patterns: [
      { grapheme: 'o', examples: ['dog', 'pot', 'hot'], ruleHint: '闭音节单写 o 在英音中读短开音 /ɒ/' },
    ],
    blendWords: [
      { word: 'pot', phonetic: '/pɒt/', meaning: '锅', segments: [S('p', 'p', '/p/'), S('o', 'short-o', '/ɒ/', true), S('t', 't', '/t/')] },
      { word: 'dog', phonetic: '/dɒɡ/', meaning: '狗', segments: [S('d', 'd', '/d/'), S('o', 'short-o', '/ɒ/', true), S('g', 'g', '/ɡ/')] },
    ],
  },
  'long-a': {
    patterns: [
      { grapheme: 'ar', examples: ['car', 'park', 'dark'], ruleHint: '字母组合 ar 通常发浑厚长音 /ɑː/' },
    ],
    blendWords: [
      { word: 'car', phonetic: '/kɑː/', meaning: '小汽车', segments: [S('c', 'k', '/k/'), S('ar', 'long-a', '/ɑː/', true)] },
      { word: 'dark', phonetic: '/dɑːk/', meaning: '黑暗的', segments: [S('d', 'd', '/d/'), S('ar', 'long-a', '/ɑː/', true), S('k', 'k', '/k/')] },
    ],
  },
  'diphthong-ei': {
    patterns: [
      { grapheme: 'a_e / ay / ai', examples: ['cake', 'day', 'rain'], ruleHint: '开音节 a 与 ay/ai 滑读 /eɪ/' },
    ],
    blendWords: [
      { word: 'day', phonetic: '/deɪ/', meaning: '一天', segments: [S('d', 'd', '/d/'), S('ay', 'diphthong-ei', '/eɪ/', true)] },
      { word: 'cake', phonetic: '/keɪk/', meaning: '蛋糕', segments: [S('c', 'k', '/k/'), S('a_e', 'diphthong-ei', '/eɪ/', true), S('k', 'k', '/k/')] },
    ],
  },
  'diphthong-ai': {
    patterns: [
      { grapheme: 'i_e / y / igh', examples: ['kite', 'fly', 'light'], ruleHint: '开音节 i 与 igh 常发 /aɪ/' },
    ],
    blendWords: [
      { word: 'kite', phonetic: '/kaɪt/', meaning: '风筝', segments: [S('k', 'k', '/k/'), S('i_e', 'diphthong-ai', '/aɪ/', true), S('t', 't', '/t/')] },
      { word: 'time', phonetic: '/taɪm/', meaning: '时间', segments: [S('t', 't', '/t/'), S('i_e', 'diphthong-ai', '/aɪ/', true), S('m', 'm', '/m/')] },
    ],
  },
  'diphthong-oi': {
    patterns: [
      { grapheme: 'oy / oi', examples: ['boy', 'toy', 'voice'], ruleHint: 'oy 常用在词尾，oi 用在词中，均读 /ɔɪ/' },
    ],
    blendWords: [
      { word: 'boy', phonetic: '/bɔɪ/', meaning: '男孩', segments: [S('b', 'b', '/b/'), S('oy', 'diphthong-oi', '/ɔɪ/', true)] },
      { word: 'voice', phonetic: '/vɔɪs/', meaning: '声音', segments: [S('v', 'v', '/v/'), S('oi', 'diphthong-oi', '/ɔɪ/', true), S('ce', 's', '/s/')] },
    ],
  },
  'diphthong-oh': {
    patterns: [
      { grapheme: 'o_e / oa / ow', examples: ['home', 'road', 'snow'], ruleHint: '从中央轻滑向圆唇的 /əʊ/' },
    ],
    blendWords: [
      { word: 'go', phonetic: '/ɡəʊ/', meaning: '去', segments: [S('g', 'g', '/ɡ/'), S('o', 'diphthong-oh', '/əʊ/', true)] },
      { word: 'road', phonetic: '/rəʊd/', meaning: '马路', segments: [S('r', 'r', '/r/'), S('oa', 'diphthong-oh', '/əʊ/', true), S('d', 'd', '/d/')] },
    ],
  },
  'diphthong-au': {
    patterns: [
      { grapheme: 'ow / ou', examples: ['cow', 'now', 'house'], ruleHint: '由大口 /ɑ/ 迅速滑向小口 /ʊ/' },
    ],
    blendWords: [
      { word: 'cow', phonetic: '/kaʊ/', meaning: '奶牛', segments: [S('c', 'k', '/k/'), S('ow', 'diphthong-au', '/aʊ/', true)] },
      { word: 'mouse', phonetic: '/maʊs/', meaning: '老鼠', segments: [S('m', 'm', '/m/'), S('ou', 'diphthong-au', '/aʊ/', true), S('se', 's', '/s/')] },
    ],
  },
  'diphthong-ia': {
    patterns: [
      { grapheme: 'ear / eer / ere', examples: ['ear', 'deer', 'here'], ruleHint: '从 /ɪ/ 平稳滑向轻松 /ə/' },
    ],
    blendWords: [
      { word: 'near', phonetic: '/nɪə/', meaning: '靠近', segments: [S('n', 'n', '/n/'), S('ear', 'diphthong-ia', '/ɪə/', true)] },
      { word: 'hear', phonetic: '/hɪə/', meaning: '听见', segments: [S('h', 'h', '/h/'), S('ear', 'diphthong-ia', '/ɪə/', true)] },
    ],
  },
  'diphthong-ea': {
    patterns: [
      { grapheme: 'air / ear / are', examples: ['hair', 'bear', 'care'], ruleHint: '从半开 /e/ 滑向 /ə/，尾音不卷舌' },
    ],
    blendWords: [
      { word: 'hair', phonetic: '/heə/', meaning: '头发', segments: [S('h', 'h', '/h/'), S('air', 'diphthong-ea', '/eə/', true)] },
      { word: 'bear', phonetic: '/beə/', meaning: '熊', segments: [S('b', 'b', '/b/'), S('ear', 'diphthong-ea', '/eə/', true)] },
    ],
  },
  'diphthong-ua': {
    patterns: [
      { grapheme: 'oor / our / ure', examples: ['poor', 'tour', 'pure'], ruleHint: '圆唇 /ʊ/ 滑向放松 /ə/' },
    ],
    blendWords: [
      { word: 'poor', phonetic: '/pʊə/', meaning: '贫穷的', segments: [S('p', 'p', '/p/'), S('oor', 'diphthong-ua', '/ʊə/', true)] },
      { word: 'tour', phonetic: '/tʊə/', meaning: '旅行', segments: [S('t', 't', '/t/'), S('our', 'diphthong-ua', '/ʊə/', true)] },
    ],
  },
  p: {
    patterns: [{ grapheme: 'p / pp', examples: ['pen', 'pig', 'happy'], ruleHint: '双唇爆破送气，词尾轻收不加元音' }],
    blendWords: [
      { word: 'pig', phonetic: '/pɪɡ/', meaning: '小猪', segments: [S('p', 'p', '/p/', true), S('i', 'short-i', '/ɪ/'), S('g', 'g', '/ɡ/')] },
      { word: 'map', phonetic: '/mæp/', meaning: '地图', segments: [S('m', 'm', '/m/'), S('a', 'short-ae', '/æ/'), S('p', 'p', '/p/', true)] },
    ],
  },
  b: {
    patterns: [{ grapheme: 'b / bb', examples: ['book', 'big', 'baby'], ruleHint: '闭唇蓄气并振动声带放开' }],
    blendWords: [
      { word: 'big', phonetic: '/bɪɡ/', meaning: '大的', segments: [S('b', 'b', '/b/', true), S('i', 'short-i', '/ɪ/'), S('g', 'g', '/ɡ/')] },
      { word: 'bag', phonetic: '/bæɡ/', meaning: '书包', segments: [S('b', 'b', '/b/', true), S('a', 'short-ae', '/æ/'), S('g', 'g', '/ɡ/')] },
    ],
  },
  t: {
    patterns: [{ grapheme: 't / tt', examples: ['tea', 'tree', 'cat'], ruleHint: '舌尖抵上齿龈爆破，词尾轻吐气' }],
    blendWords: [
      { word: 'tea', phonetic: '/tiː/', meaning: '茶', segments: [S('t', 't', '/t/', true), S('ea', 'long-i', '/iː/')] },
      { word: 'hat', phonetic: '/hæt/', meaning: '帽子', segments: [S('h', 'h', '/h/'), S('a', 'short-ae', '/æ/'), S('t', 't', '/t/', true)] },
    ],
  },
  d: {
    patterns: [{ grapheme: 'd / dd', examples: ['dog', 'door', 'red'], ruleHint: '舌位与 /t/ 相同，声带振动更厚重' }],
    blendWords: [
      { word: 'red', phonetic: '/red/', meaning: '红色', segments: [S('r', 'r', '/r/'), S('e', 'short-e', '/e/'), S('d', 'd', '/d/', true)] },
      { word: 'day', phonetic: '/deɪ/', meaning: '白天', segments: [S('d', 'd', '/d/', true), S('ay', 'diphthong-ei', '/eɪ/')] },
    ],
  },
  k: {
    patterns: [{ grapheme: 'k / c / ck', examples: ['key', 'cat', 'back'], ruleHint: 'c 在 a/o/u 前常读 /k/，词尾常用 ck' }],
    blendWords: [
      { word: 'key', phonetic: '/kiː/', meaning: '钥匙', segments: [S('k', 'k', '/k/', true), S('ey', 'long-i', '/iː/')] },
      { word: 'back', phonetic: '/bæk/', meaning: '后面', segments: [S('b', 'b', '/b/'), S('a', 'short-ae', '/æ/'), S('ck', 'k', '/k/', true)] },
    ],
  },
  g: {
    patterns: [{ grapheme: 'g / gg', examples: ['go', 'game', 'big'], ruleHint: '舌根抬高抵软腭并振喉爆破' }],
    blendWords: [
      { word: 'bag', phonetic: '/bæɡ/', meaning: '书包', segments: [S('b', 'b', '/b/'), S('a', 'short-ae', '/æ/'), S('g', 'g', '/ɡ/', true)] },
      { word: 'dog', phonetic: '/dɒɡ/', meaning: '狗', segments: [S('d', 'd', '/d/'), S('o', 'short-o', '/ɒ/'), S('g', 'g', '/ɡ/', true)] },
    ],
  },
  f: {
    patterns: [{ grapheme: 'f / ff / gh', examples: ['fan', 'fish', 'leaf'], ruleHint: '上齿轻触下唇吹气，只出气流不振喉' }],
    blendWords: [
      { word: 'fan', phonetic: '/fæn/', meaning: '风扇', segments: [S('f', 'f', '/f/', true), S('a', 'short-ae', '/æ/'), S('n', 'n', '/n/')] },
      { word: 'leaf', phonetic: '/liːf/', meaning: '树叶', segments: [S('l', 'l', '/l/'), S('ea', 'long-i', '/iː/'), S('f', 'f', '/f/', true)] },
    ],
  },
  v: {
    patterns: [{ grapheme: 'v / ve', examples: ['van', 'vest', 'leave'], ruleHint: '与 /f/ 同口型，但声带明显震动，切忌读成 /w/' }],
    blendWords: [
      { word: 'van', phonetic: '/væn/', meaning: '面包车', segments: [S('v', 'v', '/v/', true), S('a', 'short-ae', '/æ/'), S('n', 'n', '/n/')] },
      { word: 'vest', phonetic: '/vest/', meaning: '背心', segments: [S('v', 'v', '/v/', true), S('e', 'short-e', '/e/'), S('s', 's', '/s/'), S('t', 't', '/t/')] },
    ],
  },
  'voiceless-th': {
    patterns: [{ grapheme: 'th', examples: ['thin', 'three', 'mouth'], ruleHint: '舌尖轻放上下齿间吹气，千万别读成平舌 /s/' }],
    blendWords: [
      { word: 'thin', phonetic: '/θɪn/', meaning: '瘦的', segments: [S('th', 'voiceless-th', '/θ/', true), S('i', 'short-i', '/ɪ/'), S('n', 'n', '/n/')] },
      { word: 'mouth', phonetic: '/maʊθ/', meaning: '嘴巴', segments: [S('m', 'm', '/m/'), S('ou', 'diphthong-au', '/aʊ/'), S('th', 'voiceless-th', '/θ/', true)] },
    ],
  },
  'voiced-th': {
    patterns: [{ grapheme: 'th', examples: ['this', 'then', 'mother'], ruleHint: '同样轻咬舌尖但需声带震动，常见于代词和亲属词' }],
    blendWords: [
      { word: 'this', phonetic: '/ðɪs/', meaning: '这个', segments: [S('th', 'voiced-th', '/ð/', true), S('i', 'short-i', '/ɪ/'), S('s', 's', '/s/')] },
      { word: 'then', phonetic: '/ðen/', meaning: '那时', segments: [S('th', 'voiced-th', '/ð/', true), S('e', 'short-e', '/e/'), S('n', 'n', '/n/')] },
    ],
  },
  s: {
    patterns: [{ grapheme: 's / c / ss', examples: ['sip', 'sun', 'city'], ruleHint: '舌尖靠近上齿龈吹纯清气，c 在 e/i/y 前也读 /s/' }],
    blendWords: [
      { word: 'sip', phonetic: '/sɪp/', meaning: '小口啜饮', segments: [S('s', 's', '/s/', true), S('i', 'short-i', '/ɪ/'), S('p', 'p', '/p/')] },
      { word: 'bus', phonetic: '/bʌs/', meaning: '公交车', segments: [S('b', 'b', '/b/'), S('u', 'short-uh', '/ʌ/'), S('s', 's', '/s/', true)] },
    ],
  },
  z: {
    patterns: [{ grapheme: 'z / s / se', examples: ['zip', 'zoo', 'nose'], ruleHint: '口型同 /s/，喉咙像蜜蜂般震动；部分词尾 s 也浊化为 /z/' }],
    blendWords: [
      { word: 'zip', phonetic: '/zɪp/', meaning: '拉链', segments: [S('z', 'z', '/z/', true), S('i', 'short-i', '/ɪ/'), S('p', 'p', '/p/')] },
      { word: 'nose', phonetic: '/nəʊz/', meaning: '鼻子', segments: [S('n', 'n', '/n/'), S('o_e', 'diphthong-oh', '/əʊ/'), S('s', 'z', '/z/', true)] },
    ],
  },
  sh: {
    patterns: [{ grapheme: 'sh', examples: ['ship', 'she', 'fish'], ruleHint: '双唇微收圆略前突，轻吹嘘声 /ʃ/' }],
    blendWords: [
      { word: 'she', phonetic: '/ʃiː/', meaning: '她', segments: [S('sh', 'sh', '/ʃ/', true), S('e', 'long-i', '/iː/')] },
      { word: 'fish', phonetic: '/fɪʃ/', meaning: '鱼', segments: [S('f', 'f', '/f/'), S('i', 'short-i', '/ɪ/'), S('sh', 'sh', '/ʃ/', true)] },
    ],
  },
  zh: {
    patterns: [{ grapheme: 's / si', examples: ['measure', 'vision'], ruleHint: '口型同 /ʃ/ 并振动声带，常出现在 -sure/-sion 结构里' }],
    blendWords: [
      { word: 'measure', phonetic: '/ˈmeʒə/', meaning: '测量', segments: [S('m', 'm', '/m/'), S('ea', 'short-e', '/e/'), S('s', 'zh', '/ʒ/', true), S('ure', 'schwa', '/ə/')] },
      { word: 'vision', phonetic: '/ˈvɪʒn/', meaning: '视力', segments: [S('v', 'v', '/v/'), S('i', 'short-i', '/ɪ/'), S('si', 'zh', '/ʒ/', true), S('on', 'n', '/n/')] },
    ],
  },
  h: {
    patterns: [{ grapheme: 'h / wh', examples: ['hat', 'home', 'hot'], ruleHint: '像冬天哈气暖手一样轻轻呼出气流' }],
    blendWords: [
      { word: 'hat', phonetic: '/hæt/', meaning: '帽子', segments: [S('h', 'h', '/h/', true), S('a', 'short-ae', '/æ/'), S('t', 't', '/t/')] },
      { word: 'hot', phonetic: '/hɒt/', meaning: '热的', segments: [S('h', 'h', '/h/', true), S('o', 'short-o', '/ɒ/'), S('t', 't', '/t/')] },
    ],
  },
  r: {
    patterns: [{ grapheme: 'r / rr', examples: ['red', 'run', 'right'], ruleHint: '舌尖微卷朝上腭但不要碰死，双唇微圆前突' }],
    blendWords: [
      { word: 'red', phonetic: '/red/', meaning: '红色', segments: [S('r', 'r', '/r/', true), S('e', 'short-e', '/e/'), S('d', 'd', '/d/')] },
      { word: 'run', phonetic: '/rʌn/', meaning: '奔跑', segments: [S('r', 'r', '/r/', true), S('u', 'short-uh', '/ʌ/'), S('n', 'n', '/n/')] },
    ],
  },
  ch: {
    patterns: [{ grapheme: 'ch / tch', examples: ['cheap', 'chair', 'watch'], ruleHint: '先阻气再喷发 /tʃ/，比汉语“吃”唇形更圆突出' }],
    blendWords: [
      { word: 'cheap', phonetic: '/tʃiːp/', meaning: '便宜的', segments: [S('ch', 'ch', '/tʃ/', true), S('ea', 'long-i', '/iː/'), S('p', 'p', '/p/')] },
      { word: 'chair', phonetic: '/tʃeə/', meaning: '椅子', segments: [S('ch', 'ch', '/tʃ/', true), S('air', 'diphthong-ea', '/eə/')] },
    ],
  },
  j: {
    patterns: [{ grapheme: 'j / dge', examples: ['job', 'jump', 'bridge'], ruleHint: '带声带震动的破擦音 /dʒ/，注意后缀 dge 常读 /dʒ/' }],
    blendWords: [
      { word: 'job', phonetic: '/dʒɒb/', meaning: '工作', segments: [S('j', 'j', '/dʒ/', true), S('o', 'short-o', '/ɒ/'), S('b', 'b', '/b/')] },
      { word: 'jump', phonetic: '/dʒʌmp/', meaning: '跳跃', segments: [S('j', 'j', '/dʒ/', true), S('u', 'short-uh', '/ʌ/'), S('m', 'm', '/m/'), S('p', 'p', '/p/')] },
    ],
  },
  tr: {
    patterns: [{ grapheme: 'tr', examples: ['tree', 'train', 'try'], ruleHint: '双字母组合 tr 整体滑读，送气清亮如轻吹“戳”' }],
    blendWords: [
      { word: 'tree', phonetic: '/triː/', meaning: '树', segments: [S('tr', 'tr', '/tr/', true), S('ee', 'long-i', '/iː/')] },
      { word: 'try', phonetic: '/traɪ/', meaning: '尝试', segments: [S('tr', 'tr', '/tr/', true), S('y', 'diphthong-ai', '/aɪ/')] },
    ],
  },
  dr: {
    patterns: [{ grapheme: 'dr', examples: ['draw', 'dream', 'dress'], ruleHint: 'dr 连读并振动声带，一口气滑向后接元音' }],
    blendWords: [
      { word: 'draw', phonetic: '/drɔː/', meaning: '画画', segments: [S('dr', 'dr', '/dr/', true), S('aw', 'long-aw', '/ɔː/')] },
      { word: 'dress', phonetic: '/dres/', meaning: '连衣裙', segments: [S('dr', 'dr', '/dr/', true), S('e', 'short-e', '/e/'), S('ss', 's', '/s/')] },
    ],
  },
  ts: {
    patterns: [{ grapheme: 'ts / tes', examples: ['cats', 'hats', 'kites'], ruleHint: '清辅音 /t/ 后接名词复数或三单 s，常合成清脆 /ts/' }],
    blendWords: [
      { word: 'cats', phonetic: '/kæts/', meaning: '猫（复数）', segments: [S('c', 'k', '/k/'), S('a', 'short-ae', '/æ/'), S('ts', 'ts', '/ts/', true)] },
      { word: 'hats', phonetic: '/hæts/', meaning: '帽子（复数）', segments: [S('h', 'h', '/h/'), S('a', 'short-ae', '/æ/'), S('ts', 'ts', '/ts/', true)] },
    ],
  },
  dz: {
    patterns: [{ grapheme: 'ds / des', examples: ['beds', 'hands', 'roads'], ruleHint: '浊辅音 /d/ 后接复数 s，连带浊化为 /dz/' }],
    blendWords: [
      { word: 'beds', phonetic: '/bedz/', meaning: '床（复数）', segments: [S('b', 'b', '/b/'), S('e', 'short-e', '/e/'), S('ds', 'dz', '/dz/', true)] },
      { word: 'roads', phonetic: '/rəʊdz/', meaning: '马路（复数）', segments: [S('r', 'r', '/r/'), S('oa', 'diphthong-oh', '/əʊ/'), S('ds', 'dz', '/dz/', true)] },
    ],
  },
  m: {
    patterns: [{ grapheme: 'm / mm', examples: ['man', 'map', 'mum'], ruleHint: '双唇完全闭合，气流全部从鼻腔共鸣而出' }],
    blendWords: [
      { word: 'man', phonetic: '/mæn/', meaning: '男人', segments: [S('m', 'm', '/m/', true), S('a', 'short-ae', '/æ/'), S('n', 'n', '/n/')] },
      { word: 'map', phonetic: '/mæp/', meaning: '地图', segments: [S('m', 'm', '/m/', true), S('a', 'short-ae', '/æ/'), S('p', 'p', '/p/')] },
    ],
  },
  n: {
    patterns: [{ grapheme: 'n / nn', examples: ['name', 'sin', 'sun'], ruleHint: '舌尖稳稳顶住上齿龈，嘴唇保持微张不闭死' }],
    blendWords: [
      { word: 'sin', phonetic: '/sɪn/', meaning: '过失', segments: [S('s', 's', '/s/'), S('i', 'short-i', '/ɪ/'), S('n', 'n', '/n/', true)] },
      { word: 'sun', phonetic: '/sʌn/', meaning: '太阳', segments: [S('s', 's', '/s/'), S('u', 'short-uh', '/ʌ/'), S('n', 'n', '/n/', true)] },
    ],
  },
  ng: {
    patterns: [{ grapheme: 'ng / n(k)', examples: ['sing', 'wing', 'long'], ruleHint: '舌根后抬堵住口腔后部，发完直接收音不要多带 /ɡ/' }],
    blendWords: [
      { word: 'sing', phonetic: '/sɪŋ/', meaning: '唱歌', segments: [S('s', 's', '/s/'), S('i', 'short-i', '/ɪ/'), S('ng', 'ng', '/ŋ/', true)] },
      { word: 'wing', phonetic: '/wɪŋ/', meaning: '翅膀', segments: [S('w', 'w', '/w/'), S('i', 'short-i', '/ɪ/'), S('ng', 'ng', '/ŋ/', true)] },
    ],
  },
  l: {
    patterns: [{ grapheme: 'l / ll', examples: ['look', 'pool', 'pull'], ruleHint: '词首亮音清脆弹开；词尾舌尖抬抵上齿龈保留共鸣' }],
    blendWords: [
      { word: 'look', phonetic: '/lʊk/', meaning: '看', segments: [S('l', 'l', '/l/', true), S('oo', 'short-u', '/ʊ/'), S('k', 'k', '/k/')] },
      { word: 'light', phonetic: '/laɪt/', meaning: '光', segments: [S('l', 'l', '/l/', true), S('igh', 'diphthong-ai', '/aɪ/'), S('t', 't', '/t/')] },
    ],
  },
  w: {
    patterns: [{ grapheme: 'w / wh', examples: ['we', 'west', 'win'], ruleHint: '双唇收圆前突再瞬间张开，上齿绝不能碰到下唇' }],
    blendWords: [
      { word: 'west', phonetic: '/west/', meaning: '西方', segments: [S('w', 'w', '/w/', true), S('e', 'short-e', '/e/'), S('s', 's', '/s/'), S('t', 't', '/t/')] },
      { word: 'win', phonetic: '/wɪn/', meaning: '赢', segments: [S('w', 'w', '/w/', true), S('i', 'short-i', '/ɪ/'), S('n', 'n', '/n/')] },
    ],
  },
  y: {
    patterns: [{ grapheme: 'y / u', examples: ['yes', 'year', 'use'], ruleHint: '舌面抬近硬腭发出滑音“耶”，注意音标写为 /j/' }],
    blendWords: [
      { word: 'yes', phonetic: '/jes/', meaning: '是的', segments: [S('y', 'y', '/j/', true), S('e', 'short-e', '/e/'), S('s', 's', '/s/')] },
      { word: 'year', phonetic: '/jɪə/', meaning: '年份', segments: [S('y', 'y', '/j/', true), S('ear', 'diphthong-ia', '/ɪə/')] },
    ],
  },
};

/**
 * 14 组双胞胎易混音标的真实单词最小对立库（覆盖全部 14 对 CONFUSABLE_PAIRS + 延伸 /θ/ vs /s/）
 */
export const MINIMAL_WORD_PAIRS: MinimalWordPair[] = [
  {
    id: 'mw-sheep-ship',
    pairId: 'pair-i',
    leftId: 'long-i',
    rightId: 'short-i',
    leftWord: 'sheep',
    leftPhonetic: '/ʃiːp/',
    leftMeaning: '绵羊',
    rightWord: 'ship',
    rightPhonetic: '/ʃɪp/',
    rightMeaning: '轮船',
    focusTip: '首尾音都是 /ʃ/ 和 /p/，听中间是拉稳微笑的 /iː/ 还是短松收音的 /ɪ/。',
  },
  {
    id: 'mw-seat-sit',
    pairId: 'pair-i',
    leftId: 'long-i',
    rightId: 'short-i',
    leftWord: 'seat',
    leftPhonetic: '/siːt/',
    leftMeaning: '座位',
    rightWord: 'sit',
    rightPhonetic: '/sɪt/',
    rightMeaning: '坐',
    focusTip: 'seat 的 /iː/ 饱满展开，sit 的 /ɪ/ 干脆短促，切忌把 sit 拉长。',
  },
  {
    id: 'mw-bed-bad',
    pairId: 'pair-e-ae',
    leftId: 'short-e',
    rightId: 'short-ae',
    leftWord: 'bed',
    leftPhonetic: '/bed/',
    leftMeaning: '床',
    rightWord: 'bad',
    rightPhonetic: '/bæd/',
    rightMeaning: '坏的',
    focusTip: '两个词首尾相同！听中间口型是一指宽 /e/ 还是大口两指宽 /æ/。',
  },
  {
    id: 'mw-pen-pan',
    pairId: 'pair-e-ae',
    leftId: 'short-e',
    rightId: 'short-ae',
    leftWord: 'pen',
    leftPhonetic: '/pen/',
    leftMeaning: '钢笔',
    rightWord: 'pan',
    rightPhonetic: '/pæn/',
    rightMeaning: '平底锅',
    focusTip: 'pen 嘴型小而平，pan 嘴型大且舌尖抵住下齿背。',
  },
  {
    id: 'mw-pool-pull',
    pairId: 'pair-u',
    leftId: 'long-u',
    rightId: 'short-u',
    leftWord: 'pool',
    leftPhonetic: '/puːl/',
    leftMeaning: '水池',
    rightWord: 'pull',
    rightPhonetic: '/pʊl/',
    rightMeaning: '拉',
    focusTip: 'pool 双唇收得很小前突并拉长；pull 嘴唇微圆放松、收尾干脆。',
  },
  {
    id: 'mw-port-pot',
    pairId: 'pair-o',
    leftId: 'long-aw',
    rightId: 'short-o',
    leftWord: 'port',
    leftPhonetic: '/pɔːt/',
    leftMeaning: '港口',
    rightWord: 'pot',
    rightPhonetic: '/pɒt/',
    rightMeaning: '锅',
    focusTip: 'port 双唇明显拢圆饱满；pot 口型偏开且短促。',
  },
  {
    id: 'mw-dark-duck',
    pairId: 'pair-a-uh',
    leftId: 'long-a',
    rightId: 'short-uh',
    leftWord: 'dark',
    leftPhonetic: '/dɑːk/',
    leftMeaning: '黑暗的',
    rightWord: 'duck',
    rightPhonetic: '/dʌk/',
    rightMeaning: '鸭子',
    focusTip: 'dark 口腔靠后开阔且拉长；duck 口型小、像短促轻咳一样干脆。',
  },
  {
    id: 'mw-bird-about',
    pairId: 'pair-er-schwa',
    leftId: 'long-er',
    rightId: 'schwa',
    leftWord: 'bird',
    leftPhonetic: '/bɜːd/',
    leftMeaning: '小鸟',
    rightWord: 'about',
    rightPhonetic: '/əˈbaʊt/',
    rightMeaning: '关于',
    focusTip: 'bird 的 /ɜː/ 重读稳长；about 开头 /ə/ 极轻极快一笔带过。',
  },
  {
    id: 'mw-ear-air',
    pairId: 'pair-ia-ea',
    leftId: 'diphthong-ia',
    rightId: 'diphthong-ea',
    leftWord: 'ear',
    leftPhonetic: '/ɪə/',
    leftMeaning: '耳朵',
    rightWord: 'air',
    rightPhonetic: '/eə/',
    rightMeaning: '空气',
    focusTip: '听起音！ear 从高窄的 /ɪ/ 起步，air 从半开放松的 /e/ 起步。',
  },
  {
    id: 'mw-hear-hair',
    pairId: 'pair-ia-ea',
    leftId: 'diphthong-ia',
    rightId: 'diphthong-ea',
    leftWord: 'hear',
    leftPhonetic: '/hɪə/',
    leftMeaning: '听见',
    rightWord: 'hair',
    rightPhonetic: '/heə/',
    rightMeaning: '头发',
    focusTip: 'hear 嘴角略收起于 /ɪə/；hair 开头更宽展于 /eə/。',
  },
  {
    id: 'mw-thin-then',
    pairId: 'pair-th',
    leftId: 'voiceless-th',
    rightId: 'voiced-th',
    leftWord: 'thin',
    leftPhonetic: '/θɪn/',
    leftMeaning: '瘦的',
    rightWord: 'then',
    rightPhonetic: '/ðen/',
    rightMeaning: '那时',
    focusTip: '都必须轻咬舌尖！thin 开头只有纯气声，then 开头摸喉咙有震动。',
  },
  {
    id: 'mw-mouth-mouse',
    pairId: 'pair-th',
    leftId: 'voiceless-th',
    rightId: 's',
    leftWord: 'mouth',
    leftPhonetic: '/maʊθ/',
    leftMeaning: '嘴巴',
    rightWord: 'mouse',
    rightPhonetic: '/maʊs/',
    rightMeaning: '老鼠',
    focusTip: '中国学生最常混的一对！mouth 结尾必须伸舌尖轻咬；mouse 舌尖缩在齿后嘶嘶吐气。',
  },
  {
    id: 'mw-vest-west',
    pairId: 'pair-v-w',
    leftId: 'v',
    rightId: 'w',
    leftWord: 'vest',
    leftPhonetic: '/vest/',
    leftMeaning: '背心',
    rightWord: 'west',
    rightPhonetic: '/west/',
    rightMeaning: '西方',
    focusTip: 'vest 上牙咬住下唇内侧有摩擦感；west 绝不咬唇，双唇圆圆往前送。',
  },
  {
    id: 'mw-vet-wet',
    pairId: 'pair-v-w',
    leftId: 'v',
    rightId: 'w',
    leftWord: 'vet',
    leftPhonetic: '/vet/',
    leftMeaning: '兽医',
    rightWord: 'wet',
    rightPhonetic: '/wet/',
    rightMeaning: '湿的',
    focusTip: '短小清晰的唇齿咬合 /v/ 与纯圆唇滑音 /w/ 对比。',
  },
  {
    id: 'mw-fan-van',
    pairId: 'pair-f-v',
    leftId: 'f',
    rightId: 'v',
    leftWord: 'fan',
    leftPhonetic: '/fæn/',
    leftMeaning: '风扇',
    rightWord: 'van',
    rightPhonetic: '/væn/',
    rightMeaning: '面包车',
    focusTip: '口型完全一样，只看声带震不震：fan 清轻吹气，van 浊振饱满。',
  },
  {
    id: 'mw-sip-zip',
    pairId: 'pair-s-z',
    leftId: 's',
    rightId: 'z',
    leftWord: 'sip',
    leftPhonetic: '/sɪp/',
    leftMeaning: '啜饮',
    rightWord: 'zip',
    rightPhonetic: '/zɪp/',
    rightMeaning: '拉链',
    focusTip: 'sip 只听清晰嘶嘶气声；zip 起音带嗡嗡的声带震动。',
  },
  {
    id: 'mw-ship-measure',
    pairId: 'pair-sh-zh',
    leftId: 'sh',
    rightId: 'zh',
    leftWord: 'ship',
    leftPhonetic: '/ʃɪp/',
    leftMeaning: '轮船',
    rightWord: 'measure',
    rightPhonetic: '/ˈmeʒə/',
    rightMeaning: '测量',
    focusTip: 'ship 开头是清吹“嘘”音 /ʃ/；measure 中间是振喉浊音 /ʒ/。',
  },
  {
    id: 'mw-sin-sing',
    pairId: 'pair-n-ng',
    leftId: 'n',
    rightId: 'ng',
    leftWord: 'sin',
    leftPhonetic: '/sɪn/',
    leftMeaning: '过失',
    rightWord: 'sing',
    rightPhonetic: '/sɪŋ/',
    rightMeaning: '唱歌',
    focusTip: 'sin 舌尖顶前牙龈收音；sing 舌根抬起靠后共鸣，末尾别读出 /ɡ/。',
  },
  {
    id: 'mw-win-wing',
    pairId: 'pair-n-ng',
    leftId: 'n',
    rightId: 'ng',
    leftWord: 'win',
    leftPhonetic: '/wɪn/',
    leftMeaning: '赢',
    rightWord: 'wing',
    rightPhonetic: '/wɪŋ/',
    rightMeaning: '翅膀',
    focusTip: '分辨前鼻音 /n/（舌尖抵前）与后鼻音 /ŋ/（舌根抵后）。',
  },
  {
    id: 'mw-pig-big',
    pairId: 'pair-p-b',
    leftId: 'p',
    rightId: 'b',
    leftWord: 'pig',
    leftPhonetic: '/pɪɡ/',
    leftMeaning: '猪',
    rightWord: 'big',
    rightPhonetic: '/bɪɡ/',
    rightMeaning: '大的',
    focusTip: 'pig 起音有一股明显送气气流；big 几乎不吹纸，直接震动发声。',
  },
  {
    id: 'mw-park-bark',
    pairId: 'pair-p-b',
    leftId: 'p',
    rightId: 'b',
    leftWord: 'park',
    leftPhonetic: '/pɑːk/',
    leftMeaning: '公园',
    rightWord: 'bark',
    rightPhonetic: '/bɑːk/',
    rightMeaning: '树皮/犬吠',
    focusTip: '同一词尾对比清爆破 /p/ 的强送气与浊爆破 /b/ 的低沉振喉。',
  },
];

/**
 * 「看音标猜单词」防首字母瞎蒙同系干扰词群（每组 4 个相近词形 / 最小对立词）
 * 确保学生必须真正读懂音标里的元音或清浊辅音差别才能选对！
 */
export const CONFUSABLE_WORD_GROUPS: WordDistractorGroup[] = [
  {
    words: [
      { word: 'sheep', phonetic: '/ʃiːp/', meaning: '绵羊' },
      { word: 'ship', phonetic: '/ʃɪp/', meaning: '轮船' },
      { word: 'shop', phonetic: '/ʃɒp/', meaning: '商店' },
      { word: 'cheap', phonetic: '/tʃiːp/', meaning: '便宜的' },
    ],
  },
  {
    words: [
      { word: 'bed', phonetic: '/bed/', meaning: '床' },
      { word: 'bad', phonetic: '/bæd/', meaning: '坏的' },
      { word: 'bag', phonetic: '/bæɡ/', meaning: '书包' },
      { word: 'bat', phonetic: '/bæt/', meaning: '球拍/蝙蝠' },
    ],
  },
  {
    words: [
      { word: 'cup', phonetic: '/kʌp/', meaning: '杯子' },
      { word: 'cap', phonetic: '/kæp/', meaning: '鸭舌帽' },
      { word: 'cat', phonetic: '/kæt/', meaning: '猫' },
      { word: 'car', phonetic: '/kɑː/', meaning: '小汽车' },
    ],
  },
  {
    words: [
      { word: 'pen', phonetic: '/pen/', meaning: '钢笔' },
      { word: 'pan', phonetic: '/pæn/', meaning: '平底锅' },
      { word: 'pig', phonetic: '/pɪɡ/', meaning: '小猪' },
      { word: 'big', phonetic: '/bɪɡ/', meaning: '大的' },
    ],
  },
  {
    words: [
      { word: 'pool', phonetic: '/puːl/', meaning: '水池' },
      { word: 'pull', phonetic: '/pʊl/', meaning: '拉' },
      { word: 'port', phonetic: '/pɔːt/', meaning: '港口' },
      { word: 'pot', phonetic: '/pɒt/', meaning: '锅' },
    ],
  },
  {
    words: [
      { word: 'three', phonetic: '/θriː/', meaning: '三' },
      { word: 'tree', phonetic: '/triː/', meaning: '树' },
      { word: 'thin', phonetic: '/θɪn/', meaning: '瘦的' },
      { word: 'then', phonetic: '/ðen/', meaning: '那时' },
    ],
  },
  {
    words: [
      { word: 'mouth', phonetic: '/maʊθ/', meaning: '嘴巴' },
      { word: 'mouse', phonetic: '/maʊs/', meaning: '老鼠' },
      { word: 'house', phonetic: '/haʊs/', meaning: '房子' },
      { word: 'nose', phonetic: '/nəʊz/', meaning: '鼻子' },
    ],
  },
  {
    words: [
      { word: 'vest', phonetic: '/vest/', meaning: '背心' },
      { word: 'west', phonetic: '/west/', meaning: '西方' },
      { word: 'vet', phonetic: '/vet/', meaning: '兽医' },
      { word: 'wet', phonetic: '/wet/', meaning: '湿的' },
    ],
  },
  {
    words: [
      { word: 'sin', phonetic: '/sɪn/', meaning: '过失' },
      { word: 'sing', phonetic: '/sɪŋ/', meaning: '唱歌' },
      { word: 'win', phonetic: '/wɪn/', meaning: '赢' },
      { word: 'wing', phonetic: '/wɪŋ/', meaning: '翅膀' },
    ],
  },
  {
    words: [
      { word: 'ear', phonetic: '/ɪə/', meaning: '耳朵' },
      { word: 'air', phonetic: '/eə/', meaning: '空气' },
      { word: 'hear', phonetic: '/hɪə/', meaning: '听见' },
      { word: 'hair', phonetic: '/heə/', meaning: '头发' },
    ],
  },
  {
    words: [
      { word: 'sip', phonetic: '/sɪp/', meaning: '啜饮' },
      { word: 'zip', phonetic: '/zɪp/', meaning: '拉链' },
      { word: 'sit', phonetic: '/sɪt/', meaning: '坐' },
      { word: 'seat', phonetic: '/siːt/', meaning: '座位' },
    ],
  },
  {
    words: [
      { word: 'park', phonetic: '/pɑːk/', meaning: '公园' },
      { word: 'bark', phonetic: '/bɑːk/', meaning: '犬吠/树皮' },
      { word: 'dark', phonetic: '/dɑːk/', meaning: '黑暗的' },
      { word: 'duck', phonetic: '/dʌk/', meaning: '鸭子' },
    ],
  },
];

/** 获取某个音标相关的所有最小对立词对（若直接匹配不到，则返回默认对照） */
export function getMinimalPairsForPhoneme(phonemeId: string): MinimalWordPair[] {
  return MINIMAL_WORD_PAIRS.filter(
    (pair) => pair.leftId === phonemeId || pair.rightId === phonemeId,
  );
}

/** 根据目标词匹配防作弊同形近音干扰项（优先同组，其次同首字母词） */
export function getDistractorsForWord(
  targetWord: string,
  allCandidateWords: Array<{ word: string; phonetic: string; meaning: string }>,
): Array<{ word: string; phonetic: string; meaning: string }> {
  const lower = targetWord.trim().toLowerCase();
  const group = CONFUSABLE_WORD_GROUPS.find((g) =>
    g.words.some((w) => w.word.toLowerCase() === lower),
  );
  if (group) {
    return group.words.filter((w) => w.word.toLowerCase() !== lower).slice(0, 3);
  }
  const firstChar = lower[0] ?? '';
  const sameInitial = allCandidateWords.filter(
    (w) => w.word.toLowerCase() !== lower && w.word.toLowerCase().startsWith(firstChar),
  );
  const others = allCandidateWords.filter(
    (w) => w.word.toLowerCase() !== lower && !w.word.toLowerCase().startsWith(firstChar),
  );
  return [...sameInitial, ...others].slice(0, 3);
}
