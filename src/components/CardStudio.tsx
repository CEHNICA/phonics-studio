import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Mic,
  Sparkles,
  Star,
  Target,
  Volume2,
} from 'lucide-react';
import { PHONEME_MAP, PHONEMES } from '../data/phonics-catalog';
import { useAudioPlayer } from '../hooks/useAudioPlayer';
import { isTrueMastered, SPEAKING_PASS_SCORE } from '../utils/consolidation';
import type { PhonemeItem, PhonemeProgress } from '../types/phonics';
import { PhonemeSidebar, type ProgressFilter } from './PhonemeSidebar';
import { PhonicsBlenderStage } from './PhonicsBlenderStage';
import { PronunciationRadarStage } from './PronunciationRadarStage';

export type StudioStage = 'decode' | 'practice';

interface CardStudioProps {
  currentPhonemeId: string;
  onSelectPhoneme: (phonemeId: string) => void;
  getPhonemeProgress: (phonemeId: string) => PhonemeProgress;
  onSetRepresentativeWord: (phonemeId: string, word: string) => void;
  onToggleCompleted: (phonemeId: string) => void;
  onBlendCompleted: (phonemeId: string) => void;
  onSpeakingEvaluated: (phonemeId: string, score: number, confusedWithId?: string) => void;
  onMinimalPairEvaluated: (phonemeId: string, passed: boolean) => void;
  weakTopIds: string[];
  dayFilterIds: string[] | null;
  dayFilterLabel: string | null;
  onClearDayFilter: () => void;
  onJumpToPair: (phonemeId: string) => void;
  favoriteIds: string[];
  onToggleFavorite: (phonemeId: string) => void;
  isFavorite: (phonemeId: string) => boolean;
}

/**
 * 核心沉浸式学习道场：
 * - 阶段 1（decode）：看口型视频 + 字母规律密码 + 互动音素拼装台 + 折叠手绘联想卡
 * - 阶段 2（practice）：开口纠偏声学偏移靶尺 + 最小对立真词辨音过关
 * 只有经过实操达标才会解锁“真掌握”，废除点选代表词即完成的伪进度逻辑。
 */
export function CardStudio({
  currentPhonemeId,
  onSelectPhoneme,
  getPhonemeProgress,
  onSetRepresentativeWord,
  onToggleCompleted,
  onBlendCompleted,
  onSpeakingEvaluated,
  onMinimalPairEvaluated,
  weakTopIds,
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
  const [stageState, setStageState] = useState<{ phonemeId: string; stage: StudioStage }>({
    phonemeId: currentPhonemeId,
    stage: 'decode',
  });
  const preloadedRef = useRef<string | null>(null);
  const {
    playingId,
    speakingWord,
    pendingKey,
    playPhonemeAudio,
    speakWord,
    playBlendSequence,
    preloadWords,
    preloadUrls,
  } = useAudioPlayer();

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
        return !isTrueMastered(record);
      }
      if (progressFilter === 'review') {
        return record.mistakeCount > 0;
      }
      if (progressFilter === 'mastered') {
        return isTrueMastered(record);
      }
      if (progressFilter === 'favorite') {
        return favoriteIds.includes(item.id);
      }
      return true;
    });
  }, [dayFilterIds, favoriteIds, getPhonemeProgress, progressFilter, selectedCategory]);

  const currentPhoneme = PHONEME_MAP[currentPhonemeId] ?? PHONEMES[0];
  const currentProgress = getPhonemeProgress(currentPhoneme.id);
  const mastered = isTrueMastered(currentProgress);
  const stage: StudioStage = stageState.phonemeId === currentPhoneme.id ? stageState.stage : 'decode';
  const setStage = (next: StudioStage) =>
    setStageState({ phonemeId: currentPhoneme.id, stage: next });

  const activeList = filteredPhonemes.length > 0 ? filteredPhonemes : PHONEMES;
  const currentIndex = activeList.findIndex((item) => item.id === currentPhoneme.id);
  const prevPhoneme = currentIndex > 0 ? activeList[currentIndex - 1] : null;
  const nextPhoneme =
    currentIndex >= 0 && currentIndex < activeList.length - 1 ? activeList[currentIndex + 1] : null;

  // 按队列预加载当前音标发音与代表词（无同步 setState，避免级联重渲染）
  useEffect(() => {
    if (preloadedRef.current !== currentPhoneme.id) {
      preloadUrls([currentPhoneme.localAudioSrc]);
      preloadWords(currentPhoneme.cardWords);
      preloadedRef.current = currentPhoneme.id;
    }
  }, [
    currentPhoneme.cardWords,
    currentPhoneme.id,
    currentPhoneme.localAudioSrc,
    preloadUrls,
    preloadWords,
  ]);

  // 键盘快捷键：← / → 切换音标，空格听标准音
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

  const isPlayingCurrentAudio = playingId === currentPhoneme.id;
  const isPendingPhoneme = pendingKey === `phoneme:${currentPhoneme.id}`;
  const isSpeakingAnyWord = Boolean(speakingWord);
  const isPendingAnyWord = Boolean(pendingKey?.startsWith('word:'));
  const firstWeakId = weakTopIds[0];
  const firstWeakPhoneme = firstWeakId ? PHONEME_MAP[firstWeakId] : null;

  const speakingPassed = (currentProgress.speakingBestScore ?? 0) >= SPEAKING_PASS_SCORE;

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
        {/* 薄弱音优先纠偏提醒条 */}
        {!dayFilterIds && firstWeakPhoneme && firstWeakPhoneme.id !== currentPhoneme.id && (
          <div className="weak-focus-banner">
            <span className="weak-focus-text">
              <Target size={15} />
              <span>
                发现需要优先巩固的音标：<strong>{firstWeakPhoneme.symbol}</strong>
                {getPhonemeProgress(firstWeakPhoneme.id).lastConfusedWithId &&
                  PHONEME_MAP[getPhonemeProgress(firstWeakPhoneme.id).lastConfusedWithId!] &&
                  `（易读偏像 ${PHONEME_MAP[getPhonemeProgress(firstWeakPhoneme.id).lastConfusedWithId!].symbol}）`}
              </span>
            </span>
            <button
              type="button"
              className="weak-jump-btn"
              onClick={() => onSelectPhoneme(firstWeakPhoneme.id)}
            >
              马上重点攻克 →
            </button>
          </div>
        )}

        {/* 顶部控制条：音标身份 + 唯一标准音主按钮 + 上下切换 */}
        <div className="studio-toolbar">
          <div className="toolbar-title-group">
            <span className="order-badge">
              #{String(currentPhoneme.order).padStart(2, '0')} · {currentPhoneme.categoryTitle}
            </span>
            <h2 className="phoneme-heading">{currentPhoneme.symbol}</h2>
            <span className={`mastery-chip ${mastered ? 'done' : 'learning'}`}>
              {mastered ? '✓ 已真掌握' : '学习闯关中'}
            </span>
          </div>

          <div className="toolbar-actions">
            <button
              type="button"
              className={`primary-audio-btn ${
                isPlayingCurrentAudio && !isPendingPhoneme ? 'playing' : ''
              }`}
              onClick={() => playPhonemeAudio(currentPhoneme.localAudioSrc, currentPhoneme.id)}
            >
              <Volume2 size={18} />
              <span>
                {isPendingPhoneme
                  ? '加载中...'
                  : isPlayingCurrentAudio
                    ? '正在播放...'
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
                <Star size={16} fill={isFavorite(currentPhoneme.id) ? 'currentColor' : 'none'} />
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

        {/* 聚焦双阶段道场切换条 + 真掌握印章进度 */}
        <div className="dojo-stepper-bar">
          <div className="dojo-stage-tabs" role="tablist" aria-label="学习闯关阶段">
            <button
              type="button"
              role="tab"
              aria-selected={stage === 'decode'}
              className={`dojo-stage-tab ${stage === 'decode' ? 'active' : ''}`}
              onClick={() => setStage('decode')}
            >
              <span className="dojo-tab-num">1</span>
              <Sparkles size={15} />
              <span>看口型 · 拼装解码</span>
              {currentProgress.blendedCompleted && <CheckCircle2 size={14} className="tab-check" />}
            </button>

            <button
              type="button"
              role="tab"
              aria-selected={stage === 'practice'}
              className={`dojo-stage-tab ${stage === 'practice' ? 'active' : ''}`}
              onClick={() => setStage('practice')}
            >
              <span className="dojo-tab-num">2</span>
              <Mic size={15} />
              <span>开口纠偏 · 真词验耳</span>
              {speakingPassed && currentProgress.minimalPairPassed && (
                <CheckCircle2 size={14} className="tab-check" />
              )}
            </button>
          </div>

          <div className="dojo-seal-row">
            <span className={`seal-pill ${currentProgress.blendedCompleted ? 'lit' : ''}`}>
              拼读解锁
            </span>
            <span className={`seal-pill ${speakingPassed ? 'lit' : ''}`}>
              开口 ≥{SPEAKING_PASS_SCORE}%
            </span>
            <span className={`seal-pill ${currentProgress.minimalPairPassed ? 'lit' : ''}`}>
              对立验耳
            </span>
            <button
              type="button"
              className={`complete-toggle-btn compact ${currentProgress.completed ? 'done' : ''}`}
              onClick={() => onToggleCompleted(currentPhoneme.id)}
              title="若已在老师课堂面测过关，可手动切换已掌握标记"
            >
              <CheckCircle2 size={14} />
              <span>{currentProgress.completed ? '已点亮掌握' : '课堂手动过关'}</span>
            </button>
          </div>
        </div>

        {/* 隐藏状态提示确保音频pending检查严格可读 */}
        {(isPendingAnyWord || isSpeakingAnyWord) && (
          <span className="sr-only" aria-live="polite">
            {isPendingAnyWord ? '加载中' : '朗读中'}
          </span>
        )}

        {stage === 'decode' ? (
          <PhonicsBlenderStage
            key={currentPhoneme.id}
            phoneme={currentPhoneme}
            progress={currentProgress}
            playingId={playingId}
            speakingWord={speakingWord}
            pendingKey={pendingKey}
            onPlayPhoneme={playPhonemeAudio}
            onSpeakWord={speakWord}
            onPlayBlend={playBlendSequence}
            onBlendCompleted={onBlendCompleted}
            onSelectRepresentativeWord={onSetRepresentativeWord}
            onNextStage={() => setStage('practice')}
          />
        ) : (
          <PronunciationRadarStage
            key={currentPhoneme.id}
            phoneme={currentPhoneme}
            progress={currentProgress}
            onPlayPhoneme={playPhonemeAudio}
            onSpeakWord={speakWord}
            onSpeakingEvaluated={onSpeakingEvaluated}
            onMinimalPairEvaluated={onMinimalPairEvaluated}
            onJumpToPair={onJumpToPair}
            onSelectPhoneme={onSelectPhoneme}
          />
        )}
      </main>
    </div>
  );
}
