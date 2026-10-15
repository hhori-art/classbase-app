export function parseAccountCsv(text: string) {
  const source = String(text || '').replace(/^\uFEFF/, '');
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (quoted) {
      if (char === '"' && source[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        field += char;
      }
      continue;
    }
    if (char === '"') quoted = true;
    else if (char === ',') {
      row.push(field.trim());
      field = '';
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && source[index + 1] === '\n') index += 1;
      row.push(field.trim());
      field = '';
      if (row.some(value => value !== '')) rows.push(row);
      row = [];
    } else {
      field += char;
    }
  }
  if (quoted) throw new Error('CSVの引用符が閉じられていません。');
  row.push(field.trim());
  if (row.some(value => value !== '')) rows.push(row);
  if (rows.length < 2) throw new Error('CSVに登録データがありません。');
  return { headers: rows[0].map(value => value.trim()), rows: rows.slice(1) };
}

export function uniqueImportFileName(rawName: unknown, index: number, usedNames: Set<string>) {
  const fallback = `account_${index + 1}`;
  const safeName = (String(rawName || '').trim() || fallback)
    .replace(/[\\/:*?"<>|\u0000-\u001F]/g, '_')
    .slice(0, 80);
  let fileName = `${safeName}_アカウント案内.pdf`;
  let suffix = 2;
  while (usedNames.has(fileName)) {
    fileName = `${safeName}_${suffix}_アカウント案内.pdf`;
    suffix += 1;
  }
  usedNames.add(fileName);
  return fileName;
}
