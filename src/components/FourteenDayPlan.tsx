import { ArrowRight, CheckCircle2 } from 'lucide-react';
import { FOURTEEN_DAY_PLAN, PHONEME_MAP } from '../data/phonics-catalog';
import type { PhonemeProgress, StudyDayPlan } from '../types/phonics';

interface FourteenDayPlanProps {
  getPhonemeProgress: (phonemeId: string) => PhonemeProgress;
  onStartDayStudy: (dayPlan: StudyDayPlan, targetPhonemeId?: string) => void;
}

/**
 * 14 天小升初音标打卡路线视图
 */
export function FourteenDayPlan({
  getPhonemeProgress,
  onStartDayStudy,
}: FourteenDayPlanProps) {
  return (
    <section className="page-container">
      <div className="page-hero">
        <div>
          <span className="hero-tag">小升初专项路线</span>
          <h2>14 天音标对比打卡计划</h2>
          <p>
            不按枯燥字母表死背，而是每天用 10 分钟攻克一组 4 个“对比音标”，第 1–12
            天学完全部 48 音，第 13–14 天专攻高频易混考前复盘。
          </p>
        </div>
      </div>

      <div className="plan-grid">
        {FOURTEEN_DAY_PLAN.map((plan) => {
          const completedInDay = plan.phonemeIds.filter((id) => {
            const record = getPhonemeProgress(id);
            return record.completed;
          }).length;
          const isDayDone = completedInDay === plan.phonemeIds.length;

          return (
            <article key={plan.day} className={`plan-card ${isDayDone ? 'day-done' : ''}`}>
              <div className="plan-card-header">
                <span className="day-pill">Day {plan.day}</span>
                <span className="day-progress-text">
                  {isDayDone ? (
                    <span className="done-label">
                      <CheckCircle2 size={14} /> 今日已打卡
                    </span>
                  ) : (
                    `已完成 ${completedInDay}/${plan.phonemeIds.length}`
                  )}
                </span>
              </div>

              <h3 className="plan-title">{plan.title}</h3>
              <p className="plan-subtitle">{plan.subtitle}</p>

              <div className="plan-phonemes-row">
                {plan.phonemeIds.map((id) => {
                  const phoneme = PHONEME_MAP[id];
                  if (!phoneme) {
                    return null;
                  }
                  const record = getPhonemeProgress(id);
                  return (
                    <button
                      key={id}
                      type="button"
                      className={`plan-phoneme-chip ${record.completed ? 'studied' : ''}`}
                      onClick={() => onStartDayStudy(plan, id)}
                      title={`打开 ${phoneme.symbol} 卡片`}
                    >
                      <span className="chip-symbol">{phoneme.symbol}</span>
                      {record.completed && (
                        <CheckCircle2 size={12} className="chip-check" />
                      )}
                    </button>
                  );
                })}
              </div>

              <p className="plan-goal-tip">小贴士：{plan.goalTip}</p>

              <button
                type="button"
                className="plan-start-btn"
                onClick={() => onStartDayStudy(plan)}
              >
                <span>{isDayDone ? '再复习这一天' : '开始今日学习'}</span>
                <ArrowRight size={15} />
              </button>
            </article>
          );
        })}
      </div>
    </section>
  );
}
