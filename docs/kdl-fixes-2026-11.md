# KDL診断の修正（2026-11）

修正方針（Googleドキュメント「修正方針」）は、2026-11-12 の報告会で同意を得た。そのときの決定は次のとおり。

- 15文字以上を求めるのは、管理系のアカウント（マスター・管理者・勤怠管理者）だけ。講師・生徒・保護者は8文字以上。
- 今あるアカウントには、変更を求めない。新しくパスワードを決めるときから、このきまりを使う。
- 全校導入用のID書面はまだ刷っていない。今ある平文の初期パスワードは、刷り終えてから移行の手順で消す（下の「移行」）。

## 項目ごとの対応

| No | 対応 | 主なファイル |
|---|---|---|
| A.3.1 | 初期パスワードは `account_secrets/{docID}` に HMAC（鍵は `INITIAL_PASSWORD_HMAC_SECRET`、アカウントごとの塩つき）で置く。users には置かない。一覧の通信（生徒一覧・マスターのユーザー一覧）から外した。書面用に取り出せるのは管理者・マスターだけで、監査ログ（`initial_password_issue`）に残す。初回ログインのあと自分のパスワードに変えたら消す。ハッシュしかないアカウントは、刷るたびに新しい初期パスワードを発行する | `lib/server/account-secrets.ts`、`lib/initial-password-hash.ts`、`app/api/admin/accounts/sync-printed-password` |
| E.2.1 | `jsonError` を1か所で直した。画面に出すのは、こちらで用意した日本語と短いコードだけ。それ以外は「内部エラーが発生しました（受付番号）」と出し、中身はサーバーの記録に残す | `lib/api-error.ts` |
| A.1.1 | パスワードのきまりを1か所にまとめ、画面とサーバーで同じものを使う。よく使われるパスワード・並んだ文字・IDに近いものは使えない | `lib/password-policy.ts` |
| A.1.2 | ふだんのログインもサーバーで確かめ、ログイン用のトークン（カスタムトークン）を返す。「ID＋接続元」で数え、5回目から待ち時間を延ばし、10回で30分ロック（くり返すと最大24時間）。接続元を変えた総当たりには、IDごとに1時間50回でロック。校舎（担当の生徒・保護者）とマスターがロックを解ける | `lib/server/login-lock.ts`、`lib/server/login-service.ts`、`app/api/auth/login`、`app/api/admin/login`、`app/api/admin/accounts/login-lock` |
| A.3.2 / A.3.3 | 再設定のリンクは10分・1回だけ。新しいリンクを出すと前のものは使えない。変更したら、アプリの通知と確認済みのメールで本人に知らせる | `lib/password-reset-rules.ts`、`lib/server/password-reset-notice.ts` |
| B.3.1 | ログアウトのときに、サーバーでログインを取り消す（ほかの端末も切れる） | `app/api/auth/logout`、`app/context/AuthContext.tsx` |
| E.2.2 | パスワードと再設定用メールを変える前に、今のパスワードを確かめる（初回ログインの直後は聞かない）。失敗はログインのロックと同じ回数に数える | `lib/server/current-password.ts` |
| E.2.3 | `/api` のすべての応答に `Cache-Control: no-store` | `next.config.mjs`、`middleware.ts` |
| B.2.1 / B.2.2 | シフトの一覧もマスターに認めた（校舎を選ぶ）。講師には本人のシフトだけを、決めた項目だけ返す | `app/api/attendance-shifts` |
| C.3.1 | `AccountGuidePrintView.tsx` で埋め込むのは固定の印刷用CSSだけと確かめた | — |
| E.2.4 | 管理系のアカウントは、ブラウザを閉じたらログアウト（閉じると消えるクッキーで見分ける） | `lib/admin-browser-session.ts` |
| G.1.1 | 厳しいCSP（`unsafe-eval` なし）を Report-Only で出し、違反は `/api/security/csp-report` の記録で見る。`CSP_STRICT_EVAL=true` で本番のCSPからも外せる | `next.config.mjs` |

## 環境変数（Vercel）

| 名前 | 必須 | 内容 |
|---|---|---|
| `INITIAL_PASSWORD_HMAC_SECRET` | 必須 | 初期パスワードのハッシュの鍵（32文字以上のランダムな値）。本番と診断環境で別の値にする。変えると、今あるハッシュでは初回ログインできなくなる |
| `NEXT_PUBLIC_RECAPTCHA_ENTERPRISE_SITE_KEY` | 任意 | App Check（画面側）。診断環境で確かめてから入れる |
| `FIREBASE_APP_CHECK_APP_ID` | 任意 | App Check（サーバーからのパスワード確認に付けるトークン）。上と一緒に入れる |
| `CSP_STRICT_EVAL` | 任意 | `true` で本番のCSPから `unsafe-eval` を外す。Zoom を確かめてから |

Firestore の TTL を `login_locks.expires_at` に設定すると、古いロックの記録が自動で消える（コンソールで設定）。

## 移行（ID書面を刷り終えてから）

```
node --import tsx scripts/security/migrate-initial-passwords.mts --project <プロジェクトID>          # 件数の確認だけ
node --import tsx scripts/security/migrate-initial-passwords.mts --project <プロジェクトID> --apply  # 書き込み
```

`.env.local` に、Vercel と同じ `INITIAL_PASSWORD_HMAC_SECRET` が必要。動かしたあとは、書面を刷るたびに新しい初期パスワードになり、前に配った紙は使えなくなる（校舎へ伝える）。

## KDLへ説明する、残るリスク

- 生徒・保護者・講師は8文字にとどめた（小中学生が自分で入力するため）。アカウントロックの強化で補う。
- ログアウトしても、画面から Firestore を直接読む部分は、最大1時間は前のトークンで読める（Firebase の仕組み上、取り消し済みかを確かめないため）。
- App Check による直接ログインの封じ込みは、診断環境で動作を確かめてから有効にする。
- 管理者・教室管理の画面は、社内の回線からだけ使える（11月に実施済み）。A.1.1 と E.2.4 の守りを強める。
