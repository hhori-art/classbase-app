'use client';

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import {
  AlertTriangle, BookOpenCheck, CalendarX2, Coins, GraduationCap, MessageCircle, UserRound, Video, type LucideIcon,
} from 'lucide-react';
import AdminPageHeader from '@/app/components/master/AdminPageHeader';
import StudentSearchBox from '@/app/components/master/StudentSearchBox';
import { Card, EmptyState, ErrorState, ListSkeleton, SectionTitle, StatusPill, type StatusTone } from '@/app/components/ui';
import { useAuth } from '@/app/context/AuthContext';
import { isBlockedForSchoolAdmin, isMasterOnlyAdminPath } from '@/lib/admin-app-permissions';
import { formatDate, formatDateTime } from '@/lib/format';
import { TERMS } from '@/lib/glossary';

type Section<T> = { ok: true; data: T } | { ok: false; error: string };

type Profile = {
  id: string; name: string; kana: string; grade: string; school_name: string; lifetime_id: string; inactive: boolean;
  account_status: string; created_at: string | null; last_login_at: string | null;
  registrations: Array<{ id: string; type: string; year: number | null; term: string; labels: string[]; status: string; updated_at: string | null }>;
  fallback_course_labels: string[];
  parents: Array<{ id: string; name: string; login_id: string; line_linked: boolean; inactive: boolean }>;
};
type RequestItem = {
  id: string; type: 'absence' | 'transfer'; kind: string; target_date: string; absence_date: string; subject: string;
  course_name: string; reason: string; status: string; transfer_status: string; created_at: string | null;
};
type Overview = {
  viewer: { is_master: boolean };
  hidden_sections: string[];
  sections: {
    profile: Section<Profile>;
    requests: Section<{ absences: RequestItem[]; transfers: RequestItem[] }>;
    coins: Section<{ balance: number; total_earned: number; transactions: Array<{ id: string; amount: number; reason: string; source: string; created_at: string | null }> }>;
    attendance: Section<Array<{ id: string; date: string; absent: boolean; subjects: string[]; joined_at: string | null }>>;
    recordings: Section<Array<{ id: string; title: string; subject: string; target_date: string; watched_seconds: number; duration_seconds: number; completed: boolean; updated_at: string | null }>>;
    monoxer: Section<{
      imported: boolean;
      week: { measured: boolean; period_count: number | null; total_count: number | null; last_snapshot_date: string | null } | null;
      month: { measured: boolean; period_count: number | null; total_count: number | null; last_snapshot_date: string | null } | null;
      history: Array<{ date: string; total: number; gained: number | null }>;
    }>;
    parent_contacts?: Section<Array<{ id: string; subject: string; parent_name: string; status: string; message_count: number; unread_for_admin: boolean; updated_at: string | null }>>;
    safety_alerts?: Section<Array<{ id: string; category_label: string; severity: string; status: string; occurrence_count: number; last_detected_at: string | null }>>;
  };
};

const REQUEST_STATUS: Record<string, { label: string; tone: StatusTone }> = {
  pending: { label: '未対応', tone: 'warning' },
  open: { label: '未対応', tone: 'warning' },
  in_progress: { label: '対応中', tone: 'info' },
  confirmed: { label: '確定', tone: 'success' },
  approved: { label: '対応済み', tone: 'success' },
  completed: { label: '対応済み', tone: 'success' },
  resolved: { label: '対応済み', tone: 'success' },
  rejected: { label: '見送り', tone: 'danger' },
  cancelled: { label: '取り消し', tone: 'neutral' },
};
const statusPill = (status: string) => {
  const item = REQUEST_STATUS[status] || { label: status || '—', tone: 'neutral' as StatusTone };
  return <StatusPill tone={item.tone}>{item.label}</StatusPill>;
};
const minutes = (seconds: number) => `${Math.round(seconds / 60)}分`;

function OverviewSection<T>({ icon, title, description, href, canOpen, section, empty, children }: {
  icon: LucideIcon;
  title: string;
  description?: string;
  href?: string;
  canOpen: (href: string) => boolean;
  section: Section<T> | undefined;
  /** データが空のときに true を返す。 */
  empty: (data: T) => boolean;
  children: (data: T) => ReactNode;
}) {
  const link = href && canOpen(href)
    ? <Link href={href} className="inline-flex min-h-9 items-center rounded-btn px-3 text-xs font-bold text-accent hover:bg-accent-soft">すべて見る</Link>
    : null;
  return (
    <Card>
      <SectionTitle icon={icon} title={title} description={description} trailing={link} />
      {!section ? null : !section.ok ? (
        <ErrorState title={`${title}を読み込めませんでした`} message="時間をおいて、もう一度開いてください。" />
      ) : empty(section.data) ? (
        <EmptyState title="まだありません" className="py-6" />
      ) : children(section.data)}
    </Card>
  );
}

export default function StudentOverviewPage() {
  const params = useParams<{ id: string }>();
  const studentId = decodeURIComponent(String(params?.id || ''));
  const { user, profile: viewerProfile } = useAuth();
  const [overview, setOverview] = useState<Overview | null>(null);
  const [error, setError] = useState<'forbidden' | 'not-found' | 'failed' | null>(null);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    if (!user || !studentId) return;
    let active = true;
    setOverview(null);
    setError(null);
    (async () => {
      try {
        const res = await fetch(`/api/admin/students/${encodeURIComponent(studentId)}/overview`, {
          headers: { Authorization: `Bearer ${await user.getIdToken()}` }, cache: 'no-store',
        });
        const body = await res.json().catch(() => ({}));
        if (!active) return;
        if (res.status === 403) { setError('forbidden'); return; }
        if (res.status === 404) { setError('not-found'); return; }
        if (!res.ok || !body.ok) throw new Error(body.error || 'overview-failed');
        setOverview(body as Overview);
      } catch {
        if (active) setError('failed');
      }
    })();
    return () => { active = false; };
  }, [user, studentId, reload]);

  const isMaster = viewerProfile?.role === 'master';
  // 専用画面へのリンクは、その画面を開ける管理者にだけ出す（校舎管理者は理社講座の許可された画面だけ）。
  const canOpen = useCallback((href: string) => isMaster || (!isMasterOnlyAdminPath(href) && !isBlockedForSchoolAdmin(href)), [isMaster]);

  const profileSection = overview?.sections.profile;
  const student = profileSection?.ok ? profileSection.data : null;

  return (
    <div className="mx-auto max-w-6xl">
      <AdminPageHeader
        title={student ? `${student.name} さん` : '生徒の総合ページ'}
        icon={UserRound}
        description={student ? [student.school_name, student.grade, student.lifetime_id && `ID ${student.lifetime_id}`].filter(Boolean).join(' ・ ') : undefined}
        backHref="/master/students"
        actions={<StudentSearchBox className="w-full sm:w-72" />}
      />

      {error === 'forbidden' ? (
        <EmptyState icon={AlertTriangle} title="この生徒の情報は表示できません" description="担当の校舎の生徒だけを表示できます。" />
      ) : error === 'not-found' ? (
        <EmptyState icon={UserRound} title="生徒が見つかりませんでした" description="退塾などで削除された可能性があります。" />
      ) : error ? (
        <ErrorState onRetry={() => setReload(value => value + 1)} />
      ) : !overview ? (
        <ListSkeleton rows={6} />
      ) : (
        <div className="grid gap-section lg:grid-cols-2">
          <OverviewSection icon={GraduationCap} title="プロフィール・受講講座" href="/master/school-students" canOpen={canOpen}
            section={overview.sections.profile} empty={() => false}>
            {data => (
              <div className="space-y-4 text-sm">
                <dl className="grid grid-cols-[7rem_1fr] gap-x-3 gap-y-1.5">
                  <dt className="text-fg-muted">名前</dt><dd className="font-bold text-fg">{data.name}{data.kana && <span className="ml-2 text-xs font-normal text-fg-muted">{data.kana}</span>}</dd>
                  <dt className="text-fg-muted">校舎・学年</dt><dd>{[data.school_name, data.grade].filter(Boolean).join(' ・ ') || '未設定'}</dd>
                  <dt className="text-fg-muted">ログインID</dt><dd className="font-mono">{data.lifetime_id || '未設定'}</dd>
                  <dt className="text-fg-muted">状態</dt><dd>{data.inactive ? <StatusPill tone="neutral">利用停止</StatusPill> : <StatusPill tone="success">利用中</StatusPill>}</dd>
                  {data.last_login_at && <><dt className="text-fg-muted">最終ログイン</dt><dd>{formatDateTime(data.last_login_at, { withYear: true })}</dd></>}
                </dl>
                <div>
                  <p className="mb-1.5 text-xs font-bold text-fg-muted">受講{TERMS.course}</p>
                  {data.registrations.length === 0 && data.fallback_course_labels.length === 0 ? (
                    <p className="text-fg-muted">登録されていません</p>
                  ) : (
                    <ul className="space-y-2">
                      {data.registrations.map(item => (
                        <li key={item.id} className="rounded-input border border-line p-2.5">
                          <p className="text-xs font-bold text-fg-muted">{[item.year && `${item.year}年度`, item.term, item.type === 'test_prep' ? 'テスト対策' : ''].filter(Boolean).join(' ')}</p>
                          <p className="mt-0.5">{item.labels.length ? item.labels.join('、') : '講座の選択なし'}</p>
                        </li>
                      ))}
                      {data.fallback_course_labels.length > 0 && <li className="rounded-input border border-line p-2.5">{data.fallback_course_labels.join('、')}</li>}
                    </ul>
                  )}
                </div>
                <div>
                  <p className="mb-1.5 text-xs font-bold text-fg-muted">つながっている保護者</p>
                  {data.parents.length === 0 ? <p className="text-fg-muted">登録されていません</p> : (
                    <ul className="space-y-1.5">
                      {data.parents.map(parent => (
                        <li key={parent.id} className="flex flex-wrap items-center gap-2">
                          <span className="font-bold">{parent.name}</span>
                          {parent.login_id && <span className="font-mono text-xs text-fg-muted">ID {parent.login_id}</span>}
                          {parent.line_linked && <StatusPill tone="success">LINE連携</StatusPill>}
                          {parent.inactive && <StatusPill tone="neutral">利用停止</StatusPill>}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            )}
          </OverviewSection>

          <OverviewSection icon={CalendarX2} title="最近の欠席・振替" href="/master/requests" canOpen={canOpen}
            section={overview.sections.requests} empty={data => data.absences.length + data.transfers.length === 0}>
            {data => (
              <ul className="divide-y divide-line text-sm">
                {[...data.absences, ...data.transfers]
                  .sort((a, b) => (b.target_date || '').localeCompare(a.target_date || ''))
                  .slice(0, 12)
                  .map(item => (
                    <li key={item.id} className="flex items-start justify-between gap-3 py-2.5">
                      <div className="min-w-0">
                        <p className="font-bold">
                          {item.type === 'transfer' ? '振替' : item.kind === 'late' ? '遅刻' : '欠席'}
                          <span className="ml-2 font-normal">{formatDate(item.target_date)}</span>
                        </p>
                        <p className="truncate text-xs text-fg-muted">
                          {item.type === 'transfer'
                            ? [item.subject, item.course_name, item.absence_date && `${formatDate(item.absence_date)}の欠席分`].filter(Boolean).join(' ・ ')
                            : item.reason || '理由の記入なし'}
                        </p>
                      </div>
                      {statusPill(item.status)}
                    </li>
                  ))}
              </ul>
            )}
          </OverviewSection>

          {overview.sections.parent_contacts && (
            <OverviewSection icon={MessageCircle} title={TERMS.parentContact} description="この生徒の保護者とのやりとり" href="/master/parent-inquiries" canOpen={canOpen}
              section={overview.sections.parent_contacts} empty={data => data.length === 0}>
              {data => (
                <ul className="divide-y divide-line text-sm">
                  {data.map(thread => (
                    <li key={thread.id} className="flex items-start justify-between gap-3 py-2.5">
                      <div className="min-w-0">
                        <p className="truncate font-bold">{thread.subject}</p>
                        <p className="text-xs text-fg-muted">{[thread.parent_name, `${thread.message_count}件`, formatDateTime(thread.updated_at)].filter(Boolean).join(' ・ ')}</p>
                      </div>
                      <div className="flex shrink-0 items-center gap-1.5">
                        {thread.unread_for_admin && <StatusPill tone="accent">未読</StatusPill>}
                        {statusPill(thread.status)}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </OverviewSection>
          )}

          {overview.sections.safety_alerts && (
            <OverviewSection icon={AlertTriangle} title="AIチャット安全アラート" href="/master/safety-alerts" canOpen={canOpen}
              section={overview.sections.safety_alerts} empty={data => data.length === 0}>
              {data => (
                <ul className="divide-y divide-line text-sm">
                  {data.map(alert => (
                    <li key={alert.id} className="flex items-start justify-between gap-3 py-2.5">
                      <div className="min-w-0">
                        <p className="font-bold">
                          {alert.category_label}
                          {alert.severity === 'high' && <StatusPill tone="danger" className="ml-2">緊急度 高</StatusPill>}
                        </p>
                        <p className="text-xs text-fg-muted">{formatDateTime(alert.last_detected_at)}{alert.occurrence_count > 1 ? ` ・ ${alert.occurrence_count}回` : ''}</p>
                      </div>
                      {statusPill(alert.status)}
                    </li>
                  ))}
                </ul>
              )}
            </OverviewSection>
          )}

          <OverviewSection icon={Coins} title={TERMS.coin} href="/master/rewards" canOpen={canOpen}
            section={overview.sections.coins} empty={() => false}>
            {data => (
              <div className="space-y-3 text-sm">
                <div className="flex gap-6">
                  <p><span className="block text-xs text-fg-muted">いまの残高</span><span className="text-2xl font-black text-fg">{data.balance.toLocaleString()}</span></p>
                  <p><span className="block text-xs text-fg-muted">これまでに獲得</span><span className="text-2xl font-black text-fg-muted">{data.total_earned.toLocaleString()}</span></p>
                </div>
                {data.transactions.length === 0 ? <p className="text-fg-muted">最近の増減はありません</p> : (
                  <ul className="divide-y divide-line">
                    {data.transactions.map(item => (
                      <li key={item.id} className="flex items-center justify-between gap-3 py-2">
                        <span className="min-w-0">
                          <span className="block truncate">{item.reason || item.source || '—'}</span>
                          <span className="text-xs text-fg-muted">{formatDateTime(item.created_at)}</span>
                        </span>
                        <span className={`shrink-0 font-bold ${item.amount >= 0 ? 'text-success' : 'text-danger'}`}>{item.amount >= 0 ? '+' : ''}{item.amount.toLocaleString()}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </OverviewSection>

          <OverviewSection icon={GraduationCap} title="最近の出席（Zoom参加）" description="直近60日" href="/master/science-social" canOpen={canOpen}
            section={overview.sections.attendance} empty={data => data.length === 0}>
            {data => (
              <ul className="divide-y divide-line text-sm">
                {data.map(day => (
                  <li key={day.id} className="flex items-center justify-between gap-3 py-2">
                    <span className="font-bold">{formatDate(day.date)}</span>
                    <span className="min-w-0 truncate text-right text-fg-muted">
                      {day.absent ? <StatusPill tone="warning">欠席</StatusPill> : day.subjects.join('、') || '参加'}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </OverviewSection>

          <OverviewSection icon={Video} title={`最近見た${TERMS.recording}`} href="/master/recordings" canOpen={canOpen}
            section={overview.sections.recordings} empty={data => data.length === 0}>
            {data => (
              <ul className="divide-y divide-line text-sm">
                {data.map(view => (
                  <li key={view.id} className="flex items-start justify-between gap-3 py-2">
                    <span className="min-w-0">
                      <span className="block truncate font-bold">{[view.subject, view.title].filter(Boolean).join(' ') || TERMS.recording}</span>
                      <span className="text-xs text-fg-muted">
                        {[view.target_date && `${formatDate(view.target_date)}の${TERMS.lesson}`, `${minutes(view.watched_seconds)}視聴`, view.updated_at && formatDateTime(view.updated_at)].filter(Boolean).join(' ・ ')}
                      </span>
                    </span>
                    {view.completed ? <StatusPill tone="success">最後まで</StatusPill> : <StatusPill tone="neutral">途中</StatusPill>}
                  </li>
                ))}
              </ul>
            )}
          </OverviewSection>

          <OverviewSection icon={BookOpenCheck} title={`Monoxer ${TERMS.homework}`} description="取り込んだ学習回数" href="/master/pf" canOpen={canOpen}
            section={overview.sections.monoxer} empty={data => !data.imported}>
            {data => (
              <div className="space-y-3 text-sm">
                <div className="flex flex-wrap gap-6">
                  <p><span className="block text-xs text-fg-muted">直近7日</span><span className="text-2xl font-black">{data.week?.period_count ?? '—'}</span><span className="ml-1 text-xs text-fg-muted">回</span></p>
                  <p><span className="block text-xs text-fg-muted">直近30日</span><span className="text-2xl font-black">{data.month?.period_count ?? '—'}</span><span className="ml-1 text-xs text-fg-muted">回</span></p>
                  <p><span className="block text-xs text-fg-muted">累計</span><span className="text-2xl font-black text-fg-muted">{data.month?.total_count ?? '—'}</span><span className="ml-1 text-xs text-fg-muted">回</span></p>
                </div>
                {data.history.length > 0 && (
                  <ul className="divide-y divide-line">
                    {data.history.map(entry => (
                      <li key={entry.date} className="flex items-center justify-between py-1.5">
                        <span>{formatDate(entry.date)}の取り込み</span>
                        <span className="text-fg-muted">累計 {entry.total.toLocaleString()}回{entry.gained !== null ? `（+${entry.gained.toLocaleString()}）` : ''}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </OverviewSection>

          {overview.hidden_sections.length > 0 && (
            <p className="text-xs text-fg-muted lg:col-span-2">{TERMS.parentContact}とAIチャット安全アラートは、マスター管理者だけが確認できます。</p>
          )}
        </div>
      )}
    </div>
  );
}
