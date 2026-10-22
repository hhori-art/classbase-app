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
  // 振替候補APIの授業時刻設定1件（今日の終了済み時限を候補から外す）を含む。
  // 生徒の掲示板の「自分の申請中の投稿」（本人の投稿だけ最大30件）と、録画一覧の視聴済み表示
  // （本人の視聴記録を1回で最大500件）の2読取を加え、今日の授業APIの照合処理を共通ヘルパーへ
  // 移した分（Map の参照1件がこのAPI群から外れた）を差し引いた +1。
  // 生徒の「自分の記録」API（app/api/student/records）の6読取を加える：本人の直近8週の出席（最大70件）、
  // 出席の通算（count() 集計で文書を読まない）、直近8週の録画視聴（最大200件・select）、宿題の進捗1件、
  // 今月のAIクエスト結果（最大200件・select）と今月のコイン記録（最大300件・select）。
  // 生徒が「自分の記録」を開いた時だけ実行され、ホーム・授業参加の導線には加算されない。+6。
  studentApiReads: 37,
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
  // 録画の自動アップで既存の公開データ（手動承認・差し替え・停止中）を確認する1読取は、
  // Zoomの録画完了通知または日次同期で講師配置の主録画が決まった時だけ実行される。
  // 講師の通勤定期を勤怠管理者が確認・削除する2読取（一覧と削除対象の確認）は、
  // 勤怠管理者が定期の管理画面を開いた時・削除した時だけ実行され、生徒の導線には加算されない。
  // 保護者の学習状況（授業日ごとのZoom参加・録画視聴・欠席）は、親子関係を再検証する境界APIで
  // 出席（日付範囲）・録画視聴・欠席・振替を読む。ホームのAPIは従来の出席・録画視聴の直読2件をこれに置換した。
  // 欠席連絡の締切確認（授業時刻設定1件）は連絡送信時だけ、AIチャット履歴の続き読み込み（カーソル1件）は
  // 保護者が「もっと前を見る」を押した時だけ実行され、生徒の授業・学習導線には加算されない。
  // AIチャットの安全アラート（保護者・管理者の宛先取得2件）は危険な内容を検知した時だけ、
  // 安全アラート管理APIのページ送り1件は管理者が一覧を開いた時だけ実行される。保護者連絡の
  // 管理一覧はページ送りに変え、問い合わせ作成時の管理者宛先取得と合わせて既存の読取箇所内に収めた。
  // 欠席・振替の6箇所（同日の欠席を1件にまとめる照会、欠席1件につき振替1件にするための振替記録の確認、
  // 保護者側 student_ids からの通知先取得、振替候補で終了済みの時限を外すための授業時刻設定1件、
  // 復習期間の更新・終了前の存在確認2件）は、保護者・生徒が連絡や振替を送信した時、振替候補を開いた時、
  // 理社管理者が期間を保存・終了した時だけ実行される。
  // 保護者機能の4箇所：欠席・遅刻の取り消し（取消対象の連絡1件と、つながった振替1件の確認）は
  // 保護者・生徒が「取り消す」を押した時だけ、保護者ホームの要約（教室からの返信の未読数を count() 集計、
  // 重要・緊急のお知らせを最新50件から絞り込み）は保護者ホームを開いた時だけ実行され、生徒の導線には加算されない。
  // 生徒の時間割（本人・保護者の時間割API共通）の3箇所：14日分の講師配置と年間予定の休みは全生徒で
  // 共有する5分キャッシュ、受講登録は本人分だけ最大50件。掲示板の申請中の投稿1件と録画の視聴済み表示1件は
  // 上の studentApiReads と同じ理由で加える（掲示板の通報は決まったIDへの create で重複を防ぎ、読取を増やさない）。
  // 管理画面の対応待ち（lib/server/admin-inbox.ts）の6箇所：管理メニューの表示設定1件（60秒の共有キャッシュ）と、
  // マスター専用の対応待ち一覧で種類ごとに最大10〜40件を読む5件。件数は count() 集計で文書を読まず、
  // 管理者がホーム・対応待ちを開いた時だけ実行され、生徒の導線には加算されない。
  // 生徒の「自分の記録」API の6読取（上の studentApiReads と同じ理由）。+6。
  // 保護者の「月のレポート」（lib/server/parent-monthly-report.ts）で静的に数えられる1読取（コイン記録、その月だけ最大300件・select）。
  // 他の項目も上限つきか count() 集計で、保護者がレポートを開いた時だけ実行され、生徒の導線には加算されない。+1。
  // 管理画面の「生徒の総合ページ」（app/api/admin/students/[id]/overview）の9読取：生徒本人1件、受講登録20件、
  // 欠席・振替 各10件、保護者連絡（生徒指定20件＋保護者3人まで各10件、マスターのみ）、安全アラート20件（マスターのみ）、
  // コイン履歴10件、出席15日分、録画視聴10件、Monoxer 1件。管理者が1人の生徒を開いた時だけ実行される。
  // 生徒検索は5分共有キャッシュの名簿（select で必要項目のみ）から探し、検索ごとには読まない。+9。
  // +5: 講師のシフト提出・代行依頼API（/api/teacher/shifts・substitutions）のサーバー側の検証。講師画面だけで使い、生徒画面には影響しない。
  // +4: 教室への連絡の返信のひな形API（/api/admin/reply-templates）の一覧・件数上限確認・更新/削除前の存在確認。最大50件、マスター操作時だけ実行。
  // +4: 端末への通知（Web Push）。lib/server/web-push.ts の配信停止設定1件と宛先の購読（in 条件30人ずつ・1人10台まで）、
  // /api/push/subscriptions の本人の購読一覧（最大20件、10台上限の確認）と削除前の本人確認1件。利用者が通知を
  // オン・オフした時と、アプリ内通知を書いた後（購読がある時だけ）に実行され、授業参加の導線には加算されない。
  // お知らせの端末通知（lib/server/announcement-push.ts）の2読取を加える：お知らせ1件の確認（1回だけ送るための
  // トランザクション）と、対象の役割ごとの利用者（最大5000人・select）。マスターがお知らせを配信した時だけ実行され、
  // 生徒・保護者の画面からは呼ばれない。+2。
  // +1: 講師の基本勤務設定API（/api/teacher/availability-profile）の本人の設定1件（旧データの勤務地を残すための確認）。
  // ブラウザからの直接書き込みを置き換えたもので、講師が設定を保存した時だけ実行される。
  // +3: 代行依頼の再募集API（/api/admin/substitutions）の依頼1件・依頼した講師1件（校舎の確認）・講師配置1件。
  // 管理者が再募集した時だけ実行され、生徒画面には影響しない。
  // +2: パスワード再設定の依頼（「メールが使えない」）。対応待ち一覧（lib/server/admin-inbox.ts、マスター専用）の
  // 依頼の新しい順40件と、依頼を受けた時に保護者の校舎を最初のお子さま1件から求める読取
  // （lib/server/password-recovery-notify.ts）。ログイン画面の依頼と管理者の対応待ちでだけ実行され、生徒画面には影響しない。
  // +2: 攻撃の監視ジョブ（lib/server/security-monitor.ts）。しきい値以上の IP・アカウントの集計（1日あたり最大20件）と、
  // 期間内の管理操作の監査ログ（最大200件）。Vercel Cron から1日1回（有料プラン後は5分ごと）だけ実行され、
  // 利用者の画面からは呼ばれない。出来事の記録（lib/server/security-events.ts）は increment の書き込みだけで読まない。
  // +4: 自動の通知（lib/server/auto-notifications.ts）。授業の未参加（毎晩1回）：受講登録の生徒ID（select・最大5000件）と
  // 今日の参加記録（select）。生徒ごとの時間割は既存の buildStudentTimetable（講師配置・年間予定は共有キャッシュ）を使う。
  // 勤務詳細の未登録（毎朝1回）：前日〜3日前の勤務記録。打刻修正の結果：承認・差し戻しの時に申請した講師1人のプロフィール。
  // いずれも Vercel Cron か管理者の承認操作のときだけで、生徒・保護者の画面からは呼ばれない。
  // +6: 自動の通知の追加分（lib/server/auto-notifications.ts）。授業の未参加を時限ごと（開始10分後）にしたための
  // 実行記録1件と今日の講師配置（何限の授業に参加したかの判定、select）、打刻忘れで「申請中の打刻修正」（最大500件・select）、
  // 振替の未選択で欠席連絡（2〜7日前の範囲だけ）。いずれも Vercel Cron（1日数回）だけで、利用者の画面からは呼ばれない。
  // +2: 授業の発言チェック（lib/server/lesson-transcript-check.ts・/api/admin/lesson-language）。言葉の設定1件と、
  // マスターが結果の画面を開いたときのチェック結果（直近30日・最大400件）。文字起こしの取り込みは録画を付けたときだけで、
  // 生徒・保護者の画面からは呼ばれない。
  // +26: 専任の勤怠の作り直し（/api/dedicated-attendance・/api/admin/dedicated-attendance・lib/server/dedicated-attendance.ts）。
  // 時間外の予定（D05/D06）・実施報告（D07）・月の報告書（D08）・講習の授業を足し、本人の画面は本人の申請だけ（user_id で絞る）、
  // 承認者の画面は表示中の月の範囲と承認待ちだけを読む。旧 /api/admin/dedicated-claims（5件）は削除した。
  // いずれも専任と承認者の操作のときだけで、生徒・保護者の画面からは呼ばれない。
  // +2: 専任の手続きの案内（runDedicatedReportReminders）。毎朝の Vercel Cron で、月初1〜3日と20日だけ専任の一覧と前の月の報告書を読む。
  serverFirestoreReads: 443,
};
const exceeded = Object.entries(limits).filter(([key, max]) => usage[key] > max);

if (exceeded.length > 0) {
  console.error('Student Firestore read budget exceeded.');
  exceeded.forEach(([key, max]) => console.error(`- ${key}: ${usage[key]} (maximum ${max})`));
  console.error('Share an existing request, add a bounded cached API, or remove an equivalent read before adding a new one.');
  process.exit(1);
}

console.log(`Firestore read budget OK: student-client=${usage.clientReads}/${limits.clientReads}, student-api=${usage.studentApiReads}/${limits.studentApiReads}, all-client=${usage.allClientReads}/${limits.allClientReads}, unbounded=${usage.unboundedClientCollections}/${limits.unboundedClientCollections}, server=${usage.serverFirestoreReads}/${limits.serverFirestoreReads}`);
