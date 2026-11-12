/**
 * 毎日の点検で使う、本番の様子（読み取りだけ）。名前・電話番号などの個人情報は出さず、件数と状態だけを JSON で出す。
 *   node scripts/ops/daily-signals.mjs [YYYY-MM-DD]   # 既定は日本時間の昨日
 * 接続先は .env.local（本番）。書き込みは一切しない。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { cert, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const root = process.cwd();
const env = Object.fromEntries(fs.readFileSync(path.join(root, '.env.local'), 'utf8').split(/\r?\n/)
  .filter(line => line && !line.startsWith('#') && line.includes('='))
  .map(line => { const index = line.indexOf('='); return [line.slice(0, index).trim(), line.slice(index + 1).trim().replace(/^"|"$/g, '')]; }));
const projectId = env.FIREBASE_PROJECT_ID || env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
initializeApp({ credential: cert({ projectId, clientEmail: env.FIREBASE_CLIENT_EMAIL, privateKey: String(env.FIREBASE_PRIVATE_KEY || '').replace(/\\n/g, '\n') }), projectId });
const db = getFirestore();

const jstDate = offsetDays => new Date(Date.now() + 9 * 3600_000 + offsetDays * 86400_000).toISOString().slice(0, 10);
const day = process.argv[2] || jstDate(-1);
const today = jstDate(0);
const base = 'https://classbase-app.vercel.app';
const safe = async (name, fn) => { try { return await fn(); } catch (error) { return { error: `${name}: ${String(error?.message || error).slice(0, 160)}` }; } };
const count = query => query.count().get().then(snap => snap.data().count);
const tally = (docs, field) => docs.reduce((map, doc) => { const key = String(doc.get(field) ?? '(なし)'); map[key] = (map[key] || 0) + 1; return map; }, {});

const signals = {
  checked_at: new Date().toISOString(),
  target_day: day,
  project: projectId,
  health: await safe('health', async () => {
    const started = Date.now();
    const res = await fetch(`${base}/api/health`, { cache: 'no-store', signal: AbortSignal.timeout(15000) });
    return { status: res.status, ms: Date.now() - started };
  }),
  pages: await safe('pages', async () => Object.fromEntries(await Promise.all(['/', '/admin/login', '/student', '/teacher/contacts'].map(async page => {
    const res = await fetch(`${base}${page}`, { redirect: 'manual', signal: AbortSignal.timeout(15000) });
    return [page, res.status];
  })))),
  vercel: await safe('vercel', async () => {
    const token = JSON.parse(fs.readFileSync(path.join(os.homedir(), 'Library/Application Support/com.vercel.cli/auth.json'), 'utf8')).token;
    const project = JSON.parse(fs.readFileSync(path.join(root, '.vercel/project.json'), 'utf8'));
    const res = await fetch(`https://api.vercel.com/v6/deployments?projectId=${project.projectId}&teamId=${project.orgId}&target=production&limit=3`, { headers: { Authorization: `Bearer ${token}` } });
    const body = await res.json();
    return (body.deployments || []).map(item => ({ url: item.url, state: item.state || item.readyState, created: new Date(item.created).toISOString() }));
  }),
  usage_guard: await safe('usage_guard', async () => {
    const data = (await db.collection('settings').doc('usage_guard').get()).data() || {};
    return { level: data.level || 'normal', updated_at: data.updated_at?.toDate?.().toISOString?.() || null };
  }),
  auto_notification_runs: await safe('runs', async () => {
    const ids = [`missed_class_${day}`, `missed_class_${today}`];
    const snaps = await db.getAll(...ids.map(id => db.collection('auto_notification_runs').doc(id)));
    return snaps.map(snap => ({ id: snap.id, exists: snap.exists, processed_periods: snap.get('processed_periods') || [], missed: (snap.get('missed') || []).length, summary_sent: Boolean(snap.get('summary_sent')) }));
  }),
  camera_records: await safe('camera', async () => ({ summaries: await count(db.collection('camera_session_summaries').where('target_date', '==', day)) })),
  lesson_analysis: await safe('lesson_analysis', async () => {
    const [transcripts, analyses] = await Promise.all([
      count(db.collection('lesson_transcripts').where('target_date', '==', day)),
      db.collection('lesson_analyses').where('target_date', '==', day).select('status').get(),
    ]);
    return { transcripts, analyses: analyses.size, by_status: tally(analyses.docs, 'status') };
  }),
  absence_notices: await safe('absence', async () => ({ count: await count(db.collection('requests').where('target_date', '==', day).where('type', '==', 'absence')) })),
  roster_calls: await safe('roster_calls', async () => {
    const snap = await db.collection('contact_call_logs').where('date', '==', day).select('roster_status', 'zoom_checked').get();
    return { calls: snap.size, by_roster_status: tally(snap.docs, 'roster_status'), zoom_checked: snap.docs.filter(doc => doc.get('zoom_checked') === true).length };
  }),
  mail: await safe('mail', async () => {
    const data = (await db.collection('mail_delivery_status').doc('gas').get()).data() || {};
    const pending = await count(db.collection('mail_outbox').where('status', '==', 'pending')).catch(() => null);
    return { last_pull_at: data.last_pull_at?.toDate?.().toISOString?.() || data.updated_at?.toDate?.().toISOString?.() || null, remaining_quota: data.remaining_quota ?? null, pending_outbox: pending };
  }),
  security_monitor: await safe('security', async () => {
    const data = (await db.collection('security_monitor_days').doc(day).get()).data() || {};
    const counts = Object.fromEntries(Object.entries(data).filter(([, value]) => typeof value === 'number'));
    return { exists: Object.keys(data).length > 0, counts };
  }),
  ops_decisions_pending: await safe('ops', async () => count(db.collection('ops_decisions').where('status', '==', 'pending'))),
};

console.log(JSON.stringify(signals, null, 1));
process.exit(0);
