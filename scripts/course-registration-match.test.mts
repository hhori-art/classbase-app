import assert from 'node:assert/strict';
import test from 'node:test';
import { buildRegistrationClassOptions } from '../lib/course-registration-match.ts';

test('GASの時限値より中1社会の正規1限を優先する', () => {
  const generated = buildRegistrationClassOptions([], [], [{
    id: 'gas-wrong-period', target_date: '2026-09-11', role_type: 'main',
    target_grade: '中1', target_subject: '社会', target_detail_subject: '地理B',
    period: 2, note: '【2限】', sync_source: 'google_sheet',
  }]);
  assert.equal(generated.length, 1);
  assert.equal(generated[0].resolved_slot, '1時間目');
});

const curriculum = [{
  id: 'curriculum-1', year: 2026, term: 'term3', grade: '中3', subject: '理科',
  course_name: '物理', unit: '運動', month_label: '9月', week_no: '1',
}];

test('中3物理は配置データに2限が残っていても1限として生成する', () => {
  const shifts = [{
    id: 'shift-1', target_date: '2026-09-01', target_grade: '中3', target_subject: '理科',
    target_detail_subject: '物理', unit: '運動', period: 2, role_type: 'main', sync_source: 'google_sheet',
  }];
  const options = buildRegistrationClassOptions([], curriculum, shifts, {
    '2026__term3': { start: '2026-09-01', end: '2026-12-31' },
  });
  assert.deepEqual(options.map(option => option.resolved_slot), ['1時間目']);
});

test('中3生物も常に1限として生成する', () => {
  const biologyCurriculum = [{ ...curriculum[0], id: 'biology-row', course_name: '生物' }];
  const shifts = [
    {
      id: 'shift-1', target_date: '2026-09-01', target_grade: '中3', target_subject: '理科',
      target_detail_subject: '生物', unit: '運動', period: 2, role_type: 'main', sync_source: 'google_sheet',
    },
  ];
  const options = buildRegistrationClassOptions([], biologyCurriculum, shifts, {
    '2026__term3': { start: '2026-09-01', end: '2026-12-31' },
  });
  assert.deepEqual(options.map(option => option.resolved_slot), ['1時間目']);
});

test('中3公民③・④は1限、①・②は2限として生成する', () => {
  const civicsRows = ['公民①', '公民②', '公民③', '公民④'].map((course_name, index) => ({
    id: `civics-period-${index}`, year: 2026, term: 'term3', grade: '中3', subject: '社会', course_name,
  }));
  const shifts = civicsRows.map((row, index) => ({
    id: `civics-shift-${index}`, target_date: `2026-09-${String(7 + index).padStart(2, '0')}`,
    target_grade: '中3', target_subject: '社会', target_detail_subject: row.course_name,
    period: 2, role_type: 'main', sync_source: 'google_sheet',
  }));
  const options = buildRegistrationClassOptions([], civicsRows, shifts, {
    '2026__term3': { start: '2026-09-01', end: '2026-12-31' },
  });
  const slots = Object.fromEntries(options.flatMap(option =>
    option.matched_shift_ids.map((id: string) => [id, option.resolved_slot]),
  ));
  assert.equal(slots['civics-shift-0'], '2時間目');
  assert.equal(slots['civics-shift-1'], '2時間目');
  assert.equal(slots['civics-shift-2'], '1時間目');
  assert.equal(slots['civics-shift-3'], '1時間目');
});

test('中3化学は引き続き講師配置の明示時限を使用する', () => {
  const chemistryCurriculum = [{ ...curriculum[0], id: 'chemistry-row', course_name: '化学' }];
  const options = buildRegistrationClassOptions([], chemistryCurriculum, [{
    id: 'chemistry-shift', target_date: '2026-09-01', target_grade: '中3', target_subject: '理科',
    target_detail_subject: '化学', unit: '運動', period: 2, role_type: 'main', sync_source: 'google_sheet',
  }], {
    '2026__term3': { start: '2026-09-01', end: '2026-12-31' },
  });
  assert.deepEqual(options.map(option => option.resolved_slot), ['2時間目']);
});

test('中3公民は枝番が違っても同じ講座名として扱う', () => {
  const civicsCurriculum = [{
    id: 'curriculum-civics', year: 2026, term: 'term3', grade: '中3', subject: '社会',
    course_name: '公民', unit: '裁判所', month_label: '9月', week_no: '17',
  }];
  const shifts = [
    {
      id: 'shift-civics-period-1', target_date: '2026-09-07', target_grade: '中３', target_subject: '中３社会',
      target_detail_subject: '公民③', unit: '裁判所', period: 1, role_type: 'main', sync_source: 'google_sheet',
    },
    {
      id: 'shift-civics-period-2', target_date: '2026-09-07', target_grade: '中３', target_subject: '中３社会',
      target_detail_subject: '公民①', unit: '裁判所', period: 2, role_type: 'main', sync_source: 'google_sheet',
    },
  ];
  const options = buildRegistrationClassOptions([], civicsCurriculum, shifts, {
    '2026__term3': { start: '2026-09-01', end: '2026-12-31' },
  });
  assert.deepEqual(
    options.map(option => `${option.resolved_day}:${option.resolved_slot}`).sort(),
    ['月:1時間目', '月:2時間目'],
  );
  assert.deepEqual(Array.from(new Set(options.map(option => option.course_name))), ['公民']);
});

test('同じ曜日・時限の公民①と公民②は1つの登録候補にまとめる', () => {
  const civicsCurriculum = [{
    id: 'curriculum-civics-merged', year: 2026, term: 'term3', grade: '中3', subject: '社会',
    course_name: '公民', unit: '裁判所',
  }];
  const options = buildRegistrationClassOptions([], civicsCurriculum, [
    {
      id: 'civics-1', target_date: '2026-09-07', target_grade: '中3', target_subject: '社会',
      target_detail_subject: '公民①', unit: '裁判所', period: 2, role_type: 'main', sync_source: 'google_sheet',
    },
    {
      id: 'civics-2', target_date: '2026-09-14', target_grade: '中3', target_subject: '社会',
      target_detail_subject: '公民②', unit: '地方自治', period: 2, role_type: 'main', sync_source: 'google_sheet',
    },
  ], { '2026__term3': { start: '2026-09-01', end: '2026-12-31' } });
  assert.equal(options.length, 1);
  assert.equal(options[0].course_name, '公民');
  assert.deepEqual(options[0].matched_shift_ids, ['civics-1', 'civics-2']);
});

test('中3物理は月火木金のどの配置も1限として生成する', () => {
  const placements = [
    ['2026-09-07', 1],
    ['2026-09-08', 2],
    ['2026-09-10', 1],
    ['2026-09-11', 2],
  ].map(([target_date, period], index) => ({
    id: `shift-weekday-${index}`,
    target_date,
    target_grade: '中３',
    target_subject: '中３理科',
    target_detail_subject: '物理',
    unit: '運動',
    period,
    role_type: 'main',
    sync_source: 'google_sheet',
  }));
  const options = buildRegistrationClassOptions([], curriculum, placements, {
    '2026__term3': { start: '2026-09-01', end: '2026-12-31' },
  });
  assert.deepEqual(
    options.map(option => `${option.resolved_day}:${option.resolved_slot}`).sort(),
    ['月:1時間目', '火:1時間目', '木:1時間目', '金:1時間目'].sort(),
  );
});

test('中3物理は講師配置に時限がなくても1限を補完する', () => {
  const shifts = [{
    id: 'shift-1', target_date: '2026-09-01', target_grade: '中3', target_subject: '理科',
    target_detail_subject: '物理', unit: '運動', role_type: 'main', sync_source: 'google_sheet',
  }];
  const options = buildRegistrationClassOptions([], curriculum, shifts, {
    '2026__term3': { start: '2026-09-01', end: '2026-12-31' },
  });
  assert.deepEqual(options.map(option => option.resolved_slot), ['1時間目']);
});

test('中1社会は壊れた明示時限より正規1限を優先する', () => {
  const rows = [{ ...curriculum[0], id: 'curriculum-2', grade: '中1', subject: '社会', course_name: '地理' }];
  const shifts = [{
    id: 'shift-2', target_date: '2026-09-01', target_grade: '中1', target_subject: '社会',
    target_detail_subject: '地理', unit: '運動', period: 2, role_type: 'main', sync_source: 'google_sheet',
  }];
  const options = buildRegistrationClassOptions([], rows, shifts, {
    '2026__term3': { start: '2026-09-01', end: '2026-12-31' },
  });
  assert.deepEqual(options.map(option => option.resolved_slot), ['1時間目']);
});

test('全学年・全教科で曜日を反映し既知の時間割は正規時限へ補正する', () => {
  const classes = [
    ['中1', '理科', '2026-09-07', 1],
    ['中1', '社会', '2026-09-08', 2],
    ['中2', '理科', '2026-09-09', 2],
    ['中2', '社会', '2026-09-10', 1],
    ['中3', '理科', '2026-09-11', 2],
    ['中3', '社会', '2026-09-12', 1],
  ] as const;
  const rows = classes.map(([grade, subject], index) => ({
    id: `curriculum-matrix-${index}`, year: 2026, term: 'term3', grade, subject,
    course_name: subject === '理科' ? '物理' : '公民', unit: `単元${index}`,
  }));
  const shifts = classes.map(([grade, subject, target_date, period], index) => ({
    id: `shift-matrix-${index}`, target_date, target_grade: grade, target_subject: subject,
    target_detail_subject: subject === '理科' ? '物理' : '公民', unit: `単元${index}`,
    period, role_type: 'main', sync_source: 'google_sheet',
  }));
  const options = buildRegistrationClassOptions([], rows, shifts, {
    '2026__term3': { start: '2026-09-01', end: '2026-12-31' },
  });
  assert.deepEqual(
    options.map(option => `${option.grade}:${option.subject}:${option.resolved_day}:${option.resolved_slot}`).sort(),
    [
      '中1:理科:月:2時間目',
      '中1:社会:火:1時間目',
      '中2:理科:水:1時間目',
      '中2:社会:木:2時間目',
      '中3:理科:金:1時間目',
      '中3:社会:土:1時間目',
    ].sort(),
  );
});

test('Google配置がある日は誤った時限の旧取込配置を登録候補から除外する', () => {
  const rows = [{
    id: 'curriculum-current', year: 2026, term: 'term3', grade: '中3', subject: '理科',
    course_name: '化学', unit: '化学変化',
  }];
  const options = buildRegistrationClassOptions([], rows, [
    {
      id: 'current-sheet', target_date: '2026-09-14', target_grade: '中3', target_subject: '理科',
      target_detail_subject: '化学', unit: '化学変化', period: 2, role_type: 'main',
      source_spreadsheet_id: 'sheet-id', sync_source: 'google_sheet',
    },
    {
      id: 'stale-import', target_date: '2026-09-14', target_grade: '中3', target_subject: '理科',
      target_detail_subject: '化学', unit: '化学変化', note: '【1限】', role_type: 'main',
    },
  ], {
    '2026__term3': { start: '2026-09-01', end: '2026-12-31' },
  });
  assert.deepEqual(options.map(option => option.resolved_slot), ['2時間目']);
  assert.deepEqual(options[0].matched_shift_ids, ['current-sheet']);
});

test('Google配置同期済みの年度では別日付の旧取込配置も候補へ混ぜない', () => {
  const rows = [{
    id: 'curriculum-current', year: 2026, term: 'term3', term_label: '第III期',
    grade: '中3', subject: '理科', course_name: '化学', unit: '化学変化',
  }];
  const options = buildRegistrationClassOptions([], rows, [
    {
      id: 'current-sheet', target_date: '2026-09-14', target_grade: '中3', target_subject: '理科',
      target_detail_subject: '化学', unit: '化学変化', period: 2, role_type: 'main', source_spreadsheet_id: 'sheet-id',
    },
    {
      id: 'stale-other-day', target_date: '2026-09-17', target_grade: '中3', target_subject: '理科',
      target_detail_subject: '化学', unit: '化学変化', note: '【1限】', role_type: 'main',
    },
  ], { '2026__term3': { start: '2026-09-01', end: '2026-12-31' } });
  assert.deepEqual(options.map(option => `${option.resolved_day}:${option.resolved_slot}`), ['月:2時間目']);
});

test('同じ表示期の重複カスタム期は講座数が多い正規期へ統合する', () => {
  const baseOptions = [
    ...['物理', '化学'].map(course_name => ({ year: 2026, term: 'term3', term_label: '第III期', grade: '中3', subject: '理科', course_name })),
    { year: 2026, term: 'term_custom_duplicate', term_label: '第Ⅲ期', grade: '中3', subject: '理科', course_name: '物理' },
  ];
  const rows = [
    { id: 'canonical', year: 2026, term: 'term3', term_label: '第III期', grade: '中3', subject: '理科', course_name: '物理', unit: '運動' },
    { id: 'duplicate', year: 2026, term: 'term_custom_duplicate', term_label: '第Ⅲ期', grade: '中3', subject: '理科', course_name: '物理', unit: '運動' },
  ];
  const generated = buildRegistrationClassOptions(baseOptions, rows, [{
    id: 'shift', target_date: '2026-09-14', target_grade: '中3', target_subject: '理科',
    target_detail_subject: '物理', unit: '運動', period: 2, role_type: 'main', source_spreadsheet_id: 'sheet-id',
  }], {
    '2026__term3': { start: '2026-09-01', end: '2026-11-30' },
    '2026__term_custom_duplicate': { start: '2026-09-01', end: '2026-11-30' },
  });
  assert.equal(generated.length, 1);
  assert.equal(generated[0].term, 'term3');
  assert.equal(generated[0].term_label, '第III期');
});

test('対策配置は通常講座の一致配置に使わない', () => {
  const baseOptions = [
    { id: 'term1-science', year: 2026, term: 'term1', term_label: '第I期', grade: '中3', subject: '理科', course_name: '物理' },
    { id: 'term3-science', year: 2026, term: 'term3', term_label: '第III期', grade: '中3', subject: '理科', course_name: '物理' },
  ];
  const rows = [
    { id: 'term1-row', year: 2026, term: 'term1', term_label: '第I期', grade: '中3', subject: '理科', course_name: '物理', unit: '運動' },
    { id: 'term3-row', year: 2026, term: 'term3', term_label: '第III期', grade: '中3', subject: '理科', course_name: '物理', unit: '運動' },
  ];
  const generated = buildRegistrationClassOptions(baseOptions, rows, [{
    id: 'test-prep-shift', target_date: '2026-09-24', target_grade: '中3', target_subject: '理科',
    target_detail_subject: '【対策】物理', unit: '対策', period: 2, role_type: 'main', source_spreadsheet_id: 'sheet-id',
  }], {
    '2026__term1': { start: '2026-04-01', end: '2026-07-31' },
    '2026__term3': { start: '2026-09-01', end: '2026-11-30' },
  });
  assert.equal(generated.length, 2);
  assert.equal(generated.every(option => option.course_name === '物理'), true);
  assert.equal(generated.every(option => (option.matched_shift_ids || []).length === 0), true);
  assert.equal(generated.some(option => option.parent_course_option_id === 'term3-science'), true);
});

test('通常と対策の配置が同じ曜日・時限でも通常登録には通常配置だけを使う', () => {
  const baseOptions = [{
    id: 'physics', year: 2026, term: 'term3', term_label: '第III期',
    grade: '中3', subject: '理科', course_name: '物理',
  }];
  const rows = [{
    id: 'physics-row', year: 2026, term: 'term3', term_label: '第III期',
    grade: '中3', subject: '理科', course_name: '物理', unit: '運動',
  }];
  const generated = buildRegistrationClassOptions(baseOptions, rows, [
    {
      id: 'regular-shift', target_date: '2026-09-14', target_grade: '中3', target_subject: '理科',
      target_detail_subject: '物理', unit: '運動', period: 2, role_type: 'main', source_spreadsheet_id: 'sheet-id',
    },
    {
      id: 'test-prep-shift', target_date: '2026-09-21', target_grade: '中3', target_subject: '理科',
      target_detail_subject: '【対策】物理', unit: '対策', period: 2, role_type: 'main', source_spreadsheet_id: 'sheet-id',
    },
  ], {
    '2026__term3': { start: '2026-09-01', end: '2026-11-30' },
  });

  assert.equal(generated.length, 1);
  assert.equal(generated[0].course_name, '物理');
  assert.deepEqual(generated[0].matched_shift_ids, ['regular-shift']);
});
