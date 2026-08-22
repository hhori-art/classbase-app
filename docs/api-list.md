# API一覧表

最終更新: 2026-08-13  
対象: `app/api/**/route.ts`（100ルート、121 HTTPメソッド）

## 表記

| 表記 | 意味 |
|---|---|
| 公開 | Firebase IDトークンを要求しない。入力値、共有秘密、署名等による別の検証がある場合は個別に記載 |
| 認証済み | `Authorization: Bearer <Firebase ID token>` が必要 |
| 本人 | 認証に加え、対象UIDとの一致または連携関係を確認 |
| 理社管理 | `master`、または `admin` かつ `science_social` 権限 |
| 英検管理 | `master`、または `admin` かつ `eiken` 権限。校舎範囲の制約あり |
| 勤怠管理 | `master`、または `admin` / 勤怠専用管理者かつ `attendance` 権限 |
| マスター | `master` のみ |

## 認証・アプリ共通

| Method | Path | 認証・権限 | 概要 |
|---|---|---|---|
| POST | `/api/first-login` | 公開・初期ID/初期パスワード照合 | 生徒等の初回Firebase Auth登録・復旧 |
| POST | `/api/admin/first-login` | 公開・管理ロール/初期パスワード照合 | 管理者の初回Firebase Auth登録・復旧 |
| POST | `/api/auth/change-password` | 認証済み | ログイン中ユーザーのパスワード変更 |
| POST | `/api/auth/password-reset/request` | 公開・本人確認情報照合 | パスワード再設定申請を登録 |
| POST | `/api/auth/password-reset` | 公開・再設定情報照合 | パスワード再設定を実行 |
| PATCH | `/api/auth/password-reset` | 認証済み | 初回パスワード変更状態を更新 |
| POST | `/api/auth/recovery-email` | 認証済み | 復旧メールアドレスを設定 |
| PATCH | `/api/auth/recovery-email` | 認証済み | 復旧メールアドレスを更新 |
| POST | `/api/auth/repair-profile` | 認証済み（IDトークン） | Auth情報から不足ユーザープロフィールを修復 |
| GET | `/api/apps` | 認証済み | ロール・受講・管理権限から利用可能アプリを返す |
| POST | `/api/beta/events` | 認証済み | ベータ検証用の利用イベントを記録 |
| POST | `/api/camera-session-summary` | 生徒・講師・管理者 | カメラ利用セッションの集計を記録 |
| POST | `/api/chat` | 公開 | AIチューターのストリーム応答を生成 |
| POST | `/api/notification-jobs` | 保護者本人・講師・理社管理 | 通知ジョブを生成 |
| GET | `/api/notifications` | 認証済み・本人範囲 | 通知一覧を取得 |
| PATCH | `/api/notifications` | 認証済み・本人範囲 | 通知を既読化 |
| POST | `/api/notifications/preferences` | 認証済み・本人 | 通知設定を保存 |

## 生徒・学習

| Method | Path | 認証・権限 | 概要 |
|---|---|---|---|
| POST | `/api/class-participation` | 生徒 | 授業参加を記録 |
| POST | `/api/quest-results` | 生徒 | 学習クエスト結果を保存 |
| POST | `/api/coin-transactions` | 主に生徒、一部操作は講師・管理者 | コイン付与・利用・残高関連操作 |
| POST | `/api/homework/adaptive` | 公開 | 指定学年・科目・教材からAIクイズを生成 |
| POST | `/api/ocr-quiz` | 生徒 | OCR画像をもとにAI類題を生成 |
| POST | `/api/recording-view` | 生徒 | 授業録画の視聴イベントを記録 |
| POST | `/api/student/community` | 生徒 | 生徒コミュニティ投稿関連操作 |
| POST | `/api/student/course-settings` | 生徒本人 | 受講講座・曜日時間設定を保存 |
| GET | `/api/student/ranking` | 生徒 | 生徒ランキングを取得 |
| POST | `/api/student/teacher-chat` | 生徒 | 講師宛てチャットを送信 |
| GET | `/api/student/today-classes` | 生徒本人／プレビュー時は講師・管理者 | 当日の授業を取得 |
| GET | `/api/student/transfer-options` | 生徒 | 振替可能枠を取得 |
| POST | `/api/student/transfers` | 生徒本人 | 振替を申請 |
| GET | `/api/course-registration-options` | 公開 | 講座登録可能な日程・選択肢を取得 |
| POST | `/api/parent/course-registrations` | 生徒本人・連携保護者 | 講座登録を申請 |
| POST | `/api/parent/absence-requests` | 生徒本人・連携保護者 | 欠席・遅刻等を申請 |

## 保護者

| Method | Path | 認証・権限 | 概要 |
|---|---|---|---|
| GET | `/api/parent/faq` | 認証済み | 公開FAQを取得 |
| POST | `/api/parent/faq` | 保護者 | 問い合わせを登録 |

## 講師・勤怠

| Method | Path | 認証・権限 | 概要 |
|---|---|---|---|
| GET | `/api/teacher/students` | 講師・理社管理 | 担当/対象生徒を取得 |
| POST | `/api/teacher/students/bulk-zoom-url` | 講師・理社管理 | 生徒Zoom URLを一括更新 |
| POST | `/api/teacher/homework` | 講師・理社管理 | 宿題を作成・更新 |
| POST | `/api/teacher/award-points` | 講師・理社管理 | 生徒へポイントを付与 |
| POST | `/api/teacher/analyze-risk` | 講師・理社管理 | 生徒の学習リスクをAI分析 |
| POST | `/api/teacher/risk-resolution` | 講師・理社管理 | リスク対応結果を記録 |
| POST | `/api/teacher/contacts` | 講師・理社管理 | 問い合わせ対応を記録 |
| POST | `/api/teacher/substitutions` | 講師 | 代行募集へ応募等を行う |
| POST | `/api/teacher/attendance-clock` | 講師・勤怠専用管理者 | 出退勤を打刻 |
| GET | `/api/teacher/commuter-passes` | 講師・勤怠管理 | 定期券情報を取得 |
| POST | `/api/teacher/commuter-passes` | 講師・勤怠管理 | 定期券情報を登録 |
| PATCH | `/api/teacher/commuter-passes` | 講師本人・勤怠管理 | 定期券情報を更新 |
| POST | `/api/attendance-corrections` | 講師・勤怠専用管理者 | 打刻修正を申請、または管理操作 |
| GET | `/api/attendance-corrections` | 講師・勤怠専用管理者 | 修正依頼を取得 |
| GET | `/api/attendance-diagnostics` | 講師本人／管理モードは勤怠管理 | 勤怠不整合候補を取得 |
| GET | `/api/transport-fares` | 講師・勤怠管理 | 交通費候補を取得 |
| GET | `/api/transport-stations` | 講師・勤怠管理 | 駅マスターを検索 |

## 管理者・運営

| Method | Path | 認証・権限 | 概要 |
|---|---|---|---|
| POST | `/api/admin/accounts/create` | マスター | Firebase Authとプロフィールにアカウントを作成 |
| POST | `/api/admin/accounts/status` | マスター | アカウント状態を変更 |
| POST | `/api/admin/accounts/sync-printed-password` | マスター | 印刷用初期パスワードをAuthへ同期 |
| GET | `/api/admin/app-permissions` | マスター | 管理アプリ権限一覧を取得 |
| PATCH | `/api/admin/app-permissions` | マスター | 1ユーザーの管理アプリ権限を更新 |
| POST | `/api/admin/app-permissions` | マスター | 管理アプリ権限を一括更新 |
| GET | `/api/admin/users` | マスター | ユーザー一覧を取得 |
| POST | `/api/admin/users` | マスター | ユーザーを作成 |
| DELETE | `/api/admin/users` | マスター | ユーザーを削除 |
| POST | `/api/admin/bootstrap-profile` | 認証済み（IDトークン） | 管理者プロフィールを初期化 |
| GET | `/api/admin/password-recovery-requests` | マスター | パスワード再設定依頼を取得 |
| PATCH | `/api/admin/password-recovery-requests` | マスター | 再設定依頼を処理 |
| GET | `/api/admin/beta-analytics` | 理社管理 | ベータ利用分析を取得 |
| POST | `/api/admin/beta-logs` | 理社管理 | ベータ検証ログを保存 |
| POST | `/api/admin/course-registrations` | 理社管理・校舎範囲 | 講座登録を管理 |
| POST | `/api/admin/course-registrations/import` | 理社管理・校舎範囲 | 講座登録を一括取込 |
| POST | `/api/admin/notifications` | 理社管理 | 通知を配信 |
| GET | `/api/admin/notifications` | 理社管理 | 配信通知を取得 |
| GET | `/api/admin/parent-inquiries` | 理社管理・校舎範囲 | 保護者問い合わせを取得 |
| PATCH | `/api/admin/parent-inquiries` | 理社管理・校舎範囲 | 問い合わせ状態・回答を更新 |
| GET | `/api/admin/school-students` | 理社管理・校舎範囲 | 校舎別生徒一覧を取得 |
| POST | `/api/admin/school-students/import` | マスター | 校舎生徒を一括取込 |
| POST | `/api/admin/school-students/bulk-absence` | 理社管理・校舎範囲 | 生徒を一括休止/欠席処理 |
| POST | `/api/admin/school-students/lifecycle` | 理社管理・校舎範囲 | 入退会等の状態を更新 |
| POST | `/api/admin/school-students/options` | 理社管理・校舎範囲 | 生徒の選択肢・設定を更新 |
| POST | `/api/admin/shifts/upload` | 理社管理 | シフトCSVデータを一括登録 |
| POST | `/api/admin/shifts/sync` | 理社管理 | 外部シフトデータを同期 |
| GET | `/api/admin/shifts/sync` | 理社管理 | シフト同期状態を取得 |
| POST | `/api/admin/shifts/relink` | 理社管理 | シフトと関連データを再紐付け |
| POST | `/api/admin/shifts/unassigned-notifications` | 理社管理 | 未割当シフト通知を生成 |
| PATCH | `/api/admin/shifts/[shiftId]/passcode` | 理社管理 | Zoomパスコードと参加URLを更新 |
| POST | `/api/admin/test-prep-events` | 理社管理 | テスト対策予定を登録 |
| GET | `/api/admin/test-prep-events` | 理社管理 | テスト対策予定を取得 |
| POST | `/api/admin/slides/upload` | 理社管理 | PPTXを保存し問題候補を生成 |
| DELETE | `/api/admin/slides/[id]` | 理社管理 | スライドと関連問題を削除 |
| POST | `/api/admin/transport-fares/import` | 勤怠管理 | 交通費マスターを一括取込 |
| POST | `/api/admin/transport-stations/import` | 勤怠管理 | 駅マスターを一括取込 |
| POST | `/api/annual-schedule-import` | マスター | 年間予定を一括取込 |
| POST | `/api/monthly-schedules` | マスター中心・校舎範囲検証 | 月間予定を登録・更新 |
| GET | `/api/curriculum-admin` | マスター | カリキュラム管理データを取得 |
| POST | `/api/curriculum-admin` | マスター | カリキュラムを登録 |
| PATCH | `/api/curriculum-admin` | マスター | カリキュラムを更新 |

## 英検 Booster

| Method | Path | 認証・権限 | 概要 |
|---|---|---|---|
| GET | `/api/eiken/dashboard` | 英検利用権のある生徒・保護者・講師・管理者 | ロール別ダッシュボードデータを取得 |
| GET | `/api/eiken/admin/catalog` | 英検管理 | 講座・授業・タスク等のカタログを取得 |
| POST | `/api/eiken/admin/catalog` | 英検管理 | カタログ項目を登録 |
| PATCH | `/api/eiken/admin/catalog` | 英検管理 | カタログ項目を更新 |
| POST | `/api/eiken/lessons/[id]/host` | 担当講師・英検管理 | ZoomホストURLを取得 |
| POST | `/api/eiken/lessons/[id]/join` | 対象講座の受講生徒 | Zoom参加URLを取得 |
| GET | `/api/eiken/quizzes/[id]` | 対象講座の受講生徒 | 確認テストを取得 |
| POST | `/api/eiken/quizzes/[id]/submit` | 対象講座の受講生徒 | 確認テスト回答を提出 |
| GET | `/api/eiken/tasks/[id]` | 対象講座の受講生徒 | 学習タスクを取得 |
| POST | `/api/eiken/tasks/[id]/progress` | 対象講座の受講生徒 | タスク進捗を保存 |
| POST | `/api/eiken/writing/[id]/submit` | 対象講座の受講生徒 | ライティングを提出しAI評価 |
| GET | `/api/eiken/students/[id]` | 担当講師・英検管理 | 生徒のBooster詳細を取得 |
| POST | `/api/eiken/students/[id]/follow-ups` | 担当講師・英検管理 | フォローアップを登録 |

## Zoom・録画・スライド

| Method | Path | 認証・権限 | 概要 |
|---|---|---|---|
| POST | `/api/join-zoom` | 本人・講師・理社管理 | Zoom登録者を作成し参加URLを取得 |
| POST | `/api/get-zoom-live-status` | 講師・理社管理 | Zoom会議のLIVE状態を取得 |
| POST | `/api/get-zoom-zak` | 講師・理社管理 | Zoom ZAK/ホスト用情報を取得 |
| POST | `/api/zoom/meeting-sdk-signature` | 認証済み | Meeting SDK署名を生成。ホストroleは講師・管理者のみ |
| GET | `/api/zoom/recordings/file` | 認証済み・対象確認 | 録画ファイルを配信 |
| GET | `/api/zoom/recordings/sync` | Cron共有秘密 | Zoom録画を同期 |
| POST | `/api/zoom/recordings/sync` | Cron共有秘密 | Zoom録画を同期 |
| POST | `/api/zoom/webhook` | Zoom署名/検証トークン | Zoom Webhookを受信 |
| GET | `/api/slides/[id]/download` | 講師・管理者 | スライドの期限付きダウンロードURLを発行 |

## LINE・外部連携

| Method | Path | 認証・権限 | 概要 |
|---|---|---|---|
| GET | `/api/line/auth` | 公開・OAuth state | LINE OAuth認可へリダイレクト |
| GET | `/api/line/callback` | 公開・OAuth state/code | LINE OAuthコールバックを処理 |
| POST | `/api/line/link` | 認証済み・本人 | LINE連携を解除 |
| POST | `/api/line/push` | 理社管理 | LINEメッセージを一括送信 |
| POST | `/api/create-user-from-gas` | 共有秘密/連携元検証 | Google Apps Scriptからユーザーを作成 |

## 実装上の注意

- `/api/chat` と `/api/homework/adaptive` は現状、ルート内でFirebase認証を検証していない。公開APIとして運用する意図がない場合は認証・レート制限の追加を推奨する。
- 「認証済み」と記載したAPIでも、対象データの校舎・本人・担当範囲を追加検証するものがある。
- 管理権限の正本は `lib/server-auth.ts`、`lib/admin-app-permissions.ts`、`lib/eiken/access.ts`。クライアント側の画面表示制御だけを認可根拠にしない。
- Firestoreへクライアントから直接アクセスする処理は本表に含まれない。データ単位の権限は `firestore.rules`、ファイル権限は `storage.rules` を参照。
