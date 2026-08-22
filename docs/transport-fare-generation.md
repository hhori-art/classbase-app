# 運賃マスタ全区間生成メモ

作成日: 2026-06-27

## 目的

`docs/transport-stations-major-hyogo.csv` に登録されている駅名・停留所名をもとに、未登録の区間運賃を自動取得して `docs/transport-fares-major-hyogo.csv` に追記します。

## 実行コマンド

```bash
npm run transport:generate-fares
```

交通機関を絞る場合:

```bash
npm run transport:generate-fares -- --transport=JR西日本
npm run transport:generate-fares -- --transport=阪急
npm run transport:generate-fares -- --transport=神戸市営地下鉄
```

テストで件数を絞る場合:

```bash
npm run transport:generate-fares -- --limit=20
```

## 必要なAPIキー

全区間の運賃取得には、以下のいずれかが必要です。

### 駅すぱあと

`.env.local` に設定:

```bash
EKISPERT_API_KEY=取得したアクセスキー
```

または:

```bash
EKISPERT_ACCESS_KEY=取得したアクセスキー
```

### NAVITIME

契約APIのエンドポイント仕様に合わせて設定:

```bash
NAVITIME_API_KEY=取得したAPIキー
NAVITIME_ROUTE_API_URL=契約APIのURL
```

必要に応じて:

```bash
NAVITIME_FROM_PARAM=from
NAVITIME_TO_PARAM=to
NAVITIME_TRANSPORT_PARAM=transport_type
NAVITIME_API_KEY_HEADER=x-api-key
```

## 生成されるファイル

- `docs/transport-fares-major-hyogo.csv`
  - 取得できた運賃が追記されます。
- `docs/transport-fares-missing.csv`
  - APIキー未設定、API取得不可、駅名不一致などで取得できなかった区間です。

## 現在の確認結果

駅名マスタ全体では、片方向重複を除いて約9,690区間あります。
現在の環境では駅すぱあと/NAVITIMEの運賃取得用APIキーが読み込めていないため、既存登録済み区間以外の自動取得はできませんでした。

APIキー設定後に再実行すると、取得できた区間から順にCSVへ追記されます。
途中で停止しても、既存CSVにある区間はスキップされるため、再実行で続きから補完できます。
