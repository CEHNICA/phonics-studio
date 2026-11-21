import { useCallback, useEffect, useRef, useState } from 'react';
import { deleteRecording, loadRecording, saveRecording } from '../utils/recording-store';
import { resumeSharedAudioContext } from '../utils/audio-context';

export interface VoiceTrimInfo {
  leadingTrimmedSec: number;
  trailingTrimmedSec: number;
  hasSpeech: boolean;
}

export interface VoiceRecorderState {
  isRecording: boolean;
  isPlayingRecording: boolean;
  isComparingSequence: boolean;
  comparePhase: 'idle' | 'reference' | 'user';
  recordedUrl: string | null;
  recordedBlob: Blob | null;
  trimInfo: VoiceTrimInfo | null;
  errorMessage: string | null;
  startRecording: () => Promise<void>;
  stopRecording: () => void;
  playRecording: () => void;
  playComparisonSequence: (referenceUrl: string) => void;
  clearRecording: () => void;
  deleteSavedRecording: () => void;
}

/**
 * 本地跟读录音自检 Hook：录音、分析匹配度、与原声轮流对比，
 * 并按 storageKey（音标 id）把录音持久化到 IndexedDB，切换音标/页面/刷新后自动恢复。
 * @param storageKey 当前音标 id，作为录音的存储键
 */
export function useVoiceRecorder(storageKey: string): VoiceRecorderState {
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const playbackRef = useRef<HTMLAudioElement | null>(null);
  const compareTimerRef = useRef<number | null>(null);
  const sessionCounterRef = useRef<number>(0);
  const discardRecordingRef = useRef<boolean>(false);
  const storageKeyRef = useRef<string>(storageKey);

  const [isRecording, setIsRecording] = useState(false);
  const [isPlayingRecording, setIsPlayingRecording] = useState(false);
  const [isComparingSequence, setIsComparingSequence] = useState(false);
  const [comparePhase, setComparePhase] = useState<'idle' | 'reference' | 'user'>('idle');
  const [recordedUrl, setRecordedUrl] = useState<string | null>(null);
  const [recordedBlob, setRecordedBlob] = useState<Blob | null>(null);
  const [trimInfo, setTrimInfo] = useState<VoiceTrimInfo | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const stopStream = useCallback(() => {
    if (streamRef.current) {
      for (const track of streamRef.current.getTracks()) {
        track.stop();
      }
      streamRef.current = null;
    }
  }, []);

  const stopPlayback = useCallback(() => {
    if (compareTimerRef.current !== null) {
      window.clearTimeout(compareTimerRef.current);
      compareTimerRef.current = null;
    }
    if (playbackRef.current) {
      playbackRef.current.pause();
      playbackRef.current = null;
    }
    setIsPlayingRecording(false);
    setIsComparingSequence(false);
    setComparePhase('idle');
  }, []);

  /**
   * 仅清空内存中的录音状态（不删除已持久化的录音）
   */
  const clearRecording = useCallback(() => {
    sessionCounterRef.current += 1;
    stopPlayback();
    setRecordedUrl((prev) => {
      if (prev) {
        URL.revokeObjectURL(prev);
      }
      return null;
    });
    setRecordedBlob(null);
    setTrimInfo(null);
    setErrorMessage(null);
  }, [stopPlayback]);

  /**
   * 删除当前音标已保存的录音（内存与 IndexedDB 一并清除）
   */
  const deleteSavedRecording = useCallback(() => {
    clearRecording();
    void deleteRecording(storageKeyRef.current);
  }, [clearRecording]);

  // 切换音标：中止未完成的录音，并从本地存储恢复该音标之前保存的跟读
  useEffect(() => {
    storageKeyRef.current = storageKey;
    discardRecordingRef.current = true;
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }
    stopStream();
    // NOTE: isRecording 由 recorder.onstop 统一复位，这里无需同步 setState；
    // 切换音标时需要同步重置内存录音状态，属于与外部存储（IndexedDB）同步的合理 effect
    // eslint-disable-next-line react-hooks/set-state-in-effect
    clearRecording();

    const session = sessionCounterRef.current;
    void loadRecording(storageKey).then((stored) => {
      if (!stored || sessionCounterRef.current !== session) {
        return;
      }
      setRecordedBlob(stored.blob);
      setTrimInfo(stored.trimInfo);
      setRecordedUrl((prev) => {
        if (prev) {
          URL.revokeObjectURL(prev);
        }
        return URL.createObjectURL(stored.blob);
      });
    });
  }, [clearRecording, stopStream, storageKey]);

  const startRecording = useCallback(async () => {
    if (typeof window !== 'undefined' && !window.isSecureContext) {
      // 局域网 HTTP 下浏览器直接禁用麦克风，这不是录音代码的锅。
      // 提示必须说清「怎么才能录」，否则用户在手机上试半天以为功能坏了。
      const isLocalhost = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(window.location.hostname);
      setErrorMessage(
        isLocalhost
          ? '浏览器只在 HTTPS（或 localhost）下允许使用麦克风。请改用线上 https 地址打开，或在电脑上部署一个 https 版本。'
          : '当前是 http 局域网地址，浏览器会禁用麦克风（只有 https 或 localhost 才行）。请改用线上 https 地址打开：https://5p3wt4cgcivtd.space.mcode.cn 。听音、卡片、口型视频与闯关在当前地址都能正常使用。',
      );
      return;
    }

    if (
      typeof navigator === 'undefined' ||
      !navigator.mediaDevices ||
      !navigator.mediaDevices.getUserMedia
    ) {
      setErrorMessage('当前浏览器不支持麦克风录音，请使用新版 Edge / Chrome / Safari。');
      return;
    }

    try {
      clearRecording();

      // 必须在用户手势的同步栈里激活 AudioContext（iOS Safari 否则一直 suspended，
      // decodeAudioData 会偶发返回空 buffer，表现为「录完没声音」）。
      // 同时预取分析模块，录完立刻就能算分，不用干等 78KB chunk 下载。
      void resumeSharedAudioContext();
      void import('../utils/pronunciation-analyzer').catch(() => undefined);

      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            noiseSuppression: true,
            echoCancellation: true,
            autoGainControl: true,
          },
        });
      } catch (err) {
        if (
          err instanceof Error &&
          (err.name === 'OverconstrainedError' || err.name === 'TypeError')
        ) {
          stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        } else {
          throw err;
        }
      }
      streamRef.current = stream;

      // NOTE: 录音期间用户可能切换音标，所以在开始时就锁定本次录音归属的音标
      const recordingKey = storageKeyRef.current;
      discardRecordingRef.current = false;

      const recorder = new MediaRecorder(stream);
      chunksRef.current = [];
      mediaRecorderRef.current = recorder;

      recorder.ondataavailable = (event: BlobEvent) => {
        if (event.data.size > 0) {
          chunksRef.current.push(event.data);
        }
      };
      recorder.onstop = () => {
        setIsRecording(false);
        stopStream();
        if (discardRecordingRef.current) {
          return;
        }

        const currentSession = ++sessionCounterRef.current;
        const rawBlob = new Blob(chunksRef.current, { type: recorder.mimeType || 'audio/webm' });

        // 分析模块（含 63KB 模板表与 DSP 算法）动态加载：首屏完全不需要它
        void import('../utils/pronunciation-analyzer')
          .then(({ trimRecordedAudioBlob }) => trimRecordedAudioBlob(rawBlob))
          .then((result) => {
            if (sessionCounterRef.current !== currentSession) {
              return;
            }
            const nextTrimInfo: VoiceTrimInfo = {
              leadingTrimmedSec: result.leadingTrimmedSec,
              trailingTrimmedSec: result.trailingTrimmedSec,
              hasSpeech: result.hasSpeech,
            };
            const url = URL.createObjectURL(result.blob);
            setRecordedBlob(result.blob);
            setTrimInfo(nextTrimInfo);
            setRecordedUrl((prev) => {
              if (prev) {
                URL.revokeObjectURL(prev);
              }
              return url;
            });
            // 录完立即持久化，之后切换音标 / 切换页面 / 刷新都能找回
            void saveRecording(recordingKey, result.blob, nextTrimInfo);
          })
          .catch(() => {
            // 裁剪失败也要让录音可用，退回原始音频
            if (sessionCounterRef.current !== currentSession) {
              return;
            }
            const url = URL.createObjectURL(rawBlob);
            setRecordedBlob(rawBlob);
            setTrimInfo({ leadingTrimmedSec: 0, trailingTrimmedSec: 0, hasSpeech: true });
            setRecordedUrl((prev) => {
              if (prev) {
                URL.revokeObjectURL(prev);
              }
              return url;
            });
            void saveRecording(recordingKey, rawBlob, {
              leadingTrimmedSec: 0,
              trailingTrimmedSec: 0,
              hasSpeech: true,
            });
          });

      };

      recorder.start(250);
      setIsRecording(true);
      setErrorMessage(null);
    } catch {
      stopStream();
      setIsRecording(false);
      setErrorMessage('没有获取到麦克风权限，请在浏览器地址栏允许访问麦克风。');
    }
  }, [clearRecording, stopStream]);

  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }
  }, []);

  const playRecording = useCallback(() => {
    if (!recordedUrl) {
      return;
    }
    stopPlayback();
    const audio = new Audio(recordedUrl);
    playbackRef.current = audio;
    setIsPlayingRecording(true);
    audio.onended = () => setIsPlayingRecording(false);
    audio.onerror = () => setIsPlayingRecording(false);
    void audio.play().catch(() => setIsPlayingRecording(false));
  }, [recordedUrl, stopPlayback]);

  /**
   * 轮流对比播放：先播放标准原声，间隔 250ms 后自动播放个人录音
   */
  const playComparisonSequence = useCallback(
    (referenceUrl: string) => {
      if (!recordedUrl) {
        return;
      }
      stopPlayback();
      setIsComparingSequence(true);
      setComparePhase('reference');

      const refAudio = new Audio(referenceUrl);
      playbackRef.current = refAudio;

      refAudio.onended = () => {
        compareTimerRef.current = window.setTimeout(() => {
          setComparePhase('user');
          const userAudio = new Audio(recordedUrl);
          playbackRef.current = userAudio;
          userAudio.onended = () => {
            setIsComparingSequence(false);
            setComparePhase('idle');
          };
          userAudio.onerror = () => {
            setIsComparingSequence(false);
            setComparePhase('idle');
          };
          void userAudio.play().catch(() => {
            setIsComparingSequence(false);
            setComparePhase('idle');
          });
        }, 260);
      };

      refAudio.onerror = () => {
        setIsComparingSequence(false);
        setComparePhase('idle');
      };

      void refAudio.play().catch(() => {
        setIsComparingSequence(false);
        setComparePhase('idle');
      });
    },
    [recordedUrl, stopPlayback],
  );

  useEffect(() => {
    return () => {
      sessionCounterRef.current += 1;
      discardRecordingRef.current = true;
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
        mediaRecorderRef.current.stop();
      }
      stopStream();
      stopPlayback();
    };
  }, [stopPlayback, stopStream]);

  return {
    isRecording,
    isPlayingRecording,
    isComparingSequence,
    comparePhase,
    recordedUrl,
    recordedBlob,
    trimInfo,
    errorMessage,
    startRecording,
    stopRecording,
    playRecording,
    playComparisonSequence,
    clearRecording,
    deleteSavedRecording,
  };
}
