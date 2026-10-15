import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebase-admin';

const clean = (value: unknown) => String(value || '').trim();

// Only a server-managed Auth UID binding establishes profile ownership.
// Email/local-part matches are hints for administrators, not authentication proof.
async function findProfileCandidates(uid: string) {
  const db = adminDb();
  const snapshots = await Promise.all(['uid', 'id'].map(field =>
    db.collection('users').where(field, '==', uid).limit(2).get()
  ));
  const candidates = new Map<string, FirebaseFirestore.QueryDocumentSnapshot>();
  snapshots.forEach(snapshot => snapshot.docs.forEach(doc => candidates.set(doc.id, doc)));
  return Array.from(candidates.values()).filter(doc => {
    const data = doc.data();
    return (!data.uid || data.uid === uid) && (!data.id || data.id === uid);
  });
}

async function updateParentStudentLinks(role: string, oldId: string, uid: string, data: FirebaseFirestore.DocumentData) {
  if (!oldId || oldId === uid) return;
  const db = adminDb();

  if (role === 'student') {
    const parentIds = Array.isArray(data.parent_ids) ? data.parent_ids.filter(Boolean) : [data.parent_uid].filter(Boolean);
    await Promise.all(parentIds.map(parentId => db.collection('users').doc(String(parentId)).set({
      student_ids: FieldValue.arrayUnion(uid),
      updated_at: FieldValue.serverTimestamp(),
    }, { merge: true })));
  }

  if (role === 'parent') {
    const studentIds = Array.isArray(data.student_ids) ? data.student_ids.filter(Boolean) : [];
    await Promise.all(studentIds.map(studentId => db.collection('users').doc(String(studentId)).set({
      parent_ids: FieldValue.arrayUnion(uid),
      parent_uid: uid,
      updated_at: FieldValue.serverTimestamp(),
    }, { merge: true })));
  }
}

export async function repairUserProfileForAuth(uid: string, email?: string | null) {
  const db = adminDb();
  const targetRef = db.collection('users').doc(uid);
  const targetSnap = await targetRef.get();
  if (targetSnap.exists) {
    const target = targetSnap.data() || {};
    const normalizedEmail = clean(email).toLowerCase();
    const patch: Record<string, unknown> = {};
    if (target.uid !== uid) patch.uid = uid;
    if (target.id !== uid) patch.id = uid;
    if (normalizedEmail && clean(target.email).toLowerCase() !== normalizedEmail) patch.email = normalizedEmail;
    if (Object.keys(patch).length) {
      patch.updated_at = FieldValue.serverTimestamp();
      patch.identity_repaired_at = FieldValue.serverTimestamp();
      await targetRef.set(patch, { merge: true });
    }
    return { ok: true, repaired: Object.keys(patch).length > 0, uid, source_id: uid };
  }

  const candidates = await findProfileCandidates(uid);
  const source = candidates.length === 1 ? candidates[0] : undefined;
  if (!source) return { ok: false, error: 'profile-not-found' };

  const data = source.data() || {};
  const role = clean(data.role || 'student').toLowerCase();
  const normalizedEmail = clean(email || data.email).toLowerCase();

  await targetRef.create({
    ...data,
    uid,
    id: uid,
    email: normalizedEmail || data.email || null,
    migrated_from_uid: source.id,
    identity_repaired_at: FieldValue.serverTimestamp(),
    updated_at: FieldValue.serverTimestamp(),
    created_at: data.created_at || FieldValue.serverTimestamp(),
  });

  await updateParentStudentLinks(role, source.id, uid, data);
  await source.ref.delete().catch(() => {});

  return { ok: true, repaired: true, uid, source_id: source.id };
}
