# classbase-app

理社講座アプリの管理・生徒・保護者・講師向け Web アプリです。

## 運用ドキュメント

- [権限別機能・デモアカウント早見表](docs/role-feature-demo-accounts.md)
- [データモデル・移行メモ](docs/data-model-and-migration.md)
- [Google スプレッドシート講師配置同期 GAS 手順](docs/google-shift-sync-gas.md)

## 交通費API連携

勤怠の交通費登録では、手入力を残したまま外部APIまたはFirestore運賃マスタから金額を反映できます。

### 駅すぱあと API

```bash
EKISPERT_API_KEY=駅すぱあとのアクセスキー
TRANSPORT_FARE_PROVIDER=ekispert
```

未指定時のエンドポイントは `https://api.ekispert.jp/v1/json/search/course/extreme` です。変更が必要な場合は `EKISPERT_BASE_URL` を設定してください。

### NAVITIME API

NAVITIMEは契約内容によりURLや認証方式が異なるため、以下を設定してください。

```bash
NAVITIME_API_KEY=NAVITIMEのAPIキー
NAVITIME_ROUTE_API_URL=契約した交通費計算APIのURL
TRANSPORT_FARE_PROVIDER=navitime
```

必要に応じて以下でパラメータ名や認証ヘッダー名を調整できます。

```bash
NAVITIME_API_KEY_HEADER=x-api-key
NAVITIME_API_KEY_PARAM=
NAVITIME_FROM_PARAM=from
NAVITIME_TO_PARAM=to
NAVITIME_TRANSPORT_PARAM=transport_type
```

`TRANSPORT_FARE_PROVIDER=auto` または未指定の場合は、NAVITIME、駅すぱあと、Firestore `transport_fares` マスタの順で検索します。

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
