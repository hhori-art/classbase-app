const admin = require('firebase-admin');

const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || process.env.FIREBASE_PROJECT_ID;
const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
const privateKey = (process.env.FIREBASE_PRIVATE_KEY || '').replace(/^"|"$/g, '').replace(/\\n/g, '\n');

if (!projectId || !clientEmail || !privateKey) {
  throw new Error('Missing Firebase Admin env');
}

admin.initializeApp({
  credential: admin.credential.cert({ projectId, clientEmail, privateKey }),
});

async function main() {
  const db = admin.firestore();
  const snap = await db.collection('users').get();
  let batch = db.batch();
  let count = 0;

  for (const doc of snap.docs) {
    const data = doc.data();
    const update = {};

    if (!data.account_status) update.account_status = data.status || 'active';
    if (!data.status) update.status = update.account_status || 'active';
    if (!data.school_id && data.school) update.school_id = data.school;
    if ((data.role === 'admin' || data.role === 'master') && !Array.isArray(data.school_ids)) {
      update.school_ids = data.school_id || data.school ? [data.school_id || data.school] : [];
    }

    if (Object.keys(update).length > 0) {
      batch.set(doc.ref, update, { merge: true });
      count++;
    }

    if (count > 0 && count % 450 === 0) {
      await batch.commit();
      batch = db.batch();
    }
  }

  await batch.commit();
  console.log(`normalized ${count} users`);
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});

