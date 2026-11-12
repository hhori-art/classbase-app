'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Camera, Download, RefreshCw } from 'lucide-react';
import { useAuth } from '@/app/context/AuthContext';
import AdminPageHeader from '@/app/components/master/AdminPageHeader';
import AdminTabs from '@/app/components/master/AdminTabs';
import { Button, Card, EmptyState, ErrorState, IconButton, ListSkeleton } from '@/app/components/ui';
import { formatDate } from '@/lib/format';
import { userErrorMessage } from '@/lib/user-error';
import { downloadCsv } from '@/lib/csv-export';
import type { CameraMonitorRule } from '@/lib/camera-time';

type TeacherRow = { id: string; teacher_name: string; lessons: number; records: number; off: number; camera_minutes: number; present_minutes: number; rate: number | null };
type LessonRow = { id: string; date: string; period: number; teacher_name: string; label: string; records: number; off: number; camera_minutes: number; present_minutes: number; rate: number | null };
type StreakRow = { student_id: string; student_name: string; grade: string; classroom: string; streak: number; since: string; recent_rate: number | null; last_date: string };
type Data = {
  days: number;
  since: string;
  rule: CameraMonitorRule;
  totals: { records: number; rate: number | null; off: number; lessons: number; teachers: number };
  teachers: TeacherRow[];
  lessons: LessonRow[];
  streaks: StreakRow[];
};
type Tab = 'teachers' | 'lessons' | 'streaks';

const DAY_OPTIONS = [7, 30, 90] as const;
const rateText = (rate: number | null) => (rate === null ? '—' : `${rate}%`);
const rateTone = (rate: number | null, rule: CameraMonitorRule) => {
  if (rate === null) return 'text-fg-muted';
  if (rate < rule.off_rate_percent) return 'text-rose-700';
  if (rate < 60) return 'text-amber-700';
  return 'text-emerald-700';
};

function RateBar({ rate }: { rate: number | null }) {
  return (
    <span className="block h-2 w-full overflow-hidden rounded-full bg-canvas" aria-hidden>
      <span className="block h-full rounded-full bg-accent" style={{ width: `${rate ?? 0}%` }} />
    </span>
  );
}

/**
 * 授業のカメラON率（マスターだけ）。毎晩 Zoom から読んだ記録を、先生ごと・授業ごとに集計し、
 * 続けてカメラがオフの生徒を出す。カメラを隠してオンにもできるので、評価やご褒美ではなく様子を見るための目安。
 */
export default function CameraRatesPage() {
  const { user, profile } = useAuth();
  const isMaster = profile?.role === 'master';
  const [tab, setTab] = useState<Tab>('teachers');
  const [days, setDays] = useState<number>(30);
  const [data, setData] = useState<Data | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    if (!user || !isMaster) return;
    setLoading(true);
    setError('');
    try {
      const token = await user.getIdToken();
      const response = await fetch(`/api/admin/camera-rates?days=${days}`, { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' });
      const body = await response.json().catch(() => ({}));
      if (!response.ok || body.ok === false) throw new Error(body.error || '読み込めませんでした。');
      setData(body as Data);
    } catch (loadError) {
      setError(userErrorMessage(loadError, '読み込めませんでした。'));
    } finally {
      setLoading(false);
    }
  }, [days, isMaster, user]);

  useEffect(() => { if (isMaster) void load(); else setLoading(false); }, [isMaster, load]);

  const today = useMemo(() => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Tokyo' }).format(new Date()).replace(/-/g, ''), []);
  const saveCsv = () => {
    if (!data) return;
    if (tab === 'teachers') {
      downloadCsv(`カメラON率_先生ごと_${today}.csv`, ['先生', '授業数', '生徒の記録数', 'ON率(%)', 'オフの記録数', 'カメラONの分', '参加の分'],
        data.teachers.map(row => [row.teacher_name, row.lessons, row.records, row.rate ?? '', row.off, row.camera_minutes, row.present_minutes]));
    } else if (tab === 'lessons') {
      downloadCsv(`カメラON率_授業ごと_${today}.csv`, ['授業日', '時限', '先生', '授業', '生徒数', 'ON率(%)', 'オフの生徒数', 'カメラONの分', '参加の分'],
        data.lessons.map(row => [row.date, row.period || '', row.teacher_name, row.label, row.records, row.rate ?? '', row.off, row.camera_minutes, row.present_minutes]));
    } else {
      downloadCsv(`カメラ_続けてオフの生徒_${today}.csv`, ['生徒', '学年', '校舎', '続けてオフ(回)', 'オフが始まった日', '直近のON率(%)', '最後の授業日'],
        data.streaks.map(row => [row.student_name, row.grade, row.classroom, row.streak, row.since, row.recent_rate ?? '', row.last_date]));
    }
  };

  if (!isMaster) {
    return <EmptyState icon={Camera} title="授業のカメラON率は、マスターだけが見られます" />;
  }

  const rule = data?.rule;
  return (
    <div className="space-y-5">
      <AdminPageHeader
        title="授業のカメラON率"
        icon={Camera}
        description="毎晩、その日の授業でカメラがオンだった分数をZoomから読んで集計します。授業ボタンから入った生徒だけが対象です。カメラを隠してオンにもできるので、評価ではなく、様子の変化に気づくための目安として見てください。"
        actions={<IconButton label="読み込み直す" variant="secondary" onClick={() => void load()} disabled={loading}><RefreshCw size={18} className={loading ? 'motion-safe:animate-spin' : ''} /></IconButton>}
      />
      <AdminTabs
        value={tab}
        onChange={value => setTab(value as Tab)}
        tabs={[
          { id: 'teachers', label: '先生ごと' },
          { id: 'lessons', label: '授業ごと' },
          { id: 'streaks', label: '続けてオフの生徒', badge: data?.streaks.length || undefined },
        ]}
      />

      {loading ? <ListSkeleton rows={4} /> : error ? <ErrorState message={error} onRetry={() => void load()} /> : !data || !rule ? null : (
        <>
          <Card className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm font-bold text-fg">
            <span className="inline-flex items-center gap-1">
              {DAY_OPTIONS.map(option => (
                <button key={option} type="button" aria-pressed={days === option} onClick={() => setDays(option)}
                  className={`min-h-9 rounded-full border px-3 text-xs font-bold ${days === option ? 'border-accent bg-accent-soft text-accent' : 'border-line bg-surface text-fg-muted'}`}>
                  直近{option}日
                </button>
              ))}
            </span>
            <span>全体のON率 <span className={rateTone(data.totals.rate, rule)}>{rateText(data.totals.rate)}</span></span>
            <span>{data.totals.lessons}授業・のべ{data.totals.records}人</span>
            <span className="text-rose-700">オフの記録 {data.totals.off}件</span>
            <Button size="sm" variant="secondary" className="ml-auto" icon={<Download size={15} aria-hidden />} onClick={saveCsv}>CSVで保存</Button>
          </Card>
          <p className="text-xs font-bold text-fg-muted">
            ON率は「カメラONの分 ÷ 参加していた分」。参加が{rule.min_present_minutes}分未満の記録は入れていません。
            ON率が{rule.off_rate_percent}%未満の授業を「オフ」とし、{rule.streak_lessons}回続くと講師の声かけリストにも出ます（設定画面で変えられます）。
          </p>

          {tab === 'teachers' && (data.teachers.length === 0 ? <EmptyState icon={Camera} title="まだ記録がありません" description="毎晩22時50分に、その日の授業の分を読み込みます。" /> : (
            <Card padded={false} className="overflow-x-auto">
              <table className="w-full min-w-[560px] text-sm">
                <thead className="bg-canvas text-left text-xs font-bold text-fg-muted">
                  <tr><th className="px-4 py-2">先生</th><th className="px-4 py-2">授業数</th><th className="px-4 py-2">のべ人数</th><th className="w-48 px-4 py-2">ON率</th><th className="px-4 py-2">オフ</th></tr>
                </thead>
                <tbody>
                  {data.teachers.map(row => (
                    <tr key={row.id} className="border-t border-line">
                      <td className="px-4 py-2 font-bold text-fg">{row.teacher_name}</td>
                      <td className="px-4 py-2">{row.lessons}</td>
                      <td className="px-4 py-2">{row.records}</td>
                      <td className="px-4 py-2"><span className={`font-bold ${rateTone(row.rate, rule)}`}>{rateText(row.rate)}</span><RateBar rate={row.rate} /></td>
                      <td className="px-4 py-2">{row.off}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          ))}

          {tab === 'lessons' && (data.lessons.length === 0 ? <EmptyState icon={Camera} title="まだ記録がありません" /> : (
            <Card padded={false} className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-sm">
                <thead className="bg-canvas text-left text-xs font-bold text-fg-muted">
                  <tr><th className="px-4 py-2">授業日</th><th className="px-4 py-2">授業</th><th className="px-4 py-2">先生</th><th className="px-4 py-2">人数</th><th className="w-40 px-4 py-2">ON率</th><th className="px-4 py-2">オフ</th></tr>
                </thead>
                <tbody>
                  {data.lessons.map(row => (
                    <tr key={row.id} className="border-t border-line">
                      <td className="whitespace-nowrap px-4 py-2">{formatDate(row.date)}{row.period ? ` ${row.period}限` : ''}</td>
                      <td className="px-4 py-2 font-bold text-fg">{row.label || '—'}</td>
                      <td className="px-4 py-2">{row.teacher_name}</td>
                      <td className="px-4 py-2">{row.records}</td>
                      <td className="px-4 py-2"><span className={`font-bold ${rateTone(row.rate, rule)}`}>{rateText(row.rate)}</span><RateBar rate={row.rate} /></td>
                      <td className="px-4 py-2">{row.off}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          ))}

          {tab === 'streaks' && (data.streaks.length === 0 ? <EmptyState icon={Camera} title="続けてカメラがオフの生徒はいません" description={`直近8週で、${rule.streak_lessons}回以上続けてオフの生徒を出します。`} /> : (
            <Card padded={false} className="overflow-x-auto">
              <table className="w-full min-w-[560px] text-sm">
                <thead className="bg-canvas text-left text-xs font-bold text-fg-muted">
                  <tr><th className="px-4 py-2">生徒</th><th className="px-4 py-2">学年・校舎</th><th className="px-4 py-2">続けてオフ</th><th className="px-4 py-2">いつから</th><th className="px-4 py-2">直近のON率</th></tr>
                </thead>
                <tbody>
                  {data.streaks.map(row => (
                    <tr key={row.student_id} className="border-t border-line">
                      <td className="px-4 py-2 font-bold text-fg">{row.student_name}</td>
                      <td className="px-4 py-2 text-fg-muted">{[row.grade, row.classroom].filter(Boolean).join(' ・ ') || '—'}</td>
                      <td className="px-4 py-2 font-bold text-rose-700">{row.streak}回</td>
                      <td className="whitespace-nowrap px-4 py-2">{row.since ? formatDate(row.since) : '—'}</td>
                      <td className="px-4 py-2">{rateText(row.recent_rate)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          ))}
        </>
      )}
    </div>
  );
}
