# Booster セットアップ

## 必要な環境変数

既存Firebase AdminおよびZoom環境変数を共用する。

| 変数 | 必須 | 秘密 | 用途 |
| --- | --- | --- | --- |
| `OPENAI_API_KEY` | 任意 | はい | AI添削。本番でAI評価する場合 |
| `EIKEN_AI_MODEL` | 任意 | いいえ | 既定`gpt-4o-mini` |
| `EIKEN_AI_MODE` | 任意 | いいえ | `mock`でモック添削 |
| `ZOOM_ACCOUNT_ID` | LIVE利用時 | はい | Zoom Server-to-Server OAuth |
| `ZOOM_CLIENT_ID` | LIVE利用時 | はい | 同上 |
| `ZOOM_CLIENT_SECRET` | LIVE利用時 | はい | 同上 |

AIキーがなくてもビルドと学習フローは動作し、添削はモック結果を返す。

## 初期登録

1. マスターまたは英検管理権限のあるアカウントでログインする。
2. アプリ一覧から「英検対策講座 Booster」を開く。
3. Booster管理の「講座」で講座と級を登録する。
4. 「受講・担当」で生徒と講師を登録する。
5. 「学習タスク」で順番を指定してタスクを登録する。
6. 「LIVE授業」で日時、講師、Zoom Meeting IDを登録する。

一般管理者へBoosterを表示する場合は`users/{uid}`へ`eiken_admin: true`または`enabled_programs: ['eiken']`を管理者APIから設定する。講師は担当登録を正本とする。

## ローカル確認

```bash
npm run dev
```

本番ビルド:

```bash
npm run build
```

FirestoreルールとインデックスはVercelとは別にFirebaseへ反映する。

## 開発用シード

本番では実行できない開発確認用データを用意している。`.env.local`へ次を一時設定して実行する。

```bash
EIKEN_ALLOW_SEED=true
EIKEN_SEED_PASSWORD=<8文字以上の開発用パスワード>
npm run eiken:seed
```

英検2級講座、Week 1、5種類のタスク、確認テスト、AI添削結果、受講生、保護者、講師、管理者、要フォロー生徒が固定IDで作成または更新される。`VERCEL_ENV=production`または`NODE_ENV=production`では処理を拒否する。
