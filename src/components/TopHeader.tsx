import { BookOpen, CalendarDays, Gamepad2, GitCompare, RotateCcw, Sparkles } from 'lucide-react';
import { CONSOLIDATE_THRESHOLD } from '../utils/consolidation';
import type { AppTab } from '../types/phonics';

interface TopHeaderProps {
  activeTab: AppTab;
  onSelectTab: (tab: AppTab) => void;
  completedCount: number;
  needReviewCount: number;
  totalCount: number;
  checkedDaysCount: number;
  onResetProgress: () => void;
}

const NAV_ITEMS: Array<{ id: AppTab; label: string; shortLabel: string; icon: typeof BookOpen }> = [
  { id: 'studio', label: '音标卡片馆', shortLabel: '卡片馆', icon: BookOpen },
  { id: 'plan', label: '14天打卡路线', shortLabel: '14天计划', icon: CalendarDays },
  { id: 'pairs', label: '双胞胎易混屋', shortLabel: '易混屋', icon: GitCompare },
  { id: 'quiz', label: '听音闯关赛', shortLabel: '闯关赛', icon: Gamepad2 },
];

/**
 * 顶部导航与学习总进度栏
 */
export function TopHeader({
  activeTab,
  onSelectTab,
  completedCount,
  needReviewCount,
  totalCount,
  checkedDaysCount,
  onResetProgress,
}: TopHeaderProps) {
  const progressPercent = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0;

  return (
    <header className="top-header">
      <div className="top-header-inner">
        <div className="brand-block">
          <div className="brand-badge">
            <Sparkles size={18} />
            <span>初一音标进阶 · 48 音素</span>
          </div>
          <h1 className="brand-title">手绘音标小铺</h1>
        </div>

        <nav className="nav-tabs" aria-label="学习模块切换">
          {NAV_ITEMS.map(({ id, label, shortLabel, icon: Icon }) => {
            const isActive = activeTab === id;
            return (
              <button
                key={id}
                type="button"
                className={`nav-tab-btn ${isActive ? 'active' : ''}`}
                onClick={() => onSelectTab(id)}
              >
                <Icon size={17} />
                <span className="nav-label-full">{label}</span>
                <span className="nav-label-short">{shortLabel}</span>
              </button>
            );
          })}
        </nav>

        <div className="header-stats">
          <div className="stat-pill" title="已学习音标进度">
            <span className="stat-label">已学</span>
            <strong>
              {completedCount}/{totalCount}
            </strong>
            <div className="mini-progress-track">
              <div className="mini-progress-fill" style={{ width: `${progressPercent}%` }} />
            </div>
          </div>

          <div
            className="stat-pill stat-hide-mobile"
            title={`测验中答错过的音标，连续答对 ${CONSOLIDATE_THRESHOLD} 次后自动移出待巩固`}
          >
            <span className="stat-label">待巩固</span>
            <strong>{needReviewCount} 音</strong>
          </div>

          <div className="stat-pill" title="累计学习天数">
            <span className="stat-label">打卡</span>
            <strong>{checkedDaysCount} 天</strong>
          </div>

          <button
            type="button"
            className="reset-btn"
            title="重置本地学习记录"
            onClick={() => {
              if (window.confirm('确定要清空当前的代表词、已学标记和闯关记录吗？')) {
                onResetProgress();
              }
            }}
          >
            <RotateCcw size={15} />
          </button>
        </div>
      </div>
    </header>
  );
}
