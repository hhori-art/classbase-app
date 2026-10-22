// 一覧表の並べ替え（読み込み済みのデータを画面内で並べ替える）。

export type SortDirection = 'asc' | 'desc';
export type SortValue = string | number | boolean | Date | null | undefined;

const isEmpty = (value: SortValue) => value === null || value === undefined || value === '' || (typeof value === 'number' && Number.isNaN(value)) || (value instanceof Date && Number.isNaN(value.getTime()));
const comparable = (value: SortValue) => value instanceof Date ? value.getTime() : typeof value === 'boolean' ? Number(value) : value;

/** 2つの値を比べる。空の値は向きにかかわらず常に最後。文字は日本語順（数字は数の大きさで）。 */
export function compareSortValues(a: SortValue, b: SortValue, direction: SortDirection = 'asc') {
  const emptyA = isEmpty(a), emptyB = isEmpty(b);
  if (emptyA || emptyB) return emptyA === emptyB ? 0 : emptyA ? 1 : -1;
  const left = comparable(a), right = comparable(b);
  const result = typeof left === 'number' && typeof right === 'number'
    ? left - right
    : String(left).localeCompare(String(right), 'ja', { numeric: true, sensitivity: 'base' });
  return direction === 'asc' ? result : -result;
}

/** 元の配列は変えずに並べ替えた配列を返す（同じ値どうしは元の順を保つ）。 */
export function sortRows<T>(rows: readonly T[], accessor: (row: T) => SortValue, direction: SortDirection) {
  return rows
    .map((row, index) => ({ row, index, value: accessor(row) }))
    .sort((a, b) => compareSortValues(a.value, b.value, direction) || a.index - b.index)
    .map(item => item.row);
}
