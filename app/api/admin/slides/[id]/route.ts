import { NextRequest } from 'next/server';
import { FieldValue } from 'firebase-admin/firestore';
import { adminBucket, adminDb } from '@/lib/firebase-admin';
import { getServerUser, isAdminLike, jsonError } from '@/lib/server-auth';

export const runtime = 'nodejs';

async function deleteQueryBatch(
  db: FirebaseFirestore.Firestore,
  query: FirebaseFirestore.Query,
  limit = 450
) {
  let deleted = 0;

  while (true) {
    const snap = await query.limit(limit).get();
    if (snap.empty) break;

    const batch = db.batch();
    snap.docs.forEach(doc => batch.delete(doc.ref));
    await batch.commit();
    deleted += snap.size;

    if (snap.size < limit) break;
  }

  return deleted;
}

export async function DELETE(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const user = await getServerUser(request);
    if (!isAdminLike(user)) throw new Error('forbidden');
    if (!id || id.length > 200 || id.includes('/')) {
      return Response.json({ ok: false, error: 'invalid-id' }, { status: 400 });
    }

    const db = adminDb();
    const slideRef = db.collection('lesson_slides').doc(id);
    const slideSnap = await slideRef.get();
    if (!slideSnap.exists) {
      return Response.json({ ok: false, error: 'not-found' }, { status: 404 });
    }

    const slide = slideSnap.data() || {};
    const filePath = String(slide.file_path || '');
    const learningUnitId = String(slide.learning_unit_id || '');

    if (filePath) {
      await adminBucket().file(filePath).delete({ ignoreNotFound: true });
    }

    const deletedQuizzes = await deleteQueryBatch(
      db,
      db.collection('quizzes').where('source_slide_id', '==', id)
    );
    const deletedAttempts = await deleteQueryBatch(
      db,
      db.collection('quest_question_attempts').where('source_slide_id', '==', id)
    );

    const batch = db.batch();
    batch.delete(slideRef);
    if (learningUnitId) batch.delete(db.collection('learning_units').doc(learningUnitId));
    const auditRef = db.collection('admin_audit_logs').doc();
    batch.set(auditRef, {
      action: 'lesson_slide.delete',
      target_type: 'lesson_slide',
      target_id: id,
      actor_uid: user.uid,
      actor_role: user.role,
      file_path: filePath || null,
      deleted_quiz_count: deletedQuizzes,
      deleted_attempt_count: deletedAttempts,
      deleted_learning_unit: Boolean(learningUnitId),
      created_at: FieldValue.serverTimestamp(),
    });
    await batch.commit();

    return Response.json({
      ok: true,
      deleted_slide_id: id,
      deleted_quizzes: deletedQuizzes,
      deleted_attempts: deletedAttempts,
      deleted_learning_unit: Boolean(learningUnitId),
    });
  } catch (error) {
    return jsonError(error);
  }
}
