import { NextRequest } from 'next/server';
import { adminDb } from '@/lib/firebase-admin';
import { getServerUser, jsonError } from '@/lib/server-auth';
import { requireAdminApp } from '@/lib/admin-app-access';
import { writeAuditLog } from '@/lib/server/audit-log';
import { DEFAULT_LESSON_ANALYSIS_RULES, DEFAULT_RUBRIC, normalizeLessonAnalysisRules, normalizeRubric, overallScore } from '@/lib/lesson-analysis';
import { ANALYSES_COLLECTION, ANALYSIS_SETTINGS_DOCUMENT, analyzeShiftLesson, loadLessonAnalysisSettings } from '@/lib/server/lesson-analysis';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const clean = (value: unknown) => String(value ?? '').trim();
const toIso = (value: any) => (typeof value?.toDate === 'function' ? value.toDate().toISOString() : null);

/**
 * 授業の振り返り（理社講座の管理者）。
 * GET：一覧（?days=）／1件（?id=）／設定（?settings=1）。POST：作り直し（rerun / rerun_failed）、設定の保存（マスターだけ）。
 */
export async function GET(request: NextRequest) {
  try {
    const user = await getServerUser(request);
    requireAdminApp(user, 'science_social');
    const db = adminDb();
    const params = request.nextUrl.searchParams;
    const id = clean(params.get('id'));
    if (id) {
      const snap = await db.collection(ANALYSES_COLLECTION).doc(id).get();
      if (!snap.exists) return Response.json({ ok: false, error: 'not-found' }, { status: 404 });
      const data = snap.data() || {};
      // 総合点を足す前に作った振り返りは、観点のレベルからその場で出す
      return Response.json({ ok: true, analysis: { id: snap.id, ...data, overall_score: data.overall_score ?? overallScore(data.levels), analyzed_at: toIso(data.analyzed_at) } }, { headers: { 'Cache-Control': 'private, no-store' } });
    }
    if (params.get('settings') === '1') {
      const settings = await loadLessonAnalysisSettings();
      return Response.json({ ok: true, ...settings, defaults: { rules: DEFAULT_LESSON_ANALYSIS_RULES, rubric: DEFAULT_RUBRIC }, can_edit: user.role === 'master' });
    }
    const days = Math.min(120, Math.max(1, Number(params.get('days')) || 30));
    const since = new Date(Date.now() + 9 * 3600e3 - days * 86400e3).toISOString().slice(0, 10);
    const snap = await db.collection(ANALYSES_COLLECTION).where('target_date', '>=', since)
      .select('target_date', 'period', 'teacher_id', 'teacher_name', 'grade', 'subject', 'detail_subject', 'unit', 'status', 'reason', 'duration_sec', 'levels', 'overall_score', 'metrics', 'camera', 'evaluation.summary', 'analyzed_at')
      .limit(1000).get();
    const items = snap.docs.map(doc => {
      const data = doc.data() || {};
      return { id: doc.id, ...data, overall_score: data.overall_score ?? overallScore(data.levels), analyzed_at: toIso(data.analyzed_at) };
    }).sort((a: any, b: any) => String(b.target_date).localeCompare(String(a.target_date)) || String(a.period).localeCompare(String(b.period)));
    return Response.json({ ok: true, days, items }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await getServerUser(request);
    requireAdminApp(user, 'science_social');
    const body = await request.json().catch(() => ({}));
    const action = clean(body.action);
    const db = adminDb();
    if (action === 'rerun') {
      const shiftId = clean(body.shift_id);
      if (!shiftId) return Response.json({ ok: false, error: 'shift_id-required' }, { status: 400 });
      return Response.json({ ok: true, ...(await analyzeShiftLesson(shiftId)) });
    }
    if (action === 'rerun_failed') {
      const snap = await db.collection(ANALYSES_COLLECTION).where('status', '==', 'failed').limit(30).get();
      const settings = await loadLessonAnalysisSettings();
      const results = [];
      for (const doc of snap.docs) results.push(await analyzeShiftLesson(doc.id, { settings }));
      return Response.json({ ok: true, rerun: results.length, done: results.filter(item => item.status === 'done').length });
    }
    if (action === 'save_settings') {
      if (user.role !== 'master') throw new Error('forbidden');
      const settings = {
        rules: normalizeLessonAnalysisRules(body.rules),
        rubric: normalizeRubric(body.rubric),
        disabled_teacher_ids: (Array.isArray(body.disabled_teacher_ids) ? body.disabled_teacher_ids : []).map(clean).filter(Boolean).slice(0, 500),
      };
      await db.collection('settings').doc(ANALYSIS_SETTINGS_DOCUMENT).set({ ...settings, updated_at: new Date().toISOString(), updated_by: user.uid });
      await writeAuditLog({ actor: user, action: 'lesson_analysis_settings_update', target_type: 'settings', target_id: ANALYSIS_SETTINGS_DOCUMENT, details: { disabled_teachers: settings.disabled_teacher_ids.length } });
      return Response.json({ ok: true, ...settings });
    }
    return Response.json({ ok: false, error: 'unknown-action' }, { status: 400 });
  } catch (error) {
    return jsonError(error);
  }
}
