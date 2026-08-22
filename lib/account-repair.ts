import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebase-admin';

const EMAIL_DOMAINS = ['classbase.local', 'sozogakuen.co.jp'];

const clean = (value: unknown) => String(value || '').trim();

const emailLocalPart = (email?: string | null) => {
  const normalized = clean(email).toLowerCase();
  if (!normalized.includes('@')) return normalized;
  return normalized.split('@')[0] || '';
};

const unique = <T>(items: T[]) => Array.from(new Set(items.filter(Boolean)));

const loginCandidatesFromEmail = (email?: string | null) => {
  const normalizedEmail = clean(email).toLowerCase();
  const local = emailLocalPart(normalizedEmail);
  const localVariants = unique([local, local.toLowerCase(), local.toUpperCase()]);
  return unique([
    normalizedEmail,
    ...localVariants,
    ...localVariants.flatMap(candidate => EMAIL_DOMAINS.map(domain => candidate ? `${candidate}@${domain}` : '')),
  ]);
};

const passwordFields = ['initial_password', 'raw_password', 'password'];

function candidateScore(docId: string, data: FirebaseFirestore.DocumentData, uid: string, email: string) {
  let score = 0;
  const normalizedEmail = clean(email).toLowerCase();
  if (docId === uid) score += 1000;
  if (clean(data.uid) === uid || clean(data.id) === uid) score += 100;
  if (clean(data.email).toLowerCase() === normalizedEmail) score += 50;
  if ((data.account_status || data.status || 'active') === 'active') score += 10;
  if (data.role) score += 5;
  if (passwordFields.some(key => data[key])) score += 3;
  return score;
}

async function findProfileCandidates(uid: string, email?: string | null) {
  const db = adminDb();
  const candidates = new Map<string, FirebaseFirestore.QueryDocumentSnapshot>();
  const direct = await db.collection('users').doc(uid).get();
  if (direct.exists) candidates.set(direct.id, direct as FirebaseFirestore.QueryDocumentSnapshot);

  for (const login of loginCandidatesFromEmail(email)) {
    const queries = [
      db.collection('users').where('email', '==', login).limit(10).get(),
      db.collection('users').where('lifetime_id', '==', login).limit(10).get(),
      db.collection('users').where('initial_login_id', '==', login).limit(10).get(),
    ];

    if (/^\d+$/.test(login)) {
      queries.push(db.collection('users').where('lifetime_id', '==', Number(login)).limit(10).get());
    }

    const snaps = await Promise.all(queries);
    snaps.forEach(snap => snap.docs.forEach(doc => candidates.set(doc.id, doc)));
  }

  return Array.from(candidates.values()).sort((a, b) =>
    candidateScore(b.id, b.data(), uid, clean(email).toLowerCase()) -
    candidateScore(a.id, a.data(), uid, clean(email).toLowerCase())
  );
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

  const candidates = await findProfileCandidates(uid, email);
  const source = candidates.find(doc => doc.id !== uid);
  if (!source) return { ok: false, error: 'profile-not-found' };

  const data = source.data() || {};
  const role = clean(data.role || 'student').toLowerCase();
  const normalizedEmail = clean(email || data.email).toLowerCase();

  await targetRef.set({
    ...data,
    uid,
    id: uid,
    email: normalizedEmail || data.email || null,
    migrated_from_uid: source.id,
    identity_repaired_at: FieldValue.serverTimestamp(),
    updated_at: FieldValue.serverTimestamp(),
    created_at: data.created_at || FieldValue.serverTimestamp(),
  }, { merge: true });

  await updateParentStudentLinks(role, source.id, uid, data);
  await source.ref.delete().catch(() => {});

  return { ok: true, repaired: true, uid, source_id: source.id };
}
