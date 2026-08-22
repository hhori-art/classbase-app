# 創造学園アプリ 英検対策講座モジュール 統合仕様書

## 1. 目的

既存の理社講座アプリを創造学園共通アプリへ拡張し、その中に英検対策講座を追加する。

英検対策講座は別担当者が実装し、既存アプリの認証、ユーザー情報、権限、通知などの共通基盤と統合する。既存の理社講座・勤怠機能の動作を変更または停止させないことを必須条件とする。

## 2. 現行基盤

| 項目 | 内容 |
| --- | --- |
| フレームワーク | Next.js 14 App Router / TypeScript |
| UI | Tailwind CSS / Lucide React |
| 認証 | Firebase Authentication |
| データベース | Cloud Firestore |
| ファイル | Firebase Storage |
| 既存ユーザー | 生徒、保護者、講師、校舎管理者、マスター管理者、勤怠利用者 |
| 本番環境 | Vercel |

既存の `users/{uid}` がアカウントの正本である。英検対策講座のためにFirebase Authenticationまたは`users`コレクションを別途作成しないこと。

## 3. 実装方針

### 3.1 モジュールとして追加する

英検機能は既存アプリ内の独立モジュールとして追加する。

- 生徒画面: `/eiken/student`
- 保護者画面: `/eiken/parent`
- 講師画面: `/eiken/teacher`
- 管理画面: `/master/eiken`

既存の理社講座用コレクション、画面、APIを英検用に流用・書き換えない。共通コンポーネント、認証コンテキスト、共通レイアウトの利用は可能とする。

### 3.2 共通アプリホーム

ログイン後のホーム画面には、ユーザーが利用可能な講座だけを表示する。

- 理社講座
- 英検対策講座
- 創造学園勤怠アプリ（対象者のみ）

英検の受講登録が有効な生徒・紐づく保護者・英検担当講師・英検管理権限を持つ管理者にのみ、英検対策講座への導線を表示する。

## 4. 権限仕様

### 4.1 既存ロール

既存の`users/{uid}.role`を使用する。

| role | 英検対策講座での利用 |
| --- | --- |
| `student` | 自身の受講、課題、授業、結果を閲覧・提出 |
| `parent` / `guardian` | 紐づく子どもの受講状況・連絡を閲覧 |
| `teacher` | 担当クラス・受講者・課題・結果を管理 |
| `admin` 等 | 校舎範囲の英検講座を管理 |
| `master` | 全校舎・全講座の管理 |

### 4.2 英検機能権限

`users/{uid}`に以下を任意で保持する。未設定の場合、生徒・保護者は受講登録、講師・管理者は担当設定で判定する。

```ts
enabled_programs: ['science_social', 'eiken']
eiken_teacher: true
eiken_admin: true
```

ロールを新設して既存のログイン遷移を複雑にしない。英検へのアクセス可否はロールと受講・担当情報の組み合わせで判定する。

## 5. Firestoreデータ設計

### 5.1 講座マスタ

`eiken_courses/{courseId}`

```ts
{
  name: '英検3級対策講座',
  level: '3kyu', // 5kyu / 4kyu / 3kyu / pre2kyu / 2kyu / pre1kyu / 1kyu
  school_id: 'all',
  academic_year: 2026,
  status: 'active', // draft / active / archived
  description: '',
  created_at: Timestamp,
  updated_at: Timestamp
}
```

### 5.2 受講登録

`course_enrollments/{enrollmentId}`を共通の受講登録として使用する。英検以外の将来講座も同じ構造にする。

```ts
{
  user_id: 'student uid',
  program_id: 'eiken',
  course_id: 'eiken_3kyu_2026',
  school_id: 'school id',
  status: 'active', // active / paused / completed / cancelled
  started_at: Timestamp,
  ended_at: Timestamp | null,
  created_at: Timestamp,
  updated_at: Timestamp
}
```

同じ生徒・同じ`course_id`について、有効な受講登録を重複作成しない。

### 5.3 授業・Zoom設定

`eiken_lessons/{lessonId}`

```ts
{
  course_id: 'eiken_3kyu_2026',
  school_id: 'all',
  title: 'Unit 1: 英検3級の基本語彙',
  lesson_date: '2026-09-01',
  start_at: Timestamp,
  end_at: Timestamp,
  teacher_ids: ['teacher uid'],
  meeting_id: '1234567890',
  passcode: 'stored securely',
  join_open_before_minutes: 15,
  join_close_after_minutes: 30,
  status: 'scheduled', // draft / scheduled / completed / cancelled
  created_at: Timestamp,
  updated_at: Timestamp
}
```

Zoomの秘密情報は生徒画面へそのまま一覧配信しない。生徒の参加時は、既存のZoom参加用APIと同様に、ログイン済みユーザーと受講登録をサーバー側で検証して参加URLを返す。

### 5.4 課題・小テスト

- `eiken_assignments/{assignmentId}`: 宿題、単語課題、動画、提出期限
- `eiken_submissions/{submissionId}`: 生徒の提出物・採点結果
- `eiken_quizzes/{quizId}`: 小テスト定義
- `eiken_quiz_results/{resultId}`: 小テスト回答・結果

各生徒データには必ず`student_id`を持たせ、本人、紐づく保護者、担当講師、管理者のみ読めるようにする。

### 5.5 担当設定

`eiken_teacher_assignments/{assignmentId}`

```ts
{
  teacher_id: 'teacher uid',
  course_id: 'eiken_3kyu_2026',
  school_id: 'all',
  status: 'active',
  created_at: Timestamp
}
```

## 6. 画面要件（第1段階）

### 6.1 生徒

- 英検対策講座ホーム
- 受講中の級・講座の表示
- 次回授業とZoom参加ボタン
- 宿題・単語・小テストの一覧
- 提出状況と小テスト結果
- お知らせ

Zoom参加ボタンは、受講中の`course_id`と当日の`eiken_lessons`が一致し、設定された表示時間内の場合のみ表示する。

### 6.2 保護者

- 子どもの受講中講座、次回授業、課題提出状況の閲覧
- 英検に関するお知らせの閲覧

保護者が閲覧できるのは、`users/{parentUid}.student_ids`または生徒側の`parent_uid`で紐づく子どもの情報のみとする。

### 6.3 講師

- 担当講座・授業予定の一覧
- Zoomホスト開始
- 受講者一覧
- 課題作成、提出確認、採点
- 小テスト結果の確認

担当外の生徒情報は表示しない。マスター管理者は全講座を確認できる。

### 6.4 管理者

- 講座・級の作成と公開設定
- 生徒の受講登録・解除
- 授業予定、講師、Zoom情報の設定
- 課題・小テスト・お知らせの管理
- 受講者数、提出率、テスト結果の集計

## 7. API設計

クライアントから管理処理やZoomの秘密情報を直接Firestoreへ書き込まない。以下のようなNext.js Route Handlerを使用する。

| API | 用途 |
| --- | --- |
| `GET /api/eiken/dashboard` | ロール別ホーム情報 |
| `GET /api/eiken/lessons/today` | 当日の参加可能授業 |
| `POST /api/eiken/lessons/[id]/join` | 受講確認後にZoom参加先を返す |
| `POST /api/eiken/enrollments` | 管理者による受講登録 |
| `PATCH /api/eiken/enrollments/[id]` | 受講状態変更 |
| `POST /api/eiken/assignments` | 講師・管理者による課題作成 |
| `POST /api/eiken/submissions` | 生徒提出 |
| `POST /api/eiken/quizzes/[id]/submit` | 小テスト提出 |

各APIは既存の`getServerUser`、`requireRole`、`isAdminLike`などの共通認可ロジックを利用する。

## 8. Firestoreセキュリティルール

以下を守ること。

- 生徒は自身の英検提出・結果だけ読める。
- 保護者は紐づく子どもの情報だけ読める。
- 講師は自身の担当講座の受講者・提出物だけ読める。
- 管理者は校舎範囲、マスター管理者は全件を管理できる。
- `eiken_lessons`のZoom ID・パスコードを生徒が変更できない。
- 成績、採点結果、受講状態を生徒が任意に変更できない。
- Firestoreルール変更時は既存の理社・勤怠ルールを削除または緩和しない。

## 9. 統合時の必須事項

1. 実装は本リポジトリのブランチまたは別リポジトリで行う。
2. 別リポジトリの場合、統合用PRまたは差分一式を提出する。
3. Firebaseプロジェクト、Firebase Authenticationのユーザー、既存`users`は共用する。
4. 新しい環境変数が必要な場合は、用途、必須環境、秘密情報かどうかを一覧で提出する。
5. 新規Firestoreコレクション、インデックス、ルール差分を提出する。
6. 既存の`/student`、`/teacher`、`/master`、`/teacher/attendance`の主要画面を回帰確認する。
7. Vercelへの本番デプロイは既存プロジェクト`classbase-app`へ行う。

## 10. 受入条件

- 既存ユーザーで再ログイン不要で英検機能を利用できる。
- 英検を受講していない生徒には英検導線が表示されない。
- 英検受講生は自分の講座に一致する授業だけ参加できる。
- 生徒、保護者、講師、管理者で表示・操作範囲が正しく異なる。
- 生徒が他生徒の提出、結果、Zoom情報を取得・変更できない。
- 理社講座、勤怠、既存のログイン・通知機能に回帰不具合がない。
- `npm run build`が成功する。
- Firestoreルールと必要なインデックスが本番環境へ反映される。

## 11. 第2段階以降の候補

- 英作文の画像・音声提出と添削
- 二次試験の面接練習、録音・評価
- 単語学習の進捗と弱点分析
- 英検級別の模試、合格可能性分析
- 受講・課題・模試を横断した保護者レポート
- 他講座を追加するための共通講座カタログ
