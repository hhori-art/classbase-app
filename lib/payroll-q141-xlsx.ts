import JSZip from 'jszip';
import type { IntegratedPayrollRow } from './attendance-integrated-payroll.ts';

type CellValue = string | number | { formula: string; value: number };

const escapeXml = (value: unknown) => String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const columnName = (index: number) => {
  let value = index + 1;
  let result = '';
  while (value > 0) { value -= 1; result = String.fromCharCode(65 + value % 26) + result; value = Math.floor(value / 26); }
  return result;
};
const sheetXml = (rows: CellValue[][], widths: number[] = []) => {
  const body = rows.map((row, rowIndex) => `<row r="${rowIndex + 1}"${rowIndex === 0 ? ' ht="34" customHeight="1"' : ''}>${row.map((value, columnIndex) => {
    const ref = `${columnName(columnIndex)}${rowIndex + 1}`;
    const style = rowIndex === 0 ? 1 : typeof value === 'number' || typeof value === 'object' ? 2 : 3;
    if (typeof value === 'object') return `<c r="${ref}" s="${style}"><f>${escapeXml(value.formula)}</f><v>${value.value}</v></c>`;
    if (typeof value === 'number') return `<c r="${ref}" s="${style}" t="n"><v>${value}</v></c>`;
    return `<c r="${ref}" s="${style}" t="inlineStr"><is><t xml:space="preserve">${escapeXml(value)}</t></is></c>`;
  }).join('')}</row>`).join('');
  const cols = widths.length ? `<cols>${widths.map((width, index) => `<col min="${index + 1}" max="${index + 1}" width="${width}" customWidth="1"/>`).join('')}</cols>` : '';
  const last = `${columnName(Math.max(0, rows.reduce((max, row) => Math.max(max, row.length), 0) - 1))}${Math.max(1, rows.length)}`;
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><dimension ref="A1:${last}"/><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>${cols}<sheetData>${body}</sheetData><autoFilter ref="A1:${columnName(rows[0].length - 1)}${rows.length}"/></worksheet>`;
};

const Q141_HEADERS = [
  '支給年月', '所属法人区分', '所属法人区分名', '創学区分', '創学区分名', '創学講師区分', '創学講師区分名', '研修区分', '研修区分名',
  '所属教室番号', '所属教室名', '職員コード', '職員氏名', '特別勤務手当１', '特別勤務手当２', '特別勤務手当３', '特別勤務手当４', '特別勤務手当合計',
  '集団授業時間', '集団授業手当', 'メンター時間', 'メンター手当', '研修時間', '研修手当', '割増研修1時間', '割増研修1手当', '割増研修2時間', '割増研修2手当',
  '事務時間', '事務手当', '割増事務1時間', '割増事務1手当', '割増事務2時間', '割増事務2手当', '付随時間', '付随手当', '割増付随1時間', '割増付随1手当', '割増付随2時間', '割増付随2手当',
  '創学授業時間(分)', '創学授業手当', 'サブスタッフ時間', 'サブスタッフ手当', '個別授業時間', '個別授業時間1', '個別授業時間2', '個別授業時間3', '個別授業時間4', '個別授業時間5', '個別授業時間6', '個別授業手当',
  'AC自習室時間', 'AC自習室手当', '個別ﾁｭｰﾀｰ時間', '個別ﾁｭｰﾀｰ手当', '移動交通費', '総支給額_課税_FIX', '総支給額_非課税_FIX',
];

function q141Row(month: string, row: IntegratedPayrollRow): CellValue[] {
  const q = row.q141;
  const trainingMinutes = q.training_1.minutes;
  const trainingAmount = q.training_1.amount;
  const individualMinutes = q.individual_1.minutes + q.individual_2.minutes + q.individual_3.minutes + q.individual_4.minutes + q.individual_5.minutes + q.individual_6.minutes;
  const individualAmount = q.individual_1.amount + q.individual_2.amount + q.individual_3.amount + q.individual_4.amount + q.individual_5.amount + q.individual_6.amount;
  return [
    month.replace('-', ''), 0, '創造学園', 0, 'EDIC', 0, '一般', 0, '準専任', row.school_code, row.school_name, row.person_code, row.person_name,
    q.special_1, q.special_2, q.special_3, q.special_4, q.special_1 + q.special_2 + q.special_3 + q.special_4,
    q.group_lesson.minutes, q.group_lesson.amount, q.mentor.minutes, q.mentor.amount, trainingMinutes, trainingAmount,
    q.training_2.minutes, q.training_2.amount, q.training_3.minutes, q.training_3.amount,
    q.office.minutes, q.office.amount, q.office_premium_1.minutes, q.office_premium_1.amount, q.office_premium_2.minutes, q.office_premium_2.amount,
    q.incidental.minutes, q.incidental.amount, q.incidental_premium_1.minutes, q.incidental_premium_1.amount, q.incidental_premium_2.minutes, q.incidental_premium_2.amount,
    q.sogaku_lesson.minutes, q.sogaku_lesson.amount, q.sub_staff.minutes, q.sub_staff.amount,
    individualMinutes, q.individual_1.minutes, q.individual_2.minutes, q.individual_3.minutes, q.individual_4.minutes, q.individual_5.minutes, q.individual_6.minutes, individualAmount,
    q.ac_study.minutes, q.ac_study.amount, q.private_tutor.minutes, q.private_tutor.amount, q.transportation, q.taxable_total, q.nontaxable_total,
  ];
}

function flowRow(month: string, row: IntegratedPayrollRow): CellValue[] {
  const q = row.q141;
  const other2 = q.mentor.amount + q.training_2.amount + q.training_3.amount + q.office_premium_1.amount + q.office_premium_2.amount + q.sub_staff.amount + q.ac_study.amount + q.private_tutor.amount;
  const individualAmount = q.individual_1.amount + q.individual_2.amount + q.individual_3.amount + q.individual_4.amount + q.individual_5.amount + q.individual_6.amount;
  return [month.replace('-', ''), row.person_code, row.person_name, q.group_lesson.minutes, q.training_1.minutes, q.office.minutes, q.sogaku_lesson.minutes,
    q.individual_1.minutes, q.individual_2.minutes, q.individual_3.minutes, q.individual_4.minutes, q.individual_5.minutes, q.individual_6.minutes,
    q.mentor.amount, q.training_2.amount, q.training_3.amount, q.office_premium_1.amount, q.office_premium_2.amount, q.sub_staff.amount, q.ac_study.amount, q.private_tutor.amount,
    other2, individualAmount, '', q.transportation, '', q.special_1 + q.special_2 + q.special_3 + q.special_4, '', q.taxable_total, '', q.nontaxable_total, '', row.school_code, row.school_name];
}

export async function buildQ141PayrollWorkbook(month: string, rows: IntegratedPayrollRow[]) {
  const sortedTp = [...rows].sort((a, b) => Number(a.tp_serial || Number.MAX_SAFE_INTEGER) - Number(b.tp_serial || Number.MAX_SAFE_INTEGER) || a.person_code.localeCompare(b.person_code, undefined, { numeric: true }));
  const q141Rows = [Q141_HEADERS, ...rows.map(row => q141Row(month, row))];
  const flowHeaders = ['支給年月', '職員コード', '職員氏名', '集団授業時間', '研修時間', '事務時間', '創学授業時間(分)', '個別1:1', '個別1:2', '個別1:3', '中高1:1', '中高1:2', '中高1:3', 'メンター手当', '割増研修1手当', '割増研修2手当', '割増事務1手当', '割増事務2手当', 'ｻﾌﾞ手当', 'AC自習室手当', '個別ﾁｭｰﾀｰ手当', 'ﾀｲﾑﾌﾟﾛその他2', '1759', '', '56', '', '1760', '', '57', '', '総支給額_非課税_FIX', '', '所属教室番号', '所属教室名'];
  const flowRows = [flowHeaders, ...rows.map(row => flowRow(month, row))];
  const tpHeaders = ['個人コード', '氏名', '集団時間数', '研修時間数', '事務時間数', '創学授業分', '個別1:1', '個別1:2', '個別1:3', '中高1:1', '中高1:2', '中高1:3', 'その他2', 'その他3', '変非課税通', '', '', '個人コード', '氏名', '特別勤務'];
  const tpRows: CellValue[][] = [tpHeaders, ...sortedTp.map(row => {
    const flow = flowRow(month, row);
    const individualAmount = row.q141.individual_1.amount + row.q141.individual_2.amount + row.q141.individual_3.amount + row.q141.individual_4.amount + row.q141.individual_5.amount + row.q141.individual_6.amount;
    return [row.person_code, row.person_name, ...flow.slice(3, 13), flow[21], individualAmount, row.q141.nontaxable_total, '', '', row.person_code, row.person_name, row.q141.special_1 + row.q141.special_2 + row.q141.special_3 + row.q141.special_4];
  })];
  const checkRows: CellValue[][] = [['個人ｺｰﾄﾞ', '氏名', 'その他４', '立替金等', '総支給額', 'ﾁｴｯｸ', '1873', '', '95非課税'], ...sortedTp.map((row, index) => {
    const excelRow = index + 2;
    return [row.person_code, row.person_name, row.q141.special_4, 0, row.gross_payment, { formula: `E${excelRow}-H${excelRow}-I${excelRow}-C${excelRow}-D${excelRow}`, value: 0 }, '', row.q141.taxable_total - row.q141.special_4, row.q141.nontaxable_total];
  })];

  const zip = new JSZip();
  zip.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${[1,2,3,4].map(index => `<Override PartName="/xl/worksheets/sheet${index}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>`);
  zip.folder('_rels')?.file('.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`);
  zip.folder('xl')?.file('workbook.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="01_給与計算結果_Q141" sheetId="1" r:id="rId1"/><sheet name="02_TP取込データ" sheetId="2" r:id="rId2"/><sheet name="03_TP並替データ" sheetId="3" r:id="rId3"/><sheet name="04_金額照合" sheetId="4" r:id="rId4"/></sheets><calcPr calcId="191029" fullCalcOnLoad="1"/></workbook>`);
  zip.folder('xl')?.folder('_rels')?.file('workbook.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${[1,2,3,4].map(index => `<Relationship Id="rId${index}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index}.xml"/>`).join('')}<Relationship Id="rId5" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`);
  zip.folder('xl')?.file('styles.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="10"/><name val="Meiryo"/></font><font><b/><color rgb="FFFFFFFF"/><sz val="10"/><name val="Meiryo"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF1E3A5F"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="2"><border/><border><left style="thin"/><right style="thin"/><top style="thin"/><bottom style="thin"/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="4"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf><xf numFmtId="3" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1"><alignment horizontal="right"/></xf><xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyAlignment="1"><alignment vertical="center"/></xf></cellXfs></styleSheet>`);
  const sheetFolder = zip.folder('xl')?.folder('worksheets');
  sheetFolder?.file('sheet1.xml', sheetXml(q141Rows, Q141_HEADERS.map((_, index) => index === 10 || index === 12 ? 20 : index === 11 ? 13 : 12)));
  sheetFolder?.file('sheet2.xml', sheetXml(flowRows, flowHeaders.map((_, index) => index === 2 || index === 33 ? 20 : 13)));
  sheetFolder?.file('sheet3.xml', sheetXml(tpRows, tpHeaders.map((_, index) => index === 1 || index === 18 ? 20 : 13)));
  sheetFolder?.file('sheet4.xml', sheetXml(checkRows, [13, 20, 13, 13, 15, 13, 13, 15, 15]));
  return zip.generateAsync({ type: 'blob', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', compression: 'DEFLATE' });
}
