# Booster API

すべてのAPIは`Authorization: Bearer <Firebase ID Token>`を必要とする。

| Method | Path | 用途 |
| --- | --- | --- |
| GET | `/api/apps` | 利用可能アプリ判定 |
| GET | `/api/eiken/dashboard` | ロール別Boosterホーム |
| GET | `/api/eiken/tasks/[id]` | 生徒用タスク詳細 |
| POST | `/api/eiken/tasks/[id]/progress` | 開始・完了・理解度保存 |
| GET | `/api/eiken/quizzes/[id]` | 正答を除いた確認テスト取得 |
| POST | `/api/eiken/quizzes/[id]/submit` | 自動採点・技能別集計 |
| POST | `/api/eiken/writing/[id]/submit` | 答案提出・AI添削 |
| POST | `/api/eiken/lessons/[id]/join` | 受講・時間確認後に参加URL発行 |
| POST | `/api/eiken/lessons/[id]/host` | 担当確認後にホストURL発行 |
| GET | `/api/eiken/admin/catalog` | 管理画面初期データ |
| POST | `/api/eiken/admin/catalog` | 講座・タスク・授業・受講等を追加 |
| PATCH | `/api/eiken/admin/catalog` | 登録内容を更新 |

## 進捗保存

```json
{
  "action": "start | complete | understanding",
  "understanding": "good | uncertain | difficult"
}
```

## 管理リソース

`resource`は`course / unit / enrollment / task / lesson / quiz / question / teacher_assignment / announcement`。各入力はZodで検証し、`created_by`と更新日時はサーバーで設定する。

## 秘密情報

ダッシュボードAPIは`meeting_id`, `passcode`, `join_url`, `host_url`, `start_url`を除外する。参加・ホスト開始時だけサーバー側検証後にURLを返す。
