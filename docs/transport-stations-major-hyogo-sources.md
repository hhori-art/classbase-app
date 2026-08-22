# 兵庫県主要交通機関 駅名・停留所名マスタ出典メモ

作成日: 2026-06-27

## 対象CSV

- `docs/transport-stations-major-hyogo.csv`
- `public/templates/transport-stations-major-hyogo.csv`

## 参照元

- 神戸市営地下鉄: 神戸市交通局「地下鉄」「地下鉄路線図」
  - https://kotsu.city.kobe.lg.jp/subway/
  - https://kotsu.city.kobe.lg.jp/subway/route-map/
- JR西日本: JRおでかけネット停車駅案内、補助的に公開路線一覧
  - https://www.jr-odekake.net/station/pdf/teisya_03.pdf
- 阪急: 阪急電鉄「神戸線 | 路線・駅」
  - https://www.hankyu.co.jp/station/kobe/index.html
- 阪神: 阪神電気鉄道「路線図・駅情報」
  - https://www.hanshin.co.jp/station/
- 山陽電車: 山陽電車「鉄道情報／路線図・駅情報」
  - https://www.sanyo-railway.co.jp/railway/station/index.html
- 神戸電鉄: 神戸電鉄「駅・路線図」
  - https://www.shintetsu.co.jp/railway/station/
- 神戸新交通: 神戸新交通「路線図・駅情報」
  - https://www.knt-liner.co.jp/ja/station/
- 神戸市営バス: 神戸市交通局「バス停留所一覧」「市バス路線図」
  - https://kotsu.city.kobe.lg.jp/bus/bus-stop-list/
  - https://kotsu.city.kobe.lg.jp/bus/route-map/
- 神姫バス: 神姫バス「路線バス」「バス停マップ」「神姫バスNavi」
  - https://www.shinkibus.co.jp/bus/area/
  - https://www.shinkibus.co.jp/bus/map/
  - https://navi.shinkibus.jp/

## 注意

鉄道は対象路線の駅名を一通り登録しています。
バス停留所は数が非常に多いため、現時点では講師交通費で使いやすい主要停留所を登録しています。
全停留所を完全登録する場合は、事業者公式の停留所データ、GTFS、または駅すぱあと/NAVITIME等のAPI連携で補完してください。

## 2026-06-27 追記

- JR西日本の兵庫県内駅を追加補完しました。
  - 山陽本線の姫路以西、福知山線、山陰本線の兵庫県内駅など
  - 乗換駅の路線欄も複数路線に補正
- 阪急宝塚本線の兵庫県内駅を追加しました。
- 阪神武庫川線の駅を追加しました。
- 神戸新交通のポートライナー、六甲ライナーを追加しました。
- 神戸市営バス・神姫バスは、全停留所ではなく主要停留所を追加補完しています。
