import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';

/**
 * FAMキャンパスの教室（fam_zoom_rooms）の初期データ。
 * Cloudflare 版と同じ教室キーにして、席URLの変更をドメイン部分だけで済ませる。
 * すでにある教室キーは変えない（管理画面での変更を上書きしない）。
 *   確認だけ: npm run fam-zoom:seed
 *   書き込む: npm run fam-zoom:seed -- --apply
 */
const ROOMS = [
  { booth: 'A', room_key: 'booth-a-r4u7rff8', meeting_id: '98332455891' },
  { booth: 'B', room_key: 'booth-b-fzrm3mde', meeting_id: '99440551640' },
  { booth: 'C', room_key: 'booth-c-vhgj4sdu', meeting_id: '99523523516' },
  { booth: 'D', room_key: 'booth-d-m68ydtc3', meeting_id: '91399315833' },
  { booth: 'E', room_key: 'booth-e-wuqqc95t', meeting_id: '99690617768' },
  { booth: 'F', room_key: 'booth-f-kfeasfxg', meeting_id: '91265933813' },
];

const apply = process.argv.includes('--apply');
const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
const privateKey = String(process.env.FIREBASE_PRIVATE_KEY || '').replace(/^"|"$/g, '').replace(/\\n/g, '\n');
if (!projectId || !clientEmail || !privateKey) throw new Error('Firebase Admin の環境変数が必要です。');

if (!getApps().length) initializeApp({ credential: cert({ projectId, clientEmail, privateKey }) });
const collection = getFirestore().collection('fam_zoom_rooms');

console.log(`プロジェクト: ${projectId}（${apply ? '書き込む' : '確認だけ'}）`);
const batch = getFirestore().batch();
let added = 0;
for (const room of ROOMS) {
  const snap = await collection.doc(room.room_key).get();
  if (snap.exists) {
    console.log(`ブース${room.booth}: 登録済み（ミーティングID ${snap.data()?.meeting_id}）→ 変えない`);
    continue;
  }
  console.log(`ブース${room.booth}: 追加（ミーティングID ${room.meeting_id}）`);
  batch.set(collection.doc(room.room_key), {
    booth: room.booth,
    meeting_id: room.meeting_id.replace(/\s/g, ''),
    updated_at: FieldValue.serverTimestamp(),
    updated_by: 'seed-fam-zoom-rooms',
  });
  added += 1;
}
if (apply && added > 0) await batch.commit();
console.log(apply ? `${added}件を追加しました。` : `${added}件を追加します。書き込むときは --apply を付けてください。`);
