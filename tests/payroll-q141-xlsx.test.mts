import assert from 'node:assert/strict';
import test from 'node:test';
import JSZip from 'jszip';
import { buildQ141PayrollWorkbook } from '../lib/payroll-q141-xlsx.ts';

test('Q141 workbook contains a complete style table and valid sheet style references', async () => {
  const blob = await buildQ141PayrollWorkbook('2026-08', []);
  const zip = await JSZip.loadAsync(await blob.arrayBuffer());
  const styles = await zip.file('xl/styles.xml')?.async('string');

  assert.ok(styles, 'styles.xml must exist');
  assert.match(styles, /<fills count="3">[\s\S]*<\/fills><borders count="2">/);

  for (const tag of ['styleSheet', 'fonts', 'fills', 'borders', 'cellStyleXfs', 'cellXfs']) {
    assert.equal((styles.match(new RegExp(`<${tag}(?:\\s|>)`, 'g')) || []).length, 1, `${tag} must open once`);
    assert.equal((styles.match(new RegExp(`<\\/${tag}>`, 'g')) || []).length, 1, `${tag} must close once`);
  }

  const cellXfs = styles.match(/<cellXfs count="(\d+)">([\s\S]*?)<\/cellXfs>/);
  assert.ok(cellXfs, 'cellXfs must exist');
  const styleCount = Number(cellXfs[1]);
  assert.equal((cellXfs[2].match(/<xf(?:\s|>)/g) || []).length, styleCount);

  for (let index = 1; index <= 4; index += 1) {
    const sheet = await zip.file(`xl/worksheets/sheet${index}.xml`)?.async('string');
    assert.ok(sheet, `sheet${index}.xml must exist`);
    for (const match of sheet.matchAll(/<c\b[^>]*\bs="(\d+)"/g)) {
      assert.ok(Number(match[1]) < styleCount, `sheet${index} references missing style ${match[1]}`);
    }
  }
});
