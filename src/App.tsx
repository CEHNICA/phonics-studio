import { useCallback, useEffect, useMemo, useState } from 'react';
import { CardStudio } from './components/CardStudio';
import { ClassDashboard } from './components/ClassDashboard';
import { ConfusablePairsLab } from './components/ConfusablePairsLab';
import { FourteenDayPlan } from './components/FourteenDayPlan';
import { ListeningQuiz } from './components/ListeningQuiz';
import { TopHeader } from './components/TopHeader';
import { UserDataPanel } from './components/UserDataPanel';
import { CONFUSABLE_PAIRS, PHONEMES } from './data/phonics-catalog';
import { usePhonicsProgress } from './hooks/usePhonicsProgress';
import type { AppTab, StudyDayPlan } from './types/phonics';

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
        <FourteenDayPlan
          getPhonemeProgress={getPhonemeProgress}
          onStartDayStudy={handleStartDayStudy}
        />
      )}

      {activeTab === 'pairs' && (
        <ConfusablePairsLab
          key={initialPairId ?? 'default-pair'}
          initialPairId={initialPairId}
          onOpenInStudio={handleOpenInStudio}
        />
      )}

      {activeTab === 'quiz' && (
        <ListeningQuiz
          quizStats={progress.quizStats}
          weakPhonemeIds={weakPhonemeIds}
          onRecordAttempt={recordQuizAttempt}
          onJumpToStudio={handleOpenInStudio}
        />
      )}

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

      <ClassDashboard
        open={dashboardOpen && Boolean(session?.token)}
        token={session?.token ?? ''}
        onClose={() => setDashboardOpen(false)}
      />
    </div>
  );
}

export default App;
