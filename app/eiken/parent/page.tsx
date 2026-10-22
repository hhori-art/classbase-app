'use client';

import { useCallback, useEffect, useState } from 'react';
import { BookOpenCheck, CalendarClock, CheckCircle2, ClipboardList, Languages, Megaphone, TrendingUp } from 'lucide-react';
import EikenCalendar from '@/app/components/eiken/EikenCalendar';
import ChildSwitcher, { pickChildId } from '@/app/components/parent/ChildSwitcher';
import { Card, EmptyState, ErrorState, PageHeader, SectionTitle, Skeleton } from '@/app/components/ui';
import { useAuth } from '@/app/context/AuthContext';
import { useEikenApi } from '@/app/eiken/useEikenApi';
import { formatDate, formatDateTime } from '@/lib/format';
import { TERMS } from '@/lib/glossary';

/** 確認テストの技能タグ（教材側で自由に付けるコード）を保護者向けの言葉にする。知らないタグはそのまま出す。 */
const SKILL_LABELS: Record<string, string> = {
  general: '総合',
  vocabulary: '語彙', vocab: '語彙', word: '語彙', words: '語彙',
  idiom: '熟語', idioms: '熟語',
  grammar: '文法',
  reading: 'リーディング',
  listening: 'リスニング',
  writing: 'ライティング',
  speaking: 'スピーキング',
  interview: '面接',
  conversation: '会話',
};
const skillLabel = (skill: string) => SKILL_LABELS[skill.trim().toLowerCase()] || skill;

export default function EikenParentPage() {
  const api = useEikenApi();
  const { user } = useAuth();
  const [data, setData] = useState<any>(null);
  const [selectedStudentId, setSelectedStudentId] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async (studentId?: string) => {
    setLoading(true);
    setError('');
    try {
      const result = await api<any>(`/api/eiken/dashboard${studentId ? `?student_id=${encodeURIComponent(studentId)}` : ''}`);
      // 最初は、保護者画面で最後に選んだお子さまを表示する。
      if (!studentId) {
        const ids = Array.isArray(result.students) ? result.students.map((student: any) => String(student.id)) : [];
        const preferred = pickChildId(user?.uid, ids, result.selected_student_id || '');
        if (preferred && preferred !== result.selected_student_id) {
          await load(preferred);
          return;
        }
      }
      setData(result);
      setSelectedStudentId(result.selected_student_id || '');
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : '進捗を取得できませんでした。');
    } finally {
      setLoading(false);
    }
  }, [api, user?.uid]);

  useEffect(() => {
    load();
  }, [load]);

  const dashboard = data?.dashboard;
  const latestQuiz = dashboard?.quiz_results?.[0];
  const importantTasks = (dashboard?.today_tasks || []).filter((task: any) => task.is_required !== false);
  const students: { id: string; name?: string }[] = Array.isArray(data?.students) ? data.students.map((student: any) => ({ id: String(student.id), name: student.name })) : [];
  const studentName = students.find(student => student.id === selectedStudentId)?.name;

  return (
    <main className="mx-auto max-w-5xl space-y-section px-4 py-6 pb-16">
      <PageHeader
        tone="hero"
        icon={Languages}
        eyebrow="保護者ページ"
        title="Boosterの取り組み状況"
        description={`${studentName ? `${studentName}さんの` : ''}今週の様子と次の予定を確認できます。`}
      />

      <ChildSwitcher options={students} value={selectedStudentId} onChange={id => load(id)} />

      {loading ? (
        <div className="space-y-4" role="status" aria-label="読み込み中">
          <div className="grid gap-4 sm:grid-cols-3">{[0, 1, 2].map(index => <Skeleton key={index} className="h-32 w-full rounded-card" />)}</div>
          <Skeleton className="h-48 w-full rounded-card" />
        </div>
      ) : error ? (
        <ErrorState message={error} onRetry={() => load(selectedStudentId || undefined)} />
      ) : !dashboard ? (
        <EmptyState icon={Languages} title="英検対策講座の受講情報がありません" description="受講登録が済むと、ここに取り組み状況が表示されます。" />
      ) : (
        <>
          <section className="grid gap-4 sm:grid-cols-3" aria-label="取り組みのまとめ">
            <Card>
              <span className="flex h-9 w-9 items-center justify-center rounded-btn bg-accent-soft text-accent"><CheckCircle2 size={18} aria-hidden /></span>
              <p className="mt-3 text-sm font-bold text-fg-muted">講座の進捗</p>
              <p className="mt-1 text-3xl font-black tabular-nums text-fg">{dashboard.progress_summary?.completion_rate || 0}<span className="ml-1 text-sm font-bold text-fg-muted">%</span></p>
            </Card>
            <Card>
              <span className="flex h-9 w-9 items-center justify-center rounded-btn bg-info-soft text-info"><TrendingUp size={18} aria-hidden /></span>
              <p className="mt-3 text-sm font-bold text-fg-muted">完了した学習</p>
              <p className="mt-1 text-3xl font-black tabular-nums text-fg">{dashboard.progress_summary?.completed_count || 0}<span className="ml-1 text-sm font-bold text-fg-muted">件</span></p>
            </Card>
            <Card>
              <span className="flex h-9 w-9 items-center justify-center rounded-btn bg-warning-soft text-warning"><ClipboardList size={18} aria-hidden /></span>
              <p className="mt-3 text-sm font-bold text-fg-muted">最新の確認テスト</p>
              <p className="mt-1 text-3xl font-black tabular-nums text-fg">{latestQuiz?.percentage ?? '--'}<span className="ml-1 text-sm font-bold text-fg-muted">%</span></p>
            </Card>
          </section>

          <Card>
            <SectionTitle icon={BookOpenCheck} title="次に取り組む内容" />
            {importantTasks.length ? (
              <ul className="divide-y divide-line">
                {importantTasks.map((task: any) => (
                  <li key={task.id} className="py-3 first:pt-0 last:pb-0">
                    <p className="font-bold text-fg">{task.title}</p>
                    <p className="mt-1 text-sm text-fg-muted">目安 {task.estimated_minutes || '--'}分</p>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState icon={BookOpenCheck} title="現在、優先して取り組む学習はありません" />
            )}
          </Card>

          <Card>
            <SectionTitle icon={TrendingUp} title="確認テストの推移" />
            {dashboard.quiz_results?.length ? (
              <div className="-mx-1 overflow-x-auto px-1">
                <table className="w-full min-w-[520px] text-left text-sm">
                  <thead className="border-b border-line text-xs text-fg-muted"><tr><th className="px-3 py-2 font-bold">受験日</th><th className="px-3 py-2 font-bold">結果</th><th className="px-3 py-2 font-bold">技能別</th></tr></thead>
                  <tbody className="divide-y divide-line">
                    {(dashboard.quiz_results || []).map((result: any) => (
                      <tr key={result.id}>
                        <td className="px-3 py-3">{formatDate(result.submitted_at, { withYear: true }) || '-'}</td>
                        <td className="px-3 py-3 font-bold tabular-nums">{result.percentage}%</td>
                        <td className="px-3 py-3 text-sm text-fg-muted">{Object.entries(result.skill_scores || {}).map(([skill, score]) => `${skillLabel(skill)}：${score}%`).join(' / ') || '-'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <EmptyState icon={ClipboardList} title="確認テストの結果はまだありません" description="確認テストの受験後、結果の推移が表示されます。" />
            )}
          </Card>

          <Card>
            <SectionTitle icon={CalendarClock} title="次回のLIVE授業" />
            {dashboard.upcoming_lessons?.length ? (
              <ul className="divide-y divide-line">
                {(dashboard.upcoming_lessons || []).slice(0, 3).map((lesson: any) => (
                  <li key={lesson.id} className="py-3 first:pt-0 last:pb-0">
                    <p className="font-bold text-fg">{lesson.title}</p>
                    <p className="mt-1 text-sm text-fg-muted">{lesson.start_at ? formatDateTime(lesson.start_at, { withYear: true }) : formatDate(lesson.lesson_date, { withYear: true })}</p>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState icon={CalendarClock} title="現在、予定されているLIVE授業はありません" />
            )}
          </Card>

          <EikenCalendar events={dashboard.calendar_events || []} />

          <Card>
            <SectionTitle icon={Megaphone} title={TERMS.news} />
            {dashboard.announcements?.length ? (
              <ul className="divide-y divide-line">
                {(dashboard.announcements || []).map((item: any) => (
                  <li key={item.id} className="py-3 first:pt-0 last:pb-0">
                    <h3 className="font-bold text-fg">{item.title}</h3>
                    <p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-fg-muted">{item.body}</p>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState icon={Megaphone} title="新しいお知らせはありません" />
            )}
          </Card>
        </>
      )}
    </main>
  );
}
