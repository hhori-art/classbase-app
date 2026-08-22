# 外部勤怠データ連携 設定手順

## 現在準備済みの機能

- 外部勤怠APIの接続テスト
- 対象月の手動同期と、差分取得用の同期API
- 職員コード優先・氏名補助による本人照合
- 本システムの勤務区間との重複分数の検知
- 勤怠ミス候補画面での重複アラート、同期件数、最終成功日時の表示
- 更新・取消データを同じ外部レコードIDで反映する冪等処理
- 手動CSV／Excel取込の継続利用

## 情報システムへ確認する内容（簡潔版）

> 勤怠データ連携のため、勤怠APIの接続先URL、認証方式・認証情報、取得可能な項目（職員コード、氏名、勤務日、開始・終了時刻、更新日時、取消状態）、差分取得・ページング方法、接続元IP制限の有無、テスト環境の有無をご提供ください。

パスワードやトークンはメール本文へ直接記載せず、社内指定の安全な方法で受領してください。

## サーバー環境変数

必須:

```text
EXTERNAL_ATTENDANCE_API_URL=https://example.invalid/api/attendance
EXTERNAL_ATTENDANCE_API_TOKEN=受領したトークン
EXTERNAL_ATTENDANCE_SYNC_ENABLED=false
```

任意:

```text
EXTERNAL_ATTENDANCE_API_AUTH_HEADER=Authorization
EXTERNAL_ATTENDANCE_API_AUTH_SCHEME=Bearer
EXTERNAL_ATTENDANCE_SOURCE_NAME=通常勤怠システム名
EXTERNAL_ATTENDANCE_API_TIMEOUT_MS=15000
EXTERNAL_ATTENDANCE_RECORDS_PATH=data.records
EXTERNAL_ATTENDANCE_CURSOR_PATH=data.next_cursor
EXTERNAL_ATTENDANCE_FIELD_MAP={"id":"attendance.id","person_code":"employee.code","person_name":"employee.name","date":"work_date","start_time":"clock_in","end_time":"clock_out","work_type":"type","status":"status","updated_at":"updated_at"}
EXTERNAL_ATTENDANCE_STATIC_HEADERS_JSON={"X-Tenant-ID":"受領したテナントID"}
```

`EXTERNAL_ATTENDANCE_FIELD_MAP` は接続先の実際のJSON項目名に合わせます。未指定の場合は `employee_code`、`staff_code`、`work_date`、`clock_in`、`clock_out` などの一般的な項目名を自動認識します。

## 想定するAPI

本システムから次のクエリを付けてGETします。

```text
from=YYYY-MM-DD
to=YYYY-MM-DD
updated_since=ISO日時
cursor=次ページカーソル
limit=500
```

応答は配列、または `records`／`items`／`data` 配列を想定しています。異なる場合は上記の応答パス・項目マッピングで調整します。接続先がGET以外、独自署名、VPN、固定IP必須の場合は受領仕様に合わせた小規模なアダプター追加が必要です。

## 有効化手順

1. 本番ではなくテスト環境の情報を先に設定します。
2. `EXTERNAL_ATTENDANCE_SYNC_ENABLED=false` のまま、管理画面「勤怠ミス候補確認」で「接続テスト」を実行します。
3. 対象月を選び「選択月を同期」を実行し、件数と重複アラートを確認します。
4. 職員コード、時刻、取消データが正しく反映されることを確認します。
5. `EXTERNAL_ATTENDANCE_SYNC_ENABLED=true` に変更します。
6. `/api/attendance-integration/sync` を定期実行します。`Authorization: Bearer ${CRON_SECRET}` が必要です。

自動実行間隔は契約中のホスティングプランと勤怠APIの呼出上限を確認後、10～30分を目安に設定します。確認前に高頻度スケジュールを有効化すると、デプロイ制限やAPI制限に抵触する可能性があるため、現時点ではスケジュール自体を追加していません。

## セキュリティと運用

- APIトークンは環境変数だけに保存し、画面・ログ・Firestoreへ返しません。
- 同期先には照合に必要な項目と原本ハッシュだけを保存し、API応答全文は保存しません。
- 外部レコードIDから決定的な文書IDを作るため、同じデータを再同期しても二重登録しません。
- APIエラー時は既存データを削除せず、同期状態を失敗として記録します。
- 手動インポートは障害時の代替手段として残しています。
