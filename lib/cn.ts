/** クラス名をつなぐ（false / null / undefined は飛ばす）。 */
export function cn(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(' ');
}
