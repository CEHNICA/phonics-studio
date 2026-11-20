import { useMemo, useState } from 'react';
import { CloudOff, RefreshCw, Star, X } from 'lucide-react';
import { PHONEME_MAP } from '../data/phonics-catalog';
import type { BackendState } from '../services/backend/types';
import type { QuizAttempt } from '../types/phonics';

interface UserDataPanelProps {
  open: boolean;
  onClose: () => void;
  favoriteIds: string[];
  attempts: QuizAttempt[];
  backendState: BackendState;
  lastSyncedAt: string | null;
  syncCode: string | null;
  onSelectPhoneme: (phonemeId: string) => void;
  onSyncNow: () => void;
  onApplySyncCode: (code: string) => void;
}

const STATE_TEXT: Record<BackendState, string> = {
  local: '仅保存在本机',
  connecting: '正在同步…',
  synced: '已同步到云端',
  offline: '云端连不上，先用本机数据',
  error: '同步失败，稍后自动重试',
};

function formatAttemptTime(iso: string): string {
  const parsed = Date.parse(iso);
  if (Number.isNaN(parsed)) {
    return '';
  }
  const date = new Date(parsed);
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hour = String(date.getHours()).padStart(2, '0');
  const minute = String(date.getMinutes()).padStart(2, '0');
  return `${month}-${day} ${hour}:${minute}`;
}

/**
 * 我的数据面板：收藏夹 + 最近答题记录 + 云同步设置
 */
export function UserDataPanel({
  open,
  onClose,
  favoriteIds,
  attempts,
  backendState,
  lastSyncedAt,
  syncCode,
  onSelectPhoneme,
  onSyncNow,
  onApplySyncCode,
}: UserDataPanelProps) {
  const [codeInput, setCodeInput] = useState<string>(syncCode ?? '');

  const favorites = useMemo(
    () =>
      favoriteIds
        .map((id) => PHONEME_MAP[id])
        .filter((item): item is NonNullable<typeof item> => Boolean(item))
        .sort((a, b) => a.order - b.order),
    [favoriteIds],
  );

  const recentAttempts = useMemo(() => attempts.slice(0, 10), [attempts]);

  if (!open) {
    return null;
  }

  return (
    <>
      <div className="user-data-backdrop" onClick={onClose} />
      <aside className="user-data-panel" role="dialog" aria-label="我的数据">
        <div className="user-data-header">
          <h3>我的数据</h3>
          <button type="button" className="user-data-close" onClick={onClose} title="关闭">
            <X size={17} />
          </button>
        </div>

        <section className="user-data-section">
          <div className="user-data-section-title">
            <Star size={14} />
            <span>收藏夹</span>
            <em>{favorites.length}</em>
          </div>
          {favorites.length === 0 ? (
            <p className="user-data-empty">还没有收藏，在卡片页点星标就能收进来。</p>
          ) : (
            <ul className="favorite-chip-list">
              {favorites.map((item) => (
                <li key={item.id}>
                  <button
                    type="button"
                    className="favorite-chip"
                    onClick={() => {
                      onSelectPhoneme(item.id);
                      onClose();
                    }}
                  >
                    <span className="favorite-chip-order">#{String(item.order).padStart(2, '0')}</span>
                    <span className="favorite-chip-symbol">{item.symbol}</span>
                    <span className="favorite-chip-title">{item.categoryTitle}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="user-data-section">
          <div className="user-data-section-title">
            <span>最近答题</span>
            <em>{attempts.length}</em>
          </div>
          {recentAttempts.length === 0 ? (
            <p className="user-data-empty">还没有答题记录，去「听音闯关赛」试试。</p>
          ) : (
            <ul className="attempt-list">
              {recentAttempts.map((attempt) => {
                const item = PHONEME_MAP[attempt.phonemeId];
                return (
                  <li key={attempt.id} className={attempt.correct ? 'attempt-correct' : 'attempt-wrong'}>
                    <span className="attempt-symbol">{item?.symbol ?? attempt.phonemeId}</span>
                    <span className="attempt-result">{attempt.correct ? '答对' : '答错'}</span>
                    <span className="attempt-time">{formatAttemptTime(attempt.at)}</span>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section className="user-data-section">
          <div className="user-data-section-title">
            {backendState === 'offline' || backendState === 'error' ? (
              <CloudOff size={14} />
            ) : (
              <RefreshCw size={14} />
            )}
            <span>云同步</span>
          </div>
          <p className="user-data-sync-state">{STATE_TEXT[backendState]}</p>
          {lastSyncedAt && (
            <p className="user-data-sync-time">最近同步：{formatAttemptTime(lastSyncedAt)}</p>
          )}

          <label className="user-data-code-label" htmlFor="sync-code-input">
            同步码（换设备时输入同一串即可恢复进度）
          </label>
          <div className="user-data-code-row">
            <input
              id="sync-code-input"
              type="text"
              className="user-data-code-input"
              placeholder="至少 8 位，不填则仅本机保存"
              value={codeInput}
              onChange={(event) => setCodeInput(event.target.value)}
            />
            <button
              type="button"
              className="user-data-code-btn"
              onClick={() => onApplySyncCode(codeInput.trim())}
            >
              保存
            </button>
          </div>
          <button type="button" className="user-data-sync-btn" onClick={onSyncNow}>
            立即同步
          </button>
        </section>
      </aside>
    </>
  );
}
