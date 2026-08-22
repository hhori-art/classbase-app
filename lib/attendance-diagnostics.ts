import 'server-only';

export const normalizeAttendanceName = (value: unknown) =>
  String(value || '')
    .replace(/\r?\n/g, ' ')
    .replace(/先生(?:\s*)$/g, '')
    .replace(/様(?:\s*)$/g, '')
    .replace(/[　\s]/g, '')
    .replace(/[()（）【】\[\]・･]/g, '')
    .toLowerCase();

export const shiftMatchesTeacher = (shift: any, teacher: { uid: string; name: string }) => {
  if (shift?.user_id && shift.user_id === teacher.uid) return true;
  const shiftName = normalizeAttendanceName(shift?.teacher_name);
  const teacherName = normalizeAttendanceName(teacher.name);
  return Boolean(shiftName && teacherName && shiftName === teacherName);
};

export function buildAttendanceWarnings(record: any, shifts: any[] = []) {
  const warnings: Array<{ code: string; label: string; severity: 'info' | 'warning' | 'danger'; detail: string }> = [];
  const hasEnded = Boolean(record?.end_time);
  const segments = Array.isArray(record?.work_segments) ? record.work_segments : [];
  const workSegments = segments.filter((seg: any) => seg?.type !== 'break' && seg?.start && seg?.end);
  const transport = Array.isArray(record?.transportation) ? record.transportation : [];
  const transportTotal = transport.reduce((sum: number, item: any) => sum + (Number(item?.cost) || 0), 0);
  const recordName = normalizeAttendanceName(record?.teacher_name);

  if (hasEnded && workSegments.length === 0) {
    warnings.push({
      code: 'missing_detail',
      label: '業務詳細未入力',
      severity: 'danger',
      detail: '退勤済みですが、授業・事務・サポートなどの業務詳細が入力されていません。',
    });
  }

  if (hasEnded && transportTotal <= 0) {
    warnings.push({
      code: 'missing_transportation',
      label: '交通費未入力',
      severity: 'warning',
      detail: '勤務記録に交通費が登録されていません。不要な場合以外は入力してください。',
    });
  }

  const exactShift = shifts.find(shift => shift?.user_id && shift.user_id === record?.teacher_id);
  const nameShift = shifts.find(shift => normalizeAttendanceName(shift?.teacher_name) === recordName);
  if (nameShift && nameShift.user_id && nameShift.user_id !== record?.teacher_id) {
    warnings.push({
      code: 'shift_user_mismatch',
      label: '講師配置ID不一致',
      severity: 'danger',
      detail: `講師配置の名前は一致していますが、紐づくUIDが勤怠記録と異なります。配置側: ${nameShift.teacher_name || '名称未設定'}`,
    });
  }
  if (exactShift && normalizeAttendanceName(exactShift.teacher_name) && normalizeAttendanceName(exactShift.teacher_name) !== recordName) {
    warnings.push({
      code: 'shift_name_mismatch',
      label: '講師名不一致',
      severity: 'warning',
      detail: `同じUIDの講師配置名「${exactShift.teacher_name || '未設定'}」と勤怠名「${record?.teacher_name || '未設定'}」が異なります。`,
    });
  }

  return warnings;
}
