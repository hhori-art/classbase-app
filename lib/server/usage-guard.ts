import 'server-only';
import { unstable_cache, revalidateTag } from 'next/cache';
import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebase-admin';
import { memoizeForInstance } from '@/lib/server/instance-memo';
import { loadSchoolStaffRecipients, notifyStaff } from '@/lib/server/staff-recipients';
import { USAGE_LEVEL_LABELS, evaluateUsage, type UsageLevel, type UsageSnapshot } from '@/lib/usage-guard';

/**
 * Vercel の使用額の見張り。Vercel Cron（1時間ごと、/api/cron/usage-guard）で使用額を取り、
 * 月末の見込みから「通常／節約モード」を決めて settings/usage_guard に残す。
 * 各処理は getUsageLevel()（共有キャッシュ5分＋インスタンス内60秒）で見て、節約モードなら間引く。
 *
 * 使用額は Vercel API から取る。環境変数 VERCEL_USAGE_TOKEN（Vercel のアクセストークン）と
 * VERCEL_TEAM_ID が必要。未設定のときは何もしない（ずっと「通常」）。
 */

const SETTINGS_DOC = 'usage_guard';
const TAG = 'usage-guard';
const LEVELS: UsageLevel[] = ['normal', 'saving', 'critical'];

export const getUsageLevel = memoizeForInstance(unstable_cache(async (): Promise<UsageLevel> => {
  const data = (await adminDb().collection('settings').doc(SETTINGS_DOC).get()).data() || {};
  return LEVELS.includes(data.level) ? data.level : 'normal';
}, ['usage-guard-level-v1'], { revalidate: 300, tags: [TAG] }), 60_000);

/** 節約モードの判定に失敗しても、本来の処理は止めない。 */
export async function currentUsageLevel(): Promise<UsageLevel> {
  try {
    return await getUsageLevel();
  } catch (error) {
    console.warn('[usage-guard] level read failed', error instanceof Error ? error.message : error);
    return 'normal';
  }
}

async function vercelGet(path: string, token: string) {
  const response = await fetch(`https://api.vercel.com${path}`, { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`Vercel API ${response.status}: ${String(body?.error?.message || body?.message || '')}`.trim());
  return body;
}

/** 今の請求期間の使用額（含まれる額の使用分と、超えた従量の額）。 */
export async function fetchVercelUsage(token: string, teamId: string): Promise<UsageSnapshot> {
  const team = encodeURIComponent(teamId);
  const [credit, spend] = await Promise.all([
    vercelGet(`/v1/invoices/pre-commitment-usage?teamId=${team}`, token),
    vercelGet(`/teams/${team}/spend?teamId=${team}`, token),
  ]);
  const ledger = (Array.isArray(credit?.creditLedgers) ? credit.creditLedgers : []).find((item: any) => item?.currency === 'USD');
  if (!ledger) throw new Error('含まれる使用額（creditLedgers）が見つかりません');
  return {
    creditUsed: Math.max(0, Number(ledger.total || 0) - Number(ledger.remaining || 0)),
    onDemand: Math.max(0, Number(spend?.data?.currentSpend || 0)),
    periodStart: String(ledger.periodStart || ''),
    periodEnd: String(ledger.periodEnd || ''),
  };
}

const usd = (value: number) => `$${value.toFixed(2)}`;

export async function runUsageGuard(now = new Date()) {
  const token = String(process.env.VERCEL_USAGE_TOKEN || '').trim();
  const teamId = String(process.env.VERCEL_TEAM_ID || '').trim();
  if (!token || !teamId) return { skipped: 'not-configured' as const };

  const ref = adminDb().collection('settings').doc(SETTINGS_DOC);
  const previous = (await ref.get()).data() || {};
  const previousLevel: UsageLevel = LEVELS.includes(previous.level) ? previous.level : 'normal';
  const day = new Date(now.getTime() + 9 * 3600e3).toISOString().slice(0, 10);

  let snapshot: UsageSnapshot;
  try {
    snapshot = await fetchVercelUsage(token, teamId);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[usage-guard] fetch failed', message);
    // 取れないときは前の判定のまま。マスターへは1日1回だけ知らせる。
    const notify = previous.error_notified_day !== day;
    await ref.set({ last_error: message, last_error_at: FieldValue.serverTimestamp(), ...(notify ? { error_notified_day: day } : {}) }, { merge: true });
    if (notify) {
      const recipients = (await loadSchoolStaffRecipients(null)).filter(item => item.isMaster);
      await notifyStaff(recipients, {
        idPrefix: `usage_guard_error_${day}`,
        title: 'Vercel の使用額を確認できませんでした',
        message: `使用額の見張りが Vercel から使用額を取れませんでした（${message}）。トークンの期限や権限を確認してください。節約モードの切り替えは止まっています。`,
        kind: 'usage_guard',
        masterLink: '/master/settings',
      });
    }
    return { ok: false as const, error: message };
  }

  const result = evaluateUsage(snapshot, now, previousLevel);
  await ref.set({
    level: result.level,
    credit_used: snapshot.creditUsed,
    on_demand: snapshot.onDemand,
    projected: result.projected,
    period_start: snapshot.periodStart,
    period_end: snapshot.periodEnd,
    checked_at: FieldValue.serverTimestamp(),
    last_error: null,
  }, { merge: true });

  if (result.level !== previousLevel) {
    revalidateTag(TAG);
    const recipients = (await loadSchoolStaffRecipients(null)).filter(item => item.isMaster);
    const summary = `今月の使用額 ${usd(result.used)}（含まれる額 $20 のうち ${usd(snapshot.creditUsed)}、従量 ${usd(snapshot.onDemand)}）、月末の見込み ${usd(result.projected)}。`;
    await notifyStaff(recipients, {
      idPrefix: `usage_guard_${day}_${result.level}`,
      title: `Vercel の使用量：${USAGE_LEVEL_LABELS[result.level]}になりました`,
      message: result.level === 'normal'
        ? `${summary}使用量が落ち着いたので、通常の動きに戻しました。`
        : `${summary}従量の上限（$20）に達するとアプリ全体が止まるため、重要でない定期処理を自動で減らしています（セキュリティ監視を1時間ごと、未参加の通知を15分ごと、授業後の録画の取り込みとβテストの利用ログを停止）。`
          + (result.level === 'critical' ? '従量課金が増えています。Vercel の Usage で原因を確認してください。' : ''),
      kind: 'usage_guard',
      masterLink: '/master/settings',
      pushBody: `Vercel の使用量が増えたため${USAGE_LEVEL_LABELS[result.level]}にしました。`,
      extra: { usage_level: result.level },
    });
  }
  return { ok: true as const, level: result.level, previous: previousLevel, used: result.used, projected: result.projected };
}
