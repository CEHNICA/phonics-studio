import { useMemo, useState } from 'react';
import { CheckCircle2, ChevronDown, ChevronUp, Filter, Star } from 'lucide-react';
import { PHONEME_CATEGORIES, PHONEME_MAP } from '../data/phonics-catalog';
import { CONSOLIDATE_THRESHOLD } from '../utils/consolidation';
import type { PhonemeItem, PhonemeProgress } from '../types/phonics';

export type ProgressFilter = 'all' | 'unlearned' | 'review' | 'mastered' | 'favorite';

interface PhonemeSidebarProps {
  phonemes: PhonemeItem[];
  selectedCategory: string;
  onSelectCategory: (categoryId: string) => void;
  progressFilter: ProgressFilter;
  onSelectProgressFilter: (filter: ProgressFilter) => void;
  currentPhonemeId: string;
  onSelectPhoneme: (phonemeId: string) => void;
  getPhonemeProgress: (phonemeId: string) => PhonemeProgress;
  dayFilterIds: string[] | null;
  dayFilterLabel: string | null;
  onClearDayFilter: () => void;
  favoriteIds: string[];
}

const PROGRESS_FILTERS: Array<{ id: ProgressFilter; label: string }> = [
  { id: 'all', label: '全部' },
  { id: 'unlearned', label: '未学' },
  { id: 'review', label: '待巩固' },
  { id: 'mastered', label: '已掌握' },
  { id: 'favorite', label: '收藏' },
];

/**
 * 音标分类筛选与 48 音标快速索引面板（手机端自动折叠为顶部快选条 + 可展开抽屉）
 */
export function PhonemeSidebar({
  phonemes,
  selectedCategory,
  onSelectCategory,
  progressFilter,
  onSelectProgressFilter,
  currentPhonemeId,
  onSelectPhoneme,
  getPhonemeProgress,
  dayFilterIds,
  dayFilterLabel,
  onClearDayFilter,
  favoriteIds,
}: PhonemeSidebarProps) {
  const [mobileExpanded, setMobileExpanded] = useState<boolean>(false);
  const currentPhoneme = PHONEME_MAP[currentPhonemeId];
  const favoriteSet = useMemo(() => new Set(favoriteIds), [favoriteIds]);

  const handlePickPhoneme = (phonemeId: string) => {
    onSelectPhoneme(phonemeId);
    setMobileExpanded(false);
  };

  return (
    <aside className={`phoneme-sidebar ${mobileExpanded ? 'mobile-expanded' : ''}`}>
      {/* 手机/平板端顶部折叠切换栏 */}
      <div className="mobile-sidebar-header">
        <button
          type="button"
          className="mobile-sidebar-toggle"
          onClick={() => setMobileExpanded((prev) => !prev)}
          aria-expanded={mobileExpanded}
        >
          <span className="mobile-toggle-summary">
            <strong>切换音标</strong>
            {currentPhoneme && (
              <span className="mobile-current-pill">
                #{String(currentPhoneme.order).padStart(2, '0')} {currentPhoneme.symbol}
              </span>
            )}
            <span className="mobile-count-text">({phonemes.length}音)</span>
          </span>
          <span className="mobile-toggle-action">
            <span>{mobileExpanded ? '收起' : '筛选/展开'}</span>
            {mobileExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
          </span>
        </button>

        {/* 折叠态下的单行横向快滑选音条 */}
        {!mobileExpanded && phonemes.length > 0 && (
          <div className="mobile-quick-strip" role="list" aria-label="横向快选音标">
            {phonemes.map((item) => {
              const isSelected = item.id === currentPhonemeId;
              const record = getPhonemeProgress(item.id);
              return (
                <button
                  key={`strip-${item.id}`}
                  type="button"
                  className={`quick-strip-pill ${isSelected ? 'selected' : ''}`}
                  onClick={() => handlePickPhoneme(item.id)}
                >
                  <span>{item.symbol}</span>
                  {record.completed && (
                    <CheckCircle2 size={11} className="strip-check" />
                  )}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {dayFilterIds && dayFilterLabel && (
        <div className="day-filter-banner">
          <div>
            <strong>{dayFilterLabel}</strong>
            <span>共 {dayFilterIds.length} 个今日目标音标</span>
          </div>
          <button type="button" className="chip-clear-btn" onClick={onClearDayFilter}>
            查看全部 48 音
          </button>
        </div>
      )}

      <div className={`sidebar-collapsible-body ${mobileExpanded ? 'open' : ''}`}>
        {!dayFilterIds && (
          <>
            <div className="sidebar-section">
              <div className="sidebar-heading">
                <span>音标分类</span>
                <span className="count-badge">{phonemes.length} 音</span>
              </div>
              <div className="category-pills">
                <button
                  type="button"
                  className={`category-pill ${selectedCategory === 'all' ? 'active' : ''}`}
                  onClick={() => onSelectCategory('all')}
                >
                  全部 48
                </button>
                {PHONEME_CATEGORIES.map((category) => (
                  <button
                    key={category.id}
                    type="button"
                    className={`category-pill ${selectedCategory === category.id ? 'active' : ''}`}
                    onClick={() => onSelectCategory(category.id)}
                    title={category.description}
                  >
                    {category.title}
                  </button>
                ))}
              </div>
            </div>

            <div className="sidebar-section">
              <div className="sidebar-heading">
                <span className="filter-title">
                  <Filter size={13} /> 掌握状态
                </span>
              </div>
              <div className="progress-filter-row">
                {PROGRESS_FILTERS.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className={`mini-filter-btn ${progressFilter === item.id ? 'active' : ''}`}
                    onClick={() => onSelectProgressFilter(item.id)}
                  >
                    {item.label}
                    {item.id === 'favorite' && favoriteIds.length > 0 ? ` ${favoriteIds.length}` : ''}
                  </button>
                ))}
              </div>
            </div>
          </>
        )}

        <div className="phoneme-grid" role="list" aria-label="音标列表">
          {phonemes.length === 0 ? (
            <div className="empty-sidebar-tip">当前筛选条件下没有音标哦，试试切换“全部”。</div>
          ) : (
            phonemes.map((item) => {
              const record = getPhonemeProgress(item.id);
              const isSelected = item.id === currentPhonemeId;
              return (
                <button
                  key={item.id}
                  type="button"
                  className={`phoneme-tile ${isSelected ? 'selected' : ''} ${
                    record.completed ? 'completed' : ''
                  }`}
                  onClick={() => handlePickPhoneme(item.id)}
                >
                  <span className="tile-order">{String(item.order).padStart(2, '0')}</span>
                  <span className="tile-symbol">{item.symbol}</span>
                  <span className="tile-meta">
                    {favoriteSet.has(item.id) && (
                      <span title="已收藏">
                        <Star size={11} className="tile-star" fill="currentColor" />
                      </span>
                    )}
                    {record.mistakeCount > 0 ? (
                      <span
                        className="tile-dot review-dot"
                        title={`待巩固 · 连续答对 ${CONSOLIDATE_THRESHOLD} 次自动移出（已连对 ${record.consecutiveCorrect}/${CONSOLIDATE_THRESHOLD}）`}
                      />
                    ) : record.completed ? (
                      <span title="已掌握">
                        <CheckCircle2 size={12} className="tile-check" />
                      </span>
                    ) : (
                      <span className="tile-dot" />
                    )}
                  </span>
                </button>
              );
            })
          )}
        </div>
      </div>
    </aside>
  );
}
