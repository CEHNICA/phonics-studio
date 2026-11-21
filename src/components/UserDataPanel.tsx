import { useMemo, useState } from 'react';
import { CloudOff, Copy, RefreshCw, Star, X } from 'lucide-react';
import { PHONEME_MAP } from '../data/phonics-catalog';
import type { BackendState } from '../services/backend/types';
import { detectCodeKind, formatJoinCode } from '../services/backend/space-client';
import type { SpaceIdentity } from '../services/backend/space-client';
import type { QuizAttempt } from '../types/phonics';

interface UserDataPanelProps {
  open: boolean;
  onClose: () => void;
  favoriteIds: string[];
  attempts: QuizAttempt[];
  backendState: BackendState;
  lastSyncedAt: string | null;
  identity: SpaceIdentity | null;
  identityError: string | null;
  identityBusy: boolean;
  onSelectPhoneme: (phonemeId: string) => void;
  onSyncNow: () => void;
  /** 面板里那个唯一的码输入框：按前缀自动分流（加入 / 恢复 / 看板） */
  onSubmitCode: (code: string) => void;
  onCreateClass: (name: string) => void;
  onCreatePersonal: () => void;
  onOpenDashboard: (ownerKey: string) => void;
  /** 退出当前空间，回到仅本机模式（云端数据保留） */
  onLeaveSpace: () => void;
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
 * 我的数据面板：收藏夹 + 最近答题记录 + 云同步 / 班级身份
 *
 * 身份区只有「一个输入框 + 一个主按钮」：粘贴班级码加入班级，粘贴恢复密钥恢复进度，
 * 粘贴管理码打开班级看板——按前缀自动分流，不额外堆输入框。
 */
export function UserDataPanel({
  open,
  onClose,
  favoriteIds,
  attempts,
  backendState,
  lastSyncedAt,
  identity,
  identityError,
  identityBusy,
  onSelectPhoneme,
  onSyncNow,
  onSubmitCode,
  onCreateClass,
  onCreatePersonal,
  onOpenDashboard,
  onLeaveSpace,
}: UserDataPanelProps) {
  const [codeInput, setCodeInput] = useState<string>('');
  const [viewCode, setViewCode] = useState<{ title: string; value: string } | null>(null);
  const [className, setClassName] = useState<string>('');
  const [creatingClass, setCreatingClass] = useState<boolean>(false);

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

  const codeKind = detectCodeKind(codeInput);
  const actionLabel =
    codeKind === 'recovery' ? '恢复进度' : codeKind === 'owner' ? '打开看板' : '加入班级';

  const handleSubmitCode = () => {
    const value = codeInput.trim();
    if (!value) {
      return;
    }
    if (detectCodeKind(value) === 'owner') {
      onOpenDashboard(value.toUpperCase());
      return;
    }
    onSubmitCode(value);
  };

  const handleCopy = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      // 剪贴板不可用时，用户可以直接选中只读框里的文字复制
    }
  };

  const handleCreateClass = () => {
    const name = className.trim() || '我的班级';
    onCreateClass(name);
    setCreatingClass(false);
    setClassName('');
  };

  const isOwner = identity?.role === 'owner';

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

          <p className="user-data-sync-state">
            {identity
              ? `已加入「${identity.spaceName || '未命名班级'}」 · ${STATE_TEXT[backendState]}`
              : '仅保存在本机 — 尚未加入班级'}
          </p>
          {lastSyncedAt && identity && (
            <p className="user-data-sync-time">最近同步：{formatAttemptTime(lastSyncedAt)}</p>
          )}

          <label className="user-data-code-label" htmlFor="sync-code-input">
            粘贴班级码加入班级，或粘贴恢复密钥找回进度
          </label>
          <div className="user-data-code-row">
            <input
              id="sync-code-input"
              type="text"
              className="user-data-code-input"
              placeholder="班级码 / PH- 恢复密钥 / OW- 管理码"
              value={codeInput}
              onChange={(event) => setCodeInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  handleSubmitCode();
                }
              }}
            />
            <button
              type="button"
              className="user-data-code-btn"
              disabled={identityBusy}
              onClick={handleSubmitCode}
            >
              {identityBusy ? '处理中…' : actionLabel}
            </button>
          </div>

          {identityError && <p className="user-data-code-error">{identityError}</p>}

          <div className="user-data-action-row">
            <button
              type="button"
              className="user-data-sync-btn"
              disabled={!identity}
              onClick={onSyncNow}
            >
              立即同步
            </button>
            {!identity && (
              <button
                type="button"
                className="user-data-ghost-btn"
                disabled={identityBusy}
                onClick={onCreatePersonal}
              >
                创建我的恢复码
              </button>
            )}
            <button
              type="button"
              className="user-data-ghost-btn"
              disabled={identityBusy}
              onClick={() => setCreatingClass(true)}
            >
              创建班级
            </button>
          </div>

          <div className="user-data-divider" />

          <div className="user-data-code-list">
            {isOwner && identity?.joinCode && (
              <div className="user-data-code-row-item">
                <span className="user-data-code-name">班级码</span>
                <button
                  type="button"
                  className="user-data-link-btn"
                  onClick={() =>
                    setViewCode({
                      title: '班级码（发给学生，他们输入即可加入）',
                      value: formatJoinCode(identity.joinCode as string),
                    })
                  }
                >
                  查看
                </button>
              </div>
            )}
            <div className="user-data-code-row-item">
              <span className="user-data-code-name">我的恢复码</span>
              <button
                type="button"
                className="user-data-link-btn"
                disabled={!identity}
                onClick={() =>
                  setViewCode({ title: '我的恢复码（换设备时用）', value: identity?.recoveryKey ?? '' })
                }
              >
                查看
              </button>
            </div>
            {isOwner && (
              <div className="user-data-code-row-item">
                <span className="user-data-code-name">管理码</span>
                <button
                  type="button"
                  className="user-data-link-btn"
                  onClick={() =>
                    setViewCode({ title: '管理码（只有你能看班级看板）', value: identity?.ownerKey ?? '' })
                  }
                >
                  查看
                </button>
              </div>
            )}
          </div>

          {isOwner && identity?.ownerKey && (
            <button
              type="button"
              className="user-data-primary-btn"
              onClick={() => onOpenDashboard(identity.ownerKey as string)}
            >
              打开班级看板
            </button>
          )}

          {identity && (
            <button
              type="button"
              className="user-data-text-btn"
              onClick={() => {
                if (window.confirm('退出后回到「仅保存在本机」，云端数据会保留，需要时可再用恢复密钥找回。')) {
                  onLeaveSpace();
                }
              }}
            >
              退出这个空间
            </button>
          )}
        </section>
      </aside>

      {viewCode && (
        <div className="user-data-modal-backdrop" onClick={() => setViewCode(null)}>
          <div className="user-data-modal" onClick={(event) => event.stopPropagation()}>
            <h4>{viewCode.title}</h4>
            <input
              className="user-data-code-input"
              readOnly
              value={viewCode.value}
              onFocus={(event) => event.currentTarget.select()}
            />
            <p className="user-data-modal-tip">请自己收好，丢了只能重新建班级。</p>
            <div className="user-data-modal-actions">
              <button
                type="button"
                className="user-data-ghost-btn"
                onClick={() => void handleCopy(viewCode.value)}
              >
                <Copy size={14} />
                复制
              </button>
              <button
                type="button"
                className="user-data-primary-btn"
                onClick={() => setViewCode(null)}
              >
                知道了
              </button>
            </div>
          </div>
        </div>
      )}

      {creatingClass && (
        <div className="user-data-modal-backdrop" onClick={() => setCreatingClass(false)}>
          <div className="user-data-modal" onClick={(event) => event.stopPropagation()}>
            <h4>创建班级</h4>
            <input
              className="user-data-code-input"
              autoFocus
              placeholder="班级名称，例如 初二(3)班"
              value={className}
              onChange={(event) => setClassName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  handleCreateClass();
                }
              }}
            />
            <p className="user-data-modal-tip">创建后会拿到班级码（发给学生）和管理码（你自己留着）。</p>
            <div className="user-data-modal-actions">
              <button
                type="button"
                className="user-data-ghost-btn"
                onClick={() => setCreatingClass(false)}
              >
                取消
              </button>
              <button type="button" className="user-data-primary-btn" onClick={handleCreateClass}>
                创建
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
