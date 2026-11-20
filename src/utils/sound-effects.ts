/**
 * 使用浏览器 Web Audio API 合成轻量级答题提示音效，无需额外音频文件
 */

let sharedAudioContext: AudioContext | null = null;

function getAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') {
    return null;
  }
  const AudioCtx =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioCtx) {
    return null;
  }
  if (!sharedAudioContext) {
    sharedAudioContext = new AudioCtx();
  }
  if (sharedAudioContext.state === 'suspended') {
    void sharedAudioContext.resume();
  }
  return sharedAudioContext;
}

/**
 * 播放轻快的单音或和弦序列
 */
function playToneSequence(
  notes: Array<{ freq: number; delay: number; duration: number; type?: OscillatorType }>,
  peakGain = 0.11,
) {
  try {
    const ctx = getAudioContext();
    if (!ctx) {
      return;
    }
    const now = ctx.currentTime;

    for (const note of notes) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = note.type ?? 'sine';
      osc.frequency.setValueAtTime(note.freq, now + note.delay);

      gain.gain.setValueAtTime(0.001, now + note.delay);
      gain.gain.exponentialRampToValueAtTime(peakGain, now + note.delay + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.001, now + note.delay + note.duration);

      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now + note.delay);
      osc.stop(now + note.delay + note.duration + 0.02);
    }
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
