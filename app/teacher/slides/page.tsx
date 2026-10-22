'use client';

import { useEffect, useMemo, useState } from 'react';
import { auth, db } from '@/lib/firebase';
import { collection, getDocs, orderBy, query, where } from 'firebase/firestore';
import { AlertCircle, BookOpen, CalendarCheck, Download, FileText, Search } from 'lucide-react';
import { useAuth } from '@/app/context/AuthContext';
import { Button, Card, PageHeader, SectionTitle, useToast, ListSkeleton, EmptyState, ErrorState } from '@/app/components/ui';
import { formatDate } from '@/lib/format';

type SlideItem = {
  id: string;
  grade?: string;
  subject?: string;
  unit_name?: string;
  content?: string;
  file_name?: string;
  file_size?: number;
  term?: string;
  year?: string;
  month?: string;
  tags?: string[];
  slide_count?: number;
  created_at?: { toDate?: () => Date };
};

type ShiftItem = {
  id: string;
  teacher_name?: string;
  user_id?: string;
  target_grade?: string;
  target_subject?: string;
  target_detail_subject?: string;
  unit?: string;
  note?: string;
  target_date?: string;
};

const SUBJECTS = ['物理', '化学', '生物', '地学', '地理', '歴史', '公民', '漢字', '語句', '古文単語', '文法'];

function badgeStyle(subject?: string) {
  if (['物理', '化学', '生物', '地学'].includes(subject || '')) return 'bg-violet-100 text-violet-700';
  if (['地理', '歴史', '公民'].includes(subject || '')) return 'bg-amber-100 text-amber-700';
  return 'bg-rose-100 text-rose-700';
}

function dateLabel(value: SlideItem['created_at']) {
  const date = value?.toDate?.();
  return date ? formatDate(date, { withYear: true }) : '日時不明';
}

function formatBytes(value?: number) {
  if (!value) return '';
  if (value < 1024 * 1024) return `${Math.round(value / 1024)}KB`;
  return `${(value / 1024 / 1024).toFixed(1)}MB`;
}

function todayJst() {
  const formatter = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return formatter.format(new Date());
}

function normalize(value: unknown) {
  return String(value || '').normalize('NFKC').toLowerCase().replace(/[第（）()【】\[\]・_\-\s,，、.．]/g, '');
}

function slideMatchesShift(slide: SlideItem, shift: ShiftItem) {
  const gradeOk = !shift.target_grade || !slide.grade || normalize(slide.grade) === normalize(shift.target_grade);
  const subjectText = normalize([shift.target_subject, shift.target_detail_subject].join(' '));
  const slideSubject = normalize(slide.subject);
  const subjectOk = !subjectText || !slideSubject || subjectText.includes(slideSubject) || slideSubject.includes(subjectText);
  const unit = normalize(shift.unit || shift.note);
  const slideUnit = normalize(slide.unit_name);
  const unitOk = !unit || !slideUnit || unit.includes(slideUnit) || slideUnit.includes(unit);
  return gradeOk && (subjectOk || unitOk);
}

export default function TeacherSlidesPage() {
  const { user, profile } = useAuth();
  const toast = useToast();
  const [slides, setSlides] = useState<SlideItem[]>([]);
  const [todayShifts, setTodayShifts] = useState<ShiftItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [shiftLoadError, setShiftLoadError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [grade, setGrade] = useState('all');
  const [subject, setSubject] = useState('all');
  const [year, setYear] = useState('all');

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      setLoadError('');
      setShiftLoadError('');
      try {
        const snap = await getDocs(query(collection(db, 'lesson_slides'), orderBy('created_at', 'desc')));
        setSlides(snap.docs.map(d => ({ id: d.id, ...d.data() } as SlideItem)));

        try {
          const shiftSnap = await getDocs(query(collection(db, 'shift_assignments'), where('target_date', '==', todayJst())));
          const teacherName = normalize(profile?.name || profile?.teacher_name || user?.displayName || '');
          const uid = user?.uid || '';
          const shifts = shiftSnap.docs
            .map(d => ({ id: d.id, ...d.data() } as ShiftItem))
            .filter(shift => {
              if (shift.user_id && uid && shift.user_id === uid) return true;
              if (!teacherName) return true;
              return normalize(shift.teacher_name).includes(teacherName) || teacherName.includes(normalize(shift.teacher_name));
            });
          setTodayShifts(shifts);
        } catch (e) {
          console.error(e);
          setTodayShifts([]);
          setShiftLoadError('本日の講師配置を読み込めませんでした。全教材の検索・保存は利用できます。');
        }
      } catch (e) {
        console.error(e);
        setSlides([]);
        setTodayShifts([]);
        setLoadError('授業PPTを読み込めませんでした。通信状態を確認して、もう一度お試しください。');
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [profile, user, reloadKey]);

  const yearOptions = useMemo(() => Array.from(new Set(slides.map(s => String(s.year || '')).filter(Boolean))).sort().reverse(), [slides]);

  const filteredSlides = useMemo(() => {
    const key = search.trim().toLowerCase();
    return slides.filter(slide => {
      if (grade !== 'all' && slide.grade !== grade) return false;
      if (subject !== 'all' && slide.subject !== subject) return false;
      if (year !== 'all' && String(slide.year || '') !== year) return false;
      if (!key) return true;
      return [
        slide.unit_name,
        slide.subject,
        slide.grade,
        slide.term,
        slide.month,
        slide.file_name,
        ...(slide.tags || []),
        slide.content,
      ].join(' ').toLowerCase().includes(key);
    });
  }, [slides, search, grade, subject, year]);

  const todaySlides = useMemo(() => {
    if (todayShifts.length === 0) return [];
    const map = new Map<string, SlideItem>();
    todayShifts.forEach(shift => {
      slides.filter(slide => slideMatchesShift(slide, shift)).forEach(slide => map.set(slide.id, slide));
    });
    return Array.from(map.values());
  }, [slides, todayShifts]);

  const handleDownload = async (slide: SlideItem) => {
    const user = auth.currentUser;
    if (!user) return toast.error('ログイン状態を確認できません');
    setDownloadingId(slide.id);
    try {
      const token = await user.getIdToken();
      const res = await fetch(`/api/slides/${slide.id}/download`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || 'download-failed');
      window.open(data.url, '_blank', 'noopener,noreferrer');
    } catch (e: any) {
      toast.error(`ダウンロードに失敗しました: ${e.message || e}`);
    } finally {
      setDownloadingId(null);
    }
  };

  const downloadButton = (slide: SlideItem) => (
    <Button
      variant="secondary"
      size="sm"
      onClick={() => handleDownload(slide)}
      loading={downloadingId === slide.id}
      icon={<Download size={14} aria-hidden />}
      className="shrink-0"
    >
      保存
    </Button>
  );

  return (
    <div className="px-4 py-5 pb-28 sm:px-6">
      <div className="mx-auto max-w-6xl space-y-6">
        <PageHeader
          tone="plain"
          title="授業PPT"
          icon={BookOpen}
          description="全期間の授業PPTを検索してダウンロードできます。"
          backHref="/teacher/work"
        />

        <Card>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-[1fr_130px_150px_130px]">
            <div className="relative">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" aria-hidden />
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="単元名・ファイル名・タームで検索"
                aria-label="授業PPTを検索"
                className="min-h-11 w-full rounded-input border border-line py-3 pl-9 pr-3 text-sm outline-none focus:ring-2 focus:ring-accent/30"
              />
            </div>
            <Select value={grade} onChange={setGrade} label="学年" options={['中1', '中2', '中3']} />
            <Select value={subject} onChange={setSubject} label="科目" options={SUBJECTS} />
            <Select value={year} onChange={setYear} label="年度" options={yearOptions} />
          </div>
        </Card>

        <Card className="border-accent/20">
          <SectionTitle
            icon={CalendarCheck}
            title="本日の授業PPT"
            description="講師配置の学年・科目・単元と照合して表示しています。校舎外からも、ログイン済み講師だけが閲覧できます。"
            trailing={<span className="rounded-full bg-accent-soft px-3 py-1 text-xs font-bold text-accent">{formatDate(todayJst())}</span>}
          />
          {shiftLoadError ? (
            <div className="flex items-start gap-2 rounded-card border border-warning/30 bg-warning-soft p-4 text-sm font-bold text-amber-800">
              <AlertCircle size={18} className="mt-0.5 shrink-0" aria-hidden />
              <span>{shiftLoadError}</span>
            </div>
          ) : todaySlides.length === 0 ? (
            <div className="rounded-card bg-canvas p-5 text-sm font-bold text-fg-muted">
              今日の講師配置に一致するPPTは見つかりませんでした。下の一覧から検索できます。
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              {todaySlides.map(slide => (
                <article key={slide.id} className="rounded-card border border-accent/20 bg-accent-soft/40 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="mb-2 flex flex-wrap gap-2">
                        <span className="rounded bg-surface px-2 py-1 text-xs font-bold text-slate-600">{slide.grade}</span>
                        <span className={`rounded px-2 py-1 text-xs font-bold ${badgeStyle(slide.subject)}`}>{slide.subject}</span>
                      </div>
                      <h3 className="truncate font-bold text-fg">{slide.unit_name}</h3>
                      <p className="mt-1 truncate text-xs text-fg-muted">{slide.file_name}</p>
                    </div>
                    {downloadButton(slide)}
                  </div>
                </article>
              ))}
            </div>
          )}
        </Card>

        <div className="flex items-center justify-between px-1">
          <h2 className="text-sm font-bold text-fg-muted">表示中: {filteredSlides.length}件 / 全{slides.length}件</h2>
        </div>

        {loading ? (
          <ListSkeleton rows={4} />
        ) : loadError ? (
          <ErrorState message={loadError} onRetry={() => setReloadKey(value => value + 1)} />
        ) : filteredSlides.length === 0 ? (
          <EmptyState icon={FileText} title="条件に合う授業PPTがありません" />
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {filteredSlides.map(slide => (
              <Card as="article" key={slide.id} className="transition-shadow hover:shadow-md">
                <div className="mb-3 flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="mb-2 flex flex-wrap gap-2">
                      <span className="rounded bg-slate-100 px-2 py-1 text-xs font-bold text-slate-600">{slide.grade || '学年未設定'}</span>
                      <span className={`rounded px-2 py-1 text-xs font-bold ${badgeStyle(slide.subject)}`}>{slide.subject || '科目未設定'}</span>
                      {slide.year && <span className="rounded bg-sky-50 px-2 py-1 text-xs font-bold text-sky-700">{slide.year}</span>}
                      {slide.term && <span className="rounded bg-amber-50 px-2 py-1 text-xs font-bold text-amber-700">{slide.term}</span>}
                    </div>
                    <h3 className="truncate text-lg font-bold text-fg">{slide.unit_name || '単元名未設定'}</h3>
                    <p className="mt-1 text-xs text-fg-muted">{dateLabel(slide.created_at)}</p>
                  </div>
                  {downloadButton(slide)}
                </div>
                <div className="rounded-input bg-canvas p-3">
                  <p className="truncate text-xs font-bold text-slate-600">{slide.file_name || 'PPTXファイル'}</p>
                  <p className="mt-1 text-xs text-slate-400">
                    {formatBytes(slide.file_size)} {slide.slide_count ? `/ ${slide.slide_count}枚` : ''} {slide.month ? `/ ${slide.month}` : ''}
                  </p>
                  <p className="mt-2 line-clamp-2 text-xs text-fg-muted">{slide.content}</p>
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function Select({ value, onChange, options, label }: { value: string; onChange: (value: string) => void; options: string[]; label: string }) {
  return (
    <select value={value} onChange={e => onChange(e.target.value)} aria-label={label} className="min-h-11 w-full rounded-input border border-line bg-surface px-3 py-3 text-sm font-bold text-slate-700 outline-none focus:ring-2 focus:ring-accent/30">
      <option value="all">{label}: 全て</option>
      {options.map(option => <option key={option} value={option}>{option}</option>)}
    </select>
  );
}
