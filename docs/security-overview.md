# ClassBase セキュリティ概要（診断ご担当者さま向け）

最終更新: 2026-10-19
対象: ClassBase（Next.js 15 App Router + Firebase）。本書はリポジトリのコードから確認できる事実だけを記載しています。設定値（環境変数の実際の値、Vercel・Firebase のプロジェクト設定）は本書の対象外で、運用担当者が別途ご案内します。

## 1. 構成

| 要素 | 内容 |
|---|---|
| 画面・API | Next.js 15（App Router、15.5.28 以上）。Vercel 上で配信。API は `app/api/**/route.ts` の Route Handler（Node.js 24.x ランタイム、最大 60 秒）。Node.js の修正版（`MIN_PATCHED_NODE`）より古い版で動いていると、毎日のセキュリティ監視がマスターへ知らせる |
| 実行リージョン | `vercel.json` に `"regions": ["hnd1"]`（東京）を指定。Firestore（asia-northeast1）と同じ地域で実行する。※次回デプロイから有効 |
| データベース | Cloud Firestore（asia-northeast1）。サーバーは Firebase Admin SDK、ブラウザは Firebase JS SDK（セキュリティルールで制御） |
| 認証 | Firebase Authentication（メールアドレス＋パスワード） |
| ファイル | Cloud Storage for Firebase（us-central1）。ブラウザからの直接読み書きは原則禁止し、サーバーが権限を確認して発行する短時間の署名付きURLで配信 |
| 定期処理 | Vercel Cron（`/api/zoom/recordings/sync` を毎日 1:00 UTC） |
| ミドルウェア | `middleware.ts`。診断環境（`SECURITY_DIAGNOSIS_MODE=true`）では許可IP（`ALLOWED_IPS`）以外を全画面・全APIで遮断。本番では無効 |

### 外部サービス

| サービス | 用途 | 送るデータ |
|---|---|---|
| OpenAI API | 生徒のAIチューター（`/api/chat`）、写真からの問題作成（`/api/ocr-quiz`）、宿題問題の生成、講師向けリスク分析、Booster の英作文評価 | 生徒の質問文・直近の会話・画像、学習記録の集計値 |
| Zoom（Server-to-Server OAuth API・Meeting SDK・Webhook） | 授業の会議作成、ホスト開始（ZAK）、録画の取得と再生 | 会議ID、シフト情報、録画ファイルID |
| LINE（LINE Login・Messaging API） | 保護者・職員の LINE 連携と通知 | LINE ユーザーID、通知本文 |
| Resend / Firebase の mail コレクション | パスワード再設定・確認メール | メールアドレス、再設定リンク |
| Web Push（各ブラウザのプッシュサービス） | 端末への通知 | 通知のタイトル・本文・リンク（VAPID で署名） |
| 駅すぱあと / NAVITIME | 講師の交通費計算 | 駅名・経路 |
| Monoxer | 学習記録の取り込み・アプリへのリンク | 生徒番号、学習量 |
| 外部勤怠システム | 勤怠データの取り込み（HMAC 署名付き）・定期同期 | 勤怠記録 |
| Google Apps Script | シフト表の同期、アカウント一括作成（共有秘密で認証） | シフト・アカウント情報 |
| Google Fonts | Webフォント | なし（ブラウザから取得） |

## 2. ロールと権限

### ロール（`users/{uid}.role`、`lib/server-auth.ts` の `normalizeRole`）

| ロール | 説明 |
|---|---|
| `student` | 生徒（中学生中心、未成年） |
| `parent`（`guardian`） | 保護者。`student_ids` または生徒側の `parent_uid` で連携した子だけを扱える |
| `teacher` | 講師。雇用区分（専任・準専任など）、担当プログラム（`enabled_programs`：理社講座 `science_social` など）、勤怠承認者フラグ（`attendance_school_manager`）を持つ |
| `admin`（`school_admin` など別名あり） | 管理者。アプリごとの管理権限（下記）と担当校舎（`school_id` / `school_ids`）を持つ |
| `attendance_admin`（`attendance_only` など） | 勤怠アプリ専用の管理アカウント |
| `master` | 全権限のマスター管理者 |

未知のロール文字列は `student` として扱われます（最小権限側へ倒す）。

### 管理アプリごとの権限（`lib/admin-app-permissions.ts`）

管理者の権限はアプリごとに独立しています：理社講座（`science_social`）／Booster（`eiken`）／勤怠（`attendance`）／オンライン校（`online_school`）。マスターは全アプリ。`admin_permissions` 未設定の古い管理者は理社講座のみ。

API では主に次の判定を使います（`lib/server-auth.ts`）。

| 判定 | 内容 |
|---|---|
| 理社管理（`isAdminLike`） | マスター、または理社講座の権限を持つ管理者 |
| 校舎範囲（`canManageSchool`） | マスターは全校舎。理社講座の管理者は担当校舎だけ |
| 勤怠管理（`canManageAttendance` / `canManageAttendanceSchool`） | 勤怠権限の管理者・勤怠専用アカウント・専任の勤怠承認者講師。校舎で範囲を限定 |
| 勤怠システム管理（`canManageAttendanceSystem`） | 勤怠権限を持つ管理者（給与・取り込み等） |
| シフト管理（`canManageShifts`） | マスター・専任の勤怠承認者 |
| 理社講師ツール（`canUseScienceSocialStaffTools`、2026-10-19 追加） | マスター、理社講座権限の管理者、講師（担当プログラムが設定されている場合は理社講座を含むこと） |
| Booster（`lib/eiken/access.ts`） | 受講登録済みの生徒、担当コースの講師、Booster 権限の管理者（担当校舎） |

画面側（`app/master/layout.tsx` など）でも同じ権限で表示を制御していますが、**判定の正はサーバー側**です。

## 3. 取り扱うデータと分類

| 分類 | 例 | 主な保護 |
|---|---|---|
| 未成年の個人情報 | 生徒の氏名・学年・校舎・ログインID、保護者の連絡先 | 校舎範囲での絞り込み、講師向けには安全な項目だけを返す（`toSafeTeacherStudent`） |
| 学習記録 | 出欠、宿題、PF、クエスト、Booster の成績 | 本人・連携保護者・担当職員に限定 |
| AIチャット | 生徒とAIの会話（`users/{uid}/chat_history`）、安全アラート（`safety_alerts`） | ブラウザから直接読めない（サーバー専用）。安全確認は応答と並行してサーバーで実施 |
| 授業の録画 | Zoom 録画 | 視聴権限の確認後、単回・10分の再生チケットまたは短時間URLで再生 |
| 職員の勤怠・給与 | 勤務実績、交通費、給与計算 | 勤怠権限と担当校舎で限定。給与は勤怠システム管理のみ |
| 認証情報 | 初期パスワード、再設定トークン | 再設定・確認トークンはハッシュで保存し単回・期限付き。監査ログからは秘密情報らしい項目を除外 |

## 4. 認証とセッション

- ブラウザは Firebase Auth の ID トークン（有効期限約1時間）を `Authorization: Bearer` で送ります。
- サーバーは `getServerUser()` で `verifyIdToken(token, true)`（**失効確認あり**）を行い、`users/{uid}` のプロフィールを読み、`account_status` / `status` が `suspended`・`withdrawn`・`archived` のアカウントは拒否します。
- 認証失敗は 401（`code: reauth-required`）、権限不足は 403 を返します（`jsonError`）。
- パスワード変更・管理者によるパスワード変更・利用停止時は `revokeRefreshTokens` で既存のセッションを失効させます。
- パスワードの最小長：生徒・保護者・講師は6文字、管理系アカウントは10文字（`lib/password-policy.ts`）。
- 初回ログイン・パスワード再設定申請は、IP とアカウントの両方でレート制限しています。
- **職員の無操作タイムアウト（2026-10-19 追加）**：管理画面（`/master`）と講師画面（`/teacher`）では、4時間操作がないと自動でログアウトし、5分前に警告を出します（`app/hooks/useStaffIdleTimeout.ts`、定数 `STAFF_IDLE_TIMEOUT_MS`）。操作時刻は `localStorage` で全タブに共有します。生徒・保護者には適用しません。
- **ログアウト時の通知登録の削除（2026-10-19 追加）**：ログアウト前に、この端末の Web Push 登録を解除し、サーバー側の登録（`/api/push/subscriptions` DELETE）も削除します。失敗してもログアウトは止めません（最大3秒）。

## 5. Firestore / Storage のルール

- `firestore.rules` はコレクションごとに明示的なルールを定義しています。サインイン判定でも利用停止中のアカウントを除外します。
- 次のような機微なコレクションは `allow read, write: if false`（**サーバー専用**、Admin SDK 経由のAPIだけが扱う）です：AIチャット履歴（`users/{uid}/chat_history`）、安全アラート、監査ログ（`admin_audit_logs`）、Web Push 登録、返信テンプレート、パスワード再設定・確認トークン、レート制限、録画の再生セッション・秘密値、景品・ガチャ、オンライン校の進捗など。
- 一部のコレクション（出欠、宿題、シフト等）はブラウザから直接読み書きでき、ロール・本人・校舎の条件をルールで確認しています。
- ルールに定義のないコレクションは、読み取りは理社管理の管理者、書き込みはマスターだけに許可する包括ルールがあります。
- `storage.rules` は、勤怠Excelの本人によるアップロード（形式・サイズ制限付き）以外を全て拒否します。ファイルの配信はサーバーが権限を確認したうえで署名付きURLを発行します。
- ルールのテスト：`tests/security/firestore.rules.test.mjs`、`tests/security/storage.rules.test.mjs`（エミュレータで実行）。

## 6. レート制限

Firestore のトランザクションによる固定ウィンドウ方式（`consumeRateLimit`、`lib/server/password-recovery.ts`）。

| 対象 | 制限 |
|---|---|
| 初回ログイン（生徒等） | IP ごと 12回/15分、アカウントごと 6回/15分 |
| 初回ログイン（管理者） | IP ごと 8回/15分、アカウントごと 5回/15分 |
| パスワード再設定申請・確認メール | IP・アカウントごとに制限 |
| AIチューター（`/api/chat`） | 6回/分、40回/時（生徒ごと） |
| AIチャットのスタンプ、生徒⇔講師チャット、AI会話の報告 | 利用者ごとに制限 |
| 写真から問題作成（`/api/ocr-quiz`）、宿題問題の生成 | 分・時間ごとに制限 |
| クエスト開始 | 時間ごとに制限 |
| 講師向けリスク分析（`/api/teacher/analyze-risk`） | 10回/時（利用者ごと、2026-10-19 追加） |

Firebase Auth のサインイン自体のブルートフォース対策は Firebase の仕組みに依存します。アプリ側で全APIに一律のレート制限は設けていません。

## 7. 監査ログ

- `admin_audit_logs` コレクション（サーバー専用）に、アカウント作成・パスワード変更・利用停止・権限変更・取り込み・承認などの管理操作を記録します（`lib/server/audit-log.ts`、約30のAPIルートから記録）。
- 操作者はサーバーで確認した利用者から記録し、ブラウザから送られた名前は使いません。`password`・`secret`・`token` などを含む項目は保存しません。
- 閲覧はマスターだけ（`GET /api/admin/audit-log`）。画面操作の記録依頼（`POST`）は対象操作ごとに権限を確認します。

### 7.1 攻撃の監視（2026-10-22 追加）

- **記録**（`lib/server/security-events.ts`）：次の出来事を、日別・IP別・アカウント別に集計します（`security_monitor_days/{日付}` と `…/subjects`、サーバー専用、30日で期限切れ）。記録は `FieldValue.increment` の書き込みだけで、読み取り予算（`docs/student-firestore-read-budget.md`）を増やしません。応答の後に書くため、利用者の操作は遅くなりません。
  - ログインの失敗・回数制限での拒否（`/api/first-login`・`/api/admin/first-login`。`lib/server/security-login-monitor.ts`）
  - ログインなし・無効なトークンでの API 呼び出し（`getServerUser`）
  - 脆弱性を探るアクセス（`.php`・`wp-admin`・`.env`・`.git` など。`middleware.ts` が `/api/security/probe` へ振り替え、404 を返す。判定は `lib/security-probe.ts`）
  - 署名が合わない Zoom の通知
- **監視ジョブ**（`lib/server/security-monitor.ts`、`GET /api/security/monitor`）：Vercel Cron で毎朝7時（日本時間）に直近24時間を確認します。マスターは `POST` で手動実行できます。しきい値（`DAILY_THRESHOLDS`）を超えた出来事と、監査ログの深夜（0〜5時）の重要な操作・1人による大量の重要な操作を見つけると、マスターへアプリ内通知と端末通知を送り、結果を `security_monitor_reports` に残します（90日で期限切れ）。
- **メール通知**：Vercel の環境変数 `SECURITY_ALERT_EMAILS`（カンマ区切り、最大10件）に設定したアドレスへ、Resend で同じ内容をメールでも送ります。マスターが `POST /api/security/monitor?test_email=1` を実行すると、見つかったものがなくてもテストのメールを送ります。
- **有料プランへの切り替え後**：`vercel.json` の監視の実行間隔を5分ごとにし、パスに `?hours=1` を付けます。短い期間では読み取りを最大60件程度に絞るので、5分ごとでも読み取り予算に収まります。
- **期限切れの削除**：Firestore の TTL ポリシーを `security_monitor_days`（サブコレクション `subjects` を含む）と `security_monitor_reports` の `expires_at` に設定すると、古い集計が自動で消えます（未設定でも動作には影響しません）。
- **限界**：検知と通知までです。アプリより手前での遮断（Vercel Firewall のルール、ログの長期保存）は有料プランの機能です。

## 8. 秘密情報の扱い

- 秘密値は Vercel の環境変数に置き、サーバーのコードだけが参照します（`server-only`）。`NEXT_PUBLIC_*` はブラウザに公開される設定値（Firebase の公開設定、VAPID 公開鍵など）だけです。
- 署名付きトークン（授業参加・講座登録・振替候補・LINE 連携の state）は専用の HMAC 秘密値で署名し、有効期限を確認します。
- 共有秘密・署名の比較は定数時間比較（`timingSafeEqual`）で行います（GAS 連携、シフト同期、ヘルスチェック、Zoom Webhook、Cron）。
- 外部から呼ばれるサーバー間APIの認証：

| API | 方式 | 必要な環境変数 |
|---|---|---|
| Vercel Cron（`GET /api/zoom/recordings/sync`、`GET /api/attendance-integration/sync`） | `Authorization: Bearer ${CRON_SECRET}`。未設定時は常に 401 | `CRON_SECRET`（**必須**。32文字以上のランダム値を推奨。Vercel は設定されていると自動で付けて呼ぶ） |
| 外部勤怠の取り込み | HMAC 署名＋タイムスタンプ | `ATTENDANCE_HMAC_SECRET`（32文字以上。未設定時は 503） |
| Zoom Webhook | Zoom の署名検証 | `ZOOM_WEBHOOK_SECRET` |
| GAS からのアカウント作成・シフト同期 | 共有秘密 | `CLASSBASE_GAS_USER_SECRET` / `SHIFT_SYNC_SECRET` |
| 詳細ヘルスチェック | Bearer 共有秘密（未指定時は死活のみ） | `OPS_HEALTH_SECRET` |

## 9. セキュリティヘッダー（`next.config.mjs`）

全パスに付与：

- `Content-Security-Policy`：`default-src 'self'`、`frame-ancestors 'none'`、`object-src 'none'`、`base-uri 'self'`、`form-action 'self'`。外部は Zoom・Firebase/Google API・Monoxer・Google Fonts のみ許可。
- `Strict-Transport-Security: max-age=31536000; includeSubDomains`
- `X-Frame-Options: DENY`、`X-Content-Type-Options: nosniff`
- `Referrer-Policy: strict-origin-when-cross-origin`
- `Permissions-Policy: geolocation=(), microphone=(self), camera=(self), fullscreen=(self)`

録画再生のリダイレクトには `Cache-Control: private, no-store` と `Referrer-Policy: no-referrer` を付けています。

## 10. 既知の制限・対象外

| 項目 | 内容 |
|---|---|
| CSP | Zoom Meeting SDK のため `script-src` に `'unsafe-inline'` `'unsafe-eval'` を許可しています |
| 録画の再生URL | `<video>` 要素で再生するため、`/api/zoom/recordings/file` は ID トークンをクエリ（`?token=`）でも受け付けます（有効期限約1時間）。共有ボタン経由の再生は単回の再生チケットを使います |
| 無操作タイムアウト | 画面側（ブラウザ）の仕組みです。サーバー側のセッション期限は Firebase の ID トークン（約1時間、自動更新）に従います |
| Meeting SDK 署名 | `/api/zoom/meeting-sdk-signature` はログイン済みの利用者に参加者用の署名を発行します（会議番号の担当確認はしていません。会議への参加には Zoom 側のパスコードが必要）。ホスト用の署名は講師・管理者だけです |
| 担当プログラム未設定の講師 | 理社講師ツールの API は、担当プログラムが未設定の古い講師アカウントを従来どおり許可します（画面側では理社講座の講師だけに表示）。生徒の範囲は担当校舎に限定されます |
| Firestore の包括ルール | ルールに定義のないコレクションは理社管理の管理者が読み取れます |
| データの所在 | Storage バケットは us-central1 です（Firestore は asia-northeast1） |
| 古い互換の環境変数 | GAS 連携・シフト同期は `CLASSBASE_SYNC_SECRET` / `SECRET_KEY` も代替として読みます |
| 依存パッケージ | `npm audit --omit=dev` は 0 件（2026-10-19、AI SDK を v6 に更新後） |
| 対象外 | Vercel・Firebase・Google Cloud の基盤、各外部サービス本体、GAS のスクリプト、外部勤怠システム、利用者の端末 |

## 11. API 一覧（認証・権限）

2026-10-19 時点のコードから作成（`app/api/**/route.ts`）。「IDトークン」は `getServerUser()` による Firebase ID トークンの検証（失効確認・利用停止確認あり）を表します。廃止済み（410）の API は処理を行いません。

| パス | メソッド | 認証 | 権限・範囲 |
|---|---|---|---|
| `/api/admin/account-import-batches` | GET, POST | IDトークン | GET: マスター（校舎管理者は担当校舎指定時のみ）／POST: マスター |
| `/api/admin/accounts/create` | POST | IDトークン | マスター。校舎管理者は担当校舎の生徒・講師・保護者のみ作成 |
| `/api/admin/accounts/employment-category` | POST | IDトークン | マスター |
| `/api/admin/accounts/password` | POST | IDトークン | マスター／校舎管理者は担当校舎の生徒・保護者のみ |
| `/api/admin/accounts/programs` | POST | IDトークン | マスター |
| `/api/admin/accounts/status` | POST | IDトークン | マスター／校舎管理者は担当校舎の生徒のみ |
| `/api/admin/accounts/sync-printed-password` | POST | IDトークン | マスター／校舎管理者（担当校舎の対象のみ） |
| `/api/admin/app-permissions` | GET, PATCH, POST | IDトークン | マスター |
| `/api/admin/attendance-integration` | GET, POST | IDトークン | 勤怠システム管理 |
| `/api/admin/audit-log` | GET, POST | IDトークン | GET: マスター／POST: 理社管理（シフト解除はシフト管理者も） |
| `/api/admin/beta-analytics` | GET | IDトークン | 理社管理 |
| `/api/admin/beta-logs` | POST | IDトークン | 理社管理 |
| `/api/admin/bootstrap-profile` | POST | IDトークン（直接検証） | 確認済みメールが ADMIN_BOOTSTRAP_EMAILS に一致する場合のみ、未作成プロフィールを作成 |
| `/api/admin/community-reports` | GET, PATCH | IDトークン | マスター |
| `/api/admin/course-analytics` | GET, POST | IDトークン | マスター |
| `/api/admin/course-registrations/import` | POST | IDトークン | 理社管理 |
| `/api/admin/course-registrations` | POST | IDトークン | 理社管理（担当校舎） |
| `/api/admin/dedicated-attendance` | GET, POST | IDトークン | 勤怠管理・専任の校舎承認者（担当校舎の専任だけ。自分自身の承認は不可。校長の一括申請（D05）の承認・等級・講習期間の設定は勤怠システムの管理者だけ） |
| `/api/admin/first-login` | POST | 公開 | 管理者の初回ログイン。ID＋初期パスワード照合、IP・アカウント単位のレート制限 |
| `/api/admin/gachas` | GET, PATCH, POST | IDトークン | 理社管理（景品カタログ） |
| `/api/admin/inbox-counts` | GET | IDトークン | いずれかの管理アプリ権限を持つ管理者・専任の勤怠承認者（件数は権限の範囲のみ） |
| `/api/admin/inbox` | GET | IDトークン | マスター |
| `/api/admin/notifications` | GET, POST | IDトークン | 理社管理または勤怠管理（担当校舎・対象ロールに限定） |
| `/api/admin/parent-inquiries` | GET, PATCH | IDトークン | 理社管理（担当校舎） |
| `/api/admin/password-recovery-requests` | GET, PATCH | IDトークン | マスター |
| `/api/admin/pf/import` | POST | IDトークン | 理社管理（担当校舎の生徒のみ取り込み） |
| `/api/admin/points` | GET, POST | IDトークン | 理社管理（担当校舎の生徒）。一部操作はマスターのみ |
| `/api/admin/recordings/resolve-zoom` | POST | IDトークン | 理社管理 |
| `/api/admin/reply-templates` | DELETE, GET, PATCH, POST | IDトークン | マスター |
| `/api/admin/requests` | GET, POST | IDトークン | GET: 理社管理（担当校舎）／POST: マスター |
| `/api/admin/reward-shipments` | GET, POST | IDトークン | 理社管理（担当校舎の生徒） |
| `/api/admin/rewards` | GET, PATCH, POST | IDトークン | 理社管理 |
| `/api/admin/safety-alerts` | GET, PATCH | IDトークン | 理社管理（担当校舎） |
| `/api/admin/school-students/attendance-follow-ups` | POST | IDトークン | 校舎生徒閲覧（理社管理または専任・理社の講師、担当校舎） |
| `/api/admin/school-students/bulk-absence` | POST | IDトークン | 理社管理（担当校舎） |
| `/api/admin/school-students/import` | POST | IDトークン | 理社管理（担当校舎） |
| `/api/admin/school-students/lifecycle` | POST | IDトークン | 理社管理（担当校舎）。一部操作はマスターのみ |
| `/api/admin/school-students/options` | POST | IDトークン | 理社管理（担当校舎） |
| `/api/admin/school-students` | GET | IDトークン | 校舎生徒閲覧（理社管理または専任・理社の講師、担当校舎） |
| `/api/admin/shifts/[shiftId]/passcode` | PATCH | IDトークン | シフト管理（マスター・専任の勤怠承認者） |
| `/api/admin/shifts/relink` | POST | IDトークン | シフト管理 |
| `/api/admin/shifts/sync` | GET, POST | IDトークン または 共有秘密（x-shift-sync-secret ヘッダー、定数時間比較） | シフト管理／GAS連携 |
| `/api/admin/shifts/unassigned-notifications` | POST | IDトークン | シフト管理 |
| `/api/admin/shifts/upload` | POST | IDトークン | シフト管理（廃止・410） |
| `/api/admin/slides/[id]` | DELETE | IDトークン | 理社管理 |
| `/api/admin/slides/units` | DELETE, POST | IDトークン | 理社管理 |
| `/api/admin/slides/upload` | POST | IDトークン | 理社管理 |
| `/api/admin/students/[id]/overview` | GET | IDトークン | 理社管理（担当校舎の生徒のみ。担当外は403） |
| `/api/admin/students/search` | GET | IDトークン | 理社管理（担当校舎の生徒のみ） |
| `/api/admin/substitutions` | POST | IDトークン | 理社管理（担当校舎の代講募集） |
| `/api/admin/test-prep-courses` | DELETE, GET, POST | IDトークン | マスター |
| `/api/admin/test-prep-events` | GET, POST | IDトークン | POST: マスター／GET: 理社管理（担当校舎） |
| `/api/admin/transport-fares/import` | POST | IDトークン | 勤怠システム管理 |
| `/api/admin/transport-stations/import` | POST | IDトークン | 勤怠システム管理 |
| `/api/admin/users` | DELETE, GET, POST | IDトークン | マスター |
| `/api/announcements/[id]/attachments/[attachmentId]` | GET | IDトークン | お知らせの公開対象者（ロール・校舎・学年） |
| `/api/announcements` | DELETE, GET, POST | IDトークン | GET: 認証済み（公開対象のみ。manage=1 はマスター）／POST・DELETE: マスター |
| `/api/annual-schedule-import` | POST | IDトークン | マスター |
| `/api/apps` | GET | IDトークン | 認証済み（本人が使えるアプリの一覧） |
| `/api/attendance-corrections` | GET, POST | IDトークン | POST: 講師・勤怠専用アカウント（本人の記録）／GET: 本人または勤怠管理（担当校舎） |
| `/api/attendance-detail-approvals` | GET, POST | IDトークン | 勤怠管理（担当校舎・対象者ごとに承認可否を判定） |
| `/api/attendance-diagnostics` | GET | IDトークン | 講師本人／mode=admin は勤怠システム管理 |
| `/api/attendance-insights` | GET | IDトークン | 勤怠管理（講師ロールを除く、担当校舎） |
| `/api/attendance-integration/import` | POST | 公開＋HMAC署名（ATTENDANCE_HMAC_SECRET、タイムスタンプ許容幅あり） | 外部勤怠システムからの取り込み |
| `/api/attendance-integration/sync` | GET | Vercel Cron（Authorization: Bearer CRON_SECRET、定数時間比較） | 外部勤怠の定期同期 |
| `/api/attendance-payroll` | GET, POST | IDトークン | 勤怠システム管理 |
| `/api/attendance-shifts` | GET, POST | IDトークン | GET: 講師本人またはシフト管理／POST: シフト管理（担当校舎） |
| `/api/auth/change-password` | POST | IDトークン | 本人 |
| `/api/auth/password-reset/request` | POST | 公開 | 本人確認情報の照合、IP・アカウント単位のレート制限。結果は一律の応答 |
| `/api/auth/password-reset` | PATCH, POST | POST: IDトークン／PATCH: 公開＋単回・有効期限付き再設定トークン（ハッシュ保存） | POST: 理社管理（担当校舎の対象のみ発行）／PATCH: トークン保持者 |
| `/api/auth/profile` | GET | IDトークン（直接検証・失効確認） | 本人のプロフィール（安全な項目のみ） |
| `/api/auth/recovery-email` | PATCH, POST | POST: IDトークン／PATCH: 公開＋確認トークン | 本人 |
| `/api/auth/repair-profile` | POST | IDトークン（直接検証・失効確認） | 本人（プロフィール不足時の修復） |
| `/api/badges/sync` | POST | IDトークン | 生徒本人 |
| `/api/beta/events` | POST | IDトークン | 認証済み（本人のイベントのみ記録） |
| `/api/camera-session-summary` | POST | IDトークン | 認証済み（廃止・410） |
| `/api/chat/history` | GET, POST | IDトークン | 生徒本人 |
| `/api/chat` | POST | IDトークン | 生徒本人（分・時間単位のレート制限） |
| `/api/class-participation` | POST | IDトークン | 生徒本人（署名付き参加トークン） |
| `/api/coin-transactions` | POST | IDトークン | 生徒本人 |
| `/api/course-registration-options` | GET | IDトークン | 生徒本人／連携済み保護者／理社管理 |
| `/api/create-user-from-gas` | POST | 共有秘密（リクエスト本文の secret、定数時間比較） | Google Apps Script からのアカウント作成 |
| `/api/create-zoom-meeting` | POST | IDトークン | 理社管理（担当校舎のシフト） |
| `/api/curriculum-admin` | GET, PATCH, POST | IDトークン | GET: 理社管理／POST・PATCH: マスター |
| `/api/dedicated-attendance` | GET, POST | IDトークン | 講師本人（専任）。本人の打刻・申請だけ。提出した月は差し戻されるまで変更不可 |
| `/api/eiken/admin/catalog` | GET, PATCH, POST | IDトークン | Booster管理（マスター、またはBooster権限の管理者で担当校舎・担当コース） |
| `/api/eiken/dashboard` | GET | IDトークン | Booster利用者（生徒本人・連携保護者・講師・管理者） |
| `/api/eiken/lessons/[id]/host` | POST | IDトークン | 担当コースの講師・Booster管理 |
| `/api/eiken/lessons/[id]/join` | POST | IDトークン | 受講登録済みの生徒本人 |
| `/api/eiken/quizzes/[id]` | GET | IDトークン | 受講登録済みの生徒本人 |
| `/api/eiken/quizzes/[id]/submit` | POST | IDトークン | 受講登録済みの生徒本人 |
| `/api/eiken/students/[id]/follow-ups` | POST | IDトークン | 担当の講師・Booster管理 |
| `/api/eiken/students/[id]` | GET | IDトークン | 担当の講師・Booster管理 |
| `/api/eiken/tasks/[id]/progress` | POST | IDトークン | 受講登録済みの生徒本人 |
| `/api/eiken/tasks/[id]` | GET | IDトークン | 受講登録済みの生徒本人 |
| `/api/eiken/writing/[id]/submit` | POST | IDトークン | 受講登録済みの生徒本人 |
| `/api/employee-lessons` | GET, POST | IDトークン | 勤怠システム管理 |
| `/api/first-login` | POST | 公開 | 生徒等の初回ログイン。ID＋初期パスワード照合、IP・アカウント単位のレート制限 |
| `/api/get-zoom-live-status` | POST | IDトークン | 講師（担当シフト）・理社管理（担当校舎）。当日のシフトのみ |
| `/api/get-zoom-zak` | POST | IDトークン | 講師（担当シフト）・理社管理 |
| `/api/health` | GET | 公開（死活のみ）／詳細は Bearer OPS_HEALTH_SECRET | 監視 |
| `/api/homework/adaptive` | POST | IDトークン | 生徒本人・理社管理（教材への保存は理社管理のみ）。レート制限 |
| `/api/join-zoom` | POST | 公開 | 廃止・410（処理なし） |
| `/api/line/auth` | GET | IDトークン | 本人（LINE連携開始。署名付き state を発行） |
| `/api/line/callback` | GET | 公開＋署名付き state（nonce・有効期限） | LINE Login のコールバック |
| `/api/line/link` | POST | IDトークン | 本人 |
| `/api/line/push` | POST | IDトークン | 理社管理（廃止・410） |
| `/api/monthly-schedules` | POST | IDトークン | 理社管理（担当校舎） |
| `/api/notification-jobs` | POST | IDトークン | マスター（廃止・410） |
| `/api/notifications/preferences` | POST | IDトークン | 本人 |
| `/api/notifications` | GET, PATCH | IDトークン | 本人宛ての通知のみ |
| `/api/ocr-quiz` | POST | IDトークン | 生徒本人（レート制限） |
| `/api/online-school/admin` | DELETE, GET, PATCH, POST | IDトークン | 閲覧: オンライン校管理または講師（担当範囲）／問題の編集: オンライン校管理 |
| `/api/online-school/answer` | POST | IDトークン | オンライン校受講の生徒本人 |
| `/api/online-school/progress` | GET | IDトークン | オンライン校受講の生徒本人 |
| `/api/online-school/session` | PATCH, POST | IDトークン | オンライン校受講の生徒本人 |
| `/api/parent/absence-requests` | POST | IDトークン | 連携済み保護者・生徒本人 |
| `/api/parent/chat-history` | GET | IDトークン | 連携済み保護者 |
| `/api/parent/course-registrations` | POST | IDトークン | 連携済み保護者・生徒本人 |
| `/api/parent/dashboard` | GET | IDトークン | 連携済み保護者 |
| `/api/parent/faq` | GET, POST | IDトークン | 保護者（本人の問い合わせ・連携済みの子のみ） |
| `/api/parent/home-summary` | GET | IDトークン | 保護者 |
| `/api/parent/learning-history` | GET | IDトークン | 連携済み保護者 |
| `/api/parent/report` | GET | IDトークン | 連携済み保護者 |
| `/api/parent/timetable` | GET | IDトークン | 連携済み保護者 |
| `/api/pf/dashboard` | GET | IDトークン | 理社管理（担当校舎）・講師（担当生徒）・保護者（連携済みの子） |
| `/api/push/subscriptions` | DELETE, POST | IDトークン | 本人の端末登録のみ（他人の登録は削除しない） |
| `/api/quest-results` | POST | IDトークン | 生徒本人 |
| `/api/quest-sessions/answer` | POST | IDトークン | 生徒本人 |
| `/api/quest-sessions` | POST | IDトークン | 生徒本人（レート制限） |
| `/api/recording-view` | POST | IDトークン | 生徒本人（視聴権限のある録画のみ） |
| `/api/review-periods` | GET, POST | IDトークン | 生徒本人／理社管理 |
| `/api/rewards/download` | POST | IDトークン | 生徒本人（自分の付与分のみ） |
| `/api/rewards/gacha` | POST | IDトークン | 生徒本人 |
| `/api/rewards/mine` | GET | IDトークン | 生徒本人 |
| `/api/rewards` | GET | IDトークン | 生徒本人 |
| `/api/slides/[id]/download` | GET | IDトークン | 理社講師ツール（理社管理・理社講師）。5分の署名付きURL |
| `/api/student/calendar` | GET | IDトークン | 生徒本人・連携済み保護者 |
| `/api/student/community` | GET, POST | IDトークン | GET: 生徒／POST: 生徒（講師向け掲示板は講師・管理者） |
| `/api/student/course-settings` | POST | IDトークン | 認証済み（廃止・410） |
| `/api/student/homework` | GET | IDトークン | 生徒本人 |
| `/api/student/homework/submission` | POST | IDトークン | 生徒本人 |
| `/api/student/ranking` | GET | IDトークン | 生徒本人 |
| `/api/student/recordings` | GET | IDトークン | 生徒本人（視聴権限のある録画のみ） |
| `/api/student/records` | GET | IDトークン | 生徒本人 |
| `/api/student/teacher-chat` | GET, POST | IDトークン | 生徒本人（レート制限） |
| `/api/student/timetable` | GET | IDトークン | 生徒本人 |
| `/api/student/today-classes` | GET | IDトークン | 生徒本人／preview=teacher は講師・管理者 |
| `/api/student/transfer-options` | GET | IDトークン | 生徒本人・連携済み保護者 |
| `/api/student/transfers` | POST | IDトークン | 生徒本人（署名付き振替候補のみ） |
| `/api/teacher/analyze-risk` | POST | IDトークン | 理社講師ツール（レート制限） |
| `/api/teacher/attendance-clock` | POST | IDトークン | 講師・勤怠専用アカウント（本人の記録） |
| `/api/teacher/attendance-details` | GET, POST | IDトークン | 講師・勤怠専用アカウント（本人の記録） |
| `/api/teacher/availability-profile` | PUT | IDトークン | 講師本人（自分の基本勤務設定のみ） |
| `/api/teacher/award-points` | POST | IDトークン | 認証済み（廃止・410） |
| `/api/teacher/chat` | GET, POST | IDトークン | 理社講師ツール（担当校舎の生徒のみ）。レート制限 |
| `/api/teacher/community` | POST | IDトークン | 生徒コミュニティAPIと同じ（講師・管理者） |
| `/api/teacher/commuter-passes` | DELETE, GET, PATCH, POST | IDトークン | 講師本人・勤怠管理（担当校舎）。DELETEは勤怠管理 |
| `/api/teacher/contact-call-marks` | GET, POST | IDトークン | 理社講師ツール（担当校舎の生徒のみ） |
| `/api/teacher/contacts` | POST | IDトークン | 理社講師ツール（担当校舎の生徒のみ） |
| `/api/teacher/homework` | POST | IDトークン | 理社講師ツール（講師は自分が作成した宿題のみ変更） |
| `/api/teacher/homework/stamp` | POST | IDトークン | 理社講師ツール |
| `/api/teacher/risk-resolution` | POST | IDトークン | 理社講師ツール |
| `/api/teacher/shifts` | DELETE, POST | IDトークン | 講師本人 |
| `/api/teacher/students/bulk-zoom-url` | POST | IDトークン | 認証済み（廃止・410） |
| `/api/teacher/students` | GET | IDトークン | 理社講師ツール（担当校舎の生徒のみ、安全な項目のみ） |
| `/api/teacher/substitutions` | GET, POST | IDトークン | 講師本人 |
| `/api/transport-fares` | GET | IDトークン | 講師・勤怠専用アカウント・管理者（講師は本人分のみ） |
| `/api/transport-stations` | GET | IDトークン | 講師・勤怠専用アカウント・管理者 |
| `/api/zoom/meeting-sdk-signature` | POST | IDトークン | 認証済み（ホスト役の署名は講師・管理者のみ） |
| `/api/zoom/recordings/file` | GET, POST | IDトークン（ヘッダーまたはクエリ）または単回の再生チケット（10分） | 録画の視聴権限者（shift_id 指定は理社管理） |
| `/api/zoom/recordings/sync` | GET, POST | GET: Vercel Cron（Authorization: Bearer CRON_SECRET、定数時間比較）／POST: IDトークン | GET: 定期同期／POST: 理社管理 |
| `/api/zoom/webhook` | POST | 公開＋Zoom署名（ZOOM_WEBHOOK_SECRET、HMAC-SHA256・タイムスタンプ） | Zoom Webhook |

### 2026-10-19 の見直しで修正した点

| API | 修正前 | 修正後 |
|---|---|---|
| `/api/teacher/students`、`/api/teacher/chat`、`/api/teacher/contacts`、`/api/teacher/contact-call-marks`、`/api/teacher/homework`、`/api/teacher/homework/stamp`、`/api/teacher/risk-resolution`、`/api/slides/[id]/download` | ロールが `admin` なら管理アプリの権限を問わず利用可。理社講座以外のプログラムだけを担当する講師も利用可 | 理社講師ツール判定（理社講座権限の管理者・理社講座の講師）を必須に |
| `/api/teacher/analyze-risk` | 講師なら全生徒分の外部AI分析を回数無制限で実行可。認証エラーも 500 | 理社講師ツール判定、1人10回/時のレート制限、認証エラーは 401/403 |
| `GET /api/curriculum-admin` | ロールが `admin` なら管理アプリの権限を問わず閲覧可 | 理社管理のみ |
| `/api/pf/dashboard`、`POST /api/admin/pf/import`、`POST /api/homework/adaptive` | ロールが `admin` なら管理アプリの権限を問わず利用可 | 管理者は理社講座の権限が必要 |
| Cron（`GET /api/zoom/recordings/sync`、`GET /api/attendance-integration/sync`） | `CRON_SECRET` 照合あり（文字列の単純比較） | 共通処理（`lib/server/cron-auth.ts`）で定数時間比較。未設定時は常に 401 |

テスト：`tests/security/api-boundaries.test.mjs` の末尾（Cron の秘密値、理社講師ツールの権限、リスク分析、ログアウト時の通知登録削除と無操作タイムアウトの設置）。
