/**
 * 共享 AudioContext 管理
 *
 * 为什么单独抽一个模块：`pronunciation-analyzer` 有 78 KB（含 48 音素声学模板表），
 * 在用户点「开始录音」时为了激活 AudioContext 去 import 它，会白白多等一次下载。
 * 这里只留几十行的 context 管理，import 成本可以忽略。
 *
 * 为什么需要 resume：iOS Safari 要求 AudioContext 必须在**用户手势**里创建或恢复，
 * 否则会一直停在 suspended 状态。suspended 的 context 做 decodeAudioData 会偶发
 * 返回空/损坏的 buffer，表现就是「录完没声音 / 算不出分数」。
 */

let sharedAudioContext: AudioContext | null = null;

export function getSharedAudioContext(): AudioContext {
  if (typeof window === 'undefined') {
    throw new Error('AudioContext is only available in browser');
  }
  const AudioCtx =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioCtx) {
    throw new Error('Web Audio API is not supported');
  }
  if (!sharedAudioContext) {
    sharedAudioContext = new AudioCtx();
  }
  return sharedAudioContext;
}

/**
 * 在用户手势的同步栈里调用，确保 iOS 上 context 能被激活。
 * 失败不抛错：后续 decodeAudioData 仍会尝试，失败时上层会退回原始录音。
 */
export async function resumeSharedAudioContext(): Promise<void> {
  try {
    const ctx = getSharedAudioContext();
    if (ctx.state === 'suspended') {
      await ctx.resume();
    }
  } catch {
    // 忽略：不影响录音本身
  }
}
