import { useCallback, useEffect, useRef, useState } from 'react';

/** 预加载缓存上限：只保留最近用到的少量音频，避免长期占用内存 */
const MAX_PRELOAD_CACHE = 16;
/**
 * 同时最多并行下载的音频数。
 * 国内弱网下并发预载会互相抢带宽，反而把「马上要听的那个」拖慢，
 * 所以压到 2 个，队列先进先出，音标音频天然排在最前面。
 */
const MAX_PARALLEL_PRELOAD = 2;

/**
 * 使用浏览器 Web Speech API 作为本地 MP3 不可用时的降级兜底朗读
 */
function fallbackSpeakWithSynthesis(
  word: string,
  onStart: () => void,
  onEnd: () => void,
) {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
    onEnd();
    return;
  }

  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(word);
  const voices = window.speechSynthesis.getVoices();
  const britishVoice = voices.find((voice) => voice.lang.startsWith('en-GB'));
  const fallbackVoice = voices.find((voice) => voice.lang.startsWith('en'));

  if (britishVoice) {
    utterance.voice = britishVoice;
  } else if (fallbackVoice) {
    utterance.voice = fallbackVoice;
  }
  utterance.lang = britishVoice ? 'en-GB' : 'en-US';
  utterance.rate = 0.88;

  onStart();
  utterance.onend = onEnd;
  utterance.onerror = onEnd;
  window.speechSynthesis.speak(utterance);
}

/**
 * 统一管理音标与单词本地 MP3 播放、预加载及降级朗读的自定义 Hook
 */
export function useAudioPlayer() {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const preloadCacheRef = useRef<Map<string, HTMLAudioElement>>(new Map());
  /** 等待下载的音频队列 */
  const queueRef = useRef<string[]>([]);
  /** 正在并行下载的音频数 */
  const activeRef = useRef(0);
  const pumpRef = useRef<() => void>(() => {});
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [speakingWord, setSpeakingWord] = useState<string | null>(null);
  /** 正在等待下载、尚未出声的音频标识（如 `phoneme:long-i` / `word:tea`） */
  const [pendingKey, setPendingKey] = useState<string | null>(null);

  const stopAudio = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
      audioRef.current = null;
    }
    setPlayingId(null);
    setSpeakingWord(null);
    setPendingKey(null);
  }, []);

  /**
   * 从队列里取音频开始下载，最多同时 MAX_PARALLEL_PRELOAD 个
   */
  const pumpPreloadQueue = useCallback(() => {
    while (activeRef.current < MAX_PARALLEL_PRELOAD && queueRef.current.length > 0) {
      const url = queueRef.current.shift();
      if (!url) break;
      const cache = preloadCacheRef.current;
      if (cache.has(url)) continue;

      const audio = new Audio(url);
      audio.preload = 'auto';
      activeRef.current += 1;
      const release = () => {
        activeRef.current = Math.max(0, activeRef.current - 1);
        pumpRef.current();
      };
      audio.addEventListener('canplay', release, { once: true });
      audio.addEventListener('error', release, { once: true });
      cache.set(url, audio);
      audio.load();
    }
  }, []);

  // 在 effect 里挂接自引用，避免渲染期写 ref（StrictMode 双渲染下时序才可靠）
  useEffect(() => {
    pumpRef.current = pumpPreloadQueue;
  }, [pumpPreloadQueue]);

  /**
   * 预加载一批音频 URL，消除首次点击播放延迟
   */
  const preloadUrls = useCallback((urls: string[]) => {
    const cache = preloadCacheRef.current;
    const queue = queueRef.current;
    for (const url of urls) {
      if (cache.has(url) || queue.includes(url)) {
        continue;
      }
      queue.push(url);
    }
    // 淘汰超出上限的旧缓存（同时把它的排队项摘掉）
    while (cache.size >= MAX_PRELOAD_CACHE) {
      const oldest = cache.keys().next().value;
      if (!oldest) break;
      cache.delete(oldest);
      const idx = queue.indexOf(oldest);
      if (idx >= 0) queue.splice(idx, 1);
    }
    pumpPreloadQueue();
  }, [pumpPreloadQueue]);

  /**
   * 预加载当前卡片涉及的所有英语单词本地 MP3
   */
  const preloadWords = useCallback(
    (words: string[]) => {
      const urls = words
        .map((word) => word.trim().toLowerCase())
        .filter(Boolean)
        .map((normalized) => `/assets/words/${encodeURIComponent(normalized)}.v2.mp3`);
      preloadUrls(urls);
    },
    [preloadUrls],
  );

  const playPhonemeAudio = useCallback(
    (src: string, id: string) => {
      stopAudio();
      if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
        window.speechSynthesis.cancel();
      }
      const cached = preloadCacheRef.current.get(src);
      const audio = cached ?? new Audio(src);
      audio.currentTime = 0;
      audioRef.current = audio;
      setPlayingId(id);
      // 还没缓冲够就先亮「加载中」，别让用户以为点了没反应
      if (audio.readyState < 3) {
        setPendingKey(`phoneme:${id}`);
      }

      audio.onended = () => {
        setPendingKey(null);
        setPlayingId((prev) => (prev === id ? null : prev));
      };
      audio.onplaying = () => {
        setPendingKey(null);
      };
      audio.onerror = () => {
        setPendingKey(null);
        setPlayingId((prev) => (prev === id ? null : prev));
      };

      void audio.play().catch(() => {
        setPendingKey(null);
        setPlayingId(null);
      });
    },
    [stopAudio],
  );

  const speakWord = useCallback(
    (word: string) => {
      stopAudio();
      if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
        window.speechSynthesis.cancel();
      }

      const normalized = word.trim().toLowerCase();
      if (!normalized) {
        return;
      }

      const localSrc = `/assets/words/${encodeURIComponent(normalized)}.v2.mp3`;
      const cached = preloadCacheRef.current.get(localSrc);
      const audio = cached ?? new Audio(localSrc);
      audio.currentTime = 0;
      audioRef.current = audio;
      setSpeakingWord(word);
      if (audio.readyState < 3) {
        setPendingKey(`word:${normalized}`);
      }

      audio.onended = () => {
        setPendingKey(null);
        setSpeakingWord((prev) => (prev === word ? null : prev));
      };
      audio.onplaying = () => {
        setPendingKey(null);
      };
      audio.onerror = () => {
        // NOTE: 若本地单词音频缺失，则平滑降级到浏览器 TTS
        setPendingKey(null);
        fallbackSpeakWithSynthesis(
          word,
          () => setSpeakingWord(word),
          () => setSpeakingWord((prev) => (prev === word ? null : prev)),
        );
      };

      void audio.play().catch(() => {
        setPendingKey(null);
        fallbackSpeakWithSynthesis(
          word,
          () => setSpeakingWord(word),
          () => setSpeakingWord((prev) => (prev === word ? null : prev)),
        );
      });
    },
    [stopAudio],
  );

  useEffect(() => {
    return () => {
      stopAudio();
      if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
        window.speechSynthesis.cancel();
      }
    };
  }, [stopAudio]);

  return {
    playingId,
    speakingWord,
    pendingKey,
    playPhonemeAudio,
    speakWord,
    preloadWords,
    preloadUrls,
    stopAudio,
  };
}
