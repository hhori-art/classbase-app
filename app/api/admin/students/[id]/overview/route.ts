import { NextRequest } from 'next/server';
import { FieldPath } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebase-admin';
import { getServerUser, jsonError } from '@/lib/server-auth';
import { attendanceSchoolName } from '@/lib/attendance-schools';
import { jstDateKey } from '@/lib/date-key';
import { studySummaryForRange } from '@/lib/monoxer-study';
import { canSeeStudentSchool, canUseStudentOverview } from '@/lib/server/admin-student-roster';
import { linkedParentIds, loadParentIdsListingStudent } from '@/lib/server/linked-parents';
import { studentSchoolValue, toStudentSearchEntry } from '@/lib/server/student-search';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * 生徒の総合ページ（生徒1人の状況を1画面で見る）。
 * 各項目は件数を決めて読み（10〜20件）、1つが失敗しても他の項目は返す（{ ok: false } で失敗を知らせる）。
 * 教室への連絡・AIチャット安全アラートは専用画面がマスター専用なので、マスターにだけ返す（読みもしない）。
 */

const RECENT_LIMIT = 10;
const ATTENDANCE_DAYS = 60;
const MAX_PARENTS = 5;
const MASTER_ONLY_SECTIONS = ['parent_contacts', 'safety_alerts'] as const;

const clean = (value: unknown, max = 300) => String(value ?? '').trim().slice(0, max);
const millis = (value: any) => value?.toMillis?.() || value?.toDate?.()?.getTime?.() || (value ? new Date(value).getTime() : 0) || 0;
const iso = (value: any) => { const ms = millis(value); return ms ? new Date(ms).toISOString() : null; };
const daysAgoKey = (days: number) => jstDateKey(new Date(Date.now() - days * 86_400_000));

type Section<T> = { ok: true; data: T } | { ok: false; error: string };

async function section<T>(name: string, load: () => Promise<T>): Promise<Section<T>> {
  try {
    return { ok: true, data: await load() };
  } catch (error) {
    console.warn(`[admin/students/overview] ${name} failed`, error);
    return { ok: false, error: 'load-failed' };
  }
}

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await getServerUser(request);
    if (!canUseStudentOverview(user)) throw new Error('forbidden');
    const { id: rawId } = await context.params;
    const studentId = clean(decodeURIComponent(rawId || ''), 200);
    if (!studentId || studentId.includes('/')) return Response.json({ ok: false, error: 'invalid id' }, { status: 400 });

    const db = adminDb();
    const studentSnap = await db.collection('users').doc(studentId).get();
    const student = studentSnap.data() || {};
    if (!studentSnap.exists || clean(student.role, 40) !== 'student') {
      return Response.json({ ok: false, error: 'not-found' }, { status: 404 });
    }
    // 担当外の生徒は存在も分からないように forbidden にする。
    if (!canSeeStudentSchool(user, studentSchoolValue(student))) throw new Error('forbidden');
    const isMaster = user.role === 'master';

    const parentIdsPromise = loadParentIdsListingStudent(db, studentId)
      .catch(() => [] as string[])
      .then(extra => linkedParentIds(student, extra).slice(0, MAX_PARENTS));

    const [profile, requests, parentContacts, safetyAlerts, coins, attendance, recordings, monoxer] = await Promise.all([
      section('profile', async () => {
        const entry = toStudentSearchEntry(studentId, student);
        const [registrationSnap, parentIds] = await Promise.all([
          db.collection('course_registrations').where('student_id', '==', studentId).limit(20).get(),
          parentIdsPromise,
        ]);
        const registrations = registrationSnap.docs
          .map(doc => ({ id: doc.id, ...doc.data() } as Record<string, any>))
          .filter(item => item.is_current === true || item.current === true)
          .map(item => ({
            id: item.id,
            type: clean(item.registration_type, 40) || 'regular',
            year: Number(item.year) || null,
            term: clean(item.term, 40),
            labels: (Array.isArray(item.selected_course_labels) ? item.selected_course_labels : []).map((label: unknown) => clean(label, 120)).filter(Boolean).slice(0, 20),
            status: clean(item.status || item.approval_status, 40),
            updated_at: iso(item.updated_at),
          }));
        const parentDocs = parentIds.length ? await db.getAll(...parentIds.map(id => db.collection('users').doc(id))) : [];
        const parents = parentDocs
          .filter(doc => doc.exists && ['parent', 'guardian'].includes(clean(doc.data()?.role, 40)))
          .map(doc => {
            const data = doc.data() || {};
            return {
              id: doc.id,
              name: clean(data.parent_name || data.name || data.display_name, 120) || '保護者',
              login_id: clean(data.lifetime_id || data.login_id, 120),
              line_linked: Boolean(data.line_user_id),
              inactive: ['suspended', 'withdrawn', 'archived'].includes(clean(data.account_status || data.status, 40).toLowerCase()),
            };
          });
        return {
          id: studentId,
          name: entry.name,
          kana: entry.kana,
          grade: entry.grade,
          school: entry.school,
          school_name: attendanceSchoolName(entry.school) || entry.school,
          lifetime_id: entry.lifetime_id || entry.login_id,
          inactive: entry.inactive,
          account_status: clean(student.account_status || student.status, 40),
          created_at: iso(student.created_at),
          last_login_at: iso(student.last_login_at || student.lastLoginAt),
          registrations,
          fallback_course_labels: registrations.length ? [] : (Array.isArray(student.selected_course_labels) ? student.selected_course_labels : []).map((label: unknown) => clean(label, 120)).filter(Boolean).slice(0, 20),
          parents,
        };
      }),

      section('requests', async () => {
        // 複合インデックス requests(user_id, type, target_date DESC) を使う。
        const [absence, transfer] = await Promise.all((['absence', 'transfer'] as const).map(type => db.collection('requests')
          .where('user_id', '==', studentId).where('type', '==', type)
          .orderBy('target_date', 'desc').limit(RECENT_LIMIT).get()));
        const toItem = (doc: FirebaseFirestore.QueryDocumentSnapshot, type: 'absence' | 'transfer') => {
          const data = doc.data() || {};
          return {
            id: doc.id,
            type,
            kind: clean(data.absence_type || data.kind, 40),
            target_date: clean(data.target_date, 10),
            absence_date: clean(data.absence_date, 10),
            subject: clean(data.transfer_subject || data.subject || data.target_subject, 80),
            course_name: clean(data.transfer_course_name || data.course_name, 120),
            reason: clean(data.reason, 200),
            status: clean(data.status, 40),
            transfer_status: clean(data.transfer_status, 40),
            created_at: iso(data.created_at),
          };
        };
        return {
          absences: absence.docs.map(doc => toItem(doc, 'absence')),
          transfers: transfer.docs.map(doc => toItem(doc, 'transfer')),
        };
      }),

      isMaster ? section('parent_contacts', async () => {
        const parentIds = await parentIdsPromise;
        // 生徒を選んだ連絡（student_id）と、生徒を選ばずに保護者が送った連絡（parent_id、生徒未指定のものだけ）。
        const [byStudent, ...byParent] = await Promise.all([
          db.collection('parent_inquiries').where('student_id', '==', studentId).limit(20).get(),
          ...parentIds.slice(0, 3).map(parentId => db.collection('parent_inquiries')
            .where('parent_id', '==', parentId).orderBy('updated_at', 'desc').limit(RECENT_LIMIT).get()),
        ]);
        const threads = new Map<string, Record<string, any>>();
        byStudent.docs.forEach(doc => threads.set(doc.id, doc.data() || {}));
        byParent.flatMap(snap => snap.docs).forEach(doc => {
          const data = doc.data() || {};
          if (!clean(data.student_id) || clean(data.student_id) === studentId) threads.set(doc.id, data);
        });
        return Array.from(threads, ([id, data]) => ({
          id,
          subject: clean(data.subject, 120) || '教室への連絡',
          parent_name: clean(data.parent_name, 120),
          status: clean(data.status, 40),
          message_count: Number(data.message_count) || (Array.isArray(data.messages) ? data.messages.length : 0),
          unread_for_admin: data.unread_for_admin === true,
          updated_at: iso(data.updated_at || data.created_at),
        }))
          .sort((a, b) => String(b.updated_at || '').localeCompare(String(a.updated_at || '')))
          .slice(0, RECENT_LIMIT);
      }) : null,

      isMaster ? section('safety_alerts', async () => {
        // student_id の等価条件だけ（単一フィールドの自動インデックス）。並べ替えは取得後に行う。
        const snap = await db.collection('safety_alerts').where('student_id', '==', studentId).limit(20).get();
        return snap.docs
          .map(doc => {
            const data = doc.data() || {};
            return {
              id: doc.id,
              category_label: clean(data.category_label || data.category, 60),
              severity: clean(data.severity, 20),
              status: clean(data.status, 20),
              occurrence_count: Number(data.occurrence_count) || 1,
              created_at: iso(data.created_at),
              last_detected_at: iso(data.last_detected_at || data.created_at),
            };
          })
          .sort((a, b) => String(b.last_detected_at || '').localeCompare(String(a.last_detected_at || '')))
          .slice(0, RECENT_LIMIT);
      }) : null,

      section('coins', async () => {
        // 複合インデックス coin_transactions(user_id, created_at DESC) を使う。
        const snap = await db.collection('coin_transactions').where('user_id', '==', studentId)
          .orderBy('created_at', 'desc').limit(RECENT_LIMIT).get();
        return {
          balance: Number(student.coins) || 0,
          total_earned: Number(student.total_coins) || 0,
          transactions: snap.docs.map(doc => {
            const data = doc.data() || {};
            return { id: doc.id, amount: Number(data.amount) || 0, reason: clean(data.reason, 200), source: clean(data.source, 60), created_at: iso(data.created_at) };
          }),
        };
      }),

      section('attendance', async () => {
        // 出席のドキュメントIDは「生徒ID_日付」。直近60日をIDの範囲で新しい順に最大15日分読む。
        const fromDate = daysAgoKey(ATTENDANCE_DAYS);
        const snap = await db.collection('attendance')
          .where(FieldPath.documentId(), '>=', `${studentId}_${fromDate}`)
          .where(FieldPath.documentId(), '<=', `${studentId}_9999`)
          .orderBy(FieldPath.documentId(), 'desc')
          .limit(15).get();
        return snap.docs
          .map(doc => {
            const data = doc.data() || {};
            const owner = clean(data.user_id || data.student_id, 200);
            if (owner && owner !== studentId) return null;
            const type = clean(data.type || data.status || data.attendance_status, 40);
            const participations = Array.isArray(data.participations) && data.participations.length
              ? data.participations
              : [{ subject: data.subject, course_name: data.course_name }];
            return {
              id: doc.id,
              date: clean(data.target_date || data.date, 10),
              absent: type === 'absent' || type === 'absence',
              subjects: Array.from(new Set(participations.map((item: any) => clean(item?.subject || item?.course_name, 80)).filter(Boolean))).slice(0, 6),
              joined_at: iso(data.joined_at || data.created_at),
            };
          })
          .filter(Boolean)
          .sort((a, b) => String(b!.date).localeCompare(String(a!.date)));
      }),

      section('recordings', async () => {
        // 複合インデックス recording_views(user_id, updated_at DESC) を使う。
        const snap = await db.collection('recording_views').where('user_id', '==', studentId)
          .orderBy('updated_at', 'desc').limit(RECENT_LIMIT).get();
        const recordingIds = Array.from(new Set(snap.docs.map(doc => clean(doc.data()?.recording_id, 300)).filter(id => id && !id.includes('/'))));
        const recordingDocs = recordingIds.length ? await db.getAll(...recordingIds.map(id => db.collection('class_recordings').doc(id))) : [];
        const recordingMap = new Map(recordingDocs.filter(doc => doc.exists).map(doc => [doc.id, doc.data() || {}]));
        return snap.docs.map(doc => {
          const view = doc.data() || {};
          const recording = recordingMap.get(clean(view.recording_id, 300)) || {};
          return {
            id: doc.id,
            recording_id: clean(view.recording_id, 300),
            title: clean(recording.title || recording.topic || recording.unit, 160),
            subject: clean(recording.subject || recording.target_subject, 80),
            target_date: clean(recording.target_date, 10),
            watched_seconds: Number(view.watched_seconds) || 0,
            duration_seconds: Number(view.duration_seconds || recording.duration_seconds) || 0,
            completed: view.completed === true,
            updated_at: iso(view.updated_at),
          };
        });
      }),

      section('monoxer', async () => {
        const snap = await db.collection('pf_study_progress').doc(studentId).get();
        if (!snap.exists) return { imported: false, week: null, month: null, history: [] };
        const progress = snap.data() || {};
        const today = jstDateKey();
        const history = Array.isArray(progress.history) ? progress.history : [];
        return {
          imported: true,
          week: studySummaryForRange(progress, daysAgoKey(6), today),
          month: studySummaryForRange(progress, daysAgoKey(29), today),
          history: history.slice(-8).reverse().map((entry: any) => ({
            date: clean(entry?.date, 10),
            total: Number(entry?.total) || 0,
            gained: entry?.gained === null || entry?.gained === undefined ? null : Number(entry.gained) || 0,
          })),
        };
      }),
    ]);

    return Response.json({
      ok: true,
      viewer: { is_master: isMaster },
      hidden_sections: isMaster ? [] : MASTER_ONLY_SECTIONS,
      sections: {
        profile,
        requests,
        coins,
        attendance,
        recordings,
        monoxer,
        ...(isMaster ? { parent_contacts: parentContacts, safety_alerts: safetyAlerts } : {}),
      },
    }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    return jsonError(error);
  }
}
