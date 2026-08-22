import {
  normalizePayrollName,
  normalizePersonCode,
  resolveLegacyLessonRates,
  type PayrollRateMaster,
} from './attendance-payroll.ts';

const FREE_SECTOR = 0xffffffff;
const END_OF_CHAIN = 0xfffffffe;
const FAT_SECTOR = 0xfffffffd;
const MAX_XLS_BYTES = 12 * 1024 * 1024;
const MAX_STREAM_BYTES = 32 * 1024 * 1024;

type BiffCell = string | number;

function assertRange(buffer: Buffer, offset: number, length: number) {
  if (offset < 0 || length < 0 || offset + length > buffer.length) throw new Error('Excelファイルの構造が不正です。');
}

function sector(buffer: Buffer, sectorId: number, sectorSize: number) {
  const offset = (sectorId + 1) * sectorSize;
  assertRange(buffer, offset, sectorSize);
  return buffer.subarray(offset, offset + sectorSize);
}

function sectorChain(start: number, fat: number[], maxSectors: number) {
  const result: number[] = [];
  const visited = new Set<number>();
  let current = start >>> 0;
  while (current !== END_OF_CHAIN && current !== FREE_SECTOR) {
    if (current >= fat.length || visited.has(current) || result.length >= maxSectors) throw new Error('Excelファイルのセクターチェーンが不正です。');
    visited.add(current);
    result.push(current);
    current = fat[current] >>> 0;
  }
  return result;
}

function workbookStream(input: Buffer) {
  if (input.length > MAX_XLS_BYTES) throw new Error('旧Excelファイルは12MB以下にしてください。');
  assertRange(input, 0, 512);
  if (!input.subarray(0, 8).equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]))) throw new Error('旧Excel（.xls）形式ではありません。');
  const sectorSize = 1 << input.readUInt16LE(30);
  if (![512, 4096].includes(sectorSize)) throw new Error('未対応のExcelセクターサイズです。');
  const sectorCount = Math.floor(input.length / sectorSize) - 1;
  const fatSectorIds: number[] = [];
  for (let index = 0; index < 109; index += 1) {
    const id = input.readUInt32LE(76 + index * 4);
    if (id !== FREE_SECTOR) fatSectorIds.push(id);
  }
  let difatSectorId = input.readUInt32LE(68);
  const difatSectorCount = input.readUInt32LE(72);
  for (let count = 0; count < difatSectorCount && difatSectorId !== END_OF_CHAIN; count += 1) {
    const data = sector(input, difatSectorId, sectorSize);
    for (let offset = 0; offset < sectorSize - 4; offset += 4) {
      const id = data.readUInt32LE(offset);
      if (id !== FREE_SECTOR) fatSectorIds.push(id);
    }
    difatSectorId = data.readUInt32LE(sectorSize - 4);
  }
  const fat: number[] = [];
  fatSectorIds.forEach(id => {
    if (id >= sectorCount) throw new Error('ExcelファイルのFATが不正です。');
    const data = sector(input, id, sectorSize);
    for (let offset = 0; offset < sectorSize; offset += 4) fat.push(data.readUInt32LE(offset));
  });
  const directoryStart = input.readUInt32LE(48);
  const directory = Buffer.concat(sectorChain(directoryStart, fat, sectorCount).map(id => sector(input, id, sectorSize)));
  let streamStart = -1;
  let streamSize = 0;
  for (let offset = 0; offset + 128 <= directory.length; offset += 128) {
    const nameLength = directory.readUInt16LE(offset + 64);
    if (nameLength < 2 || nameLength > 64) continue;
    const name = directory.subarray(offset, offset + nameLength - 2).toString('utf16le');
    if (!['Workbook', 'Book'].includes(name)) continue;
    streamStart = directory.readUInt32LE(offset + 116);
    streamSize = Number(directory.readBigUInt64LE(offset + 120));
    break;
  }
  if (streamStart < 0 || streamSize <= 0 || streamSize > MAX_STREAM_BYTES) throw new Error('ExcelのWorkbookストリームを読み取れません。');
  const stream = Buffer.concat(sectorChain(streamStart, fat, sectorCount).map(id => sector(input, id, sectorSize)));
  return stream.subarray(0, streamSize);
}

function records(stream: Buffer) {
  const result: Array<{ id: number; offset: number; data: Buffer }> = [];
  for (let offset = 0; offset + 4 <= stream.length;) {
    const id = stream.readUInt16LE(offset);
    const length = stream.readUInt16LE(offset + 2);
    if (offset + 4 + length > stream.length) throw new Error('ExcelのBIFFレコードが不正です。');
    result.push({ id, offset, data: stream.subarray(offset + 4, offset + 4 + length) });
    offset += 4 + length;
  }
  return result;
}

class ChunkReader {
  private chunk = 0;
  private offset = 0;
  private readonly chunks: Buffer[];
  constructor(chunks: Buffer[]) { this.chunks = chunks; }
  private advance() {
    while (this.chunk < this.chunks.length && this.offset >= this.chunks[this.chunk].length) { this.chunk += 1; this.offset = 0; }
    if (this.chunk >= this.chunks.length) throw new Error('Excelの共有文字列が途中で終了しています。');
  }
  read(length: number) {
    const parts: Buffer[] = [];
    let remaining = length;
    while (remaining > 0) {
      this.advance();
      const available = Math.min(remaining, this.chunks[this.chunk].length - this.offset);
      parts.push(this.chunks[this.chunk].subarray(this.offset, this.offset + available));
      this.offset += available;
      remaining -= available;
    }
    return Buffer.concat(parts);
  }
  uint8() { return this.read(1).readUInt8(0); }
  uint16() { return this.read(2).readUInt16LE(0); }
  uint32() { return this.read(4).readUInt32LE(0); }
  readCharacters(count: number, initialWide: boolean) {
    let wide = initialWide;
    let result = '';
    for (let index = 0; index < count;) {
      if (this.offset >= this.chunks[this.chunk].length) {
        this.chunk += 1;
        this.offset = 0;
        if (this.chunk >= this.chunks.length) throw new Error('Excelの共有文字列が途中で終了しています。');
        wide = Boolean(this.uint8() & 1);
      }
      const width = wide ? 2 : 1;
      const availableCharacters = Math.floor((this.chunks[this.chunk].length - this.offset) / width);
      if (availableCharacters <= 0) { this.offset = this.chunks[this.chunk].length; continue; }
      const take = Math.min(count - index, availableCharacters);
      const bytes = this.read(take * width);
      result += bytes.toString(wide ? 'utf16le' : 'latin1');
      index += take;
    }
    return result;
  }
}

function sharedStrings(allRecords: ReturnType<typeof records>) {
  const index = allRecords.findIndex(record => record.id === 0x00fc);
  if (index < 0) return [];
  const chunks = [allRecords[index].data];
  for (let cursor = index + 1; cursor < allRecords.length && allRecords[cursor].id === 0x003c; cursor += 1) chunks.push(allRecords[cursor].data);
  const reader = new ChunkReader(chunks);
  reader.uint32();
  const uniqueCount = reader.uint32();
  if (uniqueCount > 1_000_000) throw new Error('Excelの共有文字列数が上限を超えています。');
  const values: string[] = [];
  for (let index = 0; index < uniqueCount; index += 1) {
    const characterCount = reader.uint16();
    const flags = reader.uint8();
    const richRuns = flags & 0x08 ? reader.uint16() : 0;
    const extensionSize = flags & 0x04 ? reader.uint32() : 0;
    values.push(reader.readCharacters(characterCount, Boolean(flags & 0x01)));
    if (richRuns) reader.read(richRuns * 4);
    if (extensionSize) reader.read(extensionSize);
  }
  return values;
}

function decodeRk(raw: number) {
  const divided = Boolean(raw & 1);
  let value: number;
  if (raw & 2) value = raw >> 2;
  else {
    const bytes = Buffer.alloc(8);
    bytes.writeUInt32LE(raw & 0xfffffffc, 4);
    value = bytes.readDoubleLE(0);
  }
  return divided ? value / 100 : value;
}

function sheetName(data: Buffer) {
  if (data.length < 8) return '';
  const length = data.readUInt8(6);
  const wide = Boolean(data.readUInt8(7) & 1);
  return data.subarray(8, 8 + length * (wide ? 2 : 1)).toString(wide ? 'utf16le' : 'latin1');
}

function sheetRows(stream: Buffer, targetSheet: string) {
  const allRecords = records(stream);
  const strings = sharedStrings(allRecords);
  const boundSheet = allRecords.find(record => record.id === 0x0085 && sheetName(record.data).trim() === targetSheet.trim());
  if (!boundSheet || boundSheet.data.length < 8) throw new Error(`「${targetSheet}」シートが見つかりません。`);
  const sheetOffset = boundSheet.data.readUInt32LE(0);
  const startIndex = allRecords.findIndex(record => record.offset === sheetOffset);
  if (startIndex < 0) throw new Error(`「${targetSheet}」シートを読み取れません。`);
  const rows = new Map<number, Map<number, BiffCell>>();
  const setCell = (row: number, column: number, value: BiffCell) => {
    if (row > 100_000 || column > 500) throw new Error('Excelの行列数が上限を超えています。');
    const cells = rows.get(row) || new Map<number, BiffCell>();
    cells.set(column, value);
    rows.set(row, cells);
  };
  for (let index = startIndex + 1; index < allRecords.length; index += 1) {
    const { id, data } = allRecords[index];
    if (id === 0x000a) break;
    if (id === 0x00fd && data.length >= 10) setCell(data.readUInt16LE(0), data.readUInt16LE(2), strings[data.readUInt32LE(6)] || '');
    else if (id === 0x0203 && data.length >= 14) setCell(data.readUInt16LE(0), data.readUInt16LE(2), data.readDoubleLE(6));
    else if (id === 0x027e && data.length >= 10) setCell(data.readUInt16LE(0), data.readUInt16LE(2), decodeRk(data.readUInt32LE(6)));
    else if (id === 0x00bd && data.length >= 12) {
      const row = data.readUInt16LE(0);
      const firstColumn = data.readUInt16LE(2);
      const lastColumn = data.readUInt16LE(data.length - 2);
      for (let column = firstColumn; column <= lastColumn; column += 1) setCell(row, column, decodeRk(data.readUInt32LE(6 + (column - firstColumn) * 6)));
    }
  }
  const maxRow = Math.max(-1, ...rows.keys());
  return Array.from({ length: maxRow + 1 }, (_, row) => {
    const cells = rows.get(row) || new Map<number, BiffCell>();
    const maxColumn = Math.max(-1, ...cells.keys());
    return Array.from({ length: maxColumn + 1 }, (_, column) => cells.get(column) ?? '');
  });
}

const numeric = (value: BiffCell | undefined) => {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
};

export function parseLegacyRateWorkbook(input: Buffer) {
  const [headers, ...rows] = sheetRows(workbookStream(input), '単価');
  if (!headers) return { data: [] as PayrollRateMaster[], errors: ['「単価」シートが空です。'], format: 'legacy_rate_sheet' as const };
  const headerMap = new Map(headers.map((header, index) => [String(header).normalize('NFKC').replace(/[\s　]/g, ''), index]));
  const column = (name: string) => headerMap.get(name.normalize('NFKC').replace(/[\s　]/g, '')) ?? -1;
  const required = ['支給年月', '所属教室番号', '職員コード', 'Expr1002', '事務_TANKA', 'サブスタッフ_TANKA'];
  const missing = required.filter(name => column(name) < 0);
  if (missing.length) return { data: [] as PayrollRateMaster[], errors: [`「単価」シートに必要な列がありません: ${missing.join('、')}`], format: 'legacy_rate_sheet' as const };
  const data: PayrollRateMaster[] = [];
  const errors: string[] = [];
  rows.forEach((row, index) => {
    const personCode = normalizePersonCode(row[column('職員コード')]);
    const personName = String(row[column('Expr1002')] || '').trim();
    const paymentMonth = String(Math.trunc(numeric(row[column('支給年月')])));
    const monthMatch = paymentMonth.match(/^(\d{4})(\d{2})$/);
    if (!personCode && !personName) return;
    if (!monthMatch) { errors.push(`${index + 2}行目: 支給年月が不正です。`); return; }
    const lessonRates = resolveLegacyLessonRates({
      edic: numeric(row[column('EDIC授業_TANKA')]),
      sogaku: numeric(row[column('創学授業_TANKA')]),
      individual1: numeric(row[column('個別授業1_TANKA')]),
      individual4: numeric(row[column('個別授業4_TANKA')]),
    });
    const normalLessonRate = lessonRates.normal;
    const breakthroughLessonRate = lessonRates.breakthrough;
    const officeRate = numeric(row[column('事務_TANKA')]);
    const interviewRate = numeric(row[column('サブスタッフ_TANKA')]) || officeRate;
    data.push({
      person_code: personCode,
      person_name: personName,
      normalized_name: normalizePayrollName(personName),
      effective_from: `${monthMatch[1]}-${monthMatch[2]}-01`,
      school_code: normalizePersonCode(row[column('所属教室番号')]),
      normal_lesson_rate: normalLessonRate,
      breakthrough_lesson_rate: breakthroughLessonRate,
      hourly_rates: { lesson: breakthroughLessonRate, office: officeRate, interview: interviewRate, other: officeRate },
      allowances: { lesson: 0, office: 0, interview: 0, other: 0 },
    });
  });
  return { data, errors, format: 'legacy_rate_sheet' as const };
}
