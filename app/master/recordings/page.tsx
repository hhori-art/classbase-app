'use client';

import { useState, useEffect, useMemo, useRef } from 'react';
import { auth, db } from '@/lib/firebase';
import { 
  collection, query, orderBy, limit, getDocs, doc, writeBatch, where, deleteDoc, updateDoc 
} from 'firebase/firestore';
import { 
  Video, CheckCircle, ArrowLeft, Calendar as CalendarIcon, ExternalLink, 
  RefreshCw, Loader2, Link as LinkIcon, Clock, Trash2, Search, 
  Check, List, CheckSquare, Layers, XCircle, FileUp, Scissors, PlayCircle, Replace
} from 'lucide-react';
import Link from 'next/link';
import {
  getCurrentSchoolYear,
  getRecordingYearScope,
  isZoomRecordingShareUrl,
  normalizeRecordingType,
  normalizeSchoolYear,
  recordingTypeLabel,
  type RecordingType,
  type RecordingYearScope,
} from '@/lib/recordings';

// 型定義
type ShiftData = {
  id: string; 
  target_date: string;
  target_grade: string;
  target_subject: string;
  target_detail_subject?: string;
  unit?: string;
  teacher_name: string;
  target_recording_url?: string; 
  target_recording_file_id?: string;
  target_recording_type?: string;
  target_recording_trim_start_seconds?: number;
  target_recording_trim_end_seconds?: number | null;
  zoom_recording_files?: any[];
  target_meeting_id?: string;
  note?: string;
  defaultTitle?: string;
};

type PublishedData = {
  id: string;
  original_shift_id?: string;
  target_date: string;
  title: string;
  video_url: string;
  grade: string;
  subject: string;
  unit?: string;
  detail_subject?: string;
  teacher_name?: string;
  recording_type?: RecordingType;
  recording_type_label?: string;
  school_year?: number;
  year_scope?: RecordingYearScope;
  source?: string;
  difficulty?: string;
  csv_import_key?: string;
  zoom_recording_file_id?: string;
  target_recording_file_id?: string;
  target_recording_type?: string;
  zoom_recording_files?: any[];
  trim_start_seconds?: number;
  trim_end_seconds?: number | null;
};

type PreviewTarget =
  | { kind: 'shift'; item: ShiftData }
  | { kind: 'published'; item: PublishedData };

type ReplacementTarget =
  | { kind: 'shift'; item: ShiftData }
  | { kind: 'published'; item: PublishedData }
  | { kind: 'group'; group: MissingRecordingGroup };

type MissingRecordingGroup = {
  key: string;
  weekLabel: string;
  grade: string;
  subject: string;
  detailSubject: string;
  unit: string;
  shifts: ShiftData[];
};

type RecordingInput = Omit<Partial<PublishedData>, 'school_year' | 'recording_type'> & {
  school_year?: string | number | null;
  recording_type?: string | null;
};

const csvHeaderAliases = {
  target_date: ['日付', '授業日', 'target_date', 'date'],
  title: ['タイトル', '録画タイトル', 'title'],
  video_url: ['URL', '録画URL', '動画URL', 'video_url', 'url'],
  grade: ['学年', 'grade'],
  subject: ['科目', '教科', 'subject'],
  unit: ['単元', '単元名', '分野', 'unit'],
  detail_subject: ['分野', '詳細科目', 'detail_subject'],
  teacher_name: ['講師', '担当講師', 'teacher_name'],
  school_year: ['年度', 'school_year'],
  recording_type: ['種別', '授業種別', 'recording_type', 'type'],
  difficulty: ['難易度', 'レベル', 'difficulty'],
} as const;

const annualRecordingCsvAliases = {
  class_name: ['クラス', '講座', 'class_name', 'class'],
  publish: ['UP', '公開', '公開対象', 'publish', 'is_published'],
} as const;

function parseCsv(text: string) {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];
    if (char === '"' && quoted && next === '"') {
      cell += '"';
      i += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === ',' && !quoted) {
      row.push(cell.trim());
      cell = '';
    } else if ((char === '\n' || char === '\r') && !quoted) {
      if (char === '\r' && next === '\n') i += 1;
      row.push(cell.trim());
      if (row.some(value => value !== '')) rows.push(row);
      row = [];
      cell = '';
    } else {
      cell += char;
    }
  }

  row.push(cell.trim());
  if (row.some(value => value !== '')) rows.push(row);
  return rows;
}

function findCsvValue(row: Record<string, string>, key: keyof typeof csvHeaderAliases) {
  const aliases = csvHeaderAliases[key];
  for (const alias of aliases) {
    const value = row[alias];
    if (value !== undefined && value !== '') return value;
  }
  return '';
}

function normalizeCsvHeader(value?: string | null) {
  return String(value || '').replace(/^\uFEFF/, '').normalize('NFKC').trim().toLowerCase();
}

function findCsvHeaderIndex(rows: string[][]) {
  const knownHeaders = Object.values(csvHeaderAliases).flat().map(value => normalizeCsvHeader(value));
  return rows.findIndex(row => {
    const normalized = row.map(value => normalizeCsvHeader(value));
    const matches = normalized.filter(value => knownHeaders.includes(value));
    return matches.length >= 2 && normalized.some(value => csvHeaderAliases.video_url.map(alias => normalizeCsvHeader(alias)).includes(value));
  });
}

function findHeaderColumn(headers: string[], aliases: readonly string[]) {
  const normalizedAliases = aliases.map(alias => normalizeCsvHeader(alias));
  return headers.findIndex(header => normalizedAliases.includes(normalizeCsvHeader(header)));
}

function isCsvTruthy(value?: string | null) {
  return ['true', '1', 'yes', 'y', 'up', '公開', '済', '✓', '✔'].includes(normalizeCsvHeader(value));
}

function isHttpUrl(value?: string | null) {
  return /^https?:\/\/\S+$/i.test(String(value || '').trim());
}

function detectCsvSchoolYear(rows: string[][], headerIndex: number) {
  for (const value of rows.slice(0, Math.max(headerIndex, 0)).flat()) {
    const match = String(value || '').normalize('NFKC').match(/(20\d{2})\s*年度/);
    if (match) return Number(match[1]);
  }
  return getCurrentSchoolYear();
}

function normalizeCsvGrade(value?: string | null) {
  const text = String(value || '').normalize('NFKC').replace(/\s+/g, '');
  if (/中(?:学)?1|1年/.test(text)) return '中1';
  if (/中(?:学)?2|2年/.test(text)) return '中2';
  if (/中(?:学)?3|3年/.test(text)) return '中3';
  return text || 'その他';
}

function subjectFromClassName(value?: string | null) {
  const text = String(value || '').normalize('NFKC').trim();
  if (/理科|物理|化学|生物|地学/.test(text)) return '理科';
  if (/社会|地理|歴史|公民/.test(text)) return '社会';
  return '全科目';
}

function monthDayParts(value?: string | null) {
  const match = String(value || '').normalize('NFKC').trim().match(/^(\d{1,2})[\/.-](\d{1,2})/);
  if (!match) return null;
  const month = Number(match[1]);
  const day = Number(match[2]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return { month, day };
}

function dateKeyFromMonthDay(year: number, month: number, day: number) {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function toJstDateKeyFromMillis(ms: number) {
  if (!Number.isFinite(ms) || ms <= 0) return '';
  return new Date(ms + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function dateFromRecordingUrl(url?: string | null) {
  const text = String(url || '').trim();
  const match = text.match(/[?&]startTime=(\d{10,})/);
  return match ? toJstDateKeyFromMillis(Number(match[1])) : '';
}

function normalizeCsvDate(value?: string | null, url?: string | null, schoolYearValue?: string | number | null) {
  const text = String(value || '').trim();
  const ymd = text.match(/^(\d{4})[\/\-.年](\d{1,2})[\/\-.月](\d{1,2})/);
  if (ymd) {
    return `${ymd[1]}-${ymd[2].padStart(2, '0')}-${ymd[3].padStart(2, '0')}`;
  }

  const urlDate = dateFromRecordingUrl(url);
  if (urlDate) return urlDate;

  const schoolYear = normalizeSchoolYear(undefined, schoolYearValue);
  return `${schoolYear}-04-01`;
}

function recordingImportKey(item: Pick<PublishedData, 'video_url' | 'title' | 'grade' | 'subject' | 'unit' | 'recording_type'>) {
  return [
    item.recording_type || '',
    item.grade || '',
    item.subject || '',
    item.unit || '',
    item.title || '',
    item.video_url || '',
  ].join('|').trim();
}

function stableCsvRecordingDocId(item: Pick<PublishedData, 'video_url' | 'title' | 'grade' | 'subject' | 'unit' | 'recording_type'>) {
  const key = recordingImportKey(item);
  let hash = 2166136261;
  for (let i = 0; i < key.length; i += 1) {
    hash ^= key.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `csv_recording_${(hash >>> 0).toString(36)}`;
}

function normalizeRecording(raw: RecordingInput): Omit<PublishedData, 'id'> {
  const schoolYear = normalizeSchoolYear(raw.target_date, raw.school_year);
  const recordingType = normalizeRecordingType(raw.recording_type);
  return {
    target_date: raw.target_date || '',
    title: raw.title || 'タイトルなし',
    video_url: raw.video_url || '',
    grade: raw.grade || 'その他',
    subject: raw.subject || '全科目',
    unit: raw.unit || '',
    detail_subject: raw.detail_subject || '',
    teacher_name: raw.teacher_name || '',
    recording_type: recordingType,
    recording_type_label: recordingTypeLabel(recordingType),
    school_year: schoolYear,
    year_scope: getRecordingYearScope(schoolYear),
    source: raw.source || 'manual',
    difficulty: raw.difficulty || '',
    csv_import_key: raw.csv_import_key || '',
    zoom_recording_file_id: raw.zoom_recording_file_id || raw.target_recording_file_id || '',
    target_recording_file_id: raw.target_recording_file_id || raw.zoom_recording_file_id || '',
    target_recording_type: raw.target_recording_type || '',
    zoom_recording_files: raw.zoom_recording_files || [],
    ...(raw.original_shift_id ? { original_shift_id: raw.original_shift_id } : {}),
  };
}

function shiftDefaultTitle(shift: ShiftData) {
  return `${shift.target_detail_subject || ''} ${shift.unit || ''}`.trim() || `${shift.target_subject || '授業'}の授業`;
}

function dateKeyToWeekStart(dateKey: string) {
  const date = new Date(`${dateKey}T12:00:00`);
  if (Number.isNaN(date.getTime())) return dateKey || '日付未設定';
  const day = date.getDay();
  const mondayOffset = day === 0 ? -6 : 1 - day;
  date.setDate(date.getDate() + mondayOffset);
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-');
}

function dateKeyToWeekLabel(dateKey: string) {
  const start = dateKeyToWeekStart(dateKey);
  const date = new Date(`${start}T12:00:00`);
  if (Number.isNaN(date.getTime())) return start;
  const end = new Date(date);
  end.setDate(date.getDate() + 6);
  const endLabel = `${String(end.getMonth() + 1).padStart(2, '0')}-${String(end.getDate()).padStart(2, '0')}`;
  return `${start}〜${endLabel}`;
}

function dateKeyFromDate(date: Date) {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-');
}

function dateKeyDaysAgo(days: number) {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return dateKeyFromDate(date);
}

function isSupportShift(shift: ShiftData) {
  const teacherName = String(shift.teacher_name || '');
  const subject = String(shift.target_subject || '');
  const note = String(shift.note || '');
  return (
    teacherName.includes('サポート') ||
    teacherName.includes('チューター') ||
    subject === '学習サポート' ||
    note.includes('サポート')
  );
}

export default function MasterApprovalPage() {
  const previewVideoRef = useRef<HTMLVideoElement | null>(null);
  const [candidates, setCandidates] = useState<ShiftData[]>([]);
  const [unpublishedShifts, setUnpublishedShifts] = useState<ShiftData[]>([]);
  const [published, setPublished] = useState<PublishedData[]>([]);
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState(false);
  const [previewTarget, setPreviewTarget] = useState<PreviewTarget | null>(null);
  const [previewToken, setPreviewToken] = useState('');
  const [replacementTarget, setReplacementTarget] = useState<ReplacementTarget | null>(null);
  const [replacementSourceId, setReplacementSourceId] = useState('');
  const [replacementReason, setReplacementReason] = useState('');
  const [replacementSearch, setReplacementSearch] = useState('');
  const [missingShiftSearch, setMissingShiftSearch] = useState('');
  const [replacementSaving, setReplacementSaving] = useState(false);
  
  // --- 左カラム用State ---
  const [viewMode, setViewMode] = useState<'calendar' | 'list'>('calendar');
  const [currentDate, setCurrentDate] = useState(new Date());
  const [selectedDateFilter, setSelectedDateFilter] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [titles, setTitles] = useState<{ [key: string]: string }>({});
  const [trimStart, setTrimStart] = useState<{ [key: string]: string }>({});
  const [trimEnd, setTrimEnd] = useState<{ [key: string]: string }>({});

  // --- 右カラム（公開済み）用State ---
  const [publishedSearch, setPublishedSearch] = useState('');
  const [pubFilterDate, setPubFilterDate] = useState('');
  const [pubFilterSubject, setPubFilterSubject] = useState('all');
  const [pubFilterYearScope, setPubFilterYearScope] = useState<'all' | RecordingYearScope>('all');
  const [pubFilterType, setPubFilterType] = useState<'all' | RecordingType>('all');
  const [pubSelectedIds, setPubSelectedIds] = useState<Set<string>>(new Set());
  const [pubTrimStart, setPubTrimStart] = useState<{ [key: string]: string }>({});
  const [pubTrimEnd, setPubTrimEnd] = useState<{ [key: string]: string }>({});
  const [csvImporting, setCsvImporting] = useState(false);
  const [zoomSyncing, setZoomSyncing] = useState(false);
  const [csvEncoding, setCsvEncoding] = useState<'utf-8' | 'shift-jis'>('utf-8');
  const [csvLog, setCsvLog] = useState('');
  const [zoomSyncLog, setZoomSyncLog] = useState('');

  const previewTitle = previewTarget?.kind === 'shift'
    ? `${previewTarget.item.target_date} ${previewTarget.item.target_grade || ''} ${previewTarget.item.target_subject || ''}`
    : `${previewTarget?.item.target_date || ''} ${previewTarget?.item.title || ''}`;

  const previewExternalUrl = previewTarget?.kind === 'shift'
    ? previewTarget.item.target_recording_url || ''
    : previewTarget?.item.video_url || '';

  const previewSrc = previewTarget?.kind === 'shift'
    ? ((previewTarget.item.target_recording_file_id || isZoomRecordingShareUrl(previewTarget.item.target_recording_url)) ? `/api/zoom/recordings/file?shift_id=${encodeURIComponent(previewTarget.item.id)}&token=${encodeURIComponent(previewToken)}` : previewTarget.item.target_recording_url || '')
    : previewTarget?.kind === 'published'
      ? ((previewTarget.item.zoom_recording_file_id || previewTarget.item.target_recording_file_id || previewTarget.item.original_shift_id || isZoomRecordingShareUrl(previewTarget.item.video_url)) ? `/api/zoom/recordings/file?recording_id=${encodeURIComponent(previewTarget.item.id)}&token=${encodeURIComponent(previewToken)}` : previewTarget.item.video_url || '')
      : '';

  const openPreview = async (target: PreviewTarget) => {
    const token = await auth.currentUser?.getIdToken();
    setPreviewToken(token || '');
    setPreviewTarget(target);
  };

  const setTrimFromPreview = (field: 'start' | 'end') => {
    if (!previewTarget || !previewVideoRef.current) return;
    const seconds = String(Math.max(0, Math.floor(previewVideoRef.current.currentTime || 0)));
    if (previewTarget.kind === 'shift') {
      if (field === 'start') setTrimStart(prev => ({ ...prev, [previewTarget.item.id]: seconds }));
      else setTrimEnd(prev => ({ ...prev, [previewTarget.item.id]: seconds }));
      return;
    }

    if (field === 'start') setPubTrimStart(prev => ({ ...prev, [previewTarget.item.id]: seconds }));
    else setPubTrimEnd(prev => ({ ...prev, [previewTarget.item.id]: seconds }));
  };

  // データ取得
  const fetchData = async () => {
    setLoading(true);
    try {
      // 1. 公開済みデータ
      const pubQ = query(collection(db, 'class_recordings'), orderBy('target_date', 'desc'), limit(500));
      const pubSnap = await getDocs(pubQ);
      const pubList = pubSnap.docs.map(d => {
        const raw = d.data() as Partial<PublishedData>;
        return { id: d.id, ...normalizeRecording(raw) } as PublishedData;
      });
      setPublished(pubList);
      setPubTrimStart(Object.fromEntries(pubList.map(item => [item.id, item.trim_start_seconds ? String(item.trim_start_seconds) : ''])));
      setPubTrimEnd(Object.fromEntries(pubList.map(item => [item.id, item.trim_end_seconds ? String(item.trim_end_seconds) : ''])));

      const publishedShiftIds = new Set(pubList.map(p => p.original_shift_id).filter(Boolean));

      const todayKey = dateKeyFromDate(new Date());
      const recentFromKey = dateKeyDaysAgo(90);

      // 2. 承認候補
      const shiftQ = query(
        collection(db, 'shift_assignments'),
        where('target_date', '>=', recentFromKey),
        where('target_date', '<=', todayKey),
        orderBy('target_date', 'desc'),
        limit(800)
      );
      
      const shiftSnap = await getDocs(shiftQ);
      const rawCandidates = shiftSnap.docs.map(d => ({ id: d.id, ...d.data() } as ShiftData));

      // 3. フィルタリング (未公開 かつ メイン講師のみ)
      const validCandidates = rawCandidates.filter(c => {
        const isPublished = publishedShiftIds.has(c.id);
        
        return !isPublished && !isSupportShift(c) && Boolean(c.target_recording_url);
      });

      setCandidates(validCandidates);

      const allShiftQ = query(
        collection(db, 'shift_assignments'),
        where('target_date', '>=', recentFromKey),
        where('target_date', '<=', todayKey),
        orderBy('target_date', 'desc'),
        limit(800)
      );
      const allShiftSnap = await getDocs(allShiftQ);
      const allMainUnpublished = allShiftSnap.docs
        .map(d => ({ id: d.id, ...d.data() } as ShiftData))
        .filter(shift => !publishedShiftIds.has(shift.id) && !isSupportShift(shift));
      setUnpublishedShifts(allMainUnpublished);

      // タイトル初期値
      const initialTitles: any = {};
      const initialTrimStart: Record<string, string> = {};
      const initialTrimEnd: Record<string, string> = {};
      validCandidates.forEach(c => {
        const t = shiftDefaultTitle(c);
        initialTitles[c.id] = t;
        initialTrimStart[c.id] = c.target_recording_trim_start_seconds ? String(c.target_recording_trim_start_seconds) : '';
        initialTrimEnd[c.id] = c.target_recording_trim_end_seconds ? String(c.target_recording_trim_end_seconds) : '';
        c.defaultTitle = t;
      });
      setTitles(initialTitles);
      setTrimStart(initialTrimStart);
      setTrimEnd(initialTrimEnd);
      
      // 日付フィルターの初期選択
      if (validCandidates.length > 0) {
        const latestDate = validCandidates[0].target_date;
        if (!selectedDateFilter) {
            setSelectedDateFilter(latestDate);
            setCurrentDate(new Date(latestDate));
        }
      }

    } catch (e: any) {
      console.error(e);
      if (e.code === 'failed-precondition') {
        alert('システム設定が必要です。開発者コンソール(F12)のリンクからインデックスを作成してください。');
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  // --- 左カラム：一括操作 ---
  const toggleSelect = (id: string) => {
    const newSet = new Set(selectedIds);
    if (newSet.has(id)) newSet.delete(id); else newSet.add(id);
    setSelectedIds(newSet);
  };

  const toggleSelectAll = () => {
    const targetIds = displayedCandidates.map(c => c.id);
    const allSelected = targetIds.every(id => selectedIds.has(id));
    const newSet = new Set(selectedIds);
    if (allSelected) {
      targetIds.forEach(id => newSet.delete(id));
    } else {
      targetIds.forEach(id => newSet.add(id));
    }
    setSelectedIds(newSet);
  };

  const handleBulkApprove = async () => {
    if (selectedIds.size === 0) return;
    if (!confirm(`${selectedIds.size}件を一括公開しますか？`)) return;
    setProcessing(true);
    try {
      const batch = writeBatch(db);
      const targets = candidates.filter(c => selectedIds.has(c.id));
      const newPublished: PublishedData[] = [];

      targets.forEach(shift => {
        const ref = doc(collection(db, 'class_recordings'));
        const data = {
          ...normalizeRecording({
            original_shift_id: shift.id,
            target_date: shift.target_date,
            grade: shift.target_grade || 'その他',
            subject: shift.target_subject || '全科目',
            detail_subject: shift.target_detail_subject || '',
            unit: shift.unit || '',
            teacher_name: shift.teacher_name || '',
            title: titles[shift.id] || shift.defaultTitle || 'タイトルなし',
            video_url: shift.target_recording_url || '',
            recording_type: 'regular',
            zoom_recording_file_id: shift.target_recording_file_id || '',
            target_recording_file_id: shift.target_recording_file_id || '',
            target_recording_type: shift.target_recording_type || '',
            zoom_recording_files: shift.zoom_recording_files || [],
            source: 'zoom_approval',
          }),
          original_shift_id: shift.id,
          trim_start_seconds: Number(trimStart[shift.id] || 0),
          trim_end_seconds: trimEnd[shift.id] ? Number(trimEnd[shift.id]) : null,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };
        batch.set(ref, data);
        newPublished.push({ id: ref.id, ...data });
      });

      await batch.commit();
      setPublished(prev => [...newPublished, ...prev].sort((a,b) => b.target_date.localeCompare(a.target_date)));
      setCandidates(prev => prev.filter(c => !selectedIds.has(c.id)));
      setSelectedIds(new Set());
    } catch (e) { alert('エラー'); } finally { setProcessing(false); }
  };

  const handleBulkReject = async () => {
    if (selectedIds.size === 0) return;
    if (!confirm(`${selectedIds.size}件のZoom連携を解除しますか？`)) return;
    setProcessing(true);
    try {
      const batch = writeBatch(db);
      selectedIds.forEach(id => {
        const ref = doc(db, 'shift_assignments', id);
        batch.update(ref, { target_recording_url: null });
      });
      await batch.commit();
      setCandidates(prev => prev.filter(c => !selectedIds.has(c.id)));
      setSelectedIds(new Set());
    } catch (e) { alert('エラー'); } finally { setProcessing(false); }
  };

  // --- 右カラム：公開済みフィルター ---
  const filteredPublished = useMemo(() => {
    return published.filter(p => {
      const matchesSearch = 
        p.title.includes(publishedSearch) || 
        p.target_date.includes(publishedSearch) || 
        p.subject.includes(publishedSearch) ||
        (p.unit || '').includes(publishedSearch) ||
        (p.recording_type_label || '').includes(publishedSearch);
      
      const matchesDate = pubFilterDate ? p.target_date === pubFilterDate : true;
      const matchesSubject = pubFilterSubject !== 'all' ? p.subject === pubFilterSubject : true;
      const matchesYearScope = pubFilterYearScope !== 'all' ? p.year_scope === pubFilterYearScope : true;
      const matchesType = pubFilterType !== 'all' ? p.recording_type === pubFilterType : true;

      return matchesSearch && matchesDate && matchesSubject && matchesYearScope && matchesType;
    });
  }, [published, publishedSearch, pubFilterDate, pubFilterSubject, pubFilterYearScope, pubFilterType]);

  const uniqueSubjects = useMemo(() => Array.from(new Set(published.map(p => p.subject))), [published]);
  const currentPublishedCount = useMemo(() => published.filter(p => p.year_scope === 'current').length, [published]);
  const pastPublishedCount = useMemo(() => published.filter(p => p.year_scope === 'past').length, [published]);
  const testPrepPublishedCount = useMemo(() => published.filter(p => p.recording_type === 'test_prep').length, [published]);
  const missingRecordingShifts = useMemo(() => {
    const text = missingShiftSearch.trim().toLowerCase();
    return unpublishedShifts.filter(shift => {
      if (shift.target_recording_url) return false;
      if (!text) return true;
      return [
        shift.target_date,
        shift.target_grade,
        shift.target_subject,
        shift.target_detail_subject,
        shift.unit,
        shift.teacher_name,
        shift.note,
      ].filter(Boolean).join(' ').toLowerCase().includes(text);
    });
  }, [unpublishedShifts, missingShiftSearch]);
  const missingRecordingGroups = useMemo<MissingRecordingGroup[]>(() => {
    const groups = new Map<string, MissingRecordingGroup>();
    missingRecordingShifts.forEach(shift => {
      const weekStart = dateKeyToWeekStart(shift.target_date);
      const grade = shift.target_grade || '学年未設定';
      const subject = shift.target_subject || '科目未設定';
      const detailSubject = shift.target_detail_subject || '';
      const unit = shift.unit || shiftDefaultTitle(shift);
      const key = [weekStart, grade, subject, detailSubject, unit].join('|');
      const existing = groups.get(key);
      if (existing) {
        existing.shifts.push(shift);
        return;
      }

      groups.set(key, {
        key,
        weekLabel: dateKeyToWeekLabel(shift.target_date),
        grade,
        subject,
        detailSubject,
        unit,
        shifts: [shift],
      });
    });

    return Array.from(groups.values())
      .map(group => ({
        ...group,
        shifts: group.shifts.sort((a, b) => `${a.target_date} ${a.note || ''}`.localeCompare(`${b.target_date} ${b.note || ''}`)),
      }))
      .sort((a, b) => b.weekLabel.localeCompare(a.weekLabel) || b.shifts.length - a.shifts.length);
  }, [missingRecordingShifts]);
  const replacementSources = useMemo(() => {
    const text = replacementSearch.trim().toLowerCase();
    const group = replacementTarget?.kind === 'group' ? replacementTarget.group : null;
    return published.filter(item => {
      if (replacementTarget?.kind === 'published' && item.id === replacementTarget.item.id) return false;
      if (group && !text) {
        const sameUnit = [item.unit, item.detail_subject, item.title].filter(Boolean).join(' ').toLowerCase();
        const groupTerms = [group.unit, group.detailSubject].filter(Boolean).join(' ').toLowerCase();
        return item.grade === group.grade && item.subject === group.subject && (!groupTerms || sameUnit.includes(groupTerms) || groupTerms.includes(sameUnit));
      }
      if (!text) return true;
      return [
        item.target_date,
        item.grade,
        item.subject,
        item.detail_subject,
        item.unit,
        item.title,
        item.teacher_name,
      ].filter(Boolean).join(' ').toLowerCase().includes(text);
    }).sort((a, b) => {
      if (!group) return b.target_date.localeCompare(a.target_date);
      const aScore = Number(a.grade === group.grade) + Number(a.subject === group.subject) + Number((a.unit || a.title || '').includes(group.unit));
      const bScore = Number(b.grade === group.grade) + Number(b.subject === group.subject) + Number((b.unit || b.title || '').includes(group.unit));
      return bScore - aScore || b.target_date.localeCompare(a.target_date);
    });
  }, [published, replacementSearch, replacementTarget]);
  const selectedReplacementSource = useMemo(
    () => published.find(item => item.id === replacementSourceId) || null,
    [published, replacementSourceId]
  );

  const openReplacement = (target: ReplacementTarget) => {
    setReplacementTarget(target);
    setReplacementSourceId('');
    setReplacementReason('');
    setReplacementSearch('');
  };

  const replacementTargetLabel = replacementTarget?.kind === 'shift'
    ? `${replacementTarget.item.target_date} ${replacementTarget.item.target_grade || ''} ${replacementTarget.item.target_subject || ''} ${shiftDefaultTitle(replacementTarget.item)}`
    : replacementTarget?.kind === 'group'
      ? `${replacementTarget.group.weekLabel} ${replacementTarget.group.grade} ${replacementTarget.group.subject} ${replacementTarget.group.unit}（${replacementTarget.group.shifts.length}件）`
    : `${replacementTarget?.item.target_date || ''} ${replacementTarget?.item.grade || ''} ${replacementTarget?.item.subject || ''} ${replacementTarget?.item.title || ''}`;

  const applyReplacement = async () => {
    if (!replacementTarget || !selectedReplacementSource) {
      alert('差し替え元の録画を選択してください。');
      return;
    }
    const reason = replacementReason.trim();
    if (!reason) {
      alert('差し替え理由を入力してください。');
      return;
    }

    setReplacementSaving(true);
    setProcessing(true);
    try {
      const now = new Date().toISOString();
      const replacementFields = {
        video_url: selectedReplacementSource.video_url,
        zoom_recording_file_id: selectedReplacementSource.zoom_recording_file_id || selectedReplacementSource.target_recording_file_id || '',
        target_recording_file_id: selectedReplacementSource.target_recording_file_id || selectedReplacementSource.zoom_recording_file_id || '',
        target_recording_type: selectedReplacementSource.target_recording_type || '',
        zoom_recording_files: selectedReplacementSource.zoom_recording_files || [],
        is_replacement: true,
        replacement_source_recording_id: selectedReplacementSource.id,
        replacement_source_title: selectedReplacementSource.title,
        replacement_source_date: selectedReplacementSource.target_date,
        replacement_reason: reason,
        replacement_updated_at: now,
        source: 'recording_replacement',
        updated_at: now,
      };

      if (replacementTarget.kind === 'published') {
        await updateDoc(doc(db, 'class_recordings', replacementTarget.item.id), replacementFields);
        setPublished(prev => prev.map(item => item.id === replacementTarget.item.id ? {
          ...item,
          ...replacementFields,
        } : item));
      } else if (replacementTarget.kind === 'group') {
        const batch = writeBatch(db);
        const newPublished: PublishedData[] = [];
        replacementTarget.group.shifts.forEach(shift => {
          const ref = doc(collection(db, 'class_recordings'));
          const data = {
            ...normalizeRecording({
              original_shift_id: shift.id,
              target_date: shift.target_date,
              grade: shift.target_grade || 'その他',
              subject: shift.target_subject || '全科目',
              detail_subject: shift.target_detail_subject || '',
              unit: shift.unit || '',
              teacher_name: shift.teacher_name || '',
              title: `${shiftDefaultTitle(shift)}（代替録画）`,
              video_url: selectedReplacementSource.video_url,
              recording_type: selectedReplacementSource.recording_type || 'regular',
              zoom_recording_file_id: selectedReplacementSource.zoom_recording_file_id || selectedReplacementSource.target_recording_file_id || '',
              target_recording_file_id: selectedReplacementSource.target_recording_file_id || selectedReplacementSource.zoom_recording_file_id || '',
              target_recording_type: selectedReplacementSource.target_recording_type || '',
              zoom_recording_files: selectedReplacementSource.zoom_recording_files || [],
              source: 'recording_replacement',
            }),
            original_shift_id: shift.id,
            is_replacement: true,
            replacement_source_recording_id: selectedReplacementSource.id,
            replacement_source_title: selectedReplacementSource.title,
            replacement_source_date: selectedReplacementSource.target_date,
            replacement_reason: reason,
            replacement_group_key: replacementTarget.group.key,
            trim_start_seconds: 0,
            trim_end_seconds: null,
            created_at: now,
            updated_at: now,
          };
          batch.set(ref, data);
          newPublished.push({ id: ref.id, ...data });
        });
        await batch.commit();
        const replacedShiftIds = new Set(replacementTarget.group.shifts.map(shift => shift.id));
        setPublished(prev => [...newPublished, ...prev].sort((a, b) => b.target_date.localeCompare(a.target_date)));
        setUnpublishedShifts(prev => prev.filter(item => !replacedShiftIds.has(item.id)));
      } else {
        const shift = replacementTarget.item;
        const ref = doc(collection(db, 'class_recordings'));
        const data = {
          ...normalizeRecording({
            original_shift_id: shift.id,
            target_date: shift.target_date,
            grade: shift.target_grade || 'その他',
            subject: shift.target_subject || '全科目',
            detail_subject: shift.target_detail_subject || '',
            unit: shift.unit || '',
            teacher_name: shift.teacher_name || '',
            title: `${shiftDefaultTitle(shift)}（代替録画）`,
            video_url: selectedReplacementSource.video_url,
            recording_type: selectedReplacementSource.recording_type || 'regular',
            zoom_recording_file_id: selectedReplacementSource.zoom_recording_file_id || selectedReplacementSource.target_recording_file_id || '',
            target_recording_file_id: selectedReplacementSource.target_recording_file_id || selectedReplacementSource.zoom_recording_file_id || '',
            target_recording_type: selectedReplacementSource.target_recording_type || '',
            zoom_recording_files: selectedReplacementSource.zoom_recording_files || [],
            source: 'recording_replacement',
          }),
          original_shift_id: shift.id,
          is_replacement: true,
          replacement_source_recording_id: selectedReplacementSource.id,
          replacement_source_title: selectedReplacementSource.title,
          replacement_source_date: selectedReplacementSource.target_date,
          replacement_reason: reason,
          trim_start_seconds: 0,
          trim_end_seconds: null,
          created_at: now,
          updated_at: now,
        };
        await writeBatch(db).set(ref, data).commit();
        setPublished(prev => [{ id: ref.id, ...data }, ...prev].sort((a, b) => b.target_date.localeCompare(a.target_date)));
        setUnpublishedShifts(prev => prev.filter(item => item.id !== shift.id));
      }

      setReplacementTarget(null);
      setReplacementSourceId('');
      setReplacementReason('');
      await fetchData();
    } catch (error) {
      console.error(error);
      alert('録画の差し替えに失敗しました。');
    } finally {
      setReplacementSaving(false);
      setProcessing(false);
    }
  };

  // --- 右カラム：一括操作 ---
  const togglePubSelect = (id: string) => {
    const newSet = new Set(pubSelectedIds);
    if (newSet.has(id)) newSet.delete(id); else newSet.add(id);
    setPubSelectedIds(newSet);
  };

  const togglePubSelectAll = () => {
    const targetIds = filteredPublished.map(p => p.id);
    const allSelected = targetIds.length > 0 && targetIds.every(id => pubSelectedIds.has(id));
    const newSet = new Set(pubSelectedIds);
    if (allSelected) {
      targetIds.forEach(id => newSet.delete(id));
    } else {
      targetIds.forEach(id => newSet.add(id));
    }
    setPubSelectedIds(newSet);
  };

  const handleBulkUnpublish = async () => {
    if (pubSelectedIds.size === 0) return;
    if (!confirm(`選択した${pubSelectedIds.size}件の動画を削除（公開停止）しますか？`)) return;
    setProcessing(true);
    try {
      const batch = writeBatch(db);
      pubSelectedIds.forEach(id => {
        const ref = doc(db, 'class_recordings', id);
        batch.delete(ref);
      });
      await batch.commit();
      
      // シフト由来のものは候補に戻したいが、複雑になるため今回は単純削除後のリロード
      setPublished(prev => prev.filter(p => !pubSelectedIds.has(p.id)));
      setPubSelectedIds(new Set());
      fetchData(); // 整合性のため再取得
    } catch (e) { alert('エラー'); } finally { setProcessing(false); }
  };

  const handleUnpublish = async (pubId: string) => {
    if(!confirm('公開を取り下げますか？')) return;
    setProcessing(true);
    try {
      await deleteDoc(doc(db, 'class_recordings', pubId));
      fetchData(); 
    } catch (e) { alert('削除失敗'); } finally { setProcessing(false); }
  };

  const handlePublishedTrimSave = async (pubId: string) => {
    setProcessing(true);
    try {
      const startValue = pubTrimStart[pubId] ? Number(pubTrimStart[pubId]) : 0;
      const endValue = pubTrimEnd[pubId] ? Number(pubTrimEnd[pubId]) : null;
      if (startValue < 0 || (endValue !== null && endValue < 0)) {
        alert('トリミング秒数は0以上で入力してください。');
        return;
      }
      if (endValue !== null && endValue <= startValue) {
        alert('終了秒は開始秒より大きい値にしてください。');
        return;
      }
      await updateDoc(doc(db, 'class_recordings', pubId), {
        trim_start_seconds: startValue,
        trim_end_seconds: endValue,
        updated_at: new Date().toISOString(),
      });
      setPublished(prev => prev.map(item => item.id === pubId ? { ...item, trim_start_seconds: startValue, trim_end_seconds: endValue } : item));
    } catch (error) {
      console.error(error);
      alert('トリミング設定の保存に失敗しました。');
    } finally {
      setProcessing(false);
    }
  };

  const handleCsvImport = async (file?: File) => {
    if (!file) return;
    setCsvImporting(true);
    setCsvLog('');
    try {
      const buffer = await file.arrayBuffer();
      const text = new TextDecoder(csvEncoding).decode(buffer);
      const rows = parseCsv(text.replace(/^\uFEFF/, ''));
      if (rows.length < 2) {
        alert('CSVに取り込める行がありません。');
        return;
      }

      const headerIndex = findCsvHeaderIndex(rows);
      if (headerIndex < 0) {
        alert('CSVの見出し行を判定できませんでした。URL列と学年・タイトルなどの列名を確認してください。');
        return;
      }

      const headers = rows[headerIndex].map(header => header.trim());
      const dataRows = rows.slice(headerIndex + 1);
      const publishColumn = findHeaderColumn(headers, annualRecordingCsvAliases.publish);
      const classColumn = findHeaderColumn(headers, annualRecordingCsvAliases.class_name);
      const urlColumn = findHeaderColumn(headers, csvHeaderAliases.video_url);
      const dateColumn = findHeaderColumn(headers, csvHeaderAliases.target_date);
      const isAnnualRecordingList = publishColumn >= 0 && classColumn >= 0;
      const detectedSchoolYear = detectCsvSchoolYear(rows, headerIndex);
      const items: Omit<PublishedData, 'id'>[] = [];
      let eligibleRows = 0;
      let excludedRows = 0;
      let noUrlRows = 0;
      let annualCalendarYear = detectedSchoolYear;
      let previousAnnualMonth: number | null = null;

      dataRows.forEach(values => {
        let annualTargetDate = '';
        if (isAnnualRecordingList && dateColumn >= 0) {
          const parts = monthDayParts(values[dateColumn]);
          if (parts) {
            if (previousAnnualMonth !== null && previousAnnualMonth >= 10 && parts.month <= 3) {
              annualCalendarYear += 1;
            }
            previousAnnualMonth = parts.month;
            annualTargetDate = dateKeyFromMonthDay(annualCalendarYear, parts.month, parts.day);
          }
        }

        if (isAnnualRecordingList && !isCsvTruthy(values[publishColumn])) {
          excludedRows += 1;
          return;
        }
        eligibleRows += 1;

        const row = headers.reduce<Record<string, string>>((acc, header, index) => {
          if (header) acc[header] = values[index]?.trim() || '';
          return acc;
        }, {});

        const videoUrls = isAnnualRecordingList
          ? values.slice(Math.max(urlColumn, 0)).map(value => String(value || '').trim()).filter(isHttpUrl)
          : [findCsvValue(row, 'video_url')].filter(isHttpUrl);
        if (videoUrls.length === 0) {
          noUrlRows += 1;
          return;
        }

        const rawDate = findCsvValue(row, 'target_date');
        const csvSchoolYear = findCsvValue(row, 'school_year');
        const schoolYearValue = isAnnualRecordingList ? detectedSchoolYear : csvSchoolYear;
        const hasExplicitDate = rawDate.trim() !== '';
        const effectiveSchoolYear = !isAnnualRecordingList && !hasExplicitDate && !schoolYearValue
          ? getCurrentSchoolYear() - 1
          : schoolYearValue;

        const className = isAnnualRecordingList ? values[classColumn]?.trim() || '' : '';
        const unit = findCsvValue(row, 'unit');
        const baseTitle = findCsvValue(row, 'title') || `${className} ${unit}`.trim() || unit || className;
        videoUrls.forEach((videoUrl, urlIndex) => {
          const targetDate = isAnnualRecordingList
            ? annualTargetDate || dateFromRecordingUrl(videoUrl) || normalizeCsvDate(rawDate, videoUrl, effectiveSchoolYear)
            : normalizeCsvDate(rawDate, videoUrl, effectiveSchoolYear);
          const title = videoUrls.length > 1 ? `${baseTitle}（${urlIndex + 1}）` : baseTitle;
          const item = normalizeRecording({
            target_date: targetDate,
            title,
            video_url: videoUrl,
            grade: isAnnualRecordingList ? normalizeCsvGrade(findCsvValue(row, 'grade')) : findCsvValue(row, 'grade'),
            subject: findCsvValue(row, 'subject') || subjectFromClassName(className),
            unit,
            detail_subject: findCsvValue(row, 'detail_subject') || className,
            teacher_name: findCsvValue(row, 'teacher_name'),
            school_year: effectiveSchoolYear,
            recording_type: findCsvValue(row, 'recording_type'),
            difficulty: findCsvValue(row, 'difficulty'),
            source: isAnnualRecordingList ? 'annual_recording_csv_up' : 'csv_import',
          });
          items.push({
            ...item,
            csv_import_key: recordingImportKey(item),
          });
        });
      });

      if (items.length === 0) {
        alert(isAnnualRecordingList
          ? 'UPにチェックが入り、録画URLが設定された行が見つかりませんでした。'
          : '録画URLが入った行が見つかりませんでした。');
        return;
      }

      for (let i = 0; i < items.length; i += 400) {
        const batch = writeBatch(db);
        items.slice(i, i + 400).forEach(item => {
          const ref = doc(db, 'class_recordings', stableCsvRecordingDocId(item));
          batch.set(ref, {
            ...item,
            imported_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          }, { merge: true });
        });
        await batch.commit();
      }

      setCsvLog(isAnnualRecordingList
        ? `UP対象${eligibleRows}行の録画${items.length}件を取り込みました。UP対象外: ${excludedRows}行 / URLなし: ${noUrlRows}行。同じ録画は上書き更新されます。`
        : `${items.length}件を取り込みました。同じ録画は上書き更新されます。URLなし: ${noUrlRows}行`);
      await fetchData();
    } catch (error) {
      console.error(error);
      alert('CSV取り込みに失敗しました。文字コードや列名を確認してください。');
    } finally {
      setCsvImporting(false);
    }
  };

  const handleZoomSync = async () => {
    if (!confirm('Zoom APIから直近30日分の録画を同期しますか？')) return;
    setZoomSyncing(true);
    setZoomSyncLog('');
    try {
      const token = await auth.currentUser?.getIdToken();
      const res = await fetch('/api/zoom/recordings/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ days: 30, max_meetings: 180 }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.ok === false) throw new Error(data.error || 'Zoom録画同期に失敗しました');
      const reasonCounts = data.reason_counts || {};
      const unmatched = Number(reasonCounts['no-matching-shift'] || 0);
      const noUrl = Number(reasonCounts['no-recording-url'] || 0);
      setZoomSyncLog(`Zoom録画同期(${data.scope === 'account' ? 'アカウント全体' : 'ユーザー'}): 取得${data.meetings || 0}件 / 対象${data.eligible || 0}件 / 講師配置一致${data.matched || 0}件 / 更新${data.updated || 0}件${unmatched ? ` / 未一致${unmatched}件` : ''}${noUrl ? ` / URLなし${noUrl}件` : ''}${data.truncated ? ' / 件数が多いため一部のみ処理' : ''}`);
      await fetchData();
    } catch (error: any) {
      console.error(error);
      setZoomSyncLog(`Zoom録画同期エラー: ${error.message || error}`);
    } finally {
      setZoomSyncing(false);
    }
  };

  // --- カレンダーロジック ---
  const getDaysInMonth = (year: number, month: number) => new Date(year, month + 1, 0).getDate();
  const getFirstDayOfMonth = (year: number, month: number) => new Date(year, month, 1).getDay();
  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();
  const days = [];
  for (let i = 0; i < getFirstDayOfMonth(year, month); i++) days.push(null);
  for (let i = 1; i <= getDaysInMonth(year, month); i++) days.push(i);

  const displayedCandidates = useMemo(() => {
    if (viewMode === 'list') return candidates;
    if (!selectedDateFilter) return [];
    return candidates.filter(c => c.target_date === selectedDateFilter);
  }, [candidates, viewMode, selectedDateFilter]);

  const dateCounts = useMemo(() => {
    const counts: {[key:string]: number} = {};
    candidates.forEach(c => {
      counts[c.target_date] = (counts[c.target_date] || 0) + 1;
    });
    return counts;
  }, [candidates]);

  return (
    <div className="min-h-screen bg-[#F0F4F8] p-6 pb-40 font-sans text-slate-800">
      {previewTarget && (
        <div className="fixed inset-0 z-[200] bg-slate-950/80 p-4 backdrop-blur-sm">
          <div className="mx-auto flex h-full max-w-6xl flex-col overflow-hidden rounded-[28px] bg-white shadow-2xl">
            <div className="flex flex-col gap-3 border-b border-slate-100 p-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <p className="truncate text-sm font-black text-slate-900">{previewTitle}</p>
                <p className="text-xs font-bold text-slate-400">動画を再生し、現在位置を開始秒・終了秒へ反映できます。</p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  onClick={() => setTrimFromPreview('start')}
                  className="flex items-center gap-1 rounded-xl bg-blue-50 px-3 py-2 text-xs font-black text-blue-700 hover:bg-blue-100"
                >
                  <Scissors size={14}/> 現在位置を開始秒
                </button>
                <button
                  onClick={() => setTrimFromPreview('end')}
                  className="flex items-center gap-1 rounded-xl bg-amber-50 px-3 py-2 text-xs font-black text-amber-700 hover:bg-amber-100"
                >
                  <Scissors size={14}/> 現在位置を終了秒
                </button>
                {previewExternalUrl && (
                  <a href={previewExternalUrl} target="_blank" rel="noreferrer" className="rounded-xl bg-slate-100 px-3 py-2 text-xs font-black text-slate-600 hover:bg-slate-200">
                    外部で開く
                  </a>
                )}
                <button onClick={() => setPreviewTarget(null)} className="rounded-xl bg-slate-900 px-4 py-2 text-xs font-black text-white hover:bg-slate-800">
                  閉じる
                </button>
              </div>
            </div>
            <div className="min-h-0 flex-1 bg-slate-950">
              {previewSrc ? (
                <video
                  key={previewSrc}
                  ref={previewVideoRef}
                  src={previewSrc}
                  className="h-full w-full"
                  controls
                  playsInline
                  preload="metadata"
                />
              ) : (
                <div className="flex h-full items-center justify-center p-6 text-center text-sm font-bold text-white">
                  この録画は画面内再生に必要なZoom録画ファイル情報がありません。
                </div>
              )}
            </div>
            <div className="grid gap-2 border-t border-slate-100 bg-slate-50 p-4 text-xs font-bold text-slate-500 sm:grid-cols-2">
              <div>
                開始秒: {previewTarget.kind === 'shift' ? (trimStart[previewTarget.item.id] || '0') : (pubTrimStart[previewTarget.item.id] || '0')}
              </div>
              <div>
                終了秒: {previewTarget.kind === 'shift' ? (trimEnd[previewTarget.item.id] || '未指定') : (pubTrimEnd[previewTarget.item.id] || '未指定')}
              </div>
            </div>
          </div>
        </div>
      )}
      {replacementTarget && (
        <div className="fixed inset-0 z-[210] bg-slate-950/80 p-4 backdrop-blur-sm">
          <div className="mx-auto flex max-h-full max-w-4xl flex-col overflow-hidden rounded-[28px] bg-white shadow-2xl">
            <div className="border-b border-slate-100 p-5">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <h2 className="flex items-center gap-2 text-lg font-black text-slate-900">
                    <span className="rounded-xl bg-purple-50 p-2 text-purple-700"><Replace size={18}/></span>
                    録画を別録画で置き換え
                  </h2>
                  <p className="mt-2 line-clamp-2 text-xs font-bold text-slate-500">
                    対象: {replacementTargetLabel}
                  </p>
                </div>
                <button
                  onClick={() => setReplacementTarget(null)}
                  className="rounded-xl bg-slate-100 px-4 py-2 text-xs font-black text-slate-600 hover:bg-slate-200"
                >
                  閉じる
                </button>
              </div>
            </div>
            <div className="grid min-h-0 flex-1 gap-4 overflow-hidden p-5 lg:grid-cols-[1fr_320px]">
              <div className="flex min-h-0 flex-col">
                <div className="relative mb-3 shrink-0">
                  <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"/>
                  <input
                    value={replacementSearch}
                    onChange={(e) => setReplacementSearch(e.target.value)}
                    placeholder="差し替え元の録画を検索（日付・単元・講師など）"
                    className="w-full rounded-2xl border border-slate-200 bg-slate-50 py-3 pl-9 pr-3 text-sm font-bold outline-none focus:border-purple-400 focus:bg-white"
                  />
                </div>
                <div className="min-h-[320px] flex-1 overflow-y-auto rounded-2xl border border-slate-100 bg-slate-50 p-2">
                  {replacementSources.length === 0 ? (
                    <div className="flex h-full items-center justify-center p-8 text-center text-xs font-bold text-slate-400">
                      差し替え元にできる公開済み録画がありません。
                    </div>
                  ) : replacementSources.map(source => {
                    const selected = replacementSourceId === source.id;
                    return (
                      <button
                        key={source.id}
                        onClick={() => setReplacementSourceId(source.id)}
                        className={`mb-2 w-full rounded-2xl border p-3 text-left transition-all ${selected ? 'border-purple-400 bg-purple-50 shadow-sm' : 'border-white bg-white hover:border-purple-200'}`}
                      >
                        <div className="mb-1 flex flex-wrap items-center gap-1 text-[10px] font-black text-slate-400">
                          <span>{source.target_date}</span>
                          <span className="rounded bg-slate-100 px-1.5 text-slate-500">{source.grade}</span>
                          <span className="rounded bg-slate-100 px-1.5 text-slate-500">{source.subject}</span>
                          {source.recording_type_label && <span className="rounded bg-blue-50 px-1.5 text-blue-600">{source.recording_type_label}</span>}
                        </div>
                        <p className="line-clamp-2 text-xs font-black text-slate-800">{source.title}</p>
                        {source.unit && <p className="mt-1 line-clamp-1 text-[10px] font-bold text-slate-400">{source.unit}</p>}
                      </button>
                    );
                  })}
                </div>
              </div>
              <div className="space-y-3 rounded-2xl border border-slate-100 bg-slate-50 p-4">
                <div>
                  <p className="mb-1 text-[10px] font-black text-slate-400">選択中の差し替え元</p>
                  <div className="rounded-2xl bg-white p-3 text-xs font-bold text-slate-600">
                    {selectedReplacementSource ? (
                      <>
                        <p className="font-black text-slate-800">{selectedReplacementSource.title}</p>
                        <p className="mt-1 text-[10px] text-slate-400">{selectedReplacementSource.target_date} / {selectedReplacementSource.grade} / {selectedReplacementSource.subject}</p>
                      </>
                    ) : '未選択'}
                  </div>
                </div>
                <div>
                  <label className="mb-1 block text-[10px] font-black text-slate-400">差し替え理由</label>
                  <textarea
                    value={replacementReason}
                    onChange={(e) => setReplacementReason(e.target.value)}
                    placeholder="例: 録画押し忘れのため、同一単元の別日録画で代替"
                    className="h-28 w-full resize-none rounded-2xl border border-slate-200 bg-white p-3 text-xs font-bold text-slate-700 outline-none focus:border-purple-400"
                  />
                </div>
                <button
                  onClick={applyReplacement}
                  disabled={replacementSaving || !selectedReplacementSource}
                  className="flex w-full items-center justify-center gap-2 rounded-2xl bg-purple-600 px-4 py-3 text-sm font-black text-white shadow-sm hover:bg-purple-700 disabled:opacity-50"
                >
                  {replacementSaving ? <Loader2 className="animate-spin" size={16}/> : <Replace size={16}/>}
                  この録画で置き換える
                </button>
                <p className="text-[10px] font-bold leading-relaxed text-slate-400">
                  授業日・学年・科目などの表示情報は対象授業のまま残し、動画だけを選択した録画に差し替えます。
                </p>
              </div>
            </div>
          </div>
        </div>
      )}
      <div className="max-w-[1800px] mx-auto">
        
        {/* ヘッダー */}
        <div className="flex flex-col md:flex-row items-center justify-between mb-8 gap-6">
          <div className="flex items-center gap-4">
            <Link href="/master" className="bg-white p-4 rounded-full shadow-sm text-gray-400 hover:text-red-600 hover:shadow-md transition-all active:scale-95">
              <ArrowLeft size={24} strokeWidth={3} />
            </Link>
            <div>
              <h1 className="text-2xl font-black text-gray-800 flex items-center gap-3 tracking-tight">
                <span className="bg-gradient-to-br from-red-500 to-pink-600 text-white p-2.5 rounded-2xl shadow-lg shadow-red-200">
                  <Video size={24} strokeWidth={3} />
                </span>
                録画承認センター
              </h1>
              <p className="text-xs font-bold text-gray-400 mt-1 pl-1">未承認: {candidates.length}件</p>
            </div>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            <button onClick={handleZoomSync} disabled={zoomSyncing} className="flex items-center justify-center gap-2 bg-slate-900 px-5 py-3 rounded-2xl text-sm font-black text-white hover:bg-slate-800 shadow-sm transition-colors disabled:opacity-60">
              {zoomSyncing ? <Loader2 className="animate-spin" size={18} /> : <RefreshCw size={18} strokeWidth={2.5} />} Zoom録画を同期
            </button>
            <button onClick={fetchData} className="flex items-center justify-center gap-2 bg-white px-5 py-3 rounded-2xl text-sm font-black text-gray-600 hover:bg-gray-50 shadow-sm transition-colors">
              <RefreshCw size={18} strokeWidth={2.5} /> 更新
            </button>
          </div>
        </div>
        {zoomSyncLog && (
          <div className={`mb-4 rounded-2xl px-4 py-3 text-xs font-black ${zoomSyncLog.includes('エラー') ? 'bg-red-50 text-red-700' : 'bg-slate-900 text-white'}`}>
            {zoomSyncLog}
          </div>
        )}

        <div className="mb-8 bg-white rounded-[28px] border border-slate-100 p-4 shadow-sm">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
            <div>
              <h2 className="text-sm font-black text-slate-700 flex items-center gap-2">
                <span className="bg-blue-50 text-blue-600 p-2 rounded-xl"><FileUp size={16}/></span>
                録画CSV取り込み
              </h2>
              <p className="mt-1 text-xs font-bold text-slate-400">
                年度録画一覧は「UP」が有効な行だけを公開します。1行に複数の録画URLがある場合も、すべて取り込みます。
              </p>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <select
                className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-bold text-slate-600 outline-none focus:border-blue-400"
                value={csvEncoding}
                onChange={(e) => setCsvEncoding(e.target.value as 'utf-8' | 'shift-jis')}
                disabled={csvImporting}
              >
                <option value="utf-8">UTF-8</option>
                <option value="shift-jis">Shift_JIS</option>
              </select>
              <label className="flex cursor-pointer items-center justify-center gap-2 rounded-xl bg-slate-800 px-4 py-2 text-xs font-black text-white shadow-sm transition-colors hover:bg-slate-700">
                {csvImporting ? <Loader2 className="animate-spin" size={16}/> : <FileUp size={16}/>}
                CSVを選択して取り込み
                <input
                  type="file"
                  accept=".csv,text/csv"
                  className="hidden"
                  disabled={csvImporting}
                  onChange={(e) => {
                    handleCsvImport(e.target.files?.[0]);
                    e.currentTarget.value = '';
                  }}
                />
              </label>
            </div>
          </div>
          {csvLog && <p className="mt-3 rounded-xl bg-green-50 px-3 py-2 text-xs font-black text-green-700">{csvLog}</p>}
        </div>

        <div className="mb-8 rounded-[28px] border border-purple-100 bg-white p-4 shadow-sm">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
            <div>
              <h2 className="flex items-center gap-2 text-sm font-black text-slate-700">
                <span className="rounded-xl bg-purple-50 p-2 text-purple-700"><Replace size={16}/></span>
                録画なし授業へのまとめて割り当て
              </h2>
              <p className="mt-1 text-xs font-bold text-slate-400">
                1週間の講師配置から同じ学年・科目・単元をまとめています。良い録画を選ぶと、同じ単元の録画なし授業へ一括で割り当てできます。
              </p>
            </div>
            <div className="relative w-full xl:w-96">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"/>
              <input
                value={missingShiftSearch}
                onChange={(e) => setMissingShiftSearch(e.target.value)}
                placeholder="日付・学年・科目・単元で検索"
                className="w-full rounded-2xl border border-slate-200 bg-slate-50 py-3 pl-9 pr-3 text-xs font-bold outline-none focus:border-purple-400 focus:bg-white"
              />
            </div>
          </div>
          <div className="mt-4 max-h-80 overflow-y-auto rounded-2xl border border-slate-100 bg-slate-50 p-2">
            {missingRecordingGroups.length === 0 ? (
              <div className="p-6 text-center text-xs font-bold text-slate-400">
                録画なしの未公開授業は見つかりません。
              </div>
            ) : (
              <div className="grid gap-2 lg:grid-cols-2 xl:grid-cols-3">
                {missingRecordingGroups.slice(0, 60).map(group => {
                  const dates = Array.from(new Set(group.shifts.map(shift => shift.target_date))).join(' / ');
                  const teachers = Array.from(new Set(group.shifts.map(shift => shift.teacher_name).filter(Boolean))).slice(0, 4).join('、');
                  return (
                  <div key={group.key} className="rounded-2xl border border-white bg-white p-3">
                    <div className="mb-2 flex flex-wrap items-center gap-1 text-[10px] font-black text-slate-400">
                      <span>{group.weekLabel}</span>
                      <span className="rounded bg-slate-100 px-1.5 text-slate-500">{group.grade}</span>
                      <span className="rounded bg-slate-100 px-1.5 text-slate-500">{group.subject}</span>
                      <span className="rounded bg-purple-50 px-1.5 text-purple-700">{group.shifts.length}件</span>
                    </div>
                    <p className="line-clamp-2 text-sm font-black text-slate-800">{group.unit}</p>
                    {group.detailSubject && <p className="mt-1 text-[10px] font-bold text-slate-500">{group.detailSubject}</p>}
                    <div className="mt-2 rounded-xl bg-slate-50 p-2 text-[10px] font-bold leading-relaxed text-slate-500">
                      <p className="line-clamp-2">日付: {dates}</p>
                      <p className="line-clamp-1">講師: {teachers || '未設定'}</p>
                    </div>
                    <button
                      onClick={() => openReplacement({ kind: 'group', group })}
                      className="mt-3 flex w-full items-center justify-center gap-1 rounded-xl bg-purple-600 px-3 py-2 text-[10px] font-black text-white hover:bg-purple-700"
                    >
                      <Replace size={12}/> この単元へまとめて割り当て
                    </button>
                  </div>
                );
                })}
              </div>
            )}
          </div>
          {missingRecordingGroups.length > 60 && (
            <p className="mt-2 text-right text-[10px] font-bold text-slate-400">表示は先頭60件です。検索で絞り込んでください。</p>
          )}
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-12 gap-8 items-start">
          
          {/* === 左カラム: 承認ワークスペース === */}
          <div className="xl:col-span-8 space-y-6">
            
            {/* 左コントロールバー */}
            <div className="bg-white p-2 rounded-[24px] shadow-sm border border-slate-100 flex flex-wrap items-center justify-between gap-3 sticky top-4 z-20">
              <div className="bg-slate-100 p-1 rounded-xl flex gap-1">
                <button onClick={() => setViewMode('calendar')} className={`px-4 py-2 rounded-lg text-xs font-black flex items-center gap-2 transition-all ${viewMode==='calendar' ? 'bg-white text-red-600 shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}>
                  <CalendarIcon size={16}/> カレンダー
                </button>
                <button onClick={() => setViewMode('list')} className={`px-4 py-2 rounded-lg text-xs font-black flex items-center gap-2 transition-all ${viewMode==='list' ? 'bg-white text-red-600 shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}>
                  <List size={16}/> 全リスト
                </button>
              </div>

              {selectedIds.size > 0 && (
                <div className="flex items-center gap-2 mr-2 animate-in fade-in">
                  <span className="text-xs font-bold text-slate-500 mr-2">{selectedIds.size}件選択中</span>
                  <button onClick={handleBulkReject} disabled={processing} className="bg-slate-200 text-slate-600 px-4 py-2 rounded-xl text-xs font-bold hover:bg-slate-300 transition-colors flex items-center gap-1">
                    <Trash2 size={14}/> 却下
                  </button>
                  <button onClick={handleBulkApprove} disabled={processing} className="bg-red-600 text-white px-5 py-2 rounded-xl text-xs font-bold hover:bg-red-700 shadow-md shadow-red-200 transition-all active:scale-95 flex items-center gap-1">
                    {processing ? <Loader2 className="animate-spin" size={14}/> : <CheckCircle size={14}/>} 
                    一括承認
                  </button>
                </div>
              )}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-12 gap-6">
              {/* カレンダー */}
              {viewMode === 'calendar' && (
                <div className="md:col-span-5 lg:col-span-4">
                  <div className="bg-white p-6 rounded-[32px] shadow-sm border border-slate-100">
                    <div className="flex items-center justify-between mb-4">
                      <button onClick={() => setCurrentDate(new Date(year, month - 1, 1))} className="p-2 hover:bg-slate-50 rounded-full text-slate-400"><ArrowLeft size={18}/></button>
                      <h2 className="text-lg font-black text-slate-700">{year}年 <span className="text-red-500">{month + 1}月</span></h2>
                      <button onClick={() => setCurrentDate(new Date(year, month + 1, 1))} className="p-2 hover:bg-slate-50 rounded-full text-slate-400"><ArrowLeft size={18} className="rotate-180"/></button>
                    </div>
                    <div className="grid grid-cols-7 text-center mb-2">
                      {['日', '月', '火', '水', '木', '金', '土'].map((d, i) => (<div key={i} className={`text-xs font-black ${i===0?'text-red-400':i===6?'text-blue-400':'text-slate-300'}`}>{d}</div>))}
                    </div>
                    <div className="grid grid-cols-7 gap-1.5">
                      {days.map((day, idx) => {
                        if (!day) return <div key={idx}></div>;
                        const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
                        const count = dateCounts[dateStr] || 0;
                        const isSelected = selectedDateFilter === dateStr;
                        return (
                          <button key={idx} onClick={() => setSelectedDateFilter(dateStr)} className={`aspect-square rounded-2xl flex flex-col items-center justify-center relative transition-all duration-200 ${isSelected ? 'bg-red-600 text-white shadow-lg shadow-red-200 scale-105 z-10' : count > 0 ? 'bg-red-50 text-red-600 border-2 border-red-100 hover:border-red-300' : 'text-slate-300 hover:bg-slate-50'}`}>
                            <span className={`text-sm ${isSelected||count>0 ? 'font-black' : 'font-bold'}`}>{day}</span>
                            {count > 0 && !isSelected && <span className="absolute bottom-1 right-1 bg-red-500 text-white text-[9px] font-bold w-4 h-4 rounded-full flex items-center justify-center">{count}</span>}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>
              )}

              {/* 承認リスト */}
              <div className={viewMode === 'calendar' ? 'md:col-span-7 lg:col-span-8' : 'md:col-span-12'}>
                <div className="flex items-center justify-between mb-4 px-2">
                  <h3 className="font-black text-slate-700 flex items-center gap-2">
                    {viewMode === 'calendar' && selectedDateFilter ? <><span className="bg-red-500 text-white p-1.5 rounded-lg"><CalendarIcon size={16}/></span>{new Date(selectedDateFilter).toLocaleDateString()} の承認待ち</> : <><span className="bg-red-500 text-white p-1.5 rounded-lg"><List size={16}/></span>全ての承認待ち</>}
                  </h3>
                  {displayedCandidates.length > 0 && (
                    <button onClick={toggleSelectAll} className="text-xs font-bold text-slate-500 hover:text-red-600 flex items-center gap-1 transition-colors"><CheckSquare size={14}/> {displayedCandidates.every(c => selectedIds.has(c.id)) ? '選択解除' : 'すべて選択'}</button>
                  )}
                </div>

                {loading ? <div className="p-20 text-center"><Loader2 className="animate-spin inline text-red-400" size={32}/></div> : displayedCandidates.length === 0 ? <div className="bg-white p-12 rounded-[32px] border-4 border-dashed border-slate-100 text-center text-slate-300"><p className="font-bold">この条件の承認待ちはありません</p></div> : (
                  <div className="space-y-4">
                    {displayedCandidates.map((shift) => {
                      const isSelected = selectedIds.has(shift.id);
                      return (
                        <div key={shift.id} className={`bg-white p-5 rounded-[28px] border-2 transition-all group relative overflow-hidden ${isSelected ? 'border-red-400 bg-red-50/30' : 'border-slate-100 hover:border-red-200'}`}>
                          <div className="absolute inset-0 cursor-pointer z-0" onClick={() => toggleSelect(shift.id)} />
                          <div className="relative z-10 flex gap-4 items-start pointer-events-none">
                            <div className={`w-6 h-6 rounded-lg border-2 flex items-center justify-center shrink-0 mt-1 transition-colors ${isSelected ? 'bg-red-500 border-red-500 text-white' : 'border-slate-300 bg-white'}`}>{isSelected && <Check size={16} strokeWidth={4}/>}</div>
                            <div className="flex-1">
                              <div className="flex flex-wrap items-center gap-2 mb-2 pointer-events-auto">
                                <span className="bg-slate-100 text-slate-500 text-[10px] font-bold px-2 py-0.5 rounded flex items-center gap-1"><Clock size={10}/> {shift.target_date} {shift.note || ''}</span>
                                <span className="bg-blue-50 text-blue-600 text-[10px] font-bold px-2 py-0.5 rounded flex items-center gap-1"><LinkIcon size={10}/> Zoom連携済</span>
                                <button
                                  onClick={(e) => { e.stopPropagation(); openPreview({ kind: 'shift', item: shift }); }}
                                  className="ml-auto flex items-center gap-1 rounded-lg bg-slate-900 px-2 py-1 text-[10px] font-black text-white hover:bg-slate-700"
                                >
                                  <PlayCircle size={10}/> 画面内で確認
                                </button>
                                <a href={shift.target_recording_url} target="_blank" rel="noreferrer" className="text-[10px] font-bold text-blue-500 hover:underline flex items-center gap-1 z-20"><ExternalLink size={10}/> 外部</a>
                              </div>
                              <h4 className="text-lg font-black text-slate-800 leading-snug">{shift.target_grade} {shift.target_subject}<span className="text-sm text-slate-400 ml-2 font-bold">by {shift.teacher_name}</span></h4>
                              <div className="mt-3 pointer-events-auto">
                                <input type="text" className="w-full p-2 bg-slate-50 border border-slate-200 rounded-xl text-sm font-bold text-slate-700 outline-none focus:bg-white focus:border-red-300 transition-colors" value={titles[shift.id] || ''} onChange={(e) => setTitles(prev => ({...prev, [shift.id]: e.target.value}))} onClick={(e) => e.stopPropagation()} placeholder="公開タイトル"/>
                              </div>
                              <div className="mt-2 grid grid-cols-2 gap-2 pointer-events-auto">
                                <input type="number" min="0" className="w-full p-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-700 outline-none focus:bg-white focus:border-red-300 transition-colors" value={trimStart[shift.id] || ''} onChange={(e) => setTrimStart(prev => ({...prev, [shift.id]: e.target.value}))} onClick={(e) => e.stopPropagation()} placeholder="開始秒 例: 60"/>
                                <input type="number" min="0" className="w-full p-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-700 outline-none focus:bg-white focus:border-red-300 transition-colors" value={trimEnd[shift.id] || ''} onChange={(e) => setTrimEnd(prev => ({...prev, [shift.id]: e.target.value}))} onClick={(e) => e.stopPropagation()} placeholder="終了秒 任意"/>
                              </div>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* === 右カラム: 公開済み管理 === */}
          <div className="xl:col-span-4 space-y-4">
            <div className="bg-white p-5 rounded-[32px] shadow-sm border border-slate-100 h-full max-h-[calc(100vh-100px)] flex flex-col">
              
              {/* 右カラムヘッダー */}
              <div className="flex items-center justify-between mb-4 shrink-0">
                <h2 className="font-black text-slate-700 flex items-center gap-2">
                  <span className="bg-green-100 text-green-700 p-1.5 rounded-lg"><Layers size={16}/></span>
                  公開済み
                  <span className="bg-slate-100 text-slate-500 text-xs px-2 py-0.5 rounded-full">{published.length}</span>
                </h2>
                
                {/* 一括削除ボタン (選択時) */}
                {pubSelectedIds.size > 0 && (
                  <button onClick={handleBulkUnpublish} disabled={processing} className="text-xs bg-red-50 text-red-600 px-3 py-1.5 rounded-full font-bold hover:bg-red-100 transition-colors flex items-center gap-1 animate-in zoom-in">
                    <Trash2 size={12}/> {pubSelectedIds.size}件削除
                  </button>
                  )}
              </div>
              <div className="mb-4 grid grid-cols-3 gap-2 shrink-0">
                <button onClick={() => setPubFilterYearScope('current')} className={`rounded-xl px-2 py-2 text-left transition-colors ${pubFilterYearScope === 'current' ? 'bg-green-600 text-white' : 'bg-slate-50 text-slate-500 hover:bg-green-50 hover:text-green-700'}`}>
                  <p className="text-[10px] font-black">今年度</p>
                  <p className="text-sm font-black">{currentPublishedCount}</p>
                </button>
                <button onClick={() => setPubFilterYearScope('past')} className={`rounded-xl px-2 py-2 text-left transition-colors ${pubFilterYearScope === 'past' ? 'bg-slate-700 text-white' : 'bg-slate-50 text-slate-500 hover:bg-slate-100'}`}>
                  <p className="text-[10px] font-black">過去</p>
                  <p className="text-sm font-black">{pastPublishedCount}</p>
                </button>
                <button onClick={() => setPubFilterType('test_prep')} className={`rounded-xl px-2 py-2 text-left transition-colors ${pubFilterType === 'test_prep' ? 'bg-amber-500 text-white' : 'bg-amber-50 text-amber-700 hover:bg-amber-100'}`}>
                  <p className="text-[10px] font-black">テスト対策</p>
                  <p className="text-sm font-black">{testPrepPublishedCount}</p>
                </button>
              </div>

              {/* フィルターエリア */}
              <div className="space-y-2 mb-4 shrink-0">
                {/* テキスト検索 */}
                <div className="relative">
                  <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"/>
                  <input type="text" placeholder="検索..." className="w-full pl-9 pr-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold outline-none focus:border-green-400 transition-colors" value={publishedSearch} onChange={(e) => setPublishedSearch(e.target.value)} />
                </div>
                
                {/* 詳細フィルター */}
                <div className="flex gap-2">
                  <input type="date" className="flex-1 bg-slate-50 border border-slate-200 rounded-lg px-2 py-1.5 text-xs font-bold text-slate-600 outline-none focus:border-green-400" value={pubFilterDate} onChange={(e) => setPubFilterDate(e.target.value)} />
                  <select className="flex-1 bg-slate-50 border border-slate-200 rounded-lg px-2 py-1.5 text-xs font-bold text-slate-600 outline-none focus:border-green-400" value={pubFilterSubject} onChange={(e) => setPubFilterSubject(e.target.value)}>
                    <option value="all">全科目</option>
                    {uniqueSubjects.map(sub => <option key={sub} value={sub}>{sub}</option>)}
                  </select>
                </div>
                <div className="flex gap-2">
                  <select className="flex-1 bg-slate-50 border border-slate-200 rounded-lg px-2 py-1.5 text-xs font-bold text-slate-600 outline-none focus:border-green-400" value={pubFilterYearScope} onChange={(e) => setPubFilterYearScope(e.target.value as 'all' | RecordingYearScope)}>
                    <option value="all">全年度</option>
                    <option value="current">今年度</option>
                    <option value="past">過去</option>
                  </select>
                  <select className="flex-1 bg-slate-50 border border-slate-200 rounded-lg px-2 py-1.5 text-xs font-bold text-slate-600 outline-none focus:border-green-400" value={pubFilterType} onChange={(e) => setPubFilterType(e.target.value as 'all' | RecordingType)}>
                    <option value="all">全種別</option>
                    <option value="regular">通常授業</option>
                    <option value="test_prep">テスト対策</option>
                  </select>
                  {(pubFilterDate || pubFilterSubject !== 'all' || pubFilterYearScope !== 'all' || pubFilterType !== 'all') && (
                    <button onClick={() => { setPubFilterDate(''); setPubFilterSubject('all'); setPubFilterYearScope('all'); setPubFilterType('all'); }} className="p-1.5 bg-gray-100 rounded-lg text-gray-500 hover:text-red-500 hover:bg-red-50"><XCircle size={16}/></button>
                  )}
                </div>

                {/* 全選択ボタン */}
                {filteredPublished.length > 0 && (
                  <div className="flex justify-end">
                    <button onClick={togglePubSelectAll} className="text-[10px] font-bold text-slate-400 hover:text-green-600 flex items-center gap-1 transition-colors">
                      <CheckSquare size={12}/> {filteredPublished.every(p => pubSelectedIds.has(p.id)) ? '解除' : 'すべて選択'}
                    </button>
                  </div>
                )}
              </div>

              {/* リスト */}
              <div className="overflow-y-auto custom-scrollbar space-y-2 flex-1 pr-1">
                {filteredPublished.length === 0 ? (
                  <div className="text-center py-10 text-slate-300 text-xs font-bold">該当なし</div>
                ) : (
                  filteredPublished.map((pub) => {
                    const isSelected = pubSelectedIds.has(pub.id);
                    return (
                      <div 
                        key={pub.id} 
                        className={`p-3 rounded-2xl border transition-all group flex gap-3 items-start cursor-pointer ${isSelected ? 'border-green-400 bg-green-50/30' : 'border-slate-100 hover:border-green-200 hover:bg-green-50/10'}`}
                        onClick={() => togglePubSelect(pub.id)}
                      >
                        <div className={`w-5 h-5 rounded border-2 flex items-center justify-center shrink-0 mt-1.5 transition-colors ${isSelected ? 'bg-green-500 border-green-500 text-white' : 'border-slate-200 bg-white'}`}>
                          {isSelected && <Check size={12} strokeWidth={4}/>}
                        </div>
                        
                        <div className="flex-1 min-w-0">
                          <p className="text-[10px] font-bold text-slate-400 mb-1 flex flex-wrap items-center gap-1">
                            <span>{pub.target_date}</span>
                            <span className="bg-slate-100 px-1.5 rounded text-slate-500">{pub.subject}</span>
                            <span className={pub.year_scope === 'current' ? 'bg-green-100 text-green-700 px-1.5 rounded' : 'bg-slate-100 text-slate-500 px-1.5 rounded'}>{pub.school_year}年度</span>
                            <span className={pub.recording_type === 'test_prep' ? 'bg-amber-100 text-amber-700 px-1.5 rounded' : 'bg-blue-50 text-blue-600 px-1.5 rounded'}>{pub.recording_type_label}</span>
                          </p>
                          <h5 className="text-xs font-black text-slate-700 truncate mb-1">{pub.title}</h5>
                          {pub.unit && <p className="mb-1 truncate text-[10px] font-bold text-slate-400">{pub.unit}</p>}
                          <div className="mb-2 grid grid-cols-[1fr_1fr_auto] gap-1 pointer-events-auto" onClick={(e) => e.stopPropagation()}>
                            <input
                              type="number"
                              min="0"
                              value={pubTrimStart[pub.id] || ''}
                              onChange={(e) => setPubTrimStart(prev => ({ ...prev, [pub.id]: e.target.value }))}
                              className="min-w-0 rounded-lg border border-slate-200 bg-slate-50 px-2 py-1.5 text-[10px] font-bold text-slate-600 outline-none focus:border-green-400"
                              placeholder="開始秒"
                            />
                            <input
                              type="number"
                              min="0"
                              value={pubTrimEnd[pub.id] || ''}
                              onChange={(e) => setPubTrimEnd(prev => ({ ...prev, [pub.id]: e.target.value }))}
                              className="min-w-0 rounded-lg border border-slate-200 bg-slate-50 px-2 py-1.5 text-[10px] font-bold text-slate-600 outline-none focus:border-green-400"
                              placeholder="終了秒"
                            />
                            <button
                              onClick={() => handlePublishedTrimSave(pub.id)}
                              disabled={processing}
                              className="rounded-lg bg-green-600 px-2 py-1.5 text-[10px] font-black text-white hover:bg-green-700 disabled:opacity-50"
                            >
                              保存
                            </button>
                          </div>
                          <div className="flex justify-between items-center pointer-events-auto"> {/* リンクなどはクリック可能に */}
                            <div className="flex items-center gap-2">
                              <button
                                onClick={(e) => { e.stopPropagation(); openPreview({ kind: 'published', item: pub }); }}
                                className="flex items-center gap-1 rounded-lg bg-slate-900 px-2 py-1 text-[10px] font-black text-white hover:bg-slate-700"
                              >
                                <PlayCircle size={10}/> 確認
                              </button>
                              <button
                                onClick={(e) => { e.stopPropagation(); openReplacement({ kind: 'published', item: pub }); }}
                                className="flex items-center gap-1 rounded-lg bg-purple-50 px-2 py-1 text-[10px] font-black text-purple-700 hover:bg-purple-100"
                              >
                                <Replace size={10}/> 差替
                              </button>
                              <a href={pub.video_url} target="_blank" rel="noreferrer" className="text-[10px] text-blue-500 hover:underline flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                                <ExternalLink size={10}/> 外部
                              </a>
                            </div>
                            {/* 個別削除ボタンも維持 */}
                            <button onClick={(e) => { e.stopPropagation(); handleUnpublish(pub.id); }} className="text-slate-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity">
                              <Trash2 size={14}/>
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}
