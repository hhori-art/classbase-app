export type AttendanceSchool = {
  code: string;
  name: string;
  group: '集団' | '個別' | '中学受験' | '学童保育' | 'Gakken高等学院';
};

// 2026年度 教室番号一覧表（2026年1月22日）を正規データとして使用する。
const RAW_DIRECTORY = `
souzogakuen_hq|創造学園本部|集団
112|創造学園 オンライン校|集団
212|創造学園個別 オンライン校|個別
161|創造学園 阪急伊丹校|集団
162|創造学園 武庫元町校|集団
170|創造学園 本山本部校|集団
270|創造学園個別 本山校|個別
171|創造学園 六甲校|集団
271|創造学園個別 六甲校|個別
172|創造学園 御影校|集団
284|創造学園個別 御影校|個別
173|創造学園 ＨＡＴ神戸校|集団
273|創造学園個別 ＨＡＴ神戸校|個別
174|創造学園 甲南山手校|集団
287|創造学園個別 甲南山手校|個別
176|創造学園 摩耶校|集団
177|創造学園 六甲アイランド校|集団
277|創造学園個別 六甲アイランド校|個別
178|創造学園 元町校|集団
278|創造学園個別 元町校|個別
290|創造学園個別 本部校|個別
375|創学アカデミー 岡本校|中学受験
119|エディック 北神本部校|集団
219|エディック個別 北神校|個別
140|エディック 北鈴蘭台校|集団
240|エディック個別 北鈴蘭台校|個別
150|エディック 東山校|集団
250|エディック個別 東山校|個別
288|エディック個別 鈴蘭台校|個別
113|エディック 舞多聞校|集団
213|エディック個別 舞多聞校|個別
115|エディック 名谷本部校|集団
215|創造学園個別 名谷校|個別
120|エディック 西神本部校|集団
220|エディック個別 西神校|個別
129|エディック 学園都市校|集団
281|創造学園個別 学園都市校1号館|個別
295|創造学園個別 学園都市校2号館|個別
130|エディック 西神南校|集団
230|エディック個別 西神南校|個別
330|創学アカデミー 西神南校|中学受験
144|エディック 伊川谷校|集団
244|エディック個別 伊川谷校|個別
146|エディック 板宿校|集団
246|エディック個別 板宿校|個別
114|エディック 舞子坂校|集団
214|エディック個別 舞子坂校|個別
117|エディック 霞ヶ丘校|集団
147|エディック 須磨海浜校|集団
247|エディック個別 須磨海浜校|個別
168|エディック 青山台校|集団
169|エディック 垂水本部校|集団
282|創造学園個別 垂水校1号館|個別
294|創造学園個別 垂水校2号館|個別
164|エディック 三田本部校|集団
264|エディック個別 三田校|個別
365|創学アカデミー 三田校|中学受験
464|エディックきっず 三田校|学童保育
267|エディック個別 三田駅前校|個別
121|エディック 明石本部校|集団
285|創造学園個別 明石校|個別
321|創学アカデミー 明石校|中学受験
821|Gakken高等学院 明石校|Gakken高等学院
123|エディック 魚住校|集団
223|エディック個別 魚住校|個別
132|エディック 西明石校|集団
232|エディック個別 西明石校|個別
142|エディック 大久保本部校|集団
283|創造学園個別 大久保校|個別
124|エディック 播磨校|集団
224|エディック個別 播磨校|個別
125|エディック 浜の宮校|集団
225|エディック個別 浜の宮校|個別
126|エディック 東加古川校|集団
226|エディック個別 東加古川校|個別
127|エディック 野口校|集団
128|エディック 土山校|集団
228|エディック個別 土山校|個別
131|エディック 小野校|集団
231|エディック個別 小野校|個別
831|Gakken高等学院 小野校|Gakken高等学院
133|エディック 加古川本部校|集団
233|創造学園個別 加古川校1号館|個別
333|創学アカデミー 加古川校|中学受験
833|Gakken高等学院 加古川校|Gakken高等学院
291|創造学園個別 加古川校2号館|個別
134|エディック 宝殿校|集団
234|エディック個別 宝殿校|個別
135|エディック 高砂校|集団
235|エディック個別 高砂校|個別
136|エディック 曽根校|集団
236|エディック個別 曽根校|個別
286|エディック個別 別府校|個別
111|エディック 手柄本部校|集団
211|エディック個別 手柄校|個別
411|エディックきっず 手柄校|学童保育
118|エディック 姫路本部校|集団
218|創造学園個別 姫路校|個別
349|創学アカデミー 姫路校|中学受験
137|エディック 安室校|集団
237|エディック個別 安室校|個別
138|エディック 花北校|集団
238|エディック個別 花北校|個別
243|エディックNEXT 高丘校|個別
148|エディック 姫路白浜校|集団
248|エディック個別 姫路白浜校|個別
116|エディック ひめじ別所校|集団
216|エディック個別 ひめじ別所校|個別
145|エディック 西飾磨校|集団
245|エディック個別 西飾磨校|個別
163|温真会|集団
263|個別 温真会|個別
`;

export const ATTENDANCE_SCHOOL_DIRECTORY: readonly AttendanceSchool[] = RAW_DIRECTORY.trim().split('\n').map(line => {
  const [code, name, group] = line.split('|');
  return { code, name, group: group as AttendanceSchool['group'] };
});

export type AttendanceSchoolGroup = { label: string; schools: readonly string[] };
export type AttendanceSchoolOptionGroup = { label: string; schools: readonly AttendanceSchool[] };

export const SCIENCE_SOCIAL_WORKPLACE_ID = 'science_social';
export const SCIENCE_SOCIAL_WORKPLACE_LABEL = '理社講座';

const GROUPS: readonly AttendanceSchool['group'][] = ['集団', '個別', '中学受験', '学童保育', 'Gakken高等学院'];
export const ATTENDANCE_SCHOOL_OPTION_GROUPS: readonly AttendanceSchoolOptionGroup[] = GROUPS.map(label => ({
  label,
  schools: ATTENDANCE_SCHOOL_DIRECTORY.filter(school => school.group === label),
}));

// 既存の呼び出し元との互換用。画面表示値として校舎名だけを返す。
export const ATTENDANCE_SCHOOL_GROUPS: readonly AttendanceSchoolGroup[] = ATTENDANCE_SCHOOL_OPTION_GROUPS.map(group => ({
  label: group.label,
  schools: group.schools.map(school => school.name),
}));
export const ATTENDANCE_SCHOOLS = ATTENDANCE_SCHOOL_DIRECTORY.map(school => school.name);

const compact = (value: unknown) => String(value || '').normalize('NFKC').replace(/[\s　]/g, '').trim();
const byCode = new Map(ATTENDANCE_SCHOOL_DIRECTORY.map(school => [school.code, school]));
const byName = new Map(ATTENDANCE_SCHOOL_DIRECTORY.map(school => [compact(school.name), school]));
// 旧データで誤って使用されていた教室番号を現行の正式番号へ寄せる。
const LEGACY_CODE_ALIASES = new Map([['166', '178']]);

export function resolveAttendanceSchoolEntry(value: unknown): AttendanceSchool | undefined {
  const raw = String(value || '').trim();
  if (!raw) return undefined;
  const exact = byCode.get(LEGACY_CODE_ALIASES.get(raw) || raw) || byName.get(compact(raw));
  if (exact) return exact;
  const withoutBrand = (name: string) => compact(name).replace(/^(エディック個別|創造学園個別|エディックNEXT|エディック|創造学園|創学アカデミー|エディックきっず|Gakken高等学院|個別)/, '');
  const key = withoutBrand(raw).replace(/本部|校/g, '');
  let matches = ATTENDANCE_SCHOOL_DIRECTORY.filter(school => withoutBrand(school.name).replace(/本部|校/g, '') === key);
  const normalized = compact(raw);
  if (/^(エディック個別|創造学園個別|個別)/.test(normalized)) {
    matches = matches.filter(school => school.group === '個別');
  } else if (/^エディック(?!NEXT)/.test(normalized)) {
    matches = matches.filter(school => school.group === '集団');
  } else if (normalized.includes('本部')) {
    const headquarters = matches.filter(school => compact(school.name).includes('本部'));
    if (headquarters.length) matches = headquarters;
  }
  return matches.length === 1 ? matches[0] : undefined;
}

export function isAttendanceSchool(value: unknown) {
  return Boolean(resolveAttendanceSchoolEntry(value));
}

export function resolveAttendanceSchoolCode(value: unknown) {
  return resolveAttendanceSchoolEntry(value)?.code || '';
}

export function resolveAttendanceSchool(value: unknown) {
  return resolveAttendanceSchoolEntry(value)?.name || '';
}

export function attendanceSchoolName(value: unknown) {
  return resolveAttendanceSchool(value) || String(value || '').trim();
}
