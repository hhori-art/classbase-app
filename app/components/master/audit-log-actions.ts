// 操作ログ（admin_audit_logs）の操作の種類と表示名。サーバーの記録と管理画面の一覧で共通に使う。

export const AUDIT_ACTION_LABELS = {
  // アカウント
  account_create: 'アカウントの作成',
  account_update: 'アカウント情報の更新',
  account_import: 'アカウントの一括登録',
  account_status_change: 'アカウントの状態変更',
  account_password_change: 'パスワードの変更',
  account_delete: 'アカウントの削除',
  app_permission_change: '管理者の権限変更',
  app_permission_initialize: '管理者の権限の初期設定',
  student_lifecycle: '生徒の転校・退塾・復帰',
  student_profile_update: '生徒の情報の変更（氏名・学年など）',
  // 連絡・申請
  request_approve: '申請の承認',
  request_reject: '申請の却下',
  request_complete_exchange: '景品交換の完了',
  parent_inquiry_reply: '教室への連絡に返信',
  safety_alert_status: '安全アラートの対応状況変更',
  announcement_archive: 'お知らせの取り下げ',
  announcement_push: 'お知らせを端末に通知',
  // コイン・景品
  reward_shipment_update: '景品の発送状況変更',
  // CSV・一括取込（件数だけ記録し、行の内容は残さない）
  school_students_import: '校舎の生徒CSV取込',
  course_registrations_import: '受講登録CSV取込',
  pf_import: 'PF（学習記録）CSV取込',
  annual_schedule_import: '年間予定・カリキュラムの取込',
  transport_fares_import: '交通費（運賃）の取込',
  transport_stations_import: '駅の一覧の取込',
  // 勤怠
  attendance_record_delete: '勤務記録の削除',
  attendance_correction_approve: '打刻修正の承認',
  attendance_correction_reject: '打刻修正の却下',
  attendance_approve: '勤務実績の承認',
  attendance_review: '勤務実績の承認・差し戻し',
  // 代行依頼
  substitution_reopen: '代行依頼の再募集',
  shift_merge: '授業の合併',
  lesson_language_rules_update: '授業の発言チェックの言葉の設定',
  shift_unmerge: '授業の合併の解除',
  dedicated_review: '専任の勤怠申請の承認・差し戻し',
  dedicated_bulk_plans: '専任の時間外 一括申請',
  dedicated_staff_update: '専任の等級・事業部の設定',
  dedicated_season_save: '専任の講習期間の設定',
  // 画面から直接行う操作（操作後に画面から記録する）
  shift_unassign: 'シフト配置の解除',
  registration_task_delete: '受講登録の依頼の削除',
  survey_setting_delete: 'アンケート設定の削除',
  community_topic_archive: '掲示板の投稿を非表示',
  community_comment_delete: '掲示板のコメントを削除',
  community_report_review: '掲示板の通報の対応',
  substitution_close: '代行依頼の締切',
  recording_stop: '録画の公開停止',
  recording_resume: '録画の公開再開',
  recording_publish: '録画の公開',
  // 以前から各APIが同じコレクションに書いている記録（名前の形式が古いもの）
  'points.adjust': 'コインの増減',
  'badge.grant': '特別バッジの授与',
  'badge.revoke': '特別バッジの取り消し',
  'feature_override.shop': '景品画面の個別設定',
  'reward.create': '景品の追加',
  'reward.update': '景品の変更',
  'gacha.create': 'ガチャの追加',
  'gacha.update': 'ガチャの変更',
  'lesson_slide.delete': '授業スライドの削除',
  'lesson_slide.questions.generate': 'スライドからAI問題を作成',
  'learning_unit.create': '単元の追加',
  'learning_unit.delete': '単元の削除',
} as const;

export type AuditAction = keyof typeof AUDIT_ACTION_LABELS;

/** 画面（ブラウザ）から /api/admin/audit-log へ記録を依頼できる操作。サーバーで行う操作はここに入れない。 */
export const CLIENT_REPORTED_AUDIT_ACTIONS = [
  'shift_unassign',
  'registration_task_delete',
  'survey_setting_delete',
  'community_topic_archive',
  'community_comment_delete',
  'substitution_close',
  'recording_stop',
  'recording_resume',
  'recording_publish',
] as const satisfies readonly AuditAction[];

export type ClientReportedAuditAction = typeof CLIENT_REPORTED_AUDIT_ACTIONS[number];

export const isAuditAction = (value: unknown): value is AuditAction =>
  typeof value === 'string' && Object.hasOwn(AUDIT_ACTION_LABELS, value);

export const isClientReportedAuditAction = (value: unknown): value is ClientReportedAuditAction =>
  typeof value === 'string' && (CLIENT_REPORTED_AUDIT_ACTIONS as readonly string[]).includes(value);

export const auditActionLabel = (value: unknown) =>
  isAuditAction(value) ? AUDIT_ACTION_LABELS[value] : String(value || '不明な操作');
