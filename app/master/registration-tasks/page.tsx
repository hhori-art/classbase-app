'use client';

import { useState, useEffect } from 'react';
import { auth, db } from '@/lib/firebase';
import { collection, addDoc, query, orderBy, getDocs, updateDoc, doc, deleteDoc, serverTimestamp, limit, where } from 'firebase/firestore';
import { reportAuditLog } from '@/app/components/master/audit-log-client';
import { Plus, CheckCircle, StopCircle, ClipboardList, X, Trash2, Calendar, BookOpen, Users, UserPlus, GraduationCap, Check, Pencil } from 'lucide-react';
import CourseRegistrationCalendar from '@/app/components/CourseRegistrationCalendar';
import { enrichCourseOptionsWithShifts } from '@/lib/course-registration-match';
import { isThirdCourseTerm } from '@/lib/course-registration-rules';
import { loadCourseRegistrationOptions } from '@/lib/client-course-options';
import AdminPageHeader from '@/app/components/master/AdminPageHeader';
import { jstDateKey } from '@/lib/date-key';
import { formatDate } from '@/lib/format';
import { Button, ButtonLink, EmptyState, ErrorState, IconButton, ListSkeleton, Modal, Skeleton, useConfirm, useToast } from '@/app/components/ui';

// デフォルトの科目リスト
const DEFAULT_SUBJECTS = ['英語', '数学', '国語', '理科', '社会'];

// 学年リスト
const GRADE_OPTIONS = ['中1', '中2', '中3'];

const currentCourseYear = () => {
  const now = new Date();
  return now.getMonth() + 1 >= 4 ? now.getFullYear() : now.getFullYear() - 1;
};

const courseYearDateRange = (year: number) => ({
  start: `${year}-04-01`,
  end: `${year + 1}-03-31`,
});

// 送信対象のタイプ
type TargetAudience = 'all' | 'new_only' | 'grade';

const normalizeScopeText = (value: any) => String(value || '').normalize('NFKC').replace(/[\s　]/g, '').toLowerCase();

const optionMatchesSavedScope = (option: any, scope: any) => (
  (!scope.year || Number(scope.year) === Number(option.year || 0)) &&
  (!scope.term || String(scope.term) === String(option.term || '')) &&
  (!scope.grade || normalizeScopeText(scope.grade) === normalizeScopeText(option.grade || option.target_grade)) &&
  (!scope.subject || normalizeScopeText(scope.subject) === normalizeScopeText(option.subject || option.target_subject)) &&
  (!scope.course_name || normalizeScopeText(scope.course_name) === normalizeScopeText(option.course_name || option.title)) &&
  (!scope.month_label || !option.month_label || String(scope.month_label) === String(option.month_label))
);

export default function AdminRegistrationTasksPage() {
  const [requests, setRequests] = useState<any[]>([]);
  const [courseOptions, setCourseOptions] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const toast = useToast();
  const confirm = useConfirm();
  
  // 作成モーダル用ステート
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingRequestId, setEditingRequestId] = useState('');
  const [creating, setCreating] = useState(false);
  const [formData, setFormData] = useState({
    title: '',
    type: 'initial', // 'initial' | 'test'
    deadline: '',
    subjects: [...DEFAULT_SUBJECTS],
    newSubject: '', // 科目追加用入力
    
    // ★追加: 送信対象設定
    targetAudience: 'all' as TargetAudience,
    targetGrades: [] as string[],
    periodStart: '',
    periodEnd: '',
    termFilter: 'all',
    monthFilter: 'all',
    courseOptionIds: [] as string[],
  });

  const fetchRequests = async () => {
    setLoadError('');
    try {
      const shiftRange = courseYearDateRange(currentCourseYear());
      const [snap, optionSnap, curriculumSnap, shiftSnap] = await Promise.all([
        getDocs(query(collection(db, 'registration_requests'), orderBy('created_at', 'desc'))),
        getDocs(query(collection(db, 'course_registration_options'), orderBy('year', 'desc'))).catch(() => ({ docs: [] as any[] })),
        getDocs(query(collection(db, 'annual_curriculum_schedules'), limit(1000))).catch(() => ({ docs: [] as any[] })),
        getDocs(query(
          collection(db, 'shift_assignments'),
          where('target_date', '>=', shiftRange.start),
          where('target_date', '<=', shiftRange.end),
          orderBy('target_date', 'asc'),
          limit(3000)
        )).catch(() => ({ docs: [] as any[] })),
      ]);
      setRequests(snap.docs.map(d => ({ id: d.id, ...d.data() })));
      const rawOptions = optionSnap.docs.map((d: any) => ({ id: d.id, ...d.data() })).filter((item: any) => item.is_active !== false);
      setCourseOptions(enrichCourseOptionsWithShifts(
        rawOptions,
        curriculumSnap.docs.map((d: any) => ({ id: d.id, ...d.data() })),
        shiftSnap.docs.map((d: any) => ({ id: d.id, ...d.data() }))
      ));
      // 公開側と同じ期間判定・学年ルールを使い、管理画面だけ候補がずれるのを防ぐ。
      const currentUser = auth.currentUser;
      if (currentUser) {
        const gradePayloads = await Promise.all(GRADE_OPTIONS.map(grade => loadCourseRegistrationOptions({
          grade,
          year: currentCourseYear(),
          getToken: forceRefresh => currentUser.getIdToken(forceRefresh),
          force: true,
        })));
        const apiOptions = gradePayloads.flatMap(payload => Array.isArray(payload.options) ? payload.options : []);
        setCourseOptions(Array.from(new Map(apiOptions.map((option: any) => [String(option.id), option])).values()));
      }
    } catch (e) {
      console.error(e);
      setLoadError('登録依頼を読み込めませんでした。通信状態を確認して、もう一度お試しください。');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchRequests();
  }, []);

  // 作成ボタン押下（モーダルを開く）
  const openCreateModal = (title: string, type: string) => {
    // デフォルト1週間後（日本時間の日付）
    const defaultDeadline = jstDateKey(new Date(Date.now() + 7 * 24 * 60 * 60 * 1000));

    setEditingRequestId('');
    setFormData({
      title,
      type,
      deadline: defaultDeadline,
      subjects: [...DEFAULT_SUBJECTS],
      newSubject: '',
      targetAudience: type === 'course_registration' ? 'grade' : 'all',
      targetGrades: [],
      periodStart: jstDateKey(),
      periodEnd: defaultDeadline,
      termFilter: 'all',
      monthFilter: 'all',
      courseOptionIds: []
    });
    setIsModalOpen(true);
  };

  const openEditCourseRegistrationModal = (request: any) => {
    const storedIds = new Set(Array.isArray(request.course_option_ids) ? request.course_option_ids.map(String) : []);
    const storedScopes = Array.isArray(request.course_option_scopes) ? request.course_option_scopes : [];
    const resolvedIds = courseOptions
      .filter((option: any) => (
        storedIds.has(String(option.id || '')) ||
        storedIds.has(String(option.parent_course_option_id || '')) ||
        storedIds.has(String(option.fallback_curriculum_option_id || '')) ||
        storedScopes.some((scope: any) => optionMatchesSavedScope(option, scope))
      ))
      .map((option: any) => String(option.id));
    setEditingRequestId(String(request.id || ''));
    setFormData({
      title: String(request.title || '受講講座登録'),
      type: 'course_registration',
      deadline: String(request.deadline || request.period_end || ''),
      subjects: [...DEFAULT_SUBJECTS],
      newSubject: '',
      targetAudience: 'grade',
      targetGrades: Array.isArray(request.target_grades) ? request.target_grades.map(String) : [],
      periodStart: String(request.period_start || ''),
      periodEnd: String(request.period_end || request.deadline || ''),
      termFilter: String(request.curriculum_term || 'all'),
      monthFilter: String(request.curriculum_month || 'all'),
      courseOptionIds: Array.from(new Set(resolvedIds)),
    });
    setIsModalOpen(true);
  };

  const toggleCourseOption = (id: string) => {
    setFormData(prev => ({
      ...prev,
      courseOptionIds: prev.courseOptionIds.includes(id)
        ? prev.courseOptionIds.filter(item => item !== id)
        : [...prev.courseOptionIds, id],
    }));
  };

  const groupedCourseOptions = () => {
    const visible = courseOptions.filter((option: any) => {
      if (formData.type === 'course_registration' && formData.targetGrades.length === 0) return false;
      if (formData.targetAudience !== 'grade' || formData.targetGrades.length === 0) return true;
      return formData.targetGrades.includes(option.grade);
    }).filter((option: any) => {
      if (formData.termFilter === 'all') return true;
      return `${option.year || ''}_${option.term || option.term_label || ''}` === formData.termFilter;
    }).filter((option: any) => {
      if (formData.monthFilter === 'all') return true;
      return String(option.month_label || '') === formData.monthFilter;
    });
    return visible.reduce((acc: Record<string, any[]>, option: any) => {
      const key = `${option.year || '年度未設定'}_${option.term_label || option.term || 'ターム未設定'}_${option.grade || '学年未設定'}_${option.month_label || '月未設定'}`;
      if (!acc[key]) acc[key] = [];
      acc[key].push(option);
      return acc;
    }, {});
  };

  const courseTerms = Array.from(new Map(courseOptions.map((option: any) => {
    const key = `${option.year || ''}_${option.term || option.term_label || ''}`;
    return [key, {
      key,
      label: `${option.year || '年度未設定'} / ${option.term_label || option.term || 'ターム未設定'}`,
    }];
  })).values()).filter((item: any) => item.key !== '_');

  const courseMonths = Array.from(new Set(courseOptions.map((option: any) => String(option.month_label || '')).filter(Boolean)))
    .sort((a, b) => a.localeCompare(b, 'ja', { numeric: true }));

  const visibleCourseOptions = () => Object.values(groupedCourseOptions()).flat() as any[];

  const selectAutoCourseTerm = () => {
    const today = jstDateKey();
    const terms = Array.from(courseOptions.reduce((map: Map<string, any[]>, option: any) => {
      const key = `${option.year || ''}_${option.term || option.term_label || ''}`;
      if (!key.replace(/_/g, '').trim()) return map;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(option);
      return map;
    }, new Map<string, any[]>()).entries()).map(([key, items]) => {
      const dates = items
        .flatMap((option: any) => [option.term_start_date, option.registration_opens_at, ...(option.matched_dates || [])])
        .map((value: any) => String(value || '').slice(0, 10))
        .filter(Boolean)
        .sort();
      const first = items[0] || {};
      return {
        key,
        items,
        termLabel: first.term_label || first.term || '次期',
        startDate: dates.find(date => date >= today) || dates[0] || '',
      };
    }).sort((a, b) => {
      const aFuture = a.startDate && a.startDate >= today ? 0 : 1;
      const bFuture = b.startDate && b.startDate >= today ? 0 : 1;
      if (aFuture !== bFuture) return aFuture - bFuture;
      return `${a.startDate || '9999-99-99'}_${a.key}`.localeCompare(`${b.startDate || '9999-99-99'}_${b.key}`, 'ja', { numeric: true });
    });

    return terms[0] || null;
  };

  const openAutoCourseRegistrationModal = () => {
    setEditingRequestId('');
    if (courseOptions.length === 0) {
      openCreateModal('次期 受講講座登録', 'course_registration');
      return;
    }

    const term = selectAutoCourseTerm();
    const items = term?.items || courseOptions;
    const grades = Array.from(new Set(items.map((option: any) => String(option.grade || '').trim()).filter(Boolean)));
    const thirdTermForGrade3 = items.some((option: any) => isThirdCourseTerm(option) && String(option.grade || '').normalize('NFKC').includes('3'));
    const defaultGrades = thirdTermForGrade3 ? ['中3'] : grades.length ? grades : [...GRADE_OPTIONS];
    const defaultItems = thirdTermForGrade3
      ? items.filter((option: any) => String(option.grade || '').normalize('NFKC').includes('3'))
      : items;
    const termStartDate = items
      .map((option: any) => String(option.term_start_date || '').slice(0, 10))
      .filter(Boolean)
      .sort()[0] || '';
    const registrationStart = items
      .map((option: any) => String(option.registration_opens_at || '').slice(0, 10))
      .filter(Boolean)
      .sort()[0] || jstDateKey();
    const fallbackEnd = (() => {
      const d = new Date(`${registrationStart}T00:00:00+09:00`);
      d.setDate(d.getDate() + 14);
      return jstDateKey(d);
    })();
    const registrationEnd = termStartDate && termStartDate >= registrationStart ? termStartDate : fallbackEnd;

    setFormData({
      title: `${term?.termLabel || '次期'} 受講講座登録`,
      type: 'course_registration',
      deadline: registrationEnd,
      subjects: [...DEFAULT_SUBJECTS],
      newSubject: '',
      targetAudience: 'grade',
      targetGrades: defaultGrades,
      periodStart: registrationStart,
      periodEnd: registrationEnd,
      termFilter: term?.key || 'all',
      monthFilter: 'all',
      courseOptionIds: defaultItems.map((option: any) => option.id),
    });
    setIsModalOpen(true);
  };

  // 科目の追加
  const addSubject = () => {
    if (!formData.newSubject.trim()) return;
    if (formData.subjects.includes(formData.newSubject)) return;
    setFormData(prev => ({
      ...prev,
      subjects: [...prev.subjects, prev.newSubject],
      newSubject: ''
    }));
  };

  // 科目の削除
  const removeSubject = (sub: string) => {
    setFormData(prev => ({
      ...prev,
      subjects: prev.subjects.filter(s => s !== sub)
    }));
  };

  // 学年の選択切り替え
  const toggleGrade = (grade: string) => {
    setFormData(prev => {
      const current = prev.targetGrades;
      if (current.includes(grade)) {
        return { ...prev, targetGrades: current.filter(g => g !== grade) };
      } else {
        return { ...prev, targetGrades: [...current, grade] };
      }
    });
  };

  // 実際にFirestoreに保存
  const handleSave = async () => {
    if (!formData.title || !formData.deadline) return toast.error('タイトルと期限は必須です');
    if (formData.type === 'course_registration') {
      if (!formData.periodStart || !formData.periodEnd) return toast.error('登録期間を入力してください');
      if (formData.periodEnd < formData.periodStart) return toast.error('登録終了日は開始日以降にしてください');
      if (formData.targetGrades.length === 0) return toast.error('受講講座登録は送信する学年を選択してください');
      if (formData.courseOptionIds.length === 0) return toast.error('カリキュラムから講座を選択してください');
    } else if (formData.subjects.length === 0) return toast.error('科目を少なくとも1つ設定してください');
    if (formData.targetAudience === 'grade' && formData.targetGrades.length === 0) return toast.error('対象の学年を選択してください');

    setCreating(true);
    try {
      const selectedCourseOptionScopes = formData.type === 'course_registration'
        ? courseOptions
          .filter((option: any) => formData.courseOptionIds.includes(option.id))
          .map((option: any) => ({
            year: Number(option.year || 0),
            term: String(option.term || ''),
            grade: String(option.grade || option.target_grade || ''),
            subject: String(option.subject || ''),
            course_name: String(option.course_name || option.title || ''),
            month_label: String(option.month_label || ''),
          }))
        : [];
      const requestPayload = {
        title: formData.title,
        type: formData.type,
        is_active: true,
        updated_at: serverTimestamp(),
        deadline: formData.deadline,
        subjects: formData.type === 'course_registration' ? [] : formData.subjects,
        request_kind: formData.type === 'course_registration' ? 'course_registration' : 'subject_registration',
        period_start: formData.type === 'course_registration' ? formData.periodStart : null,
        period_end: formData.type === 'course_registration' ? formData.periodEnd : null,
        course_option_ids: formData.type === 'course_registration' ? formData.courseOptionIds : [],
        course_option_scopes: selectedCourseOptionScopes,
        curriculum_term: formData.type === 'course_registration' ? formData.termFilter : null,
        curriculum_month: formData.type === 'course_registration' ? formData.monthFilter : null,
        
        // ★追加: 送信対象データ
        target_audience: formData.type === 'course_registration' ? 'grade' : formData.targetAudience, // 'all', 'new_only', 'grade'
        target_grades: formData.type === 'course_registration' || formData.targetAudience === 'grade' ? formData.targetGrades : null,
      };
      if (editingRequestId) {
        await updateDoc(doc(db, 'registration_requests', editingRequestId), requestPayload);
      } else {
        await addDoc(collection(db, 'registration_requests'), { ...requestPayload, created_at: serverTimestamp() });
      }
      await fetchRequests();
      setIsModalOpen(false);
      setEditingRequestId('');
      toast.success(editingRequestId ? '表示する講座を更新しました' : '募集を開始しました');
    } catch (e) {
      console.error(e);
      toast.error(editingRequestId ? '更新できませんでした。もう一度お試しください。' : '作成できませんでした。もう一度お試しください。');
    } finally {
      setCreating(false);
    }
  };

  // ステータスの切り替え
  const toggleStatus = async (id: string, currentStatus: boolean) => {
    try {
      await updateDoc(doc(db, 'registration_requests', id), { is_active: !currentStatus });
      fetchRequests();
    } catch (e) {
      console.error(e);
      toast.error(currentStatus ? '停止できませんでした。もう一度お試しください。' : '再開できませんでした。もう一度お試しください。');
    }
  };

  // 削除機能
  const handleDelete = async (id: string) => {
    const target = requests.find(req => req.id === id);
    const ok = await confirm({
      title: `「${target?.title || 'この募集'}」を削除しますか？`,
      message: 'すでに回答した生徒がいる場合、そのデータとの紐付けが失われる可能性があります。',
      confirmLabel: '削除する',
      tone: 'danger',
    });
    if (!ok) return;

    try {
      await deleteDoc(doc(db, 'registration_requests', id));
      setRequests(prev => prev.filter(req => req.id !== id));
      void reportAuditLog({ action: 'registration_task_delete', target_type: 'registration_request', target_id: id, target_label: String(target?.title || '') });
    } catch (e) {
      console.error(e);
      toast.error('削除できませんでした。もう一度お試しください。');
    }
  };

  // ターゲット表示用のヘルパー関数
  const getTargetLabel = (req: any) => {
    if (req.target_audience === 'new_only') return <span className="bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full text-xs font-bold">未登録のみ</span>;
    if (req.target_audience === 'grade') return <span className="bg-sky-100 text-sky-700 px-2 py-0.5 rounded-full text-xs font-bold">{req.target_grades?.join(', ')}のみ</span>;
    return <span className="bg-slate-100 text-slate-600 px-2 py-0.5 rounded-full text-xs font-bold">全員</span>;
  };

  if (loading) return (
    <div className="space-y-6">
      <AdminPageHeader />
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">{[0, 1, 2].map(index => <Skeleton key={index} className="h-28" />)}</div>
      <ListSkeleton rows={4} />
    </div>
  );

  return (
    <div className="font-sans text-slate-800">
      <AdminPageHeader />

      {/* 作成ボタンエリア */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-10">
        <button 
          onClick={() => openCreateModal('初回受講科目登録', 'initial')}
          className="bg-white border-2 border-accent/20 hover:border-accent text-accent p-6 rounded-card shadow-sm hover:shadow-md transition-all text-left group"
        >
          <div className="flex items-center justify-between mb-2">
            <span className="font-bold text-lg">初回受講科目登録</span>
            <div className="bg-accent-soft p-2 rounded-full group-hover:bg-accent group-hover:text-accent-ink transition-colors">
              <Plus size={20} aria-hidden/>
            </div>
          </div>
          <p className="text-xs text-slate-400 font-bold">新入生向け / 科目選択のみ</p>
        </button>

        <button 
          onClick={openAutoCourseRegistrationModal}
          className="bg-white border-2 border-amber-100 hover:border-amber-500 text-amber-700 p-6 rounded-card shadow-sm hover:shadow-md transition-all text-left group"
        >
          <div className="flex items-center justify-between mb-2">
            <span className="font-bold text-lg">受講講座登録</span>
            <div className="bg-amber-50 p-2 rounded-full group-hover:bg-amber-600 group-hover:text-white transition-colors">
              <Plus size={20} aria-hidden/>
            </div>
          </div>
          <p className="text-xs text-slate-400 font-bold">年間カリキュラム・授業予定から自動作成 / 保護者向け</p>
        </button>

        <button 
          onClick={() => openCreateModal('定期テスト対策 希望科目', 'test')}
          className="bg-white border-2 border-pink-100 hover:border-pink-500 text-pink-700 p-6 rounded-card shadow-sm hover:shadow-md transition-all text-left group"
        >
          <div className="flex items-center justify-between mb-2">
            <span className="font-bold text-lg">テスト対策 希望調査</span>
            <div className="bg-pink-50 p-2 rounded-full group-hover:bg-pink-600 group-hover:text-white transition-colors">
              <Plus size={20} aria-hidden/>
            </div>
          </div>
          <p className="text-xs text-slate-400 font-bold">テスト前用 / 追加科目希望など</p>
        </button>
      </div>

      {/* リスト表示エリア */}
      <div className="bg-white rounded-card shadow-sm border border-line overflow-hidden">
        <div className="bg-slate-50 px-6 py-4 border-b border-slate-100">
          <h2 className="text-sm font-bold text-slate-500">作成履歴</h2>
        </div>
        {loadError ? (
          <ErrorState className="m-4" message={loadError} onRetry={() => { setLoading(true); fetchRequests(); }} />
        ) : requests.length === 0 ? (
          <EmptyState className="m-4" icon={ClipboardList} title="まだ登録依頼はありません" description="上のボタンから最初の登録依頼を作成できます。" />
        ) : (
          <div className="divide-y divide-slate-50">
            {requests.map(req => (
              <div key={req.id} className="p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4 hover:bg-slate-50/50 transition-colors">
                <div>
                  <div className="flex flex-wrap items-center gap-3 mb-1">
                    <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${req.is_active ? 'bg-emerald-100 text-emerald-700 border border-emerald-200' : 'bg-slate-100 text-slate-500 border border-slate-200'}`}>
                      {req.is_active ? '募集中' : '停止中'}
                    </span>
                    <h3 className="font-bold text-slate-800">{req.title}</h3>
                    {/* ターゲットバッジ表示 */}
                    {getTargetLabel(req)}
                  </div>
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500 font-medium pl-1">
                    <span>作成: {req.created_at?.toDate ? formatDate(req.created_at, { withYear: true }) : ''}</span>
                    <span className="flex items-center gap-1"><Calendar size={12} aria-hidden/> 期限: {req.deadline ? (formatDate(req.deadline, { withYear: true }) || req.deadline) : '-'}</span>
                    <span className="flex items-center gap-1"><BookOpen size={12} aria-hidden/> {req.request_kind === 'course_registration' ? `講座: ${req.course_option_ids?.length || 0}個` : `科目: ${req.subjects?.length || 5}個`}</span>
                    {req.period_start && <span>登録期間: {formatDate(req.period_start, { withYear: true }) || req.period_start} 〜 {formatDate(req.period_end, { withYear: true }) || req.period_end}</span>}
                  </div>
                </div>
                
                {/* 操作ボタンエリア */}
                <div className="flex flex-wrap items-center gap-2">
                  {(req.request_kind === 'course_registration' || req.type === 'course_registration') && (
                    <Button variant="secondary" size="sm" onClick={() => openEditCourseRegistrationModal(req)} icon={<Pencil size={15} aria-hidden/>}>
                      表示講座を編集
                    </Button>
                  )}
                  <Button
                    variant={req.is_active ? 'ghost' : 'secondary'}
                    size="sm"
                    onClick={() => toggleStatus(req.id, req.is_active)}
                    icon={req.is_active ? <StopCircle size={16} aria-hidden/> : <CheckCircle size={16} aria-hidden/>}
                    className={req.is_active ? 'text-rose-600 hover:bg-rose-50' : undefined}
                  >
                    {req.is_active ? '停止する' : '再開する'}
                  </Button>
                  <IconButton label={`「${req.title}」を削除する`} onClick={() => handleDelete(req.id)} className="text-slate-400 hover:bg-rose-50 hover:text-rose-600">
                    <Trash2 size={18} aria-hidden/>
                  </IconButton>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 設定モーダル */}
      <Modal closeOnBackdrop={false}
        open={isModalOpen}
        onClose={() => { setIsModalOpen(false); setEditingRequestId(''); }}
        size="xl"
        title={editingRequestId ? '表示する講座の編集' : '募集内容の設定'}
        footer={(
          <>
            <Button variant="ghost" size="lg" className="sm:min-w-40" onClick={() => { setIsModalOpen(false); setEditingRequestId(''); }}>キャンセル</Button>
            <Button size="lg" className="sm:min-w-40" onClick={handleSave} loading={creating}>
              {creating ? (editingRequestId ? '更新中...' : '作成中...') : (editingRequestId ? '表示講座を更新する' : '募集を開始する')}
            </Button>
          </>
        )}
      >
            <div className="space-y-6">
              
              {/* タイトル設定 */}
              <div>
                <label className="block text-xs font-bold text-slate-500 mb-1">タイトル</label>
                <input 
                  type="text" 
                  value={formData.title} 
                  onChange={e => setFormData({...formData, title: e.target.value})}
                  className="w-full min-h-11 p-3 bg-slate-50 border border-line rounded-input font-bold text-slate-700 focus:ring-2 focus:ring-accent/30 outline-none"
                />
              </div>

              {/* ★追加: 送信対象の設定 */}
              <div>
                <label className="block text-xs font-bold text-slate-500 mb-2">送信対象</label>
                <div className="grid grid-cols-3 gap-2">
                  <button 
                    disabled={formData.type === 'course_registration'}
                    onClick={() => setFormData({...formData, targetAudience: 'all'})}
                    className={`p-3 rounded-btn border-2 flex flex-col items-center gap-1 transition-all ${
                      formData.targetAudience === 'all' 
                        ? 'border-accent bg-accent-soft text-accent' 
                        : 'border-slate-100 text-slate-400 hover:bg-slate-50'
                    } ${formData.type === 'course_registration' ? 'cursor-not-allowed opacity-40' : ''}`}
                  >
                    <Users size={20}/>
                    <span className="text-xs font-bold">全員</span>
                  </button>
                  <button 
                    disabled={formData.type === 'course_registration'}
                    onClick={() => setFormData({...formData, targetAudience: 'new_only'})}
                    className={`p-3 rounded-btn border-2 flex flex-col items-center gap-1 transition-all ${
                      formData.targetAudience === 'new_only' 
                        ? 'border-amber-500 bg-amber-50 text-amber-700' 
                        : 'border-slate-100 text-slate-400 hover:bg-slate-50'
                    } ${formData.type === 'course_registration' ? 'cursor-not-allowed opacity-40' : ''}`}
                  >
                    <UserPlus size={20}/>
                    <span className="text-xs font-bold">未登録のみ</span>
                  </button>
                  <button 
                    onClick={() => setFormData({...formData, targetAudience: 'grade'})}
                    className={`p-3 rounded-btn border-2 flex flex-col items-center gap-1 transition-all ${
                      formData.targetAudience === 'grade' 
                        ? 'border-sky-500 bg-sky-50 text-sky-700' 
                        : 'border-slate-100 text-slate-400 hover:bg-slate-50'
                    }`}
                  >
                    <GraduationCap size={20}/>
                    <span className="text-xs font-bold">学年指定</span>
                  </button>
                </div>

                {/* 学年指定時の詳細選択 */}
                {(formData.targetAudience === 'grade' || formData.type === 'course_registration') && (
                  <div className="mt-3 p-3 bg-sky-50/50 rounded-btn border border-sky-100 animate-in fade-in slide-in-from-top-2">
                    <p className="text-xs font-bold text-sky-700 mb-2">
                      {formData.type === 'course_registration' ? '登録依頼を送信する学年を選択してください' : '対象学年を選択してください（複数可）'}
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {GRADE_OPTIONS.map(grade => (
                        <button
                          key={grade}
                          onClick={() => toggleGrade(grade)}
                          aria-pressed={formData.targetGrades.includes(grade)}
                          className={`min-h-9 px-3 py-1.5 rounded-btn text-xs font-bold border-2 transition-all flex items-center gap-1 ${
                            formData.targetGrades.includes(grade)
                              ? 'bg-accent text-accent-ink border-accent'
                              : 'bg-white text-slate-500 border-slate-200'
                          }`}
                        >
                          {formData.targetGrades.includes(grade) && <Check size={12} strokeWidth={4} />}
                          {grade}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* 期限設定 */}
              <div>
                <label className="block text-xs font-bold text-slate-500 mb-1">募集期限</label>
                <input 
                  type="date" 
                  value={formData.deadline} 
                  onChange={e => setFormData({...formData, deadline: e.target.value})}
                  className="w-full min-h-11 p-3 bg-slate-50 border border-line rounded-input font-bold text-slate-700 focus:ring-2 focus:ring-accent/30 outline-none"
                />
              </div>

              {formData.type === 'course_registration' ? (
                <div className="space-y-5">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div>
                      <label className="block text-xs font-bold text-slate-500 mb-1">登録開始日</label>
                      <input
                        type="date"
                        value={formData.periodStart}
                        onChange={e => setFormData({...formData, periodStart: e.target.value})}
                        className="w-full min-h-11 p-3 bg-slate-50 border border-line rounded-input font-bold text-slate-700 focus:ring-2 focus:ring-accent/30 outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-slate-500 mb-1">登録終了日</label>
                      <input
                        type="date"
                        value={formData.periodEnd}
                        onChange={e => setFormData({...formData, periodEnd: e.target.value, deadline: e.target.value})}
                        className="w-full min-h-11 p-3 bg-slate-50 border border-line rounded-input font-bold text-slate-700 focus:ring-2 focus:ring-accent/30 outline-none"
                      />
                    </div>
                  </div>
                  <div>
                    <div className="mb-3 rounded-card border border-line bg-slate-50 p-4">
                      <div className="mb-2 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                        <div>
                          <p className="text-xs font-bold text-slate-700">カリキュラム管理との紐づけ</p>
                          <p className="mt-1 text-xs font-medium text-slate-500">タームで絞ると、そのタームの講座だけを登録依頼に含められます。</p>
                        </div>
                        <ButtonLink href="/master/curriculum" variant="secondary" size="sm">カリキュラム管理</ButtonLink>
                      </div>
                      <select
                        value={formData.termFilter}
                        onChange={e => setFormData(prev => ({ ...prev, termFilter: e.target.value, courseOptionIds: [] }))}
                        className="w-full min-h-10 rounded-input border border-line bg-white px-3 py-2 text-sm font-bold text-slate-700 outline-none"
                      >
                        <option value="all">すべてのターム</option>
                        {courseTerms.map((term: any) => <option key={term.key} value={term.key}>{term.label}</option>)}
                      </select>
                      <div className="mt-3">
                        <p className="mb-2 text-xs font-bold text-slate-700">実施月で絞り込み</p>
                        <select
                          value={formData.monthFilter}
                          onChange={e => setFormData(prev => ({ ...prev, monthFilter: e.target.value, courseOptionIds: [] }))}
                          className="w-full min-h-10 rounded-input border border-line bg-white px-3 py-2 text-sm font-bold text-slate-700 outline-none"
                        >
                          <option value="all">すべての月</option>
                          {courseMonths.map(month => <option key={month} value={month}>{month}</option>)}
                        </select>
                      </div>
                    </div>
                    <div className="mb-2 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
                      <div>
                        <label className="block text-xs font-bold text-slate-500">CSV登録済みカリキュラム</label>
                        <p className="mt-1 text-xs font-medium text-slate-500">年間カリキュラム・講師配置と連動し、曜日・時限ごとに受講候補を表示します。</p>
                      </div>
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => setFormData(prev => ({
                          ...prev,
                          courseOptionIds: visibleCourseOptions().map((option: any) => option.id),
                        }))}
                      >
                        表示中をすべて選択
                      </Button>
                    </div>
                    {formData.targetGrades.length === 0 ? (
                      <EmptyState icon={GraduationCap} title="先に送信する学年を選択してください" />
                    ) : courseOptions.length === 0 ? (
                      <EmptyState icon={BookOpen} title="まだカリキュラムCSVが取り込まれていません" description="カリキュラム管理からCSVを取り込むと、ここに講座が表示されます。" />
                    ) : (
                      <div className="max-h-[52vh] overflow-y-auto rounded-btn border border-line bg-slate-50 p-3">
                        <div className="space-y-5">
                          {(Object.entries(groupedCourseOptions()) as [string, any[]][]).map(([key, items]) => {
                            const [year, term, grade, month] = key.split('_');
                            const selectedCount = items.filter(item => formData.courseOptionIds.includes(item.id)).length;
                            const matchedCount = items.filter(item => item.shift_match_status === 'matched').length;
                            const courseMatchedCount = items.filter(item => item.shift_match_status === 'course_matched').length;
                            const unmatchedCount = items.filter(item => item.shift_match_status === 'unmatched').length;
                            return (
                              <section key={key} className="rounded-card bg-white p-4 shadow-sm">
                                <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                                  <div>
                                    <h3 className="text-sm font-bold text-slate-800">{year} / {term} / {grade} / {month}</h3>
                                    <p className="text-xs font-bold text-slate-500">{items.length}件中 {selectedCount}件選択中</p>
                                    <p className="mt-1 text-xs font-medium text-slate-500">
                                      単元一致 {matchedCount}件 / 講座名一致 {courseMatchedCount}件 / 未配置 {unmatchedCount}件
                                    </p>
                                  </div>
                                  <Button
                                    variant="secondary"
                                    size="sm"
                                    onClick={() => setFormData(prev => {
                                      const ids = items.map(item => item.id);
                                      const allSelected = ids.every(id => prev.courseOptionIds.includes(id));
                                      return {
                                        ...prev,
                                        courseOptionIds: allSelected
                                          ? prev.courseOptionIds.filter(id => !ids.includes(id))
                                          : Array.from(new Set([...prev.courseOptionIds, ...ids])),
                                      };
                                    })}
                                  >
                                    {selectedCount === items.length ? 'この表を解除' : 'この表を選択'}
                                  </Button>
                                </div>
                                <CourseRegistrationCalendar
                                  options={items}
                                  selectedIds={formData.courseOptionIds}
                                  onToggle={toggleCourseOption}
                                  compact
                                />
                              </section>
                            );
                          })}
                        </div>
                      </div>
                    )}
                    <p className="mt-2 text-xs font-bold text-slate-500">{formData.courseOptionIds.length}件選択中</p>
                  </div>
                </div>
              ) : (
              <div>
                <label className="block text-xs font-bold text-slate-500 mb-2">選択肢（科目）の設定</label>
                <div className="flex gap-2 mb-3">
                  <input 
                    type="text" 
                    placeholder="新しい科目を追加..." 
                    value={formData.newSubject}
                    onChange={e => setFormData({...formData, newSubject: e.target.value})}
                    onKeyDown={e => {
                      if (e.key === 'Enter') {
                        e.preventDefault(); 
                        addSubject();
                      }
                    }}
                    aria-label="追加する科目"
                    className="flex-1 min-h-10 px-3 py-2 bg-white border border-line rounded-input text-sm focus:ring-2 focus:ring-accent/30 outline-none"
                  />
                  <IconButton label="科目を追加" variant="primary" onClick={addSubject}><Plus size={18} aria-hidden/></IconButton>
                </div>
                
                <div className="flex flex-wrap gap-2">
                  {formData.subjects.map(sub => (
                    <div key={sub} className="bg-slate-100 text-slate-700 px-3 py-1.5 rounded-btn text-sm font-bold flex items-center gap-2">
                      {sub}
                      <button type="button" onClick={() => removeSubject(sub)} aria-label={`${sub}を外す`} className="text-slate-400 hover:text-rose-500"><X size={14} aria-hidden/></button>
                    </div>
                  ))}
                </div>
              </div>
              )}
            </div>
      </Modal>
    </div>
  );
}
