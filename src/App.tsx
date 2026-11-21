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
import { detectCodeKind } from './services/backend/space-client';
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
  const [dashboardOwnerKey, setDashboardOwnerKey] = useState<string | null>(null);

  const {
    progress,
    summary,
    backendState,
    lastSyncedAt,
    favoriteIds,
    identity,
    identityError,
    identityBusy,
    getPhonemeProgress,
    setRepresentativeWord,
    toggleCompleted,
    recordQuizAttempt,
    toggleFavorite,
    isFavorite,
    resetAllProgress,
    syncNow,
    joinClass,
    recoverProgress,
    createClass,
    createPersonalSpace,
    leaveSpace,
  } = usePhonicsProgress();

  /**
   * 面板里那一个码输入框：按前缀分流（班级码 → 加入，PH- → 恢复，OW- → 看板）
   */
  const handleSubmitCode = useCallback(
    (code: string) => {
      if (detectCodeKind(code) === 'recovery') {
        void recoverProgress(code);
        return;
      }
      void joinClass(code);
    },
    [joinClass, recoverProgress],
  );

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
        identity={identity}
        identityError={identityError}
        identityBusy={identityBusy}
        onSelectPhoneme={handleOpenInStudio}
        onSyncNow={() => {
          void syncNow();
        }}
        onSubmitCode={handleSubmitCode}
        onCreateClass={(name) => {
          void createClass(name);
        }}
        onCreatePersonal={() => {
          void createPersonalSpace();
        }}
        onOpenDashboard={(ownerKey) => {
          setDashboardOwnerKey(ownerKey);
          setUserDataOpen(false);
        }}
        onLeaveSpace={leaveSpace}
      />

      <ClassDashboard
        open={Boolean(dashboardOwnerKey)}
        ownerKey={dashboardOwnerKey ?? ''}
        onClose={() => setDashboardOwnerKey(null)}
      />
    </div>
  );
}

export default App;
