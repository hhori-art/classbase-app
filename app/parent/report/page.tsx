'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { BookOpenCheck, Bot, CalendarCheck, ChevronLeft, ChevronRight, Coins, FileText, MonitorPlay, PencilLine, Printer, Users, type LucideIcon } from 'lucide-react';
import { useAuth } from '@/app/context/AuthContext';
import { ParentCard, ParentEmpty, ParentPageHeader, ParentSectionTitle } from '@/app/components/parent/ParentUI';
import ChildSwitcher, { pickChildId } from '@/app/components/parent/ChildSwitcher';
import { Button, ErrorState, IconButton, ListSkeleton } from '@/app/components/ui';
import { usePortalVisibility } from '@/app/hooks/usePortalVisibility';
import { formatDate } from '@/lib/format';
import { TERMS } from '@/lib/glossary';

type Student = { id: string; student_name?: string; grade?: string };
type Section<T> = { ok: true; data: T } | { ok: false; error: string };
type AttendanceCounts = { live_days: number; live_classes: number; absent_days: number; late_days: number; transfer_days: number };
type RecordingCounts = { count: number; watched_minutes: number; completed: number };
type Report = {
  month: string;
  is_current_month: boolean;
  summary: string;
  months: { newest: string; oldest: string };
  student: { id: string; name: string; grade: string };
  sections: {
    attendance: Section<{ current: AttendanceCounts; previous: AttendanceCounts }>;
    recordings: Section<{ current: RecordingCounts; previous: RecordingCounts; truncated: boolean }>;
    homework: Section<{ measured: boolean; period_count: number | null; previous_period_count: number | null; total_count: number | null; books_studied: number | null; last_snapshot_date: string | null }>;
    quiz: Section<{ total: number; completed: number; average_score: number | null; records: { date: string; title: string; score: number | null }[] } | null>;
    ai: Section<{ questions: number; previous_questions: number }>;
    coins: Section<{ earned: number; times: number; truncated: boolean }>;
  };
};

const currentMonthKey = () => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit' }).format(new Date()).slice(0, 7);
const shiftMonth = (key: string, diff: number) => {
  const [year, month] = key.split('-').map(Number);
  const index = year * 12 + (month - 1) + diff;
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, '0')}`;
};
const monthLabel = (key: string) => `${Number(key.slice(0, 4))}年${Number(key.slice(5, 7))}月`;

/** 前の月との違い（「先月より +3」など）。 */
function Diff({ current, previous, unit }: { current: number; previous: number | null | undefined; unit: string }) {
  if (previous === null || previous === undefined) return null;
  const diff = current - previous;
  const text = diff === 0 ? '前の月と同じ' : `前の月より${diff > 0 ? `${diff}${unit}多い` : `${-diff}${unit}少ない`}`;
  return <span className="text-xs text-fg-muted">{text}</span>;
}

function Stat({ label, value, unit, note }: { label: string; value: ReactNode; unit?: string; note?: ReactNode }) {
  return (
    <div className="rounded-btn bg-canvas p-3">
      <p className="text-xs font-bold text-fg-muted">{label}</p>
      <p className="text-2xl font-black tabular-nums text-fg">{value}{unit && <span className="ml-0.5 text-xs font-bold text-fg-muted">{unit}</span>}</p>
      {note && <div className="mt-0.5">{note}</div>}
    </div>
  );
}

function ReportSection({ icon, title, description, tone, failed, children }: {
  icon: LucideIcon; title: string; description?: string; tone: 'navy' | 'amber' | 'emerald' | 'sky' | 'rose' | 'violet'; failed?: boolean; children: ReactNode;
}) {
  return (
    <ParentCard as="section" className="report-section">
      <ParentSectionTitle icon={icon} title={title} description={description} tone={tone} />
      {failed ? <ErrorState title="この項目を読み込めませんでした" message="時間をおいて、もう一度開いてください。" /> : children}
    </ParentCard>
  );
}

/** 保護者向け：月ごとの学習レポート（印刷・PDF保存できる）。 */
export default function ParentReportPage() {
  const { user } = useAuth();
  const { visibility } = usePortalVisibility('parent');
  const [students, setStudents] = useState<Student[]>([]);
  const [studentId, setStudentId] = useState('');
  const [month, setMonth] = useState(currentMonthKey);
  const [report, setReport] = useState<Report | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [studentsError, setStudentsError] = useState('');
  const [studentsReload, setStudentsReload] = useState(0);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    if (!user) return;
    let active = true;
    setStudentsError('');
    (async () => {
      try {
        const response = await fetch('/api/parent/dashboard', { headers: { Authorization: `Bearer ${await user.getIdToken()}` }, cache: 'no-store' });
        const data = await response.json().catch(() => ({}));
        if (!response.ok || !data.ok) throw new Error(data.error || 'failed');
        if (!active) return;
        const list: Student[] = Array.isArray(data.students) ? data.students : [];
        setStudents(list);
        setStudentId(current => pickChildId(user.uid, list.map(student => student.id), current));
        if (list.length === 0) setLoading(false);
      } catch {
        if (active) { setStudentsError('お子さまの情報を読み込めませんでした。通信状態を確認して、もう一度お試しください。'); setLoading(false); }
      }
    })();
    return () => { active = false; };
  }, [user, studentsReload]);

  useEffect(() => {
    if (!user || !studentId) return;
    let active = true;
    setLoading(true);
    setError('');
    (async () => {
      try {
        const params = new URLSearchParams({ student_id: studentId, month });
        const response = await fetch(`/api/parent/report?${params}`, { headers: { Authorization: `Bearer ${await user.getIdToken()}` }, cache: 'no-store' });
        const data = await response.json().catch(() => ({}));
        if (!response.ok || !data.ok) throw new Error(data.error || 'failed');
        if (active) setReport(data as Report);
      } catch {
        if (active) { setReport(null); setError('レポートを読み込めませんでした。通信状態を確認して、もう一度お試しください。'); }
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, [user, studentId, month, reload]);

  const newest = report?.months.newest || currentMonthKey();
  const oldest = report?.months.oldest || shiftMonth(newest, -24);
  const studentName = report?.student.name || students.find(student => student.id === studentId)?.student_name || 'お子さま';
  const showAttendance = visibility.attendance !== false;
  const showRecordings = visibility.recordings !== false;
  const showHomework = visibility.homework !== false;
  const showAi = Boolean(visibility.aiMessages);

  const header = (
    <ParentPageHeader
      eyebrow="学習のようす"
      title="月のレポート"
      description="1か月の授業の参加・録画・宿題などを、まとめて確認できます。印刷やPDFでの保存もできます。"
      icon={FileText}
      actions={report && !loading ? (
        <Button variant="secondary" icon={<Printer size={16} aria-hidden />} onClick={() => window.print()} className="report-no-print">
          印刷・PDFで保存
        </Button>
      ) : undefined}
    />
  );

  if (studentsError) {
    return (
      <div className="space-y-5">
        {header}
        <ErrorState message={studentsError} onRetry={() => { setLoading(true); setStudentsReload(value => value + 1); }} />
      </div>
    );
  }

  if (!loading && students.length === 0) {
    return (
      <div className="space-y-5">
        {header}
        <ParentCard><ParentEmpty icon={Users} title="紐づくお子さまがまだ登録されていません" description="お手数ですが、通塾中の校舎へ保護者アカウントの紐づけをご依頼ください。" /></ParentCard>
      </div>
    );
  }

  const sections = report?.sections;

  return (
    <div className="report-root space-y-5">
      {header}

      <div className="report-no-print">
        <ChildSwitcher options={students.map(student => ({ id: student.id, name: student.student_name, grade: student.grade }))} value={studentId} onChange={setStudentId} />
      </div>

      <ParentCard className="report-section">
        <div className="flex items-center justify-between gap-3">
          <IconButton label="前の月" variant="secondary" className="report-no-print" onClick={() => setMonth(shiftMonth(month, -1))} disabled={loading || month <= oldest}><ChevronLeft size={18} aria-hidden /></IconButton>
          <div className="text-center">
            <p className="text-sm text-fg-muted">{studentName}さん</p>
            <p className="text-xl font-black text-fg">{monthLabel(month)}のレポート</p>
          </div>
          <IconButton label="次の月" variant="secondary" className="report-no-print" onClick={() => setMonth(shiftMonth(month, 1))} disabled={loading || month >= newest}><ChevronRight size={18} aria-hidden /></IconButton>
        </div>
        {report && !loading && !error && (
          <p className="mt-4 rounded-btn bg-accent-soft px-4 py-3 text-base font-bold leading-relaxed text-fg">{report.summary}</p>
        )}
      </ParentCard>

      {error ? (
        <ErrorState message={error} onRetry={() => setReload(value => value + 1)} />
      ) : loading || !sections ? (
        <ListSkeleton rows={4} />
      ) : (
        <div className="grid gap-5 lg:grid-cols-2 print:block print:space-y-4">
          {showAttendance && (
            <ReportSection icon={CalendarCheck} title="出席" description="Zoomで授業に参加した日と、欠席・遅刻・振替の連絡" tone="emerald" failed={!sections.attendance.ok}>
              {sections.attendance.ok && (
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-2 xl:grid-cols-4 print:grid-cols-4">
                  <Stat label="Zoomで参加" value={sections.attendance.data.current.live_days} unit="日" note={<Diff current={sections.attendance.data.current.live_days} previous={sections.attendance.data.previous.live_days} unit="日" />} />
                  <Stat label="欠席" value={sections.attendance.data.current.absent_days} unit="日" />
                  <Stat label="遅刻" value={sections.attendance.data.current.late_days} unit="日" />
                  <Stat label="振替" value={sections.attendance.data.current.transfer_days} unit="日" />
                </div>
              )}
            </ReportSection>
          )}

          {showRecordings && (
            <ReportSection icon={MonitorPlay} title={TERMS.recording} description={`この月に見た授業の${TERMS.recording}`} tone="sky" failed={!sections.recordings.ok}>
              {sections.recordings.ok && (
                <>
                  <div className="grid grid-cols-2 gap-2">
                    <Stat label="見た本数" value={sections.recordings.data.current.count} unit="本" note={<Diff current={sections.recordings.data.current.count} previous={sections.recordings.data.previous.count} unit="本" />} />
                    <Stat label="見た時間" value={sections.recordings.data.current.watched_minutes} unit="分" note={sections.recordings.data.current.completed ? <span className="text-xs text-fg-muted">最後まで見た {sections.recordings.data.current.completed}本</span> : undefined} />
                  </div>
                  <p className="mt-3 text-xs leading-relaxed text-fg-muted">見た時間は、実際に再生していた時間です。同じ{TERMS.recording}を何か月かに分けて見たときは、合計の時間になります。</p>
                </>
              )}
            </ReportSection>
          )}

          {showHomework && (
            <ReportSection icon={BookOpenCheck} title={`${TERMS.homework}（Monoxer）`} description="教室で学習記録を取り込んだ日までの回数です" tone="navy" failed={!sections.homework.ok}>
              {sections.homework.ok && (sections.homework.data.measured || sections.homework.data.total_count !== null ? (
                <>
                  <div className="grid grid-cols-3 gap-2">
                    <Stat label="この月の学習回数" value={sections.homework.data.period_count ?? '—'} unit={sections.homework.data.period_count === null ? undefined : '回'} note={sections.homework.data.period_count !== null ? <Diff current={sections.homework.data.period_count} previous={sections.homework.data.previous_period_count} unit="回" /> : undefined} />
                    <Stat label="これまでの合計" value={sections.homework.data.total_count ?? '—'} unit={sections.homework.data.total_count === null ? undefined : '回'} />
                    <Stat label="取り組んだBook" value={sections.homework.data.books_studied ?? '—'} unit={sections.homework.data.books_studied === null ? undefined : '冊'} />
                  </div>
                  {sections.homework.data.last_snapshot_date && <p className="mt-3 text-xs text-fg-muted">{formatDate(sections.homework.data.last_snapshot_date)}までの記録</p>}
                </>
              ) : (
                <p className="text-sm text-fg-muted">この月の{TERMS.homework}の記録はまだありません。</p>
              ))}
            </ReportSection>
          )}

          {showHomework && (!sections.quiz.ok || sections.quiz.data) && (
            <ReportSection icon={PencilLine} title="小テスト" tone="amber" failed={!sections.quiz.ok}>
              {sections.quiz.ok && sections.quiz.data && (
                <>
                  <div className="grid grid-cols-2 gap-2">
                    <Stat label="受けた回数" value={sections.quiz.data.completed} unit="回" note={<span className="text-xs text-fg-muted">予定 {sections.quiz.data.total}回</span>} />
                    <Stat label="平均点" value={sections.quiz.data.average_score ?? '—'} unit={sections.quiz.data.average_score === null ? undefined : '点'} />
                  </div>
                  <ul className="mt-3 divide-y divide-line text-sm">
                    {sections.quiz.data.records.map((record, index) => (
                      <li key={`${record.date}-${index}`} className="flex items-center justify-between gap-3 py-2">
                        <span className="min-w-0"><span className="mr-2 text-xs text-fg-muted">{formatDate(record.date)}</span>{record.title}</span>
                        <span className="shrink-0 font-bold tabular-nums">{record.score === null ? '—' : `${record.score}点`}</span>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </ReportSection>
          )}

          {showAi && (
            <ReportSection icon={Bot} title="AI学習" description="AIの先生に質問した回数" tone="violet" failed={!sections.ai.ok}>
              {sections.ai.ok && (
                <div className="grid grid-cols-2 gap-2">
                  <Stat label="質問した回数" value={sections.ai.data.questions} unit="回" note={<Diff current={sections.ai.data.questions} previous={sections.ai.data.previous_questions} unit="回" />} />
                </div>
              )}
            </ReportSection>
          )}

          <ReportSection icon={Coins} title={TERMS.coin} description={`授業や宿題をがんばると増える${TERMS.coin}`} tone="amber" failed={!sections.coins.ok}>
            {sections.coins.ok && (
              <div className="grid grid-cols-2 gap-2">
                <Stat label={`この月に増えた${TERMS.coin}`} value={`${sections.coins.data.earned.toLocaleString('ja-JP')}${sections.coins.data.truncated ? '以上' : ''}`} unit={TERMS.coin} />
              </div>
            )}
          </ReportSection>
        </div>
      )}

      <style jsx global>{`
        @media print {
          @page { size: A4 portrait; margin: 12mm; }
          html, body { background: #fff !important; }
          [data-portal='parent'] { min-height: 0 !important; background: #fff !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
          [data-portal='parent'] > header,
          [data-portal='parent'] > nav,
          [data-portal='parent'] > div.fixed,
          .report-no-print { display: none !important; }
          [data-portal='parent'] > main { max-width: none !important; width: 100% !important; padding: 0 !important; margin: 0 !important; }
          .report-root { width: 186mm; margin: 0 auto; }
          .report-section { break-inside: avoid; page-break-inside: avoid; box-shadow: none !important; }
        }
      `}</style>
    </div>
  );
}
