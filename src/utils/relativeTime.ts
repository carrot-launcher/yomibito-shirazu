// 相対時刻を日本語で返す。凛とした空気感に合うよう数字を使いつつも簡潔に
export function relativeTimeJa(date: Date | null | undefined): string {
  if (!date) return '';
  const diffMs = Date.now() - date.getTime();
  if (diffMs < 0) return 'たった今';

  const sec = Math.floor(diffMs / 1000);
  if (sec < 60) return 'たった今';

  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}分前`;

  const hour = Math.floor(min / 60);
  if (hour < 24) return `${hour}時間前`;

  const day = Math.floor(hour / 24);
  if (day === 1) return '昨日';
  if (day < 7) return `${day}日前`;

  const week = Math.floor(day / 7);
  if (week < 5) return `${week}週間前`;

  const month = Math.floor(day / 30);
  if (month < 12) return `${month}ヶ月前`;

  const year = Math.floor(day / 365);
  return `${year}年前`;
}
