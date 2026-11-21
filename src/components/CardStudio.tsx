import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  GitCompare,
  Mic,
  Pause,
  Play,
  Repeat,
  Square,
  Star,
  Volume2,
} from 'lucide-react';
import { PHONEME_MAP, PHONEMES, getRelatedConfusableIds } from '../data/phonics-catalog';
import { useAudioPlayer } from '../hooks/useAudioPlayer';
import { useVoiceRecorder } from '../hooks/useVoiceRecorder';
import type { PhonemeItem, PhonemeProgress } from '../types/phonics';
import {
  analyzePronunciation,
  type PronunciationComparisonResult,
} from '../utils/pronunciation-analyzer';
import { playSelectWordSfx } from '../utils/sound-effects';
import { PhonemeSidebar, type ProgressFilter } from './PhonemeSidebar';

interface CardStudioProps {
  currentPhonemeId: string;
  onSelectPhoneme: (phonemeId: string) => void;
  getPhonemeProgress: (phonemeId: string) => PhonemeProgress;
  onSetRepresentativeWord: (phonemeId: string, word: string) => void;
  onToggleCompleted: (phonemeId: string) => void;
  dayFilterIds: string[] | null;
  dayFilterLabel: string | null;
  onClearDayFilter: () => void;
  onJumpToPair: (phonemeId: string) => void;
  favoriteIds: string[];
  onToggleFavorite: (phonemeId: string) => void;
  isFavorite: (phonemeId: string) => boolean;
}

const CARD_OPTION_LETTERS = ['A', 'B', 'C'];

const CARD_HOTSPOT_LEFT_POSITIONS = ['3.47%', '35.07%', '66.67%'];

/**
 * 核心互动学习工作台：手绘卡片 + 音频 + 口型视频 + 跟读录音
 */
export function CardStudio({
  currentPhonemeId,
  onSelectPhoneme,
  getPhonemeProgress,
  onSetRepresentativeWord,
  onToggleCompleted,
  dayFilterIds,
  dayFilterLabel,
  onClearDayFilter,
  onJumpToPair,
  favoriteIds,
  onToggleFavorite,
  isFavorite,
}: CardStudioProps) {
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [progressFilter, setProgressFilter] = useState<ProgressFilter>('all');
  const [customWordInput, setCustomWordInput] = useState<string>('');
  const [videoLoop, setVideoLoop] = useState<boolean>(false);
  const [slowMode, setSlowMode] = useState<boolean>(false);
  const [isVideoPlaying, setIsVideoPlaying] = useState<boolean>(false);
  const [analysisResult, setAnalysisResult] = useState<PronunciationComparisonResult | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState<boolean>(false);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const speakTimerRef = useRef<number | null>(null);
  const { playingId, speakingWord, pendingKey, playPhonemeAudio, speakWord, preloadWords, preloadUrls } =
    useAudioPlayer();
  const recorder = useVoiceRecorder(currentPhonemeId);

  const filteredPhonemes = useMemo<PhonemeItem[]>(() => {
    if (dayFilterIds && dayFilterIds.length > 0) {
      return dayFilterIds
        .map((id) => PHONEME_MAP[id])
        .filter((item): item is PhonemeItem => Boolean(item));
    }

    return PHONEMES.filter((item) => {
      if (selectedCategory !== 'all' && item.category !== selectedCategory) {
        return false;
      }
      const record = getPhonemeProgress(item.id);
      if (progressFilter === 'unlearned') {
        return !record.completed;
      }
      if (progressFilter === 'review') {
        return record.mistakeCount > 0;
      }
      if (progressFilter === 'mastered') {
        return record.completed && record.mistakeCount === 0;
      }
      if (progressFilter === 'favorite') {
        return favoriteIds.includes(item.id);
      }
      return true;
    });
  }, [dayFilterIds, favoriteIds, getPhonemeProgress, progressFilter, selectedCategory]);

  const currentPhoneme = PHONEME_MAP[currentPhonemeId] ?? PHONEMES[0];
  const currentProgress = getPhonemeProgress(currentPhoneme.id);
  const relatedIds = useMemo(
    () => getRelatedConfusableIds(currentPhoneme.id),
    [currentPhoneme.id],
  );

  const activeList = filteredPhonemes.length > 0 ? filteredPhonemes : PHONEMES;
  const currentIndex = activeList.findIndex((item) => item.id === currentPhoneme.id);
  const prevPhoneme = currentIndex > 0 ? activeList[currentIndex - 1] : null;
  const nextPhoneme =
    currentIndex >= 0 && currentIndex < activeList.length - 1 ? activeList[currentIndex + 1] : null;

  // 切换音标时重置输入框草稿、分析结果并预加载本卡全部音频（跟读录音由 Hook 按音标自动保存/恢复）
  useEffect(() => {
    if (speakTimerRef.current !== null) {
      window.clearTimeout(speakTimerRef.current);
      speakTimerRef.current = null;
    }
    setAnalysisResult(null);
    setIsAnalyzing(false);
    setCustomWordInput('');
    setIsVideoPlaying(false);
    preloadUrls([currentPhoneme.localAudioSrc]);
    preloadWords(currentPhoneme.cardWords);
    return () => {
      if (speakTimerRef.current !== null) {
        window.clearTimeout(speakTimerRef.current);
        speakTimerRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentPhoneme.id]);

  // 录音结束后自动计算与标准音标原声的匹配度及波形对比
  useEffect(() => {
    const blob = recorder.recordedBlob;
    if (!blob) {
      setAnalysisResult(null);
      setIsAnalyzing(false);
      return;
    }

    let cancelled = false;
    setIsAnalyzing(true);
    void analyzePronunciation(currentPhoneme.id, currentPhoneme.localAudioSrc, blob, {
      userAlreadyTrimmed: true,
      userHasSpeech: recorder.trimInfo?.hasSpeech,
    })
      .then((result) => {
        if (!cancelled) {
          setAnalysisResult(result);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setAnalysisResult(null);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setIsAnalyzing(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [currentPhoneme.id, currentPhoneme.localAudioSrc, recorder.recordedBlob, recorder.trimInfo]);

  // 同步视频倍速
  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.playbackRate = slowMode ? 0.75 : 1.0;
    }
  }, [slowMode, currentPhoneme.id]);

  // 键盘快捷键：左右键切卡，空格听发音
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) {
        return;
      }
      if (event.code === 'Space') {
        event.preventDefault();
        playPhonemeAudio(currentPhoneme.localAudioSrc, currentPhoneme.id);
      } else if (event.code === 'ArrowLeft' && prevPhoneme) {
        event.preventDefault();
        onSelectPhoneme(prevPhoneme.id);
      } else if (event.code === 'ArrowRight' && nextPhoneme) {
        event.preventDefault();
        onSelectPhoneme(nextPhoneme.id);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    currentPhoneme.id,
    currentPhoneme.localAudioSrc,
    nextPhoneme,
    onSelectPhoneme,
    playPhonemeAudio,
    prevPhoneme,
  ]);

  const handleToggleVideo = () => {
    const video = videoRef.current;
    if (!video) {
      return;
    }
    if (video.paused) {
      video.playbackRate = slowMode ? 0.75 : 1.0;
      void video.play();
      setIsVideoPlaying(true);
    } else {
      video.pause();
      setIsVideoPlaying(false);
    }
  };

  const handleSelectRepresentativeChip = (word: string) => {
    playSelectWordSfx();
    onSetRepresentativeWord(currentPhoneme.id, word);
    if (speakTimerRef.current !== null) {
      window.clearTimeout(speakTimerRef.current);
    }
    // NOTE: 略错开 95ms 再读单词，让轻快提示音与单词首辅音清晰分离
    speakTimerRef.current = window.setTimeout(() => {
      speakWord(word);
      speakTimerRef.current = null;
    }, 95);
  };

  const handleSaveCustomWord = () => {
    const trimmed = customWordInput.trim();
    if (!trimmed) {
      return;
    }
    playSelectWordSfx();
    onSetRepresentativeWord(currentPhoneme.id, trimmed);
    setCustomWordInput('');
  };

  const isPlayingCurrentAudio = playingId === currentPhoneme.id;
  /** 音频还在下载、没出声时给出「加载中」反馈，避免用户以为点了没反应 */
  const isPendingPhoneme = pendingKey === `phoneme:${currentPhoneme.id}`;

  return (
    <div className="studio-layout">
      <PhonemeSidebar
        phonemes={filteredPhonemes}
        selectedCategory={selectedCategory}
        onSelectCategory={setSelectedCategory}
        progressFilter={progressFilter}
        onSelectProgressFilter={setProgressFilter}
        currentPhonemeId={currentPhoneme.id}
        onSelectPhoneme={onSelectPhoneme}
        getPhonemeProgress={getPhonemeProgress}
        dayFilterIds={dayFilterIds}
        dayFilterLabel={dayFilterLabel}
        onClearDayFilter={onClearDayFilter}
        favoriteIds={favoriteIds}
      />

      <main className="studio-main">
        {/* 顶部控制条 */}
        <div className="studio-toolbar">
          <div className="toolbar-title-group">
            <span className="order-badge">
              #{String(currentPhoneme.order).padStart(2, '0')} · {currentPhoneme.categoryTitle}
            </span>
            <h2 className="phoneme-heading">{currentPhoneme.symbol}</h2>
          </div>

          <div className="toolbar-actions">
            <button
              type="button"
              className={`primary-audio-btn ${isPlayingCurrentAudio ? 'playing' : ''}`}
              onClick={() => playPhonemeAudio(currentPhoneme.localAudioSrc, currentPhoneme.id)}
            >
              <Volume2 size={18} />
              <span>
                {isPlayingCurrentAudio
                  ? '正在播放...'
                  : isPendingPhoneme
                    ? '加载中...'
                    : '听标准发音'}
                {!isPlayingCurrentAudio && !isPendingPhoneme && (
                  <span className="desktop-only-hint"> (空格)</span>
                )}
              </span>
            </button>

            <div className="pager-buttons">
              <button
                type="button"
                className={`favorite-toggle-btn ${isFavorite(currentPhoneme.id) ? 'active' : ''}`}
                onClick={() => onToggleFavorite(currentPhoneme.id)}
                title={isFavorite(currentPhoneme.id) ? '取消收藏这个音标' : '收藏这个音标'}
                aria-pressed={isFavorite(currentPhoneme.id)}
              >
                <Star
                  size={16}
                  fill={isFavorite(currentPhoneme.id) ? 'currentColor' : 'none'}
                />
              </button>

              <button
                type="button"
                className="icon-nav-btn"
                disabled={!prevPhoneme}
                onClick={() => prevPhoneme && onSelectPhoneme(prevPhoneme.id)}
                title="上一个音标 (←)"
              >
                <ArrowLeft size={16} />
                <span>上一个</span>
              </button>
              <button
                type="button"
                className="icon-nav-btn"
                disabled={!nextPhoneme}
                onClick={() => nextPhoneme && onSelectPhoneme(nextPhoneme.id)}
                title="下一个音标 (→)"
              >
                <span>下一个</span>
                <ArrowRight size={16} />
              </button>
            </div>
          </div>
        </div>

        {/* 双栏主学习区 */}
        <div className="studio-grid">
          {/* 左栏：手绘插画卡片 + 代表词与打星互动 */}
          <section className="card-stage-panel">
            <div className="illustrated-card-frame">
              <div className="illustrated-card-inner">
                <img
                  src={currentPhoneme.cardSrc}
                  alt={`音标 ${currentPhoneme.symbol} 手绘卡片`}
                  className="illustrated-card-img"
                  onClick={() => playPhonemeAudio(currentPhoneme.localAudioSrc, currentPhoneme.id)}
                  title="点击卡片空白/顶部区域听音标发音"
                />

                {currentPhoneme.cardWords.map((word, index) => {
                  const isSpeakingCardWord = speakingWord === word;
                  const isPendingCardWord = pendingKey === `word:${word.trim().toLowerCase()}`;
                  return (
                    <button
                      key={`${currentPhoneme.id}-hotspot-${word}`}
                      type="button"
                      className={`card-word-hotspot ${isSpeakingCardWord ? 'speaking' : ''} ${isPendingCardWord ? 'pending' : ''}`}
                      style={{ left: CARD_HOTSPOT_LEFT_POSITIONS[index] }}
                      onClick={() => speakWord(word)}
                      title={`点击朗读单词 ${word}`}
                      aria-label={`朗读卡片单词 ${CARD_OPTION_LETTERS[index]} ${word}`}
                    >
                      <span className="hotspot-speaker-pill">
                        <Volume2 size={12} />
                        <span>
                          {isSpeakingCardWord ? '朗读中' : isPendingCardWord ? '加载中' : word}
                        </span>
                      </span>
                    </button>
                  );
                })}

                <button
                  type="button"
                  className={`card-audio-hint ${isPlayingCurrentAudio ? 'active' : ''}`}
                  onClick={() => playPhonemeAudio(currentPhoneme.localAudioSrc, currentPhoneme.id)}
                >
                  <Volume2 size={15} />
                  <span>{isPlayingCurrentAudio ? '发音中...' : '点击卡片听音标'}</span>
                </button>
              </div>
            </div>

            {/* 互动小练习：对应卡片上的“我的代表词”与今日已学打卡 */}
            <div className="card-homework-box">
              <div className="homework-row">
                <div className="homework-label-row">
                  <span className="homework-title">谁来代表这个音？我的代表词（点击试听并选择）</span>
                  <div className="homework-status-actions">
                    {currentProgress.representativeWord && (
                      <span className="selected-rep-badge">
                        已选：{currentProgress.representativeWord}
                      </span>
                    )}
                    <button
                      type="button"
                      className={`complete-toggle-btn ${currentProgress.completed ? 'done' : ''}`}
                      onClick={() => onToggleCompleted(currentPhoneme.id)}
                    >
                      <CheckCircle2 size={16} />
                      <span>{currentProgress.completed ? '今日已学' : '标记已学'}</span>
                    </button>
                  </div>
                </div>

                <div className="rep-choice-chips">
                  {currentPhoneme.cardWords.map((word, index) => {
                    const isSelected = currentProgress.representativeWord === word;
                    const isSpeaking = speakingWord === word;
                    return (
                      <button
                        key={word}
                        type="button"
                        className={`rep-chip ${isSelected ? 'active' : ''} ${
                          isSpeaking ? 'speaking' : ''
                        }`}
                        onClick={() => handleSelectRepresentativeChip(word)}
                        title={`设为代表词并朗读 ${word}`}
                      >
                        <Volume2 size={13} />
                        <span>
                          {CARD_OPTION_LETTERS[index]}. {word}
                        </span>
                      </button>
                    );
                  })}
                </div>

                <div className="custom-word-row">
                  <input
                    type="text"
                    className="custom-word-input"
                    placeholder="或自己写一个最顺口的代表词（如 tea）"
                    value={customWordInput}
                    onChange={(event) => setCustomWordInput(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        handleSaveCustomWord();
                      }
                    }}
                  />
                  <button
                    type="button"
                    className="save-word-btn"
                    onClick={handleSaveCustomWord}
                    disabled={!customWordInput.trim()}
                  >
                    设为代表词
                  </button>
                </div>
              </div>
            </div>

            {/* 放在中间“我的代表词”下方：跟读录音与匹配度对比 */}
            <div className="lab-card recorder-center-card">
              <div className="lab-card-header">
                <h3>跟读录音与匹配度对比</h3>
                <span className="subtle-hint">录音自动保存在本机，切换音标或刷新页面都不会丢失</span>
              </div>

              <div className="recorder-actions">
                {!recorder.isRecording ? (
                  <button
                    type="button"
                    className="record-btn"
                    onClick={() => void recorder.startRecording()}
                  >
                    <Mic size={16} />
                    <span>{recorder.recordedUrl ? '重新录音' : '开始跟读录音'}</span>
                  </button>
                ) : (
                  <button
                    type="button"
                    className="record-btn recording"
                    onClick={recorder.stopRecording}
                  >
                    <Square size={15} fill="currentColor" />
                    <span>点击停止录音...</span>
                  </button>
                )}

                <button
                  type="button"
                  className="primary-audio-btn compact"
                  disabled={!recorder.recordedUrl}
                  onClick={() => recorder.playComparisonSequence(currentPhoneme.localAudioSrc)}
                  title="先播一遍标准音，紧接着播一遍你的录音"
                >
                  <Volume2 size={15} />
                  <span>
                    {recorder.comparePhase === 'reference'
                      ? '正在播原声...'
                      : recorder.comparePhase === 'user'
                        ? '正在播我的...'
                        : '轮流对比听 (原声→我的)'}
                  </span>
                </button>

                <button
                  type="button"
                  className="secondary-btn compact"
                  disabled={!recorder.recordedUrl}
                  onClick={recorder.playRecording}
                >
                  <Play size={14} />
                  <span>{recorder.isPlayingRecording ? '回放中...' : '只听我的'}</span>
                </button>

                <button
                  type="button"
                  className="secondary-btn compact"
                  onClick={() => playPhonemeAudio(currentPhoneme.localAudioSrc, currentPhoneme.id)}
                >
                  <Volume2 size={14} />
                  <span>只听原声</span>
                </button>

                {recorder.recordedUrl && (
                  <button
                    type="button"
                    className="secondary-btn compact delete-recording-btn"
                    onClick={recorder.deleteSavedRecording}
                    title="删除这个音标已保存的跟读录音"
                  >
                    <span>删除录音</span>
                  </button>
                )}
              </div>

              {recorder.errorMessage && (
                <p className="recorder-error">{recorder.errorMessage}</p>
              )}

              {recorder.trimInfo?.hasSpeech && recorder.trimInfo.leadingTrimmedSec >= 0.15 && (
                <p className="trim-info-note">
                  已智能过滤开头 {recorder.trimInfo.leadingTrimmedSec}s 停顿与环境背景声
                </p>
              )}

              {isAnalyzing && (
                <div className="match-loading-box">正在对比口型音色与时长节奏，计算匹配度...</div>
              )}

              {!isAnalyzing && analysisResult && (
                <div className="match-result-panel">
                  <div className="match-score-row">
                    <div
                      className={`match-score-badge ${
                        analysisResult.status === 'too-quiet'
                          ? 'low'
                          : analysisResult.overallScore >= 76
                            ? 'high'
                            : analysisResult.overallScore >= 60
                              ? 'mid'
                              : 'low'
                      }`}
                    >
                      <span className="score-number">
                        {analysisResult.status === 'too-quiet'
                          ? '--'
                          : `${analysisResult.overallScore}%`}
                      </span>
                      <span className="score-label">{analysisResult.gradeLabel}</span>
                    </div>

                    <div className="match-metrics-col">
                      {analysisResult.status === 'ok' && (
                        <div className="match-sub-metrics">
                          <span>
                            口型音色匹配：<strong>{analysisResult.timbreScore}%</strong>
                          </span>
                          <span>
                            {analysisResult.articulationLabel}：
                            <strong>{analysisResult.articulationScore}%</strong>
                          </span>
                          <span>
                            长短节奏匹配：<strong>{analysisResult.rhythmScore}%</strong>
                          </span>
                          <span className="duration-compare">
                            时长对比：原声 {analysisResult.referenceDurationSec}s / 我的{' '}
                            {analysisResult.userDurationSec}s
                          </span>
                        </div>
                      )}

                      {analysisResult.closestOtherPhoneme && (
                        <button
                          type="button"
                          className="confused-hint-pill"
                          onClick={() => {
                            const targetId = analysisResult.closestOtherPhoneme!.id;
                            if (relatedIds.includes(targetId)) {
                              onJumpToPair(targetId);
                            } else {
                              onSelectPhoneme(targetId);
                            }
                          }}
                          title="点击对比或查看该音标"
                        >
                          <GitCompare size={13} />
                          <span>
                            听起来偏像 {analysisResult.closestOtherPhoneme.symbol}（点击去对比）
                          </span>
                        </button>
                      )}

                      <p className="match-feedback-tip">{analysisResult.feedbackTip}</p>
                    </div>
                  </div>

                  {/* 双轨声波轮廓对比图 */}
                  <div className="waveform-compare-box">
                    <div
                      className={`waveform-track ${
                        recorder.comparePhase === 'reference' ? 'active-track' : ''
                      }`}
                    >
                      <span className="waveform-label">标准原声</span>
                      <div className="waveform-bars">
                        {analysisResult.referenceWaveform.map((amp, idx) => (
                          <span
                            key={`ref-${idx}`}
                            className="wave-bar ref-bar"
                            style={{ height: `${Math.max(14, Math.round(amp * 100))}%` }}
                          />
                        ))}
                      </div>
                    </div>

                    <div
                      className={`waveform-track ${
                        recorder.comparePhase === 'user' ? 'active-track' : ''
                      }`}
                    >
                      <span className="waveform-label">我的跟读</span>
                      <div className="waveform-bars">
                        {analysisResult.userWaveform.map((amp, idx) => (
                          <span
                            key={`user-${idx}`}
                            className="wave-bar user-bar"
                            style={{ height: `${Math.max(14, Math.round(amp * 100))}%` }}
                          />
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </section>

          {/* 右栏：口型演示视频 + 发音要领 */}
          <section className="lab-panel">
            {/* 1. 口型演示视频 */}
            <div className="lab-card">
              <div className="lab-card-header">
                <h3>口型演示实验室</h3>
                <div className="video-controls-inline">
                  <button
                    type="button"
                    className={`pill-toggle-btn ${slowMode ? 'active' : ''}`}
                    onClick={() => setSlowMode((prev) => !prev)}
                  >
                    {slowMode ? '0.75x 慢速口型' : '1.0x 正常速度'}
                  </button>
                  <button
                    type="button"
                    className={`pill-toggle-btn ${videoLoop ? 'active' : ''}`}
                    onClick={() => setVideoLoop((prev) => !prev)}
                    title="循环播放口型"
                  >
                    <Repeat size={13} />
                    <span>循环</span>
                  </button>
                </div>
              </div>

              <div className="video-stage">
                <video
                  key={currentPhoneme.id}
                  ref={videoRef}
                  src={currentPhoneme.localVideoSrc}
                  poster={currentPhoneme.posterSrc}
                  preload="metadata"
                  loop={videoLoop}
                  playsInline
                  controls
                  className="mouth-video"
                  onPlay={() => setIsVideoPlaying(true)}
                  onPause={() => setIsVideoPlaying(false)}
                  onEnded={() => setIsVideoPlaying(false)}
                />
              </div>

              <div className="video-footer-actions">
                <button type="button" className="secondary-btn" onClick={handleToggleVideo}>
                  {isVideoPlaying ? <Pause size={15} /> : <Play size={15} />}
                  <span>{isVideoPlaying ? '暂停口型演示' : '播放口型演示'}</span>
                </button>
                <button
                  type="button"
                  className="secondary-btn"
                  onClick={() => playPhonemeAudio(currentPhoneme.localAudioSrc, currentPhoneme.id)}
                >
                  <Volume2 size={15} />
                  <span>{isPendingPhoneme ? '加载中...' : '只听纯音频'}</span>
                </button>
              </div>
            </div>

            {/* 2. 发音要领 & 易混避坑 */}
            <div className="lab-card">
              <h3>发音要领与易混提醒</h3>
              <ul className="tips-list">
                {currentPhoneme.pronunciationTips.map((tip) => (
                  <li key={tip}>{tip}</li>
                ))}
              </ul>

              {currentPhoneme.confusionNote && (
                <div className="confusion-alert">
                  <AlertTriangle size={17} className="alert-icon" />
                  <div className="confusion-content">
                    <strong>初一易混避坑：</strong>
                    <span>{currentPhoneme.confusionNote}</span>
                  </div>
                </div>
              )}

              {relatedIds.length > 0 && (
                <div className="related-pairs-row">
                  <span className="related-label">易混对比跳转：</span>
                  {relatedIds.map((relatedId) => {
                    const target = PHONEME_MAP[relatedId];
                    if (!target) {
                      return null;
                    }
                    return (
                      <button
                        key={relatedId}
                        type="button"
                        className="jump-pair-btn"
                        onClick={() => onJumpToPair(relatedId)}
                      >
                        <GitCompare size={13} />
                        <span>
                          对比 {target.symbol}
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </section>
        </div>
      </main>
    </div>
  );
}
