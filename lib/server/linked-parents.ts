import 'server-only';

const clean = (value: unknown) => String(value || '').trim();

/** 生徒プロフィールに記録された保護者（parent_ids / parent_uid）と、追加で見つかった保護者をまとめる。 */
export function linkedParentIds(student: FirebaseFirestore.DocumentData, extra: string[] = []) {
  const ids = Array.isArray(student.parent_ids) ? student.parent_ids.map(clean) : [];
  return Array.from(new Set([...ids, clean(student.parent_uid), ...extra.map(clean)].filter(Boolean)));
}

/** 保護者側の student_ids にだけ登録されている保護者も通知先に含める（最大10人）。 */
export async function loadParentIdsListingStudent(db: FirebaseFirestore.Firestore, studentId: string) {
  if (!studentId) return [] as string[];
  const snap = await db.collection('users').where('student_ids', 'array-contains', studentId).limit(10).get();
  return snap.docs
    .filter(doc => clean(doc.data()?.role) === 'parent')
    .map(doc => doc.id);
}
