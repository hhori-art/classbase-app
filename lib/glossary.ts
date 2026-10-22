/**
 * 画面で使う言葉の統一（docs/ui-guidelines.md の「用語」）。同じものを画面ごとに別の名前で呼ばない。
 */
export const TERMS = {
  /** その日に行う授業（Zoomで受ける1コマ）。 */
  lesson: '授業',
  /** 申し込む単位（受講登録する講座）。 */
  course: '講座',
  /** 授業の録画（「アーカイブ」は利用停止の意味で使うので避ける）。 */
  recording: '録画',
  /** ご褒美の単位。 */
  coin: 'コイン',
  /** 職員向けの呼び方。生徒向けは「先生」。 */
  teacher: '講師',
  teacherForStudent: '先生',
  homework: '宿題',
  /** 教室からの掲示。 */
  news: 'お知らせ',
  /** 自分宛ての連絡。 */
  notification: '通知',
  /** 保護者と教室のやりとり。 */
  parentContact: '教室への連絡',
  absenceContact: '欠席連絡',
  home: 'ホーム',
  back: '戻る',
} as const;
