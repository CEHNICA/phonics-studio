import { useMemo, useState } from 'react';
import { CloudOff, Copy, LogOut, RefreshCw, Star, UserPlus, X } from 'lucide-react';
import { PHONEME_MAP } from '../data/phonics-catalog';
import type { BackendState, Membership } from '../services/backend/types';
import type { AccountKind } from '../services/backend/types';
import type { AccountSession } from '../services/backend/account-session';
import { formatJoinCode } from '../services/backend/account-client';
import type { QuizAttempt } from '../types/phonics';

interface UserDataPanelProps {
  open: boolean;
  onClose: () => void;
  favoriteIds: string[];
  attempts: QuizAttempt[];
  backendState: BackendState;
  lastSyncedAt: string | null;
  /** 当前会话；null = 未登录 */
  session: AccountSession | null;
  /** 当前账号的班级状态 */
  membership: Membership | null;
  authError: string | null;
  authBusy: boolean;
  onSelectPhoneme: (phonemeId: string) => void;
  onSyncNow: () => void;
  onRegister: (
    username: string,
    password: string,
    displayName: string,
    role: AccountKind,
    teacherCode?: string,
  ) => void;
  onLogin: (username: string, password: string) => void;
  onLogout: () => void;
  onChangePassword: (oldPassword: string, newPassword: string) => void;
  onJoinClass: (code: string) => void;
  onCreateClass: (name: string) => void;
  onLeaveClass: () => void;
  onOpenDashboard: () => void;
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
 * 我的数据面板：收藏夹 + 最近答题记录 + 账号
 *
 * 账号区只有「用户名 + 密码」两样东西：
 * - 没登录：一个表单，登录 / 注册切换；
 * - 登录了：显示账号名和班级状态，老师多一个「班级码」和一个「打开看板」；
 * - 旧的恢复码、管理码、设备密钥全部删除，没有第二个入口。
 */
export function UserDataPanel({
  open,
  onClose,
  favoriteIds,
  attempts,
  backendState,
  lastSyncedAt,
  session,
  membership,
  authError,
  authBusy,
  onSelectPhoneme,
  onSyncNow,
  onRegister,
  onLogin,
  onLogout,
  onChangePassword,
  onJoinClass,
  onCreateClass,
  onLeaveClass,
  onOpenDashboard,
}: UserDataPanelProps) {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [username, setUsername] = useState<string>('');
  const [password, setPassword] = useState<string>('');
  const [displayName, setDisplayName] = useState<string>('');
  const [regRole, setRegRole] = useState<AccountKind>('student');
  const [teacherCode, setTeacherCode] = useState<string>('');
  const [formError, setFormError] = useState<string | null>(null);
  const [joinCodeInput, setJoinCodeInput] = useState<string>('');
  const [className, setClassName] = useState<string>('');
  const [creatingClass, setCreatingClass] = useState<boolean>(false);
  const [changingPassword, setChangingPassword] = useState<boolean>(false);
  const [oldPassword, setOldPassword] = useState<string>('');
  const [newPassword, setNewPassword] = useState<string>('');
  const [copied, setCopied] = useState<boolean>(false);

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

  const isOwner = membership?.role === 'owner' && !membership?.revoked;
  /** 账号身份：老师能建班，学生只能拿班级码加入 */
  const isTeacher = session?.account.role === 'teacher';
  /** 被移出 / 班级被撤销时视为「不在班里」，可以重新输班级码 */
  const inClass = Boolean(membership && !membership.revoked && !membership.spaceRevoked);
  const classNotice = membership?.spaceRevoked
    ? '这个班级已被老师撤销了'
    : membership?.revoked
      ? '你已被移出这个班级，可以换一个班级码重新加入'
      : null;

  const handleAuthSubmit = () => {
    if (!username.trim() || !password) {
      return;
    }
    if (mode === 'register') {
      if (regRole === 'teacher' && !teacherCode.trim()) {
        setFormError('注册老师账号要填教师邀请码');
        return;
      }
      setFormError(null);
      onRegister(username, password, displayName, regRole, teacherCode.trim() || undefined);
    } else {
      setFormError(null);
      onLogin(username, password);
    }
  };

  const handleCopyJoinCode = async () => {
    if (!membership?.joinCode) {
      return;
    }
    try {
      await navigator.clipboard.writeText(membership.joinCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // 剪贴板不可用时，用户可以直接选中下面的班级码文本复制
    }
  };

  const handleJoinClass = () => {
    const value = joinCodeInput.trim();
    if (!value) {
      return;
    }
    onJoinClass(value);
    setJoinCodeInput('');
  };

  const handleCreateClass = () => {
    onCreateClass(className.trim() || '我的班级');
    setCreatingClass(false);
    setClassName('');
  };

  const handleChangePassword = () => {
    if (!oldPassword || !newPassword) {
      return;
    }
    onChangePassword(oldPassword, newPassword);
    setChangingPassword(false);
    setOldPassword('');
    setNewPassword('');
  };

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

        <section className="user-data-section user-data-section--sync">
          <div className="user-data-section-title">
            {backendState === 'offline' || backendState === 'error' ? (
              <CloudOff size={14} />
            ) : (
              <RefreshCw size={14} />
            )}
            <span>账号</span>
          </div>

          {session ? (
            <>
              <p className="user-data-sync-state">
                {session.account.displayName}（{session.account.username}）·{' '}
                {isTeacher ? '老师' : '学生'}
              </p>
              <p className="user-data-sync-time">
                {inClass
                  ? `已加入「${membership?.spaceName}」 · ${STATE_TEXT[backendState]}`
                  : `${isTeacher ? '还没建班级' : '还没加入班级'} · ${STATE_TEXT[backendState]}`}
              </p>
              {!inClass && (
                <p className="user-data-hint">
                  {isTeacher
                    ? '建一个班级，把班级码发给学生，他们的学习进度就能同步到云端。'
                    : '向老师要一个班级码填到下面，进度就会同步到云端；现在这些进度只存在这台设备上。'}
                </p>
              )}
              {classNotice && <p className="user-data-code-error">{classNotice}</p>}
              {lastSyncedAt && (
                <p className="user-data-sync-time">最近同步：{formatAttemptTime(lastSyncedAt)}</p>
              )}

              {isOwner && membership?.joinCode && (
                <div className="user-data-joincode">
                  <span className="user-data-code-name">班级码</span>
                  <strong className="user-data-joincode-value">
                    {formatJoinCode(membership.joinCode)}
                  </strong>
                  <button
                    type="button"
                    className="user-data-link-btn"
                    onClick={() => void handleCopyJoinCode()}
                  >
                    <Copy size={13} />
                    {copied ? '已复制' : '复制'}
                  </button>
                </div>
              )}

              {!inClass && (
                <>
                  <label className="user-data-code-label" htmlFor="join-code-input">
                    输入班级码加入
                  </label>
                  <div className="user-data-code-row">
                    <input
                      id="join-code-input"
                      type="text"
                      className="user-data-code-input"
                      placeholder="班级码"
                      value={joinCodeInput}
                      onChange={(event) => setJoinCodeInput(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') {
                          handleJoinClass();
                        }
                      }}
                    />
                    <button
                      type="button"
                      className="user-data-code-btn"
                      disabled={authBusy || !joinCodeInput.trim()}
                      onClick={handleJoinClass}
                    >
                      {authBusy ? '处理中…' : '加入'}
                    </button>
                  </div>
                </>
              )}

              {authError && <p className="user-data-code-error">{authError}</p>}

              <div className="user-data-action-row">
                {!inClass && isTeacher && (
                  <button
                    type="button"
                    className="user-data-ghost-btn"
                    disabled={authBusy}
                    onClick={() => setCreatingClass(true)}
                  >
                    <UserPlus size={14} />
                    创建班级
                  </button>
                )}
                {isOwner && (
                  <button
                    type="button"
                    className="user-data-primary-btn"
                    onClick={onOpenDashboard}
                  >
                    打开班级看板
                  </button>
                )}
                {inClass && (
                  <button
                    type="button"
                    className="user-data-sync-btn"
                    disabled={authBusy}
                    onClick={onSyncNow}
                  >
                    立即同步
                  </button>
                )}
              </div>

              {inClass && (
                <button
                  type="button"
                  className="user-data-text-btn"
                  disabled={authBusy}
                  onClick={onLeaveClass}
                >
                  {isOwner ? '撤销并退出这个班级' : '退出这个班级'}
                </button>
              )}

              <div className="user-data-divider" />

              <div className="user-data-action-row">
                <button
                  type="button"
                  className="user-data-ghost-btn"
                  onClick={() => setChangingPassword(true)}
                >
                  修改密码
                </button>
                <button
                  type="button"
                  className="user-data-ghost-btn"
                  disabled={authBusy}
                  onClick={onLogout}
                >
                  <LogOut size={14} />
                  退出登录
                </button>
              </div>
            </>
          ) : (
            <>
              <p className="user-data-sync-state">
                没登录 — 进度只保存在本机，登录后才会同步到云端
              </p>

              <div className="user-data-tabs" role="tablist" aria-label="登录或注册">
                <button
                  type="button"
                  role="tab"
                  aria-selected={mode === 'login'}
                  className={mode === 'login' ? 'is-active' : ''}
                  onClick={() => setMode('login')}
                >
                  登录
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={mode === 'register'}
                  className={mode === 'register' ? 'is-active' : ''}
                  onClick={() => setMode('register')}
                >
                  注册
                </button>
              </div>

              <div className="user-data-field">
                <label htmlFor="account-username">用户名</label>
                <input
                  id="account-username"
                  type="text"
                  autoComplete="username"
                  placeholder="字母或数字，2–20 位"
                  value={username}
                  onChange={(event) => setUsername(event.target.value)}
                />
              </div>

              {mode === 'register' && (
                <>
                  <div className="user-data-field">
                    <label>我是</label>
                    <div className="user-data-role-switch" role="radiogroup" aria-label="账号身份">
                      <button
                        type="button"
                        role="radio"
                        aria-checked={regRole === 'student'}
                        className={regRole === 'student' ? 'is-active' : ''}
                        onClick={() => setRegRole('student')}
                      >
                        学生
                      </button>
                      <button
                        type="button"
                        role="radio"
                        aria-checked={regRole === 'teacher'}
                        className={regRole === 'teacher' ? 'is-active' : ''}
                        onClick={() => setRegRole('teacher')}
                      >
                        老师
                      </button>
                    </div>
                  </div>
                  {regRole === 'teacher' && (
                    <div className="user-data-field">
                      <label htmlFor="account-teacher-code">教师邀请码</label>
                      <input
                        id="account-teacher-code"
                        type="text"
                        autoComplete="off"
                        placeholder="向要建班的老师要"
                        value={teacherCode}
                        onChange={(event) => setTeacherCode(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') {
                            handleAuthSubmit();
                          }
                        }}
                      />
                      <p className="user-data-field-tip">
                        只有拿到邀请码才能注册成老师账号、才能创建班级。
                      </p>
                    </div>
                  )}
                </>
              )}

              {mode === 'register' && (
                <div className="user-data-field">
                  <label htmlFor="account-display-name">姓名（可不填）</label>
                  <input
                    id="account-display-name"
                    type="text"
                    placeholder="同学怎么称呼你"
                    value={displayName}
                    onChange={(event) => setDisplayName(event.target.value)}
                  />
                </div>
              )}

              <div className="user-data-field">
                <label htmlFor="account-password">密码</label>
                <input
                  id="account-password"
                  type="password"
                  autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
                  placeholder="至少 6 位"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      handleAuthSubmit();
                    }
                  }}
                />
              </div>

              {(formError || authError) && (
                <p className="user-data-code-error">{formError ?? authError}</p>
              )}

              <button
                type="button"
                className="user-data-primary-btn user-data-primary-btn-block"
                disabled={
                  authBusy ||
                  !username.trim() ||
                  !password ||
                  (mode === 'register' && regRole === 'teacher' && !teacherCode.trim())
                }
                onClick={handleAuthSubmit}
              >
                {authBusy ? '处理中…' : mode === 'register' ? '注册并登录' : '登录'}
              </button>
            </>
          )}
        </section>
      </aside>

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
            <p className="user-data-modal-tip">创建后会拿到一个班级码，把它发给学生就能加入。</p>
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

      {changingPassword && (
        <div className="user-data-modal-backdrop" onClick={() => setChangingPassword(false)}>
          <div className="user-data-modal" onClick={(event) => event.stopPropagation()}>
            <h4>修改密码</h4>
            <input
              className="user-data-code-input"
              type="password"
              autoFocus
              placeholder="原密码"
              value={oldPassword}
              onChange={(event) => setOldPassword(event.target.value)}
            />
            <input
              className="user-data-code-input"
              type="password"
              placeholder="新密码（至少 6 位）"
              value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  handleChangePassword();
                }
              }}
            />
            <p className="user-data-modal-tip">忘了密码？让班里的老师在看板上重置。</p>
            <div className="user-data-modal-actions">
              <button
                type="button"
                className="user-data-ghost-btn"
                onClick={() => setChangingPassword(false)}
              >
                取消
              </button>
              <button type="button" className="user-data-primary-btn" onClick={handleChangePassword}>
                保存
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
