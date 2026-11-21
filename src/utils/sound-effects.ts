/**
 * 使用浏览器 Web Audio API 合成轻量级答题提示音效，无需额外音频文件。
 * 与录音分析共用 `audio-context.ts` 的 AudioContext，避免一套 suspended、另一套在响。
 */

import { getSharedAudioContext } from './audio-context';

type ActiveVoice = { osc: OscillatorNode; gain: GainNode };

let activeVoices: ActiveVoice[] = [];

/**
 * 柔和掐掉尚未播完的提示音（不碰 HTMLAudio 真人发音）
 */
export function stopSfx(): void {
  if (activeVoices.length === 0) {
    return;
  }
  let now = 0;
  try {
    now = getSharedAudioContext().currentTime;
  } catch {
    activeVoices = [];
    return;
  }
  for (const voice of activeVoices) {
    try {
      voice.gain.gain.cancelScheduledValues(now);
      voice.gain.gain.setValueAtTime(Math.max(voice.gain.gain.value, 0.0001), now);
      voice.gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.03);
      voice.osc.stop(now + 0.04);
    } catch {
      // 已结束的节点忽略
    }
  }
  activeVoices = [];
}

/**
 * 播放轻快的单音或和弦序列
 */
function playToneSequence(
  notes: Array<{ freq: number; delay: number; duration: number; type?: OscillatorType }>,
  peakGain = 0.11,
) {
  try {
    const ctx = getSharedAudioContext();
    // 必须在用户手势调用栈里触发 resume；这里同步发起即可
    if (ctx.state === 'suspended') {
      void ctx.resume();
    }

    stopSfx();

    const now = ctx.currentTime;
    const spawned: ActiveVoice[] = [];

    for (const note of notes) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = note.type ?? 'sine';
      osc.frequency.setValueAtTime(note.freq, now + note.delay);

      const startAt = now + note.delay;
      const peakAt = startAt + 0.015;
      const endAt = startAt + Math.max(note.duration, 0.04);

      gain.gain.setValueAtTime(0.0001, startAt);
      gain.gain.exponentialRampToValueAtTime(peakGain, peakAt);
      gain.gain.exponentialRampToValueAtTime(0.0001, endAt);

      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(startAt);
      osc.stop(endAt + 0.02);
      spawned.push({ osc, gain });
    }

    activeVoices = spawned;
  } catch {
    // 忽略浏览器音频上下文限制错误
  }
}

/**
 * 答对时的清脆叮咚和弦
 */
export function playCorrectSfx(): void {
  playToneSequence([
    { freq: 523.25, delay: 0, duration: 0.12 }, // C5
    { freq: 659.25, delay: 0.08, duration: 0.18 }, // E5
  ]);
}

/**
 * 答错时的轻柔提示音
 */
export function playWrongSfx(): void {
  playToneSequence([
    { freq: 311.13, delay: 0, duration: 0.14, type: 'triangle' },
    { freq: 261.63, delay: 0.1, duration: 0.2, type: 'triangle' },
  ]);
}

/**
 * 通关结算时的欢快三连音
 */
export function playRoundFinishSfx(): void {
  playToneSequence([
    { freq: 523.25, delay: 0, duration: 0.12 },
    { freq: 659.25, delay: 0.09, duration: 0.12 },
    { freq: 783.99, delay: 0.18, duration: 0.26 },
  ]);
}

/**
 * 选中代表词时的轻快提示音（短促清脆，不遮盖紧接着的单词发音）
 */
export function playSelectWordSfx(): void {
  playToneSequence(
    [
      { freq: 659.25, delay: 0, duration: 0.06 }, // E5
      { freq: 880.0, delay: 0.04, duration: 0.09 }, // A5
    ],
    0.075,
  );
}

/**
 * 点击卡片 / 热区时的极短敲击感（不抢发音）
 */
export function playTapSfx(): void {
  playToneSequence([{ freq: 740.0, delay: 0, duration: 0.04, type: 'triangle' }], 0.045);
}

/**
 * 跟读高分庆祝（明显高于答题叮咚，但别太吵）
 */
export function playScoreCelebrateSfx(): void {
  playToneSequence(
    [
      { freq: 523.25, delay: 0, duration: 0.1 },
      { freq: 659.25, delay: 0.08, duration: 0.1 },
      { freq: 783.99, delay: 0.16, duration: 0.12 },
      { freq: 1046.5, delay: 0.26, duration: 0.22 },
    ],
    0.1,
  );
}

/**
 * 连击升温提示（3 / 5 / 8 连时触发）
 */
export function playComboSfx(combo: number): void {
  const peak = combo >= 8 ? 0.13 : combo >= 5 ? 0.11 : 0.09;
  playToneSequence(
    [
      { freq: 587.33, delay: 0, duration: 0.07 },
      { freq: 740.0, delay: 0.05, duration: 0.08 },
      { freq: 987.77, delay: 0.11, duration: 0.16 },
    ],
    peak,
  );
}
