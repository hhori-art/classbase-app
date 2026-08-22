// app/api/admin/users/route.ts
import { NextResponse } from 'next/server';
import { NextRequest } from 'next/server';
import { adminAuth, adminDb } from '@/lib/firebase-admin';
import { canManageSchool, getServerUser, jsonError, requireMaster, ServerUser } from '@/lib/server-auth';
import { generateInitialPassword } from '@/lib/password';
import {
  findAccountProfileDocs,
  normalizeAccountLoginId,
  normalizeInitialPassword,
  syncAuthAccountCredentials,
} from '@/lib/server/account-credentials';
import { normalizeEmploymentCategory } from '@/lib/employment-category';

export const runtime = 'nodejs';

const RELATED_COLLECTIONS = [
  'attendance',
  'submissions',
  'requests',
  'teacher_availability',
  'shift_assignments',
] as const;

const BATCH_LIMIT = 450; // 500未満（余裕を持たせる）
const CONCURRENCY = 8;   // 同時実行数（Vercelタイムアウト/負荷対策）

function chunk<T>(arr: T[], size: number): T[][] {
  const res: T[][] = [];
  for (let i = 0; i < arr.length; i += size) res.push(arr.slice(i, i + size));
  return res;
}

async function runWithConcurrency<T>(items: T[], limit: number, fn: (item: T) => Promise<void>) {
  const queue = [...items];
  const workers = Array.from({ length: limit }, async () => {
    while (queue.length) {
      const item = queue.shift();
      if (item === undefined) return;
      await fn(item);
    }
  });
  await Promise.all(workers);
}

/**
 * 指定コレクションから user_id == userId のドキュメントを全削除（ページング＋batch分割）
 */
async function deleteDocsByUserId(colName: string, userId: string) {
  const db = adminDb();

  let lastDoc: FirebaseFirestore.QueryDocumentSnapshot | null = null;

  while (true) {
    let q = db.collection(colName).where('user_id', '==', userId).orderBy('__name__').limit(BATCH_LIMIT);
    if (lastDoc) q = q.startAfter(lastDoc);

    const snap = await q.get();
    if (snap.empty) break;

    const batch = db.batch();
    snap.docs.forEach(d => batch.delete(d.ref));
    await batch.commit();

    lastDoc = snap.docs[snap.docs.length - 1];
    if (snap.size < BATCH_LIMIT) break;
  }
}

/**
 * 1ユーザーに紐づくデータを削除（関連コレクション→Auth→users doc）
 */
async function deleteUserData(userId: string) {
  const db = adminDb();
  const auth = adminAuth();

  // 1) 関連コレクション削除
  await Promise.all(RELATED_COLLECTIONS.map(col => deleteDocsByUserId(col, userId)));

  // 2) Authユーザー削除
  try {
    await auth.deleteUser(userId);
  } catch (e: any) {
    // admin SDK は not-found のcodeが環境で変わることがあるので広めに握る
    const msg = String(e?.message || '');
    if (!msg.toLowerCase().includes('not found')) {
      console.warn(`Auth deleteUser warning for ${userId}:`, e?.code || e);
    }
  }

  // 3) usersコレクション削除
  await db.collection('users').doc(userId).delete().catch(() => {});
}

async function getTargetUserOrThrow(userId: string, actor: ServerUser) {
  const snap = await adminDb().collection('users').doc(userId).get();
  if (!snap.exists) throw new Error('user-not-found');
  const data = snap.data() || {};
  const targetSchool = data.school_id || data.school || data.classroom || null;
  if (!canManageSchool(actor, targetSchool)) throw new Error('forbidden');
  if (data.role === 'master' && actor.role !== 'master') throw new Error('forbidden');
  return { id: snap.id, ...data };
}

export async function GET(request: NextRequest) {
  try {
    const actor = await getServerUser(request);
    requireMaster(actor);

    const { searchParams } = request.nextUrl;
    const role = String(searchParams.get('role') || '').trim();
    const requestedSchool = String(searchParams.get('school') || '').trim();
    const limitParam = Math.min(Number(searchParams.get('limit') || 200), 500);
    const school = actor.role === 'master' ? requestedSchool : actor.school_ids[0] || actor.school || '';

    let q: FirebaseFirestore.Query = adminDb().collection('users');
    if (role) q = q.where('role', '==', role);
    if (school) q = q.where('school_id', '==', school);
    q = q.limit(Number.isFinite(limitParam) ? limitParam : 200);

    const snap = await q.get();
    const users = snap.docs
      .map(doc => ({ id: doc.id, uid: doc.id, ...doc.data() }))
      .filter((item: any) => actor.role === 'master' || canManageSchool(actor, item.school_id || item.school || item.classroom || null))
      .map((item: any) => {
        const { raw_password, ...safe } = item;
        return safe;
      });

    return NextResponse.json({ success: true, users });
  } catch (error) {
    return jsonError(error);
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const actor = await getServerUser(request);
    requireMaster(actor);
    const db = adminDb();

    const { searchParams } = new URL(request.url);
    const targetId = searchParams.get('id');

    // A) 個別削除
    if (targetId) {
      await getTargetUserOrThrow(targetId, actor);
      await deleteUserData(targetId);
      return NextResponse.json({ success: true, message: '削除しました' });
    }

    // B) 生徒一括削除（最大500件ずつ）
    if (actor.role !== 'master') throw new Error('forbidden');
    const snap = await db.collection('users').where('role', '==', 'student').limit(500).get();

    if (snap.empty) {
      return NextResponse.json({ success: true, count: 0, message: '削除対象がいません' });
    }

    const userIds = snap.docs.map(d => d.id);

    // 同時実行数を制限して削除
    await runWithConcurrency(userIds, CONCURRENCY, async (id) => {
      await deleteUserData(id);
    });

    return NextResponse.json({
      success: true,
      count: userIds.length,
      message: `${userIds.length}件削除しました。まだ残っている場合はもう一度実行してください。`,
    });
  } catch (error: any) {
    console.error('DELETE Error:', error);
    return jsonError(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const actor = await getServerUser(request);
    requireMaster(actor);
    const db = adminDb();

    const body = await request.json();
    const { users } = body as { users: any[] };

    if (!Array.isArray(users)) {
      return NextResponse.json({ success: false, error: 'users must be an array' }, { status: 400 });
    }

    // クラス設定(ルール)取得
    const rulesSnapshot = await db.collection('class_settings').get();
    const rules = rulesSnapshot.docs.map(doc => doc.data());

    const results: string[] = [];
    const errors: any[] = [];
    const processedIds = new Set<string>();

    for (const user of users) {
      const loginId = user.lifetime_id || user.student_id;
      if (!loginId) {
        errors.push({ name: user.student_name, error: 'ID(生涯番号)がありません' });
        continue;
      }

      const strId = normalizeAccountLoginId(loginId);
      if (processedIds.has(strId)) continue;
      processedIds.add(strId);

      // ※ email ルールは要件に合わせているが、本番運用ではドメイン設計を再検討推奨
      const email = `${strId}@classbase.local`;
      const requestedRole = String(user.role || 'student').toLowerCase();
      const role = ['attendance_admin', 'attendance_only', 'attendance_manager'].includes(requestedRole)
        ? 'teacher'
        : requestedRole;
      const enabledPrograms = role === 'teacher' && Array.isArray(user.enabled_programs)
        ? user.enabled_programs.map(String).filter((value: string) => value === 'science_social')
        : [];
      const employmentCategory = role === 'teacher' ? normalizeEmploymentCategory(user.employment_category, role) : null;
      const prescribedWorkStart = /^([01]\d|2[0-3]):[0-5]\d$/.test(String(user.prescribed_work_start || '')) ? String(user.prescribed_work_start) : '09:00';
      const prescribedWorkEnd = /^([01]\d|2[0-3]):[0-5]\d$/.test(String(user.prescribed_work_end || '')) ? String(user.prescribed_work_end) : '18:00';
      const prescribedBreakMinutes = Math.max(0, Math.min(240, Math.floor(Number(user.prescribed_break_minutes ?? 60) || 0)));
      const prescribedWorkDays = Array.isArray(user.prescribed_work_days)
        ? Array.from(new Set<number>(user.prescribed_work_days.map(Number).filter((value: number) => Number.isInteger(value) && value >= 0 && value <= 6)))
        : [1, 2, 3, 4, 5];
      const password = normalizeInitialPassword(user.password || user.initial_password) || generateInitialPassword();
      const displayName = String(user.student_name || user.name || user.teacher_name || strId).trim();
      const schoolId = String(user.school_id || user.school || actor.school_ids[0] || actor.school || '').trim();
      if (role === 'master' && actor.role !== 'master') {
        errors.push({ name: user.student_name, error: 'masterアカウントは作成できません' });
        continue;
      }
      if (!canManageSchool(actor, schoolId || null)) {
        errors.push({ name: user.student_name, error: 'この校舎のアカウントを作成する権限がありません' });
        continue;
      }

      // 生徒の場合のみURL自動設定
      let autoUrl1: string | null = null;
      let autoUrl2: string | null = null;

      if (role === 'student') {
        const scienceRule = rules.find((r: any) =>
          r.grade === user.grade &&
          r.day_of_week === user.day_of_week &&
          r.subject_name === user.science_subject
        );
        const socialRule = rules.find((r: any) =>
          r.grade === user.grade &&
          r.day_of_week === user.day_of_week &&
          r.subject_name === user.social_subject
        );
        autoUrl1 = scienceRule ? scienceRule.zoom_url : null;
        autoUrl2 = socialRule ? socialRule.zoom_url : null;
      }

      const matchingProfiles = await findAccountProfileDocs(strId, user.email || email);
      const authUser = await syncAuthAccountCredentials({
        loginId: strId,
        email: user.email || email,
        password,
        displayName,
        disabled: false,
        preferredUid: matchingProfiles[0]?.id,
      });
      const userId = authUser.uid;

      // Firestore保存（merge）
      await db.collection('users').doc(userId).set(
        {
          id: userId,
          uid: userId,
          role,
          student_name: role === 'student' ? displayName : null,
          name: role === 'student' ? null : displayName,
          name_kana: user.name_kana || '',
          grade: user.grade || '',
          student_id: user.student_id || '',
          lifetime_id: strId,
          initial_login_id: strId,
          classroom: user.classroom || '',
          school_id: schoolId || null,
          school: schoolId || null,
          phone_number: user.phone_number || '',
          email: authUser.email,
          day_of_week: user.day_of_week || '',
          science_subject: user.science_subject || '',
          social_subject: user.social_subject || '',
          zoom_url: autoUrl1,
          zoom_url_2: autoUrl2,
          employment_category: role === 'teacher'
            ? employmentCategory
            : null,
          enabled_programs: role === 'teacher' ? enabledPrograms : [],
          prescribed_work_start: employmentCategory === 'dedicated' ? prescribedWorkStart : null,
          prescribed_work_end: employmentCategory === 'dedicated' ? prescribedWorkEnd : null,
          prescribed_break_minutes: employmentCategory === 'dedicated' ? prescribedBreakMinutes : null,
          prescribed_work_days: employmentCategory === 'dedicated' ? prescribedWorkDays : null,

          // ★要件で必要なら残す。ただしセキュリティ上は非推奨。
          initial_password: password,
          raw_password: password,

          updated_at: new Date(),
        },
        { merge: true }
      );

      if (matchingProfiles.some(profile => profile.id !== userId)) {
        const batch = db.batch();
        matchingProfiles
          .filter(profile => profile.id !== userId)
          .forEach(profile => {
            batch.set(profile.ref, {
              initial_password: password,
              raw_password: password,
              credential_primary_uid: userId,
              credentials_synced_at: new Date(),
              updated_at: new Date(),
            }, { merge: true });
          });
        await batch.commit();
      }

      results.push(displayName);
    }

    return NextResponse.json({ success: true, createdCount: results.length, results, errors });
  } catch (error: any) {
    console.error('POST Error:', error);
    return jsonError(error);
  }
}
