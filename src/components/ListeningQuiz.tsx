import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowRight,
  Award,
  CheckCircle2,
  Eye,
  Flame,
  RefreshCw,
  RotateCcw,
  Sparkles,
  Target,
  Volume2,
  VolumeX,
  XCircle,
} from 'lucide-react';
import { CONFUSABLE_PAIRS, PHONEME_MAP, PHONEMES } from '../data/phonics-catalog';
import { useAudioPlayer } from '../hooks/useAudioPlayer';
import type {
  ConfusablePair,
  PhonemeExample,
  PhonemeItem,
  PhonemeProgress,
  QuizStats,
} from '../types/phonics';
import { resumeSharedAudioContext } from '../utils/audio-context';
import {
  playComboSfx,
  playCorrectSfx,
  playRoundFinishSfx,
  playWrongSfx,
} from '../utils/sound-effects';

type QuizMode = 'listen-card' | 'confusable' | 'word-phoneme' | 'ipa-word';

interface QuizOption {
  key: string;
  label: string;
  subLabel?: string;
  phonemeId: string;
  wordAudio?: string;
}

interface QuizQuestion {
  mode: QuizMode;
  targetPhoneme: PhonemeItem;
  targetExample?: PhonemeExample;
  pairedPhoneme?: PhonemeItem;
  promptTitle: string;
  promptSubtitle: string;
  options: QuizOption[];
  correctKey: string;
  explanation: string;
}

interface RoundAttempt {
  question: QuizQuestion;
  isCorrect: boolean;
  chosenKey: string;
}

interface ListeningQuizProps {
  quizStats: QuizStats;
  weakPhonemeIds: string[];
  getPhonemeProgress?: (phonemeId: string) => PhonemeProgress;
  onRecordAttempt: (phonemeId: string, isCorrect: boolean, currentCombo: number) => void;
  onJumpToStudio: (phonemeId: string) => void;
}

const DEFAULT_ROUND_SIZE = 10;

const MODE_LABELS: Array<{ id: QuizMode; label: string; desc: string }> = [
  { id: 'listen-card', label: '1. 听音选音标', desc: '4选1 · 辨音基础' },
  { id: 'confusable', label: '2. 双胞胎辨音', desc: '2选1 · 易混对比' },
  { id: 'word-phoneme', label: '3. 听单词找核心音', desc: '4选1 · 真实词拼读' },
  { id: 'ipa-word', label: '4. 看音标猜单词', desc: '4选1 · 音标反推' },
];

/**
 * 洗牌算法，避免题目与选项顺序固定
 */
function shuffleArray<T>(items: T[]): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

/**
 * 从候选池生成固定长度的题干音标序列，减少连续重复
 */
function buildTargetPool(
  mode: QuizMode,
  poolIds: string[] | null,
  count: number,
): { phonemeIds: string[]; pairs?: ConfusablePair[] } {
  if (mode === 'confusable' && !poolIds) {
    const pairs: ConfusablePair[] = [];
    while (pairs.length < count) {
      pairs.push(...shuffleArray(CONFUSABLE_PAIRS));
    }
    const slicedPairs = pairs.slice(0, count);
    return {
      phonemeIds: slicedPairs.map((pair) => (Math.random() < 0.5 ? pair.leftId : pair.rightId)),
      pairs: slicedPairs,
    };
  }

  const baseIds =
    poolIds && poolIds.length > 0 ? poolIds : PHONEMES.map((item) => item.id);
  const result: string[] = [];
  while (result.length < count) {
    result.push(...shuffleArray(baseIds));
  }
  return { phonemeIds: result.slice(0, count) };
}

/**
 * 根据题型与指定目标音标生成题目
 */
function buildQuestionForTarget(
  mode: QuizMode,
  targetId: string,
  forcedPair?: ConfusablePair,
): QuizQuestion {
  const target = PHONEME_MAP[targetId] ?? PHONEMES[0];

  if (mode === 'confusable') {
    const matchingPairs = CONFUSABLE_PAIRS.filter(
      (pair) => pair.leftId === target.id || pair.rightId === target.id,
    );
    const pair =
      forcedPair ??
      (matchingPairs.length > 0
        ? matchingPairs[Math.floor(Math.random() * matchingPairs.length)]
        : CONFUSABLE_PAIRS[Math.floor(Math.random() * CONFUSABLE_PAIRS.length)]);

    const left = PHONEME_MAP[pair.leftId];
    const right = PHONEME_MAP[pair.rightId];
    const actualTarget =
      forcedPair || matchingPairs.length > 0
        ? target
        : Math.random() < 0.5
          ? left
          : right;
    const pairedPhoneme = actualTarget.id === left.id ? right : left;

    return {
      mode,
      targetPhoneme: actualTarget,
      pairedPhoneme,
      promptTitle: '听语音，分辨这对“双胞胎音标”',
      promptSubtitle: pair.title,
      options: [
        {
          key: left.id,
          label: left.symbol,
          subLabel: `如 ${left.cardWords[0] ?? left.examples[0]?.word ?? ''}`,
          phonemeId: left.id,
        },
        {
          key: right.id,
          label: right.symbol,
          subLabel: `如 ${right.cardWords[0] ?? right.examples[0]?.word ?? ''}`,
          phonemeId: right.id,
        },
      ],
      correctKey: actualTarget.id,
      explanation: pair.keyDifference,
    };
  }

  if (mode === 'word-phoneme') {
    const targetExample = target.examples[Math.floor(Math.random() * target.examples.length)];
    const sameFamily = PHONEMES.filter(
      (item) => item.id !== target.id && item.family === target.family,
    );
    const distractors = shuffleArray(sameFamily).slice(0, 3);
    const options = shuffleArray([target, ...distractors]).map((item) => ({
      key: item.id,
      label: item.symbol,
      subLabel: item.categoryTitle,
      phonemeId: item.id,
    }));

    return {
      mode,
      targetPhoneme: target,
      targetExample,
      promptTitle: '听单词读音，选出它包含的核心音标',
      promptSubtitle: `${targetExample.meaning}（可点下方“偷看拼写”提示）`,
      options,
      correctKey: target.id,
      explanation: `单词 ${targetExample.word}（${targetExample.phonetic}，${targetExample.meaning}）包含核心音标 ${target.symbol}。`,
    };
  }

  if (mode === 'ipa-word') {
    const targetExample = target.examples[Math.floor(Math.random() * target.examples.length)];
    const distractors = shuffleArray(PHONEMES.filter((item) => item.id !== target.id))
      .slice(0, 3)
      .map((item) => item.examples[0]);

    const options = shuffleArray([targetExample, ...distractors]).map((example) => ({
      key: example.word,
      label: example.word,
      subLabel: example.meaning,
      phonemeId: target.id,
      wordAudio: example.word,
    }));

    return {
      mode,
      targetPhoneme: target,
      targetExample,
      promptTitle: '看音标，拼出它是哪个英语单词？',
      promptSubtitle: targetExample.phonetic,
      options,
      correctKey: targetExample.word,
      explanation: `${targetExample.phonetic} 对应单词 ${targetExample.word}（${targetExample.meaning}），核心音素是 ${target.symbol}。`,
    };
  }

  // 默认：听音选音标
  const sameFamily = PHONEMES.filter(
    (item) => item.id !== target.id && item.family === target.family,
  );
  const distractors = shuffleArray(sameFamily).slice(0, 3);
  const options = shuffleArray([target, ...distractors]).map((item) => ({
    key: item.id,
    label: item.symbol,
    subLabel: item.categoryTitle,
    phonemeId: item.id,
  }));

  return {
    mode: 'listen-card',
    targetPhoneme: target,
    promptTitle: '听这段发音，它对应哪张音标卡片？',
    promptSubtitle: '按键盘 1–4 作答，答完按空格直接进入下一题',
    options,
    correctKey: target.id,
    explanation: `标准音标是 ${target.symbol}（${target.categoryTitle}）。${target.confusionNote}`,
  };
}

/**
 * 构建整轮闯关题目列表
 */
function createRoundQuestions(
  mode: QuizMode,
  customPoolIds: string[] | null,
  desiredCount: number,
): QuizQuestion[] {
  const { phonemeIds, pairs } = buildTargetPool(mode, customPoolIds, desiredCount);
  return phonemeIds.map((id, idx) => buildQuestionForTarget(mode, id, pairs?.[idx]));
}

/**
 * 根据本轮正确率评定勋章等级
 */
function getRoundRank(score: number, total: number) {
  const ratio = total > 0 ? score / total : 0;
  if (ratio === 1) {
    return { grade: 'SSS', title: '音标小女神', message: '全对通关！耳朵和拼读直觉都超级敏锐！' };
  }
  if (ratio >= 0.8) {
    return { grade: 'S', title: '敏锐小耳朵', message: '非常棒！把错的那一两题顺手再听一遍就满分啦。' };
  }
  if (ratio >= 0.6) {
    return { grade: 'A', title: '稳步进阶中', message: '基础不错，点下面“专刷本轮错题”马上把易混音巩固住！' };
  }
  return { grade: 'B', title: '热身小练兵', message: '不着急，先去“双胞胎易混屋”对比看口型视频，再来挑战！' };
}

/**
 * 听音闯关赛视图：支持 4 种题型、进度条、键盘快选、错题专刷与即时对比听音
 */
export function ListeningQuiz({
  quizStats,
  weakPhonemeIds,
  onRecordAttempt,
  getPhonemeProgress,
  onJumpToStudio,
}: ListeningQuizProps) {
  const [mode, setMode] = useState<QuizMode>('listen-card');
  const [weakOnly, setWeakOnly] = useState<boolean>(false);
  const [sfxEnabled, setSfxEnabled] = useState<boolean>(true);
  const [showWordSpellingHint, setShowWordSpellingHint] = useState<boolean>(false);

  const [questions, setQuestions] = useState<QuizQuestion[]>(() =>
    createRoundQuestions('listen-card', null, DEFAULT_ROUND_SIZE),
  );
  const [roundIndex, setRoundIndex] = useState<number>(0);
  const [attempts, setAttempts] = useState<RoundAttempt[]>([]);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [combo, setCombo] = useState<number>(0);
  const [roundBestCombo, setRoundBestCombo] = useState<number>(0);
  const [comboBurst, setComboBurst] = useState<number | null>(null);
  const [roundFinished, setRoundFinished] = useState<boolean>(false);

  const { playingId, speakingWord, playPhonemeAudio, speakWord, preloadUrls, preloadWords } =
    useAudioPlayer();

  const currentQuestion = questions[roundIndex] ?? questions[0];

  const startNewRound = useCallback(
    (nextMode: QuizMode, useWeakPool: boolean, explicitPoolIds?: string[]) => {
      const pool =
        explicitPoolIds && explicitPoolIds.length > 0
          ? explicitPoolIds
          : useWeakPool && weakPhonemeIds.length > 0
            ? weakPhonemeIds
            : null;
      const count =
        explicitPoolIds && explicitPoolIds.length > 0
          ? explicitPoolIds.length
          : DEFAULT_ROUND_SIZE;

      setQuestions(createRoundQuestions(nextMode, pool, count));
      setRoundIndex(0);
      setAttempts([]);
      setSelectedKey(null);
      setCombo(0);
      setRoundBestCombo(0);
      setComboBurst(null);
      setRoundFinished(false);
      setShowWordSpellingHint(false);
    },
    [weakPhonemeIds],
  );

  const playCurrentPromptAudio = useCallback(
    (targetQuestion: QuizQuestion) => {
      if (targetQuestion.mode === 'ipa-word' || targetQuestion.mode === 'word-phoneme') {
        if (targetQuestion.targetExample) {
          speakWord(targetQuestion.targetExample.word);
        }
      } else {
        playPhonemeAudio(
          targetQuestion.targetPhoneme.localAudioSrc,
          `quiz-${targetQuestion.targetPhoneme.id}`,
        );
      }
    },
    [playPhonemeAudio, speakWord],
  );

  // 预加载当前题与下一题音频 + 自动播放题目语音
  useEffect(() => {
    if (roundFinished || !currentQuestion) {
      return;
    }
    const urlsToPreload = [currentQuestion.targetPhoneme.localAudioSrc];
    if (currentQuestion.pairedPhoneme) {
      urlsToPreload.push(currentQuestion.pairedPhoneme.localAudioSrc);
    }
    const nextQuestion = questions[roundIndex + 1];
    if (nextQuestion) {
      urlsToPreload.push(nextQuestion.targetPhoneme.localAudioSrc);
    }
    preloadUrls(urlsToPreload);

    const wordsToPreload: string[] = [];
    if (currentQuestion.targetExample) {
      wordsToPreload.push(currentQuestion.targetExample.word);
    }
    for (const opt of currentQuestion.options) {
      if (opt.wordAudio) {
        wordsToPreload.push(opt.wordAudio);
      }
    }
    if (wordsToPreload.length > 0) {
      preloadWords(wordsToPreload);
    }

    if (currentQuestion.mode !== 'ipa-word') {
      playCurrentPromptAudio(currentQuestion);
    }
  }, [
    currentQuestion,
    playCurrentPromptAudio,
    preloadUrls,
    preloadWords,
    questions,
    roundFinished,
    roundIndex,
  ]);

  const handleChooseOption = useCallback(
    (optionKey: string) => {
      if (selectedKey !== null || roundFinished || !currentQuestion) {
        return;
      }
      setSelectedKey(optionKey);
      const isCorrect = optionKey === currentQuestion.correctKey;
      const nextCombo = isCorrect ? combo + 1 : 0;
      setCombo(nextCombo);
      if (nextCombo > 0) {
        setRoundBestCombo((prev) => Math.max(prev, nextCombo));
      }
      setAttempts((prev) => [
        ...prev,
        { question: currentQuestion, isCorrect, chosenKey: optionKey },
      ]);
      onRecordAttempt(currentQuestion.targetPhoneme.id, isCorrect, nextCombo);

      if (sfxEnabled) {
        void resumeSharedAudioContext();
        if (isCorrect) {
          // 连击里程碑只播升温音，避免和「答对叮咚」叠成一团
          if (nextCombo === 3 || nextCombo === 5 || nextCombo === 8) {
            playComboSfx(nextCombo);
            setComboBurst(nextCombo);
            window.setTimeout(() => setComboBurst(null), 900);
          } else {
            playCorrectSfx();
          }
        } else {
          playWrongSfx();
        }
      }
    },
    [combo, currentQuestion, onRecordAttempt, roundFinished, selectedKey, sfxEnabled],
  );

  const handleNextQuestion = useCallback(() => {
    if (roundIndex + 1 >= questions.length) {
      setRoundFinished(true);
      if (sfxEnabled) {
        playRoundFinishSfx();
      }
      return;
    }
    setRoundIndex((prev) => prev + 1);
    setSelectedKey(null);
    setShowWordSpellingHint(false);
  }, [questions.length, roundIndex, sfxEnabled]);

  // 键盘快捷键：1-4 选择，R 重听；未答时空格重听，答完后空格或 Enter 进入下一题
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (roundFinished || !currentQuestion) {
        return;
      }
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) {
        return;
      }

      if (event.code === 'KeyR') {
        event.preventDefault();
        playCurrentPromptAudio(currentQuestion);
      } else if (event.code === 'Space') {
        event.preventDefault();
        if (selectedKey !== null) {
          handleNextQuestion();
        } else {
          playCurrentPromptAudio(currentQuestion);
        }
      } else if (event.code === 'Enter' && selectedKey !== null) {
        event.preventDefault();
        handleNextQuestion();
      } else if (selectedKey === null) {
        const numeric = Number(event.key);
        if (numeric >= 1 && numeric <= currentQuestion.options.length) {
          event.preventDefault();
          handleChooseOption(currentQuestion.options[numeric - 1].key);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    currentQuestion,
    handleChooseOption,
    handleNextQuestion,
    playCurrentPromptAudio,
    roundFinished,
    selectedKey,
  ]);

  const handleChangeMode = (nextMode: QuizMode) => {
    setMode(nextMode);
    startNewRound(nextMode, weakOnly);
  };

  const handleToggleWeakOnly = () => {
    const nextWeakOnly = !weakOnly;
    setWeakOnly(nextWeakOnly);
    startNewRound(mode, nextWeakOnly);
  };

  const roundScore = useMemo(
    () => attempts.filter((item) => item.isCorrect).length,
    [attempts],
  );
  const wrongAttempts = useMemo(
    () => attempts.filter((item) => !item.isCorrect),
    [attempts],
  );

  const accuracy =
    quizStats.totalAnswered > 0
      ? Math.round((quizStats.totalCorrect / quizStats.totalAnswered) * 100)
      : 0;

  const rankInfo = getRoundRank(roundScore, questions.length);
  const isPromptPlaying =
    playingId === `quiz-${currentQuestion?.targetPhoneme.id}` ||
    (currentQuestion?.targetExample?.word &&
      speakingWord === currentQuestion.targetExample.word);

  return (
    <section className="page-container">
      <div className="page-hero quiz-hero">
        <div>
          <span className="hero-tag">趣味闯关检测</span>
          <h2>听音闯关赛</h2>
          <p>
            已集成离线本地高清单词发音，点击零延迟！支持键盘 1–4 快选、R 重听、空格进下一题。
          </p>
        </div>

        <div className="quiz-lifetime-stats">
          <div className="mini-stat-card">
            <span>历史正确率</span>
            <strong>{accuracy}%</strong>
          </div>
          <div className="mini-stat-card">
            <span>最高连对</span>
            <strong>{quizStats.bestCombo} 题</strong>
          </div>
        </div>
      </div>

      {/* 题型切换 + 错题专攻 & 音效开关 */}
      <div className="quiz-controls-wrap">
        <div className="quiz-mode-bar">
          {MODE_LABELS.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`mode-pill-btn ${mode === item.id ? 'active' : ''}`}
              onClick={() => handleChangeMode(item.id)}
              title={item.desc}
            >
              {item.label}
            </button>
          ))}
        </div>

        <div className="quiz-utility-toggles">
          <button
            type="button"
            className={`pill-toggle-btn ${weakOnly ? 'active' : ''}`}
            disabled={weakPhonemeIds.length === 0}
            onClick={handleToggleWeakOnly}
            title={
              weakPhonemeIds.length === 0
                ? '目前没有待巩固音标哦'
                : `仅从 ${weakPhonemeIds.length} 个待巩固音标出题`
            }
          >
            <Target size={14} />
            <span>
              只刷薄弱音 {weakPhonemeIds.length > 0 ? `(${weakPhonemeIds.length})` : ''}
            </span>
          </button>

          <button
            type="button"
            className={`pill-toggle-btn ${sfxEnabled ? 'active' : ''}`}
            onClick={() => setSfxEnabled((prev) => !prev)}
            title="开启或关闭答题叮咚音效"
          >
            {sfxEnabled ? <Volume2 size={14} /> : <VolumeX size={14} />}
            <span>{sfxEnabled ? '答题音效开' : '静音模式'}</span>
          </button>
        </div>
      </div>

      {roundFinished ? (
        <div className="quiz-result-card result-settle-in">
          <div className="rank-medal-badge">
            <Award size={30} />
            <span>{rankInfo.grade}</span>
          </div>
          <h3>{rankInfo.title}</h3>
          <p className="result-score-line">
            本轮答对 <strong>{roundScore}</strong> / {questions.length} 题
          </p>
          <div className="result-combo-line">
            <Flame size={16} />
            <span>
              本轮最高连击 <strong>{roundBestCombo}</strong>
              {roundBestCombo >= 5 ? ' · 手感火热' : roundBestCombo >= 3 ? ' · 不错哦' : ''}
            </span>
          </div>
          <p className="result-encouragement">{rankInfo.message}</p>

          {wrongAttempts.length > 0 && (
            <div className="wrong-review-box">
              <div className="wrong-review-header">
                <strong>本轮易错音标复盘（{wrongAttempts.length} 题）</strong>
              </div>
              <div className="wrong-review-list">
                {wrongAttempts.map((item, idx) => (
                  <div
                    key={`${item.question.targetPhoneme.id}-${idx}`}
                    className="wrong-review-row"
                  >
                    <div className="wrong-row-info">
                      <span className="wrong-symbol">{item.question.targetPhoneme.symbol}</span>
                      <span className="wrong-explain">
                        {item.question.targetExample
                          ? `${item.question.targetExample.word} ${item.question.targetExample.phonetic}（${item.question.targetExample.meaning}）`
                          : item.question.targetPhoneme.confusionNote}
                      </span>
                    </div>
                    <div className="wrong-row-actions">
                      <button
                        type="button"
                        className="secondary-btn compact"
                        onClick={() => playCurrentPromptAudio(item.question)}
                      >
                        <Volume2 size={14} />
                        <span>听一遍</span>
                      </button>
                      <button
                        type="button"
                        className="secondary-btn compact"
                        onClick={() => onJumpToStudio(item.question.targetPhoneme.id)}
                      >
                        去卡片馆
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="result-action-row">
            <button
              type="button"
              className="primary-audio-btn play-again-btn"
              onClick={() => startNewRound(mode, weakOnly)}
            >
              <RefreshCw size={16} />
              <span>再来一把！{DEFAULT_ROUND_SIZE} 题</span>
            </button>
            {wrongAttempts.length > 0 && (
              <button
                type="button"
                className="secondary-btn"
                onClick={() => {
                  const missedIds = Array.from(
                    new Set(wrongAttempts.map((item) => item.question.targetPhoneme.id)),
                  );
                  startNewRound(mode, false, missedIds);
                }}
              >
                <RotateCcw size={16} />
                <span>专刷本轮错题 ({wrongAttempts.length} 题)</span>
              </button>
            )}
          </div>
        </div>
      ) : (
        <div className="quiz-stage-card">
          {comboBurst !== null && (
            <div className="combo-burst-overlay" aria-hidden="true">
              <span className="combo-burst-text">×{comboBurst} 连击！</span>
            </div>
          )}

          {/* 10题进度点条 + 连击徽章 */}
          <div className="quiz-stage-top">
            <div className="round-progress-group">
              <span className="round-badge">
                第 {roundIndex + 1} / {questions.length} 题
              </span>
              <div className="round-dots" aria-label="本轮答题进度">
                {questions.map((_, idx) => {
                  const attempt = attempts[idx];
                  let dotClass = 'pending';
                  if (attempt) {
                    dotClass = attempt.isCorrect ? 'correct' : 'wrong';
                  } else if (idx === roundIndex) {
                    dotClass = 'current';
                  }
                  return <span key={idx} className={`round-dot ${dotClass}`} />;
                })}
              </div>
            </div>

            <span className={`combo-badge ${combo >= 3 ? 'hot' : ''} ${combo >= 5 ? 'blaze' : ''}`}>
              <Flame size={15} />
              <span>
                {combo >= 5
                  ? `燃烧！${combo} 连击`
                  : combo >= 3
                    ? `超棒！${combo} 连击`
                    : `当前连对：${combo}`}
              </span>
            </span>
          </div>

          <div className="quiz-prompt-box">
            <p className="quiz-prompt-title">{currentQuestion.promptTitle}</p>

            {currentQuestion.mode === 'ipa-word' ? (
              <div className="ipa-big-prompt">{currentQuestion.promptSubtitle}</div>
            ) : (
              <p className="quiz-prompt-sub">{currentQuestion.promptSubtitle}</p>
            )}

            <div className="prompt-btn-row">
              <button
                type="button"
                className={`primary-audio-btn ${isPromptPlaying ? 'playing' : ''}`}
                onClick={() => playCurrentPromptAudio(currentQuestion)}
              >
                <Volume2 size={18} />
                <span>
                  {currentQuestion.mode === 'ipa-word'
                    ? '偷听单词发音'
                    : currentQuestion.mode === 'word-phoneme'
                      ? '重听单词发音'
                      : '重听音标发音'}
                  <span className="desktop-only-hint"> (R)</span>
                </span>
              </button>

              {currentQuestion.mode === 'word-phoneme' && currentQuestion.targetExample && (
                <button
                  type="button"
                  className="secondary-btn"
                  onClick={() => setShowWordSpellingHint((prev) => !prev)}
                >
                  <Eye size={15} />
                  <span>
                    {showWordSpellingHint
                      ? `拼写提示：${currentQuestion.targetExample.word}`
                      : '偷看单词拼写'}
                  </span>
                </button>
              )}
            </div>
          </div>

          <div
            className={`quiz-options-grid ${
              currentQuestion.options.length === 2 ? 'two-cols' : 'four-cols'
            }`}
          >
            {currentQuestion.options.map((option, idx) => {
              const isAnswered = selectedKey !== null;
              const isSelected = selectedKey === option.key;
              const isCorrectOption = option.key === currentQuestion.correctKey;

              let stateClass = '';
              if (isAnswered) {
                if (isCorrectOption) {
                  stateClass = 'correct';
                } else if (isSelected) {
                  stateClass = 'wrong';
                } else {
                  stateClass = 'dimmed';
                }
              }

              return (
                <button
                  key={option.key}
                  type="button"
                  disabled={isAnswered}
                  className={`quiz-option-card ${stateClass} ${
                    isAnswered && isCorrectOption ? 'option-pop' : ''
                  } ${isAnswered && isSelected && !isCorrectOption ? 'option-shake' : ''}`}
                  onClick={() => handleChooseOption(option.key)}
                >
                  <span className="option-hotkey">{idx + 1}</span>
                  <span className="option-main">{option.label}</span>
                  {option.subLabel && <span className="option-sub">{option.subLabel}</span>}
                </button>
              );
            })}
          </div>

          {selectedKey !== null && (
            <div className="quiz-feedback-panel">
              <div className="feedback-status-row">
                {selectedKey === currentQuestion.correctKey ? (
                  <span className="feedback-ok">
                    <CheckCircle2 size={18} />
                    <span>
                      回答正确！{combo >= 3 ? '手感和耳朵状态火热！' : ''}
                    </span>
                  </span>
                ) : (
                  <span className="feedback-bad">
                    <XCircle size={18} />
                    <span>
                      选偏了一点点，正确答案是{' '}
                      <strong>
                        {currentQuestion.mode === 'ipa-word'
                          ? currentQuestion.correctKey
                          : currentQuestion.targetPhoneme.symbol}
                      </strong>
                    </span>
                  </span>
                )}

                <div className="feedback-quick-actions">
                  {currentQuestion.mode === 'confusable' && currentQuestion.pairedPhoneme && (
                    <>
                      <button
                        type="button"
                        className="secondary-btn compact"
                        onClick={() =>
                          playPhonemeAudio(
                            currentQuestion.targetPhoneme.localAudioSrc,
                            `cmp-${currentQuestion.targetPhoneme.id}`,
                          )
                        }
                      >
                        <Volume2 size={14} />
                        <span>听 {currentQuestion.targetPhoneme.symbol}</span>
                      </button>
                      <button
                        type="button"
                        className="secondary-btn compact"
                        onClick={() =>
                          playPhonemeAudio(
                            currentQuestion.pairedPhoneme!.localAudioSrc,
                            `cmp-${currentQuestion.pairedPhoneme!.id}`,
                          )
                        }
                      >
                        <Volume2 size={14} />
                        <span>对比 {currentQuestion.pairedPhoneme.symbol}</span>
                      </button>
                    </>
                  )}

                  {currentQuestion.mode === 'ipa-word' && (
                    <button
                      type="button"
                      className="secondary-btn compact"
                      onClick={() => playCurrentPromptAudio(currentQuestion)}
                    >
                      <Volume2 size={14} />
                      <span>听单词 {currentQuestion.correctKey}</span>
                    </button>
                  )}

                  <button
                    type="button"
                    className="secondary-btn compact"
                    onClick={() => onJumpToStudio(currentQuestion.targetPhoneme.id)}
                  >
                    <Sparkles size={14} />
                    <span>去卡片馆复习 {currentQuestion.targetPhoneme.symbol}</span>
                  </button>
                </div>
              </div>

              <div className="feedback-detail-card">
                <img
                  src={currentQuestion.targetPhoneme.cardSrc}
                  alt={currentQuestion.targetPhoneme.symbol}
                  className="feedback-thumb-img"
                  onClick={() =>
                    playPhonemeAudio(
                      currentQuestion.targetPhoneme.localAudioSrc,
                      `thumb-${currentQuestion.targetPhoneme.id}`,
                    )
                  }
                  title="点击缩略卡片听音标"
                />
                <div className="feedback-detail-text">
                  <p className="feedback-explain">{currentQuestion.explanation}</p>
                  {(() => {
                    const myCode =
                      getPhonemeProgress?.(currentQuestion.targetPhoneme.id)
                        ?.representativeWord ?? '';
                    if (!myCode) {
                      return null;
                    }
                    return (
                      <p className="feedback-codename">
                        你圈出的词：<strong>{myCode}</strong>
                        <button
                          type="button"
                          className="mini-speak-word-btn"
                          onClick={() => speakWord(myCode)}
                        >
                          <Volume2 size={12} />
                          <span>听一下</span>
                        </button>
                      </p>
                    );
                  })()}
                  <div className="feedback-card-words">
                    <span>卡片词：</span>
                    {currentQuestion.targetPhoneme.cardWords.map((word) => (
                      <button
                        key={word}
                        type="button"
                        className="mini-speak-word-btn"
                        onClick={() => speakWord(word)}
                      >
                        <Volume2 size={12} />
                        <span>{word}</span>
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              <div className="feedback-next-row">
                <span className="hotkey-hint desktop-only-hint">按 空格 或 Enter 键快速进入下一题</span>
                <button type="button" className="primary-audio-btn" onClick={handleNextQuestion}>
                  <span>
                    {roundIndex + 1 >= questions.length ? '查看本轮勋章' : '下一题'}
                    {roundIndex + 1 < questions.length && (
                      <span className="desktop-only-hint"> (空格)</span>
                    )}
                  </span>
                  <ArrowRight size={16} />
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
