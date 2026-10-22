/** 交流掲示板の通報理由（生徒画面の選択肢とサーバーの検証で共通）。自由記述は受け付けない。 */
export const COMMUNITY_REPORT_REASONS = {
  bullying: '悪口・いじめ',
  personal_info: '個人情報（名前・住所・連絡先など）',
  inappropriate: '不適切な内容',
  spam: '関係のない投稿・荒らし',
  other: 'その他',
} as const;

export type CommunityReportReason = keyof typeof COMMUNITY_REPORT_REASONS;

export const isCommunityReportReason = (value: unknown): value is CommunityReportReason =>
  typeof value === 'string' && Object.hasOwn(COMMUNITY_REPORT_REASONS, value);
