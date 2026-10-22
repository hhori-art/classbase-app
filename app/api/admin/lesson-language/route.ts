import { NextRequest } from 'next/server';
import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebase-admin';
import { getServerUser, jsonError } from '@/lib/server-auth';
import { writeAuditLog } from '@/lib/server/audit-log';
import { DEFAULT_LANGUAGE_RULES, LANGUAGE_CATEGORY_LABELS, type LessonCue } from '@/lib/lesson-language';
import { CHECKS_COLLECTION, TRANSCRIPTS_COLLECTION, checkLessonTranscript, loadLanguageRuleSettings } from '@/lib/server/lesson-transcript-check';

export const runtime = 'nodejs';

const clean = (value: unknown) => String(value ?? '').trim();
const SEVERITIES = ['high', 'medium', 'low'];

/** 講師の授業の評価にあたるため、見られるのはマスターだけ。 */
function requireMaster(user: Awaited<ReturnType<typeof getServerUser>>) {
  if (user.role !== 'master') throw new Error('forbidden');
}

/** チェック結果の一覧（直近の日数ぶん）と、言葉の設定。 */
export async function GET(request: NextRequest) {
  try {
    const user = await getServerUser(request);
    requireMaster(user);
    if (request.nextUrl.searchParams.get('rules') === '1') {
      const settings = await loadLanguageRuleSettings();
      return Response.json({
        ok: true,
        defaults: DEFAULT_LANGUAGE_RULES.map(({ id, label, category, severity }) => ({ id, label, category, severity })),
        disabled: Array.isArray(settings.disabled) ? settings.disabled : [],
        custom: Array.isArray(settings.custom) ? settings.custom : [],
      });
    }
    const days = Math.min(90, Math.max(1, Number(request.nextUrl.searchParams.get('days')) || 30));
    const since = new Date(Date.now() + 9 * 3600e3 - days * 86400e3).toISOString().slice(0, 10);
    const snap = await adminDb().collection(CHECKS_COLLECTION).where('target_date', '>=', since).orderBy('target_date', 'desc').limit(400).get();
    const checks = snap.docs.map(doc => {
      const data = doc.data() || {};
      return {
        id: doc.id,
        target_date: data.target_date || '',
        period: data.period || '',
        teacher_name: data.teacher_name || '',
        grade: data.grade || '',
        subject: data.subject || '',
        detail_subject: data.detail_subject || '',
        unit: data.unit || '',
        cue_count: Number(data.cue_count || 0),
        video_offset_seconds: Number(data.video_offset_seconds || 0),
        total: Number(data.total || 0),
        by_severity: data.by_severity || { high: 0, medium: 0, low: 0 },
        findings: Array.isArray(data.findings) ? data.findings : [],
        review_status: data.review_status || null,
        review_note: data.review_note || '',
        checked_at: data.checked_at?.toDate ? data.checked_at.toDate().toISOString() : null,
      };
    });
    return Response.json({ ok: true, days, checks });
  } catch (error) {
    return jsonError(error);
  }
}

/** 言葉の設定の保存・再チェック・確認済みの印。 */
export async function POST(request: NextRequest) {
  try {
    const user = await getServerUser(request);
    requireMaster(user);
    const body = await request.json().catch(() => ({}));
    const action = clean(body.action);
    const db = adminDb();

    if (action === 'save_rules') {
      const defaultIds = new Set(DEFAULT_LANGUAGE_RULES.map(rule => rule.id));
      const disabled = (Array.isArray(body.disabled) ? body.disabled : []).map(clean).filter((id: string) => defaultIds.has(id));
      const custom = (Array.isArray(body.custom) ? body.custom : []).slice(0, 200).map((item: any, index: number) => ({
        id: clean(item?.id).replace(/[^\w-]/g, '').slice(0, 30) || `w${Date.now().toString(36)}${index}`,
        label: clean(item?.label).slice(0, 40),
        category: Object.keys(LANGUAGE_CATEGORY_LABELS).includes(item?.category) ? item.category : 'negative',
        severity: SEVERITIES.includes(item?.severity) ? item.severity : 'medium',
      })).filter((item: { label: string }) => item.label.length >= 2);
      await db.collection('settings').doc('lesson_language_rules').set({ disabled, custom, updated_at: FieldValue.serverTimestamp(), updated_by: user.uid });
      await writeAuditLog({ actor: user, action: 'lesson_language_rules_update', target_type: 'settings', target_id: 'lesson_language_rules', details: { disabled_count: disabled.length, custom_count: custom.length } });
      return Response.json({ ok: true, disabled, custom });
    }

    const shiftId = clean(body.shift_id);
    if (!shiftId) return Response.json({ ok: false, error: '授業を選んでください。' }, { status: 400 });

    if (action === 'recheck') {
      // 保存してある文字起こしを、今の言葉の設定でもう一度確認する（Zoom からは取り直さない）。
      const [transcriptSnap, shiftSnap] = await db.getAll(db.collection(TRANSCRIPTS_COLLECTION).doc(shiftId), db.collection('shift_assignments').doc(shiftId));
      if (!transcriptSnap.exists) return Response.json({ ok: false, error: 'この授業の文字起こしが保存されていません。' }, { status: 404 });
      const cues: LessonCue[] = (transcriptSnap.data()?.cues || []).map((cue: any) => ({ start: Number(cue.s || 0), end: Number(cue.e || 0), speaker: String(cue.sp || ''), text: String(cue.t || '') }));
      const result = await checkLessonTranscript({ shiftId, shift: shiftSnap.data() || {}, cues, transcriptRecordingStart: transcriptSnap.data()?.recording_start, notify: false });
      return Response.json({ ok: true, ...result });
    }

    if (action === 'review') {
      const status = ['ok', 'follow_up', null].includes(body.status) ? body.status : null;
      await db.collection(CHECKS_COLLECTION).doc(shiftId).set({
        review_status: status,
        review_note: clean(body.note).slice(0, 500),
        reviewed_by: user.uid,
        reviewed_at: FieldValue.serverTimestamp(),
      }, { merge: true });
      return Response.json({ ok: true });
    }

    return Response.json({ ok: false, error: 'unknown action' }, { status: 400 });
  } catch (error) {
    return jsonError(error);
  }
}
