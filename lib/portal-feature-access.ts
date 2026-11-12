// 生徒画面の機能表示。全体設定（settings/portal_visibility）でオフでも、
// マスターが個別に許可した生徒（users.feature_overrides）には表示する。

export type StudentFeatureOverrideKey = 'shop' | 'community';

export const STUDENT_FEATURE_OVERRIDE_LABELS: Record<StudentFeatureOverrideKey, string> = {
  shop: '景品交換・ガチャ',
  community: '交流掲示板・交流広場',
};

export const isStudentFeatureOverrideKey = (value: unknown): value is StudentFeatureOverrideKey =>
  typeof value === 'string' && Object.prototype.hasOwnProperty.call(STUDENT_FEATURE_OVERRIDE_LABELS, value);

export function hasStudentFeatureOverride(profile: Record<string, any> | null | undefined, key: StudentFeatureOverrideKey) {
  return profile?.feature_overrides?.[key] === true;
}

export function isStudentFeatureEnabled(
  visibility: Record<string, boolean | undefined> | null | undefined,
  profile: Record<string, any> | null | undefined,
  key: StudentFeatureOverrideKey,
) {
  return visibility?.[key] !== false || hasStudentFeatureOverride(profile, key);
}
