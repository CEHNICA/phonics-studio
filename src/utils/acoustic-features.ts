/**
 * 纯声学信号处理、梅尔滤波器组、特征提取与音位匹配度打分引擎
 * 无 DOM / JSON 依赖，供浏览器分析器与离线模板生成脚本共用。
 */

export const TARGET_SAMPLE_RATE = 16000;
export const FFT_SIZE = 512;
export const HOP_SIZE = 160; // 10ms @ 16kHz
export const TEMPLATE_FRAMES = 8;
export const VTLN_WARPS = [0.94, 1.0, 1.06, 1.12] as const;

const MFCC_BANDS = 26;
const MFCC_DIM = 12; // c1..c12，忽略总能量项 c0
const PEAK_MEL_BANDS = 22;

export const VOICELESS_IDS = new Set([
  'p',
  't',
  'k',
  'f',
  'voiceless-th',
  's',
  'sh',
  'h',
  'ch',
  'tr',
  'ts',
]);

export const VOICED_OBSTRUENT_IDS = new Set([
  'b',
  'd',
  'g',
  'v',
  'voiced-th',
  'z',
  'zh',
  'j',
  'dr',
  'dz',
]);

export const LONG_VOWEL_IDS = new Set([
  'long-i',
  'long-er',
  'long-u',
  'long-aw',
  'long-a',
]);

export const SHORT_VOWEL_IDS = new Set([
  'short-i',
  'short-e',
  'short-ae',
  'schwa',
  'short-uh',
  'short-u',
  'short-o',
]);

export const CONFUSABLE_NEIGHBORS: Record<string, string[]> = {
  'long-i': ['short-i'],
  'short-i': ['long-i'],
  'short-e': ['short-ae'],
  'short-ae': ['short-e'],
  'long-u': ['short-u'],
  'short-u': ['long-u'],
  'long-aw': ['short-o'],
  'short-o': ['long-aw'],
  'long-a': ['short-uh'],
  'short-uh': ['long-a'],
  'long-er': ['schwa'],
  schwa: ['long-er'],
  'diphthong-ia': ['diphthong-ea'],
  'diphthong-ea': ['diphthong-ia'],
  'voiceless-th': ['voiced-th', 's', 'f'],
  'voiced-th': ['voiceless-th', 'z', 'd'],
  v: ['w', 'f'],
  w: ['v'],
  f: ['v', 'voiceless-th'],
  s: ['z', 'voiceless-th'],
  z: ['s', 'voiced-th'],
  sh: ['zh', 'ch'],
  zh: ['sh', 'j'],
  n: ['ng', 'm'],
  ng: ['n'],
  p: ['b'],
  b: ['p'],
  t: ['d'],
  d: ['t'],
  k: ['g'],
  g: ['k'],
};

export interface AcousticSignature {
  /** 8 帧 24 维归一化（预加重 MFCC + 0.5*Delta） */
  md8: Float32Array[];
  /** 8 帧 22 维峰值归一化共振峰对数梅尔包络 */
  p8: Float32Array[];
  /** 12 维双元音起止滑动方向单位向量 */
  glideVec: Float32Array;
  /** 滑动幅度 */
  glideMag: number;
  /** 核心帧低频（80-500Hz）能量占比 */
  lowRatio: number;
  /** 核心帧高频（2200-7600Hz）能量占比 */
  highRatio: number;
  /** 核心帧过零率 */
  zcr: number;
  /** 有效发声时长（秒） */
  durationSec: number;
}

export interface QuantizedPhonemeTemplate {
  symbol: string;
  category: string;
  md: number[][];
  p: number[][];
  gv: number[];
  gm: number;
  lr: number;
  hr: number;
  zcr: number;
  dur: number;
}

export type PhonemeTemplateMap = Record<string, QuantizedPhonemeTemplate>;

export interface TemplateMatchBreakdown {
  rawScore: number;
  specScore: number;
  durScore: number;
  glideScore: number;
  phonOk: number;
  bestUserSig: AcousticSignature;
}

/**
 * 原位基-2 Cooley-Tukey 快速傅里叶变换
 */
export function fftInPlace(real: Float32Array, imag: Float32Array): void {
  const n = real.length;
  let j = 0;
  for (let i = 1; i < n; i += 1) {
    let bit = n >> 1;
    while (j & bit) {
      j ^= bit;
      bit >>= 1;
    }
    j ^= bit;
    if (i < j) {
      const tmpR = real[i];
      real[i] = real[j];
      real[j] = tmpR;
      const tmpI = imag[i];
      imag[i] = imag[j];
      imag[j] = tmpI;
    }
  }

  for (let len = 2; len <= n; len <<= 1) {
    const angle = (-2 * Math.PI) / len;
    const wlenR = Math.cos(angle);
    const wlenI = Math.sin(angle);
    for (let i = 0; i < n; i += len) {
      let wR = 1;
      let wI = 0;
      const half = len >> 1;
      for (let k = 0; k < half; k += 1) {
        const uR = real[i + k];
        const uI = imag[i + k];
        const vR = real[i + k + half] * wR - imag[i + k + half] * wI;
        const vI = real[i + k + half] * wI + imag[i + k + half] * wR;
        real[i + k] = uR + vR;
        imag[i + k] = uI + vI;
        real[i + k + half] = uR - vR;
        imag[i + k + half] = uI - vI;
        const nextWR = wR * wlenR - wI * wlenI;
        wI = wR * wlenI + wI * wlenR;
        wR = nextWR;
      }
    }
  }
}

/**
 * 二阶巴特沃斯高通滤波器（Audio EQ Cookbook + Direct Form II Transposed）
 */
export function applyHighPassFilter(
  samples: Float32Array,
  sampleRate: number,
  cutoffHz: number,
): Float32Array {
  if (samples.length === 0 || cutoffHz <= 0 || cutoffHz >= sampleRate * 0.45) {
    return samples;
  }

  const omega = (2 * Math.PI * cutoffHz) / sampleRate;
  const sinW = Math.sin(omega);
  const cosW = Math.cos(omega);
  const alpha = sinW / (2 * Math.SQRT1_2);
  const a0 = 1 + alpha;

  const b0 = (1 + cosW) / 2 / a0;
  const b1 = -(1 + cosW) / a0;
  const b2 = b0;
  const a1 = (-2 * cosW) / a0;
  const a2 = (1 - alpha) / a0;

  const output = new Float32Array(samples.length);
  let z1 = 0;
  let z2 = 0;

  for (let i = 0; i < samples.length; i += 1) {
    const x = samples[i];
    const y = b0 * x + z1;
    z1 = b1 * x - a1 * y + z2;
    z2 = b2 * x - a2 * y;
    output[i] = y;
  }
  return output;
}

/**
 * 计算按帧切分的 RMS 能量数组与全局峰值
 */
export function computeFrameRms(
  samples: Float32Array,
  frameSize: number,
): { frameRms: Float32Array; maxRms: number } {
  const frameCount = Math.floor(samples.length / frameSize);
  const frameRms = new Float32Array(frameCount);
  let maxRms = 0;

  for (let f = 0; f < frameCount; f += 1) {
    let sumSq = 0;
    const offset = f * frameSize;
    for (let j = 0; j < frameSize; j += 1) {
      const s = samples[offset + j];
      sumSq += s * s;
    }
    const rms = Math.sqrt(sumSq / frameSize);
    frameRms[f] = rms;
    if (rms > maxRms) {
      maxRms = rms;
    }
  }
  return { frameRms, maxRms };
}

/**
 * 裁剪录音棚干净参考音频的首尾静音，保留轻辅音起止
 */
export function trimStudioAudio(
  samples: Float32Array,
  sampleRate = TARGET_SAMPLE_RATE,
  padStartFrames = 2,
  padEndFrames = 3,
): { trimmed: Float32Array; peak: number } {
  let peak = 0;
  for (let i = 0; i < samples.length; i += 1) {
    const absVal = Math.abs(samples[i]);
    if (absVal > peak) {
      peak = absVal;
    }
  }
  if (peak < 0.008) {
    return { trimmed: new Float32Array(0), peak };
  }

  const frameSize = Math.max(1, Math.round(sampleRate * 0.01));
  const frameCount = Math.floor(samples.length / frameSize);
  if (frameCount === 0) {
    return { trimmed: samples, peak };
  }

  const { frameRms, maxRms } = computeFrameRms(samples, frameSize);
  const threshold = Math.max(maxRms * 0.06, 0.004);
  let startFrame = 0;
  while (startFrame < frameCount && frameRms[startFrame] < threshold) {
    startFrame += 1;
  }
  let endFrame = frameCount - 1;
  while (endFrame > startFrame && frameRms[endFrame] < threshold) {
    endFrame -= 1;
  }

  if (startFrame > endFrame) {
    return { trimmed: new Float32Array(0), peak };
  }

  const paddedStart = Math.max(0, (startFrame - padStartFrames) * frameSize);
  const paddedEnd = Math.min(samples.length, (endFrame + padEndFrames) * frameSize);
  return {
    trimmed: samples.subarray(paddedStart, paddedEnd),
    peak,
  };
}

function hzToMel(hz: number): number {
  return 2595 * Math.log10(1 + hz / 700);
}

function melToHz(mel: number): number {
  return 700 * (Math.pow(10, mel / 2595) - 1);
}

function buildMelFilterbank(
  nMels: number,
  fMin: number,
  fMax: number,
  warp: number,
  areaNorm: boolean,
): Float32Array[] {
  const nBins = FFT_SIZE / 2 + 1;
  const minMel = hzToMel(fMin);
  const maxMel = hzToMel(fMax);
  const binHz = TARGET_SAMPLE_RATE / FFT_SIZE;

  const binCenters = new Float32Array(nMels + 2);
  for (let i = 0; i < nMels + 2; i += 1) {
    const mel = minMel + ((maxMel - minMel) * i) / (nMels + 1);
    const hz = Math.min(TARGET_SAMPLE_RATE / 2 - 1, Math.max(0, melToHz(mel) * warp));
    binCenters[i] = hz / binHz;
  }

  const bank: Float32Array[] = [];
  for (let m = 0; m < nMels; m += 1) {
    const left = binCenters[m];
    const center = Math.max(left + 1e-4, binCenters[m + 1]);
    const right = Math.max(center + 1e-4, binCenters[m + 2]);
    const weights = new Float32Array(nBins);
    let area = 0;

    for (let k = 0; k < nBins; k += 1) {
      if (k >= left && k <= center) {
        weights[k] = (k - left) / (center - left);
      } else if (k > center && k <= right) {
        weights[k] = (right - k) / (right - center);
      }
      area += weights[k];
    }

    if (areaNorm && area > 1e-6) {
      for (let k = 0; k < nBins; k += 1) {
        weights[k] /= area;
      }
    }
    bank.push(weights);
  }
  return bank;
}

const HANN_WINDOW = (() => {
  const win = new Float32Array(FFT_SIZE);
  for (let i = 0; i < FFT_SIZE; i += 1) {
    win[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (FFT_SIZE - 1)));
  }
  return win;
})();

const LIFTER_MOD = (() => {
  const arr = new Float32Array(MFCC_DIM);
  for (let k = 1; k <= MFCC_DIM; k += 1) {
    arr[k - 1] = 1 + 0.25 * MFCC_DIM * Math.sin((Math.PI * k) / MFCC_DIM);
  }
  return arr;
})();

const DCT_BASIS = (() => {
  const scale = Math.sqrt(2 / MFCC_BANDS);
  const basis: Float32Array[] = [];
  for (let k = 1; k <= MFCC_DIM; k += 1) {
    const row = new Float32Array(MFCC_BANDS);
    for (let m = 0; m < MFCC_BANDS; m += 1) {
      row[m] = scale * Math.cos((Math.PI * k * (m + 0.5)) / MFCC_BANDS);
    }
    basis.push(row);
  }
  return basis;
})();

const FB_MFCC_CACHE = new Map<number, Float32Array[]>();
const FB_PEAK_CACHE = new Map<number, Float32Array[]>();
for (const w of VTLN_WARPS) {
  FB_MFCC_CACHE.set(w, buildMelFilterbank(MFCC_BANDS, 80, 7600, w, false));
  FB_PEAK_CACHE.set(w, buildMelFilterbank(PEAK_MEL_BANDS, 100, 7600, w, true));
}

function l2NormalizeInPlace(vec: Float32Array): number {
  let normSq = 0;
  for (let i = 0; i < vec.length; i += 1) {
    normSq += vec[i] * vec[i];
  }
  const norm = Math.sqrt(normSq);
  if (norm > 1e-6) {
    for (let i = 0; i < vec.length; i += 1) {
      vec[i] /= norm;
    }
  }
  return norm;
}

function resampleSequence(seq: Float32Array[], targetLen = TEMPLATE_FRAMES): Float32Array[] {
  const n = seq.length;
  if (n === 0) {
    return [];
  }
  const dim = seq[0].length;
  if (n === 1) {
    return Array.from({ length: targetLen }, () => Float32Array.from(seq[0]));
  }
  const out: Float32Array[] = [];
  for (let k = 0; k < targetLen; k += 1) {
    const pos = (k * (n - 1)) / (targetLen - 1);
    const lo = Math.floor(pos);
    const hi = Math.min(n - 1, lo + 1);
    const frac = pos - lo;
    const vec = new Float32Array(dim);
    for (let d = 0; d < dim; d += 1) {
      vec[d] = seq[lo][d] * (1 - frac) + seq[hi][d] * frac;
    }
    l2NormalizeInPlace(vec);
    out.push(vec);
  }
  return out;
}

function medianOf(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * 提取与参考模板完全对齐的多维声学特征签名（供 VTLN 与 48 音素竞争性打分使用）
 */
export function extractAcousticSignature(
  rawSamples: Float32Array,
  warp = 1.0,
): AcousticSignature {
  const nLen = rawSamples.length;
  let sumSqAll = 0;
  for (let i = 0; i < nLen; i += 1) {
    sumSqAll += rawSamples[i] * rawSamples[i];
  }
  const gain = 0.1 / Math.sqrt(sumSqAll / Math.max(1, nLen) + 1e-10);
  const xNorm = new Float32Array(Math.max(FFT_SIZE, nLen));
  for (let i = 0; i < nLen; i += 1) {
    xNorm[i] = rawSamples[i] * gain;
  }

  // 0.95 预加重序列，平衡鼻腔/元音高频衰减
  const xPre = new Float32Array(xNorm.length);
  xPre[0] = xNorm[0];
  for (let i = 1; i < xNorm.length; i += 1) {
    xPre[i] = xNorm[i] - 0.95 * xNorm[i - 1];
  }

  const fbMfcc =
    FB_MFCC_CACHE.get(warp) ?? buildMelFilterbank(MFCC_BANDS, 80, 7600, warp, false);
  const fbPeak =
    FB_PEAK_CACHE.get(warp) ?? buildMelFilterbank(PEAK_MEL_BANDS, 100, 7600, warp, true);

  const realRaw = new Float32Array(FFT_SIZE);
  const imagRaw = new Float32Array(FFT_SIZE);
  const realPre = new Float32Array(FFT_SIZE);
  const imagPre = new Float32Array(FFT_SIZE);
  const nBins = FFT_SIZE / 2 + 1;
  const binHz = TARGET_SAMPLE_RATE / FFT_SIZE;
  const lowBinLo = Math.ceil(80 / binHz);
  const lowBinHi = Math.floor(500 / binHz);
  const highBinLo = Math.ceil(2200 / binHz);
  const highBinHi = Math.min(nBins - 1, Math.floor(7600 / binHz));

  const magBuf = new Float32Array(nBins);
  const rawPowBuf = new Float32Array(nBins);
  const prePowBuf = new Float32Array(nBins);
  const melLogBuf = new Float32Array(MFCC_BANDS);

  const mfccs: Float32Array[] = [];
  const pmels: Float32Array[] = [];
  const energies: number[] = [];
  const lowRatios: number[] = [];
  const highRatios: number[] = [];
  const zcrs: number[] = [];

  for (let start = 0; start + FFT_SIZE <= xNorm.length; start += HOP_SIZE) {
    let segSumSq = 0;
    let zeroCrossings = 0;
    let prevSample = 0;

    for (let i = 0; i < FFT_SIZE; i += 1) {
      const sRaw = xNorm[start + i] * HANN_WINDOW[i];
      const sPre = xPre[start + i] * HANN_WINDOW[i];
      realRaw[i] = sRaw;
      imagRaw[i] = 0;
      realPre[i] = sPre;
      imagPre[i] = 0;
      segSumSq += sRaw * sRaw;
      if (i > 0 && prevSample * sRaw < 0) {
        zeroCrossings += 1;
      }
      prevSample = sRaw;
    }

    energies.push(Math.sqrt(segSumSq / FFT_SIZE));
    zcrs.push(zeroCrossings / (FFT_SIZE - 1));

    fftInPlace(realRaw, imagRaw);
    fftInPlace(realPre, imagPre);

    let totalPow = 1e-10;
    let lowPow = 0;
    let highPow = 0;

    for (let k = 0; k < nBins; k += 1) {
      const mag = Math.hypot(realRaw[k], imagRaw[k]);
      const rawPow = mag * mag + 1e-10;
      const prePow = realPre[k] * realPre[k] + imagPre[k] * imagPre[k] + 1e-10;
      magBuf[k] = mag;
      rawPowBuf[k] = rawPow;
      prePowBuf[k] = prePow;
      totalPow += rawPow;
      if (k >= lowBinLo && k <= lowBinHi) {
        lowPow += rawPow;
      }
      if (k >= highBinLo && k <= highBinHi) {
        highPow += rawPow;
      }
    }

    lowRatios.push(lowPow / totalPow);
    highRatios.push(highPow / totalPow);

    // 1. Pre-emphasized MFCC c1..c12
    for (let m = 0; m < MFCC_BANDS; m += 1) {
      const w = fbMfcc[m];
      let bandPow = 0;
      for (let k = 0; k < nBins; k += 1) {
        if (w[k] > 0) {
          bandPow += w[k] * prePowBuf[k];
        }
      }
      melLogBuf[m] = Math.log(Math.max(bandPow, 1e-10));
    }

    const mfccVec = new Float32Array(MFCC_DIM);
    for (let d = 0; d < MFCC_DIM; d += 1) {
      const basis = DCT_BASIS[d];
      let sum = 0;
      for (let m = 0; m < MFCC_BANDS; m += 1) {
        sum += melLogBuf[m] * basis[m];
      }
      mfccVec[d] = sum * LIFTER_MOD[d];
    }
    l2NormalizeInPlace(mfccVec);
    mfccs.push(mfccVec);

    // 2. Peak-normalized log1p area-norm Mel formant envelope
    const peakVec = new Float32Array(PEAK_MEL_BANDS);
    let maxBandMag = 0;
    for (let m = 0; m < PEAK_MEL_BANDS; m += 1) {
      const w = fbPeak[m];
      let bandMag = 0;
      for (let k = 0; k < nBins; k += 1) {
        if (w[k] > 0) {
          bandMag += w[k] * magBuf[k];
        }
      }
      peakVec[m] = bandMag;
      if (bandMag > maxBandMag) {
        maxBandMag = bandMag;
      }
    }
    const denom = maxBandMag + 1e-8;
    let peakMean = 0;
    for (let m = 0; m < PEAK_MEL_BANDS; m += 1) {
      const val = Math.log1p(10 * (peakVec[m] / denom));
      peakVec[m] = val;
      peakMean += val;
    }
    peakMean /= PEAK_MEL_BANDS;
    for (let m = 0; m < PEAK_MEL_BANDS; m += 1) {
      peakVec[m] -= peakMean;
    }
    l2NormalizeInPlace(peakVec);
    pmels.push(peakVec);
  }

  const frameCount = mfccs.length;
  // 拼接一阶 Delta 特征
  const mdSeq: Float32Array[] = [];
  for (let i = 0; i < frameCount; i += 1) {
    const vec = new Float32Array(MFCC_DIM * 2);
    const stat = mfccs[i];
    for (let d = 0; d < MFCC_DIM; d += 1) {
      vec[d] = stat[d];
    }
    if (frameCount >= 3) {
      const prev = mfccs[Math.max(0, i - 1)];
      const next = mfccs[Math.min(frameCount - 1, i + 1)];
      const scale = i === 0 || i === frameCount - 1 ? 1.0 : 0.5;
      for (let d = 0; d < MFCC_DIM; d += 1) {
        vec[MFCC_DIM + d] = (next[d] - prev[d]) * scale * 0.5;
      }
    }
    l2NormalizeInPlace(vec);
    mdSeq.push(vec);
  }

  // 核心帧（能量中位数以上）用于计算清浊/高频比例，避开首尾过渡帧污染
  const energyThreshold = medianOf(energies);
  const coreLow: number[] = [];
  const coreHigh: number[] = [];
  const coreZcr: number[] = [];
  for (let i = 0; i < frameCount; i += 1) {
    if (energies[i] >= energyThreshold) {
      coreLow.push(lowRatios[i]);
      coreHigh.push(highRatios[i]);
      coreZcr.push(zcrs[i]);
    }
  }

  // 首尾 1/3 MFCC 均值差构成双元音滑动方向向量
  const k3 = Math.max(1, Math.floor(frameCount / 3));
  const startMean = new Float32Array(MFCC_DIM);
  const endMean = new Float32Array(MFCC_DIM);
  for (let i = 0; i < k3; i += 1) {
    for (let d = 0; d < MFCC_DIM; d += 1) {
      startMean[d] += mfccs[i][d] / k3;
      endMean[d] += mfccs[frameCount - 1 - i][d] / k3;
    }
  }
  const glideVec = new Float32Array(MFCC_DIM);
  for (let d = 0; d < MFCC_DIM; d += 1) {
    glideVec[d] = endMean[d] - startMean[d];
  }
  const glideMag = l2NormalizeInPlace(glideVec);

  return {
    md8: resampleSequence(mdSeq, TEMPLATE_FRAMES),
    p8: resampleSequence(pmels, TEMPLATE_FRAMES),
    glideVec,
    glideMag,
    lowRatio: medianOf(coreLow.length > 0 ? coreLow : lowRatios),
    highRatio: medianOf(coreHigh.length > 0 ? coreHigh : highRatios),
    zcr: medianOf(coreZcr.length > 0 ? coreZcr : zcrs),
    durationSec: nLen / TARGET_SAMPLE_RATE,
  };
}

/**
 * 将声学特征签名量化为紧凑整数模板（-100..100），用于写入 phoneme-templates.json
 */
export function quantizeSignature(
  sig: AcousticSignature,
  category: string,
  symbol: string,
): QuantizedPhonemeTemplate {
  const qVec = (v: Float32Array) =>
    Array.from(v, (x) => Math.max(-100, Math.min(100, Math.round(x * 100))));

  return {
    symbol,
    category,
    md: sig.md8.map(qVec),
    p: sig.p8.map(qVec),
    gv: qVec(sig.glideVec),
    gm: Number(sig.glideMag.toFixed(3)),
    lr: Number(sig.lowRatio.toFixed(3)),
    hr: Number(sig.highRatio.toFixed(3)),
    zcr: Number(sig.zcr.toFixed(3)),
    dur: Number(sig.durationSec.toFixed(3)),
  };
}

/**
 * 反量化紧凑整数模板为可计算特征签名
 */
export function dequantizeTemplate(tpl: QuantizedPhonemeTemplate): AcousticSignature {
  const dqVec = (arr: number[]): Float32Array => {
    const f = Float32Array.from(arr, (x) => x / 100);
    l2NormalizeInPlace(f);
    return f;
  };
  return {
    md8: tpl.md.map(dqVec),
    p8: tpl.p.map(dqVec),
    glideVec: dqVec(tpl.gv),
    glideMag: tpl.gm,
    lowRatio: tpl.lr,
    highRatio: tpl.hr,
    zcr: tpl.zcr,
    durationSec: tpl.dur,
  };
}

function dotProduct(a: Float32Array, b: Float32Array): number {
  let s = 0;
  for (let i = 0; i < a.length; i += 1) {
    s += a[i] * b[i];
  }
  return s;
}

/**
 * 8x8 带宽受限（|i - j| <= 3）动态时间规整余弦相似度
 */
function bandedDtwSimilarity(a: Float32Array[], b: Float32Array[]): number {
  const n = a.length;
  const m = b.length;
  if (n === 0 || m === 0) {
    return 0;
  }

  const stride = m + 1;
  const dp = new Float32Array((n + 1) * stride);
  const steps = new Int32Array((n + 1) * stride);
  dp.fill(Number.POSITIVE_INFINITY);
  dp[0] = 0;

  for (let i = 1; i <= n; i += 1) {
    const jLo = Math.max(1, i - 3);
    const jHi = Math.min(m, i + 3);
    const vecA = a[i - 1];
    for (let j = jLo; j <= jHi; j += 1) {
      const sim = Math.max(-1, Math.min(1, dotProduct(vecA, b[j - 1])));
      const cost = Math.max(0, 1 - sim);

      const diag = dp[(i - 1) * stride + (j - 1)];
      const up = dp[(i - 1) * stride + j];
      const left = dp[i * stride + (j - 1)];

      let best = diag;
      let bestSteps = steps[(i - 1) * stride + (j - 1)];
      if (up < best) {
        best = up;
        bestSteps = steps[(i - 1) * stride + j];
      }
      if (left < best) {
        best = left;
        bestSteps = steps[i * stride + (j - 1)];
      }

      dp[i * stride + j] = cost + best;
      steps[i * stride + j] = bestSteps + 1;
    }
  }

  const totalSteps = Math.max(1, steps[n * stride + m]);
  return Math.max(0, Math.min(1, 1 - dp[n * stride + m] / totalSteps));
}

function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}

/**
 * 音位学发声方式一致性先验（独立于编码压缩失真的清浊/声带判别）
 */
export function phoneticPriorScore(phonemeId: string, uf: AcousticSignature): number {
  if (VOICELESS_IDS.has(phonemeId)) {
    return clamp(1 - Math.max(0, uf.lowRatio - 0.18) / 0.42, 0.1, 1.0);
  }
  if (VOICED_OBSTRUENT_IDS.has(phonemeId)) {
    return clamp(0.15 + 0.85 * Math.min(1, uf.lowRatio / 0.22), 0.15, 1.0);
  }
  const vOk = clamp(1 - Math.max(0, uf.zcr - 0.25) * 2.2, 0.15, 1.0);
  const hOk = clamp(1 - Math.max(0, uf.highRatio - 0.55) * 1.8, 0.2, 1.0);
  return 0.6 * vOk + 0.4 * hOk;
}

/**
 * 计算学习者特征与单个音素模板的多维加权相似度
 */
export function scoreAgainstTemplate(
  phonemeId: string,
  category: string,
  template: AcousticSignature,
  userByWarp: Record<number, AcousticSignature>,
): TemplateMatchBreakdown {
  const useVtln =
    category === 'monophthong' || category === 'diphthong' || category === 'sonorant';
  const warps = useVtln ? VTLN_WARPS : [1.0];

  let bestSpec = -1;
  let bestUserSig = userByWarp[1.0];

  for (const w of warps) {
    const uf = userByWarp[w] ?? userByWarp[1.0];
    const sMd = bandedDtwSimilarity(template.md8, uf.md8);
    const sP = bandedDtwSimilarity(template.p8, uf.p8);
    const sp = 0.6 * sMd + 0.4 * sP - Math.abs(w - 1.0) * 0.08;
    if (sp > bestSpec) {
      bestSpec = sp;
      bestUserSig = uf;
    }
  }

  const phonOk = phoneticPriorScore(phonemeId, bestUserSig);
  const rDur = bestUserSig.durationSec / Math.max(0.05, template.durationSec);
  let durScore = Math.max(0, 1 - Math.abs(Math.log(Math.max(0.05, rDur))) * 0.42);
  if (LONG_VOWEL_IDS.has(phonemeId) && bestUserSig.durationSec < 0.28) {
    durScore *= 0.65;
  } else if (SHORT_VOWEL_IDS.has(phonemeId) && bestUserSig.durationSec > 0.75) {
    durScore *= 0.75;
  }

  const glideScore = 0.5 + 0.5 * clamp(dotProduct(template.glideVec, bestUserSig.glideVec), -1, 1);
  const hrScore = Math.max(0, 1 - Math.abs(template.highRatio - bestUserSig.highRatio) * 1.4);
  const zcrScore = Math.max(0, 1 - Math.abs(template.zcr - bestUserSig.zcr) * 2.2);

  let rawScore: number;
  if (category === 'monophthong') {
    rawScore = 0.66 * bestSpec + 0.2 * durScore + 0.14 * phonOk;
  } else if (category === 'diphthong') {
    rawScore = 0.64 * bestSpec + 0.14 * glideScore + 0.1 * durScore + 0.12 * phonOk;
  } else if (category === 'fricative' || category === 'affricate') {
    rawScore = 0.45 * bestSpec + 0.3 * phonOk + 0.15 * hrScore + 0.1 * zcrScore;
  } else if (category === 'plosive') {
    rawScore = 0.44 * bestSpec + 0.36 * phonOk + 0.1 * zcrScore + 0.1 * durScore;
  } else {
    rawScore = 0.7 * bestSpec + 0.16 * phonOk + 0.14 * hrScore;
  }

  return {
    rawScore,
    specScore: clamp(bestSpec, 0, 1),
    durScore: clamp(durScore, 0, 1),
    glideScore: clamp(glideScore, 0, 1),
    phonOk,
    bestUserSig,
  };
}
