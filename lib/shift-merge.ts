import { normalizeZoomMeetingId } from './zoom-url';

/**
 * 授業の合併：同じ日・同じ時限に全く同じ内容を行う講師配置を、1つの授業（合併先＝ホスト）の Zoom に集約する。
 *
 * 合併された側（メンバー）の講師配置には、合併先の会議ID・参加URL・パスコードの写しを持たせる。
 * 生徒の参加ボタンは写しの会議IDを優先して使うため、同じ会議IDの授業ボタンが1つにまとまる
 * （app/api/student/today-classes の mergeClassCandidates）。メンバーの元の会議IDはそのまま残し、解除すれば元に戻る。
 * 合併先には、メンバーの学年・科目（merge_audiences）を持たせ、合併先の録画をメンバーの生徒も見られるようにする。
 */

export type ShiftMergeAudience = { shift_id: string; grade: string; subject: string; detail_subject: string };

const clean = (value: unknown) => String(value ?? '').trim();

/** 講師配置の、合併前の（自分の）会議ID。 */
export const ownShiftMeetingId = (shift: Record<string, any>) => normalizeZoomMeetingId(
  shift.target_meeting_id || shift.meeting_id || shift.zoom_meeting_id || shift.meetingId || '',
);

export const isMergedMemberShift = (shift: Record<string, any> | null | undefined) => Boolean(clean(shift?.merge_host_shift_id));

/** 合併先の講師配置から、メンバーへ写す項目。 */
export function mergeMemberPatch(hostId: string, host: Record<string, any>) {
  return {
    merge_host_shift_id: hostId,
    merge_meeting_id: ownShiftMeetingId(host),
    merge_join_url: clean(host.target_join_url || host.zoom_join_url),
    merge_password: clean(host.target_password || host.meeting_password || host.zoom_password || host.passcode),
    merge_host_label: [clean(host.target_grade), clean(host.target_subject), clean(host.target_detail_subject), clean(host.teacher_name)].filter(Boolean).join(' '),
    merge_host_teacher_name: clean(host.teacher_name),
  };
}

export const MERGE_MEMBER_FIELDS = ['merge_host_shift_id', 'merge_meeting_id', 'merge_join_url', 'merge_password', 'merge_host_label', 'merge_host_teacher_name', 'merged_at', 'merged_by'] as const;

export const mergeAudienceOf = (shiftId: string, shift: Record<string, any>): ShiftMergeAudience => ({
  shift_id: shiftId,
  grade: clean(shift.target_grade || shift.grade),
  subject: clean(shift.target_subject || shift.subject),
  detail_subject: clean(shift.target_detail_subject || shift.detail_subject),
});

/**
 * 合併できるかの確認。問題があれば理由（画面に出す文）を返す。
 * periodOf は講師配置の時限（1・2、分からなければ0）。
 */
export function validateShiftMerge(input: {
  hostId: string;
  host: Record<string, any> | null;
  members: Array<{ id: string; data: Record<string, any> | null }>;
  periodOf: (shift: Record<string, any>) => number;
}) {
  const { hostId, host, members } = input;
  if (!host) return '合併先の授業が見つかりません。';
  if (!members.length) return '合併する授業を選んでください。';
  if (isMergedMemberShift(host)) return '合併先に選んだ授業は、すでに別の授業へ合併されています。先に解除してください。';
  if (clean(host.role_type || 'main') !== 'main') return '合併先はメイン授業の講師配置を選んでください。';
  if (!ownShiftMeetingId(host)) return '合併先の授業にZoomのミーティングIDが設定されていません。';
  const date = clean(host.target_date);
  const period = input.periodOf(host);
  for (const member of members) {
    if (member.id === hostId) return '合併先と同じ授業は選べません。';
    if (!member.data) return '合併する授業が見つかりません。画面を読み込み直してください。';
    if (clean(member.data.role_type || 'main') !== 'main') return 'メイン授業の講師配置だけを合併できます。';
    if (clean(member.data.target_date) !== date) return '同じ日の授業だけを合併できます。';
    if (!period || input.periodOf(member.data) !== period) return '同じ時限の授業だけを合併できます。';
    if (Array.isArray(member.data.merge_audiences) && member.data.merge_audiences.length) return 'ほかの授業の合併先になっている授業は、合併できません。先にそちらを解除してください。';
    const currentHost = clean(member.data.merge_host_shift_id);
    if (currentHost && currentHost !== hostId) return '別の授業へ合併済みの授業が含まれています。先に解除してください。';
  }
  return '';
}
