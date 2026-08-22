# 権限別機能・デモアカウント早見表

最終更新: 2026-05-11

この資料は、`classbase-app` のデモ確認・社内説明・権限確認で使うための簡易資料です。  
まず「デモアカウント一覧」を見てログインし、必要に応じて「権限別にできること」を確認してください。

## 1. まず見る表

| 権限 | 主な利用者 | ログイン後の入口 | できることの概要 |
|---|---|---|---|
| 生徒 | 受講生 | `/student` | 授業参加、宿題、録画、AIチャット、欠席連絡、通知、設定 |
| 保護者 | 生徒の保護者 | `/parent` | 生徒情報の確認、欠席連絡、講座登録、お問い合わせ、通知設定 |
| 講師 | 授業担当者 | `/teacher` | 勤怠、宿題管理、生徒対応、チャット、代行回答、リスク確認 |
| 校舎管理者 | 校舎責任者 | `/master` | 自校舎の生徒・予定・講師配置・申請・通知管理 |
| マスター管理者 | 全体管理者 | `/master` | 全校舎横断のアカウント、講師配置、カリキュラム、通知、勤怠管理 |

## 2. デモアカウント一覧

| 権限 | メールアドレス例 | パスワード例 | Firestore role | 遷移先 |
|---|---|---|---|---|
| 生徒 | `demo.student@classbase.local` | `Demo1234!` | `student` | `/student` |
| 保護者 | `demo.parent@classbase.local` | `Demo1234!` | `parent` | `/parent` |
| 講師 | `demo.teacher@classbase.local` | `Demo1234!` | `teacher` | `/teacher` |
| 校舎管理者 | `demo.school-admin@classbase.local` | `Demo1234!` | `admin` | `/master` |
| マスター管理者 | `demo.master@classbase.local` | `Demo1234!` | `master` | `/master` |

注意:
- 上記はデモ用の推奨命名です。Firebase Auth に同名アカウントがない場合は新規作成してください。
- 実運用で使う場合は、確認後にパスワード変更または無効化してください。
- 管理者系アカウントは `/admin/login` からもログインできます。

## 3. ログイン・権限の基本

| 項目 | 内容 |
|---|---|
| 通常ログイン | `/` |
| 管理者ログイン | `/admin/login` |
| 権限判定 | Firestore `users/{uid}.role` |
| アカウント状態 | `users/{uid}.account_status` |
| 校舎制限 | `users/{uid}.school_id` / `users/{uid}.school_ids` |
| 保護者と生徒の紐づけ | 保護者 `student_ids`、必要に応じて生徒 `parent_uid` |

## 4. 権限別にできること

### 生徒

入口: `/student`

| 分類 | 画面 | 内容 |
|---|---|---|
| ホーム | `/student` | 今日の状況、授業参加、次回授業予定、通知導線 |
| 宿題 | `/student/homework` | 宿題の確認・提出 |
| AI学習 | `/student/homework/adaptive` | AI学習クエスト |
| 録画 | `/student/recordings` | 授業録画の視聴 |
| チャット | `/student/chat` | AIまたは講師への相談 |
| 学習履歴 | `/student/history` | 学習履歴の確認 |
| 欠席連絡 | `/student/absence` | 欠席連絡の送信 |
| 広場 | `/student/community` | 投稿・コメント |
| 通知 | `/student/news`, `/student/notifications` | お知らせ・通知確認 |
| 設定 | `/student/settings` | デザインカスタム、通知設定、LINE連携 |

確認ポイント:
- 自分のデータのみ閲覧・操作できる
- `coins` や管理系データを直接書き換えられない
- テーマ変更後、ページ移動時に色がちらつかない

### 保護者

入口: `/parent`

| 分類 | 画面 | 内容 |
|---|---|---|
| ダッシュボード | `/parent` | 紐づく生徒の宿題、出席、欠席、録画、お知らせを確認 |
| 欠席連絡 | `/parent/absence` | 保護者から欠席連絡を送信 |
| お問い合わせ | `/parent/contact` | よくある質問、サポートセンター問い合わせ |
| メッセージ | `/parent/messages` | 管理者からの返答・連絡確認 |
| 通知 | `/parent/notifications` | 通知一覧 |
| 設定 | `/parent/settings` | 通知設定、LINE連携 |
| 講座登録 | `/parent` から案内表示 | 管理者が送った登録依頼に回答 |

確認ポイント:
- `student_ids` に含まれる生徒のみ見える
- 講座登録依頼は、管理者が送信したときだけ表示される
- 回答できない問い合わせやサポート送信は管理者画面で確認できる

### 講師

入口: `/teacher`

| 分類 | 画面 | 内容 |
|---|---|---|
| ホーム | `/teacher` | 今日の予定、打刻導線、通知 |
| 勤怠 | `/teacher/attendance` | 打刻、勤務実績、修正依頼 |
| 勤務希望 | `/teacher/shifts` | 勤務可能日の提出 |
| 代行 | `/teacher/substitutions` | 代行依頼への回答 |
| 生徒連絡 | `/teacher/contacts` | 電話のみ、欠席確定など |
| チャット | `/teacher/chat` | 生徒とのチャット |
| 宿題 | `/teacher/homework`, `/teacher/homework/create` | 宿題管理・新規作成 |
| 生徒管理 | `/teacher/students`, `/teacher/pf` | 生徒情報、学習状況確認 |
| リスク確認 | `/teacher/risk-monitor` | 退塾リスク確認・対応 |
| 広場 | `/teacher/community` | 講師投稿 |
| 通知・設定 | `/teacher/news`, `/teacher/notifications`, `/teacher/settings` | お知らせ、通知、LINE連携 |

確認ポイント:
- 代行掲示板は回答のみで、作成はできない
- 承認済み打刻は講師側で編集できない
- 宿題作成や欠席確定が API / rules で許可されている

### 校舎管理者

入口: `/master`

| 分類 | 画面 | 内容 |
|---|---|---|
| ダッシュボード | `/master` | 自校舎の状況、講師配置、申請状況 |
| 生徒管理 | `/master/school-students` | 自校舎の生徒一覧、新規登録、停止、再開、解除 |
| アカウント | `/master/accounts`, `/master/accounts/sso` | 校舎別アカウント管理 |
| 月間予定 | `/master/monthly-schedules` | 自校舎分の予定編集 |
| 講師配置 | `/master/shifts` | 自校舎に関係する講師配置確認・編集 |
| 代行依頼 | `/master/substitutions` | 代行依頼の作成・管理 |
| お知らせ | `/master/announcements`, `/master/notifications` | 対象別通知・お知らせ送信 |
| LINE | `/master/line` | LINE通知管理 |
| 申請 | `/master/requests` | 各種申請確認 |
| 問い合わせ | `/master/parent-inquiries` | 保護者問い合わせ確認・返答 |
| 表示設定 | `/master/settings` | 生徒・保護者・管理者への表示設定 |

制限:
- `school_ids` に含まれる校舎のみ操作可能
- 勤怠の最終承認など、校舎管理者に不要な機能は表示・操作対象外
- 全体予定は参照でき、変更したい場合のみ校舎予定として上書き

確認ポイント:
- 別校舎の生徒・予定・申請が編集できない
- CSV生徒追加時に保護者アカウントも作成される
- 生徒・保護者両方の案内書面を印刷できる

### マスター管理者

入口: `/master`

| 分類 | 画面 | 内容 |
|---|---|---|
| 全体管理 | `/master` | 全校舎横断の状況確認 |
| アカウント | `/master/accounts`, `/master/users`, `/master/accounts/sso` | 全アカウント作成・停止・再開・解除 |
| 生徒・講師 | `/master/students`, `/master/teachers`, `/master/school-students` | 生徒・講師・校舎別生徒管理 |
| 講師配置 | `/master/shifts` | CSV取込、GAS同期、講師配置管理 |
| 年間・月間予定 | `/master/imports`, `/master/monthly-schedules` | 年間予定、月間予定管理 |
| カリキュラム | `/master/curriculum` | カリキュラム、ターム編集 |
| 登録依頼 | `/master/registration-tasks` | 講座登録依頼の作成・管理 |
| 録画 | `/master/recordings` | 録画承認 |
| 勤怠 | `/master/attendance`, `/master/attendance-corrections` | 勤怠確認、修正依頼承認 |
| 通知・LINE | `/master/notifications`, `/master/line`, `/master/announcements` | 通知作成、LINE送信、お知らせ配信 |
| 問い合わせ | `/master/parent-inquiries` | 保護者問い合わせ対応 |
| その他 | `/master/rewards`, `/master/stats`, `/master/settings` | 報酬・ポイント、統計、表示設定 |

確認ポイント:
- 全校舎データを確認できる
- 重要操作がサーバー API または Firestore rules で保護されている
- 登録依頼、通知、講師配置同期、勤怠承認の履歴が残る

## 5. Firestore 最小データ例

デモアカウントは Firebase Auth にユーザーを作成したあと、同じ UID で Firestore `users/{uid}` を作成してください。

### 生徒

```json
{
  "role": "student",
  "account_status": "active",
  "student_name": "デモ生徒",
  "grade": "中2",
  "school_id": "demo-school",
  "coins": 0,
  "settings": {}
}
```

### 保護者

```json
{
  "role": "parent",
  "account_status": "active",
  "parent_name": "デモ保護者",
  "school_id": "demo-school",
  "student_ids": ["生徒UID"],
  "notification_preferences": {
    "in_app": true,
    "line": false,
    "email": false
  }
}
```

### 講師

```json
{
  "role": "teacher",
  "account_status": "active",
  "teacher_name": "デモ講師",
  "school_id": "demo-school",
  "notification_preferences": {
    "in_app": true,
    "line": false
  }
}
```

### 校舎管理者

```json
{
  "role": "admin",
  "account_status": "active",
  "name": "デモ校舎管理者",
  "school_id": "demo-school",
  "school_ids": ["demo-school"]
}
```

### マスター管理者

```json
{
  "role": "master",
  "account_status": "active",
  "name": "デモマスター管理者",
  "school_ids": ["*"]
}
```

## 6. デモ確認チェックリスト

| 確認 | 内容 |
|---|---|
| ログイン | 各アカウントでログインし、想定画面へ遷移する |
| 権限分離 | 生徒、保護者、講師、校舎管理者、マスター管理者で見える画面が分かれる |
| 校舎制限 | 校舎管理者が自校舎以外を編集できない |
| 保護者紐づけ | 保護者が紐づく生徒だけ確認できる |
| 通知 | 生徒、保護者、講師、管理者で通知画面を確認できる |
| 重要操作 | コイン、勤怠承認、通知送信、登録依頼などが API / rules 経由で動く |
