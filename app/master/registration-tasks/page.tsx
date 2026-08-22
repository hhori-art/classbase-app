'use client';

import { useState, useEffect } from 'react';
import { db } from '@/lib/firebase';
import { collection, addDoc, query, orderBy, getDocs, updateDoc, doc, deleteDoc, serverTimestamp, limit, where } from 'firebase/firestore';
import { Plus, CheckCircle, StopCircle, Loader2, FileText, X, Trash2, Calendar, BookOpen, Users, UserPlus, GraduationCap, Check } from 'lucide-react';
import CourseRegistrationCalendar from '@/app/components/CourseRegistrationCalendar';
import { enrichCourseOptionsWithShifts } from '@/lib/course-registration-match';

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

export default function AdminRegistrationTasksPage() {
  const [requests, setRequests] = useState<any[]>([]);
  const [courseOptions, setCourseOptions] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  
  // 作成モーダル用ステート
  const [isModalOpen, setIsModalOpen] = useState(false);
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
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchRequests();
  }, []);

  // 作成ボタン押下（モーダルを開く）
  const openCreateModal = (title: string, type: string) => {
    const d = new Date();
    d.setDate(d.getDate() + 7); // デフォルト1週間後
    const defaultDeadline = d.toISOString().split('T')[0];

    setFormData({
      title,
      type,
      deadline: defaultDeadline,
      subjects: [...DEFAULT_SUBJECTS],
      newSubject: '',
      targetAudience: type === 'course_registration' ? 'grade' : 'all',
      targetGrades: [],
      periodStart: new Date().toISOString().split('T')[0],
      periodEnd: defaultDeadline,
      termFilter: 'all',
      monthFilter: 'all',
      courseOptionIds: []
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
    const today = new Date().toISOString().slice(0, 10);
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
    if (courseOptions.length === 0) {
      openCreateModal('次期 受講講座登録', 'course_registration');
      return;
    }

    const term = selectAutoCourseTerm();
    const items = term?.items || courseOptions;
    const grades = Array.from(new Set(items.map((option: any) => String(option.grade || '').trim()).filter(Boolean)));
    const termStartDate = items
      .map((option: any) => String(option.term_start_date || '').slice(0, 10))
      .filter(Boolean)
      .sort()[0] || '';
    const registrationStart = items
      .map((option: any) => String(option.registration_opens_at || '').slice(0, 10))
      .filter(Boolean)
      .sort()[0] || new Date().toISOString().slice(0, 10);
    const fallbackEnd = (() => {
      const d = new Date(`${registrationStart}T00:00:00+09:00`);
      d.setDate(d.getDate() + 14);
      return d.toISOString().slice(0, 10);
    })();
    const registrationEnd = termStartDate && termStartDate >= registrationStart ? termStartDate : fallbackEnd;

    setFormData({
      title: `${term?.termLabel || '次期'} 受講講座登録`,
      type: 'course_registration',
      deadline: registrationEnd,
      subjects: [...DEFAULT_SUBJECTS],
      newSubject: '',
      targetAudience: 'grade',
      targetGrades: grades.length ? grades : [...GRADE_OPTIONS],
      periodStart: registrationStart,
      periodEnd: registrationEnd,
      termFilter: term?.key || 'all',
      monthFilter: 'all',
      courseOptionIds: items.map((option: any) => option.id),
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
    if (!formData.title || !formData.deadline) return alert('タイトルと期限は必須です');
    if (formData.type === 'course_registration') {
      if (!formData.periodStart || !formData.periodEnd) return alert('登録期間を入力してください');
      if (formData.periodEnd < formData.periodStart) return alert('登録終了日は開始日以降にしてください');
      if (formData.targetGrades.length === 0) return alert('受講講座登録は送信する学年を選択してください');
      if (formData.courseOptionIds.length === 0) return alert('カリキュラムから講座を選択してください');
    } else if (formData.subjects.length === 0) return alert('科目を少なくとも1つ設定してください');
    if (formData.targetAudience === 'grade' && formData.targetGrades.length === 0) return alert('対象の学年を選択してください');

    setCreating(true);
    try {
      await addDoc(collection(db, 'registration_requests'), {
        title: formData.title,
        type: formData.type,
        is_active: true,
        created_at: serverTimestamp(),
        deadline: formData.deadline,
        subjects: formData.type === 'course_registration' ? [] : formData.subjects,
        request_kind: formData.type === 'course_registration' ? 'course_registration' : 'subject_registration',
        period_start: formData.type === 'course_registration' ? formData.periodStart : null,
        period_end: formData.type === 'course_registration' ? formData.periodEnd : null,
        course_option_ids: formData.type === 'course_registration' ? formData.courseOptionIds : [],
        curriculum_term: formData.type === 'course_registration' ? formData.termFilter : null,
        curriculum_month: formData.type === 'course_registration' ? formData.monthFilter : null,
        
        // ★追加: 送信対象データ
        target_audience: formData.type === 'course_registration' ? 'grade' : formData.targetAudience, // 'all', 'new_only', 'grade'
        target_grades: formData.type === 'course_registration' || formData.targetAudience === 'grade' ? formData.targetGrades : null,
      });
      await fetchRequests();
      setIsModalOpen(false);
      alert('募集を開始しました');
    } catch (e) {
      console.error(e);
      alert('作成に失敗しました');
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
    }
  };

  // 削除機能
  const handleDelete = async (id: string) => {
    if (!confirm('本当にこの募集を削除しますか？\n（すでに回答した生徒がいる場合、そのデータとの紐付けが失われる可能性があります）')) return;
    
    try {
      await deleteDoc(doc(db, 'registration_requests', id));
      setRequests(prev => prev.filter(req => req.id !== id));
    } catch (e) {
      console.error(e);
      alert('削除に失敗しました');
    }
  };

  // ターゲット表示用のヘルパー関数
  const getTargetLabel = (req: any) => {
    if (req.target_audience === 'new_only') return <span className="bg-orange-100 text-orange-700 px-2 py-0.5 rounded text-[10px] font-bold">未登録のみ</span>;
    if (req.target_audience === 'grade') return <span className="bg-blue-100 text-blue-700 px-2 py-0.5 rounded text-[10px] font-bold">{req.target_grades?.join(', ')}のみ</span>;
    return <span className="bg-gray-100 text-gray-600 px-2 py-0.5 rounded text-[10px] font-bold">全員</span>;
  };

  if (loading) return <div className="p-10 flex justify-center"><Loader2 className="animate-spin text-gray-400"/></div>;

  return (
    <div className="p-8 max-w-5xl mx-auto font-sans text-gray-800">
      <div className="flex items-center gap-3 mb-8">
        <div className="p-3 bg-indigo-100 text-indigo-600 rounded-xl">
          <FileText size={24} />
        </div>
        <h1 className="text-2xl font-extrabold">登録依頼の管理</h1>
      </div>

      {/* 作成ボタンエリア */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-10">
        <button 
          onClick={() => openCreateModal('初回受講科目登録', 'initial')}
          className="bg-white border-2 border-indigo-100 hover:border-indigo-500 text-indigo-700 p-6 rounded-2xl shadow-sm hover:shadow-md transition-all text-left group"
        >
          <div className="flex items-center justify-between mb-2">
            <span className="font-bold text-lg">初回受講科目登録</span>
            <div className="bg-indigo-50 p-2 rounded-full group-hover:bg-indigo-600 group-hover:text-white transition-colors">
              <Plus size={20}/>
            </div>
          </div>
          <p className="text-xs text-gray-400 font-bold">新入生向け / 科目選択のみ</p>
        </button>

        <button 
          onClick={openAutoCourseRegistrationModal}
          className="bg-white border-2 border-amber-100 hover:border-amber-500 text-amber-700 p-6 rounded-2xl shadow-sm hover:shadow-md transition-all text-left group"
        >
          <div className="flex items-center justify-between mb-2">
            <span className="font-bold text-lg">受講講座登録</span>
            <div className="bg-amber-50 p-2 rounded-full group-hover:bg-amber-600 group-hover:text-white transition-colors">
              <Plus size={20}/>
            </div>
          </div>
          <p className="text-xs text-gray-400 font-bold">年間カリキュラム・授業予定から自動作成 / 保護者向け</p>
        </button>

        <button 
          onClick={() => openCreateModal('定期テスト対策 希望科目', 'test')}
          className="bg-white border-2 border-pink-100 hover:border-pink-500 text-pink-700 p-6 rounded-2xl shadow-sm hover:shadow-md transition-all text-left group"
        >
          <div className="flex items-center justify-between mb-2">
            <span className="font-bold text-lg">テスト対策 希望調査</span>
            <div className="bg-pink-50 p-2 rounded-full group-hover:bg-pink-600 group-hover:text-white transition-colors">
              <Plus size={20}/>
            </div>
          </div>
          <p className="text-xs text-gray-400 font-bold">テスト前用 / 追加科目希望など</p>
        </button>
      </div>

      {/* リスト表示エリア */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="bg-gray-50 px-6 py-4 border-b border-gray-100">
          <h2 className="text-sm font-bold text-gray-500">作成履歴</h2>
        </div>
        {requests.length === 0 ? (
          <div className="p-10 text-center text-gray-400 text-sm font-bold">まだ登録依頼はありません</div>
        ) : (
          <div className="divide-y divide-gray-50">
            {requests.map(req => (
              <div key={req.id} className="p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4 hover:bg-gray-50/50 transition-colors">
                <div>
                  <div className="flex items-center gap-3 mb-1">
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${req.is_active ? 'bg-green-100 text-green-700 border border-green-200' : 'bg-gray-100 text-gray-500 border border-gray-200'}`}>
                      {req.is_active ? '募集中' : '停止中'}
                    </span>
                    <h3 className="font-bold text-gray-800">{req.title}</h3>
                    {/* ターゲットバッジ表示 */}
                    {getTargetLabel(req)}
                  </div>
                  <div className="flex items-center gap-4 text-xs text-gray-400 font-medium pl-1">
                    <span>作成: {req.created_at?.toDate().toLocaleDateString()}</span>
                    <span className="flex items-center gap-1"><Calendar size={12}/> 期限: {req.deadline}</span>
                    <span className="flex items-center gap-1"><BookOpen size={12}/> {req.request_kind === 'course_registration' ? `講座: ${req.course_option_ids?.length || 0}個` : `科目: ${req.subjects?.length || 5}個`}</span>
                    {req.period_start && <span>登録期間: {req.period_start} - {req.period_end}</span>}
                  </div>
                </div>
                
                {/* 操作ボタンエリア */}
                <div className="flex items-center gap-3">
                  <button 
                    onClick={() => toggleStatus(req.id, req.is_active)}
                    className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-bold transition-all border ${req.is_active ? 'bg-white border-red-200 text-red-500 hover:bg-red-50' : 'bg-white border-green-200 text-green-600 hover:bg-green-50'}`}
                  >
                    {req.is_active ? <><StopCircle size={16}/> 停止する</> : <><CheckCircle size={16}/> 再開する</>}
                  </button>
                  <button 
                    onClick={() => handleDelete(req.id)}
                    className="flex items-center justify-center p-2 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50 transition-colors"
                    title="削除する"
                  >
                    <Trash2 size={18}/>
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 設定モーダル */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-6xl rounded-2xl shadow-xl overflow-hidden animate-in zoom-in-95 flex flex-col max-h-[88vh]">
            <div className="bg-gray-50 px-6 py-4 border-b border-gray-100 flex justify-between items-center shrink-0">
              <h2 className="font-bold text-gray-700">募集内容の設定</h2>
              <button onClick={() => setIsModalOpen(false)}><X size={20} className="text-gray-400 hover:text-gray-600"/></button>
            </div>
            
            <div className="p-6 space-y-6 overflow-y-auto">
              
              {/* タイトル設定 */}
              <div>
                <label className="block text-xs font-bold text-gray-500 mb-1">タイトル</label>
                <input 
                  type="text" 
                  value={formData.title} 
                  onChange={e => setFormData({...formData, title: e.target.value})}
                  className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl font-bold text-gray-700 focus:ring-2 focus:ring-indigo-500 outline-none"
                />
              </div>

              {/* ★追加: 送信対象の設定 */}
              <div>
                <label className="block text-xs font-bold text-gray-500 mb-2">送信対象</label>
                <div className="grid grid-cols-3 gap-2">
                  <button 
                    disabled={formData.type === 'course_registration'}
                    onClick={() => setFormData({...formData, targetAudience: 'all'})}
                    className={`p-3 rounded-xl border-2 flex flex-col items-center gap-1 transition-all ${
                      formData.targetAudience === 'all' 
                        ? 'border-indigo-500 bg-indigo-50 text-indigo-700' 
                        : 'border-gray-100 text-gray-400 hover:bg-gray-50'
                    } ${formData.type === 'course_registration' ? 'cursor-not-allowed opacity-40' : ''}`}
                  >
                    <Users size={20}/>
                    <span className="text-xs font-bold">全員</span>
                  </button>
                  <button 
                    disabled={formData.type === 'course_registration'}
                    onClick={() => setFormData({...formData, targetAudience: 'new_only'})}
                    className={`p-3 rounded-xl border-2 flex flex-col items-center gap-1 transition-all ${
                      formData.targetAudience === 'new_only' 
                        ? 'border-orange-500 bg-orange-50 text-orange-700' 
                        : 'border-gray-100 text-gray-400 hover:bg-gray-50'
                    } ${formData.type === 'course_registration' ? 'cursor-not-allowed opacity-40' : ''}`}
                  >
                    <UserPlus size={20}/>
                    <span className="text-xs font-bold">未登録のみ</span>
                  </button>
                  <button 
                    onClick={() => setFormData({...formData, targetAudience: 'grade'})}
                    className={`p-3 rounded-xl border-2 flex flex-col items-center gap-1 transition-all ${
                      formData.targetAudience === 'grade' 
                        ? 'border-blue-500 bg-blue-50 text-blue-700' 
                        : 'border-gray-100 text-gray-400 hover:bg-gray-50'
                    }`}
                  >
                    <GraduationCap size={20}/>
                    <span className="text-xs font-bold">学年指定</span>
                  </button>
                </div>

                {/* 学年指定時の詳細選択 */}
                {(formData.targetAudience === 'grade' || formData.type === 'course_registration') && (
                  <div className="mt-3 p-3 bg-blue-50/50 rounded-xl border border-blue-100 animate-in fade-in slide-in-from-top-2">
                    <p className="text-[10px] font-bold text-blue-400 mb-2">
                      {formData.type === 'course_registration' ? '登録依頼を送信する学年を選択してください' : '対象学年を選択してください（複数可）'}
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {GRADE_OPTIONS.map(grade => (
                        <button
                          key={grade}
                          onClick={() => toggleGrade(grade)}
                          className={`px-3 py-1.5 rounded-lg text-xs font-bold border-2 transition-all flex items-center gap-1 ${
                            formData.targetGrades.includes(grade)
                              ? 'bg-blue-500 text-white border-blue-500'
                              : 'bg-white text-gray-500 border-gray-200'
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
                <label className="block text-xs font-bold text-gray-500 mb-1">募集期限</label>
                <input 
                  type="date" 
                  value={formData.deadline} 
                  onChange={e => setFormData({...formData, deadline: e.target.value})}
                  className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl font-bold text-gray-700 focus:ring-2 focus:ring-indigo-500 outline-none"
                />
              </div>

              {formData.type === 'course_registration' ? (
                <div className="space-y-5">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div>
                      <label className="block text-xs font-bold text-gray-500 mb-1">登録開始日</label>
                      <input
                        type="date"
                        value={formData.periodStart}
                        onChange={e => setFormData({...formData, periodStart: e.target.value})}
                        className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl font-bold text-gray-700 focus:ring-2 focus:ring-indigo-500 outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-gray-500 mb-1">登録終了日</label>
                      <input
                        type="date"
                        value={formData.periodEnd}
                        onChange={e => setFormData({...formData, periodEnd: e.target.value, deadline: e.target.value})}
                        className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl font-bold text-gray-700 focus:ring-2 focus:ring-indigo-500 outline-none"
                      />
                    </div>
                  </div>
                  <div>
                    <div className="mb-3 rounded-2xl border border-cyan-100 bg-cyan-50 p-4">
                      <div className="mb-2 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                        <div>
                          <p className="text-xs font-black text-cyan-700">カリキュラム管理との紐づけ</p>
                          <p className="mt-1 text-[11px] font-bold text-cyan-700/70">タームで絞ると、そのタームの講座だけを登録依頼に含められます。</p>
                        </div>
                        <a href="/master/curriculum" className="rounded-xl bg-white px-3 py-2 text-xs font-black text-cyan-700 shadow-sm ring-1 ring-cyan-100 hover:bg-cyan-50">カリキュラム管理</a>
                      </div>
                      <select
                        value={formData.termFilter}
                        onChange={e => setFormData(prev => ({ ...prev, termFilter: e.target.value, courseOptionIds: [] }))}
                        className="w-full rounded-xl border border-cyan-100 bg-white px-3 py-2 text-sm font-black text-slate-700 outline-none"
                      >
                        <option value="all">すべてのターム</option>
                        {courseTerms.map((term: any) => <option key={term.key} value={term.key}>{term.label}</option>)}
                      </select>
                      <div className="mt-3">
                        <p className="mb-2 text-[11px] font-black text-cyan-700">実施月で絞り込み</p>
                        <select
                          value={formData.monthFilter}
                          onChange={e => setFormData(prev => ({ ...prev, monthFilter: e.target.value, courseOptionIds: [] }))}
                          className="w-full rounded-xl border border-cyan-100 bg-white px-3 py-2 text-sm font-black text-slate-700 outline-none"
                        >
                          <option value="all">すべての月</option>
                          {courseMonths.map(month => <option key={month} value={month}>{month}</option>)}
                        </select>
                      </div>
                    </div>
                    <div className="mb-2 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
                      <div>
                        <label className="block text-xs font-bold text-gray-500">CSV登録済みカリキュラム</label>
                        <p className="mt-1 text-[11px] font-bold text-gray-400">年間カリキュラム・講師配置と連動し、曜日・時限ごとに受講候補を表示します。</p>
                      </div>
                      <button
                        type="button"
                        onClick={() => setFormData(prev => ({
                          ...prev,
                          courseOptionIds: visibleCourseOptions().map((option: any) => option.id),
                        }))}
                        className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-black text-amber-700 hover:bg-amber-100"
                      >
                        表示中をすべて選択
                      </button>
                    </div>
                    {formData.targetGrades.length === 0 ? (
                      <div className="rounded-xl border-2 border-dashed border-blue-200 bg-blue-50 p-6 text-center text-sm font-bold text-blue-500">
                        先に送信する学年を選択してください
                      </div>
                    ) : courseOptions.length === 0 ? (
                      <div className="rounded-xl border-2 border-dashed border-gray-200 p-6 text-center text-sm font-bold text-gray-400">
                        まだカリキュラムCSVが取り込まれていません
                      </div>
                    ) : (
                      <div className="max-h-[52vh] overflow-y-auto rounded-xl border border-gray-100 bg-gray-50 p-3">
                        <div className="space-y-5">
                          {(Object.entries(groupedCourseOptions()) as [string, any[]][]).map(([key, items]) => {
                            const [year, term, grade, month] = key.split('_');
                            const selectedCount = items.filter(item => formData.courseOptionIds.includes(item.id)).length;
                            const matchedCount = items.filter(item => item.shift_match_status === 'matched').length;
                            const courseMatchedCount = items.filter(item => item.shift_match_status === 'course_matched').length;
                            const unmatchedCount = items.filter(item => item.shift_match_status === 'unmatched').length;
                            return (
                              <section key={key} className="rounded-2xl bg-white p-4 shadow-sm">
                                <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                                  <div>
                                    <h3 className="text-sm font-black text-gray-800">{year} / {term} / {grade} / {month}</h3>
                                    <p className="text-[11px] font-bold text-gray-400">{items.length}件中 {selectedCount}件選択中</p>
                                    <p className="mt-1 text-[10px] font-bold text-gray-400">
                                      単元一致 {matchedCount}件 / 講座名一致 {courseMatchedCount}件 / 未配置 {unmatchedCount}件
                                    </p>
                                  </div>
                                  <button
                                    type="button"
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
                                    className="rounded-xl bg-gray-100 px-3 py-2 text-xs font-black text-gray-600 hover:bg-gray-200"
                                  >
                                    {selectedCount === items.length ? 'この表を解除' : 'この表を選択'}
                                  </button>
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
                    <p className="mt-2 text-[11px] font-bold text-gray-400">{formData.courseOptionIds.length}件選択中</p>
                  </div>
                </div>
              ) : (
              <div>
                <label className="block text-xs font-bold text-gray-500 mb-2">選択肢（科目）の設定</label>
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
                    className="flex-1 p-2 bg-white border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 outline-none"
                  />
                  <button onClick={addSubject} className="bg-indigo-600 text-white p-2 rounded-lg hover:bg-indigo-700"><Plus size={18}/></button>
                </div>
                
                <div className="flex flex-wrap gap-2">
                  {formData.subjects.map(sub => (
                    <div key={sub} className="bg-gray-100 text-gray-700 px-3 py-1.5 rounded-lg text-sm font-bold flex items-center gap-2">
                      {sub}
                      <button onClick={() => removeSubject(sub)} className="text-gray-400 hover:text-red-500"><X size={14}/></button>
                    </div>
                  ))}
                </div>
              </div>
              )}
            </div>

            <div className="p-6 bg-gray-50 border-t border-gray-100 flex gap-3 shrink-0">
              <button onClick={() => setIsModalOpen(false)} className="flex-1 py-3 text-gray-500 font-bold hover:bg-gray-100 rounded-xl transition-colors">キャンセル</button>
              <button onClick={handleSave} disabled={creating} className="flex-1 bg-indigo-600 text-white font-bold py-3 rounded-xl hover:bg-indigo-700 disabled:opacity-50 transition-colors shadow-lg shadow-indigo-200">
                {creating ? '作成中...' : '募集を開始する'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
