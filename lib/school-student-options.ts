import { ATTENDANCE_SCHOOL_DIRECTORY, resolveAttendanceSchoolCode, resolveAttendanceSchoolEntry } from './attendance-schools';

/** マスターが全校舎の生徒をまとめて見るときの値（一覧・検索・CSV出力用。登録・取込は校舎を選んだときだけ）。 */
export const ALL_SCHOOLS_VALUE = '__all__';
export const ALL_SCHOOLS_LABEL = '全校舎（すべての生徒）';

/**
 * 校舎別生徒管理で、マスターが選べる校舎。
 * 理社講座の対象（集団の校舎）をすべて出し、まだ生徒がいない校舎も選んで登録できるようにする。
 * 生徒の校舎の値（教室番号か校舎名）がすでにあればその値を使い、同じ校舎が2つ並ばないようにする。
 * 集団以外の校舎に生徒がいれば、それも残す。
 */
export function masterSchoolOptions(existingValues: readonly string[]) {
  const existing = Array.from(new Set(existingValues.map(value => String(value || '').trim()).filter(Boolean)));
  const usedForCode = new Map<string, string>();
  for (const value of existing) {
    const code = resolveAttendanceSchoolCode(value);
    if (!code) continue;
    // 教室番号そのものの値を優先する（テスト中の校舎は番号で登録している）。
    if (!usedForCode.has(code) || value === code) usedForCode.set(code, value);
  }
  const options = ATTENDANCE_SCHOOL_DIRECTORY
    .filter(school => school.group === '集団')
    .map(school => usedForCode.get(school.code) || school.code);
  for (const value of existing) {
    const code = resolveAttendanceSchoolCode(value);
    if (code && options.includes(usedForCode.get(code) || '')) continue;
    if (!options.includes(value)) options.push(value);
  }
  return options.sort((a, b) => sortKey(a).localeCompare(sortKey(b), 'ja', { numeric: true }));
}

const sortKey = (value: string) => resolveAttendanceSchoolCode(value) || value;

/** 選択肢に出す名前。「112 創造学園 オンライン校」のように教室番号と校舎名を並べる。 */
export function schoolOptionLabel(value: string) {
  if (value === ALL_SCHOOLS_VALUE) return ALL_SCHOOLS_LABEL;
  const entry = resolveAttendanceSchoolEntry(value);
  return entry ? `${entry.code} ${entry.name}` : value;
}

/** 生徒の校舎の値が、選んだ校舎と同じか（教室番号と校舎名のどちらで入っていても同じ校舎とみなす）。 */
export function isSameSchool(studentSchool: unknown, selected: string) {
  const value = String(studentSchool || '').trim();
  if (!value || !selected) return false;
  if (value === selected) return true;
  const code = resolveAttendanceSchoolCode(value);
  return Boolean(code) && code === resolveAttendanceSchoolCode(selected);
}
