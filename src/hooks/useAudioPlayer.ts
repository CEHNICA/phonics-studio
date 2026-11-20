import { useCallback, useEffect, useRef, useState } from 'react';

const MAX_PRELOAD_CACHE = 40;

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
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [speakingWord, setSpeakingWord] = useState<string | null>(null);

  const stopAudio = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
      audioRef.current = null;
    }
    setPlayingId(null);
    setSpeakingWord(null);
  }, []);

  /**
   * 预加载一批音频 URL，消除首次点击播放延迟
   */
  const preloadUrls = useCallback((urls: string[]) => {
    const cache = preloadCacheRef.current;
    for (const url of urls) {
      if (cache.has(url)) {
        continue;
      }
      if (cache.size >= MAX_PRELOAD_CACHE) {
        const firstKey = cache.keys().next().value;
        if (firstKey) {
          cache.delete(firstKey);
        }
      }
      const audio = new Audio(url);
      audio.preload = 'auto';
      audio.load();
      cache.set(url, audio);
    }
  }, []);

  /**
   * 预加载当前卡片涉及的所有英语单词本地 MP3
   */
  const preloadWords = useCallback(
    (words: string[]) => {
      const urls = words
        .map((word) => word.trim().toLowerCase())
        .filter(Boolean)
        .map((normalized) => `/assets/words/${encodeURIComponent(normalized)}.mp3`);
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

      audio.onended = () => {
        setPlayingId((prev) => (prev === id ? null : prev));
      };
      audio.onerror = () => {
        setPlayingId((prev) => (prev === id ? null : prev));
      };

      void audio.play().catch(() => {
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

      const localSrc = `/assets/words/${encodeURIComponent(normalized)}.mp3`;
      const cached = preloadCacheRef.current.get(localSrc);
      const audio = cached ?? new Audio(localSrc);
      audio.currentTime = 0;
      audioRef.current = audio;
      setSpeakingWord(word);

      audio.onended = () => {
        setSpeakingWord((prev) => (prev === word ? null : prev));
      };
      audio.onerror = () => {
        // NOTE: 若本地单词音频缺失，则平滑降级到浏览器 TTS
        fallbackSpeakWithSynthesis(
          word,
          () => setSpeakingWord(word),
          () => setSpeakingWord((prev) => (prev === word ? null : prev)),
        );
      };

      void audio.play().catch(() => {
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
    playPhonemeAudio,
    speakWord,
    preloadWords,
    preloadUrls,
    stopAudio,
  };
}
