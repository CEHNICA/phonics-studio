import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { GraduationCap, KeyRound, RefreshCw, UserMinus, X } from 'lucide-react';
import { getBackend } from '../services/backend';
import {
  browserCacheStorage,
  isClassOverviewFresh,
  readClassOverviewCache,
  writeClassOverviewCache,
} from '../services/backend/class-overview-cache';
import type { ClassOverview } from '../services/backend/types';

interface ClassDashboardProps {
  open: boolean;
  /** 会话令牌：老师凭它看全班 */
  token: string;
  onClose: () => void;
}

/**
 * 慢到什么程度就告诉用户「网络慢」
 *
 * 跨境接口单次 223~3151ms 抖动（实测），超过 600ms 就别让人干瞪眼。
 */
const SLOW_LOAD_HINT_MS = 600;

function formatTime(iso: string | null): string {
  if (!iso) {
    return '还没来过';
  }
  const parsed = Date.parse(iso);
  if (Number.isNaN(parsed)) {
    return '还没来过';
  }
  const date = new Date(parsed);
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hour = String(date.getHours()).padStart(2, '0');
  const minute = String(date.getMinutes()).padStart(2, '0');
  return `${month}-${day} ${hour}:${minute}`;
}

function isToday(iso: string | null): boolean {
  if (!iso) {
    return false;
  }
  const parsed = Date.parse(iso);
  if (Number.isNaN(parsed)) {
    return false;
  }
  const date = new Date(parsed);
  const now = new Date();
  return (
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate()
  );
}

/**
 * 班级看板：老师凭自己的登录状态查看全班每人的已学音标数、打卡天数、答题正确率与最近活跃
 *
 * 统计只看学生：老师自己不在班级里答题，计进分母会把平均分拉低。
 */
export function ClassDashboard({ open, token, onClose }: ClassDashboardProps) {
  // 先亮上一次看过的数据，别让老师干等跨境往返
  const [overview, setOverview] = useState<ClassOverview | null>(() => {
    const storage = browserCacheStorage();
    if (!storage) {
      return null;
    }
    const hit = readClassOverviewCache(storage);
    return hit ? hit.data : null;
  });
  /** 现在看到的是旧数据，后台正在刷新 */
  const [stale, setStale] = useState<boolean>(() => {
    const storage = browserCacheStorage();
    return storage ? readClassOverviewCache(storage) !== null : false;
  });
  const [refreshing, setRefreshing] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  /** 慢到一定程度就告诉用户，别让人干瞪眼 */
  const [slow, setSlow] = useState<boolean>(false);
  const [busyMemberId, setBusyMemberId] = useState<string | null>(null);
  const [tempPassword, setTempPassword] = useState<{ name: string; password: string } | null>(null);
  const slowTimerRef = useRef<number | null>(null);

  const load = useCallback(async (force = false) => {
    const backend = getBackend();
    const storage = browserCacheStorage();

    // 缓存够新就别再跑一趟跨境：预取回来的数据正好赶上老师点看板，
    // 再发一次请求就是白等 300~3000ms。
    if (!force && storage) {
      const cached = readClassOverviewCache(storage);
      if (cached && isClassOverviewFresh(cached.cachedAt, Date.now())) {
        setOverview(cached.data);
        setStale(false);
        setError(null);
        setRefreshing(false);
        return;
      }
    }

    // 慢提示计时：跨境请求抖起来的时候得给个交代
    if (slowTimerRef.current !== null) {
      window.clearTimeout(slowTimerRef.current);
    }
    slowTimerRef.current = window.setTimeout(() => {
      setSlow(true);
    }, SLOW_LOAD_HINT_MS);
    try {
      const data = await backend.classOverview(token);
      setOverview(data);
      setStale(false);
      setError(null);
      // 存下来，下次打开直接秒开
      if (storage) {
        writeClassOverviewCache(storage, data.space.id, data);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '读取班级看板失败');
    } finally {
      if (slowTimerRef.current !== null) {
        window.clearTimeout(slowTimerRef.current);
        slowTimerRef.current = null;
      }
      setSlow(false);
      setRefreshing(false);
    }
  }, [token]);

  useEffect(() => {
    if (!open || !token) {
      return;
    }
    (async () => {
      await load();
    })();
  }, [open, token, load]);

  // 组件没了就把慢提示计时器收掉，别留个孤儿定时器
  useEffect(
    () => () => {
      if (slowTimerRef.current !== null) {
        window.clearTimeout(slowTimerRef.current);
        slowTimerRef.current = null;
      }
    },
    [],
  );

  /** 首次打开时还没有数据 = 正在加载 */
  const loading = refreshing || (open && !overview && !error);

  const summary = useMemo(() => {
    // 统计只看学生：老师自己不在班级里答题，计进分母会把平均分拉低
    const members = (overview?.members ?? []).filter(
      (member) => !member.revoked && member.role !== 'owner',
    );
    const count = members.length;
    const avgCompleted = count
      ? Math.round((members.reduce((sum, item) => sum + item.completed, 0) / count) * 10) / 10
      : 0;
    const avgAccuracy = count
      ? Math.round(members.reduce((sum, item) => sum + item.accuracy, 0) / count)
      : 0;
    const activeToday = members.filter((member) => isToday(member.lastSeenAt)).length;
    return { count, avgCompleted, avgAccuracy, activeToday };
  }, [overview]);

  const handleRevoke = async (accountId: string, name: string) => {
    const backend = getBackend();
    if (!window.confirm(`确定把「${name}」移出班级吗？他的云端数据会立刻停止同步。`)) {
      return;
    }
    setBusyMemberId(accountId);
    try {
      await backend.removeMember(token, accountId);
      // 操作完必须看到最新名单，不能拿缓存糊弄
      await load(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : '移出成员失败');
    } finally {
      setBusyMemberId(null);
    }
  };

  const handleResetPassword = async (accountId: string, name: string) => {
    const backend = getBackend();
    if (!window.confirm(`确定重置「${name}」的密码吗？重置后他需要用新密码重新登录。`)) {
      return;
    }
    setBusyMemberId(accountId);
    try {
      const password = await backend.resetMemberPassword(token, accountId);
      setTempPassword({ name, password });
      // 操作完必须看到最新名单，不能拿缓存糊弄
      await load(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : '重置密码失败');
    } finally {
      setBusyMemberId(null);
    }
  };

  const handleRevokeSpace = async () => {
    const backend = getBackend();
    if (!window.confirm('确定撤销整个班级吗？撤销后所有成员都无法再同步，操作不可撤销。')) {
      return;
    }
    setBusyMemberId('__space__');
    try {
      await backend.revokeClass(token);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : '撤销班级失败');
    } finally {
      setBusyMemberId(null);
    }
  };

  if (!open) {
    return null;
  }

  return (
    <>
      <div className="class-dashboard-backdrop" onClick={onClose} />
      <section className="class-dashboard" role="dialog" aria-label="班级看板">
        <header className="class-dashboard-header">
          <div className="class-dashboard-title">
            <GraduationCap size={18} />
            <h3>{overview?.space.name ?? '班级看板'}</h3>
            {overview && <span className="class-dashboard-count">{summary.count} 人</span>}
          </div>
          <div className="class-dashboard-tools">
            <button
              type="button"
              className="class-dashboard-refresh"
              onClick={() => {
                setRefreshing(true);
                // 手动点「刷新」必须强制拉最新，不管缓存多新
                void load(true);
              }}
            >
              <RefreshCw size={15} />
              刷新
            </button>
            <button type="button" className="user-data-close" onClick={onClose} title="关闭">
              <X size={17} />
            </button>
          </div>
        </header>

        {loading && !overview && (
          <p className="class-dashboard-hint">
            {slow ? '网络有点慢，还在读班级数据…' : '正在读取班级数据…'}
          </p>
        )}
        {stale && !loading && (
          <p className="class-dashboard-hint">正在更新班级数据…</p>
        )}
        {error && <p className="class-dashboard-error">{error}</p>}

        {overview && (
          <>
            <div className="class-dashboard-summary">
              <div className="class-summary-card">
                <span>在册学生</span>
                <strong>{summary.count}</strong>
              </div>
              <div className="class-summary-card">
                <span>平均已学</span>
                <strong>
                  {summary.avgCompleted}
                  <em>个</em>
                </strong>
              </div>
              <div className="class-summary-card">
                <span>平均正确率</span>
                <strong>{summary.avgAccuracy}%</strong>
              </div>
              <div className="class-summary-card">
                <span>今天活跃</span>
                <strong>{summary.activeToday}</strong>
              </div>
            </div>

            <div className="class-dashboard-table-wrap">
              <table className="class-dashboard-table">
                <thead>
                  <tr>
                    <th>成员</th>
                    <th>身份</th>
                    <th className="class-col-num">已学(个)</th>
                    <th className="class-col-num">打卡(天)</th>
                    <th className="class-col-num">答题(道)</th>
                    <th className="class-col-num">正确率</th>
                    <th>最近活跃</th>
                    <th className="class-col-action">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {overview.members.length === 0 && (
                    <tr>
                      <td colSpan={8} className="class-dashboard-empty">
                        还没有人加入，把班级码发给学生就行。
                      </td>
                    </tr>
                  )}
                  {overview.members.map((member) => (
                    <tr
                      key={member.accountId}
                      className={
                        member.revoked
                          ? 'class-member-revoked'
                          : member.role === 'owner'
                            ? 'class-member-owner'
                            : undefined
                      }
                    >
                      <td>
                        <span className="class-member-name">
                          {member.role === 'owner' ? '我（老师）' : member.name}
                          {member.revoked && <em>已移出</em>}
                        </span>
                      </td>
                      <td>
                        {member.role === 'owner' ? (
                          <span className="class-role-badge">老师</span>
                        ) : (
                          '学生'
                        )}
                      </td>
                      <td className="class-col-num">{member.completed}</td>
                      <td className="class-col-num">{member.checkedDays}</td>
                      <td className="class-col-num">{member.totalAnswered}</td>
                      <td className="class-col-num">{member.accuracy}%</td>
                      <td>{formatTime(member.lastSeenAt)}</td>
                      <td className="class-col-action">
                        {member.role !== 'owner' && !member.revoked && (
                          <span className="class-member-actions">
                            <button
                              type="button"
                              className="class-member-reset-btn"
                              disabled={busyMemberId === member.accountId}
                              onClick={() => void handleResetPassword(member.accountId, member.name)}
                            >
                              <KeyRound size={13} />
                              重置密码
                            </button>
                            <button
                              type="button"
                              className="class-member-revoke-btn"
                              disabled={busyMemberId === member.accountId}
                              onClick={() => void handleRevoke(member.accountId, member.name)}
                            >
                              <UserMinus size={13} />
                              移出
                            </button>
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <footer className="class-dashboard-footer">
              <span>看板数据实时读取，不影响任何人的学习进度。</span>
              <button
                type="button"
                className="class-dashboard-revoke-space"
                disabled={busyMemberId === '__space__'}
                onClick={() => void handleRevokeSpace()}
              >
                撤销整个班级
              </button>
            </footer>
          </>
        )}
      </section>

      {tempPassword && (
        <div className="user-data-modal-backdrop" onClick={() => setTempPassword(null)}>
          <div className="user-data-modal" onClick={(event) => event.stopPropagation()}>
            <h4>「{tempPassword.name}」的新密码</h4>
            <input className="user-data-code-input" readOnly value={tempPassword.password} />
            <p className="user-data-modal-tip">把新密码告诉本人，让他用新密码登录。</p>
            <div className="user-data-modal-actions">
              <button
                type="button"
                className="user-data-ghost-btn"
                onClick={() => setTempPassword(null)}
              >
                知道了
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
