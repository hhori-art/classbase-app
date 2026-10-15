# Design QA: 勤怠承認シフト管理

- source visual truth: `/Users/onlinekaihatsu/.codex/generated_images/01a0dce4-fcfe-72b0-9dd4-4137f631511a/exec-b1189275-ae0b-4266-839c-cb21fef62f8f.png`
- implementation screenshot: CUA browser capture, Chrome tab `1430487693`, local production build `/design-preview/attendance-shifts` (inline browser artifact captured 2026-10-09)
- viewport: 1905 x 920 CSS px, desktop Chrome, device scale 1
- source pixels: 1487 x 1058 px
- implementation pixels: 1905 x 920 px
- normalization: both images were compared as full desktop content views; browser chrome was excluded. Different aspect ratios were treated as a viewport difference rather than a layout defect.
- state: 2026年10月の月表示、個別タブ、10月9日選択、右側日別詳細。追加で1週間・今日表示と新規登録ドロワーを確認。

## Findings

- P0/P1/P2: 残存なし。
- P3: ソースは標準より高密度なデモデータだが、実装は実データ量に応じて5件表示と残件表示になる。情報階層・セル密度・右側詳細の構成は一致している。

## Required fidelity surfaces

- Fonts and typography: 日本語システムサンセリフ、太字の見出し、小さいラベルと等幅時刻の階層を確認。折返し・省略に破綻なし。
- Spacing and layout rhythm: 上部ヘッダー、操作列、フィルタ列、月グリッド、右側詳細の5層構成を維持。角丸・罫線・影の強弱も一貫。
- Colors and visual tokens: 白・薄いスレーを基調に、インディゴの選択色、集団=緑、個別=青、事務=紫の意味色を維持。文字コントラストも問題なし。
- Image quality and asset fidelity: 画像素材は使用しないUI。アイコンはLucideのベクターで統一し、代替プレースホルダーなし。
- Copy and content: 「勤怠承認シフト管理」に用途を特定し、月・1週間・今日、集団・個別・事務、コピー、CSV入出力、勤怠反映の文言を確認。

## Full-view comparison evidence

- ソースの大判カレンダー+右側の選択日ペイン、上部の表示・種別・コピー・CSV操作を同じ視線順序で確認。
- 月表示の日付選択、当日バッジ、時刻・氏名・個別比率チップ、右側の編集・コピー・削除導線を確認。

## Focused region comparison evidence

- 上部ツールバー: 月・1週間・今日の切替、集団・個別・事務タブ、日/週コピー、CSV取込/出力を常時表示。
- 日別ペイン: 選択日、件数、講師、雇用区分、授業条件、勤怠反映状態、行操作を確認。
- 新規登録ドロワー: 5分単位の開始/終了、複数職員選択、個別比率、単価区分、勤怠反映トグルを確認。

## Comparison history

1. Initial pass
   - P2: CSV入出力と日/週コピーが「その他」内に隠れ、ソースより発見性が低かった。
   - P2: 時間グリッドで操作要素が入れ子になるアクセシビリティ上の問題を検出。
2. Fixes
   - 大画面で日/週コピーとCSV取込/出力をツールバーへ常時表示。小画面はメニュに収納。
   - 時間グリッドの外側セルを非操作要素にし、各シフトを独立したbuttonに変更。
3. Post-fix evidence
   - Chromeタブ `1430487693` の月表示で全4操作が常時表示。
   - 1週間表示のAXツリーでシフトbuttonの入れ子が解消。
   - 今日表示で当日の時間軸とシフト位置を確認。新しい本番ビルドタブのコンソールエラーは0件。

## Implementation checklist

- [x] 月表示
- [x] 1週間表示
- [x] 今日表示と当日への復帰
- [x] 日・週・1コマのコピー
- [x] CSV取込・出力
- [x] 集団・個別・事務の切替
- [x] 専任・準専任の校舎範囲表示
- [x] 勤怠画面と実績作成ベースへの反映

## Follow-up polish

- P3: 実運用でデータ量が増えた後、月セル内の「+N件」と右側詳細の視認性を実データで再確認する。

final result: passed
