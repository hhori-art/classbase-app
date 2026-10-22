import 'server-only';

import type { ServerUser } from '@/lib/server-auth';
import { jstDateKey } from '@/lib/date-key';

const cleanList = (value: unknown) => Array.isArray(value)
  ? value.map(item => String(item || '').trim()).filter(Boolean)
  : [];

const globalGrades = new Set(['', '全学年', '共通', 'その他']);
const globalSubjects = new Set(['', '全科目', '共通']);

export function canAccessClassRecording(user: ServerUser, recording: FirebaseFirestore.DocumentData) {
  if (recording.archived === true || recording.is_active === false || ['archived', 'draft', 'private', 'stopped'].includes(String(recording.status || '').toLowerCase())) return false;
  if (user.role === 'teacher' || user.role === 'admin' || user.role === 'master') return true;
  if (user.role !== 'student') return false;

  const targetDate = String(recording.target_date || '').slice(0, 10);
  const today = jstDateKey();
  const hasValidTargetDate = /^\d{4}-\d{2}-\d{2}$/.test(targetDate);
  if (hasValidTargetDate && targetDate > today) return false;
  const isPastRecording = hasValidTargetDate && targetDate < today;
  const grade = String(user.profile.grade || '').trim();
  const targetGrade = String(recording.grade || recording.target_grade || '').trim();
  if (!isPastRecording && !globalGrades.has(targetGrade) && (!grade || targetGrade !== grade)) return false;

  const subjects = cleanList(user.profile.subjects);
  const targetSubject = String(recording.subject || recording.target_subject || '').trim();
  if (!globalSubjects.has(targetSubject) && subjects.length > 0 && !subjects.includes(targetSubject)) return false;

  const targetSchools = cleanList(recording.school_ids).concat(cleanList(recording.school_id ? [recording.school_id] : []));
  if (targetSchools.length > 0) {
    const schools = new Set([user.school, ...user.school_ids, user.profile.school, user.profile.school_id, user.profile.school_code]
      .map(value => String(value || '').trim()).filter(Boolean));
    if (!targetSchools.some(school => schools.has(school))) return false;
  }
  return true;
}
