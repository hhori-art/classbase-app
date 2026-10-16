import assert from 'node:assert/strict';
import test from 'node:test';
import {
  chooseCourseRegistrationTerm,
  courseOptionMatchesLegacyCourseSelection,
  courseOptionMatchesSelection,
  currentCourseTermIds,
  filterCourseOptionsForRegistrationRequest,
  getCourseOptionStableKey,
  hasCourseOptionSelection,
  legacyCourseSelectionLabel,
  parseLegacyCourseOptionId,
  resolveSelectedCourseOptionIds,
  resolveSelectedCourseOptionIdsAcrossTerms,
  removeCourseOptionSelections,
  selectCurrentCourseRegistration,
  selectEffectiveCourseRegistration,
  summarizeSelectedCourseLabels,
} from '../lib/course-registration-selection.ts';

const option = {
  id: 'generated-class-id',
  parent_course_option_id: 'master-course-id',
  fallback_curriculum_option_id: 'curriculum-row-id',
};

test('再生成された講座候補を親IDとカリキュラムIDから現在登録へ復元する', () => {
  // 親IDの直接一致は複数曜日・時限を全選択するため使わず、
  // 候補が1枠に特定できる場合だけ resolve で復元する。
  assert.equal(courseOptionMatchesSelection(option, ['master-course-id']), false);
  assert.equal(courseOptionMatchesSelection(option, ['curriculum-row-id']), false);
  assert.deepEqual(resolveSelectedCourseOptionIds([option], ['master-course-id']), ['generated-class-id']);
  assert.deepEqual(resolveSelectedCourseOptionIds([option], ['curriculum-row-id']), ['generated-class-id']);
});

test('複数の単元IDで構成された講座枠も一度の操作で完全に解除する', () => {
  const unitOptions = [
    {
      id: 'biology-cell', parent_course_option_id: 'biology-master',
      grade: '中2', subject: '理科', course_name: '生物', resolved_day: '金', resolved_slot: '1時間目',
    },
    {
      id: 'biology-digestion', parent_course_option_id: 'biology-master',
      grade: '中2', subject: '理科', course_name: '生物', resolved_day: '金', resolved_slot: '1時間目',
    },
  ];
  assert.equal(hasCourseOptionSelection(['biology-cell'], unitOptions), true);
  assert.deepEqual(removeCourseOptionSelections(['biology-cell', 'unrelated-course'], unitOptions), ['unrelated-course']);
  assert.deepEqual(removeCourseOptionSelections([
    getCourseOptionStableKey(unitOptions[0]),
    'unrelated-course',
  ], unitOptions), ['unrelated-course']);
});

test('通常の変更画面では登録済みの期を受付中の別期より優先する', () => {
  assert.equal(chooseCourseRegistrationTerm(['2026__term3', '2026__term4'], '2026__term3'), '2026__term3');
  assert.equal(chooseCourseRegistrationTerm(['2026__term3', '2026__term4'], '2026__term3', '2026__term4'), '2026__term4');
});

test('古い受付URLで開いても現在期の講座を非表示にしない', () => {
  const currentOptions = [
    { id: 'science', registration_request_id: '' },
    { id: 'social', registration_request_id: '' },
  ];
  assert.deepEqual(filterCourseOptionsForRegistrationRequest(currentOptions, 'expired-request'), currentOptions);
  assert.deepEqual(filterCourseOptionsForRegistrationRequest([
    ...currentOptions,
    { id: 'test-prep', registration_request_id: 'open-request' },
  ], 'open-request').map(item => item.id), ['test-prep']);
});

test('旧形式の単元別講座IDから現在の講座候補を復元する', () => {
  const currentOption = {
    id: 'shift-class-physics', year: 2026, grade: '中3', subject: '理科', course_name: '物理',
    resolved_day: '火', resolved_slot: '1時間目',
  };
  const legacyId = 'class_2026_term_custom_1785824701773_中3_理科_物理_力と運動_火_2時間目';
  assert.deepEqual(parseLegacyCourseOptionId(legacyId), {
    year: 2026, grade: '中3', subject: '理科', course: '物理', day: '火', slot: '2限',
  });
  assert.equal(courseOptionMatchesSelection(currentOption, [legacyId]), true);
  assert.deepEqual(resolveSelectedCourseOptionIds([currentOption], [legacyId]), ['shift-class-physics']);
  assert.equal(legacyCourseSelectionLabel(legacyId), '中3 理科 物理 / 火曜 1限');
});

test('登録期が違い曜日・時限が変わっても唯一の現在期講座へ引き継ぐ', () => {
  const currentOptions = [
    { id: 'biology-current-a', year: 2026, grade: '中1', subject: '理科', course_name: '生物', resolved_day: '金', resolved_slot: '1時間目', resolved_unit: '植物' },
    { id: 'biology-current-b', year: 2026, grade: '中1', subject: '理科', course_name: '生物', resolved_day: '金', resolved_slot: '1時間目', resolved_unit: '動物' },
  ];
  const oldTermIds = [
    'class_2026_term2_中1_理科_生物_花のつくり_木_2時間目',
    'class_2026_term2_中1_理科_生物_植物の分類_木_2時間目',
  ];
  assert.deepEqual(resolveSelectedCourseOptionIdsAcrossTerms(currentOptions, oldTermIds), [
    'biology-current-a',
    'biology-current-b',
  ]);
});

test('旧期と現在期の曜日が違っても同じ講座の選択欄を開く', () => {
  const current = { grade: '中1', subject: '理科', course_name: '生物', resolved_day: '金', resolved_slot: '2時間目' };
  const oldTermId = 'class_2026_term2_中1_理科_生物_花のつくり_木_2時間目';
  assert.equal(courseOptionMatchesLegacyCourseSelection(current, [oldTermId]), true);
});

test('旧期と同じ講座が複数曜日にある場合は勝手に選ばない', () => {
  const currentOptions = [
    { id: 'physics-mon', grade: '中2', subject: '理科', course_name: '物理', resolved_day: '月', resolved_slot: '1時間目' },
    { id: 'physics-fri', grade: '中2', subject: '理科', course_name: '物理', resolved_day: '金', resolved_slot: '1時間目' },
  ];
  const oldTermId = 'class_2026_term2_中2_理科_物理_電流_火_2時間目';
  assert.deepEqual(resolveSelectedCourseOptionIdsAcrossTerms(currentOptions, [oldTermId]), []);
});

test('旧形式IDの異なる講座は現在候補へ誤って紐付けない', () => {
  const chemistryOption = {
    id: 'shift-class-chemistry', year: 2026, grade: '中3', subject: '理科', course_name: '化学',
    resolved_day: '火', resolved_slot: '2時間目',
  };
  const legacyPhysicsId = 'class_2026_term3_中3_理科_物理_運動_火_2時間目';
  assert.equal(courseOptionMatchesSelection(chemistryOption, [legacyPhysicsId]), false);
});

test('再生成で期IDが変わったshift_classも同じ講座なら登録変更を復元する', () => {
  const currentOption = {
    id: 'shift_class_2026_term_custom_1777362292242_中3_理科_物理_金_1時間目',
    year: 2026, grade: '中3', subject: '理科', course_name: '物理',
    resolved_day: '金', resolved_slot: '1時間目',
  };
  const savedId = 'shift_class_2026_term3_中3_理科_物理_金_1時間目';
  assert.equal(courseOptionMatchesSelection(currentOption, [savedId]), true);
});

test('GASの行番号と期IDが変わっても安定講座キーで登録を復元する', () => {
  const before = {
    id: 'shift_class_2026_term3_old-row', grade: '中3', subject: '理科', course_name: '物理①',
    resolved_day: '金', resolved_slot: '1時間目',
  };
  const after = {
    id: 'shift_class_2026_term4_new-row', grade: '中3', subject: '理科', course_name: '【対策】物理',
    resolved_day: '金', resolved_slot: '1限',
  };
  const stableKey = getCourseOptionStableKey(before);
  assert.equal(stableKey, getCourseOptionStableKey(after));
  assert.equal(courseOptionMatchesSelection(after, [stableKey]), true);
});

test('旧登録の「通常」接頭辞が現在配置から消えても同じ講座として復元する', () => {
  const currentOption = {
    id: 'shift_class_current', grade: '中2', subject: '社会', course_name: '地理D',
    resolved_day: '金', resolved_slot: '2時間目',
  };
  const legacyStableKey = 'course_中2_社会_通常地理d_金_2限';
  assert.equal(getCourseOptionStableKey({ ...currentOption, course_name: '通常地理D' }), 'course_中2_社会_地理d_金_2限');
  assert.equal(courseOptionMatchesSelection(currentOption, [legacyStableKey]), true);
});

test('校舎別管理は今期の通常期と同日開始のカスタム期だけを対象にする', () => {
  const options = [
    { year: 2026, term: 'term2', term_start_date: '2026-07-06' },
    { year: 2026, term: 'term3', term_start_date: '2026-09-07' },
    { year: 2026, term: 'term_custom_3', term_start_date: '2026-09-07' },
    { year: 2026, term: 'term4', term_start_date: '2026-12-01' },
  ];
  const terms = currentCourseTermIds(options, 2026, '2026-09-12');
  assert.deepEqual(Array.from(terms), ['term3', 'term_custom_3']);
  const history = [
    { id: 'old', year: 2026, term: 'term2', status: 'active', is_current: true },
    { id: 'now', year: 2026, term: 'term3', status: 'active', selected_course_ids: ['course-a'] },
  ];
  assert.equal(selectCurrentCourseRegistration(history, 2026, terms, 'old')?.id, 'now');
  assert.equal(selectCurrentCourseRegistration(history.slice(0, 1), 2026, terms, 'old'), null);
});

test('管理者が最後に確定した登録は、期がずれていても生徒画面の正とする', () => {
  const registrations = [
    { id: 'old-current-term', year: 2026, term: 'term3', status: 'active', is_current: false, selected_course_ids: ['old'] },
    { id: 'latest-admin-selection', year: 2026, term: 'term2', status: 'active', is_current: true, selected_course_ids: ['latest'] },
  ];
  const selected = selectEffectiveCourseRegistration(registrations, 2026, new Set(['term3']), {
    active_course_registration_id: 'latest-admin-selection',
    course_registration_year: 2026,
    course_registration_term: 'term2',
  });
  assert.equal(selected?.id, 'latest-admin-selection');

  const inconsistentPointer = selectEffectiveCourseRegistration(registrations, 2026, new Set(['term3']), {
    active_course_registration_id: 'latest-admin-selection',
    course_registration_year: 2026,
    course_registration_term: 'term4',
  });
  assert.equal(inconsistentPointer?.id, 'old-current-term');
});

test('期開始日の旧フィールドも引き続き使用できる', () => {
  assert.deepEqual(Array.from(currentCourseTermIds([
    { year: 2026, term: 'term2', start_date: '2026-07-06' },
  ], 2026, '2026-09-14')), ['term2']);
});

test('単元ごとの多数の登録IDは同じ講座として一度だけ表示する', () => {
  assert.deepEqual(summarizeSelectedCourseLabels([
    '中2 理科 生物 / 金曜 1限 / 細胞',
    '中2 理科 生物 / 金曜 1限 / 消化',
    '中2 社会 地理Ｄ / 金曜 2限 / 九州',
  ]), ['中2 理科 生物 / 金曜 1限', '中2 社会 地理Ｄ / 金曜 2限']);
});
