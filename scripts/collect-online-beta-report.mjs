import fs from 'node:fs';
import path from 'node:path';
import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';

const startKey = process.argv[2] || '2026-09-07';
const endKey = process.argv[3] || new Intl.DateTimeFormat('sv-SE', {
  timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit',
}).format(new Date());
const outputPath = process.argv[4] || '/private/tmp/classbase-online-beta-reviewed.json';
const start = new Date(`${startKey}T00:00:00+09:00`);
const endExclusive = new Date(`${endKey}T00:00:00+09:00`);
endExclusive.setDate(endExclusive.getDate() + 1);

const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
const privateKey = String(process.env.FIREBASE_PRIVATE_KEY || '').replace(/^"|"$/g, '').replace(/\\n/g, '\n');
if (!projectId || !clientEmail || !privateKey) throw new Error('Firebase admin credentials are missing');
if (!getApps().length) initializeApp({ credential: cert({ projectId, clientEmail, privateKey }) });
const db = getFirestore();
const auth = getAuth();

const toDate = value => {
  if (!value) return null;
  if (typeof value.toDate === 'function') return value.toDate();
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};
const inWindow = date => Boolean(date && date >= start && date < endExclusive);
const dateKeyJst = date => new Intl.DateTimeFormat('sv-SE', {
  timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit',
}).format(date);
const normalizeGrade = value => {
  const text = String(value || '').normalize('NFKC');
  if (/中(?:学)?\s*1|1\s*年/.test(text)) return '中1';
  if (/中(?:学)?\s*2|2\s*年/.test(text)) return '中2';
  if (/中(?:学)?\s*3|3\s*年/.test(text)) return '中3';
  return text.trim() || '未設定';
};
const isOnlineSchool = user => {
  const values = [user.school, user.school_id, user.school_name, user.classroom, ...(Array.isArray(user.schools) ? user.schools : [])]
    .map(value => String(value || '').normalize('NFKC').trim());
  return values.some(value => value === '112' || /オンライン校/.test(value));
};
const isActiveProfile = user => {
  const status = String(user.status || 'active').toLowerCase();
  return !['withdrawn', 'archived', 'inactive', 'disabled', 'deleted', 'cancelled', 'canceled'].includes(status) &&
    user.active !== false && user.is_active !== false && user.disabled !== true && user.auth_disabled !== true;
};
const pct = (value, total) => total ? Math.round(value / total * 1000) / 10 : 0;

const listAuthUsers = async () => {
  const rows = [];
  let token;
  do {
    const page = await auth.listUsers(1000, token);
    rows.push(...page.users);
    token = page.pageToken;
  } while (token);
  return rows;
};

const startTs = Timestamp.fromDate(start);
const endTs = Timestamp.fromDate(endExclusive);
const [userSnap, betaSnap, joinSnap, attendanceSnap, authUsers] = await Promise.all([
  db.collection('users').where('role', '==', 'student').get(),
  db.collection('beta_test_events').where('created_at', '>=', startTs).where('created_at', '<', endTs).get(),
  db.collection('learning_events').where('created_at', '>=', startTs).where('created_at', '<', endTs).get(),
  db.collection('attendance').where('target_date', '>=', startKey).where('target_date', '<=', endKey).get(),
  listAuthUsers(),
]);

const allStudents = userSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
const onlineStudents = allStudents.filter(isOnlineSchool);
const targetStudents = onlineStudents.filter(isActiveProfile);
const targetIds = new Set(targetStudents.map(user => user.id));
const authByUid = new Map(authUsers.map(user => [user.uid, user]));
const betaEvents = betaSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }))
  .filter(row => targetIds.has(String(row.actor_id || '')) && String(row.actor_role || '') === 'student');
const joinEvents = joinSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }))
  .filter(row => targetIds.has(String(row.actor_id || '')) && String(row.type || '') === 'class_join_clicked');
const directAttendance = attendanceSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }))
  .filter(row => targetIds.has(String(row.user_id || row.student_id || '')))
  .filter(row => String(row.contacted_by || '') === 'student')
  .filter(row => ['joined', 'present'].includes(String(row.type || '').toLowerCase()))
  .filter(row => row.participation_event_id || String(row.reason || '').includes('Zoom参加'));

const betaByUid = new Map();
for (const row of betaEvents) {
  const uid = String(row.actor_id || '');
  if (!betaByUid.has(uid)) betaByUid.set(uid, []);
  betaByUid.get(uid).push(row);
}
const joinsByUid = new Map();
for (const row of joinEvents) {
  const uid = String(row.actor_id || '');
  if (!joinsByUid.has(uid)) joinsByUid.set(uid, []);
  joinsByUid.get(uid).push(row);
}
const attendanceByUid = new Map();
for (const row of directAttendance) {
  const uid = String(row.user_id || row.student_id || '');
  if (!attendanceByUid.has(uid)) attendanceByUid.set(uid, []);
  attendanceByUid.get(uid).push(row);
}

const details = targetStudents.map(user => {
  const authUser = authByUid.get(user.id);
  const events = betaByUid.get(user.id) || [];
  const authLast = toDate(authUser?.metadata?.lastSignInTime);
  const profileLast = toDate(user.last_login_at || user.last_login);
  const eventDates = events.map(row => toDate(row.created_at)).filter(Boolean);
  const loginEvidence = [
    ...eventDates.map(date => ({ source: 'beta_event', date })),
    ...(inWindow(authLast) ? [{ source: 'firebase_auth', date: authLast }] : []),
    ...(inWindow(profileLast) ? [{ source: 'user_profile', date: profileLast }] : []),
  ].sort((a, b) => a.date.getTime() - b.date.getTime());
  const directJoins = joinsByUid.get(user.id) || [];
  const attendanceJoins = attendanceByUid.get(user.id) || [];
  const joinedDates = new Set([
    ...directJoins.map(row => String(row.metadata?.target_date || '')).filter(Boolean),
    ...attendanceJoins.map(row => String(row.target_date || '')).filter(Boolean),
  ]);
  const sessionIds = new Set(events.map(row => String(row.session_id || '')).filter(Boolean));
  return {
    uid: user.id,
    grade: normalizeGrade(user.grade),
    school: String(user.school_name || user.school || user.school_id || 'オンライン校'),
    auth_exists: Boolean(authUser),
    auth_disabled: Boolean(authUser?.disabled),
    logged_in: loginEvidence.length > 0,
    first_observed_login_at: loginEvidence[0]?.date || null,
    last_observed_login_at: loginEvidence.at(-1)?.date || null,
    login_evidence_sources: [...new Set(loginEvidence.map(item => item.source))],
    active_days: new Set(eventDates.map(dateKeyJst)).size,
    sessions: sessionIds.size,
    page_views: events.filter(row => row.type === 'page_view').length,
    participated: directJoins.length > 0 || attendanceJoins.length > 0,
    participation_events: directJoins.length,
    participation_days: joinedDates.size,
  };
});

const summarize = rows => {
  const loggedIn = rows.filter(row => row.logged_in).length;
  const participated = rows.filter(row => row.participated).length;
  const repeatActive = rows.filter(row => row.active_days >= 2).length;
  const repeatParticipants = rows.filter(row => row.participation_days >= 2).length;
  return {
    target_accounts: rows.length,
    logged_in_accounts: loggedIn,
    login_rate: pct(loggedIn, rows.length),
    not_logged_in_accounts: rows.length - loggedIn,
    repeat_active_accounts: repeatActive,
    repeat_active_rate_all: pct(repeatActive, rows.length),
    participating_accounts: participated,
    participation_rate_all: pct(participated, rows.length),
    participation_rate_logged_in: pct(participated, loggedIn),
    repeat_participating_accounts: repeatParticipants,
    participation_events: rows.reduce((sum, row) => sum + row.participation_events, 0),
  };
};
const byGrade = Object.fromEntries([...new Set(details.map(row => row.grade))].sort().map(grade => [grade, summarize(details.filter(row => row.grade === grade))]));

const daily = [];
for (let date = new Date(start); date < endExclusive; date.setDate(date.getDate() + 1)) {
  const key = dateKeyJst(date);
  const activeIds = new Set(betaEvents.filter(row => dateKeyJst(toDate(row.created_at)) === key).map(row => String(row.actor_id)));
  const joiningIds = new Set([
    ...joinEvents.filter(row => dateKeyJst(toDate(row.created_at)) === key).map(row => String(row.actor_id)),
    ...directAttendance.filter(row => String(row.target_date || '') === key).map(row => String(row.user_id || row.student_id || '')),
  ]);
  const firstLoginIds = new Set(details.filter(row => row.first_observed_login_at && dateKeyJst(row.first_observed_login_at) === key).map(row => row.uid));
  daily.push({ date: key, active_accounts: activeIds.size, first_observed_logins: firstLoginIds.size, participating_accounts: joiningIds.size });
}

const loginDelayDays = details.filter(row => row.first_observed_login_at).map(row => Math.max(0, Math.floor((row.first_observed_login_at - start) / 86400000))).sort((a, b) => a - b);
const quantile = (values, q) => values.length ? values[Math.min(values.length - 1, Math.floor((values.length - 1) * q))] : null;
const observedLoginDates = details.filter(row => row.first_observed_login_at).map(row => row.first_observed_login_at).sort((a, b) => a - b);

const report = {
  title: 'オンライン校βテスト利用状況レポート',
  generated_at: new Date().toISOString(),
  as_of_jst: new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', dateStyle: 'long', timeStyle: 'short' }).format(new Date()),
  period: { start: startKey, end: endKey, timezone: 'Asia/Tokyo' },
  definitions: {
    target: 'role=student、校舎コード112または校舎名にオンライン校を含み、withdrawn/archived/inactive等ではなく、無効化フラグがない現在有効なアカウント',
    login: '期間内の認証済みβ画面イベント、users.last_login(_at)、Firebase Authentication lastSignInTimeのいずれかを確認できたアカウント',
    participation: '期間内にClassBaseのZoom参加ボタンから作成されたclass_join_clickedまたは本人操作のattendance記録があるアカウント。双子自動連携は除外',
  },
  overall: summarize(details),
  by_grade: byGrade,
  daily,
  login_timing: {
    first_observed: observedLoginDates[0]?.toISOString() || null,
    last_observed: observedLoginDates.at(-1)?.toISOString() || null,
    median_days_from_period_start: quantile(loginDelayDays, 0.5),
    p75_days_from_period_start: quantile(loginDelayDays, 0.75),
    first_3_days_accounts: loginDelayDays.filter(days => days <= 2).length,
    after_first_3_days_accounts: loginDelayDays.filter(days => days >= 3).length,
  },
  data_quality: {
    all_student_profiles: allStudents.length,
    online_school_profiles: onlineStudents.length,
    excluded_inactive_profiles: onlineStudents.length - targetStudents.length,
    target_without_auth_user: details.filter(row => !row.auth_exists).length,
    target_with_disabled_auth_user: details.filter(row => row.auth_disabled).length,
    target_missing_grade: details.filter(row => row.grade === '未設定').length,
    beta_events_in_window: betaEvents.length,
    beta_event_accounts: new Set(betaEvents.map(row => row.actor_id)).size,
    join_events_in_window: joinEvents.length,
    direct_attendance_docs_in_window: directAttendance.length,
    login_only_from_point_in_time_fields: details.filter(row => row.logged_in && row.active_days === 0).length,
    caveats: [
      '最終ログイン項目とAuth最終サインインは期間内利用の有無を示すが、ログイン回数や初回日時の完全な履歴ではない。',
      'beta_test_eventsがある利用者は日別の利用を確認できるが、計測開始前・通信失敗時の利用は欠落しうる。',
      'Zoomへ旧システムや直接URLから参加した場合はClassBase経由参加に含まれない。',
      '授業参加率は予定授業数を分母とした出席率ではなく、対象アカウントのうち1回以上ClassBase経由で参加した人の割合。',
    ],
  },
  report_rows: details.map(row => ({
    grade: row.grade,
    logged_in: row.logged_in,
    first_observed_login_date: row.first_observed_login_at ? dateKeyJst(row.first_observed_login_at) : null,
    active_days: row.active_days,
    sessions: row.sessions,
    participated: row.participated,
    participation_days: row.participation_days,
  })),
};

report.generatedAt = report.generated_at;
report.status = 'reviewed';
report.filters = [];
report.report = { asOf: endKey };
report.queries = {
  cohort_summary: {
    rows: [{ cohort: 'オンライン校・現在有効', ...report.overall }],
    source: {
      label: 'ClassBase本番Firebase（users / beta_test_events / learning_events / attendance / Authentication）',
      freshness: report.generated_at,
      filters: [`period=${startKey}..${endKey}`, 'school=112|オンライン校', 'role=student', 'status=currently_active'],
      metricDefinitions: {
        target_accounts: '現在有効なオンライン校生徒アカウント',
        logged_in_accounts: '期間内に認証済み画面イベント等のログイン証跡があるアカウント',
        participating_accounts: '期間内にClassBase経由の授業参加記録が1回以上あるアカウント',
        repeat_participating_accounts: '異なる2日以上にClassBase経由の授業参加があるアカウント',
      },
    },
  },
  grade_summary: {
    rows: Object.entries(report.by_grade).map(([grade, values]) => ({ grade, ...values })),
    source: {
      label: 'ClassBase本番Firebase（学年別集計）',
      freshness: report.generated_at,
      filters: [`period=${startKey}..${endKey}`, 'school=112|オンライン校', 'role=student', 'status=currently_active'],
      metricDefinitions: report.definitions,
    },
  },
  daily_activity: {
    rows: report.daily,
    source: {
      label: 'ClassBase本番Firebase（日別認証済み利用・参加イベント）',
      freshness: report.generated_at,
      reportingField: 'date',
      filters: [`period=${startKey}..${endKey}`, 'school=112|オンライン校'],
      metricDefinitions: {
        active_accounts: '当日に認証済み画面イベントがあるユニークアカウント',
        first_observed_logins: '当日が期間内の初回観測ログイン日となったアカウント',
        participating_accounts: '当日にClassBase経由の授業参加記録があるユニークアカウント',
      },
    },
  },
  anonymous_accounts: {
    rows: report.report_rows,
    source: {
      label: 'ClassBase本番Firebase（匿名化したアカウント別集計）',
      freshness: report.generated_at,
      filters: [`period=${startKey}..${endKey}`, 'PII=excluded'],
      metricDefinitions: report.definitions,
    },
  },
};

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, JSON.stringify(report, null, 2));
console.log(JSON.stringify({ outputPath, target_accounts: report.overall.target_accounts, logged_in_accounts: report.overall.logged_in_accounts, participating_accounts: report.overall.participating_accounts }, null, 2));
