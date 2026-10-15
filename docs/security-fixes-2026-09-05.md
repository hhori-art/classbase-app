# セキュリティ修正結果 — 2026-09-05

結果: **fixed（以下の15件をローカルで修正・検証）**。監査全体の網羅性は partial。本番適用は未実施。

既存の画面、APIルート、Firestoreコレクション構造を維持し、認証・認可を行う既存の関数とルールを修正した。開始時点の未コミット変更を保存し、その上に必要な変更を加えた。構造変更は行っていない。依存パッケージは後述の追加監査で同一メジャー内の修正版へ更新した。

| ID | 確認した問題 | 重要度 | 修正 |
|---|---|---|---|
| 1 | 管理者自動復旧で未確認のメールからmasterを取得できる | 中 | 確認済みメールと明示したADMIN_BOOTSTRAP_EMAILSの完全一致に限定し、createの存在条件で既存プロフィールの上書きを防ぐ。 |
| 2 | メールのローカル部一致で他人のプロフィールと権限を移行できる | 中 | 管理側で保存したUIDの完全一致だけを移行根拠にし、競合や曖昧な候補を拒否する。既存UIDの修復は維持。 |
| 3 | 校舎管理者がmaster用パスワード再設定トークンを発行できる | 高 | 発行前に対象の既存役割・校舎を共通関数で確認し、同校舎の許可対象だけを許可する。masterの管理操作は維持。 |
| 4 | アカウント同期のメール別名・CSV経由で権限外の資格情報を変更できる | 高 | 共有prepare処理で実際のAuth UIDとプロフィール候補全件を更新前に認可する。主アカウントと保護者を両方準備してから更新し、CSV・印刷パスワード同期・管理APIでも利用する。 |
| 5 | 担当外の授業のZoomホスト権限を取得できる | 高 | 担当者UIDまたは管理側の厳密な氏名一致・関連担当を必須にし、選択したシフトとフォールバックを認可してからホスト情報を返す。 |
| 6 | 録画URLへZoomのサーバーBearerを送信できる | 中 | HTTPSのZoomホストに宛先を限定し、資格情報入りURL・別ポートを拒否する。各リダイレクトをmanualで検査してから次の通信を行う。 |
| 7 | 未認証のAIチャット呼出しで有料モデルを利用できる | 高 | 既存の共通認証を利用するNode実行に変更し、30回/分/ユーザー・入力/出力上限を追加。クライアントは既存ストリーム形式のままBearerを添付する。 |
| 8 | 校舎の承認担当者が他校舎の勤怠や全体給与管理へアクセスできる | 高 | 全体管理と校舎承認を区別し、専任申請と定期券は対象プロフィールの校舎を確認する。申請バッチは全件検証してから保存し、関連勤務記録の所有者と自己承認も確認する。 |
| 9 | プロフィール自己更新で勤怠管理権限や認証情報を偽装できる | 高 | 権限・本人識別・給与照合・所定勤務条件・復旧先の各表現を保護し、管理者による更新対象も制約する。通知設定・ログイン日時等は維持。 |
| 10 | 包括ルールが機密コレクションの拒否を打ち消す | 高 | 明示ルールのあるコレクションを包括ルールから除外する。masterの通常勤務登録は明示的に維持し、管理者資格情報の他管理者への公開も制限する。 |
| 11 | 他の生徒の提出物を自分名義に書き換えられる | 中 | 更新前後の所有者を本人に固定し、課題ID変更を拒否する。本人の提出・再提出時のコメントやfeedbackリセットは維持。 |
| 12 | 講師コミュニティの役割境界と報酬カウンターを迂回できる | 中 | 講師専用の役割を確認し、1回の本人リアクションだけを許可。生徒の投稿/リアクションは既存のサーバーAPIに限定し、報酬APIにも講師トピックの役割確認を追加。 |
| 13 | 役割を降格しても保存済み管理権限が有効になる | 中 | 明示的に定義した管理者役割以外は保存された管理権限を無効にする。従来の管理者・勤怠役割の扱いを保持。 |
| 14 | 旧初期パスワードでアカウントを再設定・再有効化できる | 高 | 初回完了/停止/退塾/アーカイブを拒否し、既存の別UIDプロフィールとの衝突を拒否する。不要な他候補削除を避け、パスワード変更時はpassword別名も除去。 |
| 15 | 停止状態や失効したトークンでデータ操作を継続できる | 中 | 共通API・録画APIで失効と停止状態を確認し、Firestore/Storageの直接アクセスにも停止状態の確認を追加する。 |

共通認証、資格情報同期、直接Firebaseアクセスの共有境界で対策した。氏名・メール・職員番号などの別名もサーバーの認可や照合に使われるため、自己更新から保護した。校舎の勤務承認と給与・連携設定などの全体管理は別判定にした。

**検証結果**

| コマンド | 結果 |
|---|---|
| `npm run security:static` | 31件成功（API実コードを使う23件＋設定8件） |
| `npm run security:rules` | 49件成功（ローカルFirestore・Storageエミュレーター） |
| `node --import tsx --test scripts/employment-category.test.mts scripts/dedicated-attendance.test.mts scripts/auth-navigation.test.mts scripts/attendance-payroll.test.mts scripts/employee-lessons.test.mts` | 既存の関連回帰テスト29件成功 |
| `node_modules/.bin/tsc --noEmit --incremental false` | 成功 |
| `npm run build` | 成功（Next.js 14.2.35、本番用ビルド） |
| `git diff --check` | 成功 |
| `npm audit --omit=dev --json` | 利用者の情報送信許可後に完了。追加修正後は18件残存（重大0・高2・中9・低7）。詳細は末尾。 |

修正前のコピーで、プロフィール権限書換え、提出物の所有者奪取、機密データ読取、管理者復旧・パスワード同期・無認証AI・Zoom担当外取得等の拒否テストが失敗することを確認した。修正後は対象の拒否テストが成功した。録画についてはURLヘルパーに加え、実際の録画APIに攻撃者ホストの保存URLを渡し、Zoom Bearerをそのホストへ転送しないことも確認した。

正常系では、本人の通知設定、保護者の紐付く生徒閲覧、提出・再提出、講師の正規リアクション、masterの勤務記録作成、許可済み復旧、同校舎の資格情報更新・申請承認、認証付きAIストリーム、担当Zoomのフォールバック、録画Range取得を確認した。

APIテストは実際のTypeScriptをトランスパイルして実行し、Firebase Admin・AI・外部fetchをモックした隔離テストである。Firestore/Storageは架空の `demo-classbase-security` プロジェクトの実エミュレーターで検証した。本番のAuth・Zoom・LINE・メール配送と接続するE2Eテストではない。

停止判定追加後に保護者読取がFirebase Rulesの評価回数上限に達した問題は、同じ役割判定の重複評価を減らして解消した。共有エミュレーターのテストは順次実行し、テスト間のデータ消去競合を防いだ。

**反映・互換性に関する事項**

- アプリとFirestore/Storageルールは未デプロイ。ソースの修正だけでは稼働中の本番環境は変わらない。
- 管理者の自動復旧は、`ADMIN_BOOTSTRAP_EMAILS` に明示した確認済みメールだけを許可する。既存の正常な管理者ログインとは別の処理。
- 自動プロフィール移行は保存済みUIDによる本人紐付けを必須にした。メールのローカル部しか一致しない旧データは、既存管理者による確認・修復が必要。
- 職員名・UID等の保護項目は既存の管理API経由で変更する。別ユーザーへのなりすましに使える直接更新は拒否する。
- AIチャットは既存のURL・ストリーム形式を保ち、共通Firebase Admin認証を利用するため実行環境をEdgeからNodeへ変更した。
- Zoom録画はHTTPSの `zoom.us` / `zoom.com` 配下の宛先・リダイレクトだけを許可する。実際の外部CDN構成は未確認で、範囲外の宛先は安全側に拒否する。
- `FIREBASE_MAIL_COLLECTION` を既定の `mail` 以外にしている環境では、そのコレクションにも専用のサーバー限定ルールが必要。配備環境値は読み出していない。

**監査の限界・残作業**

全455ファイルの逐行監査完了を意味しない。認証・権限・機密データ・主要APIを優先した。独立した監査とアーキテクチャ確認を実施したが、途中で担当エージェントが利用上限に達し、修正後の迂回・互換性確認は親スレッドで行った。残りの画面・非主要API・ユーティリティの網羅的な確認、校舎間公開方針全体、初期パスワード保存方式の再設計、本番構成と外部サービス統合は未確認。

依存監査は当初、情報送信の許可不足として自動承認レビューに拒否された。その後、利用者の明示許可を得て実行した。追加監査・修正結果は末尾に記載。

**変更ファイル**

- `firestore.rules`
- `storage.rules`
- `package.json`
- `lib/server-auth.ts`
- `lib/admin-app-permissions.ts`
- `lib/account-repair.ts`
- `lib/server/zoom-recording-fetch.ts`
- `lib/server/account-credentials.ts`
- `scripts/security/run-emulators.mjs`
- `tests/security/storage.rules.test.mjs`
- `tests/security/firestore.rules.test.mjs`
- `tests/security/config.security.test.mts`
- `tests/security/api-boundaries.test.mjs`
- `app/api/chat/route.ts`
- `app/api/coin-transactions/route.ts`
- `app/api/attendance-payroll/route.ts`
- `app/api/employee-lessons/route.ts`
- `app/api/get-zoom-zak/route.ts`
- `app/api/attendance-diagnostics/route.ts`
- `app/api/first-login/route.ts`
- `app/api/teacher/commuter-passes/route.ts`
- `app/api/zoom/recordings/file/route.ts`
- `app/api/admin/attendance-integration/route.ts`
- `app/api/admin/dedicated-claims/route.ts`
- `app/api/admin/bootstrap-profile/route.ts`
- `app/api/admin/users/route.ts`
- `app/api/admin/first-login/route.ts`
- `app/api/admin/transport-fares/import/route.ts`
- `app/api/admin/accounts/create/route.ts`
- `app/api/admin/accounts/sync-printed-password/route.ts`
- `app/api/admin/school-students/import/route.ts`
- `app/api/admin/transport-stations/import/route.ts`
- `app/api/auth/password-reset/route.ts`
- `app/api/auth/repair-profile/route.ts`
- `app/api/auth/change-password/route.ts`
- `app/master/line/page.tsx`
- `app/student/chat/page.tsx`

修正前ソースに対する正式なスキャン報告は [生成済みレポート](/private/var/folders/v_/t3_fltx541n1z3r_h4xgj49m0000gn/T/codex-security-scans-6nKV3N/classbase-app/21f14b8c9ae64bf304e026a196fc55934739a4e8_20260905T065338Z_4kcvye7m/report.md) に保存。スキャンID: `adf3ea31-2d85-41e2-8812-88859bdd8b8c`。作業中に修正したため、スキャンの証拠は開始時スナップショットに紐付き、本書とテストが修正後の状態を示す。

ツール返却の利用量: total 10,598,394 tokens（input 10,543,046、output 55,348、うちcached input 10,008,192、4 threads、codex_rollout集計）。課金額や今回新規に計算されたトークン数を示すものではない。

## 依存パッケージ追加監査・修正

利用者からnpmレジストリへの依存情報送信の明示許可を得て実施。結果は **部分修正済み**。npmの集計はパッケージ単位であり、独立した悪用可能性を実証した脆弱性の件数ではない。

| 重要度 | 更新前 | 更新後 |
|---|---:|---:|
| 重大 | 1 | 0 |
| 高 | 8 | 2 |
| 中 | 19 | 9 |
| 低 | 6 | 7 |
| 合計 | 34 | 18 |

`package.json` と `package-lock.json` のみ依存修正。Next.js・React・Firebase・AI SDKのメジャーバージョンとアプリ構造は維持した。既存の未コミット変更を保持し、今回の更新直前の依存ファイルは `/tmp/classbase-deps-before` に保存。

- websocket-driver: 0.7.4 → 0.7.5
- @grpc/grpc-js: 1.9.15 → 1.9.16、1.14.3 → 1.14.4
- form-data: 4.0.5 → 4.0.6（開発依存の2.5.5も2.5.6へ）
- protobufjs: 7.5.8 → 7.6.6、関連ヘルパー2件も更新
- undici: 6.19.7 → 6.28.1
- nanoid: 3.3.6 → 3.3.18
- postcss: 既定8.5.15とNext配下8.4.31を8.5.28へ統一

Firebase等が古い間接依存を完全固定しているため、Undici 6とNanoid 3には同一メジャーに限定したoverridesを追加。PostCSSの開発依存指定を `^8.5.28` とし、間接依存も `$postcss` に統一した。メジャーを強制的に飛び越す `npm audit fix --force` は使用していない。

検証: 更新後にsecurity:static 31件、security:rules 49件、関連回帰29件が成功。型チェック、本番用ビルド、差分チェックも成功した。さらに実際のAI SDK/providerを使用し、HTTP応答だけを模擬して日本語テキストが既存形式でストリーム出力されることを確認した。依存監査の再実行で上記更新対象が報告から除外されたことを確認した。各依存の攻撃を本番に送る実証は行っていない。

読み取り専用の独立レビューでは、PostCSSの完全固定を置き換えるためCSSビルド確認が必要との指摘を受け、本番ビルド成功を確認。更新後の本番Firebase/Zoom等とのE2E接続は未実施。

残存する高2件:

- **Next.js 14.2.35**: App Router等のフレームワークの既知問題が残る。npm監査の対象範囲から、同じ14系の更新だけでは解消できない。15系以降への移行には非同期ルートパラメーター、キャッシュ挙動、React互換性と実画面の回帰検証が必要。未修正。
- **jsondiffpatch（AI SDK配下）**: アプリに `ai/rsc` の直接利用は見つからず、確認したチャットは `ai/react` とテキスト専用サーバー処理を使用。ただしパッケージは残っており、未修正扱い。AI SDK/providerとチャットの送受信形式を合わせて移行・検証する必要がある。

その他、AI SDK配下の資源消費・添付ファイル関連、Firebase Admin配下のuuid関連等が残る。確認したuuid呼出しは主にv4であり、報告されるv3/v5/v6のバッファ指定処理への到達は未実証。強制overrideによるuuidのメジャー変更は互換性未確認のため行わない。Firebase Admin 14への更新にはNode 22以上などの実配備環境確認も必要。

残存パッケージ:

- `@ai-sdk/openai`: low
- `@ai-sdk/provider-utils`: low
- `@ai-sdk/react`: low
- `@ai-sdk/solid`: low
- `@ai-sdk/svelte`: low
- `@ai-sdk/ui-utils`: low
- `@ai-sdk/vue`: low
- `@google-cloud/firestore`: moderate
- `@google-cloud/storage`: moderate
- `ai`: moderate
- `firebase-admin`: moderate
- `gaxios`: moderate
- `google-gax`: moderate
- `jsondiffpatch`: high
- `next`: high
- `retry-request`: moderate
- `teeny-request`: moderate
- `uuid`: moderate

この追加修正も未デプロイ。本番の脆弱性解消を意味しない。
