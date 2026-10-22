/** 欠席・振替APIのエラー（jsonError は { error } を返す）を、保護者・生徒に見せる日本語へ変換する。 */

const MESSAGES: Record<string, string> = {
  forbidden: 'この操作を行う権限がありません。',
  'student-not-found': '生徒情報が見つかりませんでした。',
  'invalid transfer option token': '振替候補の有効期限が切れました。候補を読み込み直したので、もう一度選んでください。',
  'transfer option changed; reload options': '振替候補が更新されました。候補を読み込み直したので、もう一度選んでください。',
  'transfer option not found': '選んだ振替先の授業が見つかりません。候補を読み込み直したので、もう一度選んでください。',
  'transfer-shift-not-found': '選んだ振替先の授業が見つかりません。候補を読み込み直したので、もう一度選んでください。',
  'transfer option is required': '振替先の授業を選んでください。',
  'transfer date must differ from absence date': '休む日と同じ日の授業には振替できません。別の日を選んでください。',
  'transfer-target-ended': 'この時間の授業はもう終わったため、振替できません。',
  'transfer already registered': 'この日の欠席にはすでに振替が登録されています。',
  'absence is not active': 'この欠席連絡は取り消されているため、振替を登録できません。',
  'late requests cannot be transferred': '遅刻の連絡には振替を登録できません。',
  'lesson-already-ended': 'この日の授業はすでに終わっているため、欠席・遅刻の連絡はできません。',
  'reason is required': '理由を入力してください。',
  'reason is too long': '理由は2000文字以内で入力してください。',
  'student_id and target_date are required': '日付を正しく選んでください。',
  'invalid absence_type': '連絡の種類を選び直してください。',
};

/** 候補を読み込み直すべきエラー（トークン切れ・候補の変更など）か。 */
export function isTransferOptionError(error: unknown) {
  const code = String(error || '');
  return /transfer option|transfer-shift-not-found|transfer-target-ended|transfer date must differ/.test(code);
}

/** API応答から表示用メッセージを作る。message があればそれを優先する。 */
export function absenceRequestErrorMessage(data: { message?: unknown; error?: unknown } | null | undefined, fallback = '送信に失敗しました。') {
  const message = String(data?.message || '').trim();
  if (message) return message;
  const code = String(data?.error || '').trim();
  if (!code) return fallback;
  if (MESSAGES[code]) return MESSAGES[code];
  // 日本語のメッセージ（再ログイン案内など）はそのまま見せる。
  return /[ぁ-んァ-ン一-龥]/.test(code) ? code : fallback;
}

export class AbsenceRequestError extends Error {
  code: string;
  constructor(data: { message?: unknown; error?: unknown } | null | undefined, fallback?: string) {
    super(absenceRequestErrorMessage(data, fallback));
    this.code = String(data?.error || '');
  }
}
