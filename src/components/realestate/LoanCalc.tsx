import { useState, useMemo } from 'react';
import { monthlyPayment, maxLoan } from '@/lib/loan';
import { fmt } from '@/lib/colors';
import s from './LoanCalc.module.css';

interface LoanCalcProps {
  recentPrice: number | null;  // 현재 평형 최근 거래가(보증금 또는 매매가)
}

const LTV_CHIPS = [40, 50, 60, 70] as const;
const DURATION_MIN = 10;
const DURATION_MAX = 40;
const DEFAULT_RATE = 3.8;

export default function LoanCalc({ recentPrice }: LoanCalcProps) {
  const [expanded, setExpanded] = useState(false);
  const [ltv, setLtv] = useState(60);
  const [annualRate, setAnnualRate] = useState(DEFAULT_RATE);
  const [duration, setDuration] = useState(30);

  const maxLoanAmount = useMemo(
    () => (recentPrice ? maxLoan(recentPrice, ltv) : 0),
    [recentPrice, ltv],
  );

  const monthly = useMemo(
    () => monthlyPayment(maxLoanAmount, annualRate, duration),
    [maxLoanAmount, annualRate, duration],
  );

  const totalInterest = useMemo(
    () => monthly * duration * 12 - maxLoanAmount,
    [monthly, maxLoanAmount, duration],
  );

  const handleRateChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setAnnualRate(parseFloat(e.target.value) || 0);
  };

  const handleDurationChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setDuration(Math.max(DURATION_MIN, Math.min(DURATION_MAX, parseInt(e.target.value, 10) || DURATION_MIN)));
  };

  return (
    <div className={s.container}>
      <button className={s.header} onClick={() => setExpanded(!expanded)}>
        <span className={s.title}>대출 계산기</span>
        <span className={s.toggle}>{expanded ? '−' : '+'}</span>
      </button>

      {expanded && (
        <div className={s.content}>
          {/* 가격 자동 채움 */}
          {recentPrice && (
            <div className={s.row}>
              <label className={s.label}>현재 평형 최근 거래가</label>
              <div className={s.value}>{fmt(recentPrice, 0)}만원</div>
            </div>
          )}

          {/* LTV 칩 */}
          <div className={s.row}>
            <label className={s.label}>LTV (담보인정 비율)</label>
            <div className={s.chips}>
              {LTV_CHIPS.map((v) => (
                <button
                  key={v}
                  className={`${s.chip} ${ltv === v ? s.chipActive : ''}`}
                  onClick={() => setLtv(v)}
                >
                  {v}%
                </button>
              ))}
            </div>
          </div>

          {/* 최대 대출액 */}
          <div className={s.row}>
            <label className={s.label}>최대 대출액</label>
            <div className={s.value}>{fmt(maxLoanAmount, 0)}만원</div>
          </div>

          {/* 금리 입력 */}
          <div className={s.row}>
            <label className={s.label}>
              연 금리
              <span className={s.unit}>%</span>
            </label>
            <input
              type="number"
              step="0.1"
              min="0"
              max="10"
              value={annualRate}
              onChange={handleRateChange}
              className={s.input}
            />
          </div>

          {/* 기간 입력 */}
          <div className={s.row}>
            <label className={s.label}>
              상환 기간
              <span className={s.unit}>년</span>
            </label>
            <input
              type="number"
              min={DURATION_MIN}
              max={DURATION_MAX}
              value={duration}
              onChange={handleDurationChange}
              className={s.input}
            />
          </div>

          {/* 월 상환액 */}
          <div className={`${s.row} ${s.highlight}`}>
            <label className={s.label}>월 상환액</label>
            <div className={s.resultValue}>{fmt(monthly, 0)}만원</div>
          </div>

          {/* 총 이자 */}
          <div className={s.row}>
            <label className={s.label}>총 이자</label>
            <div className={s.value}>{fmt(totalInterest, 0)}만원</div>
          </div>

          <div className={s.caption}>
            단순 계산입니다. 실제 한도는 심사에 따라 다를 수 있습니다.
          </div>
        </div>
      )}
    </div>
  );
}
