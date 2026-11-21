import { useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  BookImage,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Layers,
  Pause,
  Play,
  Repeat,
  Sparkles,
  Volume2,
} from 'lucide-react';
import { CARD_SLOT_DATA } from '../data/card-word-slots';
import { PHONEME_DECODING_MAP } from '../data/phonics-decoding';
import { PHONEME_MAP } from '../data/phonics-catalog';
import { circleSlotFor, type CircleSlot } from '../utils/card-circle';
import { playSelectWordSfx } from '../utils/sound-effects';
import { resumeSharedAudioContext } from '../utils/audio-context';
import type { PhonemeItem, PhonemeProgress } from '../types/phonics';

interface PhonicsBlenderStageProps {
  phoneme: PhonemeItem;
  progress: PhonemeProgress;
  playingId: string | null;
  speakingWord: string | null;
  pendingKey: string | null;
  onPlayPhoneme: (audioSrc: string, id: string) => void;
  onSpeakWord: (word: string) => void;
  onPlayBlend: (
    phonemeItems: Array<{ audioSrc: string; id: string }>,
    wholeWord: string,
    onStepChange?: (stepIndex: number) => void,
  ) => void;
  onBlendCompleted: (phonemeId: string) => void;
  onSelectRepresentativeWord: (phonemeId: string, word: string) => void;
  onNextStage: () => void;
}

const CARD_OPTION_LETTERS = ['A', 'B', 'C'];
const CARD_HOTSPOT_LEFT_POSITIONS = ['3.47%', '35.07%', '66.67%'];

function circleOvershootPath(slot: CircleSlot): string {
  const start = (205 * Math.PI) / 180;
  const end = (25 * Math.PI) / 180;
  const x0 = slot.cx + slot.rx * Math.cos(start);
  const y0 = slot.cy + slot.ry * Math.sin(start);
  const x1 = slot.cx + slot.rx * Math.cos(end);
  const y1 = slot.cy + slot.ry * Math.sin(end);
  return `M ${x0.toFixed(1)} ${y0.toFixed(1)} A ${slot.rx} ${slot.ry} 0 1 1 ${x1.toFixed(1)} ${y1.toFixed(1)}`;
}

/**
 * 第 1 关：看口型 + 字母拼装解码舞台
 * - 统一单一口型视频视窗与放音入口，消灭旧版 4 个重复“听发音”按钮造成的迷惑
 * - 互动音素滑块拆解真词（如 sh + ee + p → sheep），培养见词能拼核心直觉
 * - 手绘记忆卡片作为可折叠联想辅助，保持主界面清爽聚焦
 */
export function PhonicsBlenderStage({
  phoneme,
  progress,
  playingId,
  speakingWord,
  pendingKey,
  onPlayPhoneme,
  onSpeakWord,
  onPlayBlend,
  onBlendCompleted,
  onSelectRepresentativeWord,
  onNextStage,
}: PhonicsBlenderStageProps) {
  const [slowMode, setSlowMode] = useState(false);
  const [videoLoop, setVideoLoop] = useState(false);
  const [isVideoPlaying, setIsVideoPlaying] = useState(false);
  const [wordIndex, setWordIndex] = useState(0);
  const [activeSegmentIdx, setActiveSegmentIdx] = useState(-1);
  const [showMemoryCard, setShowMemoryCard] = useState(false);
  const [showCustomWord, setShowCustomWord] = useState(false);
  const [customWordInput, setCustomWordInput] = useState('');

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const decodingSpec = PHONEME_DECODING_MAP[phoneme.id];
  const blendWords = decodingSpec?.blendWords ?? [];
  const activeBlendWord = blendWords[wordIndex] ?? blendWords[0];

  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.playbackRate = slowMode ? 0.75 : 1.0;
    }
  }, [slowMode, phoneme.id]);

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

  const handleTriggerBlend = () => {
    if (!activeBlendWord) {
      return;
    }
    void resumeSharedAudioContext();
    const items = activeBlendWord.segments.map((seg) => {
      const targetMeta = PHONEME_MAP[seg.phonemeId];
      return {
        audioSrc: targetMeta ? targetMeta.localAudioSrc : phoneme.localAudioSrc,
        id: `blend-${seg.phonemeId}-${seg.letters}`,
      };
    });
    onPlayBlend(items, activeBlendWord.word, (step) => {
      setActiveSegmentIdx(step);
      if (step === items.length) {
        onBlendCompleted(phoneme.id);
      }
    });
  };

  const isPendingPhoneme = pendingKey === `phoneme:${phoneme.id}`;
  const isPlayingCurrentAudio = playingId === phoneme.id;

  const circledWordIndex = circleSlotFor(progress.representativeWord, phoneme.cardWords);
  const circleSlots = CARD_SLOT_DATA.cards[phoneme.id] ?? CARD_SLOT_DATA.fallback;
  const circleSlot = circledWordIndex >= 0 ? (circleSlots[circledWordIndex] ?? null) : null;

  return (
    <div className="dojo-stage-grid">
      {/* 左列：口型演示主视窗 + 精炼发声要领 */}
      <section className="lab-card dojo-mouth-card">
        <div className="lab-card-header">
          <div>
            <h3>看口型 · 记嘴形</h3>
            <span className="subtle-hint">先看清楚嘴唇和舌头怎么摆，再开声</span>
          </div>
          <div className="video-controls-inline">
            <button
              type="button"
              className={`pill-toggle-btn ${slowMode ? 'active' : ''}`}
              onClick={() => setSlowMode((prev) => !prev)}
            >
              {slowMode ? '0.75x 慢速口型' : '1.0x 原速口型'}
            </button>
            <button
              type="button"
              className={`pill-toggle-btn ${videoLoop ? 'active' : ''}`}
              onClick={() => setVideoLoop((prev) => !prev)}
              title="循环反复看口型"
            >
              <Repeat size={13} />
              <span>循环</span>
            </button>
          </div>
        </div>

        <div className="video-stage">
          <video
            key={phoneme.id}
            ref={videoRef}
            src={phoneme.localVideoSrc}
            poster={phoneme.posterSrc}
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
            <span>{isVideoPlaying ? '暂停口型' : '播放口型视频'}</span>
          </button>
          <button
            type="button"
            className={`primary-audio-btn compact ${
              isPlayingCurrentAudio && !isPendingPhoneme ? 'playing' : ''
            }`}
            onClick={() => onPlayPhoneme(phoneme.localAudioSrc, phoneme.id)}
          >
            <Volume2 size={15} />
            <span>
              {isPendingPhoneme
                ? '加载中...'
                : isPlayingCurrentAudio
                  ? '正在播放...'
                  : '只听纯标准音'}
            </span>
          </button>
        </div>

        <ul className="tips-list">
          {phoneme.pronunciationTips.map((tip) => (
            <li key={tip}>{tip}</li>
          ))}
        </ul>

        {phoneme.confusionNote && (
          <div className="confusion-alert">
            <AlertTriangle size={16} className="alert-icon" />
            <div className="confusion-content">
              <strong>避坑重点：</strong>
              <span>{phoneme.confusionNote}</span>
            </div>
          </div>
        )}
      </section>

      {/* 右列：字母规律解码 + 音素拼装滑块 + 折叠手绘记忆卡 */}
      <section className="lab-card dojo-blend-card">
        <div className="lab-card-header">
          <div>
            <h3>见词解码 · 音素拼装台</h3>
            <span className="subtle-hint">学会认字母规律 + 逐音拼出整词，见到生词自己也会读</span>
          </div>
          {progress.blendedCompleted && (
            <span className="stage-done-pill">
              <CheckCircle2 size={14} /> 已完成拼读
            </span>
          )}
        </div>

        {/* 常见字母组合规律密码 */}
        {decodingSpec && (
          <div className="spelling-patterns-box">
            <div className="patterns-title">
              <Layers size={14} />
              <span>拼写密码：看到哪些字母想到 {phoneme.symbol}</span>
            </div>
            <div className="patterns-row">
              {decodingSpec.patterns.map((pattern) => (
                <div key={pattern.grapheme} className="pattern-chip-card">
                  <div className="pattern-head">
                    <strong className="pattern-letters">{pattern.grapheme}</strong>
                    <span className="pattern-arrow">→ {phoneme.symbol}</span>
                  </div>
                  <p className="pattern-rule">{pattern.ruleHint}</p>
                  <div className="pattern-example-pills">
                    {pattern.examples.map((w) => {
                      const isPendingWord = pendingKey === `word:${w.trim().toLowerCase()}`;
                      const isSpeaking = speakingWord === w;
                      return (
                        <button
                          key={w}
                          type="button"
                          className={`mini-word-audio-pill ${isSpeaking ? 'speaking' : ''}`}
                          onClick={() => onSpeakWord(w)}
                        >
                          <Volume2 size={12} />
                          <span>{isPendingWord ? '加载中' : isSpeaking ? '朗读中' : w}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* 互动音素拼装滑块 */}
        {activeBlendWord && (
          <div className="blend-workbench">
            <div className="blend-word-switcher">
              <span className="blend-label">选一个词来拆音拼读：</span>
              <div className="blend-tabs">
                {blendWords.map((bw, idx) => (
                  <button
                    key={bw.word}
                    type="button"
                    className={`blend-tab-btn ${idx === wordIndex ? 'active' : ''}`}
                    onClick={() => {
                      setWordIndex(idx);
                      setActiveSegmentIdx(-1);
                    }}
                  >
                    <span>{bw.word}</span>
                    <small>{bw.phonetic}</small>
                  </button>
                ))}
              </div>
            </div>

            <div className="blend-segments-track" role="group" aria-label="音素拆解积木">
              {activeBlendWord.segments.map((seg, idx) => {
                const segPhoneme = PHONEME_MAP[seg.phonemeId];
                const isLit = activeSegmentIdx === idx;
                return (
                  <div key={`${seg.letters}-${idx}`} className="blend-segment-unit">
                    {idx > 0 && <span className="blend-plus">+</span>}
                    <button
                      type="button"
                      className={`segment-block ${seg.isTarget ? 'target-seg' : ''} ${
                        isLit ? 'active-lit' : ''
                      }`}
                      onClick={() => {
                        setActiveSegmentIdx(idx);
                        if (segPhoneme) {
                          onPlayPhoneme(segPhoneme.localAudioSrc, `seg-${segPhoneme.id}`);
                        }
                      }}
                      title={`点一下单听 ${seg.symbol}`}
                    >
                      <span className="seg-letters">{seg.letters}</span>
                      <span className="seg-symbol">{seg.symbol}</span>
                    </button>
                  </div>
                );
              })}

              <span className="blend-equals">=</span>

              <button
                type="button"
                className={`blend-result-word ${
                  activeSegmentIdx === activeBlendWord.segments.length ||
                  speakingWord === activeBlendWord.word
                    ? 'active-lit'
                    : ''
                }`}
                onClick={() => onSpeakWord(activeBlendWord.word)}
                title={`听整词 ${activeBlendWord.word}`}
              >
                <strong>{activeBlendWord.word}</strong>
                <span>
                  {activeBlendWord.phonetic} · {activeBlendWord.meaning}
                </span>
              </button>
            </div>

            <div className="blend-action-row">
              <button
                type="button"
                className="primary-audio-btn"
                onClick={handleTriggerBlend}
              >
                <Sparkles size={16} />
                <span>一键合体拼读（逐音 → 整词）</span>
              </button>
              <button type="button" className="secondary-btn" onClick={onNextStage}>
                <span>拼读懂了，去练开口纠音 →</span>
              </button>
            </div>
          </div>
        )}

        {/* 折叠式手绘记忆卡片与代表词备忘 */}
        <div className="memory-card-drawer">
          <button
            type="button"
            className="memory-card-toggle"
            onClick={() => setShowMemoryCard((prev) => !prev)}
            aria-expanded={showMemoryCard}
          >
            <span className="memory-toggle-left">
              <BookImage size={16} />
              <span>手绘记忆卡片 & 备忘代表词（与纸质实体卡同步）</span>
              {progress.representativeWord && (
                <em className="memory-picked-tag">已圈：{progress.representativeWord}</em>
              )}
            </span>
            {showMemoryCard ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
          </button>

          {showMemoryCard && (
            <div className="memory-card-body">
              <div className="illustrated-card-frame compact-frame">
                <div className="illustrated-card-inner">
                  <img
                    src={phoneme.cardSrc}
                    alt={`音标 ${phoneme.symbol} 手绘卡片`}
                    className="illustrated-card-img"
                    onClick={() => onPlayPhoneme(phoneme.localAudioSrc, phoneme.id)}
                  />
                  {circleSlot && (
                    <svg
                      className="card-circle-layer"
                      viewBox="0 0 1050 623"
                      preserveAspectRatio="none"
                      aria-hidden="true"
                      focusable="false"
                    >
                      <g className="card-circle-stroke">
                        <ellipse
                          cx={circleSlot.cx}
                          cy={circleSlot.cy}
                          rx={circleSlot.rx}
                          ry={circleSlot.ry}
                          transform={`rotate(-3 ${circleSlot.cx} ${circleSlot.cy})`}
                        />
                        <path
                          d={circleOvershootPath(circleSlot)}
                          transform={`rotate(-3 ${circleSlot.cx} ${circleSlot.cy})`}
                        />
                      </g>
                    </svg>
                  )}
                  {phoneme.cardWords.map((word, index) => {
                    const isSpeakingCardWord = speakingWord === word;
                    const isPendingCardWord = pendingKey === `word:${word.trim().toLowerCase()}`;
                    return (
                      <button
                        key={`${phoneme.id}-card-${word}`}
                        type="button"
                        className={`card-word-hotspot ${isSpeakingCardWord ? 'speaking' : ''} ${
                          isPendingCardWord ? 'pending' : ''
                        }`}
                        style={{ left: CARD_HOTSPOT_LEFT_POSITIONS[index] }}
                        onClick={() => onSpeakWord(word)}
                        aria-label={`朗读卡片单词 ${CARD_OPTION_LETTERS[index]} ${word}`}
                      >
                        <span className="hotspot-speaker-pill">
                          <Volume2 size={12} />
                          <span>
                            {isPendingCardWord ? '加载中' : isSpeakingCardWord ? '朗读中' : word}
                          </span>
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="memory-rep-row">
                <span className="memory-rep-hint">顺手圈一个最喜欢的联想代表词（仅作记忆标签）：</span>
                <div className="rep-choice-chips">
                  {phoneme.cardWords.map((word, idx) => {
                    const selected = progress.representativeWord === word;
                    return (
                      <button
                        key={word}
                        type="button"
                        className={`rep-chip ${selected ? 'active' : ''}`}
                        onClick={() => {
                          void resumeSharedAudioContext();
                          playSelectWordSfx();
                          onSelectRepresentativeWord(phoneme.id, selected ? '' : word);
                        }}
                      >
                        <span>
                          {CARD_OPTION_LETTERS[idx]}. {word}
                        </span>
                      </button>
                    );
                  })}
                  <button
                    type="button"
                    className="codename-custom-toggle"
                    onClick={() => setShowCustomWord((prev) => !prev)}
                  >
                    {showCustomWord ? '收起自写' : '自己写'}
                  </button>
                </div>

                {showCustomWord && (
                  <div className="custom-word-row">
                    <input
                      type="text"
                      className="custom-word-input"
                      placeholder="写一个方便记忆的词"
                      value={customWordInput}
                      onChange={(e) => setCustomWordInput(e.target.value)}
                    />
                    <button
                      type="button"
                      className="save-word-btn"
                      disabled={!customWordInput.trim()}
                      onClick={() => {
                        const w = customWordInput.trim();
                        if (!w) return;
                        playSelectWordSfx();
                        onSelectRepresentativeWord(phoneme.id, w);
                        setCustomWordInput('');
                        setShowCustomWord(false);
                      }}
                    >
                      记住
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
