/**
 * 本地浏览器端发音匹配度分析与抗噪裁剪引擎
 * 结合 VTLN 声道归一化、MFCC+Delta 与峰值梅尔共振峰 DTW、音位学先验与 48 音素竞争性评分（GOP）
 */

import rawTemplates from '../data/phoneme-templates.json' with { type: 'json' };
import {
  applyHighPassFilter,
  computeFrameRms,
  CONFUSABLE_NEIGHBORS,
  dequantizeTemplate,
  extractAcousticSignature,
  LONG_VOWEL_IDS,
  phoneticPriorScore,
  scoreAgainstTemplate,
  SHORT_VOWEL_IDS,
  TARGET_SAMPLE_RATE,
  trimStudioAudio,
  VOICED_OBSTRUENT_IDS,
  VOICELESS_IDS,
  VTLN_WARPS,
  type AcousticSignature,
  type PhonemeTemplateMap,
} from './acoustic-features.ts';

export interface PronunciationComparisonResult {
  status: 'ok' | 'too-quiet';
  /** 综合匹配度 0-100 */
  overallScore: number;
  /** 口型与音色频谱相似度 0-100 */
  timbreScore: number;
  /** 时长与节奏匹配度 0-100 */
  rhythmScore: number;
  /** 发声/清浊/滑动细项分 0-100 */
  articulationScore: number;
  /** 细项名称（清浊声带 / 滑动轨迹 / 发声纯净度） */
  articulationLabel: string;
  /** 若发音明显偏向另一音标时给出的提示 */
  closestOtherPhoneme?: { id: string; symbol: string };
  /** 示范音频有效发声时长（秒） */
  referenceDurationSec: number;
  /** 个人跟读有效发声时长（秒） */
  userDurationSec: number;
  /** 标准原声归一化波形包络（40 柱） */
  referenceWaveform: number[];
  /** 个人跟读归一化波形包络（40 柱） */
  userWaveform: number[];
  /** 等级标签 */
  gradeLabel: string;
  /** 针对性改进建议 */
  feedbackTip: string;
}

export interface SpeechBoundsResult {
  hasSpeech: boolean;
  startSample: number;
  endSample: number;
  peak: number;
  noiseFloor: number;
}

interface SpeechSegment {
  startFrame: number;
  endFrame: number;
  excessEnergy: number;
  maxSegRms: number;
}

export interface AnalyzePronunciationOptions {
  userAlreadyTrimmed?: boolean;
  userHasSpeech?: boolean;
}

export interface TrimmedAudioResult {
  blob: Blob;
  hasSpeech: boolean;
  leadingTrimmedSec: number;
  trailingTrimmedSec: number;
}

const WAVEFORM_BAR_COUNT = 40;

interface DecodedTemplateEntry {
  id: string;
  symbol: string;
  category: string;
  sig: AcousticSignature;
}

const PHONEME_TEMPLATE_ENTRIES: DecodedTemplateEntry[] = Object.entries(
  rawTemplates as PhonemeTemplateMap,
).map(([id, tpl]) => ({
  id,
  symbol: tpl.symbol,
  category: tpl.category,
  sig: dequantizeTemplate(tpl),
}));

const PHONEME_TEMPLATE_BY_ID = new Map<string, DecodedTemplateEntry>(
  PHONEME_TEMPLATE_ENTRIES.map((entry) => [entry.id, entry]),
);

let analyzerAudioContext: AudioContext | null = null;

function getAnalyzerAudioContext(): AudioContext {
  if (typeof window === 'undefined') {
    throw new Error('AudioContext is only available in browser');
  }
  const AudioCtx =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioCtx) {
    throw new Error('Web Audio API is not supported');
  }
  if (!analyzerAudioContext) {
    analyzerAudioContext = new AudioCtx();
  }
  return analyzerAudioContext;
}

function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}

/**
 * 将 AudioBuffer 混音为单声道 Float32Array
 */
function mixToMono(buffer: AudioBuffer): Float32Array {
  const length = buffer.length;
  const channels = buffer.numberOfChannels;
  const mono = new Float32Array(length);

  for (let ch = 0; ch < channels; ch += 1) {
    const data = buffer.getChannelData(ch);
    for (let i = 0; i < length; i += 1) {
      mono[i] += data[i] / channels;
    }
  }
  return mono;
}

/**
 * 将 AudioBuffer 混音为单声道并重采样到 16kHz
 */
function toMono16k(buffer: AudioBuffer): Float32Array {
  const mono = mixToMono(buffer);
  const length = mono.length;

  if (buffer.sampleRate === TARGET_SAMPLE_RATE) {
    return mono;
  }

  const ratio = buffer.sampleRate / TARGET_SAMPLE_RATE;
  const outLength = Math.max(1, Math.floor(length / ratio));
  const resampled = new Float32Array(outLength);

  for (let i = 0; i < outLength; i += 1) {
    const srcIndex = i * ratio;
    const low = Math.floor(srcIndex);
    const high = Math.min(length - 1, low + 1);
    const frac = srcIndex - low;
    resampled[i] = mono[low] * (1 - frac) + mono[high] * frac;
  }
  return resampled;
}

/**
 * 抗空调噪声与抗点击杂音的人声端点检测（VAD）
 * @param samples 单声道 PCM 采样
 * @param sampleRate 采样率
 * @param padStartFrames 起音前安全留白帧数（每帧 10ms）
 * @param padEndFrames 尾音后安全留白帧数（每帧 10ms）
 */
export function detectSpeechBounds(
  samples: Float32Array,
  sampleRate = TARGET_SAMPLE_RATE,
  padStartFrames = 4,
  padEndFrames = 8,
): SpeechBoundsResult {
  let peak = 0;
  for (let i = 0; i < samples.length; i += 1) {
    const absVal = Math.abs(samples[i]);
    if (absVal > peak) {
      peak = absVal;
    }
  }

  const frameSize = Math.max(1, Math.round(sampleRate * 0.01)); // 10ms
  const frameCount = Math.floor(samples.length / frameSize);
  if (frameCount === 0 || peak < 0.008) {
    return {
      hasSpeech: false,
      startSample: 0,
      endSample: 0,
      peak,
      noiseFloor: 0,
    };
  }

  // NOTE: 先做 200Hz 高通滤波，去掉空调低频嗡嗡声与桌面震动后再计算能量包络
  const vadSamples = applyHighPassFilter(samples, sampleRate, 200);
  const { frameRms: vadRms, maxRms } = computeFrameRms(vadSamples, frameSize);

  const sorted = Float32Array.from(vadRms).sort();
  const noiseFloor = sorted[Math.floor(frameCount * 0.18)];
  const p04 = sorted[Math.floor(frameCount * 0.04)];
  // NOTE: 仅在 <=18% 安静底噪分位区间估计波动带宽，避免人声占比较高时误将语音起步算作噪声分布
  const noiseSpread = Math.max(noiseFloor - p04, 0.0005);

  // 无前摇停顿的连续饱满发声保护
  if (maxRms >= 0.055 && noiseFloor / maxRms > 0.55) {
    return {
      hasSpeech: true,
      startSample: 0,
      endSample: samples.length,
      peak,
      noiseFloor,
    };
  }

  // 纯环境背景噪声判别（允许安静环境下峰值 >=0.006 且信噪比充裕的轻摩擦音如 /θ/ 通过）
  if (
    maxRms < 0.006 ||
    (maxRms < Math.max(noiseFloor * 1.7, noiseFloor + noiseSpread * 5.5) && maxRms < 0.055)
  ) {
    return {
      hasSpeech: false,
      startSample: 0,
      endSample: 0,
      peak,
      noiseFloor,
    };
  }

  // 双门限滞回阈值
  const enterThreshold = Math.max(
    noiseFloor + noiseSpread * 4.5,
    noiseFloor * 1.55,
    noiseFloor + (maxRms - noiseFloor) * 0.18,
    0.006,
  );
  const keepThreshold = Math.max(
    noiseFloor + noiseSpread * 2.0,
    noiseFloor * 1.25,
    noiseFloor + (maxRms - noiseFloor) * 0.07,
    0.003,
  );

  // 扫描候选语音段，允许桥接 <= 8 帧（80ms）的短暂能量谷
  const rawSegments: Array<{ startFrame: number; endFrame: number }> = [];
  let inSeg = false;
  let segStart = 0;
  let lastActive = 0;

  for (let f = 0; f < frameCount; f += 1) {
    if (vadRms[f] >= keepThreshold) {
      if (!inSeg) {
        inSeg = true;
        segStart = f;
      }
      lastActive = f;
    } else if (inSeg && f - lastActive > 8) {
      rawSegments.push({ startFrame: segStart, endFrame: lastActive });
      inSeg = false;
    }
  }
  if (inSeg) {
    rawSegments.push({ startFrame: segStart, endFrame: lastActive });
  }

  // 仅保留至少包含 1 帧 >= enterThreshold 的候选段，并统计超底噪能量
  const validSegments: SpeechSegment[] = [];
  for (const seg of rawSegments) {
    let hasEnter = false;
    let excessEnergy = 0;
    let maxSegRms = 0;
    for (let f = seg.startFrame; f <= seg.endFrame; f += 1) {
      const r = vadRms[f];
      if (r >= enterThreshold) {
        hasEnter = true;
      }
      if (r > maxSegRms) {
        maxSegRms = r;
      }
      excessEnergy += Math.max(0, r - noiseFloor);
    }
    if (hasEnter) {
      validSegments.push({
        startFrame: seg.startFrame,
        endFrame: seg.endFrame,
        excessEnergy,
        maxSegRms,
      });
    }
  }

  if (validSegments.length === 0) {
    return {
      hasSpeech: false,
      startSample: 0,
      endSample: 0,
      peak,
      noiseFloor,
    };
  }

  let keptSegments = validSegments;
  if (validSegments.length > 1) {
    const nonTransient = validSegments.filter((seg) => seg.endFrame - seg.startFrame + 1 > 4);
    const pool = nonTransient.length > 0 ? nonTransient : validSegments;
    let poolDominant = pool[0];
    for (const seg of pool) {
      if (seg.excessEnergy > poolDominant.excessEnergy) {
        poolDominant = seg;
      }
    }

    keptSegments = pool.filter((seg) => {
      if (seg === poolDominant) {
        return true;
      }
      const gap =
        seg.endFrame < poolDominant.startFrame
          ? poolDominant.startFrame - seg.endFrame
          : seg.startFrame > poolDominant.endFrame
            ? seg.startFrame - poolDominant.endFrame
            : 0;
      return seg.excessEnergy >= poolDominant.excessEnergy * 0.18 && gap <= 35;
    });
  } else {
    const only = validSegments[0];
    const durationFrames = only.endFrame - only.startFrame + 1;
    if (durationFrames < 5 && !(durationFrames >= 3 && only.maxSegRms >= noiseFloor * 2.4)) {
      return {
        hasSpeech: false,
        startSample: 0,
        endSample: 0,
        peak,
        noiseFloor,
      };
    }
  }

  let startFrame = keptSegments[0].startFrame;
  let endFrame = keptSegments[0].endFrame;
  for (const seg of keptSegments) {
    if (seg.startFrame < startFrame) {
      startFrame = seg.startFrame;
    }
    if (seg.endFrame > endFrame) {
      endFrame = seg.endFrame;
    }
  }

  // 起音向前最多回溯 6 帧（60ms）捕捉轻摩擦起步能量
  let backtrack = 0;
  while (startFrame > 0 && backtrack < 6 && vadRms[startFrame - 1] >= keepThreshold * 0.75) {
    startFrame -= 1;
    backtrack += 1;
  }

  const startSample = Math.max(0, (startFrame - padStartFrames) * frameSize);
  const endSample = Math.min(samples.length, (endFrame + 1 + padEndFrames) * frameSize);

  return {
    hasSpeech: endSample > startSample,
    startSample,
    endSample,
    peak,
    noiseFloor,
  };
}

/**
 * 提取固定柱数的归一化振幅包络，用于双轨波形对比展示
 */
function buildWaveformBars(samples: Float32Array): number[] {
  if (samples.length === 0) {
    return new Array<number>(WAVEFORM_BAR_COUNT).fill(0.08);
  }
  const bars: number[] = [];
  const blockSize = Math.max(1, Math.floor(samples.length / WAVEFORM_BAR_COUNT));
  let maxBar = 0;

  for (let i = 0; i < WAVEFORM_BAR_COUNT; i += 1) {
    const start = i * blockSize;
    const end =
      i === WAVEFORM_BAR_COUNT - 1 ? samples.length : Math.min(samples.length, start + blockSize);
    let sumSq = 0;
    for (let j = start; j < end; j += 1) {
      sumSq += samples[j] * samples[j];
    }
    const rms = Math.sqrt(sumSq / Math.max(1, end - start));
    bars.push(rms);
    if (rms > maxBar) {
      maxBar = rms;
    }
  }

  if (maxBar <= 1e-6) {
    return new Array<number>(WAVEFORM_BAR_COUNT).fill(0.08);
  }

  return bars.map((val) => Number(Math.max(0.1, val / maxBar).toFixed(3)));
}

/**
 * 纯 16kHz PCM 发音评测核心函数（便于浏览器分析器与离线 Node 评测共用）
 */
export function evaluatePronunciationPcm(
  phonemeId: string,
  refSamples16k: Float32Array,
  userSamples16k: Float32Array,
  options?: AnalyzePronunciationOptions,
): PronunciationComparisonResult {
  const refTrimmed = trimStudioAudio(refSamples16k);
  const refDurationSec = Number((refTrimmed.trimmed.length / TARGET_SAMPLE_RATE).toFixed(2));
  const referenceWaveform = buildWaveformBars(refTrimmed.trimmed);
  const targetMeta = PHONEME_TEMPLATE_BY_ID.get(phonemeId);
  const targetCategory = targetMeta?.category ?? 'monophthong';

  const makeQuietResult = (
    gradeLabel: string,
    feedbackTip: string,
    userDurationSec = 0,
  ): PronunciationComparisonResult => ({
    status: 'too-quiet',
    overallScore: 0,
    timbreScore: 0,
    rhythmScore: 0,
    articulationScore: 0,
    articulationLabel:
      targetCategory === 'diphthong'
        ? '滑动轨迹'
        : targetCategory === 'monophthong' || targetCategory === 'sonorant'
          ? '发声纯净度'
          : '清浊声带',
    referenceDurationSec: refDurationSec,
    userDurationSec,
    referenceWaveform,
    userWaveform: new Array<number>(WAVEFORM_BAR_COUNT).fill(0.08),
    gradeLabel,
    feedbackTip,
  });

  if (options?.userHasSpeech === false) {
    return makeQuietResult(
      '未检测到清晰读音',
      '只检测到环境背景声，请靠近麦克风清晰读一遍再试试哦。',
      0,
    );
  }

  let userTrimmedSamples: Float32Array;
  let userPeak = 0;

  if (options?.userAlreadyTrimmed) {
    userTrimmedSamples = userSamples16k;
    for (let i = 0; i < userSamples16k.length; i += 1) {
      const absVal = Math.abs(userSamples16k[i]);
      if (absVal > userPeak) {
        userPeak = absVal;
      }
    }
  } else {
    const bounds = detectSpeechBounds(userSamples16k, TARGET_SAMPLE_RATE, 2, 3);
    userTrimmedSamples = bounds.hasSpeech
      ? userSamples16k.subarray(bounds.startSample, bounds.endSample)
      : new Float32Array(0);
    userPeak = bounds.peak;
  }

  const userDurationSec = Number((userTrimmedSamples.length / TARGET_SAMPLE_RATE).toFixed(2));
  if (userTrimmedSamples.length < TARGET_SAMPLE_RATE * 0.06 || userPeak < 0.01) {
    return makeQuietResult(
      '声音太轻啦',
      '没有录到清晰的读音，请靠近麦克风大声读一遍再试试哦。',
      userDurationSec,
    );
  }

  const userWaveform = buildWaveformBars(userTrimmedSamples);

  // 对用户语音提取 4 组 VTLN 弯折特征（仅一次循环）
  const userByWarp: Record<number, AcousticSignature> = {};
  for (const w of VTLN_WARPS) {
    userByWarp[w] = extractAcousticSignature(userTrimmedSamples, w);
  }

  const refSig =
    refTrimmed.trimmed.length > 0
      ? extractAcousticSignature(refTrimmed.trimmed, 1.0)
      : (targetMeta?.sig ?? extractAcousticSignature(userTrimmedSamples, 1.0));

  const targetBreakdown = scoreAgainstTemplate(phonemeId, targetCategory, refSig, userByWarp);

  // 计算在 48 音素参考池上的竞争性得分（GOP）
  const allScores = new Map<string, number>();
  let sumScores = 0;
  let countScores = 0;

  for (const entry of PHONEME_TEMPLATE_ENTRIES) {
    const sc =
      entry.id === phonemeId
        ? targetBreakdown.rawScore
        : scoreAgainstTemplate(entry.id, entry.category, entry.sig, userByWarp).rawScore;
    allScores.set(entry.id, sc);
    sumScores += sc;
    countScores += 1;
  }

  let overallScore: number;
  if (countScores >= 2) {
    const colMean = sumScores / countScores;
    let varSum = 0;
    for (const sc of allScores.values()) {
      const d = sc - colMean;
      varSum += d * d;
    }
    const colStd = Math.max(Math.sqrt(varSum / countScores), 0.04);
    const zPart = clamp(((targetBreakdown.rawScore - colMean) / (2.2 * colStd)) * 0.5 + 0.5, 0, 1);
    const blended = 0.65 * targetBreakdown.rawScore + 0.35 * zPart;
    overallScore = Math.round(clamp(((blended - 0.32) / (0.86 - 0.32)) * 85 + 15, 10, 99));
  } else {
    overallScore = Math.round(
      clamp(((targetBreakdown.rawScore - 0.32) / (0.86 - 0.32)) * 85 + 15, 10, 99),
    );
  }

  const timbreScore = Math.round(
    clamp(((targetBreakdown.specScore - 0.25) / 0.63) * 65 + 34, 20, 99),
  );
  const rhythmScore = Math.round(clamp(targetBreakdown.durScore * 100, 35, 100));

  let articulationLabel: string;
  let articulationScore: number;
  if (
    targetCategory === 'fricative' ||
    targetCategory === 'affricate' ||
    targetCategory === 'plosive'
  ) {
    articulationLabel = '清浊声带';
    articulationScore = Math.round(clamp(targetBreakdown.phonOk * 100, 10, 100));
  } else if (targetCategory === 'diphthong') {
    articulationLabel = '滑动轨迹';
    articulationScore = Math.round(clamp(targetBreakdown.glideScore * 100, 20, 100));
  } else {
    articulationLabel = '发声纯净度';
    articulationScore = Math.round(clamp(targetBreakdown.phonOk * 100, 15, 100));
  }

  // 当综合匹配度不够高时，查找是否明显偏向某个易混音标或其他竞争音标
  let closestOtherPhoneme: { id: string; symbol: string } | undefined;
  if (overallScore < 82) {
    const neighborIds = CONFUSABLE_NEIGHBORS[phonemeId] ?? [];
    let bestCompetitorId: string | null = null;
    let bestCompetitorScore = targetBreakdown.rawScore;

    for (const nid of neighborIds) {
      const s = allScores.get(nid);
      if (s !== undefined && s - targetBreakdown.rawScore >= 0.035 && s > bestCompetitorScore) {
        bestCompetitorScore = s;
        bestCompetitorId = nid;
      }
    }
    if (!bestCompetitorId) {
      for (const [otherId, s] of allScores.entries()) {
        if (
          otherId !== phonemeId &&
          s - targetBreakdown.rawScore >= 0.055 &&
          s > bestCompetitorScore
        ) {
          bestCompetitorScore = s;
          bestCompetitorId = otherId;
        }
      }
    }
    if (bestCompetitorId) {
      const compMeta = PHONEME_TEMPLATE_BY_ID.get(bestCompetitorId);
      if (compMeta) {
        closestOtherPhoneme = { id: bestCompetitorId, symbol: compMeta.symbol };
      }
    }
  }

  let gradeLabel = '再练一练';
  if (overallScore >= 88) {
    gradeLabel = '超级像！';
  } else if (overallScore >= 76) {
    gradeLabel = '很标准！';
  } else if (overallScore >= 62) {
    gradeLabel = '比较接近';
  }

  const ratio = refDurationSec > 0 ? userDurationSec / refDurationSec : 1;
  const userPhonOk = phoneticPriorScore(phonemeId, targetBreakdown.bestUserSig);
  let feedbackTip = '很不错！已经很贴近示范了，点“轮流对比听”再微调一下细节会更棒。';

  if (VOICELESS_IDS.has(phonemeId) && userPhonOk < 0.55) {
    feedbackTip = '注意这是清辅音，声带不要震动，只用气流轻轻吹出即可。';
  } else if (VOICED_OBSTRUENT_IDS.has(phonemeId) && userPhonOk < 0.55) {
    feedbackTip = '注意这是浊辅音，摸一下喉咙要有明显的声带震动感哦。';
  } else if (LONG_VOWEL_IDS.has(phonemeId) && ratio < 0.58 && refDurationSec >= 0.45) {
    feedbackTip = `长元音要注意拉稳时长（原声 ${refDurationSec}s / 你的 ${userDurationSec}s）。`;
  } else if (SHORT_VOWEL_IDS.has(phonemeId) && ratio > 1.85 && refDurationSec <= 0.45) {
    feedbackTip = `短元音可以再干脆短促一些（原声 ${refDurationSec}s / 你的 ${userDurationSec}s）。`;
  } else if (targetCategory === 'diphthong' && targetBreakdown.glideScore < 0.62) {
    feedbackTip = '双元音需要从一个口型自然滑向下一个口型，不要发成单一长音。';
  } else if (closestOtherPhoneme) {
    feedbackTip = `听起来有点偏像 ${closestOtherPhoneme.symbol}，可以对照口型视频再微调舌位与唇形。`;
  } else if (overallScore >= 88) {
    feedbackTip = '太标准了！音色、清浊和长短节奏都非常接近示范原声！';
  } else if (overallScore < 76) {
    feedbackTip = '和标准口型还有一点差距，建议先慢速看右上角口型视频，再试着模仿一遍。';
  }

  return {
    status: 'ok',
    overallScore,
    timbreScore,
    rhythmScore,
    articulationScore,
    articulationLabel,
    closestOtherPhoneme,
    referenceDurationSec: refDurationSec,
    userDurationSec,
    referenceWaveform,
    userWaveform,
    gradeLabel,
    feedbackTip,
  };
}

/**
 * 综合比较学习者录音与标准音标 MP3 的匹配度，并结合 48 音素参考池做竞争性诊断
 * @param phonemeId 当前练习音标 id
 * @param referenceUrl 标准音标 MP3 路径
 * @param recordedBlob 浏览器录制音频 Blob
 * @param options 裁剪状态参数，避免对已抗噪裁剪后的录音进行二次误裁剪
 */
export async function analyzePronunciation(
  phonemeId: string,
  referenceUrl: string,
  recordedBlob: Blob,
  options?: AnalyzePronunciationOptions,
): Promise<PronunciationComparisonResult> {
  const ctx = getAnalyzerAudioContext();

  const [refArrayBuf, userArrayBuf] = await Promise.all([
    fetch(referenceUrl).then((res) => res.arrayBuffer()),
    recordedBlob.arrayBuffer(),
  ]);

  const [refBuffer, userBuffer] = await Promise.all([
    ctx.decodeAudioData(refArrayBuf.slice(0)),
    ctx.decodeAudioData(userArrayBuf.slice(0)),
  ]);

  const refMono = toMono16k(refBuffer);
  const userMono = toMono16k(userBuffer);

  return evaluatePronunciationPcm(phonemeId, refMono, userMono, options);
}

/**
 * 将单声道 PCM 采样编码为标准 16-bit WAV 音频 Blob，确保各浏览器回放零解码兼容性问题
 */
function encodeWavBlob(samples: Float32Array, sampleRate: number): Blob {
  const dataBytes = samples.length * 2;
  const buffer = new ArrayBuffer(44 + dataBytes);
  const view = new DataView(buffer);

  const writeAscii = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i += 1) {
      view.setUint8(offset + i, text.charCodeAt(i));
    }
  };

  writeAscii(0, 'RIFF');
  view.setUint32(4, 36 + dataBytes, true);
  writeAscii(8, 'WAVE');
  writeAscii(12, 'fmt ');
  view.setUint32(16, 16, true); // PCM chunk size
  view.setUint16(20, 1, true); // PCM format
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeAscii(36, 'data');
  view.setUint32(40, dataBytes, true);

  let offset = 44;
  for (let i = 0; i < samples.length; i += 1) {
    const clamped = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, true);
    offset += 2;
  }

  return new Blob([buffer], { type: 'audio/wav' });
}

/**
 * 抗噪裁掉录音开头与结尾的停顿及空调等低频杂声，让回放与对比一按即响
 * @param recordedBlob 原始录制音频 Blob
 */
export async function trimRecordedAudioBlob(recordedBlob: Blob): Promise<TrimmedAudioResult> {
  try {
    const ctx = getAnalyzerAudioContext();
    const rawArrayBuf = await recordedBlob.arrayBuffer();
    const decoded = await ctx.decodeAudioData(rawArrayBuf.slice(0));
    const mono = mixToMono(decoded);
    const bounds = detectSpeechBounds(mono, decoded.sampleRate, 4, 8);
    const trimmedLen = bounds.endSample - bounds.startSample;

    if (!bounds.hasSpeech || trimmedLen < decoded.sampleRate * 0.06) {
      return {
        blob: recordedBlob,
        hasSpeech: false,
        leadingTrimmedSec: 0,
        trailingTrimmedSec: 0,
      };
    }

    const segment = mono.subarray(bounds.startSample, bounds.endSample);
    // 轻度 90Hz 高通滤波去掉空调超低频嗡嗡声，保持人声自然饱满
    const cleaned = applyHighPassFilter(segment, decoded.sampleRate, 90);

    // 首尾极短 8ms 线性淡入淡出，消除切点咔哒声
    const fadeSamples = Math.min(
      Math.floor(cleaned.length / 4),
      Math.round(decoded.sampleRate * 0.008),
    );
    for (let i = 0; i < fadeSamples; i += 1) {
      const gain = i / Math.max(1, fadeSamples);
      cleaned[i] *= gain;
      cleaned[cleaned.length - 1 - i] *= gain;
    }

    return {
      blob: encodeWavBlob(cleaned, decoded.sampleRate),
      hasSpeech: true,
      leadingTrimmedSec: Number((bounds.startSample / decoded.sampleRate).toFixed(2)),
      trailingTrimmedSec: Number(
        ((mono.length - bounds.endSample) / decoded.sampleRate).toFixed(2),
      ),
    };
  } catch {
    return {
      blob: recordedBlob,
      hasSpeech: true,
      leadingTrimmedSec: 0,
      trailingTrimmedSec: 0,
    };
  }
}
