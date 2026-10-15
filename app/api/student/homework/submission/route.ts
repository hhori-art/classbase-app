import { randomUUID } from 'node:crypto';
import { NextRequest } from 'next/server';
import { FieldValue } from 'firebase-admin/firestore';
import { adminBucket, adminDb } from '@/lib/firebase-admin';
import { getServerUser, jsonError, requireRole } from '@/lib/server-auth';

export const runtime = 'nodejs';

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const ALLOWED_TYPES: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/heic': 'heic',
  'image/heif': 'heif',
};

const cleanSubjects = (value: unknown) => Array.isArray(value)
  ? value.map(item => String(item || '').trim()).filter(Boolean)
  : [];

export async function POST(request: NextRequest) {
  let uploadedPath = '';
  try {
    const user = await getServerUser(request);
    requireRole(user, ['student']);
    const form = await request.formData();
    const fields = Object.fromEntries(form.entries());
    const assignmentId = String(fields.assignment_id || '').trim();
    const comment = String(fields.comment || '').trim().slice(0, 2000);
    const image = fields.image;
    if (!assignmentId || !(image instanceof File)) {
      return Response.json({ ok: false, error: 'assignment_id and image are required' }, { status: 400 });
    }
    const extension = ALLOWED_TYPES[String(image.type || '').toLowerCase()];
    if (!extension || image.size <= 0 || image.size > MAX_IMAGE_BYTES) {
      return Response.json({ ok: false, error: '画像はJPEG・PNG・WebP・HEICの8MB以内にしてください' }, { status: 400 });
    }

    const db = adminDb();
    const assignmentRef = db.collection('homework_assignments').doc(assignmentId);
    const submissionRef = db.collection('submissions').doc(`${assignmentId}_${user.uid}`);
    const rewardRef = db.collection('coin_transactions').doc(`${user.uid}_homework_submission_${assignmentId}`.replace(/[\/\s#?]/g, '_'));
    const userRef = db.collection('users').doc(user.uid);
    const [assignmentSnapshot, submissionSnapshot] = await db.getAll(assignmentRef, submissionRef);
    if (!assignmentSnapshot.exists) return Response.json({ ok: false, error: 'not found' }, { status: 404 });
    const assignment = assignmentSnapshot.data() || {};
    const grade = String(user.profile.grade || '').trim();
    const subjects = cleanSubjects(user.profile.subjects);
    const subject = String(assignment.subject || '').trim();
    if (assignment.archived === true || assignment.status === 'archived' || !grade || String(assignment.target_grade || '').trim() !== grade || (subject && subjects.length > 0 && !subjects.includes(subject))) {
      return Response.json({ ok: false, error: 'not found' }, { status: 404 });
    }
    const existing = submissionSnapshot.data() || {};
    if (submissionSnapshot.exists && existing.status !== 'resubmit') {
      return Response.json({ ok: false, error: '提出済みの宿題です' }, { status: 409 });
    }

    const token = randomUUID();
    uploadedPath = `submissions/${assignmentId}/${user.uid}/${Date.now()}_${randomUUID()}.${extension}`;
    const bucket = adminBucket();
    const file = bucket.file(uploadedPath);
    await file.save(Buffer.from(await image.arrayBuffer()), {
      resumable: false,
      validation: 'crc32c',
      metadata: {
        contentType: image.type,
        metadata: {
          firebaseStorageDownloadTokens: token,
          ownerUid: user.uid,
          assignmentId,
        },
      },
    });
    const imageUrl = `https://firebasestorage.googleapis.com/v0/b/${encodeURIComponent(bucket.name)}/o/${encodeURIComponent(uploadedPath)}?alt=media&token=${encodeURIComponent(token)}`;

    const rewardApplied = await db.runTransaction(async transaction => {
      const [latestAssignment, latestSubmission, latestReward] = await transaction.getAll(assignmentRef, submissionRef, rewardRef);
      if (!latestAssignment.exists) throw new Error('assignment-not-found');
      if (latestSubmission.exists && latestSubmission.data()?.status !== 'resubmit') throw new Error('already-submitted');
      transaction.set(submissionRef, {
        assignment_id: assignmentId,
        student_id: user.uid,
        student_name: user.profile.student_name || user.profile.name || '生徒',
        imageUrl,
        storage_path: uploadedPath,
        comment,
        status: 'submitted',
        submitted_at: new Date().toISOString(),
        submitted_at_server: FieldValue.serverTimestamp(),
        feedback: null,
        teacher_comment: null,
        stamp_url: null,
        updated_at: FieldValue.serverTimestamp(),
      }, { merge: false });
      if (!latestReward.exists) {
        transaction.set(rewardRef, {
          user_id: user.uid,
          amount: 50,
          reason: '宿題提出',
          actor_id: user.uid,
          source: 'homework_submission',
          source_id: assignmentId,
          metadata: { assignment_id: assignmentId },
          created_at: FieldValue.serverTimestamp(),
        });
        transaction.set(userRef, {
          coins: FieldValue.increment(50),
          total_coins: FieldValue.increment(50),
          homework_count: FieldValue.increment(1),
          earned_badges: FieldValue.arrayUnion('badge_pencil'),
          updated_at: FieldValue.serverTimestamp(),
        }, { merge: true });
      }
      return !latestReward.exists;
    });

    return Response.json({ ok: true, submission_id: submissionRef.id, image_url: imageUrl, reward_applied: rewardApplied });
  } catch (error) {
    if (uploadedPath) await adminBucket().file(uploadedPath).delete({ ignoreNotFound: true }).catch(() => undefined);
    return jsonError(error);
  }
}
