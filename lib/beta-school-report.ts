/**
 * βテスト校の毎日の分析レポート（ログイン率・授業参加率など）。集計と文面だけで、Firestore は読まない。
 * 送るのは BETA_REPORT_UNTIL の日（日本時間）までで、翌日から自動で止まる。
 */
export const BETA_REPORT_SCHOOL_CODES = ['112', '132', '147'] as const;
export const BETA_REPORT_UNTIL = '2026-11-21';

export const isBetaReportPeriod = (todayJst: string) => todayJst <= BETA_REPORT_UNTIL;

export type BetaSchoolStats = {
  code: string;
  name: string;
  /** 在籍中の生徒 */
  students: number;
  /** 受講登録がある生徒 */
  registered: number;
  /** 対象日にログインした生徒 */
  loginDay: number;
  /** 対象日までの7日間に1回以上ログインした生徒 */
  login7: number;
  /** 対象日の授業（休講・欠席連絡ずみを除く、生徒×時限） */
  lessons: number;
  /** そのうち参加の記録がある授業 */
  joined: number;
  /** 欠席連絡があった授業 */
  absent: number;
};

const pct = (part: number, whole: number) => (whole > 0 ? `${Math.round((part / whole) * 1000) / 10}%` : '—');
const dateLabel = (date: string) => {
  const weekday = ['日', '月', '火', '水', '木', '金', '土'][new Date(`${date}T12:00:00+09:00`).getUTCDay()];
  return `${Number(date.slice(5, 7))}月${Number(date.slice(8, 10))}日（${weekday}）`;
};

export function sumBetaStats(rows: BetaSchoolStats[]): BetaSchoolStats {
  const keys = ['students', 'registered', 'loginDay', 'login7', 'lessons', 'joined', 'absent'] as const;
  const total = { code: 'all', name: '3校合計' } as BetaSchoolStats;
  keys.forEach(key => { total[key] = rows.reduce((sum, row) => sum + row[key], 0); });
  return total;
}

function schoolBlock(row: BetaSchoolStats) {
  return [
    `■ ${row.name}${row.code === 'all' ? '' : `（${row.code}）`}`,
    `  在籍生徒: ${row.students}人（受講登録あり ${row.registered}人・${pct(row.registered, row.students)}）`,
    `  生徒ログイン率（当日）: ${pct(row.loginDay, row.students)}（${row.loginDay}/${row.students}人）`,
    `  生徒ログイン率（7日間）: ${pct(row.login7, row.students)}（${row.login7}/${row.students}人）`,
    row.lessons
      ? `  授業参加率: ${pct(row.joined, row.lessons)}（参加 ${row.joined}/${row.lessons}コマ・未参加 ${row.lessons - row.joined}コマ）`
      : '  授業参加率: 授業なし',
    `  欠席連絡: ${row.absent}コマ`,
  ].join('\n');
}

export function formatBetaReport(targetDate: string, rows: BetaSchoolStats[], options: { appUrl?: string } = {}) {
  const subject = `【classbase】βテスト校 日次レポート ${dateLabel(targetDate)}`;
  const body = [
    `${dateLabel(targetDate)}（日本時間）のβテスト校の利用状況です。`,
    '',
    schoolBlock(sumBetaStats(rows)),
    '',
    ...rows.flatMap(row => [schoolBlock(row), '']),
    '― 集計の見方 ―',
    '・ログイン率: 在籍生徒のうち、アプリを開いてログインボーナスの記録がある生徒の割合。',
    '・授業参加率: その日に時間割で予定されていた授業（休講・欠席連絡ずみを除く）のうち、授業ボタンから参加した記録がある割合。',
    '',
    `このレポートは ${dateLabel(BETA_REPORT_UNTIL)} まで毎朝お送りし、その後は自動で止まります。`,
    ...(options.appUrl ? ['', options.appUrl] : []),
  ].join('\n');
  return { subject, body };
}
