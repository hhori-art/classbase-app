# Booster データモデル

## 共通受講登録

### `course_enrollments/{id}`

| フィールド | 型 | 内容 |
| --- | --- | --- |
| `user_id` | string | 生徒UID |
| `program_id` | `"eiken"` | プログラム識別子 |
| `course_id` | string | 英検講座ID |
| `school_id` | string | 校舎 |
| `status` | string | `active / paused / completed / cancelled` |
| `created_at` | Timestamp | 作成日時 |
| `updated_at` | Timestamp | 更新日時 |

## 英検コレクション

- `eiken_courses`: 講座・級・年度・公開状態
- `eiken_course_units`: フェーズ、週、ユニット
- `eiken_tasks`: 学習順序とタスク種別
- `eiken_task_progress`: 生徒ごとの開始・完了・理解度
- `eiken_lessons`: LIVE授業予定とZoom設定
- `eiken_attendance`: LIVE授業出席
- `eiken_quizzes`: 確認テスト定義
- `eiken_quiz_questions`: 問題・正答・技能タグ
- `eiken_quiz_results`: 自動採点結果・技能別正答率
- `eiken_writing_submissions`: 答案とAI添削結果
- `eiken_teacher_assignments`: 講師と担当講座
- `eiken_announcements`: 講座のお知らせ
- `eiken_follow_up_records`: フォロー履歴

## `eiken_tasks`

`task_type`は`video / textbook / live_lesson / quiz / ai_writing / reflection / announcement`。

種類別情報は`details`へ保存する。

- video: `video_url`, `learning_points`
- textbook: `textbook_name`, `pages`, `instructions`
- quiz: `quiz_id`
- ai_writing: `assignment_type`, `prompt`, `source_text`

前提タスクは`prerequisites: string[]`で表現する。未完了の前提がある場合、画面上で次のタスクに選ばない。

## 書き込み方針

生徒・保護者・講師画面はFirestoreへ直接書き込まず、英検APIを利用する。APIはAdmin SDKで保存し、IDORと得点改ざんを防ぐ。管理者の登録も`/api/eiken/admin/catalog`経由で入力検証する。

