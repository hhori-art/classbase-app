import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const root = process.cwd();
const clientTargets = [
  'app/student',
  'app/components/SmartClassButton.tsx',
  'app/components/CalendarWidget.tsx',
  'app/components/NewsWidget.tsx',
  'app/components/TrophyModal.tsx',
  'app/components/StudentCourseRegistrationPrompt.tsx',
  'app/hooks/usePortalVisibility.ts',
  'app/hooks/useMaintenanceStatus.ts',
];
const apiTargets = ['app/api/student'];

const filesIn = (target) => {
  const absolute = join(root, target);
  const stat = statSync(absolute);
  if (stat.isFile()) return [absolute];
  return readdirSync(absolute, { withFileTypes: true }).flatMap(entry => {
    const child = join(absolute, entry.name);
    if (entry.isDirectory()) return filesIn(relative(root, child));
    return /\.(ts|tsx)$/.test(entry.name) ? [child] : [];
  });
};

const readTargets = (targets) => targets.flatMap(filesIn).map(file => ({
  file: relative(root, file),
  source: readFileSync(file, 'utf8'),
}));

const clientFiles = readTargets(clientTargets);
const apiFiles = readTargets(apiTargets);
const allProductFiles = readTargets(['app', 'lib']);
const allServerFiles = readTargets(['app/api', 'lib']);
const count = (files, pattern) => files.reduce((total, item) => total + (item.source.match(pattern) || []).length, 0);

const usage = {
  clientReads: count(clientFiles, /\b(?:getDoc|getDocs|onSnapshot)\s*\(/g),
  studentApiReads: count(apiFiles, /\.get\s*\(/g),
  forcedCourseReloads: count(clientFiles, /loadCourseRegistrationOptions\s*\([\s\S]{0,240}?force\s*:\s*true/g),
  allClientReads: count(allProductFiles, /\b(?:getDoc|getDocs|onSnapshot)\s*\(/g),
  unboundedClientCollections: count(allProductFiles, /getDocs\s*\(\s*collection\s*\(/g),
  serverFirestoreReads: count(allServerFiles, /\.collection\([\s\S]{0,220}?\.get\s*\(/g),
};

// 現行機能を基準線とし、新機能は既存取得の共有・置換またはAPIキャッシュで実装する。
const limits = {
  clientReads: 34,
  // 先生チャットの履歴取得をクライアント直読から本人限定APIへ移した1件を含む。
  studentApiReads: 29,
  forcedCourseReloads: 1,
  allClientReads: 198,
  unboundedClientCollections: 7,
  // 認可済みAPIへ移した景品・申請管理のサーバー検証を含む。景品カタログは5分共有キャッシュ、
  // 管理APIはマスター操作時だけ実行される。復習期間APIは専用画面を開いた時だけ最大20期間を取得し、
  // 生徒ごとの選択も表示対象期間だけに限定する。チャットは全生徒×個別クエリを廃止し、
  // 校舎別の限定取得と選択中の会話100件だけに集約した。保護者履歴も親子再認証後の最大10人×5件に限定し、
  // いずれも授業参加の通常導線には加算されない。手動教材削除時の関連問題確認1件も
  // 理社管理者が明示的に削除した時だけ実行され、生徒の授業・学習導線には加算されない。
  // 保護者ホームはブラウザの直接5クエリと子ども別チャット照会を、親子関係を再検証する
  // 1つの境界APIへ置換した。静的なサーバー読取箇所は9増えるが、画面1回あたりの照会は
  // 従来以下で、他家庭データを要求できないため、この置換分だけ基準線へ加える。
  // 問い合わせ送信の重複防止と、管理者回答＋保護者通知の原子更新に使う2読取は、
  // 保護者または管理者が明示的に書込み操作をした時だけ発生するトランザクション検査である。
  // 通知対象者と当日講師の2読取は、管理画面の直接Firestore取得3件を置換し、校舎境界を
  // サーバーで強制する限定APIである。画面1回あたりの取得回数とクライアント読取は減少する。
  // 認証付きReadiness監視の1読取は5分間隔の運用監視専用で、利用者導線には加算されない。
  // 認証プロフィールAPIの1読取は、ログイン画面・管理者ログイン・AuthContextにあった
  // ブラウザ直接読取を置換し、Firestoreが遮断された端末でも同一ドメイン経由で復旧可能にする。
  // 保護者個別連絡の親子照合、お知らせ設定・既読記録の3箇所は、それぞれ保護者が連絡画面を開く時、
  // マスターが配信設定を保存する時、お知らせ詳細を初めて開く時だけの限定読取である。
  // 添付取得の認可確認もファイルを明示的に開く時だけで、授業参加・受講画面の想定読取には加算されない。
  // Windows/MySQL勤怠同期の5読取箇所は、署名検証済みの同期要求に対するバッチ重複防止、
  // 職員照合、既存打刻との重複検知、更新順序の保護に限定される。生徒・講師の通常画面からは
  // 呼ばれず、同一バッチ内の職員照合はキャッシュされるため、授業受講時の想定読取には影響しない。
  // AI学習クエストの5読取箇所（単元・作成済み問題2・定着度・回答確定）は、生徒画面が
  // quizzes（正解を含む）と定着度を直接読んでいた3クエリを置換したもの。正解を生徒へ渡さず
  // サーバーで正誤判定するための境界で、1クエストあたりの取得回数は従来と同等である。
  // 景品・ガチャ管理の13読取箇所は、権限を持つ管理者の設定・発送操作、または生徒が景品画面を
  // 明示的に開いた時だけ実行される。在庫更新はトランザクション内で再検証し、カタログは共有
  // キャッシュを使うため、授業参加・受講講座・ホーム画面の通常導線には加算されない。
  // 景品交換・ガチャの公開設定をサーバーでも確認する1読取は、60秒の共有キャッシュ経由で、
  // 生徒が景品画面で交換・ガチャを操作した時だけ実行される。
  serverFirestoreReads: 333,
};
const exceeded = Object.entries(limits).filter(([key, max]) => usage[key] > max);

if (exceeded.length > 0) {
  console.error('Student Firestore read budget exceeded.');
  exceeded.forEach(([key, max]) => console.error(`- ${key}: ${usage[key]} (maximum ${max})`));
  console.error('Share an existing request, add a bounded cached API, or remove an equivalent read before adding a new one.');
  process.exit(1);
}

console.log(`Firestore read budget OK: student-client=${usage.clientReads}/${limits.clientReads}, student-api=${usage.studentApiReads}/${limits.studentApiReads}, all-client=${usage.allClientReads}/${limits.allClientReads}, unbounded=${usage.unboundedClientCollections}/${limits.unboundedClientCollections}, server=${usage.serverFirestoreReads}/${limits.serverFirestoreReads}`);
