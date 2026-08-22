import fs from 'node:fs';
import path from 'node:path';
import JSZip from 'jszip';

const auditPath = process.argv[2] || '/tmp/api-screen-audit.json';
const outputPath = process.argv[3] || 'docs/ClassBase_API画面対応状況_2026-08-20.docx';
const audit = JSON.parse(fs.readFileSync(auditPath, 'utf8'));

const esc = (value) => String(value ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
const pathStyle = (value) => value.replace(/:([A-Za-z0-9_]+)/g, '[$1]');
const methodOrder = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD'];
const sortedMethods = (methods) => [...methods].sort((a, b) => methodOrder.indexOf(a) - methodOrder.indexOf(b));

function run(text, { bold = false, color, size, italic = false } = {}) {
  const props = [
    '<w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:eastAsia="Yu Gothic"/>',
    bold ? '<w:b/>' : '', italic ? '<w:i/>' : '',
    color ? `<w:color w:val="${color}"/>` : '',
    size ? `<w:sz w:val="${size}"/><w:szCs w:val="${size}"/>` : '',
  ].join('');
  return `<w:r><w:rPr>${props}</w:rPr><w:t xml:space="preserve">${esc(text)}</w:t></w:r>`;
}

function p(text = '', { style = 'Normal', bold = false, color, size, before, after, align, keepNext = false, pageBreakBefore = false, shade, borderBottom = false, numId, ilvl = 0 } = {}) {
  const pPr = [
    style ? `<w:pStyle w:val="${style}"/>` : '',
    (before !== undefined || after !== undefined) ? `<w:spacing${before !== undefined ? ` w:before="${before}"` : ''}${after !== undefined ? ` w:after="${after}"` : ''}/>` : '',
    align ? `<w:jc w:val="${align}"/>` : '',
    keepNext ? '<w:keepNext/>' : '',
    pageBreakBefore ? '<w:pageBreakBefore/>' : '',
    shade ? `<w:shd w:val="clear" w:color="auto" w:fill="${shade}"/>` : '',
    borderBottom ? '<w:pBdr><w:bottom w:val="single" w:sz="12" w:space="8" w:color="2E74B5"/></w:pBdr>' : '',
    numId ? `<w:numPr><w:ilvl w:val="${ilvl}"/><w:numId w:val="${numId}"/></w:numPr>` : '',
  ].join('');
  return `<w:p><w:pPr>${pPr}</w:pPr>${run(text, { bold, color, size })}</w:p>`;
}

function richP(parts, options = {}) {
  const pPr = [
    options.style ? `<w:pStyle w:val="${options.style}"/>` : '<w:pStyle w:val="Normal"/>',
    options.after !== undefined ? `<w:spacing w:after="${options.after}"/>` : '',
    options.shade ? `<w:shd w:val="clear" w:color="auto" w:fill="${options.shade}"/>` : '',
  ].join('');
  return `<w:p><w:pPr>${pPr}</w:pPr>${parts.map((part) => run(part.text, part)).join('')}</w:p>`;
}

function cell(text, width, { header = false, align = 'left', fill } = {}) {
  const cellFill = fill || (header ? 'F2F4F7' : 'FFFFFF');
  return `<w:tc><w:tcPr><w:tcW w:w="${width}" w:type="dxa"/><w:shd w:val="clear" w:color="auto" w:fill="${cellFill}"/><w:vAlign w:val="center"/></w:tcPr>${p(text, { style: header ? 'TableHeader' : 'TableText', bold: header, align })}</w:tc>`;
}

function table(headers, rows, widths, aligns = []) {
  const grid = widths.map((width) => `<w:gridCol w:w="${width}"/>`).join('');
  const rowXml = [
    `<w:tr><w:trPr><w:tblHeader/></w:trPr>${headers.map((header, index) => cell(header, widths[index], { header: true, align: aligns[index] || 'left' })).join('')}</w:tr>`,
    ...rows.map((row) => `<w:tr>${row.map((value, index) => cell(value, widths[index], { align: aligns[index] || 'left' })).join('')}</w:tr>`),
  ].join('');
  return `<w:tbl><w:tblPr><w:tblStyle w:val="TableGrid"/><w:tblW w:w="9360" w:type="dxa"/><w:tblInd w:w="120" w:type="dxa"/><w:tblLayout w:type="fixed"/><w:tblCellMar><w:top w:w="80" w:type="dxa"/><w:left w:w="120" w:type="dxa"/><w:bottom w:w="80" w:type="dxa"/><w:right w:w="120" w:type="dxa"/></w:tblCellMar><w:tblBorders><w:top w:val="single" w:sz="4" w:color="C9D2DC"/><w:left w:val="single" w:sz="4" w:color="C9D2DC"/><w:bottom w:val="single" w:sz="4" w:color="C9D2DC"/><w:right w:val="single" w:sz="4" w:color="C9D2DC"/><w:insideH w:val="single" w:sz="4" w:color="D9E0E7"/><w:insideV w:val="single" w:sz="4" w:color="D9E0E7"/></w:tblBorders></w:tblPr><w:tblGrid>${grid}</w:tblGrid>${rowXml}</w:tbl>`;
}

const uniqueConsumers = (route, method = null) => [...new Set(route.consumers.filter((item) => !method || item.method === method).map((item) => item.page))];
const commonRoute = '/api/beta/events';
const mappingRows = [];
for (const route of audit.routes) {
  for (const method of sortedMethods(route.methods)) {
    const pages = uniqueConsumers(route, method);
    if (!pages.length) continue;
    let screenText = pages.join('、');
    if (route.route === '/api/auth/repair-profile') screenText = '共通認証基盤（ログイン後の各画面）';
    mappingRows.push([method, pathStyle(route.route), screenText]);
  }
}
mappingRows.push(['POST', commonRoute, '全画面（共通レイアウトの利用状況記録）']);
mappingRows.sort((a, b) => a[1].localeCompare(b[1]) || methodOrder.indexOf(a[0]) - methodOrder.indexOf(b[0]));

const unmatched = [
  ['POST', '/api/admin/bootstrap-profile', '未使用・保守', '現行フロントエンドからの参照なし'],
  ['GET', '/api/admin/notifications', '未使用・保守', '配信履歴取得API。現行画面はPOSTのみ使用'],
  ['GET / POST', '/api/admin/shifts/sync', '外部連携', 'Google Apps Script等からのシフト同期'],
  ['POST', '/api/admin/shifts/upload', '未使用・保守', '現行フロントエンドからの参照なし'],
  ['GET', '/api/admin/test-prep-events', '未使用・保守', '登録画面はPOSTのみ使用。GETの参照なし'],
  ['GET / POST / DELETE', '/api/admin/users', '未使用・保守', '現行画面は別のアカウントAPIを使用'],
  ['POST', '/api/camera-session-summary', '未使用・保守', '現行フロントエンドからの参照なし'],
  ['POST', '/api/create-user-from-gas', '外部連携', 'Google Apps Scriptから呼出し'],
  ['POST', '/api/join-zoom', '未使用・保守', '現行フロントエンドからの参照なし'],
  ['GET', '/api/line/callback', '外部コールバック', 'LINE OAuth認証後にLINE側から遷移'],
  ['POST', '/api/line/push', '未使用・保守', '現行通知画面は /api/admin/notifications を使用'],
  ['POST', '/api/notification-jobs', '未使用・保守', '現行フロントエンドからの参照なし'],
  ['POST', '/api/student/course-settings', '未使用・保守', '現行フロントエンドからの参照なし'],
  ['POST', '/api/teacher/award-points', '未使用・保守', '現行フロントエンドからの参照なし'],
  ['POST', '/api/teacher/students/bulk-zoom-url', '未使用・保守', '呼出し部品は存在するが、現行画面に配置されていない'],
  ['GET', '/api/zoom/recordings/sync', '定期処理', 'Vercel Cron等から実行。POSTは管理画面から実行'],
  ['POST', '/api/zoom/webhook', '外部Webhook', 'Zoomからイベント受信'],
];

const queryRows = [
  ['/api/admin/beta-analytics', 'days', '任意', '集計日数。既定30、7〜90に制限。/master/stats'],
  ['/api/admin/dedicated-claims', 'month', '任意', '対象月（YYYY-MM）。既定は当月。/master/attendance/dedicated-claims'],
  ['/api/admin/parent-inquiries', 'status', '任意', '状態絞込み。既定 all。/master/parent-inquiries'],
  ['/api/admin/school-students', 'school', '任意', 'masterのみ任意指定。その他は所属校舎。/master/school-students'],
  ['/api/admin/shifts/sync', 'secret, source_spreadsheet_id, source_sheet_name, start_date, end_date', '一部必須', 'start_date・end_date必須。secretはヘッダー代替可。外部連携'],
  ['/api/admin/test-prep-events', 'school', '任意', '対象校舎。未指定時は操作者の所属校舎。現行画面からGET参照なし'],
  ['/api/admin/users', 'role, school, limit', '任意', '一覧のロール・校舎・件数。現行画面からGET参照なし'],
  ['/api/attendance-corrections', 'scope, teacher_id, status, month, limit', '任意', '管理範囲、講師、状態、月、件数。既定limit=30（最大100）'],
  ['/api/attendance-diagnostics', 'scope, month', '任意', '管理/本人範囲と対象月'],
  ['/api/attendance-payroll', 'month, scope', '任意', '対象月と集計範囲。scopeは all または breakthrough'],
  ['/api/course-registration-options', 'grade, year', '任意', '学年と年度。未指定時はプロフィール学年・現在年度'],
  ['/api/curriculum-admin', 'year', '任意', '年度。未指定時は現在年。/master/curriculum'],
  ['/api/dedicated-attendance', 'month', '任意', '対象月（YYYY-MM）。既定は当月'],
  ['/api/eiken/dashboard', 'student_id', '任意', '保護者が対象生徒を切り替える場合に指定'],
  ['/api/eiken/students/[id]', 'course_id', '任意', '生徒詳細を講座単位で絞込み。URL中[id]はパスパラメータ'],
  ['/api/employee-lessons', 'month', '任意', '対象月（YYYY-MM）。既定は当月'],
  ['/api/line/auth', 'redirect, role, mode', 'redirect必須', 'LINE認証後の戻り先、ロール、JSON応答指定'],
  ['/api/line/callback', 'code, state, error', '条件必須', 'LINE OAuthが付与。成功時code/state、失敗時error'],
  ['/api/notifications', 'limit', '任意', '取得件数。既定30、最大100'],
  ['/api/parent/faq', 'mine', '任意', 'mine=1で本人の問い合わせ履歴を取得'],
  ['/api/student/ranking', 'limit', '任意', '取得件数。既定20、1〜50'],
  ['/api/student/today-classes', 'period, preview, beta_transfer', '任意', '時限、講師プレビュー、振替β表示の指定'],
  ['/api/student/transfer-options', 'absence_id, required_only', '任意', '欠席申請IDと振替必須分のみの絞込み'],
  ['/api/teacher/commuter-passes', 'teacher_id', '任意', '管理者が対象講師を指定。本人利用時は自UID'],
  ['/api/transport-fares', 'transport_type, from, to, provider, teacher_id', '前3項目必須', '交通種別・出発・到着は必須。経路提供元・講師は任意'],
  ['/api/transport-stations', 'transport_type, q, line', 'transport_type必須', '交通種別、駅名検索語、路線絞込み'],
  ['/api/zoom/recordings/file', 'shift_id, recording_id, token', '条件必須', 'shift_idまたはrecording_id。tokenはAuthorizationヘッダー代替可'],
  ['/api/zoom/recordings/sync', 'days, max_meetings, from, to', '任意', 'Cron同期範囲・最大件数。既定days=3、max_meetings=100'],
];

const body = [];
body.push(p('API・画面対応状況 回答資料', { style: 'Title', borderBottom: true }));
body.push(p('ClassBase　実装コード確認結果', { style: 'Subtitle' }));
body.push(richP([{ text: '作成日: ', bold: true }, { text: '2026年8月20日' }], { after: 20 }));
body.push(richP([{ text: '確認対象: ', bold: true }, { text: 'app/**/page.tsx、app/api/**/route.ts、画面から参照される共通コンポーネント・ライブラリ' }], { after: 20 }));
body.push(richP([{ text: '基準: ', bold: true }, { text: '資料記載ではなく、現在の実装コードを正本として照合' }], { after: 160 }));

body.push(p('回答要旨', { style: 'Heading1' }));
body.push(p('1. APIはすべて画面一覧の画面から実行されるか', { style: 'Heading2' }));
body.push(richP([{ text: '回答: ', bold: true, color: '9B1C1C' }, { text: 'いいえ。' }, { text: ' 全APIが画面から直接実行される構成ではありません。' }], { shade: 'FFF4F4', after: 120 }));
body.push(p('現行実装は106 APIルート・131 HTTPメソッドです。画面または画面から利用される共通部品に対応するもののほか、外部連携、OAuthコールバック、Webhook、定期処理、および現行画面から参照されていないAPIがあります。', { after: 100 }));
body.push(p('画面に対応するAPI操作: 111件（共通レイアウトによる自動記録1件を含む）／画面から直接実行されないAPI操作: 20件', { bold: true, color: '1F3A5F', shade: 'E8EEF5', before: 80, after: 100 }));

body.push(p('2. 画面とAPIの対応表', { style: 'Heading2' }));
body.push(p('「別紙A 画面・API対応表」に、HTTPメソッド単位で記載しています。画面自身の呼出しに加え、その画面が読み込む共通コンポーネント／ライブラリ経由の呼出しも対応ありとして扱っています。', { after: 100 }));

body.push(p('3. 画面と対応していないAPI', { style: 'Heading2' }));
body.push(p('「別紙B 画面非対応API」に20操作を記載しています。外部連携・コールバック・Webhook・定期処理と、現行フロントエンドから参照されていないAPIを分けています。', { after: 100 }));

body.push(p('4. GETメソッドのURLクエリ', { style: 'Heading2' }));
body.push(p('該当は28ルートです。「別紙C GET URLクエリ一覧」にパラメータ名、必須性、用途を記載しています。動的URLの [id]・[shiftId] はパスパラメータであり、URLクエリには含めていません。', { after: 100 }));

body.push(p('確認時の重要事項', { style: 'Heading1' }));
body.push(p('既存の「画面一覧表」（2026年8月13日版）は100画面ですが、現行コードは104画面です。次の4画面が追加されています。', { after: 60 }));
for (const item of [
  '専任勤怠（/teacher/attendance/dedicated）',
  '専任申請管理（/master/attendance/dedicated-claims）',
  '専任授業実績管理（/master/attendance/employee-lessons）',
  '給与集計（/master/attendance/payroll）',
]) body.push(p(item, { style: 'ListBullet', numId: 1, after: 80 }));
body.push(p('したがって、既存資料との突合せでは、上記4画面を画面一覧へ追記したうえで本対応表をご利用ください。', { color: '7A5A00', shade: 'FFF8E1', before: 80, after: 120 }));

body.push(p('判定方法と留意事項', { style: 'Heading1' }));
for (const item of [
  'APIルートは app/api/**/route.ts のexport済みHTTPメソッドを集計しました。',
  '画面対応は app/**/page.tsx からの直接参照と、importされた共通部品・ライブラリからの参照を追跡しました。',
  'Firestoreへのクライアント直接アクセスはAPIではないため、本表には含めていません。API記載がない画面でもデータ処理がないとは限りません。',
  '「現行画面から参照なし」は削除可を意味しません。外部利用・旧機能・将来機能の有無を確認してから廃止判断が必要です。',
]) body.push(p(item, { style: 'ListBullet', numId: 1, after: 80 }));

body.push(p('別紙A　画面・API対応表', { style: 'Heading1', pageBreakBefore: true }));
body.push(p(`画面または画面が読み込む共通部品から実行される ${mappingRows.length} API操作を記載します。`, { style: 'TableCitation' }));
body.push(table(['Method', 'APIパス', '対応画面URL／共通処理'], mappingRows, [1200, 3000, 5160], ['center', 'left', 'left']));

body.push(p('別紙B　画面非対応API', { style: 'Heading1', pageBreakBefore: true }));
body.push(p('外部システム等から実行されるもの、および現行フロントエンドから参照されていないものです。', { style: 'TableCitation' }));
body.push(table(['Method', 'APIパス', '区分', '判定・用途'], unmatched, [1200, 2750, 1500, 3910], ['center', 'left', 'center', 'left']));

body.push(p('別紙C　GET URLクエリ一覧', { style: 'Heading1', pageBreakBefore: true }));
body.push(p('リクエストURLから読み取るクエリのみを記載します。外部サービス向けURLを内部で生成する際のクエリは対象外です。', { style: 'TableCitation' }));
body.push(table(['GET APIパス', 'クエリ名', '必須性', '用途・既定値・対応画面'], queryRows, [2500, 2550, 1250, 3060], ['left', 'left', 'center', 'left']));

body.push(p('以上', { align: 'right', before: 240, after: 0 }));

const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:body>${body.join('')}<w:sectPr><w:headerReference w:type="default" r:id="rId4"/><w:footerReference w:type="default" r:id="rId5"/><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="708" w:footer="708" w:gutter="0"/><w:cols w:space="720"/><w:docGrid w:linePitch="360"/></w:sectPr></w:body></w:document>`;

const stylesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:eastAsia="Yu Gothic"/><w:sz w:val="22"/><w:szCs w:val="22"/><w:lang w:val="ja-JP" w:eastAsia="ja-JP"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="264" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/><w:pPr><w:spacing w:after="120" w:line="264" w:lineRule="auto"/></w:pPr></w:style>
<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:next w:val="Subtitle"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="0" w:after="80"/></w:pPr><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:eastAsia="Yu Gothic"/><w:b/><w:color w:val="0B2545"/><w:sz w:val="48"/><w:szCs w:val="48"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Subtitle"><w:name w:val="Subtitle"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="0" w:after="240"/></w:pPr><w:rPr><w:color w:val="555555"/><w:sz w:val="28"/><w:szCs w:val="28"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:keepLines/><w:spacing w:before="320" w:after="160"/></w:pPr><w:rPr><w:b/><w:color w:val="2E74B5"/><w:sz w:val="32"/><w:szCs w:val="32"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:keepLines/><w:spacing w:before="240" w:after="120"/></w:pPr><w:rPr><w:b/><w:color w:val="2E74B5"/><w:sz w:val="26"/><w:szCs w:val="26"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading3"><w:name w:val="heading 3"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="160" w:after="80"/></w:pPr><w:rPr><w:b/><w:color w:val="1F4D78"/><w:sz w:val="24"/><w:szCs w:val="24"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="ListBullet"><w:name w:val="List Bullet"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:spacing w:after="160" w:line="280" w:lineRule="auto"/></w:pPr></w:style>
<w:style w:type="paragraph" w:styleId="TableText"><w:name w:val="Table Text"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:after="0" w:line="220" w:lineRule="auto"/></w:pPr><w:rPr><w:sz w:val="18"/><w:szCs w:val="18"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="TableHeader"><w:name w:val="Table Header"/><w:basedOn w:val="TableText"/><w:pPr><w:keepNext/><w:spacing w:after="0" w:line="220" w:lineRule="auto"/></w:pPr><w:rPr><w:b/><w:color w:val="0B2545"/><w:sz w:val="18"/><w:szCs w:val="18"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="TableCitation"><w:name w:val="Table Citation"/><w:basedOn w:val="Normal"/><w:pPr><w:keepNext/><w:spacing w:before="80" w:after="80"/></w:pPr><w:rPr><w:color w:val="555555"/><w:sz w:val="20"/><w:szCs w:val="20"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Header"><w:name w:val="header"/><w:basedOn w:val="Normal"/><w:pPr><w:tabs><w:tab w:val="right" w:pos="9360"/></w:tabs><w:spacing w:after="0"/></w:pPr><w:rPr><w:color w:val="777777"/><w:sz w:val="18"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Footer"><w:name w:val="footer"/><w:basedOn w:val="Normal"/><w:pPr><w:jc w:val="right"/><w:spacing w:after="0"/></w:pPr><w:rPr><w:color w:val="777777"/><w:sz w:val="18"/></w:rPr></w:style>
<w:style w:type="table" w:styleId="TableGrid"><w:name w:val="Table Grid"/><w:tblPr><w:tblCellMar><w:top w:w="80" w:type="dxa"/><w:left w:w="120" w:type="dxa"/><w:bottom w:w="80" w:type="dxa"/><w:right w:w="120" w:type="dxa"/></w:tblCellMar></w:tblPr></w:style>
</w:styles>`;

const numberingXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:abstractNum w:abstractNumId="1"><w:multiLevelType w:val="singleLevel"/><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val="•"/><w:lvlJc w:val="left"/><w:pPr><w:tabs><w:tab w:val="num" w:pos="720"/></w:tabs><w:ind w:left="720" w:hanging="360"/><w:spacing w:after="160" w:line="280" w:lineRule="auto"/></w:pPr><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:eastAsia="Yu Gothic"/></w:rPr></w:lvl></w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="1"/></w:num></w:numbering>`;

const headerXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:hdr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">${p('ClassBase | API・画面対応状況', { style: 'Header' })}</w:hdr>`;
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
zip.file('docProps/core.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>API・画面対応状況 回答資料</dc:title><dc:subject>ClassBase API画面対応調査</dc:subject><dc:creator>ClassBase</dc:creator><cp:lastModifiedBy>ClassBase</cp:lastModifiedBy><dcterms:created xsi:type="dcterms:W3CDTF">2026-08-20T00:00:00Z</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">2026-08-20T00:00:00Z</dcterms:modified></cp:coreProperties>`);
zip.file('docProps/app.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"><Application>Microsoft Office Word</Application><DocSecurity>0</DocSecurity><ScaleCrop>false</ScaleCrop><Company>ClassBase</Company><AppVersion>16.0000</AppVersion></Properties>`);

const buffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, buffer);
console.log(JSON.stringify({ outputPath, bytes: buffer.length, mappingRows: mappingRows.length, unmatchedOperations: 20, queryRoutes: queryRows.length }, null, 2));
