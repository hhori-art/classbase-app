# MySQL通常勤怠連携

Windows同期クライアントから、HMAC-SHA256署名付きHTTPSで次のAPIへ勤怠データを取り込みます。

```text
POST /api/attendance-integration/import
```

## サーバー環境変数

配備先の秘密ストアへ `ATTENDANCE_HMAC_SECRET` を32文字以上で設定します。値はソース、Git、通常ログへ保存しません。Windows側では同じ値を `Set-AttendanceSyncApiSecret.ps1` からDPAPIへ保存します。

```text
ATTENDANCE_HMAC_SECRET=<32文字以上の共有シークレット>
ATTENDANCE_MAX_BODY_BYTES=1048576
ATTENDANCE_MAX_RECORDS=500
ATTENDANCE_TIMESTAMP_TOLERANCE_SECONDS=300
ATTENDANCE_IMPORT_COLLECTION=attendance_regular_imports
ATTENDANCE_BATCH_COLLECTION=attendance_integration_batches
ATTENDANCE_HISTORY_COLLECTION=attendance_integration_history
ATTENDANCE_ALERT_COLLECTION=attendance_integration_alerts
ATTENDANCE_EMPLOYEE_COLLECTION=users
ATTENDANCE_SYSTEM_COLLECTION=work_records
ATTENDANCE_EMPLOYEE_CODE_FIELDS=lifetime_id,staff_id,staffId,employee_id,employeeId,teacher_code
ATTENDANCE_EMPLOYEE_NAME_FIELDS=name,teacher_name,displayName,display_name,student_name
```

既存のFirebase Admin環境変数（`NEXT_PUBLIC_FIREBASE_PROJECT_ID`、`FIREBASE_CLIENT_EMAIL`、`FIREBASE_PRIVATE_KEY`）は従来どおり必要です。

## Firestoreへの保存

- 取込本体: `attendance_regular_imports`
- バッチ冪等管理: `attendance_integration_batches`
- 同期履歴: `attendance_integration_history`
- 確認アラート: `attendance_integration_alerts`
- 既存勤怠との比較先: `work_records`

本人照合は `users` の職員コード候補を優先し、1件に確定できない場合だけ氏名を補助にします。`work_records.teacher_id`、`date`、`start_time`、`end_time` と比較して時間重複を検出します。通常勤怠データを既存 `work_records` へ自動統合しないため、既存の承認・給与計算ロジックは変更されません。

`tbl_work_YYYYMM` の明細は、`mas_course` の授業名と `mas_work` の業務名を使って `lesson`、`office`、`support`、`break` の `workSegments` へ変換します。各明細には開始・終了、分数、授業コード・名称、業務コード・名称、校舎コード・名称を保存します。詳細行が存在しない打刻は推測せず、`workType` を通常勤務として保持します。

管理者の勤怠画面には、本人未照合と時間重複を表示します。時間重複が残っている月の給与CSV出力時には警告確認を表示します。

## 導入手順

1. 配備先へ `ATTENDANCE_HMAC_SECRET` を設定する。
2. `firebase deploy --only firestore:rules,firestore:indexes` でRulesとインデックスを反映する。
3. アプリを配備し、`https://<本番ホスト>/api/attendance-integration/import` をWindows側 `config.json` の `import_api_url` に設定する。
4. Windowsで `Set-AttendanceSyncApiSecret.ps1` を実行し、同じ共有シークレットをDPAPIへ保存する。
5. 読み取り専用MySQLアカウントへ切り替え、`privileged_account_manual_only` を `false` にして指定年月の手動同期を行う。
6. Firestoreの取込件数、同期履歴、アラート、既存勤務記録の非変更を確認してからタスクを登録する。

`root_sozo` は接続テストとDry Run専用です。API送信やタスク登録には使用しません。

## ローカル検証

```powershell
npm.cmd run typecheck
npm.cmd run test:attendance
npm.cmd run lint
npm.cmd run build
```

## 本番ビルドに必要な既存アプリ設定

このリポジトリは多数のクライアント画面で Firebase Web SDK を使用するため、`npm.cmd run build` の前に次の実値が必要です。値は Firebase Console の「プロジェクトの設定 > 全般 > マイアプリ > SDK の設定と構成」から取得します。

```text
NEXT_PUBLIC_FIREBASE_API_KEY=
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=
NEXT_PUBLIC_FIREBASE_PROJECT_ID=
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=
NEXT_PUBLIC_FIREBASE_APP_ID=
FIREBASE_CLIENT_EMAIL=
FIREBASE_PRIVATE_KEY=
OPENAI_API_KEY=
ATTENDANCE_HMAC_SECRET=
```

`FIREBASE_PRIVATE_KEY` は改行を `\n` に置き換えた一行形式でも使用できます。秘密値を Git にコミットしないでください。

現行リポジトリでは `OPENAI_API_KEY` が未設定だと既存 `/api/homework/adaptive` のページデータ収集で本番ビルドが停止します。勤怠APIとは別の既存要件なので、配備環境と同じ安全な環境変数を設定してビルドしてください。
