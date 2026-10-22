// 管理画面の生徒検索（名前・ふりがな・ログインID／生涯番号）。純粋関数だけを置き、テストから直接読む。

export type StudentSearchEntry = {
  id: string;
  name: string;
  kana: string;
  lifetime_id: string;
  login_id: string;
  grade: string;
  /** 校舎の判定に使う値（school_id → school_code → school_name → school の順）。 */
  school: string;
  inactive: boolean;
};

export const STUDENT_SEARCH_MAX_RESULTS = 20;

/** 全角・半角、カタカナ・ひらがな、大文字・小文字、空白の違いを無視して比べるための形。 */
export function normalizeSearchText(value: unknown) {
  return String(value ?? '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[ァ-ヶ]/g, char => String.fromCharCode(char.charCodeAt(0) - 0x60))
    .replace(/[\s　・･]+/g, '');
}

const INACTIVE = new Set(['suspended', 'withdrawn', 'archived', '解除', '退塾', '退会']);
const clean = (value: unknown) => String(value ?? '').trim();

export function studentSchoolValue(data: Record<string, any>) {
  return clean(data.school_id || data.school_code || data.school_name || data.school);
}

export function toStudentSearchEntry(id: string, data: Record<string, any>): StudentSearchEntry {
  return {
    id,
    name: clean(data.student_name || data.name || data.display_name) || '名前未設定',
    kana: clean(data.student_name_kana || data.name_kana || data.furigana || data.kana),
    lifetime_id: clean(data.lifetime_id),
    login_id: clean(data.login_id),
    grade: clean(data.grade).normalize('NFKC'),
    school: studentSchoolValue(data),
    inactive: INACTIVE.has(clean(data.account_status).toLowerCase()) || INACTIVE.has(clean(data.status).toLowerCase()) || data.is_active === false,
  };
}

/**
 * 検索語に合う生徒を、よく合う順（ID完全一致 → IDの前方一致 → 名前の前方一致 → 部分一致）に最大 limit 人返す。
 * canSee で担当外の生徒を先に除く（件数の上限に担当外の生徒を数えない）。
 */
export function searchStudentEntries(
  entries: StudentSearchEntry[],
  query: string,
  canSee: (entry: StudentSearchEntry) => boolean,
  limit = STUDENT_SEARCH_MAX_RESULTS,
) {
  const q = normalizeSearchText(query);
  if (!q) return [];
  const scored: Array<{ entry: StudentSearchEntry; score: number }> = [];
  for (const entry of entries) {
    const ids = [entry.lifetime_id, entry.login_id, entry.id].map(normalizeSearchText).filter(Boolean);
    const names = [entry.name, entry.kana].map(normalizeSearchText).filter(Boolean);
    let score = 0;
    if (ids.some(value => value === q)) score = 4;
    else if (ids.some(value => value.startsWith(q))) score = 3;
    else if (names.some(value => value.startsWith(q))) score = 2;
    else if (names.some(value => value.includes(q)) || ids.some(value => value.includes(q))) score = 1;
    if (!score || !canSee(entry)) continue;
    scored.push({ entry, score });
  }
  return scored
    .sort((a, b) => b.score - a.score
      || Number(a.entry.inactive) - Number(b.entry.inactive)
      || a.entry.name.localeCompare(b.entry.name, 'ja'))
    .slice(0, Math.max(1, Math.min(limit, STUDENT_SEARCH_MAX_RESULTS)))
    .map(item => item.entry);
}
