# 端末への通知（Web Push）

アプリ内通知（`user_notifications`）を書いたときに、「この端末に通知を送る」をオンにした端末へも同じ知らせを出す仕組み。
利用者や管理者の操作をきっかけにした通知と、Vercel Cron（Pro プラン、vercel.json）で決まった時刻に送る自動の通知（授業の未参加・振替の未選択・勤務詳細の未登録・保護者への月のレポートの案内など）を送る。月のレポートの案内は毎月1日の18時台（振替の未選択と同じ Cron）で、管理画面の「通知連携」でオンにしたときだけ送る。

## 使うための準備（1回だけ）

1. VAPID の鍵を作る（手元の端末で実行。鍵はリポジトリに入れない）

   ```sh
   npx web-push generate-vapid-keys
   ```

   `Public Key` と `Private Key` が表示される。

2. Vercel の Project Settings > Environment Variables に次の3つを登録する（Production / Preview それぞれ）

   | 変数 | 値 | 備考 |
   |---|---|---|
   | `NEXT_PUBLIC_VAPID_PUBLIC_KEY` | 手順1の Public Key | ブラウザにも渡る（公開してよい） |
   | `VAPID_PRIVATE_KEY` | 手順1の Private Key | サーバーだけ。絶対に公開しない |
   | `VAPID_SUBJECT` | `mailto:（運用担当のメールアドレス）` | `mailto:` か `https://` で始める |

3. 再デプロイする。`NEXT_PUBLIC_` の値はビルド時に埋め込まれるため、登録後のデプロイが必要。

鍵が未設定の間は、設定画面の切り替えに「準備中です」と表示されて押せず、サーバー側の送信も何もしない（ログに1回だけ警告を出す）。
鍵を作り直すと、それまでに登録された端末には届かなくなる（各端末でオンにし直すと新しい鍵で登録される）。

## 利用者の操作

- 生徒・保護者・講師の「設定」、管理者の「自分のアカウント」に「この端末に通知を送る」の切り替えがある。
- オンにすると、ブラウザの通知許可を求め、`/push-sw.js`（スコープ `/`）を登録して購読する。オフにすると購読と Service Worker を外す。
- iPhone / iPad は、Safari の共有メニューから「ホーム画面に追加」したアプリから開いた時だけ使える（iOS 16.4 以降）。
- 通知をブロックしている場合は、端末・ブラウザの設定で許可するよう案内する。

## 管理者の設定

- マスターの「システム設定 > 通知連携 > 配信チャネル」の「端末への通知を使う」（`settings/notification_channels.push_enabled`）をオフにすると全体で止まる。
- 利用者の `notification_preferences.push === false`、または種類ごとのオフ（`notification_preferences.<kind> === false`）も守る。

## 送る通知

ロック画面に表示されるため、本文は短くし、名前・相談内容・チャットの抜粋は入れない。

| きっかけ | 宛先 | 送り元 |
|---|---|---|
| 保護者連絡・安全アラート・掲示板の通報・代行依頼など管理者向け通知 | マスター・担当校舎の管理者 | `notifyStaff`（`lib/server/staff-recipients.ts`） |
| 欠席・遅刻の連絡、その取り消し、振替の確定 | 保護者（保護者が連絡した時は生徒も） | `app/api/parent/absence-requests`、`app/api/student/transfers` |
| AIチャットの安全アラート | 保護者（落ち着いた定型文） | `lib/server/student-safety.ts` |
| 教室からの返信 | 保護者 | `app/api/admin/parent-inquiries` |
| 受講講座・対策講座の変更 | 生徒・保護者 | `app/api/parent/course-registrations` |
| 代行依頼への返答 | 依頼した講師 | `app/api/teacher/substitutions` |
| 管理者の一斉通知（アプリ内通知を選んだ時） | 対象者 | `app/api/admin/notifications` |
| お知らせの配信（重要・緊急、または「端末にも通知する」をオンにした時。1件につき1回） | お知らせの対象の生徒・保護者・講師（一覧と同じ判定、最大2000人。校舎管理者は読む画面がないため送らない） | `app/api/announcements`（`lib/server/announcement-push.ts`） |

## 仕組み

- 購読は `push_subscriptions/{sha256(endpoint)}` に保存（`user_id`・`endpoint`・`keys`・`user_agent`・`created_at`）。ブラウザからは読み書きできず（`firestore.rules`）、`/api/push/subscriptions` の POST（本人分を登録、1人10台まで・古い順に外す）と DELETE（本人分だけ削除）だけが扱う。
- 送信は `lib/server/web-push.ts` の `queuePushToUsers()`。応答を返した後に `after()` で送り、失敗しても呼び出し元へ例外を返さない。端末側で無効になった購読（404/410）は削除する。
- 同じ端末で別の人がログインして設定画面を開くと、その端末の登録は今の利用者に切り替わる。

## お知らせの端末通知

- マスターの「お知らせ」で配信する時、「端末にも通知する」をオンにすると、対象者の端末へ「お知らせ：（タイトル）」と短い定型文だけを送る。重要・緊急は最初からオン。
- 対象者はお知らせ一覧と同じ `canReadAnnouncement` で判定する（役割・校舎・学年。保護者は紐づく生徒の校舎・学年）。役割ごとに最大5000人を読み、送るのは合計2000人まで。
- アプリ内通知（`user_notifications`）は作らない（お知らせには既読の仕組みがあるため）。
- 1件につき1回だけ送る（`announcements/{id}.push_notified_at` を先に記録する）。操作ログに `announcement_push`（人数）を残す。
- 予約配信は決まった時刻に送る仕組みがないため、配信時刻を過ぎてから一覧の「端末に通知」を押す。
- VAPID の鍵が未設定の間は何も記録しない（鍵を設定した後に一覧から送れる）。
