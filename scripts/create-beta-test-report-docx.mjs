import fs from 'node:fs';
import path from 'node:path';
import JSZip from 'jszip';

const outputPath = process.argv[2] || 'docs/第1弾βテストレポート_2026-08-25.docx';

const esc = value => String(value ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&apos;');

function run(text, { bold = false, color, size, italic = false } = {}) {
  const props = [
    '<w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:eastAsia="Yu Gothic"/>',
    bold ? '<w:b/>' : '', italic ? '<w:i/>' : '',
    color ? `<w:color w:val="${color}"/>` : '',
    size ? `<w:sz w:val="${size}"/><w:szCs w:val="${size}"/>` : '',
  ].join('');
  return `<w:r><w:rPr>${props}</w:rPr><w:t xml:space="preserve">${esc(text)}</w:t></w:r>`;
}

function p(text = '', options = {}) {
  const {
    style = 'Normal', bold = false, color, size, italic = false,
    before, after, align, keepNext = false, keepLines = false,
    pageBreakBefore = false, shade, numId, ilvl = 0,
  } = options;
  const pPr = [
    style ? `<w:pStyle w:val="${style}"/>` : '',
    (before !== undefined || after !== undefined)
      ? `<w:spacing${before !== undefined ? ` w:before="${before}"` : ''}${after !== undefined ? ` w:after="${after}"` : ''}/>` : '',
    align ? `<w:jc w:val="${align}"/>` : '',
    keepNext ? '<w:keepNext/>' : '', keepLines ? '<w:keepLines/>' : '',
    pageBreakBefore ? '<w:pageBreakBefore/>' : '',
    shade ? `<w:shd w:val="clear" w:color="auto" w:fill="${shade}"/>` : '',
    numId ? `<w:numPr><w:ilvl w:val="${ilvl}"/><w:numId w:val="${numId}"/></w:numPr>` : '',
  ].join('');
  return `<w:p><w:pPr>${pPr}</w:pPr>${run(text, { bold, color, size, italic })}</w:p>`;
}

function richP(parts, options = {}) {
  const pPr = [
    `<w:pStyle w:val="${options.style || 'Normal'}"/>`,
    `<w:spacing w:before="${options.before ?? 0}" w:after="${options.after ?? 120}"/>`,
    options.align ? `<w:jc w:val="${options.align}"/>` : '',
    options.keepNext ? '<w:keepNext/>' : '',
    options.shade ? `<w:shd w:val="clear" w:color="auto" w:fill="${options.shade}"/>` : '',
    options.numId ? `<w:numPr><w:ilvl w:val="0"/><w:numId w:val="${options.numId}"/></w:numPr>` : '',
  ].join('');
  return `<w:p><w:pPr>${pPr}</w:pPr>${parts.map(part => run(part.text, part)).join('')}</w:p>`;
}

function cell(text, width, { header = false, align = 'left', fill, bold = false, color } = {}) {
  const cellFill = fill || (header ? 'E8EEF5' : 'FFFFFF');
  return `<w:tc><w:tcPr><w:tcW w:w="${width}" w:type="dxa"/><w:shd w:val="clear" w:color="auto" w:fill="${cellFill}"/><w:vAlign w:val="center"/></w:tcPr>${p(text, { style: header ? 'TableHeader' : 'TableText', bold: header || bold, color, align })}</w:tc>`;
}

function table(headers, rows, widths, aligns = []) {
  const grid = widths.map(width => `<w:gridCol w:w="${width}"/>`).join('');
  const header = `<w:tr><w:trPr><w:tblHeader/></w:trPr>${headers.map((value, index) => cell(value, widths[index], { header: true, align: aligns[index] || 'left' })).join('')}</w:tr>`;
  const body = rows.map((row, rowIndex) => `<w:tr>${row.map((value, index) => cell(value, widths[index], { align: aligns[index] || 'left', fill: rowIndex % 2 ? 'F8FAFC' : 'FFFFFF' })).join('')}</w:tr>`).join('');
  return `<w:tbl><w:tblPr><w:tblStyle w:val="TableGrid"/><w:tblW w:w="9360" w:type="dxa"/><w:tblInd w:w="120" w:type="dxa"/><w:tblLayout w:type="fixed"/><w:tblCellMar><w:top w:w="80" w:type="dxa"/><w:left w:w="120" w:type="dxa"/><w:bottom w:w="80" w:type="dxa"/><w:right w:w="120" w:type="dxa"/></w:tblCellMar><w:tblBorders><w:top w:val="single" w:sz="4" w:color="C9D2DC"/><w:left w:val="single" w:sz="4" w:color="C9D2DC"/><w:bottom w:val="single" w:sz="4" w:color="C9D2DC"/><w:right w:val="single" w:sz="4" w:color="C9D2DC"/><w:insideH w:val="single" w:sz="4" w:color="D9E0E7"/><w:insideV w:val="single" w:sz="4" w:color="D9E0E7"/></w:tblBorders></w:tblPr><w:tblGrid>${grid}</w:tblGrid>${header}${body}</w:tbl>`;
}

function metricTable() {
  const widths = [2340, 2340, 2340, 2340];
  const labels = ['対象アカウント', 'ログイン率', '授業参加率', 'ログイン者内参加率'];
  const values = ['56人', '21.4%', '7.1%', '33.3%'];
  const grid = widths.map(width => `<w:gridCol w:w="${width}"/>`).join('');
  const labelRow = `<w:tr>${labels.map((label, index) => cell(label, widths[index], { align: 'center', fill: 'E8EEF5', bold: true, color: '1F3A5F' })).join('')}</w:tr>`;
  const valueRow = `<w:tr>${values.map((value, index) => cell(value, widths[index], { align: 'center', fill: 'F8FAFC', bold: true, color: index === 0 ? '0B2545' : '2E74B5' })).join('')}</w:tr>`;
  return `<w:tbl><w:tblPr><w:tblW w:w="9360" w:type="dxa"/><w:tblInd w:w="120" w:type="dxa"/><w:tblLayout w:type="fixed"/><w:tblCellMar><w:top w:w="100" w:type="dxa"/><w:left w:w="120" w:type="dxa"/><w:bottom w:w="100" w:type="dxa"/><w:right w:w="120" w:type="dxa"/></w:tblCellMar><w:tblBorders><w:top w:val="single" w:sz="4" w:color="C9D2DC"/><w:left w:val="single" w:sz="4" w:color="C9D2DC"/><w:bottom w:val="single" w:sz="4" w:color="C9D2DC"/><w:right w:val="single" w:sz="4" w:color="C9D2DC"/><w:insideH w:val="single" w:sz="4" w:color="D9E0E7"/><w:insideV w:val="single" w:sz="4" w:color="D9E0E7"/></w:tblBorders></w:tblPr><w:tblGrid>${grid}</w:tblGrid>${labelRow}${valueRow}</w:tbl>`;
}

const body = [];
body.push(p('第1弾βテストレポート', { style: 'Title' }));
body.push(p('生徒によるClassBase利用状況', { style: 'Subtitle' }));
body.push(richP([{ text: '集計基準日: ', bold: true }, { text: '2026年8月25日' }], { style: 'Metadata', after: 20 }));
body.push(richP([{ text: '観測期間: ', bold: true }, { text: '2026年7月6日〜2026年8月25日（確認できた利用記録の範囲）' }], { style: 'Metadata', after: 20 }));
body.push(richP([{ text: '対象: ', bold: true }, { text: '生徒権限を持ち、表示名が8桁の数字であるアカウント' }], { style: 'Metadata', after: 180 }));

body.push(p('Executive Summary（要約）', { style: 'Heading1' }));
body.push(richP([{ text: 'ログインは12人、ログイン率は21.4%です。', bold: true }, { text: ' 対象56アカウントのうち、44アカウントではログイン実績を確認できませんでした。' }], { numId: 1, after: 120 }));
body.push(richP([{ text: '本アプリ経由で授業に参加した生徒は4人です。', bold: true }, { text: ' 全対象者に対する授業参加率は7.1%、ログイン済み生徒に限ると33.3%でした。' }], { numId: 1, after: 120 }));
body.push(richP([{ text: '中3の低い利用率は、案内条件の違いを踏まえて解釈する必要があります。', bold: true }, { text: ' 中3への案内は1週間のみで、夏期講習では本アプリを使用していません。そのため、中1・中2との単純比較は適切ではありません。' }], { numId: 1, after: 120 }));
body.push(richP([{ text: '次回は案内期間と利用対象授業をそろえた検証が必要です。', bold: true }, { text: ' 特に未ログイン層への初回導線と、ログイン後に授業参加へ至る導線を分けて改善・計測します。' }], { numId: 1, after: 160 }));

body.push(metricTable());
body.push(p('注: 授業参加率は「対象アカウントのうち、本アプリから1回以上Zoom授業参加操作を行った人数」の割合です。', { style: 'TableCitation', before: 80, after: 160 }));

body.push(p('ログインから授業参加までに改善余地がある', { style: 'Heading1' }));
body.push(p('対象56人のうち、ログイン済みは12人、授業参加まで到達したのは4人でした。したがって、最初の課題は未ログイン44人への利用開始支援です。同時に、ログイン済み12人のうち8人は本アプリ経由の授業参加記録がないため、授業当日の案内や参加ボタンまでの導線にも改善余地があります。'));
body.push(table(
  ['段階', '人数', '対象者比', '前段階からの移行率'],
  [
    ['対象アカウント', '56人', '100.0%', '-'],
    ['ログイン済み', '12人', '21.4%', '21.4%'],
    ['本アプリ経由で授業参加', '4人', '7.1%', '33.3%'],
  ],
  [3600, 1440, 1800, 2520],
  ['left', 'center', 'center', 'center'],
));
body.push(p('参加記録は延べ19件でした。ただし、延べ件数は一部の継続利用者の影響を受けるため、本レポートの主要指標には重複を除いた利用者数を採用しています。', { style: 'TableCitation', before: 80, after: 120 }));

body.push(p('学年別では中3の検証条件が異なる', { style: 'Heading1' }));
body.push(p('中1・中2のログイン率はいずれも33.3%でした。一方、中3のログイン率は12.5%、授業参加率は3.1%です。ただし中3は案内が1週間のみで、夏期講習には本アプリを使用していないため、この差をアプリへの評価や継続意向の差とみなすことはできません。'));
body.push(table(
  ['学年', '対象', 'ログイン', 'ログイン率', '授業参加', '参加率', 'ログイン者内参加率'],
  [
    ['中1', '9人', '3人', '33.3%', '1人', '11.1%', '33.3%'],
    ['中2', '15人', '5人', '33.3%', '2人', '13.3%', '40.0%'],
    ['中3', '32人', '4人', '12.5%', '1人', '3.1%', '25.0%'],
    ['合計', '56人', '12人', '21.4%', '4人', '7.1%', '33.3%'],
  ],
  [1050, 1110, 1200, 1320, 1230, 1230, 2220],
  ['center', 'center', 'center', 'center', 'center', 'center', 'center'],
));
body.push(richP([
  { text: '中3に関する重要注記: ', bold: true, color: '7A5A00' },
  { text: '案内期間は1週間のみであり、夏期講習では本アプリを使用していません。中3の利用率が低いことは想定される結果で、他学年との公平な比較にはなりません。' },
], { shade: 'FFF8E1', before: 120, after: 160 }));

body.push(p('次のβテストで優先すること', { style: 'Heading1' }));
for (const item of [
  '案内条件を統一する: 全学年で案内開始日、利用対象授業、検証期間をそろえ、比較可能な状態にします。',
  '未ログイン44人を支援する: 初回ログイン手順を短くし、案内後48時間以内の未ログイン者を確認して再案内します。',
  '授業参加までの導線を確認する: ログイン済みで未参加の8人を対象に、授業表示、参加ボタン、Zoom起動までの離脱点を確認します。',
  '継続利用を測る: 初回ログイン率だけでなく、週次の再訪率、2回以上の授業参加者率、参加操作の失敗件数を追跡します。',
]) body.push(p(item, { style: 'ListBullet', numId: 1, after: 120 }));

body.push(p('今後確認したい事項', { style: 'Heading1' }));
for (const item of [
  '未ログインの主因は、未案内・認証情報の問題・端末環境・利用意図の不理解のどれか。',
  '外部Zoomリンクから参加した生徒を含めた場合、本アプリ経由参加率との差はどの程度か。',
  '授業予定数を分母とした「回数ベースの参加率」を算出するため、対象者別の参加可能授業をどう確定するか。',
]) body.push(p(item, { style: 'ListBullet', numId: 1, after: 120 }));

body.push(p('集計定義・留意事項', { style: 'Heading1' }));
for (const item of [
  '対象者: usersコレクションでroleがstudent、かつ表示名を全半角正規化した後に8桁の数字と一致するアカウント。個人IDは本レポートに掲載していません。',
  'ログイン済み: users.last_login、β利用記録、またはFirebase Authenticationの最終サインイン時刻のいずれかを確認できたアカウント。',
  '授業参加済み: 本アプリのZoom参加操作から作成された参加イベントまたは出席記録が1件以上あるアカウント。双子連携による自動出席は除外しています。',
  '本指標はユニーク利用者ベースです。授業予定数を分母にした出席率ではありません。',
  '外部リンクからZoomへ直接参加した場合は本アプリ経由参加として記録されないため、実際の授業出席者数より低く見える可能性があります。',
  '観測できた記録は2026年7月6日から2026年8月25日までです。記録機能導入以前の利用は含まれない可能性があります。',
]) body.push(p(item, { style: 'ListBullet', numId: 1, after: 100 }));
body.push(p('データソース: ClassBase本番Firebase（users、Firebase Authentication、beta_user_metrics、learning_events、attendance）。集計日時: 2026年8月25日 21:53（日本時間）。', { style: 'TableCitation', before: 120, after: 0 }));

const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:body>${body.join('')}<w:sectPr><w:headerReference w:type="default" r:id="rId4"/><w:footerReference w:type="default" r:id="rId5"/><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="708" w:footer="708" w:gutter="0"/><w:cols w:space="720"/><w:docGrid w:linePitch="360"/></w:sectPr></w:body></w:document>`;

const stylesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:eastAsia="Yu Gothic"/><w:sz w:val="22"/><w:szCs w:val="22"/><w:lang w:val="ja-JP" w:eastAsia="ja-JP"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="264" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/><w:pPr><w:spacing w:before="0" w:after="120" w:line="264" w:lineRule="auto"/></w:pPr><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:eastAsia="Yu Gothic"/><w:sz w:val="22"/><w:szCs w:val="22"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:next w:val="Subtitle"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="0" w:after="80"/></w:pPr><w:rPr><w:b/><w:color w:val="0B2545"/><w:sz w:val="52"/><w:szCs w:val="52"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Subtitle"><w:name w:val="Subtitle"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="0" w:after="240"/></w:pPr><w:rPr><w:color w:val="555555"/><w:sz w:val="28"/><w:szCs w:val="28"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Metadata"><w:name w:val="Metadata"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:after="20" w:line="240" w:lineRule="auto"/></w:pPr><w:rPr><w:color w:val="555555"/><w:sz w:val="20"/><w:szCs w:val="20"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:keepLines/><w:spacing w:before="320" w:after="160"/></w:pPr><w:rPr><w:b/><w:color w:val="2E74B5"/><w:sz w:val="32"/><w:szCs w:val="32"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:keepLines/><w:spacing w:before="240" w:after="120"/></w:pPr><w:rPr><w:b/><w:color w:val="2E74B5"/><w:sz w:val="26"/><w:szCs w:val="26"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading3"><w:name w:val="heading 3"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="160" w:after="80"/></w:pPr><w:rPr><w:b/><w:color w:val="1F4D78"/><w:sz w:val="24"/><w:szCs w:val="24"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="ListBullet"><w:name w:val="List Bullet"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:spacing w:after="160" w:line="280" w:lineRule="auto"/></w:pPr></w:style>
<w:style w:type="paragraph" w:styleId="TableText"><w:name w:val="Table Text"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr><w:rPr><w:sz w:val="18"/><w:szCs w:val="18"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="TableHeader"><w:name w:val="Table Header"/><w:basedOn w:val="TableText"/><w:pPr><w:keepNext/><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr><w:rPr><w:b/><w:color w:val="0B2545"/><w:sz w:val="18"/><w:szCs w:val="18"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="TableCitation"><w:name w:val="Table Citation"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:before="80" w:after="80" w:line="240" w:lineRule="auto"/></w:pPr><w:rPr><w:color w:val="555555"/><w:sz w:val="18"/><w:szCs w:val="18"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Header"><w:name w:val="header"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:after="0"/></w:pPr><w:rPr><w:color w:val="777777"/><w:sz w:val="18"/><w:szCs w:val="18"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Footer"><w:name w:val="footer"/><w:basedOn w:val="Normal"/><w:pPr><w:jc w:val="right"/><w:spacing w:after="0"/></w:pPr><w:rPr><w:color w:val="777777"/><w:sz w:val="18"/><w:szCs w:val="18"/></w:rPr></w:style>
<w:style w:type="table" w:styleId="TableGrid"><w:name w:val="Table Grid"/><w:tblPr><w:tblCellMar><w:top w:w="80" w:type="dxa"/><w:left w:w="120" w:type="dxa"/><w:bottom w:w="80" w:type="dxa"/><w:right w:w="120" w:type="dxa"/></w:tblCellMar></w:tblPr></w:style>
</w:styles>`;

const numberingXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:abstractNum w:abstractNumId="1"><w:multiLevelType w:val="singleLevel"/><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val="•"/><w:lvlJc w:val="left"/><w:pPr><w:tabs><w:tab w:val="num" w:pos="720"/></w:tabs><w:ind w:left="720" w:hanging="360"/><w:spacing w:after="160" w:line="280" w:lineRule="auto"/></w:pPr><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:eastAsia="Yu Gothic"/></w:rPr></w:lvl></w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="1"/></w:num></w:numbering>`;
const headerXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:hdr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">${p('ClassBase | 第1弾βテスト', { style: 'Header' })}</w:hdr>`;
const footerXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:ftr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:p><w:pPr><w:pStyle w:val="Footer"/></w:pPr><w:r><w:t>Page </w:t></w:r><w:fldSimple w:instr="PAGE"><w:r><w:t>1</w:t></w:r></w:fldSimple></w:p></w:ftr>`;

const zip = new JSZip();
zip.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/><Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/><Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/><Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>`);
zip.file('_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>`);
zip.file('word/document.xml', documentXml);
zip.file('word/styles.xml', stylesXml);
zip.file('word/numbering.xml', numberingXml);
zip.file('word/settings.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:settings xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:zoom w:percent="100"/><w:defaultTabStop w:val="720"/><w:compat/></w:settings>`);
zip.file('word/header1.xml', headerXml);
zip.file('word/footer1.xml', footerXml);
zip.file('word/_rels/document.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/settings" Target="settings.xml"/><Relationship Id="rId4" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="header1.xml"/><Relationship Id="rId5" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer1.xml"/></Relationships>`);
zip.file('docProps/core.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>第1弾βテストレポート</dc:title><dc:subject>生徒によるClassBase利用状況</dc:subject><dc:creator>ClassBase</dc:creator><cp:lastModifiedBy>ClassBase</cp:lastModifiedBy><dcterms:created xsi:type="dcterms:W3CDTF">2026-08-25T12:53:00Z</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">2026-08-25T12:53:00Z</dcterms:modified></cp:coreProperties>`);
zip.file('docProps/app.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"><Application>Microsoft Office Word</Application><DocSecurity>0</DocSecurity><ScaleCrop>false</ScaleCrop><Company>ClassBase</Company><AppVersion>16.0000</AppVersion></Properties>`);

const buffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, buffer);
console.log(JSON.stringify({ outputPath, bytes: buffer.length }, null, 2));
