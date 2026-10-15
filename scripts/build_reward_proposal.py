from pathlib import Path
from PIL import Image, ImageDraw, ImageFont
from docx import Document
from docx.enum.section import WD_SECTION
from docx.enum.text import WD_ALIGN_PARAGRAPH, WD_BREAK
from docx.enum.table import WD_TABLE_ALIGNMENT, WD_CELL_VERTICAL_ALIGNMENT
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Inches, Pt, RGBColor


ROOT = Path(__file__).resolve().parents[1]
OUT_DIR = ROOT / "artifacts"
ASSET_DIR = OUT_DIR / "reward_proposal_assets"
OUT_DIR.mkdir(exist_ok=True)
ASSET_DIR.mkdir(exist_ok=True)
OUTPUT = OUT_DIR / "生徒ポイント年間景品配布制度企画書.docx"

FONT_REG = "/Library/Fonts/SourceHanSansJP-Regular.otf"
FONT_MED = "/Library/Fonts/SourceHanSansJP-Medium.otf"
FONT_BOLD = "/Library/Fonts/SourceHanSansJP-Bold.otf"
DOC_FONT = "Source Han Sans JP"

NAVY = "17365D"
BLUE = "2F75B5"
PALE_BLUE = "EAF2F8"
GREEN = "2E8B70"
PALE_GREEN = "E9F5F0"
GOLD = "C69214"
PALE_GOLD = "FFF7DF"
GRAY = "666666"
LIGHT_GRAY = "F3F5F7"
BORDER = "D9D9D9"
BLACK = "000000"
WHITE = "FFFFFF"


def font(path, size):
    return ImageFont.truetype(path, size)


def draw_percentile_chart(path):
    img = Image.new("RGB", (1600, 720), "white")
    d = ImageDraw.Draw(img)
    title = font(FONT_BOLD, 50)
    label = font(FONT_MED, 31)
    small = font(FONT_REG, 27)
    value_font = font(FONT_BOLD, 34)
    d.text((70, 38), "稼働中の生徒58人におけるポイント分布", font=title, fill="#000000")
    values = [("中央値", 130), ("上位25%境界", 358), ("上位10%境界", 495), ("上位5%境界", 740)]
    max_value = 800
    y0 = 150
    for i, (name, value) in enumerate(values):
        y = y0 + i * 125
        d.text((70, y + 17), name, font=label, fill="#333333")
        d.rounded_rectangle((370, y, 1470, y + 68), radius=18, fill="#EEF2F5")
        width = int(1100 * value / max_value)
        color = ["#7CB5D8", "#4D97C8", "#2F75B5", "#17365D"][i]
        d.rounded_rectangle((370, y, 370 + width, y + 68), radius=18, fill=color)
        d.text((390 + width, y + 14), f"{value:,} pt", font=value_font, fill="#17365D")
    d.text((70, 665), "集計期間 2026年4月30日から10月15日  現在残高と累計獲得ポイントが一致する対象で集計", font=small, fill="#666666")
    img.save(path, quality=95)


def draw_source_chart(path):
    img = Image.new("RGB", (1600, 560), "white")
    d = ImageDraw.Draw(img)
    title = font(FONT_BOLD, 50)
    body = font(FONT_MED, 33)
    small = font(FONT_REG, 28)
    d.text((70, 38), "ポイント獲得源の構成", font=title, fill="#000000")
    x0, y0, total_w, h = 70, 150, 1460, 110
    login_w = int(total_w * 0.898)
    d.rounded_rectangle((x0, y0, x0 + total_w, y0 + h), radius=24, fill="#EEF2F5")
    d.rounded_rectangle((x0, y0, x0 + login_w, y0 + h), radius=24, fill="#2F75B5")
    d.rectangle((x0 + login_w - 24, y0, x0 + login_w, y0 + h), fill="#2F75B5")
    d.rounded_rectangle((x0 + login_w, y0, x0 + total_w, y0 + h), radius=24, fill="#79B89F")
    d.rectangle((x0 + login_w, y0, x0 + login_w + 24, y0 + h), fill="#79B89F")
    d.text((x0 + 26, y0 + 26), "ログインボーナス 89.8%", font=body, fill="white")
    d.text((70, 320), "14,350 pt", font=font(FONT_BOLD, 44), fill="#2F75B5")
    d.text((70, 380), "ログインボーナス", font=small, fill="#444444")
    d.text((690, 320), "1,630 pt", font=font(FONT_BOLD, 44), fill="#2E8B70")
    d.text((690, 380), "ログインミッション", font=small, fill="#444444")
    d.text((70, 486), "現時点では学習行動よりログイン回数の影響が大きいため 景品判定では別の評価点を用いる", font=small, fill="#666666")
    img.save(path, quality=95)


def draw_budget_chart(path):
    img = Image.new("RGB", (1600, 620), "white")
    d = ImageDraw.Draw(img)
    title = font(FONT_BOLD, 50)
    label = font(FONT_MED, 30)
    value_font = font(FONT_BOLD, 34)
    d.text((70, 38), "年間予算10万円の配分", font=title, fill="#000000")
    items = [
        ("継続賞", 50000, "#4D97C8"),
        ("成長賞", 30000, "#79B89F"),
        ("優秀賞", 10000, "#C69214"),
        ("最優秀賞", 5000, "#8C6BB1"),
        ("予備費", 5000, "#8A8A8A"),
    ]
    y0 = 145
    for i, (name, value, color) in enumerate(items):
        y = y0 + i * 86
        d.text((70, y + 8), name, font=label, fill="#333333")
        d.rounded_rectangle((330, y, 1370, y + 55), radius=16, fill="#EEF2F5")
        width = int(1040 * value / 50000)
        d.rounded_rectangle((330, y, 330 + width, y + 55), radius=16, fill=color)
        d.text((1400, y + 5), f"{value:,}円", font=value_font, fill="#17365D")
    img.save(path, quality=95)


def set_cell_shading(cell, fill):
    tc_pr = cell._tc.get_or_add_tcPr()
    shd = tc_pr.find(qn("w:shd"))
    if shd is None:
        shd = OxmlElement("w:shd")
        tc_pr.append(shd)
    shd.set(qn("w:fill"), fill)


def set_cell_border(cell, color=BORDER, size="6"):
    tc_pr = cell._tc.get_or_add_tcPr()
    borders = tc_pr.first_child_found_in("w:tcBorders")
    if borders is None:
        borders = OxmlElement("w:tcBorders")
        tc_pr.append(borders)
    for edge in ("top", "left", "bottom", "right", "insideH", "insideV"):
        tag = f"w:{edge}"
        element = borders.find(qn(tag))
        if element is None:
            element = OxmlElement(tag)
            borders.append(element)
        element.set(qn("w:val"), "single")
        element.set(qn("w:sz"), size)
        element.set(qn("w:color"), color)


def set_cell_margin(cell, top=80, start=100, bottom=80, end=100):
    tc = cell._tc
    tc_pr = tc.get_or_add_tcPr()
    tc_mar = tc_pr.first_child_found_in("w:tcMar")
    if tc_mar is None:
        tc_mar = OxmlElement("w:tcMar")
        tc_pr.append(tc_mar)
    for key, value in (("top", top), ("start", start), ("bottom", bottom), ("end", end)):
        node = tc_mar.find(qn(f"w:{key}"))
        if node is None:
            node = OxmlElement(f"w:{key}")
            tc_mar.append(node)
        node.set(qn("w:w"), str(value))
        node.set(qn("w:type"), "dxa")


def set_repeat_table_header(row):
    tr_pr = row._tr.get_or_add_trPr()
    tbl_header = OxmlElement("w:tblHeader")
    tbl_header.set(qn("w:val"), "true")
    tr_pr.append(tbl_header)


def set_keep_with_next(paragraph, value=True):
    paragraph.paragraph_format.keep_with_next = value


def add_page_number(paragraph):
    paragraph.alignment = WD_ALIGN_PARAGRAPH.RIGHT
    run = paragraph.add_run()
    fld_char1 = OxmlElement("w:fldChar")
    fld_char1.set(qn("w:fldCharType"), "begin")
    instr_text = OxmlElement("w:instrText")
    instr_text.set(qn("xml:space"), "preserve")
    instr_text.text = " PAGE "
    fld_char2 = OxmlElement("w:fldChar")
    fld_char2.set(qn("w:fldCharType"), "end")
    run._r.append(fld_char1)
    run._r.append(instr_text)
    run._r.append(fld_char2)


def add_run(paragraph, text, bold=False, size=None, color=BLACK):
    run = paragraph.add_run(text)
    run.bold = bold
    run.font.name = DOC_FONT
    run._element.get_or_add_rPr().rFonts.set(qn("w:eastAsia"), DOC_FONT)
    run._element.get_or_add_rPr().rFonts.set(qn("w:ascii"), DOC_FONT)
    run._element.get_or_add_rPr().rFonts.set(qn("w:hAnsi"), DOC_FONT)
    if size:
        run.font.size = Pt(size)
    run.font.color.rgb = RGBColor.from_string(color)
    return run


def add_body(doc, text, bold_lead=None, space_after=5):
    p = doc.add_paragraph()
    p.paragraph_format.space_after = Pt(space_after)
    p.paragraph_format.line_spacing = 1.2
    if bold_lead and text.startswith(bold_lead):
        add_run(p, bold_lead, bold=True, size=10)
        add_run(p, text[len(bold_lead):], size=10)
    else:
        add_run(p, text, size=10)
    return p


def add_bullets(doc, items, level=0):
    for item in items:
        p = doc.add_paragraph(style="List Bullet" if level == 0 else "List Bullet 2")
        p.paragraph_format.left_indent = Inches(0.22 + level * 0.2)
        p.paragraph_format.first_line_indent = Inches(-0.16)
        p.paragraph_format.space_after = Pt(2)
        p.paragraph_format.line_spacing = 1.15
        add_run(p, item, size=9.5)


def add_heading(doc, text, level=1):
    p = doc.add_paragraph(style=f"Heading {level}")
    p.paragraph_format.space_before = Pt(8 if level == 1 else 6)
    p.paragraph_format.space_after = Pt(5)
    set_keep_with_next(p)
    add_run(p, text, bold=True, size=16 if level == 1 else 12)
    return p


def add_table(doc, headers, rows, widths, header_fill=NAVY, font_size=9.5):
    table = doc.add_table(rows=1, cols=len(headers))
    table.alignment = WD_TABLE_ALIGNMENT.CENTER
    table.autofit = False
    set_repeat_table_header(table.rows[0])
    for i, (header, width) in enumerate(zip(headers, widths)):
        cell = table.rows[0].cells[i]
        cell.width = Inches(width)
        cell.vertical_alignment = WD_CELL_VERTICAL_ALIGNMENT.CENTER
        set_cell_shading(cell, header_fill)
        set_cell_border(cell)
        set_cell_margin(cell)
        p = cell.paragraphs[0]
        p.alignment = WD_ALIGN_PARAGRAPH.CENTER
        p.paragraph_format.space_after = Pt(0)
        add_run(p, header, bold=True, size=font_size, color=WHITE)
    for row_index, row in enumerate(rows):
        cells = table.add_row().cells
        for i, (value, width) in enumerate(zip(row, widths)):
            cell = cells[i]
            cell.width = Inches(width)
            cell.vertical_alignment = WD_CELL_VERTICAL_ALIGNMENT.CENTER
            set_cell_border(cell)
            set_cell_margin(cell)
            if row_index % 2 == 1:
                set_cell_shading(cell, PALE_BLUE)
            p = cell.paragraphs[0]
            p.paragraph_format.space_after = Pt(0)
            p.paragraph_format.line_spacing = 1.15
            p.alignment = WD_ALIGN_PARAGRAPH.CENTER if i == 0 or len(str(value)) < 14 else WD_ALIGN_PARAGRAPH.LEFT
            add_run(p, str(value), size=font_size)
    doc.add_paragraph().paragraph_format.space_after = Pt(1)
    return table


def add_caption(doc, text):
    p = doc.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    p.paragraph_format.space_after = Pt(7)
    add_run(p, text, size=8.5, color=GRAY)


_SECTION_BREAK_COUNT = 0


def new_page(doc):
    """Keep the cover separate and let later sections flow without sparse spill pages."""
    global _SECTION_BREAK_COUNT
    if _SECTION_BREAK_COUNT == 0:
        doc.add_page_break()
    _SECTION_BREAK_COUNT += 1


draw_percentile_chart(ASSET_DIR / "point_distribution.png")
draw_source_chart(ASSET_DIR / "point_sources.png")
draw_budget_chart(ASSET_DIR / "budget_allocation.png")

doc = Document()
section = doc.sections[0]
section.page_width = Inches(8.5)
section.page_height = Inches(11)
section.top_margin = Inches(0.62)
section.bottom_margin = Inches(0.58)
section.left_margin = Inches(0.78)
section.right_margin = Inches(0.78)

styles = doc.styles
styles["Normal"].font.name = DOC_FONT
styles["Normal"]._element.rPr.rFonts.set(qn("w:eastAsia"), DOC_FONT)
styles["Normal"].font.size = Pt(11)
styles["Title"].font.name = DOC_FONT
styles["Title"]._element.rPr.rFonts.set(qn("w:eastAsia"), DOC_FONT)
styles["Title"].font.color.rgb = RGBColor(0, 0, 0)
styles["Title"].font.size = Pt(25)
styles["Title"].font.bold = True
title_ppr = styles["Title"]._element.get_or_add_pPr()
title_border = title_ppr.find(qn("w:pBdr"))
if title_border is not None:
    title_ppr.remove(title_border)
for name in ("Heading 1", "Heading 2"):
    styles[name].font.name = DOC_FONT
    styles[name]._element.rPr.rFonts.set(qn("w:eastAsia"), DOC_FONT)
    styles[name].font.color.rgb = RGBColor(0, 0, 0)
    styles[name].font.bold = True

header = section.header
hp = header.paragraphs[0]
hp.alignment = WD_ALIGN_PARAGRAPH.LEFT
add_run(hp, "生徒ポイント年間景品配布制度企画書", size=8.5, color=GRAY)
footer = section.footer
fp = footer.paragraphs[0]
fp.alignment = WD_ALIGN_PARAGRAPH.LEFT
add_run(fp, "オンライン事業開発課   2026年10月15日", size=8, color=GRAY)
tab = footer.add_table(rows=1, cols=2, width=Inches(6.8))
tab.autofit = False
tab.columns[0].width = Inches(5.9)
tab.columns[1].width = Inches(0.9)
tab.cell(0, 0).text = ""
add_page_number(tab.cell(0, 1).paragraphs[0])
for c in tab.rows[0].cells:
    c._tc.get_or_add_tcPr().append(OxmlElement("w:tcBorders"))
    for p in c.paragraphs:
        for r in p.runs:
            r.font.size = Pt(8)
            r.font.color.rgb = RGBColor.from_string(GRAY)

# Cover
p = doc.add_paragraph(style="Title")
p.paragraph_format.space_before = Pt(88)
p.paragraph_format.space_after = Pt(14)
p.alignment = WD_ALIGN_PARAGRAPH.LEFT
add_run(p, "生徒ポイント年間景品配布制度企画書", bold=True, size=25)
p = doc.add_paragraph()
p.paragraph_format.space_after = Pt(42)
add_run(p, "年間予算10万円で 学習継続に応じた傾斜配分を実現する", size=17, color=NAVY)

add_heading(doc, "提案の結論", 1)
add_body(doc, "年間景品費は、景品の個数と単価を先に固定する方式で100,000円を上限とします。3,000人規模では全員に現物を配ると一人当たり約33円にしかならないため、ポイント帯に応じて当選確率と景品単価を上げる数量限定方式が現実的です。")
add_bullets(doc, [
    "年間261枠を用意し、継続賞、成長賞、優秀賞、最優秀賞の順に景品単価を上げます。",
    "ポイント残高ではなく年間獲得実績から景品判定用スコアを作り、交換後も努力が消えないようにします。",
    "現在は獲得ポイントの89.8％がログインボーナス由来のため、学習行動を高く評価する補正を加えます。",
    "校舎へまとめて配送し、個別発送費を発生させない運用を前提とします。",
])

add_heading(doc, "今回の判断事項", 2)
add_body(doc, "年間上限は包装費を含む100,000円、対象は本番想定3,000人です。四半期抽選を4回、年度表彰を1回行い、開始後8週間の実績で順位帯の境界値を再計算します。")
p = doc.add_paragraph()
p.paragraph_format.space_before = Pt(10)
add_run(p, "作成日  2026年10月15日", size=10, color=GRAY)
p = doc.add_paragraph()
add_run(p, "作成  オンライン事業開発課", size=10, color=GRAY)

# Page 2
new_page(doc)
add_heading(doc, "実績データで見たポイント獲得率", 1)
add_body(doc, "2026年4月30日から10月15日までの本番データを匿名集計しました。稼働中58人のうち49人が1回以上ポイントを獲得しており、ポイント獲得率は84.5％です。稼働中生徒全体の平均は276ポイント、中央値は130ポイントでした。")
doc.add_picture(str(ASSET_DIR / "point_distribution.png"), width=Inches(6.65))
add_caption(doc, "図1  稼働中生徒のポイント分布  個人名やIDは使用していません")
add_table(doc,
          ["指標", "実績", "読み取り"],
          [
              ["対象", "稼働中58人", "試験運用規模のため本番3,000人への単純拡大には注意が必要"],
              ["獲得者", "49人  84.5%", "参加の入口は比較的広い"],
              ["総獲得", "15,980 pt", "656件の加算取引"],
              ["平均", "276 pt", "獲得者だけでは326 pt"],
              ["中央値", "130 pt", "一部の多獲得者が平均を押し上げている"],
              ["最大", "4,230 pt", "中央値の約33倍で偏りが大きい"],
          ], [1.2, 1.3, 4.15], font_size=8.8)
add_body(doc, "データの制約  集計対象は約5か月半の試験運用です。年度当初から全機能が同じ頻度で使われた結果ではないため、年間の景品条件は固定値だけで決めず、実績の順位帯も併用します。", bold_lead="データの制約  ", space_after=0)

# Page 3
new_page(doc)
add_heading(doc, "現在のポイント付与構造", 1)
add_body(doc, "現在確認できる主な付与条件は次のとおりです。ログインボーナスは10回を1周期として10、10、20、20、30、30、40、40、50、100ポイントが付与され、1ログイン当たりの平均は35ポイントです。")
add_table(doc,
          ["行動", "付与", "上限または条件"],
          [
              ["ログインボーナス", "平均35 pt", "1日1回  10回周期"],
              ["ログインミッション", "10 pt", "1日1回  現在有効"],
              ["録画視聴ミッション", "15 pt", "視聴実績がある日  現在有効"],
              ["録画視聴完了", "10 pt", "録画ごとに1回  15分以上"],
              ["宿題提出", "50 pt", "対象宿題ごとに1回"],
              ["授業アンケート", "10 pt", "対象授業ごとに1回"],
              ["AI学習クエスト", "10 pt", "単元ごとに1日1回"],
              ["コミュニティ参加", "10 pt", "現在は無効"],
              ["コミュニティいいね", "5 pt", "投稿が10いいね到達時に1回"],
          ], [2.25, 1.15, 3.25], font_size=8.6)
doc.add_picture(str(ASSET_DIR / "point_sources.png"), width=Inches(6.65))
add_caption(doc, "図2  集計期間内の獲得ポイント構成")
add_body(doc, "運用上の課題  実績ではログイン関連だけで全獲得ポイントを占めています。景品を単純な累計ポイント順にすると、宿題、録画、授業アンケートなどの学習行動が十分に評価されません。", bold_lead="運用上の課題  ", space_after=0)

# Page 4
new_page(doc)
add_heading(doc, "景品判定用スコアと傾斜配分", 1)
add_body(doc, "景品の判定には、交換後に減るポイント残高ではなく、年度内に獲得したポイントから算出する景品判定用スコアを使います。まずログイン関連ポイントを40％、学習行動ポイントを100％で評価します。")
p = doc.add_paragraph()
p.alignment = WD_ALIGN_PARAGRAPH.CENTER
p.paragraph_format.space_before = Pt(6)
p.paragraph_format.space_after = Pt(14)
add_run(p, "景品判定用スコア ＝ ログイン関連ポイント × 0.4 ＋ 学習行動ポイント × 1.0", bold=True, size=14, color=NAVY)
add_body(doc, "学習行動ポイントには、宿題提出、録画視聴完了、授業アンケート、AI学習クエストを含めます。システム上の保有ポイントは変更せず、景品選考時だけ別計算にするため、既存のポイント交換機能を壊しません。")

add_heading(doc, "ポイント帯ごとの抽選倍率", 2)
add_table(doc,
          ["年度内順位帯", "抽選口数", "考え方"],
          [
              ["下位50%", "1口", "参加の機会を残す"],
              ["上位50%", "2口", "継続した利用を評価"],
              ["上位25%", "4口", "安定した学習行動を評価"],
              ["上位10%", "7口", "高い継続度を明確に優遇"],
              ["上位3%", "10口", "最上位の努力を強く評価"],
          ], [1.55, 1.2, 3.9], font_size=9.2)
add_body(doc, "順位帯は四半期ごとに再計算します。固定ポイント条件だけにしないため、ポイント付与量を将来変更しても予算と当選枠は変わりません。新規入会者には在籍日数で補正した月平均スコアを併用します。")

add_heading(doc, "公平性を保つ運用ルール", 2)
add_bullets(doc, [
    "同一生徒の四半期景品は1回までとし、未当選者を優先する係数を設定します。",
    "成長賞は絶対値ではなく前四半期からの改善率で判定し、途中参加者にも機会を残します。",
    "不正な連続操作や重複付与を除外し、確定前に管理者が異常値だけを確認します。",
    "景品交換でポイントを使っても、景品判定用スコアは減らしません。",
])

# Page 5
new_page(doc)
add_heading(doc, "年間10万円の景品構成", 1)
add_body(doc, "予算超過を防ぐため、ポイント数に円価値を直接連動させません。年度初めに個数と仕入上限を確定し、在庫数に達した時点で受付を終了します。単価には景品本体と個包装を含めます。")
add_table(doc,
          ["区分", "実施", "数量", "単価上限", "年間額", "候補"],
          [
              ["継続賞", "四半期", "50個×4回", "250円", "50,000円", "ステッカーと達成カード  付箋など"],
              ["成長賞", "四半期", "15個×4回", "500円", "30,000円", "オリジナルノート  ペンセット"],
              ["優秀賞", "年度末", "5個", "2,000円", "10,000円", "学習用文具セット  参考書補助"],
              ["最優秀賞", "年度末", "1個", "5,000円", "5,000円", "学習応援セット  図書カード候補"],
              ["予備費", "随時", "一式", "—", "5,000円", "再印刷  包装不足  価格変動"],
              ["合計", "年間", "261枠", "—", "100,000円", "上限内で実施"],
          ], [1.0, 0.85, 1.0, 0.9, 1.0, 2.15], font_size=8.2)
doc.add_picture(str(ASSET_DIR / "budget_allocation.png"), width=Inches(6.65))
add_caption(doc, "図3  年間予算配分  仕入単価が上限を超える場合は数量を減らして調整")
add_body(doc, "3,000人想定では年間261枠は延べ8.7％に相当します。同じ生徒が複数期に当選する可能性があるため、実人数の比率はこれより低くなります。全員配布を行う場合は、現物ではなくデジタルバッジや校舎内掲示で補完します。")

doc.add_page_break()
add_heading(doc, "価格帯別の必要ポイント概算", 2)
add_body(doc, "現時点では、景品価格の上限1円につき2ポイントを基準にします。半年弱の実績では中央値130ポイント、上位10％境界495ポイント、最大4,230ポイントであるため、低価格帯には参加機会を残し、高価格帯ほど到達者を絞る傾斜になります。必要ポイントは応募条件であり、到達者全員への景品提供を保証するものではありません。")
add_table(doc,
          ["景品価格帯", "必要ポイント目安", "主な位置付け", "配布方法"],
          [
              ["100円から250円", "500 pt", "継続賞  入門景品", "四半期抽選"],
              ["251円から500円", "1,000 pt", "成長賞  標準景品", "四半期抽選"],
              ["501円から1,000円", "2,000 pt", "上位景品の追加候補", "年度末抽選"],
              ["1,001円から2,000円", "4,000 pt", "優秀賞", "年度末5枠"],
              ["2,001円から5,000円", "10,000 pt", "最優秀賞", "年度末1枠"],
          ], [1.35, 1.35, 2.15, 1.8], font_size=8.7)
add_body(doc, "算定方法  基準必要ポイントは価格上限の2倍とし、表示しやすい500ポイント単位を基本に丸めます。最優秀賞は現在の実績分布では到達者が出ない可能性があるため、10,000ポイント到達者がいない年度は景品判定用スコアの年間1位を候補とします。制度開始後8週間で分布を再集計し、到達者が多すぎる場合はポイントを上げ、少なすぎる場合は抽選倍率で調整します。", bold_lead="算定方法  ", space_after=0)

# Page 6
new_page(doc)
doc.add_page_break()
add_heading(doc, "景品の装丁と渡し方", 1)
add_body(doc, "景品は金額だけでなく、努力が認められたことが伝わる見せ方に統一します。個別発送は行わず、四半期ごとに校舎別にまとめて納品します。")
add_table(doc,
          ["区分", "色", "包装", "同封物", "受け渡し"],
          [
              ["継続賞", "青", "A6封筒または透明袋", "達成カードとデジタルバッジQR", "校舎で手渡し"],
              ["成長賞", "緑", "クラフト紙スリーブ", "成長コメントカード", "校舎で手渡し"],
              ["優秀賞", "金", "A5厚紙封筒", "表彰カードと学習振り返り欄", "校舎責任者から手渡し"],
              ["最優秀賞", "紺", "小型ギフト箱", "表彰状とメッセージカード", "年度末に表彰"],
          ], [1.0, 0.55, 1.55, 2.25, 1.3], font_size=8.6)

add_heading(doc, "装丁の共通仕様", 2)
add_bullets(doc, [
    "表面には生徒名を印刷せず、校舎内で貼付する宛名シールを別紙にします。",
    "色だけに依存せず、継続、成長、優秀、最優秀の文字とアイコンを併記します。",
    "達成カードには獲得理由、対象期間、次の目標を短く記載します。順位や他者との比較は記載しません。",
    "図書カードなど金券性のある景品は、社内規程と保護者向け案内を確認してから採用します。",
])

add_heading(doc, "景品名の表示例", 2)
add_table(doc,
          ["アプリ表示", "説明文"],
          [
              ["継続賞  青", "毎日の学習を続けた人を対象とする四半期景品"],
              ["成長賞  緑", "前の期間から学習行動が増えた人を対象とする四半期景品"],
              ["優秀賞  金", "年間を通して高い学習継続を示した人を対象とする年度表彰"],
              ["最優秀賞  紺", "年間スコアと学習行動の両方が最上位の人を対象とする年度表彰"],
          ], [1.8, 4.85], font_size=9.0)

# Page 7
new_page(doc)
add_heading(doc, "年間運用スケジュール", 1)
add_table(doc,
          ["時期", "実施内容", "確認事項"],
          [
              ["4月", "年度ルール公開  景品候補と上限単価を決定", "保護者案内  個人情報  金券可否"],
              ["6月末", "第1四半期集計  継続賞と成長賞", "重複付与  異常値  在籍日数補正"],
              ["9月末", "第2四半期集計  継続賞と成長賞", "景品残数  参加率の校舎差"],
              ["12月末", "第3四半期集計  継続賞と成長賞", "予算消化  学習行動比率"],
              ["3月上旬", "第4四半期集計と年度表彰", "最終在庫  受取確認"],
              ["3月末", "年度レビュー  次年度条件を確定", "獲得率  当選者偏り  未受取"],
          ], [1.15, 3.05, 2.45], font_size=8.8)

add_heading(doc, "毎回の運用手順", 2)
add_table(doc,
          ["順序", "担当作業", "完了条件"],
          [
              ["1", "対象期間の獲得履歴を確定し、取消しや重複を除外する", "集計対象件数が確定"],
              ["2", "景品判定用スコアと順位帯を計算する", "境界値と対象者数を保存"],
              ["3", "抽選口数を付与し、乱数と抽選日時を記録する", "再現可能な抽選記録を保存"],
              ["4", "同一人物の重複当選と在籍状態を確認する", "当選者リストを承認"],
              ["5", "校舎別にまとめて配布し、受取を記録する", "未受取者を追跡"],
          ], [0.65, 3.8, 2.2], font_size=8.8)

add_heading(doc, "予算管理のルール", 2)
add_bullets(doc, [
    "年間発注額は95,000円までとし、5,000円を包装、校舎間送料、価格変動の予備費として残します。",
    "景品単価が上限を超えた場合は数量を先に減らし、総額を増やしません。",
    "未受取景品は次回在庫へ繰り越し、同額を重複発注しません。",
])

# Page 8
new_page(doc)
add_heading(doc, "システム対応と管理指標", 1)
add_body(doc, "現在の景品マスターは景品名、必要ポイント、画像を中心とした構成です。予算を自動で守るには、次の項目を追加し、交換処理と在庫更新を同じトランザクションで行う必要があります。")
add_table(doc,
          ["追加項目", "目的"],
          [
              ["年度と対象期間", "年度別の予算と在庫を分離する"],
              ["仕入単価", "発注見込額と実績額を計算する"],
              ["年間在庫数と残数", "上限到達後の交換を止める"],
              ["一人当たり交換上限", "同一生徒への偏りを防ぐ"],
              ["景品区分と順位帯", "傾斜配分を自動判定する"],
              ["交換開始日と終了日", "期間外の申請を防ぐ"],
              ["受取状態", "未受取と再配布を管理する"],
          ], [2.1, 4.55], font_size=9.2)

add_heading(doc, "毎月確認する指標", 2)
add_table(doc,
          ["指標", "初年度の目安", "目的"],
          [
              ["ポイント獲得率", "80%以上", "参加の入口が機能しているか"],
              ["学習行動由来比率", "30%以上を目標", "ログイン偏重が改善しているか"],
              ["校舎別獲得率の差", "最大差20ポイント以内", "案内や利用環境の差を発見する"],
              ["同一生徒の当選集中", "四半期1回以内", "景品の偏りを抑える"],
              ["年間予算消化率", "90から100%", "未消化と超過を防ぐ"],
              ["未受取率", "5%未満", "配布漏れを防ぐ"],
          ], [1.95, 1.65, 3.05], font_size=8.8)

doc.add_page_break()
add_heading(doc, "導入時に確定する事項", 2)
add_bullets(doc, [
    "景品候補の仕入価格を確認し、単価上限内の商品を確定する。",
    "金券性のある景品を採用するか、社内規程と保護者案内の扱いを確認する。",
    "試験運用を8週間行い、3,000人規模の実績から順位帯の境界値を更新する。",
    "景品判定用スコア、抽選履歴、受取履歴を管理画面で出力できるようにする。",
])
add_body(doc, "推奨する開始方法  最初の四半期は継続賞と成長賞だけで運用し、抽選と校舎配布の流れを確認します。年度末の優秀賞と最優秀賞は、学習行動ポイントが十分に蓄積した段階で確定します。", bold_lead="推奨する開始方法  ", space_after=0)

# Core properties and save
doc.core_properties.title = "生徒ポイント年間景品配布制度企画書"
doc.core_properties.subject = "年間予算10万円で実施するポイント連動型景品制度"
doc.core_properties.author = "オンライン事業開発課"
doc.core_properties.comments = "本番ポイント実績の匿名集計に基づく企画書"
doc.save(OUTPUT)
print(OUTPUT)
