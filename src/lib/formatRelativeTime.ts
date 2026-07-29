/**
 * 알림 시간 표시용 상대 시간 포맷팅.
 * 입력: 타임스탐프(ms)
 * 출력: '5분 전', '1시간 전', '어제', 'YYYY-MM-DD' 등
 */
export function formatRelativeTime(timestampMs: number): string {
  const now = Date.now();
  const diffMs = now - timestampMs;
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHour = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHour / 24);

  if (diffMin < 1) return '방금 전';
  if (diffMin < 60) return `${diffMin}분 전`;
  if (diffHour < 24) return `${diffHour}시간 전`;
  if (diffDay === 1) return '어제';
  if (diffDay < 7) return `${diffDay}일 전`;

  // 7일 이상: 날짜로 표시 (YYYY-MM-DD)
  const date = new Date(timestampMs);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}
