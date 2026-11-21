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
  //
  // 关键约束（线上 3G 限速实测）：**预取绝不能和首屏资源抢带宽**。
  // 早期版本在 requestIdleCallback 里就开跑，结果预取的 76KB 分析模块把
  // 首屏卡片图从 1.5s 拖到 3.5s、视频拖到 8s——省下的时间全还回去了。
  // 现在改成两道闸：
  //   ① 弱网（effectiveType 2g/3g）直接不预取——弱网本来就抢不过；
  //   ② 其余情况等 window.load（首屏资源全部落地）后再预取。
  useEffect(() => {
    const conn = (
      navigator as Navigator & { connection?: { effectiveType?: string } }
    ).connection;
    const effectiveType = conn?.effectiveType;
    if (effectiveType && /^(slow-2g|2g|3g)$/.test(effectiveType)) {
      return;
    }

    let cancelled = false;
    const prefetch = () => {
      void import('./components/ListeningQuiz');
      void import('./components/FourteenDayPlan');
      void import('./components/ConfusablePairsLab');
      void import('./components/UserDataPanel');
      void import('./components/ClassDashboard');
      // 录音分析模块（含 63KB 模板表）：空闲时预抢，录音时就不用等
      void import('./utils/pronunciation-analyzer');
    };

    const start = () => {
      if (cancelled) return;
      const idleCb = window.requestIdleCallback?.bind(window);
      // load 之后还要再等一会：load 只等静态资源，卡片图 / 音频 / 视频
      // 这类媒体往往还在下载中，立刻预取照样会抢它们的带宽。
      const kick = () => {
        if (cancelled) return;
        if (idleCb) {
          idleCb(() => prefetch());
        } else {
          prefetch();
        }
      };
      window.setTimeout(kick, 2500);
    };

    if (document.readyState === 'complete') {
      start();
    } else {
      window.addEventListener('load', start, { once: true });
    }

    return () => {
      cancelled = true;
      window.removeEventListener('load', start);
    };
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
            getPhonemeProgress={getPhonemeProgress}
            onRecordAttempt={recordQuizAttempt}
            onJumpToStudio={handleOpenInStudio}
          />
        </Suspense>
      )}

      {/* 只有打开时才挂载：lazy 组件一旦被渲染就会去拉 chunk，
          条件渲染才能真正把它们踢出首屏 */}
      {userDataOpen && (
        <Suspense fallback={null}>
          <UserDataPanel
            open
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
      )}

      {dashboardOpen && Boolean(session?.token) && (
        <Suspense fallback={null}>
          <ClassDashboard
            open
            token={session?.token ?? ''}
            onClose={() => setDashboardOpen(false)}
          />
        </Suspense>
      )}

    </div>
  );
}

export default App;
