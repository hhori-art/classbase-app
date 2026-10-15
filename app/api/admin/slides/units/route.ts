import { NextRequest } from 'next/server';
import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebase-admin';
import { getServerUser, isAdminLike, jsonError } from '@/lib/server-auth';

export const runtime = 'nodejs';

const GRADES = new Set(['中1', '中2', '中3']);
const SUBJECTS = new Set(['物理', '化学', '生物', '地学', '地理', '歴史', '公民', '漢字', '語句', '古文単語', '文法']);

function categoryFromSubject(subject: string) {
  if (['物理', '化学', '生物', '地学'].includes(subject)) return 'science';
  if (['地理', '歴史', '公民'].includes(subject)) return 'society';
  return 'japanese';
}

function text(value: unknown, max: number) {
  return String(value || '').trim().slice(0, max);
}

export async function POST(request: NextRequest) {
  try {
    const user = await getServerUser(request);
    if (!isAdminLike(user)) throw new Error('forbidden');
    const body = await request.json();
    const grade = text(body.grade, 10);
    const subject = text(body.subject, 20);
    const unitName = text(body.unit_name, 120);
    const content = text(body.content, 250_000);
    const term = text(body.term, 40);
    const year = text(body.year, 4);
    const month = text(body.month, 20);
    const tags = Array.isArray(body.tags)
      ? body.tags.map((value: unknown) => text(value, 30)).filter(Boolean).slice(0, 20)
      : [];

    if (!GRADES.has(grade) || !SUBJECTS.has(subject) || !unitName || !content) {
      return Response.json({ ok: false, error: '学年・科目・単元名・本文を確認してください' }, { status: 400 });
    }
    if (!/^20\d{2}$/.test(year)) {
      return Response.json({ ok: false, error: '年度は西暦4桁で入力してください' }, { status: 400 });
    }

    const db = adminDb();
    const unitRef = db.collection('learning_units').doc();
    const auditRef = db.collection('admin_audit_logs').doc();
    const now = FieldValue.serverTimestamp();
    const batch = db.batch();
    batch.set(unitRef, {
      grade,
      subject,
      category: categoryFromSubject(subject),
      unit_name: unitName,
      content,
      term: term || null,
      year,
      month: month || null,
      tags,
      source_type: 'manual',
      created_by: user.uid,
      created_by_role: user.role,
      created_at: now,
      updated_at: now,
    });
    batch.set(auditRef, {
      action: 'learning_unit.create',
      target_type: 'learning_unit',
      target_id: unitRef.id,
      actor_uid: user.uid,
      actor_role: user.role,
      created_at: now,
    });
    await batch.commit();
    return Response.json({ ok: true, id: unitRef.id });
  } catch (error) {
    return jsonError(error);
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const user = await getServerUser(request);
    if (!isAdminLike(user)) throw new Error('forbidden');
    const body = await request.json();
    const id = text(body.id, 200);
    if (!id || id.includes('/')) return Response.json({ ok: false, error: 'invalid-id' }, { status: 400 });

    const db = adminDb();
    const unitRef = db.collection('learning_units').doc(id);
    const [unitSnap] = await db.getAll(unitRef);
    if (!unitSnap.exists) return Response.json({ ok: false, error: 'not-found' }, { status: 404 });
    const unit = unitSnap.data() || {};
    if (unit.source_slide_id || unit.source_type === 'pptx') {
      return Response.json({ ok: false, error: 'PPTX連携単元はPPTX側から削除してください' }, { status: 409 });
    }

    const linkedQuizzes = await db.collection('quizzes').where('source_learning_unit_id', '==', id).limit(450).get();
    if (linkedQuizzes.size >= 450) {
      return Response.json({ ok: false, error: '関連問題が多いため削除できません' }, { status: 409 });
    }
    const auditRef = db.collection('admin_audit_logs').doc();
    const batch = db.batch();
    linkedQuizzes.docs.forEach(doc => batch.delete(doc.ref));
    batch.delete(unitRef);
    batch.set(auditRef, {
      action: 'learning_unit.delete',
      target_type: 'learning_unit',
      target_id: id,
      actor_uid: user.uid,
      actor_role: user.role,
      deleted_quiz_count: linkedQuizzes.size,
      created_at: FieldValue.serverTimestamp(),
    });
    await batch.commit();
    return Response.json({ ok: true, deleted_quizzes: linkedQuizzes.size });
  } catch (error) {
    return jsonError(error);
  }
}
