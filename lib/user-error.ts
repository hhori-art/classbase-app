/**
 * APIのエラーを、画面に出せる日本語にする。
 * 日本語の文言はそのまま使い、英語のコード（forbidden・not found など）は分かる言葉に置き換える。
 * 置き換えられないコードは「（コード）」として添え、問い合わせのときに伝えられるようにする。
 */
const KNOWN: Array<[RegExp, string]> = [
  // 勤怠の打刻・詳細（サーバーの英語の文言）
  [/clocking is closed after 23:00/i, '23時以降は出勤打刻できません。打刻を忘れた場合は打刻忘れを申請してください。'],
  [/approved work records cannot be changed/i, '承認済みの勤務記録は変更できません。修正が必要なときは打刻の修正を申請してください。'],
  [/active work record already exists/i, '今日はすでに出勤しています。画面を読み込み直してください。'],
  [/work record already completed today/i, '今日の勤務はすでに退勤済みです。'],
  [/work record belongs to another date/i, '前日以前の勤務は退勤打刻できません。打刻の修正を申請してください。'],
  [/work record already clocked out/i, 'この勤務はすでに退勤済みです。画面を読み込み直してください。'],
  [/student-profile-changed/i, 'お子さまの情報が更新されました。画面を読み込み直してから、もう一度お試しください。'],
  [/period-ended/i, '受付期間が終わっています。'],
  [/^forbidden$|permission|not[-_ ]?allowed|unauthori[sz]ed/i, 'この操作を行う権限がありません。'],
  [/not[-_ ]?found/i, '対象が見つかりません。画面を読み込み直してください。'],
  [/already[-_ ]?(submitted|exists|registered)/i, 'すでに登録されています。画面を読み込み直してください。'],
  [/is required|required$|missing/i, '入力が足りません。入力内容を確認してください。'],
  [/invalid|bad[-_ ]?request/i, '入力内容を確認してください。'],
  [/too[-_ ]?many|rate[-_ ]?limit/i, '回数が多すぎます。しばらく待ってからもう一度お試しください。'],
  [/session[-_ ]?closed|expired|ended/i, '受付が終了しています。画面を読み込み直してください。'],
  [/failed to fetch|network|load failed/i, '通信できませんでした。電波の良い場所でもう一度お試しください。'],
  [/^failed$|internal|unknown|unexpected/i, '処理できませんでした。時間をおいてもう一度お試しください。'],
];

const hasJapanese = (text: string) => /[぀-ヿ㐀-鿿]/.test(text);

export function userErrorMessage(raw: unknown, fallback = '処理できませんでした。もう一度お試しください。') {
  const text = String((raw as any)?.message ?? raw ?? '').trim();
  if (!text) return fallback;
  if (hasJapanese(text)) return text;
  const known = KNOWN.find(([pattern]) => pattern.test(text));
  if (known) return known[1];
  return `${fallback}（${text.slice(0, 60)}）`;
}
