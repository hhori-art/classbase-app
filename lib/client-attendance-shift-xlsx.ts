'use client';

import {
  addDateDays,
  SHIFT_CATEGORY_LABELS,
  type AttendanceShiftCategory,
  type AttendanceShiftPlan,
} from '@/lib/attendance-shift-plan';
import {
  shiftResourceLabel,
  WEEKLY_SHIFT_EXPORT_HEADERS,
  weeklyShiftExportRows,
} from '@/lib/attendance-shift-weekly';

const xml = (value: unknown) => String(value ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&apos;');

const columnName = (index: number) => {
  let value = index + 1;
  let name = '';
  while (value > 0) {
    name = String.fromCharCode(65 + ((value - 1) % 26)) + name;
    value = Math.floor((value - 1) / 26);
  }
  return name;
};

const weekdayLabel = (date: string) => new Date(`${date}T00:00:00+09:00`).toLocaleDateString('ja-JP', {
  month: 'numeric', day: 'numeric', weekday: 'short',
});

const worksheet = (rows: unknown[][], options: {
  widths: number[];
  headerRow: number;
  freezeRows: number;
  board?: boolean;
  autoFilter?: string;
}) => {
  const sheetRows = rows.map((row, rowIndex) => {
    const cells = row.map((value, columnIndex) => {
      const reference = `${columnName(columnIndex)}${rowIndex + 1}`;
      const style = rowIndex === 0 ? 2 : rowIndex === options.headerRow ? 1 : options.board ? 3 : 0;
      return `<c r="${reference}" t="inlineStr" s="${style}"><is><t xml:space="preserve">${xml(value)}</t></is></c>`;
    }).join('');
    return `<row r="${rowIndex + 1}"${options.board && rowIndex > options.headerRow ? ' ht="72" customHeight="1"' : ''}>${cells}</row>`;
  }).join('');
  const columns = options.widths.map((width, index) => `<col min="${index + 1}" max="${index + 1}" width="${width}" customWidth="1"/>`).join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="${options.freezeRows}" topLeftCell="A${options.freezeRows + 1}" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols>${columns}</cols><sheetData>${sheetRows}</sheetData>${options.board ? '<mergeCells count="1"><mergeCell ref="A1:H1"/></mergeCells>' : ''}${options.autoFilter ? `<autoFilter ref="${options.autoFilter}"/>` : ''}<pageSetup orientation="landscape" paperSize="9" fitToWidth="1" fitToHeight="0"/></worksheet>`;
};

const boardCell = (shift: AttendanceShiftPlan, category: AttendanceShiftCategory) => {
  const detail = category === 'group'
    ? [shift.grade, shift.subject, shift.title].filter(Boolean).join('・')
    : category === 'individual'
      ? (shift.student_names || []).join('・') || '生徒未割当'
      : shift.title || '事務';
  return `${shift.start}–${shift.end} ${shift.teacher_name}${detail ? `\n${detail}` : ''}`;
};

export async function downloadWeeklyShiftWorkbook(input: {
  schoolName: string;
  start: string;
  end: string;
  category: AttendanceShiftCategory;
  shifts: AttendanceShiftPlan[];
}) {
  const { default: JSZip } = await import('jszip');
  const days = Array.from({ length: 7 }, (_, index) => addDateDays(input.start, index));
  const resources = Array.from(new Set(input.shifts.map(shiftResourceLabel))).sort((left, right) => left.localeCompare(right, 'ja', { numeric: true }));
  if (!resources.length) resources.push('未割当');
  const resourceName = input.category === 'group' ? '教室' : input.category === 'individual' ? 'ブース' : '業務場所';
  const boardRows: unknown[][] = [
    [`${input.schoolName} ${SHIFT_CATEGORY_LABELS[input.category]}・週次シフト（${input.start}〜${input.end}）`],
    [resourceName, ...days.map(weekdayLabel)],
    ...resources.map(resource => [resource, ...days.map(day => input.shifts
      .filter(shift => shift.date === day && shiftResourceLabel(shift) === resource)
      .sort((left, right) => left.start.localeCompare(right.start))
      .map(shift => boardCell(shift, input.category))
      .join('\n\n'))]),
  ];
  const dataRows: unknown[][] = [
    [`${input.schoolName} 週次シフトデータ`, `${input.start}〜${input.end}`],
    [...WEEKLY_SHIFT_EXPORT_HEADERS],
    ...weeklyShiftExportRows(input.shifts),
  ];
  const zip = new JSZip();
  zip.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`);
  zip.folder('_rels')?.file('.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`);
  zip.folder('xl')?.file('workbook.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="週次配置表" sheetId="1" r:id="rId1"/><sheet name="データ一覧" sheetId="2" r:id="rId2"/></sheets></workbook>`);
  zip.folder('xl')?.folder('_rels')?.file('workbook.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`);
  zip.folder('xl')?.file('styles.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="3"><font><sz val="10"/><name val="Yu Gothic"/></font><font><b/><color rgb="FFFFFFFF"/><sz val="10"/><name val="Yu Gothic"/></font><font><b/><sz val="14"/><name val="Yu Gothic"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF4F46E5"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="2"><border/><border><left style="thin"/><right style="thin"/><top style="thin"/><bottom style="thin"/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="4"><xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1"/><xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf><xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/><xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1"><alignment vertical="top" wrapText="1"/></xf></cellXfs></styleSheet>`);
  const sheets = zip.folder('xl')?.folder('worksheets');
  sheets?.file('sheet1.xml', worksheet(boardRows, { widths: [15, 24, 24, 24, 24, 24, 24, 24], headerRow: 1, freezeRows: 2, board: true }));
  sheets?.file('sheet2.xml', worksheet(dataRows, { widths: [13, 8, 18, 9, 9, 10, 18, 18, 24, 24, 10, 12, 18, 10, 10, 18, 24, 10], headerRow: 1, freezeRows: 2, autoFilter: `A2:R${Math.max(dataRows.length, 2)}` }));
  const blob = await zip.generateAsync({ type: 'blob', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `週次シフト_${input.start}_${input.end}.xlsx`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
