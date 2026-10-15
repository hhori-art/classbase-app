# セキュリティテスト環境

本環境は、ClassBaseの本番Firebase・本番認証情報・本番データへ接続せず、Firebase Local Emulator Suite上で権限ルールを検証するためのものです。

## 安全設計

- FirebaseプロジェクトIDは `demo-classbase-security` に固定しています。
- `.env.local` の秘密情報は使用しません。
- Auth、Firestore、Storageは `127.0.0.1` のエミュレーターへ接続します。
- Java 21は `.security-tools/` 内だけに配置し、Mac本体へインストールしません。
- エミュレーターのデータは本番へ送信されません。
- `SECURITY_DIAGNOSIS_MODE=true` のときは、ローカル接続と指定したWeb診断元IP以外を全画面・APIで遮断します。

## 初回セットアップ

```bash
npm install
npm run security:setup
```

`security:setup` は、Firebase Emulator用のEclipse Temurin Java 21をプロジェクト内へ取得します。

## 自動テスト

```bash
npm run security:test
```

静的検査とFirebaseルール検査は独立して実行されます。一方が失敗しても、もう一方まで実行したうえで終了コード `1` を返します。

次の項目を検証します。

- セキュリティヘッダー（CSP、HSTS、クリックジャッキング対策等）
- `/master` と `/teacher` のIP制御
- 認証必須APIの未認証拒否
- 生徒・保護者・講師・管理者・masterのFirestore権限境界
- 生徒によるrole昇格や他人の出席更新の拒否
- 給与単価マスターのクライアントSDK遮断
- Storageの授業資料・勤怠取込ファイル権限

依存パッケージの既知脆弱性は、インターネット接続が必要なため別コマンドで確認します。

```bash
npm run security:deps
```

## 手動確認

ターミナル1:

```bash
npm run security:start
```

ターミナル2:

```bash
npm run security:accounts
npm run security:app
```

- アプリ: `http://127.0.0.1:3100`
- Emulator UI: `http://127.0.0.1:4001`

終了は各ターミナルで `Ctrl+C` を押します。

`security:accounts` は全体管理者、校舎管理者、専任、準専任、生徒、保護者の6アカウントを作成します。パスワードはGit対象外の `.security-diagnosis-accounts.json` に権限 `600` で保存され、エミュレーター終了時にアカウントと匿名テストデータも `.security-emulator-data/` へ保存されます。

Web診断元として許可するIPは、神戸デジタル・ラボ指定の `113.37.16.194` と `124.33.127.18` です。外部診断に使用する場合は、独立したFirebaseステージング環境とHTTPS URLを用意したうえで、同じ環境変数をその環境だけに設定してください。

外部診断用の実環境はFirebase/Vercelとも `classbase-security-diagnosis` に分離しています。Vercel配備時は `vercel.security.json` を使用し、本番用の定期実行処理を登録しません。

診断環境の勤怠承認回帰試験は、診断用サイトが最新コードであることを確認してから次を実行します。

```bash
npm run security:staging-attendance-approvals
```

この試験は、校舎承認者の自校舎表示、他校舎非表示・操作拒否、理社講座の承認拒否、マスターの理社承認、選択明細2件の一括承認、打刻編集、詳細一括保存、打刻削除を実APIで確認します。一時データと一時的な承認者設定は `finally` で必ず復元・削除します。

## 禁止事項

- セキュリティ環境へ本番サービスアカウント鍵を設定しないでください。
- `demo-classbase-security` を実在するFirebaseプロジェクトIDへ変更しないでください。
- 本番データをエミュレーターへコピーしないでください。必要なデータは匿名のテストデータを作成してください。

## 現在検出されている問題

2026年8月27日時点では、テスト環境で次の既存問題を検出します。そのため、修正されるまで `npm run security:test` は意図どおり失敗終了します。

1. Firestoreの包括ルールにより、サーバー専用の給与単価マスターを `master` 権限のクライアントから読み取れる
2. 本番依存パッケージの監査で34件（重大1件、高7件、中20件、低6件）の既知脆弱性が検出される

社外IP向け講師画面制限の `/teacher` 前方一致問題は修正済みです。残る検査も無効化せず、アクセス制御を修正すると自動的に合格へ変わる構成です。
