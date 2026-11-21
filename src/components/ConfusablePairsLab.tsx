import { useEffect, useState } from 'react';
import { BookOpen, CheckCircle2, Shuffle, Sparkles, Volume2, XCircle } from 'lucide-react';
import { CONFUSABLE_PAIRS, PHONEME_MAP } from '../data/phonics-catalog';
import { MINIMAL_WORD_PAIRS } from '../data/phonics-decoding';
import { useAudioPlayer } from '../hooks/useAudioPlayer';
import type { ConfusablePair, PhonemeItem } from '../types/phonics';

interface ConfusablePairsLabProps {
  initialPairId?: string;
  onOpenInStudio: (phonemeId: string) => void;
}

interface BlindChallengeState {
  kind: 'phoneme' | 'word';
  targetSide: 'left' | 'right';
  guessedSide: 'left' | 'right' | null;
  pairWordIdx: number;
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
  const { playingId, speakingWord, playPhonemeAudio, speakWord, preloadUrls, preloadWords } =
    useAudioPlayer();

  const activePair: ConfusablePair =
    CONFUSABLE_PAIRS.find((pair) => pair.id === selectedPairId) ?? CONFUSABLE_PAIRS[0];
  const leftPhoneme = PHONEME_MAP[activePair.leftId];
  const rightPhoneme = PHONEME_MAP[activePair.rightId];
  const wordPairs = MINIMAL_WORD_PAIRS.filter((mp) => mp.pairId === activePair.id);

  useEffect(() => {
    if (leftPhoneme && rightPhoneme) {
      preloadUrls([leftPhoneme.localAudioSrc, rightPhoneme.localAudioSrc]);
    }
    if (wordPairs.length > 0) {
      preloadWords(wordPairs.flatMap((wp) => [wp.leftWord, wp.rightWord]));
    }
  }, [leftPhoneme, rightPhoneme, preloadUrls, preloadWords, wordPairs]);

  const handleSelectPair = (pairId: string) => {
    setSelectedPairId(pairId);
    setChallenge(null);
  };

  const handleStartBlindTest = (kind: 'phoneme' | 'word' = 'word') => {
    if (!leftPhoneme || !rightPhoneme) {
      return;
    }
    const useWord = kind === 'word' && wordPairs.length > 0;
    const targetSide: 'left' | 'right' = Math.random() < 0.5 ? 'left' : 'right';
    const pairWordIdx = useWord ? Math.floor(Math.random() * wordPairs.length) : 0;
    setChallenge({ kind: useWord ? 'word' : 'phoneme', targetSide, guessedSide: null, pairWordIdx });
    if (useWord) {
      const wp = wordPairs[pairWordIdx];
      speakWord(targetSide === 'left' ? wp.leftWord : wp.rightWord);
    } else {
      const target = targetSide === 'left' ? leftPhoneme : rightPhoneme;
      playPhonemeAudio(target.localAudioSrc, `blind-${target.id}`);
    }
  };

  const handleReplayBlind = () => {
    if (!challenge || !leftPhoneme || !rightPhoneme) {
      return;
    }
    if (challenge.kind === 'word' && wordPairs[challenge.pairWordIdx]) {
      const wp = wordPairs[challenge.pairWordIdx];
      speakWord(challenge.targetSide === 'left' ? wp.leftWord : wp.rightWord);
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
              poster={phoneme.posterSrc}
              preload="metadata"
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
            {wordPairs.length > 0 && (
              <button
                type="button"
                className="primary-audio-btn"
                onClick={() => handleStartBlindTest('word')}
              >
                <Shuffle size={16} />
                <span>{challenge?.kind === 'word' ? '换一题真词盲盒' : '真词最小对立盲测'}</span>
              </button>
            )}
            <button
              type="button"
              className="secondary-btn"
              onClick={() => handleStartBlindTest('phoneme')}
            >
              <Shuffle size={15} />
              <span>{challenge?.kind === 'phoneme' ? '换一题纯音盲盒' : '纯单音盲盒'}</span>
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
              {(() => {
                const activeWp = wordPairs[challenge.pairWordIdx];
                const leftLabel =
                  challenge.kind === 'word' && activeWp
                    ? `${activeWp.leftWord} ${activeWp.leftPhonetic}（${activeWp.leftMeaning}）`
                    : `刚才听到的是 ${leftPhoneme.symbol}`;
                const rightLabel =
                  challenge.kind === 'word' && activeWp
                    ? `${activeWp.rightWord} ${activeWp.rightPhonetic}（${activeWp.rightMeaning}）`
                    : `刚才听到的是 ${rightPhoneme.symbol}`;
                const targetDisplay =
                  challenge.kind === 'word' && activeWp
                    ? challenge.targetSide === 'left'
                      ? `${activeWp.leftWord} ${activeWp.leftPhonetic}`
                      : `${activeWp.rightWord} ${activeWp.rightPhonetic}`
                    : challenge.targetSide === 'left'
                      ? leftPhoneme.symbol
                      : rightPhoneme.symbol;

                return (
                  <>
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
                      {leftLabel}
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
                      {rightLabel}
                    </button>

                    {challenge.guessedSide && (
                      <div className="blind-feedback">
                        {challenge.guessedSide === challenge.targetSide ? (
                          <span className="feedback-ok">
                            <CheckCircle2 size={15} /> 听准了！就是 {targetDisplay}
                          </span>
                        ) : (
                          <span className="feedback-bad">
                            <XCircle size={15} /> 再听听看，其实是 {targetDisplay}
                          </span>
                        )}
                      </div>
                    )}
                  </>
                );
              })()}
            </div>
          )}
        </div>
      </div>

      {/* 真词最小对立对比带 */}
      {wordPairs.length > 0 && (
        <div className="minimal-strip-section">
          <div className="minimal-strip-head">
            <strong>真实单词最小对立对比（点击直接朗读比对）</strong>
          </div>
          <div className="minimal-strip-grid">
            {wordPairs.map((wp) => (
              <div key={wp.id} className="minimal-pair-row-card">
                <div className="minimal-pair-words">
                  <button
                    type="button"
                    className={`minimal-word-pill ${speakingWord === wp.leftWord ? 'speaking' : ''}`}
                    onClick={() => speakWord(wp.leftWord)}
                  >
                    <Volume2 size={14} />
                    <strong>{wp.leftWord}</strong>
                    <span>{wp.leftPhonetic}</span>
                    <small>{wp.leftMeaning}</small>
                  </button>
                  <span className="minimal-vs-badge">vs</span>
                  <button
                    type="button"
                    className={`minimal-word-pill ${speakingWord === wp.rightWord ? 'speaking' : ''}`}
                    onClick={() => speakWord(wp.rightWord)}
                  >
                    <Volume2 size={14} />
                    <strong>{wp.rightWord}</strong>
                    <span>{wp.rightPhonetic}</span>
                    <small>{wp.rightMeaning}</small>
                  </button>
                </div>
                <p className="minimal-pair-tip">{wp.focusTip}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="pair-compare-grid">
        {renderPairColumn(leftPhoneme, '左侧对照音')}
        {renderPairColumn(rightPhoneme, '右侧对照音')}
      </div>
    </section>
  );
}
