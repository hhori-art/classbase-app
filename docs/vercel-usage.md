# Vercel の使用量の管理

## プラン

- 2026-11-06 から **Pro プラン**（チーム horiharuhitos-projects）。
- それまでの Hobby（無料）プランは、2026-11-06 4:23 に Active CPU（fluidCpuDuration）の上限を超え、チーム全体が 402（DEPLOYMENT_DISABLED）で止まった。Hobby は業務での利用も認められていない。
- Pro は含まれる使用量を超えた分が従量課金になる。**Spend Management（Settings → Billing）で月の上限額と通知を設定しておく**（上限に達したときに止めるかどうかもここで決める）。

## Pro にしたことで変えたこと

Hobby の Cron は「1日1回・指定した1時間のどこか」でしか動かなかった。Pro では分単位で決まった時刻に動くので、次を変えた（`vercel.json` の `crons`、時刻は UTC）。

| 処理 | 変更前（Hobby） | いま（Pro） |
|---|---|---|
| 授業の未参加の通知 `/api/cron/missed-class` | 20時台・21時台・22時台の3回（開始から最大1時間以上遅れる） | 日本時間19〜22時台に5分ごと（時限の開始10分後から5分以内） |
| セキュリティ監視 `/api/security/monitor` | 毎朝7時に直近24時間 | 5分ごとに直近1時間（同じ1時間に知らせた出来事は繰り返さない）＋毎朝7時に直近24時間 |
| Zoom 録画の取り込み `/api/zoom/recordings/sync` | 毎朝10時（直近3日） | 毎朝10時に加えて、授業後の日本時間22:30・23:30・0:30（直近1日）。録画をその日の夜に見られる |

ほかの Cron（勤務詳細の未登録・振替の未選択・βテスト校の日次レポート）は1日1回のままで、時刻がぶれなくなった。

## 上限を超えないための設計

Spend Management の従量の上限は **$20、達するとチーム全体が止まる**（`vercel billing budgets set --amount 20 --pause`）。
止まらないよう、次の3段で守る。

1. **ふだんの使用量を小さく保つ**（下の実装方針）。2026-11 の実測では、直近7日の Active CPU は約1.4時間（月に約6時間、$1〜2）。
   含まれる $20 の1割前後で動いている。
2. **使用額の見張りと節約モード**（`lib/usage-guard.ts`・`lib/server/usage-guard.ts`・`/api/cron/usage-guard`、1時間ごと）。
   Vercel API から今月の使用額を取り、月末の見込みを出して `settings/usage_guard` に残す。

   | 状態 | 条件 | 動き |
   |---|---|---|
   | 通常 | 見込みが $20 未満 | ふだんどおり |
   | 節約モード | 見込みが $20 以上、または従量課金が始まった | セキュリティ監視を5分ごと→1時間ごと、未参加の通知を5分ごと→15分ごと、授業後の録画の取り込みとβテストの利用ログを停止 |
   | 節約モード（critical） | 見込みが $30 以上、または従量が $10 以上 | 節約モードと同じ動きで、マスターへの知らせを強める |

   切り替わったときはマスターへアプリ内通知・端末通知で知らせる。節約中は見込みが $16 を下回るまで戻さない。
   生徒・保護者・講師の画面の機能は止めない（止めるのは重要でない定期処理と計測だけ）。
3. **最後の止め**：それでも従量が $20 に達したら Vercel がチーム全体を止める。

### 見張りの準備（1回だけ）

使用額を取るには Vercel のアクセストークンが必要。未設定の間、見張りは何もしない（ずっと「通常」）。

1. Vercel の Account Settings → Tokens で、スコープをチーム「HORIHARUHITO's projects」にしたトークンを作る（期限を付ける）。
2. classbase-app の Settings → Environment Variables（Production）に、**Sensitive** で次の2つを登録する。
   - `VERCEL_USAGE_TOKEN`：手順1のトークン（チャットなどに貼らず、直接入力する）
   - `VERCEL_TEAM_ID`：`team_SgFTcB5hg94g0LVWbne39L4b`
3. 再デプロイする。トークンの期限が切れると、見張りが失敗したことを1日1回マスターへ知らせる。

### CPU を多く使っていたところ（2026-11-06 に直したもの）

- `/api/course-registration-options`（CPU の約3割、1回1.5秒）：シフトの同期（GAS から数分ごと）が、配置が変わっていなくても毎回キャッシュを捨てていた。変わったときだけ捨てるようにし、キャッシュの時間を5分→30分にし、同じインスタンスでは60秒だけ結果を手元で使い回すようにした。

使用量の内訳は `npx vercel metrics vercel.function_invocation.function_cpu_time_ms --aggregation sum --group-by route --order-by value --since 7d` で見られる。

## 使用量を抑える実装方針（Hobby のときから続けている）

- `vercel.json` で Fluid Compute を有効にする。API の最大実行時間は原則60秒。
- 静的ファイルは Middleware の対象外にして、CDN から直接配信する。
- オンライン校管理画面は表示中だけ2分ごとに更新する。通知は表示中だけ5分ごとに更新し、非表示のタブでは更新しない。
- CPU 負荷の高い PDF 生成はブラウザ側で行う。画像・Excel 処理を API に足すときは、件数とファイルサイズに上限を設ける。
- βテスト利用ログは端末側で最大25件までまとめ、30秒ごとか画面を離れるときに送る。本番の既定は `summary`（`NEXT_PUBLIC_BETA_ANALYTICS_LEVEL`）。

## 月次確認

Vercel の Usage で直近30日を確認し、増えている項目があれば次の順で見る。

1. 呼び出し回数が多い Function（クライアントのポーリング、重複リクエスト、Bot アクセス）
2. CPU 時間が多い Function（全件走査、同期変換、巨大 JSON の生成）
3. メモリ時間が多い Function（長い外部 API 待ち、大きなファイル処理）

Pro では Usage の画面で Function ごとの内訳が見られる（さらに細かいルート別の分析は Observability Plus が必要）。
