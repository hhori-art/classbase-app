'use client';

import { useState, useEffect } from 'react';
import { db } from '@/lib/firebase';
import { collection, query, where, getDocs, addDoc, deleteDoc, doc, updateDoc } from 'firebase/firestore';
import { Calendar, UserCheck, Briefcase, Trash2, ArrowLeft, Video, Save, Loader2, Link as LinkIcon, Users, MapPin, User, UserPlus, X, Settings } from 'lucide-react';
import Link from 'next/link';
import ShiftImportButton from '@/app/components/ShiftImportButton';

type ShiftAssignment = {
  id: string;
  user_id: string;
  teacher_name: string;
  target_date: string;
  role_type: 'main' | 'sub' | 'general';
  target_grade: string | null;
  target_subject: string | null;
  target_detail_subject: string | null;
  target_place?: string | null;
  target_meeting_id?: string | null;
  unit: string | null;
  note: string;
  parent_id?: string;
};

type ClassGroup = {
  id: string;
  main: ShiftAssignment | null;
  subs: ShiftAssignment[];
  subject: string | null;
  grade: string | null;
  unit: string | null;
  place: string | null;
  studio: string | null;
  url: string | null;
};

const SUBJECT_DETAILS = {
  '理科': ['物理', '化学', '生物', '地学'],
  '社会': ['地理', '歴史', '公民']
};

export default function MasterShiftPage() {
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
  const [dayOfWeek, setDayOfWeek] = useState('');
  const [allTeachers, setAllTeachers] = useState<any[]>([]);
  const [availabilities, setAvailabilities] = useState<any[]>([]);
  const [assignments, setAssignments] = useState<ShiftAssignment[]>([]);
  const [urlMaster, setUrlMaster] = useState<{[key: string]: string}>({});

  const [editingShift, setEditingShift] = useState<ShiftAssignment | null>(null);

  const [form, setForm] = useState({
    userId: '',
    role: 'main',
    grade: '中1',
    subject: '理科',
    detail_subject: '物理',
    studio: '',
    unit: '',
    time_slot: '1限',
    targetClassId: ''
  });
  const [loading, setLoading] = useState(true);

  // データ取得
  const fetchData = async () => {
    try {
      const tQ = query(collection(db, 'users'), where('role', '==', 'teacher'));
      const tSnap = await getDocs(tQ);
      setAllTeachers(tSnap.docs.map(d => ({ id: d.id, ...d.data() })));

      const avQ = query(collection(db, 'teacher_availability'), where('available_date', '==', date));
      const avSnap = await getDocs(avQ);
      setAvailabilities(avSnap.docs.map(d => ({ id: d.id, ...d.data() })));

      const asQ = query(collection(db, 'shift_assignments'), where('target_date', '==', date));
      const asSnap = await getDocs(asQ);
      setAssignments(asSnap.docs.map(d => ({ id: d.id, ...d.data() } as ShiftAssignment)));

      const urlSnap = await getDocs(collection(db, 'subject_urls'));
      const urls: {[key: string]: string} = {};
      urlSnap.forEach(doc => { urls[doc.id] = doc.data().url; });
      setUrlMaster(urls);

    } catch (e) { console.error(e); } finally { setLoading(false); }
  };

  useEffect(() => {
    setLoading(true);
    const d = new Date(date);
    const days = ['日', '月', '火', '水', '木', '金', '土'];
    setDayOfWeek(days[d.getDay()]);
    fetchData();
  }, [date]);

  useEffect(() => {
    if (form.subject === '理科' && !SUBJECT_DETAILS['理科'].includes(form.detail_subject)) setForm(prev => ({ ...prev, detail_subject: '物理' }));
    if (form.subject === '社会' && !SUBJECT_DETAILS['社会'].includes(form.detail_subject)) setForm(prev => ({ ...prev, detail_subject: '地理' }));
  }, [form.subject]);

  const handleAssign = async () => {
    if (!form.userId) return alert('先生を選択してください');
    const teacher = allTeachers.find(t => t.id === form.userId);
    const teacherName = teacher?.student_name || teacher?.name || '不明';
    const systemNote = `【${form.time_slot}】`;

    let targetGrade: string | null = form.grade;
    let targetSubject: string | null = form.subject;
    let targetDetail: string | null = form.detail_subject;
    let targetPlace: string | null = form.studio;
    let parentId: string | null = null;

    if (form.role === 'sub') {
      if (!form.targetClassId) return alert('サポートに入る授業を選択してください');
      const parentClass = assignments.find(a => a.id === form.targetClassId);
      if (!parentClass) return alert('選択された授業が見つかりません');
      targetGrade = parentClass.target_grade || '';
      targetSubject = parentClass.target_subject || '';
      targetDetail = parentClass.target_detail_subject || '';
      targetPlace = parentClass.target_place || ''; 
      parentId = parentClass.id;
    } else if (form.role === 'general') {
      targetGrade = null;
      targetSubject = null;
      targetDetail = null;
      targetPlace = null;
    }

    try {
      await addDoc(collection(db, 'shift_assignments'), {
        user_id: form.userId,
        teacher_name: teacherName,
        target_date: date,
        role_type: form.role,
        target_grade: targetGrade,
        target_subject: targetSubject,
        target_detail_subject: targetDetail,
        target_place: targetPlace, 
        unit: form.role === 'main' ? form.unit : null,
        parent_id: parentId,
        note: systemNote,
        created_at: new Date().toISOString()
      });
      fetchData();
      if (form.role === 'sub') setForm(prev => ({...prev, userId: ''}));
    } catch (e: any) { alert('エラー: ' + e.message); }
  };

  const handleDelete = async (id: string) => {
    if(!confirm('この配置を解除しますか？')) return;
    try {
      await deleteDoc(doc(db, 'shift_assignments', id));
      setAssignments(prev => prev.filter(a => a.id !== id));
    } catch (e: any) { alert('削除エラー: ' + e.message); }
  };

  const handleUpdate = async () => {
    if (!editingShift) return;
    try {
      await updateDoc(doc(db, 'shift_assignments', editingShift.id), {
        target_place: editingShift.target_place,
        unit: editingShift.unit,
        target_meeting_id: editingShift.target_meeting_id
      });
      setEditingShift(null);
      fetchData();
    } catch (e) { alert('更新エラー'); }
  };

  const getAvailableClasses = () => {
    return assignments.filter(a =>
      a.role_type === 'main' &&
      a.note.includes(`【${form.time_slot}】`)
    ).sort((a, b) => (a.target_grade || '').localeCompare(b.target_grade || ''));
  };

  const getAllClassesForSubject = (time: string, subject: string) => {
    const slotAssignments = assignments.filter(a => {
      const isTime = (a.note && a.note.includes(`【${time}】`));
      const isSubject = a.target_subject === subject;
      return isTime && isSubject;
    });

    if (slotAssignments.length === 0) return [];

    const mains = slotAssignments.filter(a => a.role_type === 'main');
    const subs = slotAssignments.filter(a => a.role_type === 'sub');

    const classes: ClassGroup[] = mains.map(main => {
      const relatedSubs = subs.filter(sub =>
        sub.parent_id === main.id ||
        (!sub.parent_id && sub.target_grade === main.target_grade && sub.target_detail_subject === main.target_detail_subject)
      );
      
      let joinUrl = null;
      if (main.target_meeting_id) {
         joinUrl = `https://zoom.us/j/${main.target_meeting_id.replace(/\s/g, '')}`;
      } else if (main.target_detail_subject && dayOfWeek) {
         joinUrl = urlMaster[`${main.target_detail_subject}_${dayOfWeek}`];
      }

      return {
        id: main.id,
        main: main,
        subs: relatedSubs,
        subject: main.target_subject,
        grade: main.target_grade,
        unit: main.unit,
        place: main.target_detail_subject, 
        studio: main.target_place || null, 
        url: joinUrl
      };
    });

    const orphans = subs.filter(sub =>
      !mains.some(main => sub.parent_id === main.id || (!sub.parent_id && main.target_grade === sub.target_grade && main.target_detail_subject === sub.target_detail_subject))
    );
    if (orphans.length > 0) {
      classes.push({
        id: 'orphans',
        main: null,
        subs: orphans,
        subject: subject,
        grade: '未割当',
        unit: '-',
        place: '-',
        studio: null,
        url: null
      });
    }

    classes.sort((a, b) => {
      if (a.grade !== b.grade) return (a.grade || '').localeCompare(b.grade || '');
      return (a.place || '').localeCompare(b.place || '');
    });

    return classes;
  };

  const getGeneralSupport = (time: string) => {
    return assignments.filter(a => a.role_type === 'general' && a.note.includes(`【${time}】`));
  };

  return (
    <div className="min-h-screen bg-slate-50 p-4 md:p-6 pb-40 font-sans text-slate-800">
      <div className="max-w-[1800px] mx-auto">
        <div className="flex flex-col md:flex-row items-center justify-between mb-6 gap-4 bg-white p-4 rounded-2xl shadow-sm border border-slate-200">
          <div className="flex items-center gap-4 w-full md:w-auto">
            <Link href="/master" className="bg-slate-100 p-2.5 rounded-full hover:bg-slate-200 text-slate-600 transition-colors">
              <ArrowLeft size={20} />
            </Link>
            <div>
              <h1 className="text-xl md:text-2xl font-black text-slate-800 flex items-center gap-2">
                <Briefcase className="text-indigo-600" /> 講師シフト管理
              </h1>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <ShiftImportButton onSuccess={fetchData} />
            <Link href="/master/settings" className="text-xs font-bold text-indigo-600 hover:bg-indigo-50 px-4 py-2 rounded-lg transition-colors flex items-center gap-2 border border-indigo-100">
              <LinkIcon size={14}/> URL設定
            </Link>
            <div className="flex items-center gap-2 bg-slate-100 p-1.5 rounded-xl border border-slate-200">
              <input type="date" className="font-bold bg-transparent outline-none text-slate-700 cursor-pointer text-sm px-2" value={date} onChange={e => setDate(e.target.value)} />
              <span className="text-xs font-black bg-indigo-600 text-white px-3 py-1.5 rounded-lg">{dayOfWeek}曜日</span>
            </div>
          </div>
        </div>

        <div className="flex flex-col lg:flex-row gap-6 items-start">
          {/* 左カラム: 操作パネル (省略なし) */}
          <div className="w-full lg:w-[320px] flex flex-col gap-6 shrink-0">
            <div className="bg-white p-5 rounded-2xl shadow-lg border-2 border-indigo-100">
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-bold text-slate-700 text-sm flex gap-2 items-center">
                  <Save size={18} className="text-indigo-600"/> 配置コンソール
                </h3>
              </div>
              <div className="space-y-4">
                <div className={`p-3 rounded-xl text-center font-bold text-sm min-h-[44px] flex items-center justify-center border-2 transition-all ${form.userId ? 'bg-indigo-600 text-white border-indigo-600 shadow-md' : 'bg-slate-50 text-slate-400 border-dashed border-slate-300'}`}>
                  {allTeachers.find(t => t.id === form.userId)?.student_name || allTeachers.find(t => t.id === form.userId)?.name || "リストから先生を選択"}
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1 block">時限</label>
                    <select className="w-full p-2.5 border-2 border-slate-100 rounded-xl text-sm font-bold text-slate-700 outline-none" value={form.time_slot} onChange={e => setForm({...form, time_slot: e.target.value})}>
                      <option>1限</option><option>2限</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1 block">役割</label>
                    <select className="w-full p-2.5 border-2 border-slate-100 rounded-xl text-sm font-bold text-slate-700 outline-none" value={form.role} onChange={e => setForm({...form, role: e.target.value})}>
                      <option value="main">授業 (Main)</option>
                      <option value="sub">サポート (Sub)</option>
                      <option value="general">全体サポート</option>
                    </select>
                  </div>
                </div>

                {form.role === 'main' && (
                  <div className="bg-slate-50 p-3 rounded-xl border border-slate-100 space-y-3 animate-in fade-in zoom-in-95">
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1 block">学年</label>
                        <select className="w-full p-2 border border-slate-200 rounded-lg text-sm font-bold outline-none" value={form.grade} onChange={e => setForm({...form, grade: e.target.value})}>
                          <option>中1</option><option>中2</option><option>中3</option>
                        </select>
                      </div>
                      <div>
                        <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1 block">教科</label>
                        <select className="w-full p-2 border border-slate-200 rounded-lg text-sm font-bold outline-none" value={form.subject} onChange={e => setForm({...form, subject: e.target.value})}>
                          <option>理科</option><option>社会</option>
                        </select>
                      </div>
                    </div>
                    <div>
                      <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1 block">場所 (詳細科目)</label>
                      <select className="w-full p-2 border border-slate-200 rounded-lg text-sm font-bold text-indigo-700 bg-white outline-none" value={form.detail_subject} onChange={e => setForm({...form, detail_subject: e.target.value})}>
                        {(form.subject === '理科' ? SUBJECT_DETAILS['理科'] : SUBJECT_DETAILS['社会']).map(sub => (
                          <option key={sub} value={sub}>{sub}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1 block">実施スタジオ</label>
                      <input type="text" placeholder="例: 元町 6F1" className="w-full p-2 border border-slate-200 rounded-lg text-sm outline-none" value={form.studio} onChange={e => setForm({...form, studio: e.target.value})} />
                    </div>
                    <div>
                      <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1 block">単元名</label>
                      <input type="text" placeholder="例: 力のつり合い" className="w-full p-2 border border-slate-200 rounded-lg text-sm outline-none" value={form.unit} onChange={e => setForm({...form, unit: e.target.value})} />
                    </div>
                  </div>
                )}

                {form.role === 'sub' && (
                  <div className="bg-yellow-50 p-3 rounded-xl border border-yellow-100 space-y-3 animate-in fade-in zoom-in-95">
                    <div>
                      <label className="text-[10px] font-bold text-yellow-600 uppercase tracking-wider mb-1 block flex items-center gap-1"><UserPlus size={12}/> 対象の授業を選択</label>
                      <select className="w-full p-2 border border-yellow-200 rounded-lg text-xs font-bold text-slate-700 bg-white outline-none" value={form.targetClassId} onChange={e => setForm({...form, targetClassId: e.target.value})}>
                        <option value="">授業を選択してください...</option>
                        {getAvailableClasses().length === 0 && <option disabled>授業がありません</option>}
                        {getAvailableClasses().map(cls => (
                          <option key={cls.id} value={cls.id}>
                            {cls.target_grade} {cls.target_subject}({cls.target_detail_subject}) - {cls.teacher_name}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                )}

                <button onClick={handleAssign} disabled={!form.userId || (form.role === 'sub' && !form.targetClassId)} className={`w-full py-3.5 rounded-xl font-bold shadow-lg transition-all active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 ${form.role === 'sub' ? 'bg-yellow-500 hover:bg-yellow-600 text-white shadow-yellow-200' : 'bg-indigo-600 hover:bg-indigo-700 text-white shadow-indigo-200'}`}>
                  <Users size={18}/> {form.role === 'sub' ? 'サポートに追加' : '配置する'}
                </button>
              </div>
            </div>

            {/* 待機リスト */}
            <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden flex flex-col">
              <div className="bg-slate-50 p-3 border-b border-slate-200">
                <h2 className="font-bold text-slate-600 text-xs uppercase tracking-wider flex items-center gap-2"><UserCheck size={14}/> 待機中の先生</h2>
              </div>
              <div className="p-2 space-y-1">
                {loading ? <div className="flex justify-center py-10"><Loader2 className="animate-spin text-indigo-400"/></div> : 
                  allTeachers.map(t => {
                    const avail = availabilities.find(a => a.user_id === t.id);
                    const assignedCount = assignments.filter(a => a.user_id === t.id).length;
                    return (
                      <div key={t.id} onClick={() => setForm({ ...form, userId: t.id })} className={`p-3 rounded-xl border cursor-pointer transition-all text-sm group relative ${form.userId === t.id ? 'border-indigo-500 bg-indigo-50 ring-1 ring-indigo-300' : assignedCount > 0 ? 'border-slate-100 bg-slate-50 opacity-60' : 'border-slate-100 hover:bg-slate-50 hover:border-indigo-200'}`}>
                        <div className="flex justify-between items-center">
                          <div>
                            <span className="font-bold text-slate-700 block">{t.student_name || t.name}</span>
                            {assignedCount > 0 && <span className="text-[10px] text-green-600 font-bold bg-green-50 px-1.5 rounded mt-0.5 inline-block">配置済 ({assignedCount})</span>}
                          </div>
                          {avail ? <span className="text-[10px] bg-green-100 text-green-700 px-2 py-1 rounded-full font-bold shadow-sm">{avail.note || '〇'}</span> : <span className="text-[10px] text-slate-300">-</span>}
                        </div>
                      </div>
                    );
                  })
                }
              </div>
            </div>
          </div>

          {/* 右カラム: スケジュールボード */}
          <div className="flex-1 space-y-10 min-w-0">
            {['1限', '2限'].map((period) => (
              <div key={period} className="bg-white rounded-3xl shadow-sm border border-slate-200 overflow-hidden">
                <div className={`p-4 text-white font-black text-lg flex justify-between items-center shadow-sm ${period === '1限' ? 'bg-gradient-to-r from-blue-600 to-blue-500' : 'bg-gradient-to-r from-indigo-600 to-indigo-500'}`}>
                  <div className="flex items-center gap-3">
                    <span className="bg-white/20 px-3 py-1 rounded-lg text-sm backdrop-blur-sm">{period}</span>
                    <span>{period === '1限' ? '19:20 - 20:25' : '20:35 - 21:40'}</span>
                  </div>
                </div>

                <div className="overflow-x-auto custom-scrollbar">
                  <div className="flex gap-0 min-w-max divide-x divide-slate-100">
                    {/* 理科エリア */}
                    <div className="flex flex-col p-4 gap-3">
                      <div className="flex items-center gap-2 mb-2">
                        <span className="bg-emerald-100 text-emerald-800 text-xs font-black px-3 py-1 rounded-full whitespace-nowrap">理科グループ</span>
                      </div>
                      <div className="flex gap-4">
                        {getAllClassesForSubject(period, '理科').map(info => (
                          <div key={info.id} className="w-[240px] bg-white border-2 border-emerald-100 rounded-xl shadow-sm flex flex-col overflow-hidden relative group hover:shadow-md transition-all shrink-0">
                            <div className="bg-emerald-50/50 p-3 border-b border-emerald-50 relative">
                              <div className="flex justify-between items-start mb-2">
                                <span className="text-xs font-black text-emerald-600 bg-emerald-100 px-2 py-0.5 rounded shadow-sm whitespace-nowrap">{info.grade} / {info.place}</span>
                                {info.main && (
                                  <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                    <button onClick={() => setEditingShift(info.main)} className="text-slate-400 hover:text-blue-500"><Settings size={14}/></button>
                                    <button onClick={() => handleDelete(info.main!.id)} className="text-slate-400 hover:text-red-500"><Trash2 size={14}/></button>
                                  </div>
                                )}
                              </div>
                              <div className="text-sm font-bold text-slate-800 line-clamp-2 min-h-[1.25em]">
                                {info.unit || <span className="text-slate-300 font-normal text-xs">単元未設定</span>}
                              </div>
                              {info.studio && (
                                <div className="flex items-center gap-1 text-[10px] text-emerald-600 font-bold mt-1">
                                  <MapPin size={10}/> {info.studio}
                                </div>
                              )}
                            </div>

                            <div className="p-3 flex-1 flex flex-col gap-3">
                              <div className="flex items-center gap-3">
                                <div className="w-8 h-8 rounded-full bg-emerald-100 flex items-center justify-center text-emerald-600 shrink-0">
                                  <User size={16}/>
                                </div>
                                <div>
                                  <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider block mb-0.5">Teacher</span>
                                  <span className="font-bold text-slate-800 text-sm">{info.main?.teacher_name || '未定'}</span>
                                </div>
                              </div>

                              {info.subs.length > 0 && (
                                <div className="bg-slate-50 p-2 rounded-lg border border-slate-100">
                                  <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider block mb-1">Support</span>
                                  <div className="space-y-1">
                                    {info.subs.map((sub: ShiftAssignment) => (
                                      <div key={sub.id} className="flex justify-between items-center text-xs">
                                        <span className="text-slate-600 font-medium flex items-center gap-1">
                                          <div className="w-1.5 h-1.5 rounded-full bg-slate-300"></div> {sub.teacher_name}
                                        </span>
                                        <button onClick={() => handleDelete(sub.id)} className="text-slate-300 hover:text-red-500 opacity-0 group-hover:opacity-100"><Trash2 size={10}/></button>
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              )}

                              <div className="mt-auto pt-2">
                                {info.url ? (
                                  <a href={info.url} target="_blank" rel="noreferrer" className="w-full bg-emerald-500 hover:bg-emerald-600 text-white text-xs font-bold py-2 rounded-lg flex items-center justify-center gap-2 transition-all active:scale-95 shadow-sm shadow-emerald-200">
                                    <Video size={14}/> 授業に参加
                                  </a>
                                ) : (
                                  <div className="w-full bg-slate-100 text-slate-400 text-xs font-bold py-2 rounded-lg flex items-center justify-center gap-2 cursor-not-allowed">
                                    <Video size={14}/> URL未設定
                                  </div>
                                )}
                              </div>
                            </div>
                          </div>
                        ))}
                        {getAllClassesForSubject(period, '理科').length === 0 && (
                          <div className="w-[200px] h-[100px] border-2 border-dashed border-slate-200 rounded-xl flex items-center justify-center text-slate-300 font-bold text-sm shrink-0">授業予定なし</div>
                        )}
                      </div>
                    </div>

                    {/* 社会エリア */}
                    <div className="flex flex-col p-4 gap-3">
                      <div className="flex items-center gap-2 mb-2">
                        <span className="bg-orange-100 text-orange-800 text-xs font-black px-3 py-1 rounded-full whitespace-nowrap">社会グループ</span>
                      </div>
                      <div className="flex gap-4">
                        {getAllClassesForSubject(period, '社会').map(info => (
                          <div key={info.id} className="w-[240px] bg-white border-2 border-orange-100 rounded-xl shadow-sm flex flex-col overflow-hidden relative group hover:shadow-md transition-all shrink-0">
                            <div className="bg-orange-50/50 p-3 border-b border-orange-50 relative">
                              <div className="flex justify-between items-start mb-2">
                                <span className="text-xs font-black text-orange-600 bg-orange-100 px-2 py-0.5 rounded shadow-sm whitespace-nowrap">{info.grade} / {info.place}</span>
                                {info.main && (
                                  <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                    <button onClick={() => setEditingShift(info.main)} className="text-slate-400 hover:text-blue-500"><Settings size={14}/></button>
                                    <button onClick={() => handleDelete(info.main!.id)} className="text-slate-400 hover:text-red-500"><Trash2 size={14}/></button>
                                  </div>
                                )}
                              </div>
                              <div className="text-sm font-bold text-slate-800 line-clamp-2 min-h-[1.25em]">
                                {info.unit || <span className="text-slate-300 font-normal text-xs">単元未設定</span>}
                              </div>
                              {info.studio && (
                                <div className="flex items-center gap-1 text-[10px] text-orange-600 font-bold mt-1">
                                  <MapPin size={10}/> {info.studio}
                                </div>
                              )}
                            </div>

                            <div className="p-3 flex-1 flex flex-col gap-3">
                              <div className="flex items-center gap-3">
                                <div className="w-8 h-8 rounded-full bg-orange-100 flex items-center justify-center text-orange-600 shrink-0">
                                  <User size={16}/>
                                </div>
                                <div>
                                  <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider block mb-0.5">Teacher</span>
                                  <span className="font-bold text-slate-800 text-sm">{info.main?.teacher_name || '未定'}</span>
                                </div>
                              </div>

                              {info.subs.length > 0 && (
                                <div className="bg-slate-50 p-2 rounded-lg border border-slate-100">
                                  <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider block mb-1">Support</span>
                                  <div className="space-y-1">
                                    {info.subs.map((sub: ShiftAssignment) => (
                                      <div key={sub.id} className="flex justify-between items-center text-xs">
                                        <span className="text-slate-600 font-medium flex items-center gap-1">
                                          <div className="w-1.5 h-1.5 rounded-full bg-slate-300"></div> {sub.teacher_name}
                                        </span>
                                        <button onClick={() => handleDelete(sub.id)} className="text-slate-300 hover:text-red-500 opacity-0 group-hover:opacity-100"><Trash2 size={10}/></button>
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              )}

                              <div className="mt-auto pt-2">
                                {info.url ? (
                                  <a href={info.url} target="_blank" rel="noreferrer" className="w-full bg-orange-500 hover:bg-orange-600 text-white text-xs font-bold py-2 rounded-lg flex items-center justify-center gap-2 transition-all active:scale-95 shadow-sm shadow-orange-200">
                                    <Video size={14}/> 授業に参加
                                  </a>
                                ) : (
                                  <div className="w-full bg-slate-100 text-slate-400 text-xs font-bold py-2 rounded-lg flex items-center justify-center gap-2 cursor-not-allowed">
                                    <Video size={14}/> URL未設定
                                  </div>
                                )}
                              </div>
                            </div>
                          </div>
                        ))}
                        {getAllClassesForSubject(period, '社会').length === 0 && (
                          <div className="w-[200px] h-[100px] border-2 border-dashed border-slate-200 rounded-xl flex items-center justify-center text-slate-300 font-bold text-sm shrink-0">授業予定なし</div>
                        )}
                      </div>
                    </div>

                    {/* 全体サポート */}
                    <div className="flex flex-col p-4 gap-3 w-[200px] shrink-0 bg-slate-50/50">
                      <div className="flex items-center gap-2 mb-2">
                        <span className="bg-slate-200 text-slate-600 text-xs font-black px-3 py-1 rounded-full whitespace-nowrap">全体サポート</span>
                      </div>
                      <div className="flex flex-col gap-2">
                        {getGeneralSupport(period).map(a => (
                          <div key={a.id} className="w-full bg-white border border-slate-200 rounded-xl p-3 flex items-center justify-between shadow-sm relative group">
                            <div className="flex items-center gap-3">
                              <div className="w-8 h-8 rounded-full bg-slate-200 flex items-center justify-center text-slate-500">
                                <User size={16}/>
                              </div>
                              <span className="font-bold text-slate-700 text-sm">{a.teacher_name}</span>
                            </div>
                            <button onClick={() => handleDelete(a.id)} className="text-slate-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity"><Trash2 size={14}/></button>
                          </div>
                        ))}
                        {getGeneralSupport(period).length === 0 && (
                          <div className="text-slate-300 text-xs font-bold py-2">配置なし</div>
                        )}
                      </div>
                    </div>

                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* 編集モーダル */}
      {editingShift && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl w-full max-w-lg shadow-xl overflow-hidden">
            <div className="bg-slate-800 text-white p-4 flex justify-between items-center">
              <h2 className="font-bold flex items-center gap-2">シフト編集</h2>
              <button onClick={() => setEditingShift(null)}><X size={20}/></button>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="text-xs font-bold text-gray-500">実施スタジオ</label>
                <input className="w-full p-2 border rounded mt-1" value={editingShift.target_place || ''} onChange={e => setEditingShift({...editingShift, target_place: e.target.value})} placeholder="例: 元町 6F1"/>
              </div>
              <div>
                <label className="text-xs font-bold text-gray-500">単元</label>
                <input className="w-full p-2 border rounded mt-1" value={editingShift.unit || ''} onChange={e => setEditingShift({...editingShift, unit: e.target.value})}/>
              </div>
              <div>
                <label className="text-xs font-bold text-gray-500">Zoom ID (ミーティングID)</label>
                <input className="w-full p-2 border rounded mt-1 font-mono" value={editingShift.target_meeting_id || ''} onChange={e => setEditingShift({...editingShift, target_meeting_id: e.target.value})} placeholder="123 456 7890"/>
                <p className="text-[10px] text-gray-400 mt-1">※ 設定すると「授業に参加」ボタンが自動的にこのIDのZoomリンクになります</p>
              </div>
              <button onClick={handleUpdate} className="w-full bg-blue-600 text-white py-3 rounded-lg font-bold hover:bg-blue-700 shadow mt-4 flex justify-center items-center gap-2"><Save size={18}/> 保存</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}