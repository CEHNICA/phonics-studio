import { useCallback, useEffect, useMemo, useState } from 'react';
import { GraduationCap, RefreshCw, UserMinus, X } from 'lucide-react';
import { getBackend } from '../services/backend';
import type { ClassOverview } from '../services/backend/types';

interface ClassDashboardProps {
  open: boolean;
  /** 管理码：老师凭它看全班 */
  ownerKey: string;
  onClose: () => void;
}

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
 * 班级看板：老师凭管理码查看全班每人的已学音标数、打卡天数、答题正确率与最近活跃
 */
export function ClassDashboard({ open, ownerKey, onClose }: ClassDashboardProps) {
  const [overview, setOverview] = useState<ClassOverview | null>(null);
  const [refreshing, setRefreshing] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [busyMemberId, setBusyMemberId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const backend = getBackend();
    if (!backend.classOverview) {
      setError('当前后端不支持班级看板');
      return;
    }
    try {
      const data = await backend.classOverview(ownerKey);
      setOverview(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : '读取班级看板失败');
    } finally {
      setRefreshing(false);
    }
  }, [ownerKey]);

  useEffect(() => {
    if (!open || !ownerKey) {
      return;
    }
    (async () => {
      await load();
    })();
  }, [open, ownerKey, load]);

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

  const handleRevoke = async (memberId: string, name: string) => {
    const backend = getBackend();
    if (!backend.revokeMember) {
      return;
    }
    if (!window.confirm(`确定把「${name}」移出班级吗？他的云端数据会立刻停止同步。`)) {
      return;
    }
    setBusyMemberId(memberId);
    try {
      await backend.revokeMember(ownerKey, memberId);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : '移出成员失败');
    } finally {
      setBusyMemberId(null);
    }
  };

  const handleRevokeSpace = async () => {
    const backend = getBackend();
    if (!backend.revokeSpace) {
      return;
    }
    if (!window.confirm('确定撤销整个班级吗？撤销后所有成员都无法再同步，操作不可撤销。')) {
      return;
    }
    setBusyMemberId('__space__');
    try {
      await backend.revokeSpace(ownerKey);
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
                void load();
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

        {loading && !overview && <p className="class-dashboard-hint">正在读取班级数据…</p>}
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
                      key={member.memberId}
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
                          <button
                            type="button"
                            className="class-member-revoke-btn"
                            disabled={busyMemberId === member.memberId}
                            onClick={() => void handleRevoke(member.memberId, member.name)}
                          >
                            <UserMinus size={13} />
                            移出
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <footer className="class-dashboard-footer">
              <span>管理码只在本机保存，看板数据实时读取，不影响任何人的学习进度。</span>
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
    </>
  );
}
