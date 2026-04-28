# データモデル・移行メモ

## 追加ロール

- `parent`: 保護者。`users/{parentUid}.student_ids` または `users/{studentUid}.parent_uid` で生徒と紐づける。
- 校舎管理者は `role: admin` とし、`school_ids: string[]` で管理できる校舎を制限する。
- マスター管理者は `role: master` とし、全校舎を管理できる。

## アカウント状態

`users` に以下を追加する。

- `account_status`: `active | suspended | withdrawn | archived`
- `school` または `school_id`
- `school_ids`: 管理者が扱える校舎ID配列
- `initial_login_id`, `initial_password_policy`: 映像授業カードと統一する初期ID/パスワード管理用

## 追加コレクション

- `learning_events`: 録画、授業参加、AI問い合わせ、通知、勤怠承認などの共通イベントログ。
- `recording_views`: 生徒ごとの録画視聴開始・進捗・完了サマリ。
- `coin_transactions`: コイン/ポイントの増減履歴。ユーザー本体の `coins` 更新と同じトランザクションで作る。
- `notification_jobs`: メール、LINE、アプリ内通知の送信ジョブ。
- `camera_session_summaries`: 授業終了時に送信するカメラON時間サマリ。
- `attendance_correction_requests`: 講師の勤怠修正依頼。

## 移行手順

1. `users` の既存生徒・講師に `account_status: "active"` を付与する。
2. 校舎を持つユーザーに `school_id` を統一して付与する。
3. 校舎管理者に `role: "admin"` と `school_ids` を付与する。
4. 保護者ユーザーを `role: "parent"` で作成し、`student_ids` に閲覧可能な生徒IDを入れる。
5. `firestore.rules` をデプロイする。

`scripts/migrations/normalize-account-roles.js` は Admin SDK 環境変数を使って 1 と 2 の初期値を補完するためのサンプルです。

