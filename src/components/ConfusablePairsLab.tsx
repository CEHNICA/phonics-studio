import { useEffect, useState } from 'react';
import { BookOpen, CheckCircle2, Shuffle, Sparkles, Volume2, XCircle } from 'lucide-react';
import { CONFUSABLE_PAIRS, PHONEME_MAP } from '../data/phonics-catalog';
import { useAudioPlayer } from '../hooks/useAudioPlayer';
import type { ConfusablePair, PhonemeItem } from '../types/phonics';

interface ConfusablePairsLabProps {
  initialPairId?: string;
  onOpenInStudio: (phonemeId: string) => void;
}

interface BlindChallengeState {
  targetSide: 'left' | 'right';
  guessedSide: 'left' | 'right' | null;
}

/**
 * 双胞胎易混屋：并排对比两个高频混淆音标（卡片 + 口型视频 + 发音 + 盲盒听音辨析）
 */
export function ConfusablePairsLab({
  initialPairId,
  onOpenInStudio,
}: ConfusablePairsLabProps) {
  const [selectedPairId, setSelectedPairId] = useState<string>(
    initialPairId && CONFUSABLE_PAIRS.some((p) => p.id === initialPairId)
      ? initialPairId
      : CONFUSABLE_PAIRS[0].id,
  );
  const [challenge, setChallenge] = useState<BlindChallengeState | null>(null);
  const { playingId, playPhonemeAudio, preloadUrls } = useAudioPlayer();

  const activePair: ConfusablePair =
    CONFUSABLE_PAIRS.find((pair) => pair.id === selectedPairId) ?? CONFUSABLE_PAIRS[0];
  const leftPhoneme = PHONEME_MAP[activePair.leftId];
  const rightPhoneme = PHONEME_MAP[activePair.rightId];

  useEffect(() => {
    if (leftPhoneme && rightPhoneme) {
      preloadUrls([leftPhoneme.localAudioSrc, rightPhoneme.localAudioSrc]);
    }
  }, [leftPhoneme, rightPhoneme, preloadUrls]);

  const handleSelectPair = (pairId: string) => {
    setSelectedPairId(pairId);
    setChallenge(null);
  };

  const handleStartBlindTest = () => {
    if (!leftPhoneme || !rightPhoneme) {
      return;
    }
    const targetSide: 'left' | 'right' = Math.random() < 0.5 ? 'left' : 'right';
    setChallenge({ targetSide, guessedSide: null });
    const target = targetSide === 'left' ? leftPhoneme : rightPhoneme;
    playPhonemeAudio(target.localAudioSrc, `blind-${target.id}`);
  };

  const handleReplayBlind = () => {
    if (!challenge || !leftPhoneme || !rightPhoneme) {
      return;
    }
    const target = challenge.targetSide === 'left' ? leftPhoneme : rightPhoneme;
    playPhonemeAudio(target.localAudioSrc, `blind-${target.id}`);
  };

  const renderPairColumn = (phoneme: PhonemeItem, sideLabel: string) => {
    const isPlaying = playingId === phoneme.id;
    return (
      <div className="pair-column-card">
        <div className="pair-column-header">
          <div>
            <span className="pair-side-tag">{sideLabel}</span>
            <h3 className="pair-symbol">{phoneme.symbol}</h3>
          </div>
          <div className="pair-col-actions">
            <button
              type="button"
              className={`primary-audio-btn compact ${isPlaying ? 'playing' : ''}`}
              onClick={() => playPhonemeAudio(phoneme.localAudioSrc, phoneme.id)}
            >
              <Volume2 size={16} />
              <span>听发音</span>
            </button>
            <button
              type="button"
              className="secondary-btn compact"
              onClick={() => onOpenInStudio(phoneme.id)}
            >
              <BookOpen size={15} />
              <span>进卡片馆</span>
            </button>
          </div>
        </div>

        <div className="pair-media-stack">
          <img
            src={phoneme.cardSrc}
            alt={`音标 ${phoneme.symbol} 卡片`}
            className="pair-card-img"
            onClick={() => playPhonemeAudio(phoneme.localAudioSrc, phoneme.id)}
          />
          <div className="pair-video-box">
            <span className="pair-video-label">口型对照视频</span>
            <video
              key={phoneme.id}
              src={phoneme.localVideoSrc}
              controls
              loop
              playsInline
              className="pair-mouth-video"
            />
          </div>
        </div>

        <ul className="tips-list compact-tips">
          {phoneme.pronunciationTips.map((tip) => (
            <li key={tip}>{tip}</li>
          ))}
        </ul>
      </div>
    );
  };

  if (!leftPhoneme || !rightPhoneme) {
    return null;
  }

  return (
    <section className="page-container">
      <div className="page-hero">
        <div>
          <span className="hero-tag">初一纠音实验室</span>
          <h2>双胞胎易混音对比屋</h2>
          <p>
            把最容易读串的 14 组音标放在一起：先看两张口型视频的细微差别，再玩下面的“听盲盒二选一”测验耳朵！
          </p>
        </div>
      </div>

      <div className="pair-selector-strip">
        {CONFUSABLE_PAIRS.map((pair) => {
          const left = PHONEME_MAP[pair.leftId];
          const right = PHONEME_MAP[pair.rightId];
          return (
            <button
              key={pair.id}
              type="button"
              className={`pair-chip-btn ${pair.id === activePair.id ? 'active' : ''}`}
              onClick={() => handleSelectPair(pair.id)}
            >
              <span className="pair-chip-symbols">
                {left?.symbol} vs {right?.symbol}
              </span>
              <span className="pair-chip-tag">{pair.tag}</span>
            </button>
          );
        })}
      </div>

      {/* 对比总结 + 盲盒挑战区 */}
      <div className="pair-highlight-banner">
        <div className="pair-diff-text">
          <div className="diff-title">
            <Sparkles size={16} />
            <strong>{activePair.title}</strong>
          </div>
          <p>{activePair.keyDifference}</p>
        </div>

        <div className="blind-box-panel">
          <div className="blind-box-top">
            <button type="button" className="primary-audio-btn" onClick={handleStartBlindTest}>
              <Shuffle size={16} />
              <span>{challenge ? '换一题盲盒' : '听盲盒二选一'}</span>
            </button>
            {challenge && (
              <button type="button" className="secondary-btn" onClick={handleReplayBlind}>
                <Volume2 size={15} />
                <span>重听一遍</span>
              </button>
            )}
          </div>

          {challenge && (
            <div className="blind-choices">
              <button
                type="button"
                className={`blind-choice-btn ${
                  challenge.guessedSide === 'left'
                    ? challenge.targetSide === 'left'
                      ? 'correct'
                      : 'wrong'
                    : ''
                }`}
                onClick={() => setChallenge({ ...challenge, guessedSide: 'left' })}
              >
                刚才听到的是 {leftPhoneme.symbol}
              </button>
              <button
                type="button"
                className={`blind-choice-btn ${
                  challenge.guessedSide === 'right'
                    ? challenge.targetSide === 'right'
                      ? 'correct'
                      : 'wrong'
                    : ''
                }`}
                onClick={() => setChallenge({ ...challenge, guessedSide: 'right' })}
              >
                刚才听到的是 {rightPhoneme.symbol}
              </button>

              {challenge.guessedSide && (
                <div className="blind-feedback">
                  {challenge.guessedSide === challenge.targetSide ? (
                    <span className="feedback-ok">
                      <CheckCircle2 size={15} /> 听准了！就是{' '}
                      {challenge.targetSide === 'left' ? leftPhoneme.symbol : rightPhoneme.symbol}
                    </span>
                  ) : (
                    <span className="feedback-bad">
                      <XCircle size={15} /> 再听听看，其实是{' '}
                      {challenge.targetSide === 'left' ? leftPhoneme.symbol : rightPhoneme.symbol}
                    </span>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="pair-compare-grid">
        {renderPairColumn(leftPhoneme, '左侧对照音')}
        {renderPairColumn(rightPhoneme, '右侧对照音')}
      </div>
    </section>
  );
}
