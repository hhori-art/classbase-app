# 英検対策講座 Booster アーキテクチャ

## 目的

既存の創造学園アプリへ、認証を増やさずに英検対策講座を追加する。理社講座・勤怠の既存URLとデータは変更せず、英検機能を独立モジュールとして配置する。

## 画面構成

```text
/
└ 創造学園アプリ ログイン
   └ /apps 利用可能アプリ一覧
      ├ 理社講座: /student /parent /teacher /master
      ├ 英検Booster: /eiken/student /eiken/parent /eiken/teacher /master/eiken
      └ 勤怠: /teacher/attendance /master/attendance
```

ログイン後は、勤怠専用アカウントを除いて `/apps` を表示する。英検カードは受講登録、親子紐づけ、講師担当、管理権限のいずれかがサーバーで確認できた場合だけ返す。

## 認証と認可

- Firebase Authenticationと`users/{uid}`を共用する。
- クライアントはFirebase ID TokenをAPIへ送る。
- APIは`getServerUser`で本人とロールを復元する。
- 英検アクセスは`lib/eiken/access.ts`で再判定する。
- 生徒用ダッシュボードにはZoom Meeting ID、パスコード、参加URLを含めない。
- LIVE授業参加時だけ、受講登録と時間帯を検証して正式な参加URLを返す。
- AI評価はサーバー側のみで実行する。

## モジュール境界

- `lib/eiken`: 英検の型、認可、データ集約、AI評価。
- `app/api/eiken`: 英検専用Route Handler。
- `app/eiken`: 生徒、保護者、講師画面。
- `app/master/eiken`: 管理画面。
- 既存の理社講座コレクションやAPIは英検から更新しない。

## カレンダー

理社講座は既存の講師配置・月間予定を使用する。Boosterは`eiken_lessons.start_at`と`eiken_tasks.due_at`だけを表示する。アプリごとの予定が混ざらないため、利用者は現在開いている講座の予定だけを確認できる。

## 外部サービス

- Zoom: 既存Server-to-Server OAuthを共用。
- AI添削: `OPENAI_API_KEY`設定時はOpenAI、未設定または`EIKEN_AI_MODE=mock`時はモック評価。
- Vercel: 既存`classbase-app`プロジェクトへ統合する。

## 既存機能への影響

- ログイン後の初期遷移だけをロール別ホームから`/apps`へ変更した。
- 各既存ホーム、既存API、既存Firestoreコレクションは保持する。
- 各既存画面にはアプリ一覧へ戻る導線を追加した。

