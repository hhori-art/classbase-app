'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { auth, db } from '@/lib/firebase';
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDocs,
  orderBy,
  query,
  serverTimestamp,
  writeBatch,
} from 'firebase/firestore';
import {
  ArrowLeft,
  BookOpen,
  Check,
  Download,
  FileText,
  FileUp,
  Loader2,
  Plus,
  Save,
  Search,
  Sparkles,
  Trash2,
} from 'lucide-react';

const SUBJECT_CATEGORIES = {
  science: { label: '理科', items: ['物理', '化学', '生物', '地学'], color: 'bg-purple-100 text-purple-700' },
  society: { label: '社会', items: ['地理', '歴史', '公民'], color: 'bg-orange-100 text-orange-700' },
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
  return date ? date.toLocaleDateString('ja-JP') : '日時不明';
}

function formatBytes(value?: number) {
  if (!value) return '';
  if (value < 1024 * 1024) return `${Math.round(value / 1024)}KB`;
  return `${(value / 1024 / 1024).toFixed(1)}MB`;
}

function compactForAi(value: unknown, maxChars = 12000) {
  const text = String(value || '').replace(/\n{3,}/g, '\n\n').trim();
  if (text.length <= maxChars) return text;
  const head = text.slice(0, Math.floor(maxChars * 0.45));
  const middleStart = Math.max(0, Math.floor(text.length / 2 - maxChars * 0.15));
  const middle = text.slice(middleStart, middleStart + Math.floor(maxChars * 0.25));
  const tail = text.slice(-Math.floor(maxChars * 0.25));
  return `${head}\n\n【中略】\n\n${middle}\n\n【後半抜粋】\n\n${tail}`.slice(0, maxChars);
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
  const [slides, setSlides] = useState<SlideItem[]>([]);
  const [units, setUnits] = useState<any[]>([]);
  const [curriculumCatalog, setCurriculumCatalog] = useState<CurriculumItem[]>([]);
  const [loading, setLoading] = useState(true);
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
      alert('教材データの取得に失敗しました');
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
    if (!unitName || !content || !subject) return alert('全ての項目を入力してください');

    setSubmitting(true);
    try {
      await addDoc(collection(db, 'learning_units'), {
        grade,
        subject,
        category: selectedCategory,
        unit_name: unitName,
        content,
        term: term || null,
        year,
        month: month || null,
        tags: tags.split(/[,\s、]+/).map(v => v.trim()).filter(Boolean),
        source_type: 'manual',
        created_at: serverTimestamp(),
        updated_at: serverTimestamp(),
      });

      alert('単元を登録しました');
      setUnitName('');
      setContent('');
      await fetchData();
    } catch (e) {
      console.error(e);
      alert('登録失敗');
    } finally {
      setSubmitting(false);
    }
  };

  const handlePptxUpload = async () => {
    if (pendingPptx.length === 0) return alert('PPTXファイルを選択してください');
    const invalid = pendingPptx.find(item => !item.unitName.trim() || !item.grade || !item.subject);
    if (invalid) return alert(`${invalid.file.name} の学年・科目・単元名を確認してください`);
    const user = auth.currentUser;
    if (!user) return alert('ログイン状態を確認できません');

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
      alert([
        `${success}件のPPTXを教材として登録しました。`,
        failed.length ? `失敗: ${failed.length}件\n${failed.slice(0, 5).map(r => `・${r.file}: ${r.message}`).join('\n')}` : '',
      ].filter(Boolean).join('\n\n'));
      setPendingPptx(failed.length ? pendingPptx.filter(item => failed.some(f => f.file === item.file.name)) : []);
      setContent('');
      await fetchData();
    } catch (e: any) {
      alert(`アップロードに失敗しました: ${e.message || e}`);
    } finally {
      setUploading(false);
    }
  };

  const handleGenerateQuestions = async (slide: SlideItem) => {
    if (!slide.content) return alert('問題作成に使える本文がありません');
    if (!confirm(`「${slide.unit_name}」からAIクエスト問題を作成しますか？`)) return;

    setGeneratingId(slide.id);
    try {
      const res = await fetch('/api/homework/adaptive', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          grade: slide.grade,
          subject: slide.subject,
          unitName: slide.unit_name,
          unitContent: compactForAi(slide.content),
          questionCount: 60,
        }),
      });
      const data = await readJsonResponse(res);
      if (!res.ok || !Array.isArray(data.questions) || data.questions.length === 0) {
        throw new Error(data.error || '問題が生成されませんでした');
      }

      const batch = writeBatch(db);
      data.questions.slice(0, 60).forEach((q: any) => {
        const ref = doc(collection(db, 'quizzes'));
        batch.set(ref, {
          question: q.question,
          correct_answer: q.correct_answer,
          wrong_answers: Array.isArray(q.wrong_answers) ? q.wrong_answers.slice(0, 3) : [],
          explanation: q.explanation || '',
          grade: slide.grade || '',
          subject: slide.subject || '',
          unit_name: slide.unit_name || '',
          source_slide_id: slide.id,
          source_type: 'pptx_ai',
          question_order: 1000 + Math.floor(Math.random() * 100000),
          created_at: serverTimestamp(),
        });
      });
      await batch.commit();
      alert(`${Math.min(data.questions.length, 60)}問をAIクエスト問題として追加保存しました`);
    } catch (e: any) {
      alert(`問題作成に失敗しました: ${e.message || e}`);
    } finally {
      setGeneratingId(null);
    }
  };

  const handleDeleteSlide = async (slide: SlideItem) => {
    if (!confirm(`「${slide.unit_name || slide.file_name || 'PPT'}」を削除しますか？\nPPTファイル・AIクエスト単元・このPPTから作成した問題も削除されます。`)) return;
    const user = auth.currentUser;
    if (!user) return alert('ログイン状態を確認できません');

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
      alert(`PPTを削除しました。\n削除した問題: ${data.deleted_quizzes || 0}問`);
    } catch (e: any) {
      alert(`削除に失敗しました: ${e.message || e}`);
    } finally {
      setDeletingId(null);
    }
  };

  const handleDownload = async (slide: SlideItem) => {
    const user = auth.currentUser;
    if (!user) return alert('ログイン状態を確認できません');
    try {
      const token = await user.getIdToken();
      const res = await fetch(`/api/slides/${slide.id}/download`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || 'download-failed');
      window.open(data.url, '_blank', 'noopener,noreferrer');
    } catch (e: any) {
      alert(`ダウンロードURLの取得に失敗しました: ${e.message || e}`);
    }
  };

  const handleDeleteUnit = async (id: string) => {
    if (!confirm('この単元を削除しますか？')) return;
    await deleteDoc(doc(db, 'learning_units', id));
    setUnits(prev => prev.filter(u => u.id !== id));
  };

  return (
    <div className="min-h-screen bg-gray-50 p-4 sm:p-8">
      <div className="max-w-7xl mx-auto">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8">
          <div className="flex items-center gap-4">
            <Link href="/master/imports" className="bg-white p-3 rounded-full shadow hover:bg-gray-100">
              <ArrowLeft size={20} />
            </Link>
            <div>
              <h1 className="text-2xl font-bold text-gray-800 flex items-center gap-2">
                <FileText className="text-indigo-600" /> 授業PPT・AIクエスト教材管理
              </h1>
              <p className="text-xs text-gray-500 mt-1">PPTXを読み取り、講師配布用ファイルとAIクエスト用単元を同時に管理します。</p>
            </div>
          </div>
          <Link href="/teacher/slides" className="bg-white border border-indigo-100 text-indigo-700 px-4 py-2 rounded-xl text-sm font-bold flex items-center gap-2 hover:bg-indigo-50">
            <BookOpen size={16} /> 講師表示を確認
          </Link>
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-3 gap-8">
          <div className="space-y-6">
            <section className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100">
              <h2 className="font-bold text-gray-700 mb-5 flex items-center gap-2">
                <FileUp className="bg-indigo-100 text-indigo-600 rounded p-1" size={22} />
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

                <label className="block border-2 border-dashed border-indigo-200 bg-indigo-50/40 rounded-2xl p-5 text-center cursor-pointer hover:bg-indigo-50">
                  <FileUp className="mx-auto text-indigo-500 mb-2" size={30} />
                  <p className="text-sm font-bold text-gray-700">
                    {pendingPptx.length > 0 ? `${pendingPptx.length}件のPPTXを選択中` : 'PPTXファイルをまとめて選択'}
                  </p>
                  <p className="text-[11px] text-gray-400 mt-1">PowerPoint形式 .pptx のみ対応。ファイル名をカリキュラムと照合します。</p>
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
                  <div className="rounded-2xl border border-indigo-100 bg-white p-4 space-y-3">
                    <div className="flex items-center justify-between text-xs font-bold">
                      <span className="text-gray-600">読み込み進捗</span>
                      <span className="text-indigo-700">
                        {uploadProgress.completed} / {uploadProgress.total}件
                      </span>
                    </div>
                    <div className="h-2.5 rounded-full bg-gray-100 overflow-hidden">
                      <div
                        className="h-full bg-indigo-600 transition-all"
                        style={{ width: `${uploadProgress.total ? Math.round((uploadProgress.completed / uploadProgress.total) * 100) : 0}%` }}
                      />
                    </div>
                    <div className="grid grid-cols-3 gap-2 text-center text-[11px] font-bold">
                      <div className="rounded-lg bg-emerald-50 text-emerald-700 py-2">成功 {uploadProgress.success}</div>
                      <div className="rounded-lg bg-red-50 text-red-600 py-2">失敗 {uploadProgress.failed}</div>
                      <div className="rounded-lg bg-indigo-50 text-indigo-700 py-2">処理中 {uploadProgress.active.length}</div>
                    </div>
                    {uploadProgress.active.length > 0 && (
                      <p className="text-[11px] text-gray-500 truncate">
                        読み込み中: {uploadProgress.active.join('、')}
                      </p>
                    )}
                  </div>
                )}

                {pendingPptx.length > 0 && (
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <p className="text-xs font-bold text-gray-500">アップロード予定ファイル</p>
                      <button type="button" onClick={() => setPendingPptx([])} className="text-xs font-bold text-red-500 hover:text-red-600">
                        全てクリア
                      </button>
                    </div>
                    <div className="space-y-3 max-h-[420px] overflow-y-auto pr-1">
                      {pendingPptx.map(item => (
                        <div key={item.id} className="rounded-2xl border border-gray-100 bg-gray-50 p-3 space-y-3">
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <p className="text-sm font-bold text-gray-800 truncate">{item.file.name}</p>
                              <p className={`text-[11px] mt-1 font-bold ${item.matchScore > 0 ? 'text-emerald-600' : 'text-amber-600'}`}>
                                {item.matchScore > 0 ? `一致候補: ${item.matchLabel}` : 'カリキュラム一致候補なし'}
                              </p>
                              {item.uploadStatus && item.uploadStatus !== 'queued' && (
                                <p className={`text-[11px] mt-1 font-bold ${
                                  item.uploadStatus === 'success' ? 'text-emerald-600' :
                                  item.uploadStatus === 'failed' ? 'text-red-600' :
                                  'text-indigo-600'
                                }`}>
                                  {item.uploadStatus === 'uploading' ? '読み込み中...' : item.uploadMessage}
                                </p>
                              )}
                            </div>
                            <button type="button" onClick={() => setPendingPptx(prev => prev.filter(p => p.id !== item.id))} className="p-1.5 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50">
                              <Trash2 size={15} />
                            </button>
                          </div>

                          <input
                            value={item.unitName}
                            onChange={e => updatePending(item.id, { unitName: e.target.value })}
                            className="w-full p-2 border border-gray-200 rounded-lg text-xs font-bold bg-white"
                            placeholder="単元名"
                          />
                          <div className="grid grid-cols-2 gap-2">
                            <select
                              value={item.grade}
                              onChange={e => updatePending(item.id, { grade: e.target.value })}
                              className="p-2 border border-gray-200 rounded-lg text-xs font-bold bg-white"
                            >
                              {['中1', '中2', '中3'].map(g => <option key={g} value={g}>{g}</option>)}
                            </select>
                            <select
                              value={item.subject}
                              onChange={e => updatePending(item.id, { subject: e.target.value, category: categoryFromSubject(e.target.value) })}
                              className="p-2 border border-gray-200 rounded-lg text-xs font-bold bg-white"
                            >
                              {Object.values(SUBJECT_CATEGORIES).flatMap(c => c.items).map(s => <option key={s} value={s}>{s}</option>)}
                            </select>
                          </div>
                          <div className="grid grid-cols-3 gap-2">
                            <input value={item.year} onChange={e => updatePending(item.id, { year: e.target.value })} className="p-2 border border-gray-200 rounded-lg text-xs font-bold bg-white" placeholder="年度" />
                            <input value={item.month} onChange={e => updatePending(item.id, { month: e.target.value })} className="p-2 border border-gray-200 rounded-lg text-xs font-bold bg-white" placeholder="月" />
                            <input value={item.term} onChange={e => updatePending(item.id, { term: e.target.value })} className="p-2 border border-gray-200 rounded-lg text-xs font-bold bg-white" placeholder="ターム" />
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <button
                  type="button"
                  onClick={handlePptxUpload}
                  disabled={uploading}
                  className="w-full bg-indigo-600 text-white py-3.5 rounded-xl font-bold hover:bg-indigo-700 transition-all flex justify-center items-center gap-2 shadow-lg shadow-indigo-200 disabled:opacity-50"
                >
                  {uploading ? <Loader2 className="animate-spin" size={20}/> : <FileUp size={20}/>}
                  {uploading ? 'PPTXを読み込み中' : 'PPTXを一括登録してAIクエストへ連携'}
                </button>
              </div>
            </section>

            <section className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100">
              <h2 className="font-bold text-gray-700 mb-5 flex items-center gap-2">
                <Plus className="bg-slate-100 text-slate-600 rounded p-1" size={22} />
                テキスト単元の手動登録
              </h2>
              <form onSubmit={handleManualSubmit} className="space-y-5">
                <textarea
                  value={content}
                  onChange={e => setContent(e.target.value)}
                  className="w-full h-40 p-3 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-indigo-200 outline-none resize-none"
                  placeholder="PPTXを使わず、スライド内容や教材本文を直接登録する場合はこちらに入力します。"
                />
                <button
                  type="submit"
                  disabled={submitting}
                  className="w-full bg-slate-800 text-white py-3 rounded-xl font-bold hover:bg-slate-900 transition-all flex justify-center items-center gap-2 disabled:opacity-50"
                >
                  {submitting ? <Loader2 className="animate-spin" size={20}/> : <Save size={20}/>}
                  手動単元として登録
                </button>
              </form>
            </section>
          </div>

          <div className="xl:col-span-2 space-y-6">
            <section className="bg-white p-5 rounded-2xl shadow-sm border border-gray-100">
              <div className="flex flex-col lg:flex-row gap-3">
                <div className="relative flex-1">
                  <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                  <input
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    placeholder="単元名・科目・ターム・ファイル名で検索"
                    className="w-full pl-9 pr-3 py-2.5 border border-gray-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-indigo-100"
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
                  <h2 className="font-bold text-gray-700">登録済み授業PPT</h2>
                  <p className="text-xs text-gray-400">{filteredSlides.length}件表示 / 全{slides.length}件</p>
                </div>
              </div>

              {loading ? (
                <div className="text-center py-20 bg-white rounded-2xl"><Loader2 className="animate-spin inline text-indigo-400"/></div>
              ) : filteredSlides.length === 0 ? (
                <div className="text-gray-400 text-center py-20 bg-white rounded-2xl border border-dashed border-gray-200">
                  条件に合うPPTがありません
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-3">
                  {filteredSlides.map(slide => (
                    <div key={slide.id} className="bg-white p-5 rounded-xl border border-gray-100 shadow-sm hover:border-indigo-200 transition-all">
                      <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-4">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2 mb-2">
                            <span className="text-xs font-bold bg-gray-100 text-gray-600 px-2 py-1 rounded">{slide.grade}</span>
                            <span className={`text-xs font-bold px-2 py-1 rounded ${badgeStyle(slide.subject)}`}>{slide.subject}</span>
                            {slide.year && <span className="text-xs font-bold bg-blue-50 text-blue-700 px-2 py-1 rounded">{slide.year}</span>}
                            {slide.term && <span className="text-xs font-bold bg-amber-50 text-amber-700 px-2 py-1 rounded">{slide.term}</span>}
                            {slide.month && <span className="text-xs font-bold bg-emerald-50 text-emerald-700 px-2 py-1 rounded">{slide.month}</span>}
                            <span className="text-[10px] text-gray-400">{dateLabel(slide.created_at)}</span>
                          </div>
                          <h3 className="font-bold text-lg text-gray-800 mb-1 truncate">{slide.unit_name}</h3>
                          <p className="text-xs text-gray-500 mb-2">
                            {slide.file_name || 'PPTXファイル'} {formatBytes(slide.file_size)} {slide.slide_count ? `/ ${slide.slide_count}枚` : ''}
                          </p>
                          <p className="text-xs text-gray-500 line-clamp-2 bg-gray-50 p-2 rounded max-w-3xl">{slide.content}</p>
                        </div>
                        <div className="flex lg:flex-col gap-2 shrink-0">
                          <button onClick={() => handleDownload(slide)} className="px-3 py-2 rounded-lg bg-slate-100 text-slate-700 text-xs font-bold flex items-center gap-1 hover:bg-slate-200">
                            <Download size={14}/> ダウンロード
                          </button>
                          <button
                            onClick={() => handleGenerateQuestions(slide)}
                            disabled={generatingId === slide.id}
                            className="px-3 py-2 rounded-lg bg-indigo-600 text-white text-xs font-bold flex items-center gap-1 hover:bg-indigo-700 disabled:opacity-50"
                          >
                            {generatingId === slide.id ? <Loader2 size={14} className="animate-spin"/> : <Sparkles size={14}/>}
                            AI問題作成
                          </button>
                          <button
                            onClick={() => handleDeleteSlide(slide)}
                            disabled={deletingId === slide.id}
                            className="px-3 py-2 rounded-lg bg-red-50 text-red-600 text-xs font-bold flex items-center gap-1 hover:bg-red-100 disabled:opacity-50"
                          >
                            {deletingId === slide.id ? <Loader2 size={14} className="animate-spin"/> : <Trash2 size={14}/>}
                            削除
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>

            <section>
              <h2 className="font-bold text-gray-700 mb-3">AIクエスト単元リスト</h2>
              <div className="grid grid-cols-1 gap-3">
                {units.slice(0, 30).map(unit => (
                  <div key={unit.id} className="bg-white p-4 rounded-xl border border-gray-100 shadow-sm flex justify-between items-start group">
                    <div>
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-xs font-bold bg-gray-100 text-gray-600 px-2 py-1 rounded">{unit.grade}</span>
                        <span className={`text-xs font-bold px-2 py-1 rounded ${badgeStyle(unit.subject)}`}>{unit.subject}</span>
                        {unit.source_type === 'pptx' && <span className="text-xs font-bold bg-indigo-50 text-indigo-700 px-2 py-1 rounded">PPTX連携</span>}
                      </div>
                      <h3 className="font-bold text-gray-800">{unit.unit_name}</h3>
                      <p className="text-xs text-gray-500 line-clamp-1">{unit.content}</p>
                    </div>
                    <button onClick={() => handleDeleteUnit(unit.id)} className="p-2 text-gray-300 hover:text-red-500 hover:bg-red-50 rounded-full transition-colors opacity-0 group-hover:opacity-100">
                      <Trash2 size={16}/>
                    </button>
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
        <label className="block text-xs font-bold text-gray-400 mb-2">対象学年</label>
        <div className="flex bg-gray-100 p-1 rounded-lg">
          {['中1','中2','中3'].map(g => (
            <button key={g} type="button" onClick={() => props.setGrade(g)} className={`flex-1 py-2 text-sm font-bold rounded-md transition-all ${props.grade === g ? 'bg-white shadow text-indigo-600' : 'text-gray-400 hover:text-gray-600'}`}>{g}</button>
          ))}
        </div>
      </div>

      <div>
        <label className="block text-xs font-bold text-gray-400 mb-2">教科カテゴリー</label>
        <div className="grid grid-cols-3 gap-2">
          {(Object.entries(SUBJECT_CATEGORIES) as [CategoryKey, typeof SUBJECT_CATEGORIES[CategoryKey]][]).map(([key, data]) => (
            <button key={key} type="button" onClick={() => props.handleCategoryChange(key)} className={`py-2 rounded-lg text-sm font-bold border-2 transition-all ${props.selectedCategory === key ? `border-transparent ${data.color} ring-2 ring-offset-1 ring-gray-200` : 'border-gray-100 bg-white text-gray-500 hover:border-gray-200'}`}>
              {data.label}
            </button>
          ))}
        </div>
      </div>

      <div>
        <label className="block text-xs font-bold text-gray-400 mb-2">詳細分野</label>
        <div className="flex flex-wrap gap-2">
          {SUBJECT_CATEGORIES[props.selectedCategory].items.map(item => (
            <button key={item} type="button" onClick={() => props.setSubject(item)} className={`px-4 py-2 rounded-lg text-sm font-bold flex items-center gap-2 transition-all ${props.subject === item ? 'bg-gray-800 text-white shadow-md' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'}`}>
              {item}
              {props.subject === item && <Check size={14}/>}
            </button>
          ))}
        </div>
      </div>

      <div>
        <label className="block text-xs font-bold text-gray-400 mb-1">単元名</label>
        <input value={props.unitName} onChange={e => props.setUnitName(e.target.value)} className="w-full p-3 border border-gray-200 rounded-xl font-bold focus:ring-2 focus:ring-indigo-200 outline-none" placeholder="例: 歴史A 第1講" />
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
      <span className="block text-xs font-bold text-gray-400 mb-1">{label}</span>
      <input value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} className="w-full p-2.5 border border-gray-200 rounded-xl text-sm font-bold outline-none focus:ring-2 focus:ring-indigo-100" />
    </label>
  );
}

function FilterSelect({ value, onChange, options, label }: { value: string; onChange: (value: string) => void; options: string[]; label: string }) {
  return (
    <select value={value} onChange={e => onChange(e.target.value)} className="px-3 py-2.5 border border-gray-200 rounded-xl text-sm font-bold bg-white text-gray-700 outline-none">
      <option value="all">{label}: 全て</option>
      {options.map(option => <option key={option} value={option}>{option}</option>)}
    </select>
  );
}
