import JSZip from 'jszip';
import { parseRegularAttendanceRows } from './attendance-payroll.ts';

const MAX_SHEET_XML_BYTES = 80 * 1024 * 1024;
const MAX_SHARED_STRINGS_BYTES = 8 * 1024 * 1024;
const MAX_XLSX_ROWS = 100_000;
const MAX_ARCHIVE_UNCOMPRESSED_BYTES = 100 * 1024 * 1024;

function validateArchiveSizes(input: Buffer | Uint8Array) {
  const buffer = Buffer.from(input);
  const minimumOffset = Math.max(0, buffer.length - 65_557);
  let endOffset = -1;
  for (let offset = buffer.length - 22; offset >= minimumOffset; offset -= 1) {
    if (buffer.readUInt32LE(offset) === 0x06054b50) { endOffset = offset; break; }
  }
  if (endOffset < 0) throw new Error('ExcelファイルのZIP構造が不正です。');
  const entries = buffer.readUInt16LE(endOffset + 10);
  let offset = buffer.readUInt32LE(endOffset + 16);
  let totalSize = 0;
  for (let index = 0; index < entries; index += 1) {
    if (offset + 46 > buffer.length || buffer.readUInt32LE(offset) !== 0x02014b50) throw new Error('ExcelファイルのZIP構造が不正です。');
    const uncompressedSize = buffer.readUInt32LE(offset + 24);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const name = buffer.subarray(offset + 46, offset + 46 + nameLength).toString('utf8');
    totalSize += uncompressedSize;
    if (/^xl\/worksheets\/sheet\d+\.xml$/i.test(name) && uncompressedSize > MAX_SHEET_XML_BYTES) throw new Error('Excelのデータ量が上限を超えています。');
    if (/^xl\/sharedStrings\.xml$/i.test(name) && uncompressedSize > MAX_SHARED_STRINGS_BYTES) throw new Error('Excelの文字列データ量が上限を超えています。');
    offset += 46 + nameLength + extraLength + commentLength;
  }
  if (totalSize > MAX_ARCHIVE_UNCOMPRESSED_BYTES) throw new Error('Excelの展開後データ量が上限を超えています。');
}

function decodeXml(value: string) {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&amp;/g, '&');
}

function columnIndex(reference: string) {
  const letters = reference.match(/^[A-Z]+/i)?.[0]?.toUpperCase() || '';
  let result = 0;
  for (const letter of letters) result = result * 26 + letter.charCodeAt(0) - 64;
  return result - 1;
}

function sharedStringsFromXml(xml: string) {
  return Array.from(xml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g), match =>
    decodeXml(Array.from(match[1].matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g), text => text[1]).join(''))
  );
}

function rowsFromSheetXml(xml: string, sharedStrings: string[]) {
  const rows: string[][] = [];
  for (const rowMatch of xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
    if (rows.length >= MAX_XLSX_ROWS + 1) throw new Error(`Excelの行数は${MAX_XLSX_ROWS.toLocaleString()}行以下にしてください。`);
    const row: string[] = [];
    for (const cellMatch of rowMatch[1].matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/g)) {
      const reference = cellMatch[1].match(/\br="([A-Z]+\d+)"/i)?.[1] || '';
      const index = columnIndex(reference);
      if (index < 0 || index > 500) continue;
      const type = cellMatch[1].match(/\bt="([^"]+)"/)?.[1] || '';
      const rawValue = cellMatch[2].match(/<v>([\s\S]*?)<\/v>/)?.[1] || '';
      const inline = Array.from(cellMatch[2].matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g), text => text[1]).join('');
      row[index] = type === 's'
        ? String(sharedStrings[Number(rawValue)] ?? '')
        : decodeXml(type === 'inlineStr' ? inline : rawValue);
    }
    rows.push(row);
  }
  return rows;
}

export async function parseRegularAttendanceXlsx(buffer: Buffer | Uint8Array) {
  validateArchiveSizes(buffer);
  const zip = await JSZip.loadAsync(buffer, { checkCRC32: true });
  if (Object.keys(zip.files).some(name => /vbaProject|externalLinks/i.test(name))) {
    throw new Error('マクロまたは外部リンクを含むExcelは取り込めません。');
  }

  const worksheetName = Object.keys(zip.files)
    .filter(name => /^xl\/worksheets\/sheet\d+\.xml$/i.test(name))
    .sort((left, right) => left.localeCompare(right, undefined, { numeric: true }))[0];
  if (!worksheetName) throw new Error('Excel内に読み取れるワークシートがありません。');

  const worksheetEntry = zip.file(worksheetName);
  const sharedStringsEntry = zip.file('xl/sharedStrings.xml');
  if (!worksheetEntry) throw new Error('Excelのワークシートを読み取れません。');

  const [sheetXml, sharedStringsXml] = await Promise.all([
    worksheetEntry.async('string'),
    sharedStringsEntry?.async('string') || Promise.resolve(''),
  ]);
  if (Buffer.byteLength(sheetXml, 'utf8') > MAX_SHEET_XML_BYTES) throw new Error('Excelのデータ量が上限を超えています。');
  if (Buffer.byteLength(sharedStringsXml, 'utf8') > MAX_SHARED_STRINGS_BYTES) throw new Error('Excelの文字列データ量が上限を超えています。');
  const sharedStrings = sharedStringsFromXml(sharedStringsXml);
  return parseRegularAttendanceRows(rowsFromSheetXml(sheetXml, sharedStrings));
}
