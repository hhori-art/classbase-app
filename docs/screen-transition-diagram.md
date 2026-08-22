# 画面遷移図

最終更新: 2026-08-13

## 全体フロー

```mermaid
flowchart TD
    Start["ログイン / "] -->|一般アカウント| Apps["アプリ選択 /apps"]
    Start -->|管理者はこちら| AdminLogin["管理者ログイン /admin/login"]
    AdminLogin --> Master["管理アプリ選択 /master"]

    Apps -->|生徒・理社| Student["生徒ホーム /student"]
    Apps -->|講師・理社| Teacher["講師ホーム /teacher"]
    Apps -->|保護者・理社| Parent["保護者ホーム /parent"]
    Apps -->|生徒・英検| ES["Booster生徒 /eiken/student"]
    Apps -->|講師・英検| ET["Booster講師 /eiken/teacher"]
    Apps -->|保護者・英検| EP["Booster保護者 /eiken/parent"]
    Apps -->|講師・勤怠| Attendance["講師勤怠 /teacher/attendance"]
    Apps -->|管理者| Master

    Master --> MSS["理社管理 /master/science-social"]
    Master --> ME["Booster管理 /master/eiken"]
    Master --> MA["勤怠管理 /master/attendance"]

    Student -. ログアウト .-> Start
    Teacher -. ログアウト .-> Start
    Parent -. ログアウト .-> Start
    Master -. ログアウト .-> Start

    IP["社外IP"] -->|/master/* または制限対象 /teacher/*| Denied["アクセス拒否 /403"]
```

### 認証時の分岐

- 通常ログイン成功後は原則 `/apps` へ遷移する。
- 勤怠専用管理者は `/teacher/attendance` へ直接遷移する。
- `/apps` で利用可能アプリが1つだけの場合は、そのアプリのホームへ自動遷移する。
- 初回パスワード変更が必要な場合は、各ロールの設定画面へ先に遷移する。

## 生徒

```mermaid
flowchart LR
    Apps["/apps"] --> Home["生徒ホーム<br/>/student"]

    subgraph BottomNav["ボトムナビ"]
      Home <--> Community["広場<br/>/student/community"]
      Home <--> Notices["通知<br/>/student/notifications"]
      Home <--> Settings["設定<br/>/student/settings"]
    end

    Home --> Chat["AIチューター<br/>/student/chat"]
    Home --> Homework["宿題一覧<br/>/student/homework"]
    Homework --> HomeworkDetail["宿題詳細<br/>/student/homework/[id]"]
    Home --> Adaptive["AI学習クエスト<br/>/student/homework/adaptive"]
    Adaptive --> History["学習履歴<br/>/student/history"]
    Home --> OCR["OCR問題作成<br/>/student/ocr-quiz"]
    Home --> Recordings["授業録画<br/>/student/recordings"]
    Home --> Absence["欠席連絡<br/>/student/absence"]
    Home --> Change["受講変更<br/>/student/change-request"]
    Home --> News["お知らせ<br/>/student/news"]
    News --> NewsDetail["お知らせ詳細<br/>/student/news/[id]"]
    Home --> Zoom["Zoom授業<br/>/student/zoom"]
    Zoom --> Meeting["ミーティング<br/>/zoom-meeting"]
    Home --> Shop["景品交換<br/>/student/shop"]
    Settings --> Apps
```

## 講師・勤怠専用管理者

```mermaid
flowchart LR
    Apps["/apps"] --> Home["講師ホーム<br/>/teacher"]

    subgraph BottomNav["講師ボトムナビ"]
      Home <--> Work["仕事<br/>/teacher/work"]
      Home <--> Community["コミュニティ<br/>/teacher/community"]
      Home <--> Notices["通知<br/>/teacher/notifications"]
      Home <--> Settings["設定<br/>/teacher/settings"]
    end

    Home --> Preview["生徒画面プレビュー<br/>/teacher/student-preview"]
    Home --> Attendance["勤怠<br/>/teacher/attendance"]
    Home --> Substitutions["代行依頼<br/>/teacher/substitutions"]

    Work --> Shifts["シフト<br/>/teacher/shifts"]
    Work --> Students["生徒一覧<br/>/teacher/students"]
    Work --> Risk["リスクモニター<br/>/teacher/risk-monitor"]
    Work --> Contacts["連絡対応<br/>/teacher/contacts"]
    Work --> Chat["チャット<br/>/teacher/chat"]
    Work --> Homework["宿題一覧<br/>/teacher/homework"]
    Homework --> Create["宿題作成<br/>/teacher/homework/create"]
    Homework --> Detail["宿題詳細<br/>/teacher/homework/[id]"]
    Work --> PF["PF<br/>/teacher/pf"]
    Work --> Slides["授業スライド<br/>/teacher/slides"]
    Home --> News["お知らせ<br/>/teacher/news"]
    News --> NewsDetail["お知らせ詳細<br/>/teacher/news/[id]"]

    Only["勤怠専用管理者"] --> Attendance
    Only --> Settings
```

## 保護者

```mermaid
flowchart LR
    Apps["/apps"] --> Home["保護者ホーム<br/>/parent"]

    subgraph ParentNav["保護者ナビ"]
      Home <--> Messages["AI・連絡<br/>/parent/messages"]
      Home <--> Contact["お問い合わせ<br/>/parent/contact"]
      Home <--> Notices["通知<br/>/parent/notifications"]
      Home <--> Settings["設定<br/>/parent/settings"]
    end

    Messages --> Absence["欠席・遅刻連絡<br/>/parent/absence"]
    Absence -->|送信完了| Home
    Settings --> Apps
```

## 英検 Booster

```mermaid
flowchart TD
    Apps["/apps"] -->|生徒| Student["生徒ホーム<br/>/eiken/student"]
    Apps -->|講師| Teacher["講師ホーム<br/>/eiken/teacher"]
    Apps -->|保護者| Parent["保護者ホーム<br/>/eiken/parent"]
    Apps -->|管理者| Admin["Booster管理<br/>/master/eiken"]

    Student --> Task["学習タスク<br/>/eiken/student/tasks/[id]"]
    Task -->|動画・クイズ・ライティング| Task
    Student -->|LIVE授業| Meeting["Zoomミーティング<br/>/zoom-meeting"]

    Teacher --> StudentDetailT["生徒詳細<br/>/eiken/teacher/students/[id]"]
    Teacher -->|授業を開始| ZoomHost["ZoomホストURL"]

    Admin --> StudentDetailA["生徒詳細<br/>/master/eiken/students/[id]"]
    Parent -->|連携生徒の状況| Parent

    Student --> Apps
    Teacher --> Apps
    Parent --> Apps
    Admin --> Apps
```

## 管理者

```mermaid
flowchart TD
    Login["管理者ログイン<br/>/admin/login"] --> Hub["管理アプリ選択<br/>/master"]

    Hub --> SS["理社ダッシュボード<br/>/master/science-social"]
    Hub --> Eiken["Booster管理<br/>/master/eiken"]
    Hub --> Attendance["勤怠管理<br/>/master/attendance"]
    Hub --> Accounts["全体アカウント管理<br/>/master/accounts"]

    subgraph ScienceSocial["理社講座 管理権限"]
      SS --> Students["校舎別生徒<br/>/master/school-students"]
      SS --> Shifts["シフト<br/>/master/shifts"]
      SS --> Monthly["月間予定<br/>/master/monthly-schedules"]
      SS --> Subs["代行依頼<br/>/master/substitutions"]
      SS --> Announce["お知らせ配信<br/>/master/announcements"]
      SS --> Requests["承認・申請<br/>/master/requests"]
      SS --> ParentQ["保護者問合せ<br/>/master/parent-inquiries"]
      SS --> Registration["登録依頼<br/>/master/registration-tasks"]
      SS --> Allocation["講座割当<br/>/master/course-allocation"]
      SS --> Curriculum["カリキュラム<br/>/master/curriculum"]
      SS --> PF["PF<br/>/master/pf"]
      SS --> Recordings["授業アーカイブ<br/>/master/recordings"]
      SS --> Slides["授業スライド<br/>/master/slides"]
      SS --> Community["コミュニティ<br/>/master/community"]
      SS --> Rewards["景品・コイン<br/>/master/rewards"]
      SS --> Survey["アンケート<br/>/master/survey-settings"]
      SS --> Imports["CSV一括登録<br/>/master/imports"]
      SS --> Line["LINE管理<br/>/master/line"]
    end

    subgraph AttendanceAdmin["勤怠 管理権限"]
      Attendance --> Corrections["打刻修正承認<br/>/master/attendance-corrections"]
      Attendance --> Diagnostics["勤怠ミス候補<br/>/master/attendance/diagnostics"]
      Diagnostics --> Attendance
    end

    subgraph EikenAdmin["英検 管理権限"]
      Eiken --> EStudent["生徒詳細<br/>/master/eiken/students/[id]"]
    end

    subgraph MasterOnly["マスターのみ"]
      Accounts --> Recovery["再設定受付<br/>/master/accounts/recovery"]
      Accounts --> SSO["校舎別アカウント<br/>/master/accounts/sso"]
      Hub --> Access["アプリ権限<br/>/master/access-control"]
      Hub --> Users["ユーザー管理<br/>/master/users"]
      Hub --> Delete["アカウント削除<br/>/master/delete"]
      Hub --> SysSettings["システム設定<br/>/master/settings"]
      Hub --> Stats["統計・分析<br/>/master/stats"]
    end

    Imports --> Curriculum
    Imports --> Slides
    Slides --> TeacherSlides["講師向けスライド<br/>/teacher/slides"]
```

## 遷移制御の優先順位

```mermaid
flowchart LR
    Request["画面アクセス"] --> IP{"IP制限対象?"}
    IP -->|対象かつ社外| Denied["/403"]
    IP -->|許可| Login{"Firebase認証済み?"}
    Login -->|いいえ| Root["/"]
    Login -->|はい| Role{"ロールとURLが一致?"}
    Role -->|いいえ| Apps["/apps またはロール既定画面"]
    Role -->|はい| Password{"初回パスワード変更済み?"}
    Password -->|いいえ| Settings["ロール別設定画面"]
    Password -->|はい| AppPermission{"管理アプリ/英検利用権あり?"}
    AppPermission -->|いいえ| Hub["/master または /apps"]
    AppPermission -->|はい| Page["対象画面を表示"]
```

## 注記

- 図は主要なナビゲーションと業務遷移を示す。ブラウザの戻る、外部URL、モーダル内遷移、同一画面内アンカーは省略した。
- メニュー項目はポータル公開設定によって非表示になる場合がある。
- Mermaid非対応のビューアでは、GitHubまたはMermaid対応Markdownビューアで参照する。
