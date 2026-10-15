import fs from 'node:fs';
import path from 'node:path';
import JSZip from 'jszip';

const outputPath = process.argv[2] || 'docs/オンライン校βテストレポート_2026-09-23.docx';

const esc = value => String(value ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&apos;');

function run(text, { bold = false, color, size, italic = false } = {}) {
  const props = [
    '<w:rFonts w:ascii="Source Han Sans JP" w:hAnsi="Source Han Sans JP" w:eastAsia="Source Han Sans JP"/>',
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
  const labels = ['有効アカウント', 'ログイン確認', 'ClassBase経由参加', '複数日参加'];
  const values = ['58人', '42人  72.4%', '26人  44.8%', '18人'];
  const grid = widths.map(width => `<w:gridCol w:w="${width}"/>`).join('');
  const labelRow = `<w:tr>${labels.map((label, index) => cell(label, widths[index], { align: 'center', fill: 'E8EEF5', bold: true, color: '1F3A5F' })).join('')}</w:tr>`;
  const valueRow = `<w:tr>${values.map((value, index) => cell(value, widths[index], { align: 'center', fill: 'F8FAFC', bold: true, color: index === 0 ? '0B2545' : '2E74B5' })).join('')}</w:tr>`;
  return `<w:tbl><w:tblPr><w:tblW w:w="9360" w:type="dxa"/><w:tblInd w:w="120" w:type="dxa"/><w:tblLayout w:type="fixed"/><w:tblCellMar><w:top w:w="100" w:type="dxa"/><w:left w:w="120" w:type="dxa"/><w:bottom w:w="100" w:type="dxa"/><w:right w:w="120" w:type="dxa"/></w:tblCellMar><w:tblBorders><w:top w:val="single" w:sz="4" w:color="C9D2DC"/><w:left w:val="single" w:sz="4" w:color="C9D2DC"/><w:bottom w:val="single" w:sz="4" w:color="C9D2DC"/><w:right w:val="single" w:sz="4" w:color="C9D2DC"/><w:insideH w:val="single" w:sz="4" w:color="D9E0E7"/><w:insideV w:val="single" w:sz="4" w:color="D9E0E7"/></w:tblBorders></w:tblPr><w:tblGrid>${grid}</w:tblGrid>${labelRow}${valueRow}</w:tbl>`;
}

const body = [];
body.push(p('オンライン校βテスト利用状況レポート', { style: 'Title' }));
body.push(p('2026年9月7日から9月23日', { style: 'Subtitle' }));
body.push(richP([{ text: '集計対象  ', bold: true }, { text: '9月23日時点で有効なオンライン校の生徒アカウント' }], { style: 'Metadata', after: 20 }));
body.push(richP([{ text: '時刻基準  ', bold: true }, { text: '日本標準時' }], { style: 'Metadata', after: 180 }));

body.push(p('1  結論', { style: 'Heading1' }));
body.push(richP([{ text: 'ログイン後の利用は一定程度進んでいますが、初回ログインまでの運用負荷が本導入の最大リスクです。', bold: true }], { after: 120 }));
body.push(p('対象58人のうち42人 72.4パーセントでログインを確認し、26人 44.8パーセントがClassBase経由で授業に参加しました。ログイン済みの生徒に限ると参加率は61.9パーセントです。18人は異なる2日以上で授業参加が確認できました。'));
body.push(p('一方、開始3日以内にログインを確認できたのは23人で、ログイン確認者42人のうち19人 45.2パーセントは開始4日目以降でした。9月23日時点でも16人は未ログインです。今回は繰り返しログインを促したものの、利用開始までに時間がかかりました。'));

body.push(metricTable());
body.push(p('注  授業参加はClassBaseの参加ボタンまたは本人操作の参加記録で把握しています。', { style: 'TableCitation', before: 80, after: 160 }));

body.push(p('2  利用段階', { style: 'Heading1' }));
body.push(p('ログイン確認から授業参加への転換率は61.9パーセント、授業参加から複数日参加への転換率は69.2パーセントでした。最も大きな離脱は、アカウントが用意されてから最初にログインするまでに生じています。'));
body.push(table(
  ['段階', '人数', '対象者比', '前段階からの移行率'],
  [
    ['有効アカウント', '58人', '100.0%', '-'],
    ['ログイン確認', '42人', '72.4%', '72.4%'],
    ['ClassBase経由の授業参加', '26人', '44.8%', '61.9%'],
    ['異なる2日以上の参加', '18人', '31.0%', '69.2%'],
  ],
  [3600, 1440, 1800, 2520],
  ['left', 'center', 'center', 'center'],
));

body.push(p('3  学年別の状況', { style: 'Heading1' }));
body.push(p('ログイン率は中1が37.5パーセント、中2が64.7パーセント、中3が84.8パーセントでした。参加率は中1が25.0パーセント、中2が41.2パーセント、中3が51.5パーセントです。'));
body.push(table(
  ['学年', '対象', 'ログイン', 'ログイン率', '授業参加', '参加率'],
  [
    ['中1', '8人', '3人', '37.5%', '2人', '25.0%'],
    ['中2', '17人', '11人', '64.7%', '7人', '41.2%'],
    ['中3', '33人', '28人', '84.8%', '17人', '51.5%'],
    ['合計', '58人', '42人', '72.4%', '26人', '44.8%'],
  ],
  [1260, 1440, 1800, 1800, 1740, 1320],
  ['center', 'center', 'center', 'center', 'center', 'center'],
));

body.push(p('学年ごとに案内回数、授業日程、対象者数が同じではありません。この差を操作性の学年差とは断定せず、移行支援の優先順位を決める材料として扱います。', { style: 'TableCitation', before: 100, after: 120 }));

body.push(p('4  本導入時の移行方針', { style: 'Heading1' }));
body.push(richP([{ text: '推奨方式  ', bold: true }, { text: '旧システムにログインした状態から、新システムへ一度の操作で移行できる認証ブリッジを導入します。' }], { after: 160 }));
for (const item of [
  '事前照合  旧システムの生徒番号と新システムのUIDを運営側で対応付け、重複、退会者、学年、所属校の不一致を先に解消します。',
  'ワンクリック移行  旧システムの新システムを開くボタンから、短時間かつ1回限りの署名付きトークンを発行します。新システムはFirebaseのカスタムトークンへ交換し、IDや初期パスワードの再入力なしで開始させます。',
  '初回画面の最小化  氏名、学年、所属だけを確認し、授業参加画面まで直接案内します。メール認証は生徒の利用開始条件にしません。',
  '例外導線  旧システムに入れない生徒にだけ、期限付きQRコードまたは1回限りのコードを提供します。共通初期パスワードは使用しません。',
  '併走期間  2週間から3週間は旧新システムを併用し、未発行、移行リンク発行済み、交換成功、ホーム表示、参加ボタン表示、授業参加の段階別一覧から未移行者を支援します。',
]) body.push(p(item, { style: 'ListBullet', numId: 1, after: 120 }));

body.push(p('5  セキュリティ要件', { style: 'Heading1' }));
for (const item of [
  '移行トークンは短時間かつ1回限りとし、サーバー間署名、再利用拒否、監査ログを必須とします。',
  '生徒番号だけで本人確認を完了させず、共有・推測可能な初期パスワードを配布しません。',
  'アカウント対応表が一致しない場合は別人に自動結合せず、例外確認に送ります。',
  '発行と交換のレート制限、失効、問い合わせ時の本人確認手順を事前に定めます。',
]) body.push(p(item, { style: 'ListBullet', numId: 1, after: 120 }));

body.push(p('6  本番移行時に計測する項目', { style: 'Heading1' }));
for (const item of [
  'アカウント対応付け完了と移行リンク発行',
  '認証トークン交換の成功と失敗理由',
  '初回ホーム表示と参加ボタン表示',
  '参加ボタンのクリックとZoom起動成功',
  '例外導線の利用と1人を有効化するまでの案内回数および対応時間',
]) body.push(p(item, { style: 'ListBullet', numId: 1, after: 120 }));

body.push(p('7  集計定義と留意事項', { style: 'Heading1' }));
for (const item of [
  '対象は生徒ロール、校舎コード112または校舎名がオンライン校で、退会、アーカイブ、無効などではないアカウントです。対象者のAuth欠損、Auth無効、学年欠損はすべて0件でした。',
  'ログインは期間内の認証済み画面イベントを主な根拠とし、ユーザー最終ログインとFirebase Authenticationの最終サインインも補助的に確認しています。ログイン確認者42人全員で期間内の認証済みイベントを確認できました。',
  '授業参加はClassBaseの参加ボタンまたは本人操作の参加記録で把握し、双子自動連携は除外しています。',
  '旧システムやZoomの直接URLから参加した場合は含まれません。そのため44.8パーセントは全授業の実出席率ではなく、ClassBase経由参加率です。',
  '今回のデータだけでは、遅れてログインした直接原因が案内不足、認証失敗、端末事情のどれかは特定できません。繰り返し促したという評価は運用担当者から提供された状況説明です。',
]) body.push(p(item, { style: 'ListBullet', numId: 1, after: 100 }));
body.push(p('データソース  ClassBase本番Firebaseのusers、beta_test_events、learning_events、attendance、Firebase Authentication。個人名とUIDは本レポートに掲載していません。集計日時  2026年9月23日 21時48分 日本時間。', { style: 'TableCitation', before: 120, after: 0 }));

const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:body>${body.join('')}<w:sectPr><w:headerReference w:type="default" r:id="rId4"/><w:footerReference w:type="default" r:id="rId5"/><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="708" w:footer="708" w:gutter="0"/><w:cols w:space="720"/><w:docGrid w:linePitch="360"/></w:sectPr></w:body></w:document>`;

const stylesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Source Han Sans JP" w:hAnsi="Source Han Sans JP" w:eastAsia="Source Han Sans JP"/><w:sz w:val="22"/><w:szCs w:val="22"/><w:lang w:val="ja-JP" w:eastAsia="ja-JP"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="264" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/><w:pPr><w:spacing w:before="0" w:after="120" w:line="264" w:lineRule="auto"/></w:pPr><w:rPr><w:rFonts w:ascii="Source Han Sans JP" w:hAnsi="Source Han Sans JP" w:eastAsia="Source Han Sans JP"/><w:sz w:val="22"/><w:szCs w:val="22"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:next w:val="Subtitle"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="0" w:after="80"/></w:pPr><w:rPr><w:b/><w:color w:val="000000"/><w:sz w:val="44"/><w:szCs w:val="44"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Subtitle"><w:name w:val="Subtitle"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="0" w:after="240"/></w:pPr><w:rPr><w:color w:val="555555"/><w:sz w:val="28"/><w:szCs w:val="28"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Metadata"><w:name w:val="Metadata"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:after="20" w:line="240" w:lineRule="auto"/></w:pPr><w:rPr><w:color w:val="555555"/><w:sz w:val="20"/><w:szCs w:val="20"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:keepLines/><w:spacing w:before="320" w:after="160"/></w:pPr><w:rPr><w:b/><w:color w:val="000000"/><w:sz w:val="32"/><w:szCs w:val="32"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:keepLines/><w:spacing w:before="240" w:after="120"/></w:pPr><w:rPr><w:b/><w:color w:val="000000"/><w:sz w:val="26"/><w:szCs w:val="26"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading3"><w:name w:val="heading 3"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="160" w:after="80"/></w:pPr><w:rPr><w:b/><w:color w:val="000000"/><w:sz w:val="24"/><w:szCs w:val="24"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="ListBullet"><w:name w:val="List Bullet"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:spacing w:after="160" w:line="280" w:lineRule="auto"/></w:pPr></w:style>
<w:style w:type="paragraph" w:styleId="TableText"><w:name w:val="Table Text"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr><w:rPr><w:sz w:val="18"/><w:szCs w:val="18"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="TableHeader"><w:name w:val="Table Header"/><w:basedOn w:val="TableText"/><w:pPr><w:keepNext/><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr><w:rPr><w:b/><w:color w:val="0B2545"/><w:sz w:val="18"/><w:szCs w:val="18"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="TableCitation"><w:name w:val="Table Citation"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:before="80" w:after="80" w:line="240" w:lineRule="auto"/></w:pPr><w:rPr><w:color w:val="555555"/><w:sz w:val="18"/><w:szCs w:val="18"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Header"><w:name w:val="header"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:after="0"/></w:pPr><w:rPr><w:color w:val="777777"/><w:sz w:val="18"/><w:szCs w:val="18"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Footer"><w:name w:val="footer"/><w:basedOn w:val="Normal"/><w:pPr><w:jc w:val="right"/><w:spacing w:after="0"/></w:pPr><w:rPr><w:color w:val="777777"/><w:sz w:val="18"/><w:szCs w:val="18"/></w:rPr></w:style>
<w:style w:type="table" w:styleId="TableGrid"><w:name w:val="Table Grid"/><w:tblPr><w:tblCellMar><w:top w:w="80" w:type="dxa"/><w:left w:w="120" w:type="dxa"/><w:bottom w:w="80" w:type="dxa"/><w:right w:w="120" w:type="dxa"/></w:tblCellMar></w:tblPr></w:style>
</w:styles>`;

const numberingXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:abstractNum w:abstractNumId="1"><w:multiLevelType w:val="singleLevel"/><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val="•"/><w:lvlJc w:val="left"/><w:pPr><w:tabs><w:tab w:val="num" w:pos="720"/></w:tabs><w:ind w:left="720" w:hanging="360"/><w:spacing w:after="160" w:line="280" w:lineRule="auto"/></w:pPr><w:rPr><w:rFonts w:ascii="Source Han Sans JP" w:hAnsi="Source Han Sans JP" w:eastAsia="Source Han Sans JP"/></w:rPr></w:lvl></w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="1"/></w:num></w:numbering>`;
const headerXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:hdr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">${p('ClassBase  オンライン校βテスト', { style: 'Header' })}</w:hdr>`;
const footerXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:ftr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:p><w:pPr><w:pStyle w:val="Footer"/></w:pPr><w:r><w:t>Page </w:t></w:r><w:fldSimple w:instr="PAGE"><w:r><w:t>1</w:t></w:r></w:fldSimple></w:p></w:ftr>`;

function obfuscateFont(fontPath, guid) {
  const bytes = Buffer.from(fs.readFileSync(fontPath));
  const key = Buffer.from(guid.replace(/[{}-]/g, ''), 'hex');
  for (let index = 0; index < 32; index += 1) bytes[index] ^= key[index % 16];
  return bytes;
}

const regularFontGuid = '{00112233-4455-6677-8899-AABBCCDDEEFF}';
const boldFontGuid = '{10213243-5465-7687-98A9-BACBDCEDFE0F}';
const fontTableXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:fonts xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:font w:name="Source Han Sans JP"><w:altName w:val="SourceHanSansJP-Regular"/><w:family w:val="swiss"/><w:charset w:val="80"/><w:embedRegular r:id="rId1" w:fontKey="${regularFontGuid}"/><w:embedBold r:id="rId2" w:fontKey="${boldFontGuid}"/></w:font></w:fonts>`;

const zip = new JSZip();
zip.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="odttf" ContentType="application/vnd.openxmlformats-officedocument.obfuscatedFont"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/><Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/><Override PartName="/word/fontTable.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.fontTable+xml"/><Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/><Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>`);
zip.file('_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>`);
zip.file('word/document.xml', documentXml);
zip.file('word/styles.xml', stylesXml);
zip.file('word/numbering.xml', numberingXml);
zip.file('word/fontTable.xml', fontTableXml);
zip.file('word/fonts/source-han-sans-jp-regular.odttf', obfuscateFont('/Library/Fonts/SourceHanSansJP-Regular.otf', regularFontGuid));
zip.file('word/fonts/source-han-sans-jp-bold.odttf', obfuscateFont('/Library/Fonts/SourceHanSansJP-Bold.otf', boldFontGuid));
zip.file('word/_rels/fontTable.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/font" Target="fonts/source-han-sans-jp-regular.odttf"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/font" Target="fonts/source-han-sans-jp-bold.odttf"/></Relationships>`);
zip.file('word/settings.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:settings xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:zoom w:percent="100"/><w:defaultTabStop w:val="720"/><w:compat/></w:settings>`);
zip.file('word/header1.xml', headerXml);
zip.file('word/footer1.xml', footerXml);
zip.file('word/_rels/document.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/settings" Target="settings.xml"/><Relationship Id="rId4" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="header1.xml"/><Relationship Id="rId5" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer1.xml"/><Relationship Id="rId6" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/fontTable" Target="fontTable.xml"/></Relationships>`);
zip.file('docProps/core.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>オンライン校βテスト利用状況レポート</dc:title><dc:subject>ClassBase利用状況と本導入時の移行方針</dc:subject><dc:creator>ClassBase</dc:creator><cp:lastModifiedBy>ClassBase</cp:lastModifiedBy><dcterms:created xsi:type="dcterms:W3CDTF">2026-09-23T12:48:00Z</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">2026-09-23T12:48:00Z</dcterms:modified></cp:coreProperties>`);
zip.file('docProps/app.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"><Application>Microsoft Office Word</Application><DocSecurity>0</DocSecurity><ScaleCrop>false</ScaleCrop><Company>ClassBase</Company><AppVersion>16.0000</AppVersion></Properties>`);

const buffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, buffer);
console.log(JSON.stringify({ outputPath, bytes: buffer.length }, null, 2));
