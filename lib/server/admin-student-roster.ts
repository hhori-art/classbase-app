import 'server-only';

import { unstable_cache } from 'next/cache';
import { adminDb } from '@/lib/firebase-admin';
import { canManageSchool, isAdminLike, type ServerUser } from '@/lib/server-auth';
import { toStudentSearchEntry, type StudentSearchEntry } from '@/lib/server/student-search';

/** 生徒検索用の名簿の上限（全校の生徒数より十分大きい値）。 */
const ROSTER_LIMIT = 5000;

/**
 * 管理画面の生徒検索に使う名簿。検索に必要な項目だけを select で読み、5分間すべての管理者で共有する。
 * 検索のたびに users を読まない（入力1文字ごとに呼ばれても Firestore の読取は5分に1回）。
 */
export const loadAdminStudentRoster = unstable_cache(async (): Promise<StudentSearchEntry[]> => {
  const snap = await adminDb().collection('users').where('role', '==', 'student')
    .select(
      'student_name', 'name', 'display_name', 'student_name_kana', 'name_kana', 'furigana', 'kana',
      'lifetime_id', 'login_id', 'grade', 'school_id', 'school_code', 'school_name', 'school',
      'account_status', 'status', 'is_active',
    )
    .limit(ROSTER_LIMIT).get();
  return snap.docs.map(doc => toStudentSearchEntry(doc.id, doc.data() || {}));
}, ['admin-student-roster-v1'], { revalidate: 300, tags: ['users', 'admin-student-roster'] });

/**
 * 生徒の総合ページ・生徒検索を使える管理者か（マスター、または理社講座の権限を持つ管理者）。
 * 勤怠・Booster・オンライン校だけの管理者は使えない。
 */
export function canUseStudentOverview(user: ServerUser) {
  return user.role === 'master' || (user.role === 'admin' && isAdminLike(user));
}

/** この校舎の生徒を扱えるか。マスターは全校、理社講座の管理者は担当校の生徒だけ（校舎未設定の生徒は扱えない）。 */
export function canSeeStudentSchool(user: ServerUser, school: string) {
  if (!canUseStudentOverview(user)) return false;
  if (user.role === 'master') return true;
  const target = String(school || '').trim();
  return Boolean(target) && canManageSchool(user, target);
}
