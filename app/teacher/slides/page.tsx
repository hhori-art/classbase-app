'use client';

import { useEffect, useMemo, useState } from 'react';
import { auth, db } from '@/lib/firebase';
import { collection, getDocs, orderBy, query, where } from 'firebase/firestore';
import Link from 'next/link';
import { ArrowLeft, BookOpen, CalendarCheck, Download, FileText, Loader2, Search } from 'lucide-react';
import { useAuth } from '@/app/context/AuthContext';

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
  if (['物理', '化学', '生物', '地学'].includes(subject || '')) return 'bg-purple-100 text-purple-700';
  if (['地理', '歴史', '公民'].includes(subject || '')) return 'bg-orange-100 text-orange-700';
  return 'bg-rose-100 text-rose-700';
}

function dateLabel(value: SlideItem['created_at']) {
  const date = value?.toDate?.();
  return date ? date.toLocaleDateString('ja-JP') : '日時不明';
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
  const [slides, setSlides] = useState<SlideItem[]>([]);
  const [todayShifts, setTodayShifts] = useState<ShiftItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [grade, setGrade] = useState('all');
  const [subject, setSubject] = useState('all');
  const [year, setYear] = useState('all');

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      try {
        const snap = await getDocs(query(collection(db, 'lesson_slides'), orderBy('created_at', 'desc')));
        setSlides(snap.docs.map(d => ({ id: d.id, ...d.data() } as SlideItem)));

        const shiftSnap = await getDocs(query(collection(db, 'shift_assignments'), where('target_date', '==', todayJst()))).catch(() => ({ docs: [] as any[] }));
        const teacherName = normalize(profile?.name || profile?.teacher_name || user?.displayName || '');
        const uid = user?.uid || '';
        const shifts = shiftSnap.docs
          .map((d: any) => ({ id: d.id, ...d.data() } as ShiftItem))
          .filter(shift => {
            if (shift.user_id && uid && shift.user_id === uid) return true;
            if (!teacherName) return true;
            return normalize(shift.teacher_name).includes(teacherName) || teacherName.includes(normalize(shift.teacher_name));
          });
        setTodayShifts(shifts);
      } catch (e) {
        console.error(e);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [profile, user]);

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
    if (!user) return alert('ログイン状態を確認できません');
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
      alert(`ダウンロードに失敗しました: ${e.message || e}`);
    } finally {
      setDownloadingId(null);
    }
  };

  return (
    <div className="min-h-screen bg-[#F0F4F8] p-4 sm:p-6 lg:p-8 pb-28">
      <div className="max-w-6xl mx-auto space-y-6">
        <div className="flex items-center gap-4">
          <Link href="/teacher/work" className="bg-white p-3 rounded-full shadow-sm hover:bg-gray-50">
            <ArrowLeft size={20} />
          </Link>
          <div>
            <h1 className="text-2xl font-black text-gray-800 flex items-center gap-2">
              <BookOpen className="text-indigo-600" /> 授業PPT
            </h1>
            <p className="text-xs text-gray-500 mt-1">全期間の授業PPTを検索してダウンロードできます。</p>
          </div>
        </div>

        <section className="bg-white p-4 rounded-2xl shadow-sm border border-gray-100">
          <div className="grid grid-cols-1 md:grid-cols-[1fr_130px_150px_130px] gap-3">
            <div className="relative">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="単元名・ファイル名・タームで検索"
                className="w-full pl-9 pr-3 py-3 border border-gray-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-indigo-100"
              />
            </div>
            <Select value={grade} onChange={setGrade} label="学年" options={['中1', '中2', '中3']} />
            <Select value={subject} onChange={setSubject} label="科目" options={SUBJECTS} />
            <Select value={year} onChange={setYear} label="年度" options={yearOptions} />
          </div>
        </section>

        <section className="bg-white rounded-3xl p-5 border border-indigo-100 shadow-sm">
          <div className="flex items-center justify-between gap-3 mb-4">
            <div>
              <h2 className="text-lg font-black text-gray-800 flex items-center gap-2">
                <CalendarCheck className="text-indigo-600" size={20} /> 本日の授業PPT
              </h2>
              <p className="text-xs text-gray-500 mt-1">講師配置の学年・科目・単元と照合して表示しています。社外アクセスでも閲覧できます。</p>
            </div>
            <span className="text-xs font-bold bg-indigo-50 text-indigo-700 px-3 py-1 rounded-full">{todayJst()}</span>
          </div>
          {todaySlides.length === 0 ? (
            <div className="bg-slate-50 rounded-2xl p-5 text-sm text-gray-500 font-bold">
              今日の講師配置に一致するPPTは見つかりませんでした。下の一覧から検索できます。
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {todaySlides.map(slide => (
                <article key={slide.id} className="rounded-2xl border border-indigo-100 bg-indigo-50/40 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap gap-2 mb-2">
                        <span className="text-xs font-bold bg-white text-gray-600 px-2 py-1 rounded">{slide.grade}</span>
                        <span className={`text-xs font-bold px-2 py-1 rounded ${badgeStyle(slide.subject)}`}>{slide.subject}</span>
                      </div>
                      <h3 className="font-black text-gray-800 truncate">{slide.unit_name}</h3>
                      <p className="text-xs text-gray-500 mt-1 truncate">{slide.file_name}</p>
                    </div>
                    <button onClick={() => handleDownload(slide)} disabled={downloadingId === slide.id} className="shrink-0 bg-indigo-600 text-white px-3 py-2 rounded-xl text-xs font-bold flex items-center gap-1 hover:bg-indigo-700 disabled:opacity-50">
                      {downloadingId === slide.id ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
                      保存
                    </button>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>

        <div className="flex items-center justify-between px-1">
          <h2 className="text-sm font-bold text-gray-500">表示中: {filteredSlides.length}件 / 全{slides.length}件</h2>
        </div>

        {loading ? (
          <div className="bg-white rounded-3xl p-16 text-center text-indigo-500">
            <Loader2 className="animate-spin mx-auto mb-3" size={32} />
            <p className="text-sm font-bold">読み込み中...</p>
          </div>
        ) : filteredSlides.length === 0 ? (
          <div className="bg-white rounded-3xl p-16 text-center text-gray-400 border border-dashed border-gray-200">
            <FileText size={42} className="mx-auto mb-3 opacity-40" />
            <p className="font-bold">条件に合う授業PPTがありません</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {filteredSlides.map(slide => (
              <article key={slide.id} className="bg-white rounded-2xl p-5 border border-gray-100 shadow-sm hover:shadow-md transition-shadow">
                <div className="flex items-start justify-between gap-3 mb-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap gap-2 mb-2">
                      <span className="text-xs font-bold bg-gray-100 text-gray-600 px-2 py-1 rounded">{slide.grade || '学年未設定'}</span>
                      <span className={`text-xs font-bold px-2 py-1 rounded ${badgeStyle(slide.subject)}`}>{slide.subject || '科目未設定'}</span>
                      {slide.year && <span className="text-xs font-bold bg-blue-50 text-blue-700 px-2 py-1 rounded">{slide.year}</span>}
                      {slide.term && <span className="text-xs font-bold bg-amber-50 text-amber-700 px-2 py-1 rounded">{slide.term}</span>}
                    </div>
                    <h3 className="text-lg font-black text-gray-800 truncate">{slide.unit_name || '単元名未設定'}</h3>
                    <p className="text-xs text-gray-400 mt-1">{dateLabel(slide.created_at)}</p>
                  </div>
                  <button
                    onClick={() => handleDownload(slide)}
                    disabled={downloadingId === slide.id}
                    className="shrink-0 bg-indigo-600 text-white px-3 py-2 rounded-xl text-xs font-bold flex items-center gap-1 hover:bg-indigo-700 disabled:opacity-50"
                  >
                    {downloadingId === slide.id ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
                    保存
                  </button>
                </div>
                <div className="bg-gray-50 rounded-xl p-3">
                  <p className="text-xs font-bold text-gray-600 truncate">{slide.file_name || 'PPTXファイル'}</p>
                  <p className="text-[11px] text-gray-400 mt-1">
                    {formatBytes(slide.file_size)} {slide.slide_count ? `/ ${slide.slide_count}枚` : ''} {slide.month ? `/ ${slide.month}` : ''}
                  </p>
                  <p className="text-xs text-gray-500 mt-2 line-clamp-2">{slide.content}</p>
                </div>
              </article>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function Select({ value, onChange, options, label }: { value: string; onChange: (value: string) => void; options: string[]; label: string }) {
  return (
    <select value={value} onChange={e => onChange(e.target.value)} className="w-full px-3 py-3 rounded-xl border border-gray-200 bg-white text-sm font-bold text-gray-700 outline-none focus:ring-2 focus:ring-indigo-100">
      <option value="all">{label}: 全て</option>
      {options.map(option => <option key={option} value={option}>{option}</option>)}
    </select>
  );
}
