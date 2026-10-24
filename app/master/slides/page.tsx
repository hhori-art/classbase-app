'use client';

import { useEffect, useMemo, useState } from 'react';
import { auth, db } from '@/lib/firebase';
import {
  collection,
  getDocs,
  orderBy,
  query,
} from 'firebase/firestore';
import {
  BookOpen,
  Check,
  Download,
  FileUp,
  Plus,
  Save,
  Search,
  Sparkles,
  Trash2,
} from 'lucide-react';
import AdminPageHeader from '@/app/components/master/AdminPageHeader';
import { Button, ButtonLink, EmptyState, ErrorState, IconButton, ListSkeleton, useConfirm, useToast } from '@/app/components/ui';
import { formatDate } from '@/lib/format';
import { cn } from '@/lib/cn';
import { userErrorMessage } from '@/lib/user-error';

const SUBJECT_CATEGORIES = {
  science: { label: '理科', items: ['物理', '化学', '生物', '地学'], color: 'bg-sky-100 text-sky-700' },
  society: { label: '社会', items: ['地理', '歴史', '公民'], color: 'bg-amber-100 text-amber-700' },
  japanese: { label: '国語', items: ['漢字', '語句', '古文単語', '文法'], color: 'bg-rose-100 text-rose-700' },
};

type CategoryKey = keyof typeof SUBJECT_CATEGORIES;

type SlideItem = {
  id: string;
  grade?: string;
  subject?: string;
  category?: CategoryKey;
  unit_name?: string;
  content?: string;
  file_name?: string;
  file_size?: number;
  term?: string;
  year?: string;
  month?: string;
  tags?: string[];
  slide_count?: number;
  learning_unit_id?: string;
  created_at?: { toDate?: () => Date };
};

type CurriculumItem = {
  id: string;
  grade?: string;
  subject?: string;
  course_name?: string;
  title?: string;
  unit?: string;
  resolved_unit?: string;
  target_grade?: string;
  target_subject?: string;
  target_detail_subject?: string;
  matched_units?: string[];
  curriculum_units?: string[];
  term?: string;
  term_label?: string;
  month_label?: string;
  year?: string | number;
};

type PendingPptx = {
  id: string;
  file: File;
  grade: string;
  subject: string;
  category: CategoryKey;
  unitName: string;
  term: string;
  year: string;
  month: string;
  tags: string;
  matchLabel: string;
  matchScore: number;
  uploadStatus?: 'queued' | 'uploading' | 'success' | 'failed';
  uploadMessage?: string;
};

type UploadProgress = {
  total: number;
  completed: number;
  success: number;
  failed: number;
  active: string[];
};

function badgeStyle(subject?: string) {
  if (subject && SUBJECT_CATEGORIES.science.items.includes(subject)) return SUBJECT_CATEGORIES.science.color;
  if (subject && SUBJECT_CATEGORIES.society.items.includes(subject)) return SUBJECT_CATEGORIES.society.color;
  return SUBJECT_CATEGORIES.japanese.color;
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

async function readJsonResponse(res: Response) {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    const title = text.match(/<title>(.*?)<\/title>/i)?.[1];
    throw new Error(title || `APIがJSON以外を返しました (${res.status})`);
  }
}

function normalizeText(value: unknown) {
  return String(value || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/\.[a-z0-9]+$/i, '')
    .replace(/[第（）()【】\[\]・_\-\s,，、.．]/g, '');
}

function titleFromFile(file: File) {
  return file.name.replace(/\.pptx$/i, '').replace(/[_-]+/g, ' ').trim();
}

function inferGradeFromTitle(title: string) {
  const normalized = title.normalize('NFKC');
  if (/中(?:学)?\s*3|3\s*年/.test(normalized)) return '中3';
  if (/中(?:学)?\s*2|2\s*年/.test(normalized)) return '中2';
  if (/中(?:学)?\s*1|1\s*年/.test(normalized)) return '中1';
  return '';
}

const SUBJECT_ALIASES: Record<string, string[]> = {
  物理: ['物理', '力学', '電流', '電圧', '電気', '音', '光', '運動', '圧力'],
  化学: ['化学', '物質', '気体', '水溶液', '化合', '分解', '酸化', '還元', 'イオン', '原子', '分子'],
  生物: ['生物', '植物', '動物', '細胞', '遺伝', '生殖', '消化', '呼吸', '血液', '神経'],
  地学: ['地学', '天体', '地層', '火山', '地震', '岩石', '気象', '天気', '月', '太陽'],
  地理: ['地理', '地形', '気候', '農業', '工業', '貿易', '人口', '世界', '日本地理'],
  歴史: ['歴史', '古代', '中世', '近世', '近代', '現代', '縄文', '弥生', '江戸', '明治', '大正', '昭和'],
  公民: ['公民', '政治', '経済', '憲法', '人権', '国会', '内閣', '裁判所', '地方自治'],
  漢字: ['漢字'],
  語句: ['語句', '語彙', 'ことば'],
  古文単語: ['古文単語', '古文', '古典単語'],
  文法: ['文法', '品詞', '活用'],
};

function inferSubjectFromLeadingText(value: string) {
  const chunks = value
    .normalize('NFKC')
    .split(/\n|__+|--+|[|｜]/)
    .map(chunk => chunk.replace(/\.pptx$/i, '').replace(/[_-]+/g, ' ').trim())
    .filter(Boolean)
    .slice(0, 6);

  for (const chunk of chunks) {
    const compact = chunk.replace(/^[\s　\d０-９年月日回講限.．、,/_-]+/, '').trim();
    const leading = compact.slice(0, 40);
    const direct = leading.match(/^(?:理科|社会|国語)?\s*(物理|化学|生物|地学|地理|歴史|公民|漢字|語句|古文単語|文法)(?=$|[\s　:：/／_\-（(【\[])/);
    if (direct?.[1]) return direct[1];

    const normalizedLeading = normalizeText(leading);
    const exact = Object.values(SUBJECT_CATEGORIES).flatMap(c => c.items).find(item => normalizedLeading.startsWith(normalizeText(item)));
    if (exact) return exact;
  }

  const normalizedTitle = normalizeText(chunks.join(' ').slice(0, 120));
  let best = { subject: '', score: 0 };
  Object.entries(SUBJECT_ALIASES).forEach(([subjectName, aliases]) => {
    aliases.forEach(alias => {
      const normalizedAlias = normalizeText(alias);
      if (!normalizedAlias || !normalizedTitle.includes(normalizedAlias)) return;
      const score = normalizedAlias.length + (subjectName === alias ? 4 : 0);
      if (score > best.score) best = { subject: subjectName, score };
    });
  });
  return best.subject;
}

function stripMetaFromTitle(title: string, grade: string, subjectName: string) {
  let value = title
    .normalize('NFKC')
    .replace(/\.pptx$/i, '')
    .replace(/[_-]+/g, ' ')
    .replace(/\b20\d{2}\b/g, '')
    .replace(/\b\d{1,2}月\b/g, '')
    .replace(/第\s*[IVXⅠⅡⅢ一二三1-9]+\s*(期|講|回|章|単元)?/gi, '')
    .trim();
  if (grade) value = value.replace(new RegExp(grade.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), '');
  if (subjectName) value = value.replace(new RegExp(subjectName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), '');
  return value.replace(/\s{2,}/g, ' ').trim() || title;
}

function categoryFromSubject(value: string): CategoryKey {
  if (SUBJECT_CATEGORIES.science.items.includes(value)) return 'science';
  if (SUBJECT_CATEGORIES.society.items.includes(value)) return 'society';
  if (SUBJECT_CATEGORIES.japanese.items.includes(value)) return 'japanese';
  return 'science';
}

function inferPptxMeta(file: File, catalog: CurriculumItem[], fallback: {
  grade: string;
  subject: string;
  category: CategoryKey;
  unitName: string;
  term: string;
  year: string;
  month: string;
  tags: string;
}): PendingPptx {
  const title = titleFromFile(file);
  const normalizedTitle = normalizeText(title);
  const titleGrade = inferGradeFromTitle(title);
  const titleSubject = inferSubjectFromLeadingText(title);
  const scored = catalog
    .map(item => {
      const unit = String(item.unit || item.resolved_unit || '');
      const itemGrade = item.grade || item.target_grade;
      const itemSubject = item.subject || item.target_subject;
      const itemCourse = item.course_name || item.target_detail_subject || item.title;
      const haystack = [
        itemGrade,
        itemSubject,
        itemCourse,
        unit,
        item.title,
        item.term_label,
        item.month_label,
        item.year,
        ...(item.matched_units || []),
        ...(item.curriculum_units || []),
      ].map(normalizeText);

      let score = 0;
      haystack.forEach((part, index) => {
        if (!part) return;
        const weight = index === 3 ? 10 : index === 2 ? 6 : index <= 1 ? 4 : 2;
        if (normalizedTitle.includes(part)) score += weight;
        else if (part.includes(normalizedTitle) && normalizedTitle.length >= 4) score += Math.max(1, weight - 2);
      });
      if (titleGrade && normalizeText(itemGrade) === normalizeText(titleGrade)) score += 5;
      if (titleSubject && normalizeText(itemSubject) === normalizeText(titleSubject)) score += 8;
      if (titleSubject && normalizeText(itemCourse).includes(normalizeText(titleSubject))) score += 3;
      return { item, score };
    })
    .filter(row => row.score > 0)
    .sort((a, b) => b.score - a.score);

  const best = scored[0]?.item;
  const inferredGrade = String(best?.grade || best?.target_grade || titleGrade || fallback.grade);
  const inferredSubject = String(best?.subject || best?.target_subject || titleSubject || fallback.subject);
  const cleanedTitle = stripMetaFromTitle(title, inferredGrade, inferredSubject);
  const inferredUnit = String(best?.unit || best?.resolved_unit || best?.matched_units?.[0] || best?.course_name || best?.target_detail_subject || fallback.unitName || cleanedTitle || title);
  const inferredTerm = String(best?.term_label || best?.term || fallback.term || '');
  const inferredMonth = String(best?.month_label || fallback.month || '');
  const inferredYear = String(best?.year || fallback.year || new Date().getFullYear());

  return {
    id: `${file.name}_${file.lastModified}_${file.size}`,
    file,
    grade: inferredGrade,
    subject: inferredSubject,
    category: categoryFromSubject(inferredSubject || fallback.subject) || fallback.category,
    unitName: inferredUnit,
    term: inferredTerm,
    year: inferredYear,
    month: inferredMonth,
    tags: fallback.tags,
    matchLabel: best
      ? [best.grade || best.target_grade, best.subject || best.target_subject, best.course_name || best.target_detail_subject, best.unit || best.resolved_unit].filter(Boolean).join(' / ')
      : titleSubject
        ? `タイトルから推定: ${[titleGrade, titleSubject, cleanedTitle].filter(Boolean).join(' / ')}`
      : '一致候補なし',
    matchScore: scored[0]?.score || (titleSubject ? 1 : 0),
    uploadStatus: 'queued',
  };
}

export default function SlideManagerPage() {
  const toast = useToast();
  const confirm = useConfirm();
  const [slides, setSlides] = useState<SlideItem[]>([]);
  const [units, setUnits] = useState<any[]>([]);
  const [curriculumCatalog, setCurriculumCatalog] = useState<CurriculumItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [generatingId, setGeneratingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const [grade, setGrade] = useState('中1');
  const [selectedCategory, setSelectedCategory] = useState<CategoryKey>('science');
  const [subject, setSubject] = useState('物理');
  const [unitName, setUnitName] = useState('');
  const [content, setContent] = useState('');
  const [term, setTerm] = useState('');
  const [year, setYear] = useState(String(new Date().getFullYear()));
  const [month, setMonth] = useState('');
  const [tags, setTags] = useState('');
  const [pendingPptx, setPendingPptx] = useState<PendingPptx[]>([]);
  const [uploadProgress, setUploadProgress] = useState<UploadProgress | null>(null);

  const [search, setSearch] = useState('');
  const [filterGrade, setFilterGrade] = useState('all');
  const [filterSubject, setFilterSubject] = useState('all');
  const [filterYear, setFilterYear] = useState('all');

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    setLoading(true);
    setLoadError(false);
    try {
      const [slideSnap, unitSnap] = await Promise.all([
        getDocs(query(collection(db, 'lesson_slides'), orderBy('created_at', 'desc'))).catch(() => ({ docs: [] as any[] })),
        getDocs(query(collection(db, 'learning_units'), orderBy('created_at', 'desc'))),
      ]);
      setSlides(slideSnap.docs.map(d => ({ id: d.id, ...d.data() } as SlideItem)));
      setUnits(unitSnap.docs.map(d => ({ id: d.id, ...d.data() })));

      const [curriculumSnap, optionSnap] = await Promise.all([
        getDocs(collection(db, 'annual_curriculum_schedules')).catch(() => ({ docs: [] as any[] })),
        getDocs(collection(db, 'course_registration_options')).catch(() => ({ docs: [] as any[] })),
      ]);
      const catalog = [
        ...curriculumSnap.docs.map(d => ({ id: d.id, ...d.data() } as CurriculumItem)),
        ...optionSnap.docs.map(d => ({ id: d.id, ...d.data() } as CurriculumItem)),
      ];
      setCurriculumCatalog(catalog);
    } catch (e) {
      console.error(e);
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  };

  const defaultPptxMeta = useMemo(() => ({
    grade,
    subject,
    category: selectedCategory,
    unitName,
    term,
    year,
    month,
    tags,
  }), [grade, subject, selectedCategory, unitName, term, year, month, tags]);

  const handlePptxSelection = (files: FileList | null) => {
    const selected = Array.from(files || []).filter(file => file.name.toLowerCase().endsWith('.pptx'));
    if (selected.length === 0) return;
    const next = selected.map(file => inferPptxMeta(file, curriculumCatalog, {
      ...defaultPptxMeta,
      unitName: unitName || titleFromFile(file),
    }));
    setPendingPptx(prev => {
      const existing = new Set(prev.map(item => item.id));
      return [...prev, ...next.filter(item => !existing.has(item.id))];
    });
    if (!unitName && next[0]) {
      setUnitName(next[0].unitName);
      setGrade(next[0].grade);
      setSubject(next[0].subject);
      setSelectedCategory(next[0].category);
      setTerm(next[0].term);
      setYear(next[0].year);
      setMonth(next[0].month);
    }
  };

  const updatePending = (id: string, patch: Partial<PendingPptx>) => {
    setPendingPptx(prev => prev.map(item => item.id === id ? { ...item, ...patch } : item));
  };

  const handleCategoryChange = (cat: CategoryKey) => {
    setSelectedCategory(cat);
    setSubject(SUBJECT_CATEGORIES[cat].items[0]);
  };

  const filteredSlides = useMemo(() => {
    const key = search.trim().toLowerCase();
    return slides.filter(slide => {
      if (filterGrade !== 'all' && slide.grade !== filterGrade) return false;
      if (filterSubject !== 'all' && slide.subject !== filterSubject) return false;
      if (filterYear !== 'all' && String(slide.year || '') !== filterYear) return false;
      if (!key) return true;
      const text = [
        slide.unit_name,
        slide.subject,
        slide.grade,
        slide.term,
        slide.month,
        slide.file_name,
        ...(slide.tags || []),
        slide.content,
      ].join(' ').toLowerCase();
      return text.includes(key);
    });
  }, [slides, search, filterGrade, filterSubject, filterYear]);

  const yearOptions = useMemo(() => {
    return Array.from(new Set(slides.map(s => String(s.year || '')).filter(Boolean))).sort().reverse();
  }, [slides]);

  const handleManualSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!unitName || !content || !subject) {
      toast.error('単元名と本文を入力してください。');
      return;
    }

    setSubmitting(true);
    try {
      const token = await auth.currentUser?.getIdToken();
      if (!token) throw new Error('ログイン状態を確認できません');
      const res = await fetch('/api/admin/slides/units', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          grade,
          subject,
          unit_name: unitName,
          content,
          term,
          year,
          month,
          tags: tags.split(/[,\s、]+/).map(v => v.trim()).filter(Boolean),
        }),
      });
      const data = await readJsonResponse(res);
      if (!res.ok || !data.ok) throw new Error(data.error || '登録に失敗しました');

      toast.success('単元を登録しました。');
      setUnitName('');
      setContent('');
      await fetchData();
    } catch (e: any) {
      console.error(e);
      toast.error(`登録できませんでした：${userErrorMessage(e, '')}`);
    } finally {
      setSubmitting(false);
    }
  };

  const handlePptxUpload = async () => {
    if (pendingPptx.length === 0) {
      toast.error('PPTXファイルを選択してください。');
      return;
    }
    const invalid = pendingPptx.find(item => !item.unitName.trim() || !item.grade || !item.subject);
    if (invalid) {
      toast.error(`${invalid.file.name} の学年・科目・単元名を確認してください。`);
      return;
    }
    const user = auth.currentUser;
    if (!user) {
      toast.error('ログイン状態を確認できません。');
      return;
    }

    setUploading(true);
    setPendingPptx(prev => prev.map(item => ({ ...item, uploadStatus: 'queued', uploadMessage: '' })));
    setUploadProgress({ total: pendingPptx.length, completed: 0, success: 0, failed: 0, active: [] });
    try {
      const token = await user.getIdToken();
      const results: { file: string; ok: boolean; message: string }[] = [];
      const queue = [...pendingPptx];
      const concurrency = Math.min(3, Math.max(1, pendingPptx.length));

      const uploadOne = async (item: PendingPptx) => {
        setPendingPptx(prev => prev.map(row => row.id === item.id ? { ...row, uploadStatus: 'uploading', uploadMessage: '読み込み中...' } : row));
        setUploadProgress(prev => prev ? { ...prev, active: Array.from(new Set([...prev.active, item.file.name])).slice(-concurrency) } : prev);
        const form = new FormData();
        form.append('file', item.file);
        form.append('grade', item.grade);
        form.append('subject', item.subject);
        form.append('category', item.category);
        form.append('unit_name', item.unitName);
        form.append('term', item.term);
        form.append('year', item.year);
        form.append('month', item.month);
        form.append('tags', item.tags);
        form.append('generate_questions', 'false');

        try {
          const res = await fetch('/api/admin/slides/upload', {
            method: 'POST',
            headers: { Authorization: `Bearer ${token}` },
            body: form,
          });
          const data = await readJsonResponse(res);
          if (!res.ok || !data.ok) throw new Error(data.error || 'upload-failed');
          const message = `${data.slide_count}枚 / ${data.extracted_text_length || 0}字`;
          results.push({ file: item.file.name, ok: true, message });
          setPendingPptx(prev => prev.map(row => row.id === item.id ? { ...row, uploadStatus: 'success', uploadMessage: message } : row));
          setUploadProgress(prev => prev ? {
            ...prev,
            completed: prev.completed + 1,
            success: prev.success + 1,
            active: prev.active.filter(name => name !== item.file.name),
          } : prev);
        } catch (e: any) {
          const message = e.message || String(e);
          results.push({ file: item.file.name, ok: false, message });
          setPendingPptx(prev => prev.map(row => row.id === item.id ? { ...row, uploadStatus: 'failed', uploadMessage: message } : row));
          setUploadProgress(prev => prev ? {
            ...prev,
            completed: prev.completed + 1,
            failed: prev.failed + 1,
            active: prev.active.filter(name => name !== item.file.name),
          } : prev);
        }
      };

      await Promise.all(Array.from({ length: concurrency }, async () => {
        while (queue.length > 0) {
          const next = queue.shift();
          if (next) await uploadOne(next);
        }
      }));

      const success = results.filter(r => r.ok).length;
      const failed = results.filter(r => !r.ok);
      if (success > 0) toast.success(`${success}件のPPTXを教材として登録しました。`);
      if (failed.length) {
        toast.error(`${failed.length}件の登録に失敗しました：${failed.slice(0, 3).map(r => `${r.file}（${userErrorMessage(r, '')}）`).join('／')}${failed.length > 3 ? ' ほか' : ''}`);
      }
      setPendingPptx(failed.length ? pendingPptx.filter(item => failed.some(f => f.file === item.file.name)) : []);
      setContent('');
      await fetchData();
    } catch (e: any) {
      console.error(e);
      toast.error(`アップロードできませんでした：${userErrorMessage(e, '')}`);
    } finally {
      setUploading(false);
    }
  };

  const handleGenerateQuestions = async (slide: SlideItem) => {
    if (!slide.content) {
      toast.error('問題作成に使える本文がありません。');
      return;
    }
    if (!(await confirm({
      title: `「${slide.unit_name}」からAIクエスト問題を作成しますか？`,
      message: '最大60問を作成して、AIクエスト問題として追加保存します。',
      confirmLabel: '作成する',
    }))) return;

    setGeneratingId(slide.id);
    try {
      const token = await auth.currentUser?.getIdToken();
      if (!token) throw new Error('ログイン情報を確認できません');
      const res = await fetch('/api/homework/adaptive', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          sourceSlideId: slide.id,
          persistForSlide: true,
          questionCount: 60,
        }),
      });
      const data = await readJsonResponse(res);
      if (!res.ok || !data.ok || !Number(data.saved_count)) {
        throw new Error(data.error || '問題が生成されませんでした');
      }
      toast.success(`${data.saved_count}問をAIクエスト問題として追加保存しました。`);
    } catch (e: any) {
      console.error(e);
      toast.error(`問題を作成できませんでした：${userErrorMessage(e, '')}`);
    } finally {
      setGeneratingId(null);
    }
  };

  const handleDeleteSlide = async (slide: SlideItem) => {
    if (!(await confirm({
      title: `「${slide.unit_name || slide.file_name || 'スライド'}」を削除しますか？`,
      message: 'スライドのファイル・AIクエスト単元・このスライドから作成した問題と解答履歴も削除されます。元に戻せません。',
      confirmLabel: '削除する',
      tone: 'danger',
    }))) return;
    const user = auth.currentUser;
    if (!user) {
      toast.error('ログイン状態を確認できません。');
      return;
    }

    setDeletingId(slide.id);
    try {
      const token = await user.getIdToken();
      const res = await fetch(`/api/admin/slides/${slide.id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await readJsonResponse(res);
      if (!res.ok || !data.ok) throw new Error(data.error || 'delete-failed');

      setSlides(prev => prev.filter(item => item.id !== slide.id));
      if (slide.learning_unit_id) {
        setUnits(prev => prev.filter(unit => unit.id !== slide.learning_unit_id));
      }
      toast.success(`スライドを削除しました（削除した問題：${data.deleted_quizzes || 0}問）。`);
    } catch (e: any) {
      console.error(e);
      toast.error(`削除できませんでした：${userErrorMessage(e, '')}`);
    } finally {
      setDeletingId(null);
    }
  };

  const handleDownload = async (slide: SlideItem) => {
    const user = auth.currentUser;
    if (!user) {
      toast.error('ログイン状態を確認できません。');
      return;
    }
    try {
      const token = await user.getIdToken();
      const res = await fetch(`/api/slides/${slide.id}/download`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || 'download-failed');
      window.open(data.url, '_blank', 'noopener,noreferrer');
    } catch (e: any) {
      console.error(e);
      toast.error(`ダウンロードできませんでした：${userErrorMessage(e, '')}`);
    }
  };

  const handleDeleteUnit = async (id: string, name?: string) => {
    if (!(await confirm({
      title: name ? `「${name}」を削除しますか？` : 'この単元を削除しますか？',
      message: 'AIクエスト単元リストから削除します。',
      confirmLabel: '削除する',
      tone: 'danger',
    }))) return;
    try {
      const token = await auth.currentUser?.getIdToken();
      if (!token) throw new Error('ログイン状態を確認できません');
      const res = await fetch('/api/admin/slides/units', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ id }),
      });
      const data = await readJsonResponse(res);
      if (!res.ok || !data.ok) throw new Error(data.error || '削除に失敗しました');
      setUnits(prev => prev.filter(u => u.id !== id));
    } catch (e: any) {
      console.error(e);
      toast.error(`削除できませんでした：${userErrorMessage(e, '')}`);
    }
  };

  return (
    <div>
      <div>
        <AdminPageHeader
          description="PPTXを読み取り、講師配布用ファイルとAIクエスト用単元を同時に管理します。"
          actions={<ButtonLink href="/teacher/slides" variant="secondary" icon={<BookOpen size={16} aria-hidden />}>
            講師表示を確認
          </ButtonLink>}
        />

        <div className="grid grid-cols-1 xl:grid-cols-3 gap-8">
          <div className="space-y-6">
            <section className="bg-surface p-6 rounded-card shadow-sm border border-line">
              <h2 className="font-bold text-slate-700 mb-5 flex items-center gap-2">
                <FileUp className="rounded-btn bg-accent-soft p-1 text-accent" size={22} aria-hidden />
                PPTXアップロード
              </h2>
              <div className="space-y-5">
                <MetaFields
                  grade={grade}
                  setGrade={setGrade}
                  selectedCategory={selectedCategory}
                  handleCategoryChange={handleCategoryChange}
                  subject={subject}
                  setSubject={setSubject}
                  unitName={unitName}
                  setUnitName={setUnitName}
                  term={term}
                  setTerm={setTerm}
                  year={year}
                  setYear={setYear}
                  month={month}
                  setMonth={setMonth}
                  tags={tags}
                  setTags={setTags}
                />

                <label className="block border-2 border-dashed border-accent/30 bg-accent-soft/40 rounded-card p-5 text-center cursor-pointer hover:bg-accent-soft">
                  <FileUp className="mx-auto mb-2 text-accent" size={30} aria-hidden />
                  <p className="text-sm font-bold text-slate-700">
                    {pendingPptx.length > 0 ? `${pendingPptx.length}件のPPTXを選択中` : 'PPTXファイルをまとめて選択'}
                  </p>
                  <p className="text-xs text-slate-400 mt-1">PowerPoint形式 .pptx のみ対応。ファイル名をカリキュラムと照合します。</p>
                  <input
                    type="file"
                    multiple
                    accept=".pptx,application/vnd.openxmlformats-officedocument.presentationml.presentation"
                    className="hidden"
                    onChange={e => {
                      handlePptxSelection(e.target.files);
                      e.target.value = '';
                    }}
                  />
                </label>

                {uploadProgress && (
                  <div className="rounded-card border border-line bg-surface p-4 space-y-3">
                    <div className="flex items-center justify-between text-xs font-bold">
                      <span className="text-slate-600">読み込み進捗</span>
                      <span className="text-accent">
                        {uploadProgress.completed} / {uploadProgress.total}件
                      </span>
                    </div>
                    <div className="h-2.5 rounded-full bg-slate-100 overflow-hidden">
                      <div
                        className="h-full bg-accent transition-all"
                        style={{ width: `${uploadProgress.total ? Math.round((uploadProgress.completed / uploadProgress.total) * 100) : 0}%` }}
                      />
                    </div>
                    <div className="grid grid-cols-3 gap-2 text-center text-xs font-bold">
                      <div className="rounded-btn bg-emerald-50 text-emerald-700 py-2">成功 {uploadProgress.success}</div>
                      <div className="rounded-btn bg-rose-50 text-rose-700 py-2">失敗 {uploadProgress.failed}</div>
                      <div className="rounded-btn bg-sky-50 text-sky-700 py-2">処理中 {uploadProgress.active.length}</div>
                    </div>
                    {uploadProgress.active.length > 0 && (
                      <p className="text-xs text-slate-500 truncate">
                        読み込み中: {uploadProgress.active.join('、')}
                      </p>
                    )}
                  </div>
                )}

                {pendingPptx.length > 0 && (
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <p className="text-xs font-bold text-slate-500">アップロード予定ファイル</p>
                      <Button size="sm" variant="ghost" onClick={() => setPendingPptx([])} className="text-rose-600">
                        全てクリア
                      </Button>
                    </div>
                    <div className="space-y-3 max-h-[420px] overflow-y-auto pr-1">
                      {pendingPptx.map(item => (
                        <div key={item.id} className="rounded-card border border-slate-100 bg-slate-50 p-3 space-y-3">
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <p className="text-sm font-bold text-slate-800 truncate">{item.file.name}</p>
                              <p className={`text-xs mt-1 font-bold ${item.matchScore > 0 ? 'text-emerald-600' : 'text-amber-700'}`}>
                                {item.matchScore > 0 ? `一致候補: ${item.matchLabel}` : 'カリキュラム一致候補なし'}
                              </p>
                              {item.uploadStatus && item.uploadStatus !== 'queued' && (
                                <p className={`text-xs mt-1 font-bold ${
                                  item.uploadStatus === 'success' ? 'text-emerald-600' :
                                  item.uploadStatus === 'failed' ? 'text-rose-600' :
                                  'text-sky-700'
                                }`}>
                                  {item.uploadStatus === 'uploading' ? '読み込み中' : item.uploadMessage}
                                </p>
                              )}
                            </div>
                            <IconButton label="選択から外す" size="sm" onClick={() => setPendingPptx(prev => prev.filter(p => p.id !== item.id))} className="text-slate-400 hover:bg-rose-50 hover:text-rose-600">
                              <Trash2 size={15} aria-hidden />
                            </IconButton>
                          </div>

                          <input
                            value={item.unitName}
                            onChange={e => updatePending(item.id, { unitName: e.target.value })}
                            className="w-full min-h-10 p-2 border border-line rounded-input text-xs font-bold bg-surface"
                            placeholder="単元名"
                          />
                          <div className="grid grid-cols-2 gap-2">
                            <select
                              value={item.grade}
                              onChange={e => updatePending(item.id, { grade: e.target.value })}
                              className="min-h-10 p-2 border border-line rounded-input text-xs font-bold bg-surface"
                            >
                              {['中1', '中2', '中3'].map(g => <option key={g} value={g}>{g}</option>)}
                            </select>
                            <select
                              value={item.subject}
                              onChange={e => updatePending(item.id, { subject: e.target.value, category: categoryFromSubject(e.target.value) })}
                              className="min-h-10 p-2 border border-line rounded-input text-xs font-bold bg-surface"
                            >
                              {Object.values(SUBJECT_CATEGORIES).flatMap(c => c.items).map(s => <option key={s} value={s}>{s}</option>)}
                            </select>
                          </div>
                          <div className="grid grid-cols-3 gap-2">
                            <input value={item.year} onChange={e => updatePending(item.id, { year: e.target.value })} className="min-h-10 p-2 border border-line rounded-input text-xs font-bold bg-surface" placeholder="年度" />
                            <input value={item.month} onChange={e => updatePending(item.id, { month: e.target.value })} className="min-h-10 p-2 border border-line rounded-input text-xs font-bold bg-surface" placeholder="月" />
                            <input value={item.term} onChange={e => updatePending(item.id, { term: e.target.value })} className="min-h-10 p-2 border border-line rounded-input text-xs font-bold bg-surface" placeholder="ターム" />
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <Button
                  size="lg"
                  fullWidth
                  onClick={handlePptxUpload}
                  disabled={uploading}
                  loading={uploading}
                  icon={<FileUp size={20} aria-hidden />}
                >
                  {uploading ? 'PPTXを読み込み中' : 'PPTXを一括登録してAIクエストへ連携'}
                </Button>
              </div>
            </section>

            <section className="bg-surface p-6 rounded-card shadow-sm border border-line">
              <h2 className="font-bold text-slate-700 mb-5 flex items-center gap-2">
                <Plus className="rounded-btn bg-slate-100 p-1 text-slate-600" size={22} aria-hidden />
                テキスト単元の手動登録
              </h2>
              <form onSubmit={handleManualSubmit} className="space-y-5">
                <textarea
                  value={content}
                  onChange={e => setContent(e.target.value)}
                  className="w-full h-40 p-3 border border-line rounded-input text-sm focus:ring-2 focus:ring-accent/30 outline-none resize-none"
                  placeholder="PPTXを使わず、スライド内容や教材本文を直接登録する場合はこちらに入力します。"
                />
                <Button
                  type="submit"
                  variant="secondary"
                  fullWidth
                  disabled={submitting}
                  loading={submitting}
                  icon={<Save size={20} aria-hidden />}
                >
                  手動単元として登録
                </Button>
              </form>
            </section>
          </div>

          <div className="xl:col-span-2 space-y-6">
            <section className="bg-surface p-5 rounded-card shadow-sm border border-line">
              <div className="flex flex-col lg:flex-row gap-3">
                <div className="relative flex-1">
                  <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" aria-hidden />
                  <input
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    placeholder="単元名・科目・ターム・ファイル名で検索"
                    className="min-h-11 w-full pl-9 pr-3 py-2.5 border border-line rounded-input text-sm outline-none focus:ring-2 focus:ring-accent/30"
                  />
                </div>
                <FilterSelect value={filterGrade} onChange={setFilterGrade} options={['中1', '中2', '中3']} label="学年" />
                <FilterSelect value={filterSubject} onChange={setFilterSubject} options={Object.values(SUBJECT_CATEGORIES).flatMap(c => c.items)} label="科目" />
                <FilterSelect value={filterYear} onChange={setFilterYear} options={yearOptions} label="年度" />
              </div>
            </section>

            <section>
              <div className="flex items-end justify-between mb-3">
                <div>
                  <h2 className="font-bold text-slate-700">登録済みの授業スライド</h2>
                  <p className="text-xs text-slate-400">{filteredSlides.length}件表示 / 全{slides.length}件</p>
                </div>
              </div>

              {loading ? (
                <ListSkeleton rows={4} />
              ) : loadError ? (
                <ErrorState title="教材データを読み込めませんでした" onRetry={fetchData} />
              ) : filteredSlides.length === 0 ? (
                <EmptyState
                  title={slides.length === 0 ? '授業スライドはまだありません' : '条件に合うスライドがありません'}
                  description={slides.length === 0 ? '左の「PPTXアップロード」から登録してください。' : '検索語や絞り込みを変えてください。'}
                />
              ) : (
                <div className="grid grid-cols-1 gap-3">
                  {filteredSlides.map(slide => (
                    <div key={slide.id} className="bg-surface p-5 rounded-card border border-line shadow-sm transition-all hover:border-accent/40">
                      <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-4">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2 mb-2">
                            <span className="text-xs font-bold bg-slate-100 text-slate-600 px-2 py-1 rounded-btn">{slide.grade}</span>
                            <span className={`text-xs font-bold px-2 py-1 rounded-btn ${badgeStyle(slide.subject)}`}>{slide.subject}</span>
                            {slide.year && <span className="text-xs font-bold bg-sky-50 text-sky-700 px-2 py-1 rounded-btn">{slide.year}</span>}
                            {slide.term && <span className="text-xs font-bold bg-amber-50 text-amber-700 px-2 py-1 rounded-btn">{slide.term}</span>}
                            {slide.month && <span className="text-xs font-bold bg-emerald-50 text-emerald-700 px-2 py-1 rounded-btn">{slide.month}</span>}
                            <span className="text-xs text-slate-400">{dateLabel(slide.created_at)}</span>
                          </div>
                          <h3 className="font-bold text-lg text-slate-800 mb-1 truncate">{slide.unit_name}</h3>
                          <p className="text-xs text-slate-500 mb-2">
                            {slide.file_name || 'PPTXファイル'} {formatBytes(slide.file_size)} {slide.slide_count ? `/ ${slide.slide_count}枚` : ''}
                          </p>
                          <p className="text-xs text-slate-500 line-clamp-2 bg-slate-50 p-2 rounded-btn max-w-3xl">{slide.content}</p>
                        </div>
                        <div className="flex lg:flex-col gap-2 shrink-0">
                          <Button size="sm" variant="secondary" onClick={() => handleDownload(slide)} icon={<Download size={14} aria-hidden />}>
                            ダウンロード
                          </Button>
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() => handleGenerateQuestions(slide)}
                            disabled={generatingId === slide.id}
                            loading={generatingId === slide.id}
                            icon={<Sparkles size={14} aria-hidden />}
                          >
                            AI問題作成
                          </Button>
                          <Button
                            size="sm"
                            variant="danger"
                            onClick={() => handleDeleteSlide(slide)}
                            disabled={deletingId === slide.id}
                            loading={deletingId === slide.id}
                            icon={<Trash2 size={14} aria-hidden />}
                          >
                            削除
                          </Button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>

            <section>
              <h2 className="font-bold text-slate-700 mb-3">AIクエスト単元リスト</h2>
              {!loading && !loadError && units.length === 0 && (
                <EmptyState title="AIクエスト単元はまだありません" description="スライドの登録や手動登録で追加されます。" />
              )}
              <div className="grid grid-cols-1 gap-3">
                {units.slice(0, 30).map(unit => (
                  <div key={unit.id} className="bg-surface p-4 rounded-card border border-line shadow-sm flex justify-between items-start gap-3">
                    <div>
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-xs font-bold bg-slate-100 text-slate-600 px-2 py-1 rounded-btn">{unit.grade}</span>
                        <span className={`text-xs font-bold px-2 py-1 rounded-btn ${badgeStyle(unit.subject)}`}>{unit.subject}</span>
                        {unit.source_type === 'pptx' && <span className="text-xs font-bold bg-accent-soft text-accent px-2 py-1 rounded-btn">PPTX連携</span>}
                      </div>
                      <h3 className="font-bold text-slate-800">{unit.unit_name}</h3>
                      <p className="text-xs text-slate-500 line-clamp-1">{unit.content}</p>
                    </div>
                    <IconButton label="単元を削除" size="sm" onClick={() => handleDeleteUnit(unit.id, unit.unit_name)} className="text-slate-400 hover:bg-rose-50 hover:text-rose-600">
                      <Trash2 size={16} aria-hidden />
                    </IconButton>
                  </div>
                ))}
              </div>
            </section>
          </div>
        </div>
      </div>
    </div>
  );
}

function MetaFields(props: {
  grade: string;
  setGrade: (value: string) => void;
  selectedCategory: CategoryKey;
  handleCategoryChange: (value: CategoryKey) => void;
  subject: string;
  setSubject: (value: string) => void;
  unitName: string;
  setUnitName: (value: string) => void;
  term: string;
  setTerm: (value: string) => void;
  year: string;
  setYear: (value: string) => void;
  month: string;
  setMonth: (value: string) => void;
  tags: string;
  setTags: (value: string) => void;
}) {
  return (
    <>
      <div>
        <label className="block text-xs font-bold text-slate-500 mb-2">対象学年</label>
        <div className="flex bg-slate-100 p-1 rounded-btn">
          {['中1','中2','中3'].map(g => (
            <button key={g} type="button" onClick={() => props.setGrade(g)} className={cn('flex-1 min-h-10 py-2 text-sm font-bold rounded-btn transition-all', props.grade === g ? 'bg-surface shadow text-accent' : 'text-slate-500 hover:text-slate-700')}>{g}</button>
          ))}
        </div>
      </div>

      <div>
        <label className="block text-xs font-bold text-slate-500 mb-2">教科カテゴリー</label>
        <div className="grid grid-cols-3 gap-2">
          {(Object.entries(SUBJECT_CATEGORIES) as [CategoryKey, typeof SUBJECT_CATEGORIES[CategoryKey]][]).map(([key, data]) => (
            <button key={key} type="button" onClick={() => props.handleCategoryChange(key)} className={cn('min-h-10 py-2 rounded-btn text-sm font-bold border-2 transition-all', props.selectedCategory === key ? `border-transparent ${data.color} ring-2 ring-offset-1 ring-slate-200` : 'border-slate-100 bg-surface text-slate-500 hover:border-slate-200')}>
              {data.label}
            </button>
          ))}
        </div>
      </div>

      <div>
        <label className="block text-xs font-bold text-slate-500 mb-2">詳細分野</label>
        <div className="flex flex-wrap gap-2">
          {SUBJECT_CATEGORIES[props.selectedCategory].items.map(item => (
            <button key={item} type="button" onClick={() => props.setSubject(item)} className={cn('min-h-10 px-4 py-2 rounded-btn text-sm font-bold flex items-center gap-2 transition-all', props.subject === item ? 'bg-accent text-accent-ink shadow-md' : 'bg-slate-100 text-slate-600 hover:bg-slate-200')}>
              {item}
              {props.subject === item && <Check size={14} aria-hidden />}
            </button>
          ))}
        </div>
      </div>

      <div>
        <label className="block text-xs font-bold text-slate-500 mb-1">単元名</label>
        <input value={props.unitName} onChange={e => props.setUnitName(e.target.value)} className="w-full min-h-11 p-3 border border-line rounded-input font-bold focus:ring-2 focus:ring-accent/30 outline-none" placeholder="例: 歴史A 第1講" />
      </div>

      <div className="grid grid-cols-3 gap-2">
        <TextField label="年度" value={props.year} onChange={props.setYear} placeholder="2026" />
        <TextField label="月" value={props.month} onChange={props.setMonth} placeholder="4月" />
        <TextField label="ターム" value={props.term} onChange={props.setTerm} placeholder="第I期" />
      </div>
      <TextField label="タグ" value={props.tags} onChange={props.setTags} placeholder="入試, 基礎, 確認" />
    </>
  );
}

function TextField({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (value: string) => void; placeholder?: string }) {
  return (
    <label className="block">
      <span className="block text-xs font-bold text-slate-500 mb-1">{label}</span>
      <input value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} className="w-full min-h-10 p-2.5 border border-line rounded-input text-sm font-bold outline-none focus:ring-2 focus:ring-accent/30" />
    </label>
  );
}

function FilterSelect({ value, onChange, options, label }: { value: string; onChange: (value: string) => void; options: string[]; label: string }) {
  return (
    <select value={value} onChange={e => onChange(e.target.value)} className="min-h-11 px-3 py-2.5 border border-line rounded-input text-sm font-bold bg-surface text-slate-700 outline-none">
      <option value="all">{label}: 全て</option>
      {options.map(option => <option key={option} value={option}>{option}</option>)}
    </select>
  );
}
