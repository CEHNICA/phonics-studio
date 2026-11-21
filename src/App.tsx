import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { CardStudio } from './components/CardStudio';
import { TopHeader } from './components/TopHeader';
import { CONFUSABLE_PAIRS, PHONEMES } from './data/phonics-catalog';
import { usePhonicsProgress } from './hooks/usePhonicsProgress';
import type { AppTab, StudyDayPlan } from './types/phonics';

/**
 * 非首屏组件全部走动态 import。
 *
 * 背景：线上实测阿里 CDN 对 .js **不启用 gzip/br**（HTML/CSS 会压，JS 不会），
 * 所以产物体积就是真实下载量，3G 下单个 416KB 的 JS 要下 8.8 秒。
 * 首屏只需要 studio 这一个 tab，其余全部拆出去按需加载。
 */
const FourteenDayPlan = lazy(() =>
  import('./components/FourteenDayPlan').then((m) => ({ default: m.FourteenDayPlan })),
);
const ConfusablePairsLab = lazy(() =>
  import('./components/ConfusablePairsLab').then((m) => ({ default: m.ConfusablePairsLab })),
);
const ListeningQuiz = lazy(() =>
  import('./components/ListeningQuiz').then((m) => ({ default: m.ListeningQuiz })),
);
const UserDataPanel = lazy(() =>
  import('./components/UserDataPanel').then((m) => ({ default: m.UserDataPanel })),
);
const ClassDashboard = lazy(() =>
  import('./components/ClassDashboard').then((m) => ({ default: m.ClassDashboard })),
);

/** 懒加载占位：保持页面高度稳定，避免切 tab 时布局跳动 */
function PanelFallback({ label }: { label: string }) {
  return (
    <div className="lazy-panel-fallback" role="status" aria-live="polite">
      <span className="lazy-spinner" aria-hidden="true" />
      <span>{label}</span>
    </div>
  );
}


/**
 * 48 音标互动学习主应用
 */
export function App() {
  const [activeTab, setActiveTab] = useState<AppTab>('studio');
  const [currentPhonemeId, setCurrentPhonemeId] = useState<string>(PHONEMES[0].id);
  const [dayFilterIds, setDayFilterIds] = useState<string[] | null>(null);
  const [dayFilterLabel, setDayFilterLabel] = useState<string | null>(null);
  const [initialPairId, setInitialPairId] = useState<string | undefined>(undefined);
  const [userDataOpen, setUserDataOpen] = useState<boolean>(false);
  const [dashboardOpen, setDashboardOpen] = useState<boolean>(false);

  const {
    progress,
    summary,
    backendState,
    lastSyncedAt,
    favoriteIds,
    session,
    membership,
    authError,
    authBusy,
    getPhonemeProgress,
    setRepresentativeWord,
    toggleCompleted,
    recordQuizAttempt,
    toggleFavorite,
    isFavorite,
    resetAllProgress,
    syncNow,
    register,
    login,
    logout,
    changePassword,
    joinClass,
    createClass,
    leaveClass,
  } = usePhonicsProgress();

  const handleOpenInStudio = useCallback((phonemeId: string) => {
    setDayFilterIds(null);
    setDayFilterLabel(null);
    setCurrentPhonemeId(phonemeId);
    setActiveTab('studio');
  }, []);

  const handleStartDayStudy = useCallback((dayPlan: StudyDayPlan, targetPhonemeId?: string) => {
    setDayFilterIds(dayPlan.phonemeIds);
    setDayFilterLabel(`Day ${dayPlan.day} · ${dayPlan.title}`);
    setCurrentPhonemeId(targetPhonemeId ?? dayPlan.phonemeIds[0]);
    setActiveTab('studio');
  }, []);

  const handleJumpToPair = useCallback(
    (relatedPhonemeId: string) => {
      const matched = CONFUSABLE_PAIRS.find(
        (pair) =>
          (pair.leftId === currentPhonemeId && pair.rightId === relatedPhonemeId) ||
          (pair.rightId === currentPhonemeId && pair.leftId === relatedPhonemeId),
      );
      if (matched) {
        setInitialPairId(matched.id);
      }
      setActiveTab('pairs');
    },
    [currentPhonemeId],
  );

  const handleClearDayFilter = useCallback(() => {
    setDayFilterIds(null);
    setDayFilterLabel(null);
  }, []);

  const weakPhonemeIds = useMemo(() => {
    return PHONEMES.filter((item) => {
      const record = progress.phonemes[item.id];
      return Boolean(record && record.mistakeCount > 0);
    }).map((item) => item.id);
  }, [progress.phonemes]);

  // 切换主标签页时回到页面顶部，避免保留上一页的滚动位置
  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [activeTab]);

  // 空闲时预取其余 tab 的 chunk：切标签时几乎瞬开，同时不与首屏争抢带宽
  useEffect(() => {
    const idleCb = window.requestIdleCallback?.bind(window);
    const run = () => {
      void import('./components/ListeningQuiz');
      void import('./components/FourteenDayPlan');
      void import('./components/ConfusablePairsLab');
      void import('./components/UserDataPanel');
      void import('./components/ClassDashboard');
      // 录音分析模块（含 63KB 模板表）：空闲时预抢，录音时就不用等
      void import('./utils/pronunciation-analyzer');
    };
    if (idleCb) {
      const handle = idleCb(() => run());
      return () => window.cancelIdleCallback?.(handle);
    }
    const timer = window.setTimeout(run, 1200);
    return () => window.clearTimeout(timer);
  }, []);

  return (
    <div className="app-shell">
      <TopHeader
        activeTab={activeTab}
        onSelectTab={setActiveTab}
        completedCount={summary.completedCount}
        needReviewCount={summary.needReviewCount}
        totalCount={summary.totalCount}
        checkedDaysCount={summary.checkedDaysCount}
        onResetProgress={resetAllProgress}
        favoriteCount={summary.favoriteCount}
        backendState={backendState}
        onOpenUserData={() => setUserDataOpen(true)}
      />

      {activeTab === 'studio' && (
        <CardStudio
          currentPhonemeId={currentPhonemeId}
          onSelectPhoneme={setCurrentPhonemeId}
          getPhonemeProgress={getPhonemeProgress}
          onSetRepresentativeWord={setRepresentativeWord}
          onToggleCompleted={toggleCompleted}
          dayFilterIds={dayFilterIds}
          dayFilterLabel={dayFilterLabel}
          onClearDayFilter={handleClearDayFilter}
          onJumpToPair={handleJumpToPair}
          favoriteIds={favoriteIds}
          onToggleFavorite={toggleFavorite}
          isFavorite={isFavorite}
        />
      )}

      {activeTab === 'plan' && (
        <Suspense fallback={<PanelFallback label="正在加载 14 天计划…" />}>
          <FourteenDayPlan
            getPhonemeProgress={getPhonemeProgress}
            onStartDayStudy={handleStartDayStudy}
          />
        </Suspense>
      )}

      {activeTab === 'pairs' && (
        <Suspense fallback={<PanelFallback label="正在加载易混音标实验室…" />}>
          <ConfusablePairsLab
            key={initialPairId ?? 'default-pair'}
            initialPairId={initialPairId}
            onOpenInStudio={handleOpenInStudio}
          />
        </Suspense>
      )}

      {activeTab === 'quiz' && (
        <Suspense fallback={<PanelFallback label="正在加载听音测验…" />}>
          <ListeningQuiz
            quizStats={progress.quizStats}
            weakPhonemeIds={weakPhonemeIds}
            onRecordAttempt={recordQuizAttempt}
            onJumpToStudio={handleOpenInStudio}
          />
        </Suspense>
      )}

      <Suspense fallback={null}>
        <UserDataPanel
          open={userDataOpen}
          onClose={() => setUserDataOpen(false)}
          favoriteIds={favoriteIds}
          attempts={progress.attempts}
          backendState={backendState}
          lastSyncedAt={lastSyncedAt}
          session={session}
          membership={membership}
          authError={authError}
          authBusy={authBusy}
          onSelectPhoneme={handleOpenInStudio}
          onSyncNow={() => {
            void syncNow();
          }}
          onRegister={(username, password, displayName) => {
            void register(username, password, displayName);
          }}
          onLogin={(username, password) => {
            void login(username, password);
          }}
          onLogout={() => {
            void logout();
          }}
          onChangePassword={(oldPassword, newPassword) => {
            void changePassword(oldPassword, newPassword);
          }}
          onJoinClass={(code) => {
            void joinClass(code);
          }}
          onCreateClass={(name) => {
            void createClass(name);
          }}
          onLeaveClass={() => {
            void leaveClass();
          }}
          onOpenDashboard={() => {
            setDashboardOpen(true);
            setUserDataOpen(false);
          }}
        />
      </Suspense>

      <Suspense fallback={null}>
        <ClassDashboard
          open={dashboardOpen && Boolean(session?.token)}
          token={session?.token ?? ''}
          onClose={() => setDashboardOpen(false)}
        />
      </Suspense>

    </div>
  );
}

export default App;
