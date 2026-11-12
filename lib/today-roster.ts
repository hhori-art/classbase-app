/**
 * 当日の対応名簿（講師の「未連絡・欠席確認」）。生徒ごとに、今どの状態かを決める。
 *
 * - 入室済み：Zoom に今いることを確かめた（Zoom の参加者一覧と照合）、または講師が出席・遅刻を記録した。
 * - 欠席連絡あり：本人・保護者から、その日の欠席・遅刻の連絡がある（まだ入室していない）。
 * - 欠席記録あり：講師が電話などで欠席を確定した。
 * - 連絡なし・未入室：Zoom を確かめたが入っておらず、連絡もない。確認電話が要るのはこの人だけ。
 * - 未確認：その生徒の時限の授業で Zoom をまだ確かめていない（または確かめられない）。推測で「未入室」にはしない。
 * - 今日の授業なし：時間割（受講登録・振替・休講）で、今日の授業がない。
 * 授業ボタンを押しただけでは入室に数えない（押した記録は補足として出す）。
 */

export type RosterStatus = 'joined' | 'absence_notified' | 'absent_recorded' | 'no_contact' | 'unconfirmed' | 'no_lesson';

export const ROSTER_STATUS_LABELS: Record<RosterStatus, string> = {
  joined: '入室済み',
  absence_notified: '欠席連絡あり',
  absent_recorded: '欠席記録あり',
  no_contact: '連絡なし・未入室',
  unconfirmed: '未確認',
  no_lesson: '今日の授業なし',
};

export type RosterAbsence = { kind: 'absent' | 'late'; reason?: string };

export type RosterInput = {
  /** 講師が記録した出欠（pf_records の 出・遅・欠）。 */
  manualAttendance?: string;
  /** その日の有効な欠席・遅刻連絡。 */
  absence?: RosterAbsence | null;
  /** その生徒の時限の授業で、Zoom の参加者一覧を確かめたか（zoomCheckedForLessons で求める）。 */
  zoomChecked: boolean;
  /** 時間割で今日の授業があるか。分からないときは undefined。 */
  hasLessonToday?: boolean;
  /** Zoom の参加者一覧で、この生徒が見つかったか。 */
  inZoom: boolean;
  /** 授業ボタンを押した記録があるか（入室ではない）。 */
  classButtonClicked?: boolean;
  /** 「欠席時の電話不要」の設定。 */
  callNotRequired?: boolean;
};

export type RosterResult = {
  status: RosterStatus;
  /** 確認電話が要るか。 */
  needsCall: boolean;
  /** 画面に出す補足。 */
  notes: string[];
};

export function classifyRosterStudent(input: RosterInput): RosterResult {
  const notes: string[] = [];
  const manual = String(input.manualAttendance || '').trim();
  if (input.classButtonClicked && !input.inZoom) notes.push('授業ボタンは押しています（入室は未確認）');
  if (input.callNotRequired) notes.push('欠席時の電話は不要の設定');

  if (input.inZoom || manual === '出' || manual === '遅') {
    if (!input.inZoom) notes.push(manual === '遅' ? '講師が遅刻を記録' : '講師が出席を記録');
    if (input.absence) notes.push(input.absence.kind === 'late' ? '遅刻の連絡あり' : '欠席の連絡がありましたが入室しています');
    return { status: 'joined', needsCall: false, notes };
  }
  if (manual === '欠') return { status: 'absent_recorded', needsCall: false, notes };
  if (input.hasLessonToday === false && !input.absence) return { status: 'no_lesson', needsCall: false, notes };
  if (input.absence) {
    notes.unshift(input.absence.kind === 'late' ? '遅刻の連絡' : '欠席の連絡');
    if (input.absence.reason) notes.push(input.absence.reason);
    return { status: 'absence_notified', needsCall: false, notes };
  }
  if (!input.zoomChecked) return { status: 'unconfirmed', needsCall: false, notes };
  return { status: 'no_contact', needsCall: !input.callNotRequired, notes };
}

/** 有効な欠席・遅刻連絡（取り消し・却下を除く）を、生徒IDごとにまとめる。 */
export function activeAbsencesByStudent(rows: Array<Record<string, any>>) {
  const map = new Map<string, RosterAbsence>();
  rows.forEach(row => {
    if (String(row.type || 'absence') !== 'absence') return;
    if (['cancelled', 'canceled', 'rejected'].includes(String(row.status || ''))) return;
    const absence: RosterAbsence = {
      kind: String(row.absence_type || '') === 'late' ? 'late' : 'absent',
      reason: String(row.reason || row.absence_reason || '').trim().slice(0, 80) || undefined,
    };
    [row.student_id, row.user_id].map(value => String(value || '').trim()).filter(Boolean).forEach(id => {
      // 同じ日に欠席と遅刻の両方があれば、欠席を優先する。
      if (!map.has(id) || absence.kind === 'absent') map.set(id, absence);
    });
  });
  return map;
}

export function summarizeRoster(results: RosterResult[]) {
  const counts: Record<RosterStatus, number> = { joined: 0, absence_notified: 0, absent_recorded: 0, no_contact: 0, unconfirmed: 0, no_lesson: 0 };
  results.forEach(result => { counts[result.status] += 1; });
  return { counts, needsCall: results.filter(result => result.needsCall).length };
}

/**
 * その生徒の今日の授業（時限）のうち、Zoom を確かめ終えた時限があるか。
 * 今日の授業が分からない生徒は、確かめていない扱い（未確認のまま）にする。
 */
export function zoomCheckedForLessons(lessonPeriods: number[] | null | undefined, checkedPeriods: Set<number>) {
  if (!lessonPeriods || lessonPeriods.length === 0) return false;
  return lessonPeriods.some(period => checkedPeriods.has(period));
}
