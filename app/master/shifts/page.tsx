'use client';

import { useState, useEffect } from 'react';
import { auth, db } from '@/lib/firebase';
import { collection, query, where, getDocs, addDoc, deleteDoc, doc, updateDoc, orderBy, limit, getDoc } from 'firebase/firestore';
import { Briefcase, Trash2, ArrowLeft, Video, Save, Loader2, Link as LinkIcon, Users, MapPin, User, GripVertical, CheckCircle, HelpCircle, Clock, KeyRound, Zap, BarChart2, X, Settings, AlertTriangle, Bell } from 'lucide-react';
import Link from 'next/link';
import ShiftImportButton from '@/app/components/ShiftImportButton';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, CartesianGrid } from 'recharts';
import { useAuth } from '@/app/context/AuthContext';

// --- 型定義 ---
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
  teacher_workplace?: string | null;
  target_meeting_id?: string | null;
  target_password?: string | null;
  target_signin_address?: string | null;
  unit: string | null;
  note: string;
  parent_id?: string;
  start_url?: string; 
  target_recording_url?: string;
};

type Teacher = {
  id: string;
  student_name?: string;
  name?: string;
  lifetime_id?: string;
  role: string;
  survey_url?: string;
};

type TeacherAvailability = {
  id: string;
  teacher_id?: string;
  user_id?: string;
  teacher_name?: string;
  available_date: string;
  time_range?: string;
  workplace?: string;
  location?: string;
  note?: string;
  roles?: string[];
  status?: string;
};

const normalizeMeetingId = (value?: string | null) =>
  String(value || '')
    .normalize('NFKC')
    .replace(/[^\d]/g, '');

const buildMeetingJoinUrl = (meetingId?: string | null, passcode?: string | null) => {
  const cleanMeetingId = normalizeMeetingId(meetingId);
  if (!cleanMeetingId) return null;
  const url = new URL(`https://zoom.us/j/${cleanMeetingId}`);
  if (passcode) url.searchParams.set('pwd', passcode);
  return url.toString();
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

const WORK_LOCATIONS = ['元町', '本山', '西神南', '姫路', '加古川', '明石'];

const teacherIdOfAvailability = (availability: TeacherAvailability) => availability.teacher_id || availability.user_id || '';
const teacherNameOf = (teacher?: Teacher | null) => teacher?.student_name || teacher?.name || '名称未設定';

export default function MasterShiftPage() {
  const { user } = useAuth();
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
  const [dayOfWeek, setDayOfWeek] = useState('');
  const [allTeachers, setAllTeachers] = useState<Teacher[]>([]);
  const [availabilities, setAvailabilities] = useState<TeacherAvailability[]>([]);
  const [assignments, setAssignments] = useState<ShiftAssignment[]>([]);
  const [urlMaster, setUrlMaster] = useState<{[key: string]: string}>({});
  const [unassignedNotice, setUnassignedNotice] = useState<{ count: number; names: string[]; notified: number } | null>(null);

  const [editingShift, setEditingShift] = useState<ShiftAssignment | null>(null);
  const [creatingZoom, setCreatingZoom] = useState(false); 
  const [updatingPasscode, setUpdatingPasscode] = useState(false);

  // アンケート関連
  const [surveyQuestions, setSurveyQuestions] = useState<any[]>([]);
  const [surveyResults, setSurveyResults] = useState<any[]>([]);
  const [isSurveyModalOpen, setIsSurveyModalOpen] = useState(false);
  const [selectedTeacherForResults, setSelectedTeacherForResults] = useState<{id: string, name: string} | null>(null);
  const [surveyLoading, setSurveyLoading] = useState(false);

  // ドラッグ＆ドロップ用
  const [draggedTeacher, setDraggedTeacher] = useState<Teacher | null>(null);
  const [dragOverCardId, setDragOverCardId] = useState<string | null>(null);
  const [dragOverZone, setDragOverZone] = useState<'main' | 'sub' | 'general' | null>(null);

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
  const [relinking, setRelinking] = useState(false);

  // データ取得
  const fetchData = async () => {
    try {
      const tQ = query(collection(db, 'users'), where('role', '==', 'teacher'));
      const tSnap = await getDocs(tQ);
      setAllTeachers(tSnap.docs.map(d => ({ id: d.id, ...d.data() } as Teacher)));

      const avQ = query(collection(db, 'teacher_availability'), where('available_date', '==', date));
      const avSnap = await getDocs(avQ);
      const availabilityData = avSnap.docs.map(d => ({ id: d.id, ...d.data() } as TeacherAvailability));
      availabilityData.sort((a, b) => {
        const aName = a.teacher_name || '';
        const bName = b.teacher_name || '';
        return aName.localeCompare(bName, 'ja');
      });
      setAvailabilities(availabilityData);

      const asQ = query(collection(db, 'shift_assignments'), where('target_date', '==', date));
      const asSnap = await getDocs(asQ);
      setAssignments(asSnap.docs.map(d => ({ id: d.id, ...d.data() } as ShiftAssignment)));

      const urlSnap = await getDocs(collection(db, 'subject_urls'));
      const urls: {[key: string]: string} = {};
      urlSnap.forEach(doc => { urls[doc.id] = doc.data().url; });
      setUrlMaster(urls);

      const tmplSnap = await getDoc(doc(db, 'survey_templates', 'default'));
      if (tmplSnap.exists()) {
        setSurveyQuestions(tmplSnap.data().questions || []);
      }

    } catch (e) { console.error(e); } finally { setLoading(false); }
  };

  const notifyUnassignedTeachers = async () => {
    try {
      const token = await user?.getIdToken();
      if (!token) return;
      const res = await fetch('/api/admin/shifts/unassigned-notifications', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ target_date: date }),
      });
      const data = await res.json().catch(() => null);
      if (res.ok && data?.ok) {
        setUnassignedNotice({ count: data.unassigned_count || 0, names: data.names || [], notified: data.notified_count || 0 });
      }
    } catch (error) {
      console.error('unassigned notification error:', error);
    }
  };

  const relinkShiftTeachers = async () => {
    if (!confirm(`${date} の講師配置を、講師名から再照合して紐付け直しますか？`)) return;
    setRelinking(true);
    try {
      const token = await user?.getIdToken();
      if (!token) throw new Error('ログイン情報を確認できません。再ログインしてください。');
      const res = await fetch('/api/admin/shifts/relink', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ target_date: date }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) throw new Error(data.error || 'relink failed');
      alert(`再照合しました。\n更新: ${data.updated}件\n未解決: ${data.unresolved}件`);
      await fetchData();
    } catch (e: any) {
      alert(`紐付け再照合に失敗しました: ${e.message || e}`);
    } finally {
      setRelinking(false);
    }
  };

  useEffect(() => {
    setLoading(true);
    const d = new Date(date);
    const days = ['日', '月', '火', '水', '木', '金', '土'];
    setDayOfWeek(days[d.getDay()]);
    fetchData();
  }, [date]);

  useEffect(() => {
    if (user && !loading) notifyUnassignedTeachers();
  }, [user, loading, date]);

  useEffect(() => {
    if (form.subject === '理科' && !SUBJECT_DETAILS['理科'].includes(form.detail_subject)) setForm(prev => ({ ...prev, detail_subject: '物理' }));
    if (form.subject === '社会' && !SUBJECT_DETAILS['社会'].includes(form.detail_subject)) setForm(prev => ({ ...prev, detail_subject: '地理' }));
  }, [form.subject]);

  // 配置処理
  const executeAssign = async (
    teacherId: string, 
    role: 'main' | 'sub' | 'general', 
    targetClass?: ShiftAssignment,
    periodStr: string = '1限'
  ) => {
    const teacher = allTeachers.find(t => t.id === teacherId);
    if (!teacher) return;
    const teacherName = teacherNameOf(teacher);
    const availability = availabilitiesByTeacher.get(teacherId)?.find(a => a.status !== 'impossible');
    const requestedWorkplace = availability?.workplace || availability?.location || '';
    
    try {
      const shiftData: any = {
        user_id: teacherId,
        teacher_name: teacherName,
        target_date: date,
        role_type: role,
        note: `【${periodStr}】`,
        teacher_availability_id: availability?.id || null,
        teacher_workplace: requestedWorkplace || null,
        requested_time_range: availability?.time_range || null,
        created_at: new Date().toISOString()
      };

      if (role === 'main') {
        if (targetClass) {
           await updateDoc(doc(db, 'shift_assignments', targetClass.id), {
             user_id: teacherId,
             teacher_name: teacherName
           });
        } else {
           shiftData.target_grade = form.grade;
           shiftData.target_subject = form.subject;
           shiftData.target_detail_subject = form.detail_subject;
           shiftData.target_place = form.studio || requestedWorkplace;
           shiftData.unit = form.unit;
           await addDoc(collection(db, 'shift_assignments'), shiftData);
        }
      } else if (role === 'sub') {
        if (!targetClass) return;
        shiftData.target_grade = targetClass.target_grade;
        shiftData.target_subject = targetClass.target_subject;
        shiftData.target_detail_subject = targetClass.target_detail_subject;
        shiftData.target_place = targetClass.target_place || requestedWorkplace;
        shiftData.parent_id = targetClass.id;
        await addDoc(collection(db, 'shift_assignments'), shiftData);
      } else {
        await addDoc(collection(db, 'shift_assignments'), shiftData);
      }
      
      fetchData();
    } catch (e: any) { alert('エラー: ' + e.message); }
  };

  const handleManualAssign = () => {
    if (!form.userId) return alert('先生を選択してください');
    let targetClass: ShiftAssignment | undefined = undefined;
    if (form.role === 'sub' && form.targetClassId) {
      targetClass = assignments.find(a => a.id === form.targetClassId);
    }
    executeAssign(form.userId, form.role as any, targetClass, form.time_slot);
  };

  const handleDragStart = (e: React.DragEvent, teacher: Teacher) => {
    setDraggedTeacher(teacher);
    e.dataTransfer.effectAllowed = 'copy';
  };

  const handleDragOver = (e: React.DragEvent, cardId: string, zone: 'main' | 'sub' | 'general') => {
    e.preventDefault();
    setDragOverCardId(cardId);
    setDragOverZone(zone);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    setDragOverCardId(null);
    setDragOverZone(null);
  };

  const handleDrop = async (e: React.DragEvent, targetClass: ShiftAssignment | null, zone: 'main' | 'sub' | 'general', periodStr?: string) => {
    e.preventDefault();
    setDragOverCardId(null);
    setDragOverZone(null);

    if (!draggedTeacher) return;

    const actualPeriodStr = periodStr || (targetClass?.note.includes('1限') ? '1限' : '2限');

    if (zone === 'main' && targetClass) {
      if (!confirm(`「${targetClass.target_subject}」の担当講師を\n「${draggedTeacher.student_name || draggedTeacher.name}」先生に変更しますか？`)) return;
      await executeAssign(draggedTeacher.id, 'main', targetClass, actualPeriodStr);
    } else if (zone === 'sub' && targetClass) {
      if (!confirm(`「${targetClass.target_subject}」に\n「${draggedTeacher.student_name || draggedTeacher.name}」先生をサポートとして追加しますか？`)) return;
      await executeAssign(draggedTeacher.id, 'sub', targetClass, actualPeriodStr);
    } else if (zone === 'general') {
      if (!confirm(`「${actualPeriodStr}」の全体サポートに\n「${draggedTeacher.student_name || draggedTeacher.name}」先生を追加しますか？`)) return;
      await executeAssign(draggedTeacher.id, 'general', undefined, actualPeriodStr);
    }
    setDraggedTeacher(null);
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
        teacher_workplace: editingShift.target_place || null,
        unit: editingShift.unit,
        target_meeting_id: editingShift.target_meeting_id,
        target_signin_address: editingShift.target_signin_address,
        start_url: editingShift.start_url || null,
        target_recording_url: editingShift.target_recording_url || null 
      });
      setEditingShift(null);
      fetchData();
    } catch (e) { alert('更新エラー'); }
  };

  const handleUpdateZoomPasscode = async () => {
    if (!editingShift) return;
    const meetingId = normalizeMeetingId(editingShift.target_meeting_id);
    const passcode = String(editingShift.target_password || '').trim();
    if (!meetingId) return alert('先にZoom IDを入力してください。');
    if (!passcode) return alert('Zoomパスコードを入力してください。');
    if (!/^[A-Za-z0-9@_-]{1,10}$/.test(passcode)) {
      return alert('Zoomパスコードは半角英数字と @ _ - を使い、10文字以内で入力してください。');
    }

    setUpdatingPasscode(true);
    try {
      const token = await user?.getIdToken();
      if (!token) throw new Error('ログイン情報を確認できません。再ログインしてください。');
      const response = await fetch(`/api/admin/shifts/${editingShift.id}/passcode`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ passcode }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result.ok) throw new Error(result.error || 'Zoomパスコードを更新できませんでした。');

      setEditingShift(previous => previous ? { ...previous, target_password: result.passcode || passcode } : previous);
      setAssignments(previous => previous.map(shift => (
        shift.id === editingShift.id ? { ...shift, target_password: result.passcode || passcode } : shift
      )));
      if (result.join_url_ready) {
        alert('Zoomのパスコードを更新し、暗号化済みの生徒用参加リンクも取得しました。');
      } else {
        alert(`Zoomのパスコードは更新しましたが、生徒用参加リンクを取得できませんでした。${result.warning ? `\n${result.warning}` : ''}`);
      }
    } catch (error: any) {
      alert(`パスコードの更新に失敗しました: ${error?.message || '通信エラー'}`);
    } finally {
      setUpdatingPasscode(false);
    }
  };

  const handleManualZoomCreate = async () => {
    if (!editingShift) return;
    
    const isFirstPeriod = editingShift.note?.includes('1限');
    const startTimeISO = isFirstPeriod 
      ? `${editingShift.target_date}T19:20:00` 
      : `${editingShift.target_date}T20:35:00`;

    setCreatingZoom(true);
    try {
      const res = await fetch('/api/create-zoom-meeting', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          topic: `${editingShift.target_grade}${editingShift.target_subject} (${editingShift.teacher_name}先生)`,
          startTime: startTimeISO,
          duration: 75
        }),
      });

      if (!res.ok) throw new Error('API Error');
      const data = await res.json();

      if (data.success) {
        setEditingShift({
          ...editingShift,
          target_meeting_id: String(data.meeting_id),
          start_url: data.start_url,
          target_recording_url: data.join_url,
        });
        alert('Zoomミーティングを発行しました。\n「保存」ボタンを押して確定してください。');
      } else {
        alert(`作成失敗: ${data.error}`);
      }
    } catch (e) {
      console.error(e);
      alert('Zoom作成中にエラーが発生しました。');
    } finally {
      setCreatingZoom(false);
    }
  };

  const handleShowSurveyResults = async (e: React.MouseEvent, teacherId: string, teacherName: string) => {
    e.stopPropagation();
    if (!teacherId) return;
    setSelectedTeacherForResults({ id: teacherId, name: teacherName });
    setSurveyLoading(true);
    setIsSurveyModalOpen(true);
    try {
      const q = query(
        collection(db, 'survey_responses'),
        where('teacher_id', '==', teacherId),
        orderBy('created_at', 'desc'),
        limit(100)
      );
      const snap = await getDocs(q);
      const results = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      setSurveyResults(results);
    } catch (err) {
      console.error(err);
      setSurveyResults([]);
    } finally {
      setSurveyLoading(false);
    }
  };

  const calculateRatingStats = (questionId: number) => {
    const counts: Record<1 | 2 | 3 | 4 | 5, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    let total = 0;
    let sum = 0;
    surveyResults.forEach((res: any) => {
      const val = res.answers?.[questionId];
      if (typeof val === 'number' && val >= 1 && val <= 5) {
        const rating = val as 1 | 2 | 3 | 4 | 5;
        counts[rating]++;
        sum += rating;
        total++;
      }
    });
    const average = total > 0 ? (sum / total).toFixed(1) : '0.0';
    const data = [
      { name: '5', count: counts[5], fill: '#4ade80' },
      { name: '4', count: counts[4], fill: '#a3e635' },
      { name: '3', count: counts[3], fill: '#facc15' },
      { name: '2', count: counts[2], fill: '#fb923c' },
      { name: '1', count: counts[1], fill: '#f87171' },
    ];
    return { average, total, data };
  };

  const getTextAnswers = (questionId: number) => {
    return surveyResults
      .filter((res: any) => res.answers?.[questionId])
      .map((res: any) => ({
        id: res.id,
        text: res.answers[questionId],
        date: res.created_at?.seconds ? new Date(res.created_at.seconds * 1000).toLocaleDateString() : '',
        student: res.student_name,
        subject: res.subject
      }));
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
      
      let joinUrl = buildMeetingJoinUrl(main.target_meeting_id, main.target_password);
      if (!joinUrl && main.target_detail_subject && dayOfWeek) {
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

    classes.sort((a, b) => {
      if (a.grade !== b.grade) return (a.grade || '').localeCompare(b.grade || '');
      return (a.place || '').localeCompare(b.place || '');
    });

    return classes;
  };

  const getGeneralSupport = (time: string) => {
    return assignments.filter(a => a.role_type === 'general' && a.note.includes(`【${time}】`));
  };

  const availabilitiesByTeacher = new Map<string, TeacherAvailability[]>();
  availabilities.forEach(availability => {
    const teacherId = teacherIdOfAvailability(availability);
    if (!teacherId) return;
    const current = availabilitiesByTeacher.get(teacherId) || [];
    current.push(availability);
    availabilitiesByTeacher.set(teacherId, current);
  });

  const assignedTeacherIds = new Set(assignments.map(a => a.user_id).filter(Boolean));
  const submittedTeachers = allTeachers
    .filter(t => (availabilitiesByTeacher.get(t.id) || []).some(a => a.status !== 'impossible'))
    .sort((a, b) => teacherNameOf(a).localeCompare(teacherNameOf(b), 'ja'));
  const unassignedSubmittedTeachers = submittedTeachers.filter(t => !assignedTeacherIds.has(t.id));

  // 講師リストのグループ分け
  const groupedTeachers = {
    available: [] as Teacher[],
    maybe: [] as Teacher[],
    others: [] as Teacher[]
  };

  allTeachers.forEach(t => {
    const teacherAvailabilities = availabilitiesByTeacher.get(t.id) || [];
    const avail = teacherAvailabilities.find(a => a.status !== 'impossible');
    
    if (!avail) {
      // 完全未提出
      groupedTeachers.others.push(t);
    } else if (avail.status === 'impossible') {
      // 提出済みだが「不可」
      groupedTeachers.others.push(t);
    } else {
      // それ以外（possible, またはステータス不明でもレコードがあれば提出済みとみなす）
      if (avail.note?.includes('△')) {
        groupedTeachers.maybe.push(t);
      } else {
        groupedTeachers.available.push(t);
      }
    }
  });

  const renderTeacherList = (list: Teacher[], type: 'available' | 'maybe' | 'others') => {
    if (list.length === 0) return <div className="text-xs text-gray-400 p-2">該当なし</div>;
    
    return list.map(t => {
      const assignedCount = assignments.filter(a => a.user_id === t.id).length;
      const teacherAvailabilities = availabilitiesByTeacher.get(t.id) || [];
      const avail = teacherAvailabilities.find(a => a.status !== 'impossible') || teacherAvailabilities[0]; 

      // 不可で提出されている場合
      const isImpossible = avail?.status === 'impossible';
      const workplace = avail?.workplace || avail?.location;
      const roles = Array.isArray(avail?.roles) ? avail?.roles.join(' / ') : '';

      return (
        <div 
          key={t.id}
          draggable 
          onDragStart={(e) => handleDragStart(e, t)}
          onClick={() => setForm({ ...form, userId: t.id })}
          className={`p-3 rounded-xl border mb-2 cursor-grab active:cursor-grabbing transition-all text-sm group relative flex flex-col shadow-sm
            ${form.userId === t.id ? 'ring-2 ring-indigo-50 bg-indigo-50 border-indigo-500' : 'bg-white hover:bg-gray-50 border-slate-200'}
            ${assignedCount > 0 ? 'opacity-70 bg-gray-50' : ''}
          `}
        >
          <div className="flex justify-between items-center w-full">
            <div className="flex items-center gap-2">
              <GripVertical size={14} className="text-gray-300" />
              <div>
                <span className="font-bold text-slate-700 block">{teacherNameOf(t)}</span>
              </div>
            </div>
            {type === 'available' && <CheckCircle size={16} className="text-green-500" />}
            {type === 'maybe' && <HelpCircle size={16} className="text-yellow-500" />}
            {isImpossible && <span className="text-[10px] font-bold text-red-500 bg-red-50 px-2 py-0.5 rounded">不可</span>}
          </div>
          
          <div className="pl-6 mt-1.5 flex flex-wrap gap-2 items-center w-full">
             {avail && (
               <div className="text-[11px] font-bold text-indigo-600 bg-indigo-50 px-2 py-1 rounded border border-indigo-100 w-full truncate">
                 <span className="text-indigo-400 mr-1 text-[9px] uppercase">SHIFT:</span>
                 {[workplace, avail.time_range, roles || avail.note].filter(Boolean).join(' / ')}
               </div>
             )}
             {assignedCount > 0 && (
               <span className="text-[9px] text-white bg-green-500 px-1.5 py-0.5 rounded-full">配置済: {assignedCount}</span>
             )}
          </div>
        </div>
      );
    });
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
            <button
              onClick={relinkShiftTeachers}
              disabled={relinking}
              className="text-xs font-bold text-rose-600 hover:bg-rose-50 px-4 py-2 rounded-lg transition-colors flex items-center gap-2 border border-rose-100 disabled:opacity-50"
            >
              {relinking ? <Loader2 size={14} className="animate-spin" /> : <Settings size={14}/>} 紐付け再照合
            </button>
            <Link href="/master/settings" className="text-xs font-bold text-indigo-600 hover:bg-indigo-50 px-4 py-2 rounded-lg transition-colors flex items-center gap-2 border border-indigo-100">
              <LinkIcon size={14}/> URL設定
            </Link>
            <div className="flex items-center gap-2 bg-slate-100 p-1.5 rounded-xl border border-slate-200">
              <input type="date" className="font-bold bg-transparent outline-none text-slate-700 cursor-pointer text-sm px-2" value={date} onChange={e => setDate(e.target.value)} />
              <span className="text-xs font-black bg-indigo-600 text-white px-3 py-1.5 rounded-lg">{dayOfWeek}曜日</span>
            </div>
          </div>
        </div>

        {unassignedSubmittedTeachers.length > 0 && (
          <div className="mb-4 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-amber-900 shadow-sm">
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div className="flex items-start gap-3">
                <AlertTriangle size={20} className="mt-0.5 text-amber-600 shrink-0" />
                <div>
                  <p className="text-sm font-black">シフト提出済みで、まだ配置されていない先生がいます</p>
                  <p className="mt-1 text-xs font-bold text-amber-800">
                    {unassignedSubmittedTeachers.map(teacherNameOf).slice(0, 8).join('、')}
                    {unassignedSubmittedTeachers.length > 8 ? ` ほか${unassignedSubmittedTeachers.length - 8}名` : ''}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2 rounded-xl bg-white/70 px-3 py-2 text-xs font-bold text-amber-800">
                <Bell size={14} />
                管理者通知 {unassignedNotice?.notified ?? 0}件
              </div>
            </div>
          </div>
        )}

        <div className="mb-6 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="flex items-center gap-2 text-sm font-black text-slate-800">
              <CheckCircle size={16} className="text-emerald-600" /> 本日のシフト提出者一覧
            </h2>
            <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-black text-slate-500">
              {submittedTeachers.length}名提出 / 未配置 {unassignedSubmittedTeachers.length}名
            </span>
          </div>
          {submittedTeachers.length > 0 ? (
            <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
              {submittedTeachers.map(teacher => {
                const teacherAvailabilities = availabilitiesByTeacher.get(teacher.id) || [];
                const assignedCount = assignments.filter(a => a.user_id === teacher.id).length;
                return (
                  <div key={teacher.id} className={`rounded-xl border p-3 ${assignedCount > 0 ? 'border-emerald-100 bg-emerald-50/40' : 'border-amber-200 bg-amber-50/70'}`}>
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-sm font-black text-slate-800">{teacherNameOf(teacher)}</p>
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-black ${assignedCount > 0 ? 'bg-emerald-600 text-white' : 'bg-amber-500 text-white'}`}>
                        {assignedCount > 0 ? `配置済 ${assignedCount}` : '未配置'}
                      </span>
                    </div>
                    <div className="mt-2 space-y-1">
                      {teacherAvailabilities.map(availability => (
                        <div key={availability.id} className="flex flex-wrap gap-2 text-[11px] font-bold text-slate-600">
                          <span className="flex items-center gap-1 rounded bg-white px-2 py-1"><MapPin size={11} className="text-slate-400" />{availability.workplace || availability.location || '勤務地未設定'}</span>
                          <span className="flex items-center gap-1 rounded bg-white px-2 py-1"><Clock size={11} className="text-slate-400" />{availability.time_range || '時間未設定'}</span>
                          <span className="rounded bg-white px-2 py-1">{Array.isArray(availability.roles) && availability.roles.length ? availability.roles.join(' / ') : availability.note || '希望未設定'}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="rounded-xl border-2 border-dashed border-slate-100 py-6 text-center text-xs font-bold text-slate-400">
              この日付のシフト提出はまだありません
            </div>
          )}
        </div>

        <div className="flex flex-col lg:flex-row gap-6 items-start">
          <div className="w-full lg:w-[320px] flex flex-col gap-6 shrink-0 h-[calc(100vh-200px)] overflow-y-auto custom-scrollbar pr-2">
            <div className="bg-white p-4 rounded-2xl shadow-sm border border-indigo-100 shrink-0">
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-bold text-slate-700 text-xs flex gap-2 items-center">
                  <Save size={16} className="text-indigo-600"/> 新規クラス作成
                </h3>
              </div>
              <div className="space-y-3">
                <div className={`p-2 rounded text-center font-bold text-xs border ${form.userId ? 'bg-indigo-50 border-indigo-300 text-indigo-700' : 'bg-gray-50 text-gray-400 border-dashed'}`}>
                  {form.userId ? teacherNameOf(allTeachers.find(t => t.id === form.userId)) : "先生を選択してください"}
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <select className="w-full p-2 border rounded text-xs" value={form.time_slot} onChange={e => setForm({...form, time_slot: e.target.value})}>
                    <option>1限</option><option>2限</option>
                  </select>
                  <select className="w-full p-2 border rounded text-xs" value={form.role} onChange={e => setForm({...form, role: e.target.value})}>
                    <option value="main">メイン</option>
                    <option value="general">全体</option>
                  </select>
                </div>
                {form.role === 'main' && (
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <select className="border rounded p-1" value={form.grade} onChange={e => setForm({...form, grade: e.target.value})}><option>中1</option><option>中2</option><option>中3</option></select>
                    <select className="border rounded p-1" value={form.subject} onChange={e => setForm({...form, subject: e.target.value})}><option>理科</option><option>社会</option></select>
                    <input className="border rounded p-1 col-span-2" placeholder="詳細科目" value={form.detail_subject} onChange={e => setForm({...form, detail_subject: e.target.value})}/>
                  </div>
                )}
                <button onClick={handleManualAssign} className="w-full bg-indigo-600 text-white text-xs font-bold py-2 rounded hover:bg-indigo-700">配置</button>
              </div>
            </div>

            <div className="space-y-4">
              <div>
                <h3 className="text-xs font-bold text-green-700 bg-green-50 px-3 py-2 rounded-lg mb-2 flex items-center gap-2">
                  <CheckCircle size={14}/> 出勤可能 (シフト提出済)
                </h3>
                <div className="space-y-1">
                  {renderTeacherList(groupedTeachers.available, 'available')}
                </div>
              </div>

              <div>
                <h3 className="text-xs font-bold text-yellow-700 bg-yellow-50 px-3 py-2 rounded-lg mb-2 flex items-center gap-2">
                  <HelpCircle size={14}/> 調整可能
                </h3>
                <div className="space-y-1">
                  {renderTeacherList(groupedTeachers.maybe, 'maybe')}
                </div>
              </div>

              <div>
                <h3 className="text-xs font-bold text-gray-500 bg-gray-100 px-3 py-2 rounded-lg mb-2 flex items-center gap-2">
                  <User size={14}/> その他 / 未提出
                </h3>
                <div className="space-y-1 opacity-80">
                  {renderTeacherList(groupedTeachers.others, 'others')}
                </div>
              </div>
            </div>
          </div>

          <div className="flex-1 space-y-8 min-w-0">
            {['1限', '2限'].map((period) => (
              <div key={period} className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
                <div className={`px-4 py-2 flex items-center justify-between shrink-0 ${period === '1限' ? 'bg-slate-800 text-white' : 'bg-slate-700 text-slate-100'}`}>
                  <div className="flex items-center gap-2 font-bold text-sm">
                    <Clock size={16} className={period === '1限' ? 'text-blue-400' : 'text-indigo-400'}/>
                    {period} <span className="opacity-60 font-mono text-xs font-normal ml-1">{period === '1限' ? '19:20 - 20:25' : '20:35 - 21:40'}</span>
                  </div>
                  <div className="flex gap-2 text-[10px] font-bold">
                    <span className="bg-emerald-500/20 px-2 py-0.5 rounded text-emerald-100">理 {getAllClassesForSubject(period, '理科').length}</span>
                    <span className="bg-orange-500/20 px-2 py-0.5 rounded text-orange-100">社 {getAllClassesForSubject(period, '社会').length}</span>
                  </div>
                </div>

                <div className="overflow-x-auto custom-scrollbar p-3 bg-slate-50/50">
                  <div className="flex gap-4 min-w-max items-start">
                    
                    <div className="flex flex-col gap-2 min-w-[220px] shrink-0">
                      <div className="flex items-center gap-1 text-[10px] font-bold text-emerald-700 border-b border-emerald-100 pb-1 mb-1">
                        <Users size={12}/> 理科グループ
                      </div>
                      <div className="flex gap-2">
                        {getAllClassesForSubject(period, '理科').map(info => (
                           <ClassCard 
                             key={info.id} 
                             info={info} 
                             allTeachers={allTeachers}
                             onDelete={handleDelete}
                             onEdit={setEditingShift}
                             onShowResults={handleShowSurveyResults}
                             onDragOver={handleDragOver}
                             onDragLeave={handleDragLeave}
                             onDrop={(e: any, t: any, z: any) => handleDrop(e, t, z, period)}
                             dragOverCardId={dragOverCardId}
                             dragOverZone={dragOverZone}
                           />
                        ))}
                      </div>
                    </div>

                    <div className="w-px bg-slate-200 self-stretch my-2"></div>

                    <div className="flex flex-col gap-2 min-w-[220px] shrink-0">
                      <div className="flex items-center gap-1 text-[10px] font-bold text-orange-700 border-b border-orange-100 pb-1 mb-1">
                        <Users size={12}/> 社会グループ
                      </div>
                      <div className="flex gap-2">
                        {getAllClassesForSubject(period, '社会').map(info => (
                           <ClassCard 
                             key={info.id} 
                             info={info} 
                             allTeachers={allTeachers}
                             onDelete={handleDelete}
                             onEdit={setEditingShift}
                             onShowResults={handleShowSurveyResults}
                             onDragOver={handleDragOver}
                             onDragLeave={handleDragLeave}
                             onDrop={(e: any, t: any, z: any) => handleDrop(e, t, z, period)}
                             dragOverCardId={dragOverCardId}
                             dragOverZone={dragOverZone}
                           />
                        ))}
                      </div>
                    </div>

                    <div className="w-px bg-slate-200 self-stretch my-2"></div>

                    <div className="flex flex-col gap-1 ml-1 shrink-0">
                      <div 
                        className={`bg-slate-100 rounded-xl p-2 border border-slate-200 w-[200px] min-h-[140px] flex flex-col transition-all duration-200
                          ${dragOverCardId === `general-${period}` ? 'bg-indigo-50 border-indigo-300 ring-2 ring-indigo-100 shadow-md' : ''}
                        `}
                        onDragOver={(e) => handleDragOver(e, `general-${period}`, 'general')}
                        onDragLeave={handleDragLeave}
                        onDrop={(e) => handleDrop(e, null, 'general', period)}
                      >
                        <div className="text-[10px] font-bold text-slate-400 mb-2 flex items-center gap-1 uppercase tracking-wider shrink-0">
                          <User size={12}/> General Support
                        </div>
                        
                        <div className="flex flex-col gap-2 flex-1 overflow-y-auto custom-scrollbar">
                          {getGeneralSupport(period).map(a => (
                            <div key={a.id} className="w-full bg-white border border-slate-200 rounded-lg p-2 flex items-center justify-between shadow-sm">
                              <div className="flex items-center gap-2 min-w-0">
                                <div className="w-6 h-6 rounded-full bg-slate-100 flex items-center justify-center text-slate-400 shrink-0"><User size={12}/></div>
                                <div className="min-w-0">
                                  <button onClick={(e) => handleShowSurveyResults(e, a.user_id, a.teacher_name)} className="font-bold text-slate-700 text-xs hover:underline truncate block">{a.teacher_name}</button>
                                </div>
                              </div>
                              <button onClick={() => handleDelete(a.id)} className="text-slate-300 hover:text-red-500"><Trash2 size={12}/></button>
                            </div>
                          ))}
                          {getGeneralSupport(period).length === 0 && (
                            <div className="flex-1 flex items-center justify-center text-[10px] text-slate-300 font-bold border-2 border-dashed border-slate-200 rounded-lg">
                              ドラッグして追加
                            </div>
                          )}
                        </div>
                      </div>
                    </div>

                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {editingShift && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl w-full max-w-lg shadow-xl overflow-hidden animate-in fade-in zoom-in-95 duration-200">
            <div className="bg-slate-800 text-white p-4 flex justify-between items-center">
              <h2 className="font-bold flex items-center gap-2">シフト編集</h2>
              <button onClick={() => setEditingShift(null)}><X size={20}/></button>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="text-xs font-bold text-gray-500">勤務地</label>
                <select
                  className="w-full p-2 border rounded mt-1 bg-white"
                  value={editingShift.target_place || ''}
                  onChange={e => setEditingShift({...editingShift, target_place: e.target.value})}
                >
                  <option value="">未設定</option>
                  {WORK_LOCATIONS.map(location => <option key={location} value={location}>{location}</option>)}
                  {editingShift.target_place && !WORK_LOCATIONS.includes(editingShift.target_place) && (
                    <option value={editingShift.target_place}>{editingShift.target_place}</option>
                  )}
                </select>
              </div>
              <div>
                <label className="text-xs font-bold text-gray-500">単元</label>
                <input className="w-full p-2 border rounded mt-1" value={editingShift.unit || ''} onChange={e => setEditingShift({...editingShift, unit: e.target.value})}/>
              </div>
              <div>
                <label className="text-xs font-bold text-gray-500">Zoomサインインアドレス</label>
                <input className="w-full p-2 border rounded mt-1 font-mono" value={editingShift.target_signin_address || ''} onChange={e => setEditingShift({...editingShift, target_signin_address: e.target.value})} placeholder="abc@sozogakuen.co.jp"/>
              </div>
              
              <div>
                <label className="text-xs font-bold text-gray-500 flex justify-between items-center">
                  <span>Zoom ID (ミーティングID)</span>
                  <button 
                    onClick={handleManualZoomCreate} 
                    disabled={creatingZoom || !!editingShift.target_meeting_id}
                    className={`text-[10px] flex items-center gap-1 px-2 py-1 rounded transition-colors ${editingShift.target_meeting_id ? 'bg-green-100 text-green-700 cursor-default' : 'bg-blue-100 text-blue-700 hover:bg-blue-200'}`}
                  >
                    {creatingZoom ? <Loader2 size={10} className="animate-spin"/> : <Zap size={10}/>}
                    {editingShift.target_meeting_id ? '発行済み' : 'Zoom URLを自動発行'}
                  </button>
                </label>
                <input className="w-full p-2 border rounded mt-1 font-mono" value={editingShift.target_meeting_id || ''} onChange={e => setEditingShift({...editingShift, target_meeting_id: e.target.value})} placeholder="123 456 7890"/>
                {editingShift.start_url && (
                  <p className="text-[10px] text-green-600 mt-1 flex items-center gap-1">
                    <CheckCircle size={10}/> ホストURL発行済み
                  </p>
                )}
              </div>

              <div className="rounded-xl border border-violet-100 bg-violet-50 p-3">
                <label className="flex items-center gap-2 text-xs font-black text-violet-900">
                  <KeyRound size={14} className="text-violet-600" /> Zoomパスコード
                </label>
                <p className="mt-1 text-[11px] font-medium leading-relaxed text-violet-700">
                  Zoomの会議設定と生徒・講師の参加リンクを同じパスコードに更新します。
                </p>
                <div className="mt-2 flex flex-col gap-2 sm:flex-row">
                  <input
                    type="text"
                    autoComplete="new-password"
                    maxLength={10}
                    className="min-w-0 flex-1 rounded-lg border border-violet-200 bg-white p-2 font-mono tracking-wider outline-none focus:border-violet-500"
                    value={editingShift.target_password || ''}
                    onChange={event => setEditingShift({ ...editingShift, target_password: event.target.value.replace(/\s/g, '') })}
                    placeholder="例: Risha2026"
                  />
                  <button
                    type="button"
                    onClick={handleUpdateZoomPasscode}
                    disabled={updatingPasscode || !normalizeMeetingId(editingShift.target_meeting_id)}
                    className="inline-flex shrink-0 items-center justify-center gap-1 rounded-lg bg-violet-600 px-3 py-2 text-xs font-black text-white transition-colors hover:bg-violet-700 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {updatingPasscode ? <Loader2 size={14} className="animate-spin" /> : <KeyRound size={14} />}
                    Zoomに反映して保存
                  </button>
                </div>
              </div>

              <button onClick={handleUpdate} className="w-full bg-blue-600 text-white py-3 rounded-lg font-bold hover:bg-blue-700 shadow mt-4 flex justify-center items-center gap-2"><Save size={18}/> 保存</button>
            </div>
          </div>
        </div>
      )}

      {isSurveyModalOpen && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4 animate-in fade-in duration-200">
          <div className="bg-white rounded-3xl w-full max-w-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
            <div className="bg-slate-800 text-white p-5 shrink-0 flex justify-between items-center">
              <div>
                <h3 className="font-bold text-lg flex items-center gap-2">
                  <BarChart2 size={20}/> アンケート集計
                </h3>
                <p className="text-xs opacity-80 mt-1">
                  対象: <span className="font-bold text-yellow-300 text-sm">{selectedTeacherForResults?.name}</span> 先生
                </p>
              </div>
              <button onClick={() => setIsSurveyModalOpen(false)} className="text-slate-400 hover:text-white transition-colors bg-white/10 p-2 rounded-full"><X size={20}/></button>
            </div>
            
            <div className="p-6 overflow-y-auto custom-scrollbar bg-slate-50 flex-1">
              {surveyLoading ? (
                <div className="flex justify-center py-20"><Loader2 className="animate-spin text-indigo-500" size={30}/></div>
              ) : surveyResults.length === 0 ? (
                <div className="text-center py-20 text-gray-400 font-bold">
                  まだ回答データがありません
                </div>
              ) : (
                <div className="space-y-8">
                  {surveyQuestions.map(q => {
                    if (q.type === 'rating') {
                      const { average, total, data } = calculateRatingStats(q.id);
                      return (
                        <div key={q.id} className="bg-white p-5 rounded-2xl shadow-sm border border-slate-100">
                          <h4 className="font-bold text-slate-800 mb-4 text-sm">{q.text}</h4>
                          <div className="flex items-center justify-between mb-4">
                            <div>
                              <span className="text-3xl font-black text-indigo-600">{average}</span>
                              <span className="text-xs text-slate-400 ml-1">/ 5.0</span>
                            </div>
                            <span className="text-xs font-bold bg-slate-100 text-slate-500 px-2 py-1 rounded">回答数: {total}</span>
                          </div>
                          <div className="h-32 w-full">
                            <ResponsiveContainer width="100%" height="100%">
                              <BarChart data={data} layout="vertical" margin={{ top: 0, right: 30, left: 0, bottom: 0 }}>
                                <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                                <XAxis type="number" hide />
                                <YAxis dataKey="name" type="category" width={20} tick={{fontSize: 10, fontWeight: 'bold'}} />
                                <Tooltip cursor={{fill: 'transparent'}} />
                                <Bar dataKey="count" radius={[0, 4, 4, 0]} barSize={12}>
                                  {data.map((entry, index) => (
                                    <Cell key={`cell-${index}`} fill={entry.fill} />
                                  ))}
                                </Bar>
                              </BarChart>
                            </ResponsiveContainer>
                          </div>
                        </div>
                      );
                    } else {
                      const answers = getTextAnswers(q.id);
                      if (answers.length === 0) return null;
                      return (
                        <div key={q.id} className="bg-white p-5 rounded-2xl shadow-sm border border-slate-100">
                          <h4 className="font-bold text-slate-800 mb-3 text-sm">{q.text}</h4>
                          <div className="space-y-3 max-h-60 overflow-y-auto custom-scrollbar pr-2">
                            {answers.map((a: any) => (
                              <div key={a.id} className="bg-slate-50 p-3 rounded-xl text-xs">
                                <p className="text-slate-700 leading-relaxed mb-2">{a.text}</p>
                                <div className="flex justify-between text-[10px] text-slate-400 border-t border-slate-200 pt-2">
                                  <span>{a.date}</span>
                                  <span>{a.subject}</span>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      );
                    }
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ClassCard (DnD対応・管理者向け・デザイン統一)
function ClassCard({ info, allTeachers, onDelete, onEdit, onShowResults, onDragOver, onDragLeave, onDrop, dragOverCardId, dragOverZone }: any) {
  const [loading, setLoading] = useState(false);
  const isTarget = dragOverCardId === info.id;
  const isEmerald = info.subject === '理科';

  const loginEmail = info.main?.target_signin_address?.trim();
  const hasHostPermission = !!loginEmail && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(loginEmail);
  const displayLoginId = loginEmail ? loginEmail.split('@')[0] : '';

  // 管理者画面なので、名前の指定はそのクラスの担当講師名を使う
  const teacherName = info.main?.teacher_name || '';
  const surname = teacherName.split(/[\s　]+/)[0];

  const theme = isEmerald ? {
    border: 'border-emerald-100',
    headerBg: 'bg-emerald-600',
    headerText: 'text-white',
    badge: 'bg-white/20 text-white',
    iconBg: 'bg-emerald-500',
    activeRing: 'ring-2 ring-emerald-400',
    btn: hasHostPermission ? 'bg-rose-600 hover:bg-rose-700 text-white shadow-rose-200' : 'bg-emerald-600 hover:bg-emerald-700 text-white shadow-emerald-200',
  } : {
    border: 'border-orange-100',
    headerBg: 'bg-orange-500',
    headerText: 'text-white',
    badge: 'bg-white/20 text-white',
    iconBg: 'bg-orange-500',
    activeRing: 'ring-2 ring-orange-400',
    btn: hasHostPermission ? 'bg-rose-600 hover:bg-rose-700 text-white shadow-rose-200' : 'bg-orange-500 hover:bg-orange-600 text-white shadow-orange-200',
  };

  const confno = normalizeMeetingId(info.main?.target_meeting_id) || normalizeMeetingId(info.main?.start_url ? info.main.start_url.split('/').pop()?.split('?')[0] : '');

  const launchWebUrl = (url: string, targetWindow?: Window | null) => {
    if (targetWindow && !targetWindow.closed) {
      targetWindow.location.href = url;
      return;
    }
    window.open(url, '_blank');
  };
  // 管理者用ホスト開始ロジック (先生画面と同じ)
  const handleEnterZoom = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    if (!confno) {
      alert("ミーティングIDが設定されていません。");
      return;
    }

    if (hasHostPermission) {
      if(!confirm(`「${teacherName}」先生としてホストを開始しますか？\n(ログインID: ${loginEmail})`)) return;

      const popup = window.open('', '_blank');
      if (popup) {
        popup.document.write('<p style="font-family: sans-serif; padding: 24px;">Zoomホスト開始を準備しています...</p>');
      }
      setLoading(true);
      try {
        const currentUser = auth.currentUser;
        if (!currentUser) throw new Error('not-authenticated');
        const token = await currentUser.getIdToken();
        
        const res = await fetch('/api/get-zoom-zak', { 
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ 
            email: loginEmail,
            meetingId: confno,
            shiftId: info.main?.id || info.id,
            name: surname // 担当講師の苗字で名前書き換え
          }) 
        });
        const data = await res.json();
        
        if (data.success && (data.zak || data.start_url)) {
          const displayName = surname || teacherName || '講師';
          const webUrl = data.start_url || `https://zoom.us/s/${confno}?zak=${encodeURIComponent(data.zak)}&uname=${encodeURIComponent(displayName)}`;
          const appUrl = data.app_start_url || (data.zak ? `zoommtg://zoom.us/start?confno=${confno}&zak=${encodeURIComponent(data.zak)}` : '');
          launchWebUrl(webUrl || appUrl, popup);
        } else {
          if (popup && !popup.closed) popup.close();
          console.error("API Error:", data);
          alert(`ホスト権限の取得に失敗しました。\n\n理由: ${data.error}${data.detail ? `\n詳細: ${data.detail}` : ''}`);
          if(confirm("通常参加で開きますか？")) {
             launchWebUrl(info.url || `https://zoom.us/j/${confno}`);
          }
        }
      } catch (err) {
        if (popup && !popup.closed) popup.close();
        console.error(err);
        alert('通信エラーが発生しました。');
      } finally {
        setLoading(false);
      }
    } else {
      // 通常参加
      let targetUrl = info.url || `zoommtg://zoom.us/join?confno=${confno}`;
      if (info.url) {
        try {
          const urlObj = new URL(info.url);
          const pwd = urlObj.searchParams.get('pwd');
          // 通常参加でも名前を指定してあげる
          const zoomDisplayName = surname ? `講師：${surname}` : '講師';
          targetUrl = `https://zoom.us/j/${confno}?pwd=${pwd || ''}&uname=${encodeURIComponent(zoomDisplayName)}`;
        } catch (e) {}
      }
      launchWebUrl(targetUrl);
    }
  };
  
  return (
    <div 
      className={`w-[180px] bg-white border ${theme.border} rounded-xl shadow-sm flex flex-col overflow-hidden relative group hover:shadow-md transition-all shrink-0
        ${isTarget ? `${theme.activeRing} scale-[1.02] z-10` : ''}
      `}
    >
      {/* ヘッダー (先生画面に合わせてデザイン統一) */}
      <div className={`${theme.headerBg} px-3 py-2 relative`}>
        <div className="flex justify-between items-start mb-1">
          <span className={`text-[10px] font-black px-2 py-0.5 rounded-md ${theme.badge} whitespace-nowrap`}>
            {info.grade}/{info.place}
          </span>
          {/* 編集・削除ボタンは管理者のみ */}
          {info.main && (
            <div className="flex gap-1">
              <button onClick={() => onEdit(info.main)} className="text-white/70 hover:text-white transition-colors"><Settings size={12}/></button>
              <button onClick={() => onDelete(info.main!.id)} className="text-white/70 hover:text-white transition-colors"><Trash2 size={12}/></button>
            </div>
          )}
        </div>
        <div className={`text-xs font-bold ${theme.headerText} line-clamp-1`}>
          {info.unit || <span className="opacity-60 font-normal">単元未設定</span>}
        </div>
        
        {/* スタジオ名表示 */}
        {info.studio && (
          <div className="flex items-center gap-0.5 text-[9px] bg-black/20 px-1.5 py-0.5 rounded text-white/90 font-bold whitespace-nowrap mt-1 w-max">
            <MapPin size={9}/> {info.studio}
          </div>
        )}
      </div>

      <div className="flex-1 flex flex-col">
        {/* メイン講師エリア */}
        <div 
          className={`p-2 transition-colors ${isTarget && dragOverZone === 'main' ? 'bg-indigo-50' : 'bg-white'}`}
          onDragOver={(e) => onDragOver(e, info.id, 'main')}
          onDragLeave={onDragLeave}
          onDrop={(e) => onDrop(e, info.main, 'main')}
        >
          <div className="flex items-start gap-2">
            <div className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 ${theme.iconBg} text-white shadow-sm`}>
              <User size={14}/>
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-[8px] text-gray-400 font-bold uppercase tracking-wider mb-0.5">Main</div>
              <button 
                onClick={(e) => info.main?.user_id && onShowResults(e, info.main.user_id, info.main.teacher_name)}
                className="font-bold text-slate-800 text-xs hover:text-indigo-600 hover:underline decoration-indigo-300 text-left flex items-center gap-1 group/link w-full"
              >
                <span className="truncate">{info.main?.teacher_name || '未定'}</span>
                {info.main?.teacher_name && <BarChart2 size={10} className="text-slate-300 group-hover/link:text-indigo-500 shrink-0"/>}
              </button>
              
              {/* ログインID表示 & ボタン (先生画面のロジックを移植) */}
              {displayLoginId ? (
                <button 
                  type="button"
                  onClick={handleEnterZoom}
                  disabled={loading}
                  className={`flex items-center gap-1 text-[8px] font-mono mt-0.5 border rounded px-1 transition-all cursor-pointer group w-full justify-between h-[18px] ${
                    hasHostPermission 
                      ? 'bg-rose-50 border-rose-200 text-rose-700 hover:bg-rose-100' 
                      : 'bg-slate-50 border-slate-100 text-slate-500 hover:bg-slate-100'
                  }`}
                  title={`ログインID: ${loginEmail}`}
                >
                  <div className="flex items-center gap-1 min-w-0">
                    <KeyRound size={8} className="shrink-0 opacity-70"/>
                    <span className="truncate">{displayLoginId}</span>
                  </div>
                  {loading ? <Loader2 size={6} className="animate-spin"/> : <Zap size={6} className={hasHostPermission ? "text-rose-500" : "text-slate-400"}/>}
                </button>
              ) : (
                <div className="h-[18px] text-[8px] text-slate-300 flex items-center pl-1 border border-transparent">ID未登録</div> 
              )}
            </div>
          </div>
        </div>

        {/* サポート講師エリア */}
        <div 
          className={`px-2 py-1.5 border-t border-slate-100 min-h-[50px] transition-colors ${isTarget && dragOverZone === 'sub' ? 'bg-indigo-50' : 'bg-slate-50/50'}`}
          onDragOver={(e) => onDragOver(e, info.id, 'sub')}
          onDragLeave={onDragLeave}
          onDrop={(e) => onDrop(e, info.main, 'sub')}
        >
          <span className="text-[8px] text-slate-400 font-bold uppercase tracking-wider block mb-1">Sub (Drop)</span>
          <div className="space-y-1">
            {info.subs.map((sub: any) => (
              <div key={sub.id} className="flex justify-between items-center text-[10px]">
                <div className="min-w-0 flex flex-col">
                  <button
                    onClick={(e) => onShowResults(e, sub.user_id, sub.teacher_name)} 
                    className="text-slate-600 font-medium flex items-center gap-1 hover:text-indigo-600 hover:underline"
                  >
                    <div className="w-1 h-1 rounded-full bg-slate-300 shrink-0"></div> {sub.teacher_name}
                  </button>
                </div>
                <button onClick={() => onDelete(sub.id)} className="text-slate-300 hover:text-red-500 shrink-0 ml-1"><Trash2 size={10}/></button>
              </div>
            ))}
            {info.subs.length === 0 && <div className="text-[9px] text-slate-300 pl-1">-</div>}
          </div>
        </div>

        {/* Zoomボタン */}
        <div className="mt-auto p-2 bg-white border-t border-slate-100">
          {confno ? (
            <button 
              type="button" 
              onClick={handleEnterZoom}
              disabled={loading}
              className={`w-full ${theme.btn} shadow-sm text-[10px] font-bold py-1.5 rounded-lg flex items-center justify-center gap-1 transition-transform active:scale-95`}
            >
              {loading ? <Loader2 size={10} className="animate-spin"/> : hasHostPermission ? <Zap size={10}/> : <Video size={10}/>}
              {loading ? '準備中...' : (hasHostPermission ? 'ホスト開始' : '入室')}
            </button>
          ) : (
            <div className="w-full bg-slate-100 text-slate-400 text-[10px] font-bold py-1.5 rounded-lg flex items-center justify-center gap-1 cursor-not-allowed">
              <Video size={12}/> -
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
