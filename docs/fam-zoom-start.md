# FAMキャンパスの席から Zoom をホストで開始する

FAMキャンパスの席に設定するURLです。席に座ってURLが開くと、Zoom がホストとして起動します。
Cloudflare Workers（Worker「fam-zoom」、KV「fam-zoom-rooms」）で試作したものを、このアプリに移しました。

## しくみ

```
GET /zoom/start?room=<教室キー>
  → 教室キーからミーティングIDを引く（Firestore: fam_zoom_rooms/<教室キー>.meeting_id）
  → Zoom API GET /v2/meetings/{meetingId} の start_url
  → 302 で start_url へ（Cache-Control: no-store）
```

- コード：`lib/fam-zoom-start.ts`（処理）、`app/zoom/start/route.ts`（入口）、テスト `tests/fam-zoom-start.test.mts`
- **ログイン不要**です。開いた人は誰でもホストになります（合意済み）。推測されにくい教室キーで守ります。
- IP制限の対象外です（FAMキャンパスから開くため）。
- start_url の中のトークン（ZAK）は約2時間で切れるので、**開くたびに Zoom から取り直し**、保存しません。
- Zoom のアクセストークンは、既存の Zoom 連携（`lib/zoom-meeting.ts` の Server-to-Server OAuth、環境変数 `ZOOM_ACCOUNT_ID`・`ZOOM_CLIENT_ID`・`ZOOM_CLIENT_SECRET`）をそのまま使います。期限の5分前まで使い回し、Zoom が 401 を返したら取り直して1回だけやり直します。
- 必要な Zoom のスコープは `meeting:read:meeting:admin`（旧形式 `meeting:read:admin`）。生徒の「今日の授業」で正式な参加URLを取るのに同じ API をすでに使っています。

| 状況 | ステータス | 表示 |
|---|---|---|
| 成功 | 302 | Zoom の start_url へ移る |
| room なし | 400 | 教室が指定されていません（URLの末尾に ?room=教室キー を付けてください） |
| 未登録の教室キー | 404 | 教室が見つかりません |
| Zoom API の失敗 | 502 | Zoomを開始できませんでした（Zoom のエラーメッセージとステータスコード） |

start_url・トークン・教室キーは、エラー画面にもログにも出しません（ログにはミーティングIDだけ）。

## 教室の追加・変更

管理画面 →「システム設定（マスター）」→「FAMキャンパスの教室」（`/master/fam-zoom-rooms`、マスターだけ）。

- 教室の追加・ミーティングIDの変更・教室キーの作り直し・削除ができます。操作は操作ログに残ります（教室キーそのものは残しません）。
- 「URLをコピー」で、席に設定するURLをコピーできます。
- 初期データ（ブースA〜F）は `npm run fam-zoom:seed`（確認だけ）→ `npm run fam-zoom:seed -- --apply`（書き込み）で入れます。すでにある教室キーは変えません。

## 運用上の注意

- **このURLを開いた人は誰でもホストになります。** 席の設定以外では共有しないでください。
- **漏れたとき**は、管理画面の「編集」で教室キーを作り直し、FAMキャンパスの席のURLを差し替えてください。古いURLはすぐに使えなくなります。
- **同じホストアカウントのミーティングは、同時に開催できる数に上限があります。** 同じ時間帯に複数のブースを使う場合は、ホストの割り当てを確認してください。
- Cloudflare 側（Worker「fam-zoom」、KV「fam-zoom-rooms」）は、切り替えが終わってから人が判断して止めます。このアプリからは触りません。

## 本番での確認手順（人が行う）

1. 管理画面「FAMキャンパスの教室」に、ブースA〜Fの6件があることを確かめる。
2. ログインしていないブラウザ（シークレットウィンドウなど）で、ブースAの席URLを開く。
   `https://classbase-app.vercel.app/zoom/start?room=booth-a-r4u7rff8`
3. ブラウザが `https://zoom.us/s/98332455891?...` に移り、「Zoom Meetings を開きますか？」が出ることを確かめる。
   移った先のURLにはホスト用のトークンが入っているので、**アドレスバーのURLをコピーしたり、チャットやスクリーンショットに残したりしない**。
4. Zoom アプリを開き、ホストとしてミーティングが始まること（参加者一覧で自分が「ホスト」、録画・ブレイクアウトなどホストのメニューが使える）を確かめる。
5. 確認が済んだらミーティングを終了する。
6. 失敗の画面も確かめる：
   - `https://classbase-app.vercel.app/zoom/start` → 「教室が指定されていません」
   - `https://classbase-app.vercel.app/zoom/start?room=booth-z-test` → 「教室が見つかりません」
7. 問題なければ、FAMキャンパスの各席のURLを、ドメイン部分だけ差し替える（下の一覧）。

ステータスだけをコマンドで確かめるときは、移り先のURL（トークン入り）を表示しないようにします。

```
curl -s -o /dev/null -w '%{http_code} %{redirect_url}\n' 'https://classbase-app.vercel.app/zoom/start?room=booth-a-r4u7rff8' | sed -E 's/\?.*/?（省略）/'
```

## FAMキャンパスの席URL

| ブース | 席に設定するURL |
|---|---|
| A | https://classbase-app.vercel.app/zoom/start?room=booth-a-r4u7rff8 |
| B | https://classbase-app.vercel.app/zoom/start?room=booth-b-fzrm3mde |
| C | https://classbase-app.vercel.app/zoom/start?room=booth-c-vhgj4sdu |
| D | https://classbase-app.vercel.app/zoom/start?room=booth-d-m68ydtc3 |
| E | https://classbase-app.vercel.app/zoom/start?room=booth-e-wuqqc95t |
| F | https://classbase-app.vercel.app/zoom/start?room=booth-f-kfeasfxg |
