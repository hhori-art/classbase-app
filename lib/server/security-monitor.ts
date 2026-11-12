import 'server-only';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebase-admin';
import { auditActionLabel } from '@/app/components/master/audit-log-actions';
import { loadSchoolStaffRecipients, notifyStaff } from '@/lib/server/staff-recipients';
import { sendEmail } from '@/lib/server/notify-channels';
import {
  SECURITY_DAYS_COLLECTION,
  SECURITY_EVENT_KINDS,
  SECURITY_EVENT_LABELS,
  SECURITY_SUBJECTS_SUBCOLLECTION,
  type SecurityEventKind,
} from '@/lib/server/security-events';

/**
 * 攻撃の監視ジョブ。lib/server/security-events.ts が書いた集計と、管理操作の監査ログを確かめ、
 * しきい値を超えたらマスターへ知らせる。
 *
 * 読み取り予算を守るため、1回の実行で読むのは次だけ：
 *  - 日別の集計（対象の日数ぶん、1日1件）
 *  - しきい値を超えた IP・アカウント（1日あたり最大20件。短い期間では10件）
 *  - 期間内の管理操作の監査ログ（最大200件。短い期間では50件）
 *
 * Vercel Cron（Pro プラン）で2本動かす。
 *  - 5分ごと（hours=1）：直近1時間を見て、攻撃に早く気づく。同じ1時間のうちに知らせた内容は繰り返さない
 *    （新しい種類の出来事が見つかったときだけ知らせる）。
 *  - 毎朝7時（hours=24）：1日分をまとめて見る（少しずつ続く攻撃や、Node.js の版の確認）。
 */

/** しきい値（1日あたりの目安）。hours を短くしたときは時間の割合で下げる（最低値あり）。 */
export const DAILY_THRESHOLDS = {
  /** 全体：ログインなし・無効なログインでのAPI呼び出し */
  unauthorizedTotal: 300,
  /** 全体：脆弱性を探るアクセス */
  probeTotal: 20,
  /** 全体：署名が合わない外部通知（ふだんは起きないので1件でも知らせる） */
  webhookSignatureTotal: 1,
  /** 1つのIPからの不審な出来事の合計 */
  perIp: 50,
  /** 1つのIPからのログイン失敗 */
  perIpLoginFailed: 20,
  /** 1つのIPからの脆弱性探り */
  perIpProbe: 5,
  /** 1つのアカウントへのログイン失敗 */
  perAccountLoginFailed: 10,
  /** 回数制限での拒否（全体） */
  rateLimitedTotal: 10,
};

/** 監査ログのうち、乗っ取りや内部不正のときに起きやすい重要な操作。 */
const SENSITIVE_AUDIT_ACTIONS = new Set([
  'account_password_change', 'account_delete', 'account_status_change', 'account_import',
  'app_permission_change', 'app_permission_initialize',
]);
/** 1人の管理者が期間内にこれ以上の重要な操作をしたら知らせる。 */
const SENSITIVE_ACTIONS_PER_ACTOR = 30;
/** 深夜（日本時間0〜5時）の重要な操作は1件でも知らせる。 */
const NIGHT_START_HOUR = 0;
const NIGHT_END_HOUR = 5;

export type SecurityFinding = { severity: 'high' | 'medium'; title: string; detail: string };

const jstDayKey = (date: Date) => new Date(date.getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
const jstHour = (date: Date) => Number(new Date(date.getTime() + 9 * 60 * 60 * 1000).toISOString().slice(11, 13));
const scaled = (daily: number, hours: number, minimum: number) => Math.max(minimum, Math.ceil(daily * Math.min(1, hours / 24)));

/** 期間に含まれる日（日本時間）。 */
export function monitorDays(now: Date, hours: number) {
  const days = new Set<string>();
  for (let offset = 0; offset <= hours; offset += 1) days.add(jstDayKey(new Date(now.getTime() - offset * 60 * 60 * 1000)));
  return Array.from(days).sort();
}

/** 集計からしきい値を超えたものを見つける（純粋関数。テストしやすいように分けている）。 */
export function evaluateSecurityCounts(input: {
  hours: number;
  counts: Partial<Record<SecurityEventKind, number>>;
  subjects: Array<{ type: 'ip' | 'account'; value: string; total: number; kinds: Partial<Record<SecurityEventKind, number>>; last_path?: string }>;
}): SecurityFinding[] {
  const t = DAILY_THRESHOLDS;
  const h = input.hours;
  const count = (kind: SecurityEventKind) => Number(input.counts[kind] || 0);
  const findings: SecurityFinding[] = [];
  if (count('unauthorized') >= scaled(t.unauthorizedTotal, h, 60)) {
    findings.push({ severity: 'medium', title: 'ログインなしのAPI呼び出しが多い', detail: `${count('unauthorized')}回（目安 ${scaled(t.unauthorizedTotal, h, 60)}回）。自動化された攻撃や、ログイン切れの端末が繰り返し通信している可能性があります。` });
  }
  if (count('probe') >= scaled(t.probeTotal, h, 5)) {
    findings.push({ severity: 'medium', title: '脆弱性を探るアクセスが多い', detail: `${count('probe')}回（.php・wp-admin・.env など、このアプリにないファイルへのアクセス）。すべて404で拒否しています。` });
  }
  if (count('webhook_signature') >= scaled(t.webhookSignatureTotal, h, 1)) {
    findings.push({ severity: 'high', title: '署名が合わない外部通知', detail: `${count('webhook_signature')}回。Zoom などの通知をなりすました送信の可能性があります。すべて拒否しています。` });
  }
  if (count('rate_limited') >= scaled(t.rateLimitedTotal, h, 3)) {
    findings.push({ severity: 'medium', title: 'ログインの回数制限による拒否が多い', detail: `${count('rate_limited')}回。パスワードの総当たりの可能性があります。` });
  }
  for (const subject of input.subjects) {
    const kinds = subject.kinds || {};
    const label = subject.type === 'ip' ? `IP ${subject.value}` : `アカウント ${subject.value}`;
    const breakdown = SECURITY_EVENT_KINDS.filter(kind => Number(kinds[kind] || 0) > 0).map(kind => `${SECURITY_EVENT_LABELS[kind]} ${kinds[kind]}回`).join('、');
    if (subject.type === 'account' && Number(kinds.login_failed || 0) >= scaled(t.perAccountLoginFailed, h, 5)) {
      findings.push({ severity: 'high', title: '特定のアカウントへのログイン失敗が多い', detail: `${label}：${breakdown}。本人の入力ミスか、パスワードの総当たりの可能性があります。` });
    } else if (subject.type === 'ip' && (
      Number(kinds.login_failed || 0) >= scaled(t.perIpLoginFailed, h, 8)
      || Number(kinds.probe || 0) >= scaled(t.perIpProbe, h, 3)
      || subject.total >= scaled(t.perIp, h, 15)
    )) {
      findings.push({ severity: Number(kinds.login_failed || 0) >= scaled(t.perIpLoginFailed, h, 8) ? 'high' : 'medium', title: '特定のIPからの不審なアクセス', detail: `${label}：${breakdown}${subject.last_path ? `（最後のアクセス先 ${subject.last_path}）` : ''}。` });
    }
  }
  return findings;
}

/** 監査ログから、深夜の重要な操作と、1人による大量の重要な操作を見つける（純粋関数）。 */
export function evaluateAuditLogs(logs: Array<{ action: string; actor_name?: string; actor_id?: string; created_at?: Date | null }>, hours: number): SecurityFinding[] {
  const sensitive = logs.filter(log => SENSITIVE_AUDIT_ACTIONS.has(log.action));
  const findings: SecurityFinding[] = [];
  const night = sensitive.filter(log => log.created_at && jstHour(log.created_at) >= NIGHT_START_HOUR && jstHour(log.created_at) < NIGHT_END_HOUR);
  if (night.length) {
    const names = Array.from(new Set(night.map(log => log.actor_name || log.actor_id || '不明'))).slice(0, 5).join('、');
    findings.push({ severity: 'high', title: '深夜（0〜5時）の重要な管理操作', detail: `${night.length}件（${Array.from(new Set(night.map(log => auditActionLabel(log.action)))).join('・')}）。操作した人：${names}。本人の操作か確認してください。` });
  }
  const byActor = new Map<string, { name: string; count: number }>();
  sensitive.forEach(log => {
    const key = log.actor_id || log.actor_name || '不明';
    const current = byActor.get(key) || { name: log.actor_name || key, count: 0 };
    byActor.set(key, { ...current, count: current.count + 1 });
  });
  const limit = Math.max(10, Math.ceil(SENSITIVE_ACTIONS_PER_ACTOR * Math.min(1, hours / 24)));
  byActor.forEach(({ name, count }) => {
    if (count >= limit) findings.push({ severity: 'medium', title: '1人の管理者による重要な操作が多い', detail: `${name}：${count}件（パスワード変更・権限変更・利用停止など）。一括の作業でなければ確認してください。` });
  });
  return findings;
}

/** その日のその時（日本時間）の集計が、監視する期間に入るか。 */
export function hourInWindow(day: string, hour: string, since: Date, now: Date) {
  const at = new Date(`${day}T${hour}:59:59+09:00`);
  return !(at < since || at.getTime() - 60 * 60 * 1000 > now.getTime());
}

/**
 * IP・アカウント別の集計のうち、監視する期間に入る分。
 * 集計は1日ごとなので、時間ごとの内訳（hours）から期間内の分だけを足す。これをしないと、1時間ごとの監視が
 * その日の朝の出来事を、日付が変わるまで毎時間知らせ直してしまう。
 * 時間ごとの内訳がない古い集計は、1日分の監視（wholeDayFallback）でだけ日の合計を使う。
 */
export function subjectCountsInWindow(
  day: string,
  data: { total?: unknown; kinds?: Record<string, unknown>; hours?: Record<string, Record<string, unknown>> },
  since: Date,
  now: Date,
  wholeDayFallback: boolean,
): { total: number; kinds: Partial<Record<SecurityEventKind, number>> } | null {
  const kinds: Partial<Record<SecurityEventKind, number>> = {};
  if (!data.hours || typeof data.hours !== 'object') {
    if (!wholeDayFallback) return null;
    Object.entries(data.kinds || {}).forEach(([kind, value]) => { kinds[kind as SecurityEventKind] = Number(value || 0); });
    return { total: Number(data.total || 0), kinds };
  }
  let total = 0;
  Object.entries(data.hours).forEach(([hour, perKind]) => {
    if (!hourInWindow(day, hour, since, now)) return;
    Object.entries(perKind || {}).forEach(([kind, value]) => {
      kinds[kind as SecurityEventKind] = Number(kinds[kind as SecurityEventKind] || 0) + Number(value || 0);
      total += Number(value || 0);
    });
  });
  return { total, kinds };
}

/** 監視結果をメールでも受け取る宛先（Vercel の環境変数 SECURITY_ALERT_EMAILS、カンマ区切り）。 */
/**
 * 実行中の Node.js が、既知の脆弱性を直した版より古くないか。Vercel は修正版を自動で配るが時期は選べないため、毎日確かめる。
 * 新しいセキュリティリリースが出たら、ここの版を上げる（2026年10月21日：Brotli の RCE ほか10件）。
 */
export const MIN_PATCHED_NODE: Record<number, string> = { 22: '22.23.4', 24: '24.22.1', 26: '26.12.1' };

export function evaluateRuntimeVersion(version: string, minimums: Record<number, string> = MIN_PATCHED_NODE): SecurityFinding[] {
  const parse = (value: string) => value.replace(/^v/, '').split('.').map(part => Number(part) || 0);
  const [major] = parse(version);
  const minimum = minimums[major];
  if (!minimum) {
    return [{ severity: 'high', title: 'サポートの終わった Node.js で動いています', detail: `実行中の版は ${version} です。Vercel の設定で Node.js を ${Object.keys(minimums).join('・')} のどれかにしてください。` }];
  }
  const current = parse(version);
  const wanted = parse(minimum);
  const older = wanted.some((value, index) => {
    for (let i = 0; i < index; i++) if (current[i] !== wanted[i]) return false;
    return (current[index] || 0) < value;
  });
  return older
    ? [{ severity: 'medium', title: 'Node.js の脆弱性の修正版がまだ使われていません', detail: `実行中の版は ${version}、修正版は ${minimum} 以上です。Vercel が自動で更新するまで、外部の決まったサービス以外へは接続しない作りで影響を抑えています。更新後に自動で消えます。` }]
    : [];
}

export function securityAlertEmails() {
  return Array.from(new Set(String(process.env.SECURITY_ALERT_EMAILS || '')
    .split(/[,\s]+/).map(value => value.trim().toLowerCase())
    .filter(value => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value)))).slice(0, 10);
}

/** 監視結果のメール。同じ実行の再送で重ならないよう、実行と宛先ごとに Idempotency-Key を固定する。 */
async function emailSecurityAlert(runKey: string, subject: string, body: string) {
  const results = await Promise.all(securityAlertEmails().map(async email => ({
    email,
    ...(await sendEmail(email, subject, body, `security-monitor-${runKey}-${email}`)),
  })));
  results.filter(item => !item.ok).forEach(item => console.warn('[security-monitor] email failed', item.error));
  return { sent: results.filter(item => item.ok).length, failed: results.filter(item => !item.ok).map(item => item.error || 'unknown') };
}

/** まだ知らせていない出来事だけ（同じ1時間の記録に残した見出しと比べる）。 */
export function newSecurityFindings(findings: SecurityFinding[], notifiedTitles: unknown) {
  const already = new Set(Array.isArray(notifiedTitles) ? notifiedTitles.map(String) : []);
  return findings.filter(item => !already.has(item.title));
}

/** 監視を1回実行する。結果を保存し、見つかったものがあればマスターへ（設定があればメールでも）知らせる。 */
export async function runSecurityMonitor(options: { hours?: number; now?: Date; testEmail?: boolean } = {}) {
  const hours = Math.min(48, Math.max(1, Math.round(options.hours || 24)));
  const now = options.now || new Date();
  const since = new Date(now.getTime() - hours * 60 * 60 * 1000);
  const db = adminDb();
  const days = monitorDays(now, hours);

  const dayRefs = days.map(day => db.collection(SECURITY_DAYS_COLLECTION).doc(day));
  const daySnaps = await db.getAll(...dayRefs);
  const counts: Partial<Record<SecurityEventKind, number>> = {};
  daySnaps.forEach(snap => {
    const data = snap.data() || {};
    // 期間の端の日は、時間ごとの集計から期間内の分だけを足す。
    const hoursMap = (data.hours || {}) as Record<string, Partial<Record<SecurityEventKind, number>>>;
    Object.entries(hoursMap).forEach(([hour, kinds]) => {
      if (!hourInWindow(snap.id, hour, since, now)) return;
      Object.entries(kinds || {}).forEach(([kind, value]) => {
        counts[kind as SecurityEventKind] = Number(counts[kind as SecurityEventKind] || 0) + Number(value || 0);
      });
    });
  });

  // しきい値の最小値以上の IP・アカウントだけを読む。5分ごとの実行（短い期間）では件数をさらに絞る。
  const subjectFloor = 5;
  const subjectLimit = hours >= 24 ? 20 : 10;
  const auditLimit = hours >= 24 ? 200 : 50;
  const subjectSnaps = await Promise.all(dayRefs.map(ref => ref.collection(SECURITY_SUBJECTS_SUBCOLLECTION)
    .where('total', '>=', subjectFloor).orderBy('total', 'desc').limit(subjectLimit).get()));
  type Subject = { type: 'ip' | 'account'; value: string; total: number; kinds: Partial<Record<SecurityEventKind, number>>; last_path?: string };
  const subjects = new Map<string, Subject>();
  subjectSnaps.forEach((snap, index) => snap.docs.forEach(doc => {
    const data = doc.data() || {};
    const inWindow = subjectCountsInWindow(days[index], data, since, now, hours >= 24);
    if (!inWindow || inWindow.total <= 0) return;
    const key = `${data.type}:${data.value}`;
    const current: Subject = subjects.get(key) || { type: data.type === 'account' ? 'account' : 'ip', value: String(data.value || ''), total: 0, kinds: {} };
    const kinds = { ...current.kinds };
    Object.entries(inWindow.kinds).forEach(([kind, value]) => { kinds[kind as SecurityEventKind] = Number(kinds[kind as SecurityEventKind] || 0) + Number(value || 0); });
    subjects.set(key, { ...current, total: current.total + inWindow.total, kinds, last_path: data.last_path || current.last_path });
  }));

  const auditSnap = await db.collection('admin_audit_logs')
    .where('created_at', '>=', Timestamp.fromDate(since))
    .orderBy('created_at', 'desc').limit(auditLimit).get();
  const logs = auditSnap.docs.map(doc => {
    const data = doc.data() || {};
    return { action: String(data.action || ''), actor_name: data.actor_name, actor_id: data.actor_id, created_at: data.created_at?.toDate ? data.created_at.toDate() : null };
  });

  const findings = [
    ...evaluateSecurityCounts({ hours, counts, subjects: Array.from(subjects.values()) }),
    ...evaluateAuditLogs(logs, hours),
    // Node.js の版は1日1回の確認だけで知らせる（5分ごとの実行で毎時間知らせないため）。
    ...(hours >= 24 ? evaluateRuntimeVersion(process.version) : []),
  ].sort((a, b) => (a.severity === b.severity ? 0 : a.severity === 'high' ? -1 : 1));

  // 結果は1時間ごとに1件（1日分の確認は別の記録）。5分ごとの実行は同じ記録を更新する。
  const frequent = hours < 24;
  const runKey = `${jstDayKey(now)}_${String(jstHour(now)).padStart(2, '0')}${frequent ? '' : '_daily'}`;
  const reportRef = db.collection('security_monitor_reports').doc(runKey);
  const previous: FirebaseFirestore.DocumentData = frequent && findings.length ? (await reportRef.get()).data() || {} : {};
  const fresh = newSecurityFindings(findings, previous.notified_titles);
  const notifiedTitles = Array.from(new Set([
    ...(Array.isArray(previous.notified_titles) ? previous.notified_titles.map(String) : []),
    ...fresh.map(item => item.title),
  ]));
  await reportRef.set({
    run_at: FieldValue.serverTimestamp(),
    hours,
    counts,
    findings,
    // 知らせたものがないときは書かない（前の実行で知らせた記録を消さないため）。
    ...(fresh.length ? { notified_titles: notifiedTitles } : {}),
    subjects_checked: subjects.size,
    audit_logs_checked: logs.length,
    expires_at: Timestamp.fromMillis(now.getTime() + 90 * 24 * 60 * 60 * 1000),
  }, { merge: true });

  let notified = 0;
  let email = { sent: 0, failed: [] as string[] };
  if (fresh.length) {
    // 同じ実行の再送で通知が重ならないよう、知らせる内容ごとにIDを固定する。
    const notifyKey = frequent ? `${runKey}_${notifiedTitles.length}` : runKey;
    const recipients = (await loadSchoolStaffRecipients(null)).filter(item => item.isMaster);
    const high = findings.filter(item => item.severity === 'high').length;
    notified = await notifyStaff(recipients, {
      idPrefix: `security_monitor_${notifyKey}`,
      title: high ? `セキュリティ監視：要確認 ${findings.length}件（重要 ${high}件）` : `セキュリティ監視：確認 ${findings.length}件`,
      message: [
        `直近${hours}時間の監視結果です。`,
        ...findings.slice(0, 8).map(item => `・${item.severity === 'high' ? '【重要】' : ''}${item.title}：${item.detail}`),
        findings.length > 8 ? `ほか${findings.length - 8}件` : '',
      ].filter(Boolean).join('\n'),
      kind: 'security_monitor',
      masterLink: '/master/audit-logs',
      pushBody: high ? '重要なセキュリティの確認事項があります。管理画面の通知を確認してください。' : 'セキュリティ監視の確認事項があります。',
      extra: { finding_count: findings.length, high_count: high },
    });
    email = await emailSecurityAlert(
      notifyKey,
      `【classbase】${high ? `セキュリティ監視：要確認 ${findings.length}件（重要 ${high}件）` : `セキュリティ監視：確認 ${findings.length}件`}`,
      [
        `classbase-app のセキュリティ監視で、直近${hours}時間に確認が必要な出来事が見つかりました。`,
        '',
        ...findings.map(item => `・${item.severity === 'high' ? '【重要】' : ''}${item.title}\n  ${item.detail}`),
        '',
        `集計：${SECURITY_EVENT_KINDS.map(kind => `${SECURITY_EVENT_LABELS[kind]} ${Number(counts[kind] || 0)}回`).join(' / ')}`,
        '詳しくは管理画面の通知と操作ログを確認してください。',
        'このメールは自動送信です。',
      ].join('\n'),
    );
  } else if (options.testEmail) {
    // マスターが手動で「メールのテスト」をしたとき。見つかったものがなくても送る。
    email = await emailSecurityAlert(
      `${runKey}-test-${now.getTime()}`,
      '【classbase】セキュリティ監視：メール通知のテスト',
      [
        'classbase-app のセキュリティ監視のメール通知のテストです。',
        `直近${hours}時間に、知らせる必要のある出来事はありませんでした。`,
        `集計：${SECURITY_EVENT_KINDS.map(kind => `${SECURITY_EVENT_LABELS[kind]} ${Number(counts[kind] || 0)}回`).join(' / ')}`,
        '今後は、確認が必要な出来事があったときに、このアドレスへお知らせします。',
      ].join('\n'),
    );
  }
  return { hours, days, counts, findings, notified, email, subjects_checked: subjects.size, audit_logs_checked: logs.length };
}
