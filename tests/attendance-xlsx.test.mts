import assert from 'node:assert/strict';
import test from 'node:test';
import JSZip from 'jszip';
import { parseRegularAttendanceXlsx } from '../lib/attendance-xlsx.ts';

test('self-closing empty cells do not shift a later attendance value into an earlier column', async () => {
  const headers = [
    'work_date', 'work_school_code', 'mas_school_school_name', 'school_code',
    'mas_school_1_school_name', 'staff_code', 'staff_name', 'staff_kbn',
    'course_code', 'course_name', 'work_code', 'work_name',
    '勤怠情報②_start_time', '勤怠情報②_end_time', '勤怠情報②_work_time',
  ];
  const columns = headers.map((_, index) => String.fromCharCode(65 + index));
  const headerCells = headers.map((value, index) =>
    `<c r="${columns[index]}1" t="inlineStr"><is><t>${value}</t></is></c>`
  ).join('');
  const zip = new JSZip();
  zip.file('xl/worksheets/sheet1.xml', [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>',
    `<row r="1">${headerCells}</row>`,
    '<row r="2">',
    '<c r="A2" t="inlineStr"><is><t>2026-09-25</t></is></c>',
    '<c r="F2" t="inlineStr"><is><t>00123456</t></is></c>',
    '<c r="G2" t="inlineStr"><is><t>山田太郎</t></is></c>',
    '<c r="K2" t="inlineStr"/>',
    '<c r="L2" t="inlineStr"/>',
    '<c r="M2" t="inlineStr"><is><t>16:00</t></is></c>',
    '<c r="N2" t="inlineStr"><is><t>17:10</t></is></c>',
    '<c r="O2"><v>70</v></c>',
    '</row></sheetData></worksheet>',
  ].join(''));

  const parsed = await parseRegularAttendanceXlsx(await zip.generateAsync({ type: 'nodebuffer' }));

  assert.deepEqual(parsed.errors, []);
  assert.equal(parsed.data.length, 1);
  assert.equal(parsed.data[0].work_code, '');
  assert.equal(parsed.data[0].start_time, '16:00');
  assert.equal(parsed.data[0].end_time, '17:10');
  assert.equal(parsed.data[0].actual_minutes, 70);
});
