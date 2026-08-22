# 画面一覧表

最終更新: 2026-08-13  
対象: `app/**/page.tsx`（100画面）

## 共通・認証（14画面）

| No. | 画面名 | URL | 主な利用者 | 概要 |
|---:|---|---|---|---|
| 1 | ログイン | `/` | 全員 | ログインID・パスワードで認証し、利用可能アプリ選択へ進む |
| 2 | 管理者ログイン | `/admin/login` | 管理者 | 管理者専用ログイン。成功後は管理画面へ進む |
| 3 | アプリ選択 | `/apps` | 認証済み利用者 | 理社講座・英検Booster・勤怠から利用可能なアプリを選択 |
| 4 | アクセス拒否 | `/403` | 全員 | IP制限などでアクセスできない場合の案内 |
| 5 | メール確認 | `/verify-email` | 全員 | メール確認処理の結果を表示 |
| 6 | パスワード再設定申請 | `/password-reset` | 全員 | 本人確認情報を送信し再設定を申請 |
| 7 | パスワード再設定完了 | `/password-reset/confirm` | 全員 | パスワード変更結果を表示 |
| 8 | Zoomミーティング | `/zoom-meeting` | 認証済み利用者 | Zoom Meeting SDKで授業へ参加 |
| 9 | 共通チャット（旧画面） | `/chat` | 認証済み利用者 | AIチャット。呼出元ロールに応じた戻り先を表示 |
| 10 | 共通宿題一覧（旧画面） | `/homework` | 生徒 | 宿題一覧から詳細へ移動 |
| 11 | 共通宿題詳細（旧画面） | `/homework/[id]` | 生徒 | 指定宿題の詳細を表示 |
| 12 | 共通録画一覧（旧画面） | `/recordings` | 管理者 | 授業録画の一覧・外部URL確認 |
| 13 | 受講設定（旧画面） | `/settings` | 生徒 | 受講講座・曜日・時間の変更 |
| 14 | 印刷 | `/print` | 運営者 | 帳票・案内の印刷用表示 |

## 生徒（17画面）

| No. | 画面名 | URL | 主な機能 |
|---:|---|---|---|
| 1 | 生徒ホーム | `/student` | 次回授業、宿題、各機能への入口を表示 |
| 2 | AIチューター | `/student/chat` | AIへの学習相談 |
| 3 | コミュニティ | `/student/community` | トピック・コメント・リアクション |
| 4 | 通知 | `/student/notifications` | 自分宛て通知の一覧・既読化 |
| 5 | お知らせ一覧 | `/student/news` | 配信されたお知らせを一覧表示 |
| 6 | お知らせ詳細 | `/student/news/[id]` | お知らせ本文を表示 |
| 7 | 宿題一覧 | `/student/homework` | 課題・進捗・期限を一覧表示 |
| 8 | 宿題詳細 | `/student/homework/[id]` | 課題内容と提出・進捗を表示 |
| 9 | AI学習クエスト | `/student/homework/adaptive` | 学年・科目に合わせたAIクイズ |
| 10 | 学習履歴 | `/student/history` | クエスト等の実施履歴 |
| 11 | OCR問題作成 | `/student/ocr-quiz` | 画像から類題を生成 |
| 12 | 授業録画 | `/student/recordings` | 対象授業の録画視聴 |
| 13 | Zoom授業 | `/student/zoom` | 授業のZoom参加導線 |
| 14 | 欠席連絡 | `/student/absence` | 欠席・遅刻等の連絡（機能停止案内を含む） |
| 15 | 受講変更申請 | `/student/change-request` | 講座・曜日・時間の変更を申請 |
| 16 | 景品交換 | `/student/shop` | コイン景品交換（現在は利用停止案内） |
| 17 | 設定・アカウント | `/student/settings` | 表示、通知、連携、パスワード等の設定 |

## 講師・勤怠専用（20画面）

| No. | 画面名 | URL | 主な機能 |
|---:|---|---|---|
| 1 | 講師ホーム | `/teacher` | 担当授業、連絡、業務メニューを表示 |
| 2 | 仕事メニュー | `/teacher/work` | 講師向け業務機能のランチャー |
| 3 | 勤怠 | `/teacher/attendance` | 出退勤打刻、勤務詳細、修正依頼、交通費 |
| 4 | シフト | `/teacher/shifts` | 自分の勤務シフトを確認 |
| 5 | 代行依頼掲示板 | `/teacher/substitutions` | 代行募集の閲覧・応募 |
| 6 | 生徒一覧 | `/teacher/students` | 担当生徒の検索・情報確認、Zoom URL更新 |
| 7 | 生徒画面プレビュー | `/teacher/student-preview` | 生徒向けホームの表示確認 |
| 8 | リスクモニター | `/teacher/risk-monitor` | 学習リスク分析と対応記録 |
| 9 | 連絡対応 | `/teacher/contacts` | 生徒からの連絡・問い合わせ対応 |
| 10 | 講師チャット | `/teacher/chat` | 生徒とのチャット対応 |
| 11 | コミュニティ | `/teacher/community` | 講師コミュニティの投稿・コメント |
| 12 | 宿題一覧 | `/teacher/homework` | 宿題の作成・確認 |
| 13 | 宿題作成 | `/teacher/homework/create` | 新しい宿題を登録 |
| 14 | 宿題詳細 | `/teacher/homework/[id]` | 課題内容・提出状況を確認 |
| 15 | PF | `/teacher/pf` | PFデータの確認・取込 |
| 16 | 授業スライド | `/teacher/slides` | 授業資料の閲覧・ダウンロード |
| 17 | お知らせ一覧 | `/teacher/news` | 講師向けお知らせ一覧 |
| 18 | お知らせ詳細 | `/teacher/news/[id]` | お知らせ本文を表示 |
| 19 | 通知 | `/teacher/notifications` | 自分宛て通知の一覧・既読化 |
| 20 | 設定 | `/teacher/settings` | 通知、LINE、パスワード等の設定 |

## 保護者（6画面）

| No. | 画面名 | URL | 主な機能 |
|---:|---|---|---|
| 1 | 保護者ホーム | `/parent` | 連携生徒の予定・状況・各種申請への入口 |
| 2 | AI・連絡 | `/parent/messages` | 欠席連絡などのメニュー |
| 3 | 欠席・遅刻連絡 | `/parent/absence` | 連携生徒の欠席・遅刻を送信 |
| 4 | お問い合わせ | `/parent/contact` | FAQ閲覧と問い合わせ送信 |
| 5 | 通知 | `/parent/notifications` | 保護者宛て通知の一覧・既読化 |
| 6 | 設定 | `/parent/settings` | 通知、LINE、パスワード等の設定 |

## 英検 Booster（6画面）

| No. | 画面名 | URL | 主な利用者 | 主な機能 |
|---:|---|---|---|---|
| 1 | 生徒Boosterホーム | `/eiken/student` | 受講生徒 | 今日の学習、成長、履歴、お知らせ |
| 2 | 学習タスク | `/eiken/student/tasks/[id]` | 受講生徒 | 動画・クイズ・ライティング等のタスク実施 |
| 3 | 講師Boosterホーム | `/eiken/teacher` | 担当講師 | 担当講座・受講生徒・LIVE授業を管理 |
| 4 | 講師用生徒詳細 | `/eiken/teacher/students/[id]` | 担当講師 | 生徒の進捗・フォローアップ確認 |
| 5 | 保護者Boosterホーム | `/eiken/parent` | 連携保護者 | 連携生徒の取り組み状況を確認 |
| 6 | 管理者用生徒詳細 | `/master/eiken/students/[id]` | 英検管理者 | 生徒の進捗・フォローアップ管理 |

## 管理者（35画面）

| No. | 画面名 | URL | アプリ区分 | 主な機能 |
|---:|---|---|---|---|
| 1 | 管理アプリ選択 | `/master` | 共通 | 管理可能なアプリを選択 |
| 2 | 理社管理ダッシュボード | `/master/science-social` | 理社 | 運営状況と主要管理機能への入口 |
| 3 | 管理アプリ権限 | `/master/access-control` | マスター専用 | 管理アカウントへアプリ権限を付与 |
| 4 | 全体アカウント管理 | `/master/accounts` | マスター専用 | アカウント関連メニュー |
| 5 | パスワード再設定受付 | `/master/accounts/recovery` | マスター専用 | 再設定依頼の確認・処理 |
| 6 | 校舎別アカウント管理 | `/master/accounts/sso` | マスター専用 | 校舎単位のアカウント操作 |
| 7 | ユーザー管理 | `/master/users` | マスター専用 | ユーザー一覧・作成・削除 |
| 8 | アカウント削除 | `/master/delete` | マスター専用 | アカウント・関連データの削除 |
| 9 | システム設定 | `/master/settings` | マスター専用 | 年度、公開範囲、各種全体設定 |
| 10 | 統計・分析 | `/master/stats` | マスター専用 | 利用統計・テスト効果を分析 |
| 11 | 校舎別生徒管理 | `/master/school-students` | 理社 | 校舎生徒の検索・状態・一括操作 |
| 12 | 生徒管理（旧画面） | `/master/students` | 理社 | 生徒一覧・情報確認 |
| 13 | 講師管理 | `/master/teachers` | 理社 | 講師情報の管理 |
| 14 | シフト管理 | `/master/shifts` | 理社 | シフト登録、同期、Zoom情報管理 |
| 15 | 月間予定管理 | `/master/monthly-schedules` | 理社 | 月間予定の登録・管理 |
| 16 | 勤怠管理 | `/master/attendance` | 勤怠 | 勤務実績・交通費・集計を管理 |
| 17 | 打刻修正承認 | `/master/attendance-corrections` | 勤怠 | 講師の打刻修正依頼を承認・却下 |
| 18 | 勤怠ミス候補 | `/master/attendance/diagnostics` | 勤怠 | 打刻・シフトの不整合候補を確認 |
| 19 | 代行依頼管理 | `/master/substitutions` | 理社 | 代行募集の作成・管理 |
| 20 | お知らせ配信 | `/master/announcements` | 理社 | 対象を指定してお知らせを配信 |
| 21 | 自分の通知 | `/master/notifications` | 理社 | 管理者自身の通知を確認 |
| 22 | 承認・申請 | `/master/requests` | 理社 | 各種申請を確認・処理 |
| 23 | 保護者お問い合わせ | `/master/parent-inquiries` | 理社 | 保護者問い合わせへの回答・状態管理 |
| 24 | 登録依頼管理 | `/master/registration-tasks` | 理社 | 生徒向け登録依頼の作成・管理 |
| 25 | 講座割当管理 | `/master/course-allocation` | 理社 | 生徒と講座の割当を管理 |
| 26 | カリキュラム管理 | `/master/curriculum` | 理社 | ターム・単元・カリキュラムを管理 |
| 27 | PFデータ管理 | `/master/pf` | 理社 | PFデータの取込・管理 |
| 28 | 授業アーカイブ | `/master/recordings` | 理社 | Zoom録画同期・公開管理 |
| 29 | 授業スライド | `/master/slides` | 理社 | PPTXアップロード・問題生成・削除 |
| 30 | コミュニティ管理 | `/master/community` | 理社 | 投稿・コメントの管理 |
| 31 | 景品・コイン管理 | `/master/rewards` | 理社 | 景品とコイン取引を管理 |
| 32 | アンケート設定 | `/master/survey-settings` | 理社 | アンケートの設問・公開設定 |
| 33 | CSV一括登録 | `/master/imports` | 理社 | 年間予定、PF、スライド、交通費等の取込 |
| 34 | 通知・LINE管理 | `/master/line` | 理社 | LINE連携状況・通知配信を管理 |
| 35 | 英検Booster管理 | `/master/eiken` | 英検 | 講座、授業、タスク、教材を管理 |
## 開発・保守（2画面）

| No. | 画面名 | URL | 備考 |
|---:|---|---|---|
| 1 | 開発用ユーザー登録 | `/tmp-register` | 開発用。運用環境での公開可否を要確認 |
| 2 | データベース修復 | `/fix-db` | 保守用。運用環境での公開可否を要確認 |

## 注記

- 動的URLの `[id]` は対象データのIDに置換される。
- サイドバーやボトムナビの表示は `portal_settings` の公開設定で非表示になる場合がある。
- `/master` 配下は管理アプリ権限に加えてIP制限を受ける。
- `/teacher` 配下の一部画面も社外IPから制限される。詳細は [権限一覧表](./permission-matrix.md) を参照。
- `LandingPage` には `/login` へのリンクが残るが、現在の実画面ルートは `/` であり、`app/login/page.tsx` は存在しない。
