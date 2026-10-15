import { NextRequest } from 'next/server';
import { adminDb } from '@/lib/firebase-admin';
import { getServerUser, jsonError, requireRole } from '@/lib/server-auth';
import { consumeRateLimit } from '@/lib/server/password-recovery';
import { createQuestSession, publicQuestion, selectPrebuiltQuestions } from '@/lib/server/quest-session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const SAFE_DOCUMENT_ID = /^[^/\u0000-\u001f]{1,200}$/;

// 作成済み問題でクエストを開始する。問題がない単元は { questions: [] } を返し、
// 画面は /api/homework/adaptive（AI生成）にフォールバックする。
export async function POST(request: NextRequest) {
  try {
    const user = await getServerUser(request);
    requireRole(user, ['student']);
    const body = await request.json().catch(() => ({}));
    const learningUnitId = String(body.learning_unit_id || '').trim();
    if (!SAFE_DOCUMENT_ID.test(learningUnitId)) {
      return Response.json({ ok: false, error: '学習単元IDを確認してください' }, { status: 400 });
    }
    if (!(await consumeRateLimit(`quest_session_hour_${user.uid}`, 60, 60 * 60 * 1000))) {
      return Response.json({ ok: false, error: '短時間に利用が集中しています。しばらく待ってから再度お試しください' }, { status: 429 });
    }

    const unitSnap = await adminDb().collection('learning_units').doc(learningUnitId).get();
    if (!unitSnap.exists) return Response.json({ ok: false, error: 'learning unit not found' }, { status: 404 });
    const unit = unitSnap.data() || {};
    const selection = await selectPrebuiltQuestions(user.uid, {
      source_slide_id: String(unit.source_slide_id || ''),
      learning_unit_id: learningUnitId,
      unit_name: String(unit.unit_name || unit.name || ''),
    });
    if (!selection) return Response.json({ ok: true, session_id: '', questions: [] });

    const sessionId = await createQuestSession(user.uid, selection.meta, selection.questions);
    return Response.json({
      ok: true,
      session_id: sessionId,
      questions: selection.questions.map(question => publicQuestion(question, selection.meta.source_slide_id)),
    }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    return jsonError(error);
  }
}
