import { useEffect, useMemo, useRef, useState } from 'react';
import {
  CheckCircle2,
  GitCompare,
  Mic,
  Play,
  RefreshCw,
  ShieldCheck,
  Square,
  Volume2,
  XCircle,
} from 'lucide-react';
import { PHONEME_MAP, getRelatedConfusableIds } from '../data/phonics-catalog';
import { getMinimalPairsForPhoneme, type MinimalWordPair } from '../data/phonics-decoding';
import { useVoiceRecorder } from '../hooks/useVoiceRecorder';
import { resumeSharedAudioContext } from '../utils/audio-context';
import { SPEAKING_PASS_SCORE } from '../utils/consolidation';
import { playCorrectSfx, playScoreCelebrateSfx, playWrongSfx } from '../utils/sound-effects';
import type { PronunciationComparisonResult } from '../utils/pronunciation-analyzer';
import type { PhonemeItem, PhonemeProgress } from '../types/phonics';

interface PronunciationRadarStageProps {
  phoneme: PhonemeItem;
  progress: PhonemeProgress;
  onPlayPhoneme: (audioSrc: string, id: string) => void;
  onSpeakWord: (word: string) => void;
  onSpeakingEvaluated: (phonemeId: string, score: number, confusedWithId?: string) => void;
  onMinimalPairEvaluated: (phonemeId: string, passed: boolean) => void;
  onJumpToPair: (relatedId: string) => void;
  onSelectPhoneme: (phonemeId: string) => void;
}

interface PairChallenge {
  pair: MinimalWordPair;
  targetSide: 'left' | 'right';
  chosenSide: 'left' | 'right' | null;
}

/**
 * 第 2 关（开口纠偏偏移仪）+ 第 3 关（最小对立真词辨音验收）
 * - 把声学引擎产出的 closestOtherPhoneme 转为直观左右偏移仪表盘
 * - 跟读未过线且严重偏音自动送入“待巩固”，过关 (>=72) 自动解锁本音标
 * - 最后通过 2 选 1 真词听辨（如 sheep vs ship、mouth vs mouse）彻底检验学效
 */
export function PronunciationRadarStage({
  phoneme,
  progress,
  onPlayPhoneme,
  onSpeakWord,
  onSpeakingEvaluated,
  onMinimalPairEvaluated,
  onJumpToPair,
  onSelectPhoneme,
}: PronunciationRadarStageProps) {
  const [analysisState, setAnalysisState] = useState<{
    blob: Blob | null;
    result: PronunciationComparisonResult | null;
    loading: boolean;
  }>({ blob: null, result: null, loading: false });
  const [scoreCelebrate, setScoreCelebrate] = useState(false);
  const [challengeSeed, setChallengeSeed] = useState(0);
  const [streakPassed, setStreakPassed] = useState(0);
  const [chosenSide, setChosenSide] = useState<'left' | 'right' | null>(null);

  const recordedCommitRef = useRef<string | null>(null);
  const celebrateTimerRef = useRef<number | null>(null);
  const recorder = useVoiceRecorder(phoneme.id);
  const relatedIds = useMemo(() => getRelatedConfusableIds(phoneme.id), [phoneme.id]);
  const minimalPairs = useMemo(() => getMinimalPairsForPhoneme(phoneme.id), [phoneme.id]);

  // 录音落盘后懒加载 DSP 分析器，并在异步回调里统一完成打分与达标庆祝
  useEffect(() => {
    const blob = recorder.recordedBlob;
    if (!blob) {
      return;
    }

    let cancelled = false;
    void Promise.resolve()
      .then(() => {
        if (!cancelled) {
          setAnalysisState({ blob, result: null, loading: true });
        }
        return import('../utils/pronunciation-analyzer');
      })
      .then(({ analyzePronunciation }) =>
        analyzePronunciation(phoneme.id, phoneme.localAudioSrc, blob, {
          userAlreadyTrimmed: true,
          userHasSpeech: recorder.trimInfo?.hasSpeech,
        }),
      )
      .then((result) => {
        if (cancelled) {
          return;
        }
        setAnalysisState({ blob, result, loading: false });
        if (recorder.commitSource === 'user' && result.status === 'ok') {
          const key = `${phoneme.id}:${result.overallScore}:${recorder.recordedUrl ?? ''}`;
          if (recordedCommitRef.current !== key) {
            recordedCommitRef.current = key;
            onSpeakingEvaluated(phoneme.id, result.overallScore, result.closestOtherPhoneme?.id);
            if (result.overallScore >= SPEAKING_PASS_SCORE) {
              setScoreCelebrate(true);
              playScoreCelebrateSfx();
              if (celebrateTimerRef.current !== null) {
                window.clearTimeout(celebrateTimerRef.current);
              }
              celebrateTimerRef.current = window.setTimeout(() => setScoreCelebrate(false), 900);
            }
          }
        }
      })
      .catch(() => {
        if (!cancelled) {
          setAnalysisState({ blob, result: null, loading: false });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [
    onSpeakingEvaluated,
    phoneme.id,
    phoneme.localAudioSrc,
    recorder.commitSource,
    recorder.recordedBlob,
    recorder.recordedUrl,
    recorder.trimInfo,
  ]);

  useEffect(
    () => () => {
      if (celebrateTimerRef.current !== null) {
        window.clearTimeout(celebrateTimerRef.current);
      }
    },
    [],
  );

  const isAnalyzing = Boolean(
    recorder.recordedBlob &&
      (analysisState.blob !== recorder.recordedBlob || analysisState.loading),
  );
  const analysisResult =
    recorder.recordedBlob && analysisState.blob === recorder.recordedBlob
      ? analysisState.result
      : null;

  // 决定偏移仪表盘对标哪一个最易混音标（优先取声学引擎诊断结果，否则取首对易混音）
  const gaugeOpponent = useMemo(() => {
    if (analysisResult?.closestOtherPhoneme) {
      return analysisResult.closestOtherPhoneme;
    }
    const fallbackId = relatedIds[0];
    if (fallbackId && PHONEME_MAP[fallbackId]) {
      return { id: fallbackId, symbol: PHONEME_MAP[fallbackId].symbol };
    }
    return null;
  }, [analysisResult, relatedIds]);

  // 计算偏移指针位置 (0% = 精准落靶，100% = 明显偏向对手音标)
  const driftPercent = useMemo(() => {
    if (!analysisResult || analysisResult.status !== 'ok') {
      return 12;
    }
    if (analysisResult.closestOtherPhoneme) {
      return Math.min(88, Math.max(54, 108 - analysisResult.overallScore));
    }
    return Math.min(46, Math.max(6, Math.round((100 - analysisResult.overallScore) * 0.6)));
  }, [analysisResult]);

  // 构建当前音标的最小对立词辨音卡片
  const activeChallenge = useMemo<PairChallenge | null>(() => {
    if (minimalPairs.length === 0) {
      return null;
    }
    const pair = minimalPairs[challengeSeed % minimalPairs.length];
    const targetSide: 'left' | 'right' = challengeSeed % 2 === 0 ? 'left' : 'right';
    return { pair, targetSide, chosenSide };
  }, [challengeSeed, chosenSide, minimalPairs]);

  const handlePlayChallengeWord = () => {
    if (!activeChallenge) {
      return;
    }
    const word =
      activeChallenge.targetSide === 'left'
        ? activeChallenge.pair.leftWord
        : activeChallenge.pair.rightWord;
    onSpeakWord(word);
  };

  const handleChooseChallengeSide = (side: 'left' | 'right') => {
    if (!activeChallenge || chosenSide !== null) {
      return;
    }
    void resumeSharedAudioContext();
    setChosenSide(side);
    const isCorrect = side === activeChallenge.targetSide;
    if (isCorrect) {
      playCorrectSfx();
      const nextStreak = streakPassed + 1;
      setStreakPassed(nextStreak);
      if (nextStreak >= 2) {
        onMinimalPairEvaluated(phoneme.id, true);
      }
    } else {
      playWrongSfx();
      setStreakPassed(0);
      onMinimalPairEvaluated(phoneme.id, false);
    }
  };

  const handleNextChallenge = () => {
    setChosenSide(null);
    setChallengeSeed((prev) => prev + 1);
  };

  return (
    <div className="dojo-stage-grid">
      {/* 关②：开口跟读与声学靶向偏移仪 */}
      <section className="lab-card recorder-center-card">
        <div className="lab-card-header">
          <div>
            <h3>开口读 · 声学纠偏仪</h3>
            <span className="subtle-hint">
              先听原声再跟读（达 {SPEAKING_PASS_SCORE}% 即算口型过关，录音保存本机不丢失）
            </span>
          </div>
          {progress.speakingBestScore !== undefined && (
            <span
              className={`stage-done-pill ${
                progress.speakingBestScore >= SPEAKING_PASS_SCORE ? '' : 'pending'
              }`}
            >
              最高：{progress.speakingBestScore}%
            </span>
          )}
        </div>

        <div className="recorder-actions">
          <button
            type="button"
            className="primary-audio-btn compact"
            onClick={() => onPlayPhoneme(phoneme.localAudioSrc, phoneme.id)}
          >
            <Volume2 size={15} />
            <span>先听一遍原声</span>
          </button>

          {!recorder.isRecording ? (
            <button
              type="button"
              className="record-btn"
              onClick={() => void recorder.startRecording()}
            >
              <Mic size={16} />
              <span>{recorder.recordedUrl ? '再读一遍优化分数' : '按住/点击跟读录音'}</span>
            </button>
          ) : (
            <button
              type="button"
              className="record-btn recording"
              onClick={() => {
                void resumeSharedAudioContext();
                recorder.stopRecording();
              }}
            >
              <Square size={15} fill="currentColor" />
              <span>点击停止录音...</span>
            </button>
          )}

          <button
            type="button"
            className="primary-audio-btn compact"
            disabled={!recorder.recordedUrl}
            onClick={() => recorder.playComparisonSequence(phoneme.localAudioSrc)}
          >
            <Volume2 size={15} />
            <span>
              {recorder.comparePhase === 'reference'
                ? '正在播原声...'
                : recorder.comparePhase === 'user'
                  ? '正在播我的...'
                  : '原声→我的 对比听'}
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

          {recorder.recordedUrl && (
            <button
              type="button"
              className="secondary-btn compact delete-recording-btn"
              onClick={recorder.deleteSavedRecording}
            >
              <span>删除录音</span>
            </button>
          )}
        </div>

        {recorder.errorMessage && <p className="recorder-error">{recorder.errorMessage}</p>}

        {recorder.trimInfo?.hasSpeech && recorder.trimInfo.leadingTrimmedSec >= 0.15 && (
          <p className="trim-info-note">
            已自动剔除前段 {recorder.trimInfo.leadingTrimmedSec}s 停顿与环境噪声
          </p>
        )}

        {isAnalyzing && <div className="match-loading-box">正在提取共振峰特征并对比 48 音库...</div>}

        {!isAnalyzing && analysisResult && (
          <div className={`match-result-panel ${scoreCelebrate ? 'score-celebrate' : ''}`}>
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
                } ${scoreCelebrate ? 'score-pop' : ''}`}
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
                      原声 {analysisResult.referenceDurationSec}s / 我的{' '}
                      {analysisResult.userDurationSec}s
                    </span>
                  </div>
                )}

                <p className="match-feedback-tip">{analysisResult.feedbackTip}</p>
              </div>
            </div>

            {/* 声学偏移靶尺（Target vs Confusable Gauge） */}
            {analysisResult.status === 'ok' && gaugeOpponent && (
              <div className="acoustic-drift-gauge">
                <div className="drift-labels-row">
                  <span className="drift-target">
                    靶音 {phoneme.symbol}（标准区）
                  </span>
                  <span
                    className={`drift-opponent ${
                      analysisResult.closestOtherPhoneme ? 'warn-active' : ''
                    }`}
                  >
                    易偏向 {gaugeOpponent.symbol}
                  </span>
                </div>
                <div className="drift-track">
                  <div className="drift-zone-safe" />
                  <div className="drift-zone-warn" />
                  <span
                    className={`drift-needle ${
                      analysisResult.closestOtherPhoneme ? 'needle-warn' : 'needle-ok'
                    }`}
                    style={{ left: `${driftPercent}%` }}
                  />
                </div>
                {analysisResult.closestOtherPhoneme && (
                  <div className="drift-fix-actions">
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
                    >
                      <GitCompare size={13} />
                      <span>
                        口型读偏像 {analysisResult.closestOtherPhoneme.symbol}，点此对比纠偏
                      </span>
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* 双轨声波轮廓对比 */}
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
      </section>

      {/* 关③：最小对立真词辨音验收 */}
      <section className="lab-card minimal-pair-gate-card">
        <div className="lab-card-header">
          <div>
            <h3>最小对立真词验耳关</h3>
            <span className="subtle-hint">放到真实单词里听辨，连续选对 2 题即真正过关</span>
          </div>
          {progress.minimalPairPassed ? (
            <span className="stage-done-pill">
              <ShieldCheck size={14} /> 已验耳过关
            </span>
          ) : (
            <span className="streak-pill">连对：{streakPassed}/2</span>
          )}
        </div>

        {activeChallenge ? (
          <div className="minimal-challenge-box">
            <div className="minimal-prompt-bar">
              <button
                type="button"
                className="primary-audio-btn"
                onClick={handlePlayChallengeWord}
              >
                <Volume2 size={16} />
                <span>听单词发音 · 我刚刚读的是哪个？</span>
              </button>
              <span className="minimal-pair-tag">
                对比：{activeChallenge.pair.leftPhonetic} vs {activeChallenge.pair.rightPhonetic}
              </span>
            </div>

            <div className="minimal-options-grid">
              {(['left', 'right'] as const).map((side) => {
                const word =
                  side === 'left'
                    ? activeChallenge.pair.leftWord
                    : activeChallenge.pair.rightWord;
                const phonetic =
                  side === 'left'
                    ? activeChallenge.pair.leftPhonetic
                    : activeChallenge.pair.rightPhonetic;
                const meaning =
                  side === 'left'
                    ? activeChallenge.pair.leftMeaning
                    : activeChallenge.pair.rightMeaning;
                const isChosen = chosenSide === side;
                const isAnswer = activeChallenge.targetSide === side;

                let stateCls = '';
                if (chosenSide !== null) {
                  if (isAnswer) stateCls = 'correct';
                  else if (isChosen) stateCls = 'wrong';
                  else stateCls = 'dimmed';
                }

                return (
                  <button
                    key={side}
                    type="button"
                    disabled={chosenSide !== null}
                    className={`minimal-choice-card ${stateCls}`}
                    onClick={() => handleChooseChallengeSide(side)}
                  >
                    <strong className="minimal-word">{word}</strong>
                    <span className="minimal-phonetic">{phonetic}</span>
                    <span className="minimal-meaning">{meaning}</span>
                  </button>
                );
              })}
            </div>

            {chosenSide !== null && (
              <div className="minimal-feedback-box">
                <div className="minimal-feedback-status">
                  {chosenSide === activeChallenge.targetSide ? (
                    <span className="feedback-ok">
                      <CheckCircle2 size={16} />
                      <span>
                        听准了！正是{' '}
                        {activeChallenge.targetSide === 'left'
                          ? `${activeChallenge.pair.leftWord} ${activeChallenge.pair.leftPhonetic}`
                          : `${activeChallenge.pair.rightWord} ${activeChallenge.pair.rightPhonetic}`}
                      </span>
                    </span>
                  ) : (
                    <span className="feedback-bad">
                      <XCircle size={16} />
                      <span>
                        差一点！刚才播的是{' '}
                        {activeChallenge.targetSide === 'left'
                          ? `${activeChallenge.pair.leftWord} ${activeChallenge.pair.leftPhonetic}`
                          : `${activeChallenge.pair.rightWord} ${activeChallenge.pair.rightPhonetic}`}
                        （已记入待巩固）
                      </span>
                    </span>
                  )}
                  <button type="button" className="primary-audio-btn compact" onClick={handleNextChallenge}>
                    <RefreshCw size={14} />
                    <span>下一题对照</span>
                  </button>
                </div>

                <p className="minimal-focus-tip">{activeChallenge.pair.focusTip}</p>

                <div className="minimal-compare-btns">
                  <button
                    type="button"
                    className="secondary-btn compact"
                    onClick={() => onSpeakWord(activeChallenge.pair.leftWord)}
                  >
                    <Volume2 size={13} />
                    <span>听 {activeChallenge.pair.leftWord}</span>
                  </button>
                  <button
                    type="button"
                    className="secondary-btn compact"
                    onClick={() => onSpeakWord(activeChallenge.pair.rightWord)}
                  >
                    <Volume2 size={13} />
                    <span>对比 {activeChallenge.pair.rightWord}</span>
                  </button>
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="minimal-fallback-box">
            <p className="minimal-focus-tip">
              这个音标暂无典型双胞胎混淆词，听一听下面这两个真词并点击下方“真词朗读对比”完成检验：
            </p>
            <div className="minimal-compare-btns">
              {phoneme.cardWords.slice(0, 2).map((w) => (
                <button
                  key={w}
                  type="button"
                  className="secondary-btn compact"
                  onClick={() => {
                    onSpeakWord(w);
                    onMinimalPairEvaluated(phoneme.id, true);
                  }}
                >
                  <Volume2 size={14} />
                  <span>跟听真词 {w} 并过关</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
