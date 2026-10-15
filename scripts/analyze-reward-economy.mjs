import admin from 'firebase-admin';

const required = ['NEXT_PUBLIC_FIREBASE_PROJECT_ID', 'FIREBASE_CLIENT_EMAIL', 'FIREBASE_PRIVATE_KEY'];
for (const key of required) {
  if (!process.env[key]) throw new Error(`Missing ${key}`);
}

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
    }),
  });
}

const db = admin.firestore();
const asDate = value => {
  if (!value) return null;
  if (typeof value.toDate === 'function') return value.toDate();
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};
const percentile = (values, p) => {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = (sorted.length - 1) * p;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  return Math.round(sorted[lower] + (sorted[upper] - sorted[lower]) * (index - lower));
};
const summarize = values => ({
  count: values.length,
  sum: values.reduce((sum, value) => sum + value, 0),
  mean: values.length ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length) : 0,
  p25: percentile(values, 0.25),
  p50: percentile(values, 0.5),
  p75: percentile(values, 0.75),
  p90: percentile(values, 0.9),
  p95: percentile(values, 0.95),
  p99: percentile(values, 0.99),
  max: values.length ? Math.max(...values) : 0,
});

const now = new Date();
const start = new Date(now);
start.setUTCFullYear(start.getUTCFullYear() - 1);

const [studentSnap, transactionSnap, rewardSnap, requestSnap, missionSnap] = await Promise.all([
  db.collection('users').where('role', '==', 'student').get(),
  db.collection('coin_transactions')
    .where('created_at', '>=', admin.firestore.Timestamp.fromDate(start))
    .get(),
  db.collection('rewards').get(),
  db.collection('requests').where('type', '==', 'exchange').get(),
  db.collection('settings').doc('mission_control').get(),
]);

const students = new Map();
for (const doc of studentSnap.docs) {
  const data = doc.data();
  const status = String(data.account_status || data.status || 'active').toLowerCase();
  students.set(doc.id, {
    active: !['suspended', 'withdrawn', 'archived', 'inactive'].includes(status),
    balance: Number(data.coins || 0),
    lifetime: Number(data.total_coins || 0),
  });
}

const earnedByStudent = new Map();
const sourceTotals = new Map();
let firstTransaction = null;
let lastTransaction = null;
let positiveTransactions = 0;
let negativeTransactions = 0;
let earnedTotal = 0;
let spentTotal = 0;

for (const doc of transactionSnap.docs) {
  const data = doc.data();
  const date = asDate(data.created_at);
  if (date && (!firstTransaction || date < firstTransaction)) firstTransaction = date;
  if (date && (!lastTransaction || date > lastTransaction)) lastTransaction = date;
  const userId = String(data.user_id || '');
  const student = students.get(userId);
  if (!student || !student.active) continue;
  const amount = Number(data.amount || 0);
  const source = String(data.source || data.reason || 'unknown');
  if (amount > 0) {
    positiveTransactions += 1;
    earnedTotal += amount;
    earnedByStudent.set(userId, (earnedByStudent.get(userId) || 0) + amount);
    const current = sourceTotals.get(source) || { transactions: 0, points: 0, students: new Set() };
    current.transactions += 1;
    current.points += amount;
    current.students.add(userId);
    sourceTotals.set(source, current);
  } else if (amount < 0) {
    negativeTransactions += 1;
    spentTotal += Math.abs(amount);
  }
}

const activeStudents = [...students.values()].filter(student => student.active);
const earners = [...earnedByStudent.values()];
const allActiveEarnings = [...students.entries()]
  .filter(([, student]) => student.active)
  .map(([id]) => earnedByStudent.get(id) || 0);
const sourceBreakdown = [...sourceTotals.entries()]
  .map(([source, value]) => ({
    source,
    transactions: value.transactions,
    points: value.points,
    students: value.students.size,
    share_of_points_pct: earnedTotal ? Number((value.points / earnedTotal * 100).toFixed(1)) : 0,
  }))
  .sort((a, b) => b.points - a.points);

const rewards = rewardSnap.docs.map(doc => {
  const data = doc.data();
  return {
    active: data.active !== false && data.archived !== true,
    required_coins: Number(data.required_coins || 0),
  };
});

const exchangeStatuses = {};
for (const doc of requestSnap.docs) {
  const status = String(doc.data().status || 'unknown');
  exchangeStatuses[status] = (exchangeStatuses[status] || 0) + 1;
}

const result = {
  as_of: now.toISOString(),
  observation_start: start.toISOString(),
  transaction_coverage: {
    first: firstTransaction?.toISOString() || null,
    last: lastTransaction?.toISOString() || null,
  },
  students: {
    total: students.size,
    active: activeStudents.length,
    earned_at_least_once: earners.length,
    earning_rate_pct: activeStudents.length ? Number((earners.length / activeStudents.length * 100).toFixed(1)) : 0,
    current_balance: summarize(activeStudents.map(student => student.balance)),
    lifetime_earned_field: summarize(activeStudents.map(student => student.lifetime)),
  },
  trailing_12_months: {
    earned_points: earnedTotal,
    spent_points: spentTotal,
    positive_transactions: positiveTransactions,
    negative_transactions: negativeTransactions,
    earnings_all_active_students: summarize(allActiveEarnings),
    earnings_earners_only: summarize(earners),
    sources: sourceBreakdown,
  },
  reward_catalog: {
    total: rewards.length,
    active: rewards.filter(item => item.active).length,
    active_thresholds: rewards.filter(item => item.active).map(item => item.required_coins).sort((a, b) => a - b),
  },
  exchange_requests_by_status: exchangeStatuses,
  mission_control: missionSnap.exists ? missionSnap.data() : null,
};

console.log(JSON.stringify(result, null, 2));
