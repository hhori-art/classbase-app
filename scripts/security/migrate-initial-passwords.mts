/**
 * 前から users に平文で残っている初期パスワードを、account_secrets のハッシュに移して消す（KDL診断 A.3.1）。
 *
 * - ID書面を刷り終えてから動かす（2026-11-12 決定）。動かしたあとは、書面を刷るたびに新しい初期パスワードになる。
 * - 既定は確かめるだけ（件数を出す。名前やパスワードは出さない）。書き込むときは --apply を付ける。
 * - .env.local の FIREBASE_*（接続先）と INITIAL_PASSWORD_HMAC_SECRET（Vercel と同じ値）を使う。
 *   診断環境で動かすときは --project classbase-security-diagnosis と、その環境の値を入れた env ファイルを --env で渡す。
 *
 *   node --import tsx scripts/security/migrate-initial-passwords.mts --project class-base-app
 *   node --import tsx scripts/security/migrate-initial-passwords.mts --project class-base-app --apply
 */
import fs from 'node:fs';
import { cert, initializeApp } from 'firebase-admin/app';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import { INITIAL_PASSWORD_HASH_VERSION, initialPasswordHmac, newInitialPasswordSalt } from '../../lib/initial-password-hash';

const args = process.argv.slice(2);
const option = (name: string) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
};
const apply = args.includes('--apply');
const expectedProject = option('--project');
const envFile = option('--env') || '.env.local';
if (!expectedProject) throw new Error('--project <Firebase のプロジェクトID> を付けてください（取り違え防止）。');

const env: Record<string, string> = Object.fromEntries(fs.readFileSync(envFile, 'utf8').split(/\r?\n/)
  .filter(line => line && !line.startsWith('#') && line.includes('='))
  .map(line => {
    const index = line.indexOf('=');
    return [line.slice(0, index).trim(), line.slice(index + 1).trim().replace(/^"|"$/g, '')];
  }));
const projectId = env.FIREBASE_PROJECT_ID || env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
if (projectId !== expectedProject) throw new Error(`安全のため止めました：${envFile} の接続先（${projectId}）が --project と違います。`);
const secret = String(env.INITIAL_PASSWORD_HMAC_SECRET || '').trim();
if (secret.length < 32) throw new Error('INITIAL_PASSWORD_HMAC_SECRET（32文字以上、Vercel と同じ値）がありません。');

const app = initializeApp({
  credential: cert({ projectId, clientEmail: env.FIREBASE_CLIENT_EMAIL, privateKey: String(env.FIREBASE_PRIVATE_KEY || '').replace(/\\n/g, '\n') }),
  projectId,
}, `migrate-initial-passwords-${Date.now()}`);
const db = getFirestore(app);

const FIELDS = ['initial_password', 'raw_password', 'password', 'parent_initial_password'];
const counts = { scanned: 0, with_plaintext: 0, hashed: 0, cleared_only: 0, already_hashed: 0 };

let cursor: FirebaseFirestore.QueryDocumentSnapshot | undefined;
for (;;) {
  let query = db.collection('users').orderBy('__name__').limit(200);
  if (cursor) query = query.startAfter(cursor);
  const page = await query.get();
  if (page.empty) break;
  const batch = db.batch();
  let writes = 0;
  for (const doc of page.docs) {
    counts.scanned += 1;
    const data = doc.data();
    if (!FIELDS.some(field => data[field] !== undefined)) continue;
    counts.with_plaintext += 1;
    const plaintext = String(data.initial_password || data.raw_password || data.password || '').trim();
    const userPatch = Object.fromEntries(FIELDS.map(field => [field, FieldValue.delete()]));
    // 初回ログイン前で、まだハッシュがないものだけ、ハッシュを置く。ログイン済みなら平文を消すだけ。
    if (plaintext && data.isFirstLogin !== false) {
      const secretRef = db.collection('account_secrets').doc(doc.id);
      const existing = await secretRef.get();
      if (existing.data()?.initial_password_hash) counts.already_hashed += 1;
      else {
        const salt = newInitialPasswordSalt();
        if (apply) batch.set(secretRef, {
          initial_password_hash: initialPasswordHmac(secret, salt, plaintext),
          initial_password_salt: salt,
          initial_password_version: INITIAL_PASSWORD_HASH_VERSION,
          initial_password_issued_at: FieldValue.serverTimestamp(),
          initial_password_issued_by: 'migration',
        });
        counts.hashed += 1;
        writes += 1;
      }
    } else {
      counts.cleared_only += 1;
    }
    if (apply) batch.set(doc.ref, { ...userPatch, initial_password_migrated_at: FieldValue.serverTimestamp() }, { merge: true });
    writes += 1;
  }
  if (apply && writes) await batch.commit();
  cursor = page.docs[page.docs.length - 1];
}

console.log(JSON.stringify({ project: projectId, mode: apply ? 'apply' : 'dry-run', ...counts }, null, 2));
