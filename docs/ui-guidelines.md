# ClassBase UIガイドライン

2026-10-17 決定。全アプリ（生徒・保護者・講師・管理・Booster・オンライン校）で見た目と操作をそろえるための決まり。
見本は管理画面の「システム設定（マスター）＞UIガイド」（`/master/ui-guide`）で確認できる。

## 決定事項

| 項目 | 決定 |
|---|---|
| 色 | 文字・枠・状態の色（成功/注意/危険/情報）は全アプリ共通。差し色だけアプリごと：生徒＝テーマ設定、保護者＝紺、講師・管理＝インディゴ、Booster＝緑 |
| 形 | 「やわらか」：入力 8px／ボタン 12px／カード 20px／大きな見出し枠 28px。生徒は設定のカードの形（やわらか・ガラス・くっきり）で変えられる |
| 文字 | Noto Sans JP。本文は標準（400/500）、ラベルと見出しは太字（700）、ページ見出しと大きな数字だけ極太（900）。最小 12px（例外的に 11px まで） |
| 生徒テーマ | 生徒画面の全ページに反映（差し色・地の色・カードの形・余白） |

## 仕組み

- トークンは `app/globals.css` の CSS 変数 `--cb-*`（値は「R G B」）。Tailwind では次のクラスになる（`tailwind.config.ts`）。
  - 色：`bg-canvas` `bg-surface` `border-line` `text-fg` `text-fg-muted` `bg-accent` `hover:bg-accent-hover` `bg-accent-soft` `text-accent-ink` `bg-success` / `-soft`（warning・danger・info も同じ）
  - 角：`rounded-input` `rounded-btn` `rounded-card` `rounded-hero`、影：`shadow-card`、余白：`p-card` `gap-section`
- 各レイアウトのいちばん外側に `data-portal`（`student` / `parent` / `teacher` / `admin` / `eiken`）を付けると差し色が切り替わる。
- 生徒は `lib/student-customization.ts` の `studentAppearanceCssVars()` が見た目の設定を CSS 変数にし、`app/student/layout.tsx` が全ページに渡す。生徒画面のページでは背景色を自分で塗らない（`min-h-screen bg-*` を付けない）。

## 共通部品（`app/components/ui`）

| 部品 | 使いどころ |
|---|---|
| `Button` / `ButtonLink` / `IconButton` | 主（1画面に1つ）・副・控えめ・削除の4種類。送信中は `loading`。アイコンだけのボタンは `IconButton`（`label` 必須） |
| `Card` / `SectionTitle` | 白いカードとその見出し（`.cb-card`） |
| `PageHeader` | ページ上部。`tone="plain"`（管理・講師）／`"hero"`（保護者・生徒）。戻るリンクの文言は「戻る」 |
| `Modal` | ポップアップ。Esc・背景・×で閉じる、スマホは下から出る。重なったときは一番上だけが Esc を受ける。大きさは `size`（`sm` / `md` / `lg`、表やカレンダーを並べる編集画面だけ `xl`）。必ず選ばせるときは `dismissible={false}`。`fixed inset-0` の手作りの窓は新しく書かない（全面の動画・印刷プレビュー・メニューの引き出しは例外） |
| `useToast()` | `alert()` の代わり。`toast.success('保存しました')` |
| `useConfirm()` | `confirm()` の代わり。削除は `tone: 'danger'` と対象名を明記 |
| `usePrompt()` | `prompt()` の代わり。日付は `type: 'date'` |
| `Spinner` / `Skeleton` / `ListSkeleton` | 読み込み中。一覧は Skeleton、ボタンは Button の loading |
| `EmptyState` / `ErrorState` | 0件のとき／失敗したとき。**失敗を「0件」に見せない**（catch では必ず ErrorState か toast.error） |
| `StatusPill` | 状態のラベル（未対応＝warning、対応中＝info、対応済み＝success、見送り＝danger、受付中＝accent） |

### 画面ごとの共通部品

| 部品 | 使いどころ |
|---|---|
| `master/AdminPageHeader` | 管理画面の各ページの見出し。見出し・アイコンは左メニュー（`admin-menu.ts`）から決まるので、メニューにあるページでは `title` を渡さない |
| `master/AdminTabs` | 管理画面のタブ。← → キーで移動できる。`urlParam` を渡すと選んだタブを `?tab=` に残す |
| `master/SortableHeader` + `useTableSort` | 並べ替えできる表の見出し。押すたびに 昇順 → 降順 → 元の順。`aria-sort` 付き |
| `master/StudentSearchBox` | 生徒検索（名前・ふりがな・ログインID）。選ぶと生徒の総合ページを開く。`tone="dark"` はサイドバー用 |
| `master/AdminAccountPanel` | 管理者の「自分のアカウント」（パスワード変更・LINE連携・ログアウト）。設定画面と `/master/account` で共通 |
| `parent/ChildSwitcher` | 保護者画面で表示するお子さまを切り替える。最後に選んだ子を覚え、`pickChildId()` で初期表示を決める |
| `parent/ParentUI` | 保護者画面の見出し（`ParentPageHeader`）・カード・小見出し |

## 書き方の決まり

- ブラウザ標準の `alert` / `confirm` / `prompt` は新しく使わない。
- 灰色は `slate` だけ（`gray` は使わない）。状態の色は emerald / amber / rose / sky（green・yellow・orange・red は使わない）。
- 角の丸みは上のトークンだけ（`rounded-[24px]` などの任意値を新しく書かない）。
- 日付・時刻は `lib/format.ts`（`formatDate` / `formatDateTime` / `formatTime` / `jstDateKey`）。`toISOString().slice(0, 10)` を「今日」に使わない。
- 押せる所は 44px 以上（小さいボタンでも 36px）。アイコンだけのボタンには読み上げ名。
- 生徒・保護者の画面に英語の見出しを出さない。

## 用語（`lib/glossary.ts`）

| 対象 | 使う言葉 | 使わない言葉 |
|---|---|---|
| 授業の録画 | 録画 | アーカイブ、見逃し配信 |
| ご褒美 | コイン | ポイント |
| その日の1コマ／申し込む単位 | 授業／講座 | クラス、曜クラス |
| 教える人 | 職員向け：講師、生徒向け：先生 | |
| 保護者と教室のやりとり | 教室への連絡 | お問い合わせ、教室連絡、個別連絡 |
| 教室からの掲示／自分宛て | お知らせ／通知 | |
| 宿題 | 宿題 | 課題、Main Homework |
| 前の画面へ | 戻る | 一覧へ戻る、ダッシュボードへ戻る |
