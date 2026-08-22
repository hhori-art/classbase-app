import { NextRequest } from 'next/server';
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

export async function DELETE(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = await getServerUser(request);
    if (!isAdminLike(user)) throw new Error('forbidden');

    const db = adminDb();
    const slideRef = db.collection('lesson_slides').doc(params.id);
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
      db.collection('quizzes').where('source_slide_id', '==', params.id)
    );
    const deletedAttempts = await deleteQueryBatch(
      db,
      db.collection('quest_question_attempts').where('source_slide_id', '==', params.id)
    );

    const batch = db.batch();
    batch.delete(slideRef);
    if (learningUnitId) batch.delete(db.collection('learning_units').doc(learningUnitId));
    await batch.commit();

    return Response.json({
      ok: true,
      deleted_slide_id: params.id,
      deleted_quizzes: deletedQuizzes,
      deleted_attempts: deletedAttempts,
      deleted_learning_unit: Boolean(learningUnitId),
    });
  } catch (error) {
    return jsonError(error);
  }
}
