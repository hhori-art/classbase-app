'use client';

import { useState, useEffect, useMemo } from 'react';
import { db } from '@/lib/firebase';
import { collection, query, orderBy, getDocs, doc, updateDoc, where, deleteDoc, limit, writeBatch, addDoc } from 'firebase/firestore';
import { 
  Briefcase, ArrowLeft, CheckCircle, Edit, Trash2, Search, Filter, Save, X, Plus, Train, Download, 
  Loader2, Clock, Layout, Copy, AlertCircle, ChevronRight, Calendar, User, DollarSign, CheckSquare, FileText, Coffee, Database
} from 'lucide-react';
import Link from 'next/link';
import { useAuth } from '@/app/context/AuthContext';

// 型定義
interface WorkSegment {
  start: string;
  end: string;
  type: 'lesson' | 'office' | 'support' | 'break'; 
  note: string;
  isAuto?: boolean;
}

interface Transportation {
  from: string;
  to: string;
  cost: number | string;
}

interface UserInfo {
  name: string;
  school_code: string;
  staff_id: string;
}

interface CorrectionRequest {
  id: string;
  work_record_id: string;
  teacher_id: string;
  requested_start_time?: string | null;
  requested_end_time?: string | null;
  reason?: string;
  status: string;
  created_at?: any;
}

export default function MasterAttendancePage() {
  const { user: authUser } = useAuth();
  const [records, setRecords] = useState<any[]>([]);
  const [usersMap, setUsersMap] = useState<{[key:string]: UserInfo}>({}); 
  const [loading, setLoading] = useState(true);
  const [filterMonth, setFilterMonth] = useState(new Date().toISOString().slice(0, 7));
  const [filterName, setFilterName] = useState('');
  const [showOnlyPending, setShowOnlyPending] = useState(false);
  const [isCsvGenerating, setIsCsvGenerating] = useState(false);
  const [correctionRequests, setCorrectionRequests] = useState<CorrectionRequest[]>([]);
  const [processingCorrectionId, setProcessingCorrectionId] = useState('');

  const [filterDate, setFilterDate] = useState('');
  const [newRecordSearch, setNewRecordSearch] = useState('');

  const [editingRecord, setEditingRecord] = useState<any>(null);
  const [segments, setSegments] = useState<WorkSegment[]>([]);
  const [expenses, setExpenses] = useState<Transportation[]>([]);
  const [mainTime, setMainTime] = useState({ start: '', end: '' });

  // 一括操作用のステート
  const [selectedRecordIds, setSelectedRecordIds] = useState<Set<string>>(new Set());
  const [isBulkProcessing, setIsBulkProcessing] = useState(false);

  // 新規作成用のステート
  const [isNewRecordModalOpen, setIsNewRecordModalOpen] = useState(false);
  const [newRecordData, setNewRecordData] = useState({ teacher_id: '', date: new Date().toISOString().slice(0, 10) });

  useEffect(() => {
    fetchUsers();
  }, []);

  useEffect(() => {
    fetchRecords();
    fetchCorrectionRequests();
    setSelectedRecordIds(new Set()); // 月が切り替わったら選択をリセット
  }, [filterMonth]);

  const fetchUsers = async () => {
    try {
      // ★ 修正: teacher権限のアカウントのみ取得する
      const q = query(collection(db, 'users'), where('role', '==', 'teacher'));
      const snap = await getDocs(q);
      const map: {[key:string]: UserInfo} = {};
      
      snap.forEach(doc => {
        const d = doc.data();
        map[doc.id] = {
          name: d.student_name || d.name || d.displayName || '名称未設定',
          school_code: d.school_code || d.schoolCode || d.school_id || d.school_number || '999',
          staff_id: d.lifetime_id || d.staff_id || d.staffId || d.employee_id || d.employeeId || d.teacher_code || '9999'
        };
      });
      setUsersMap(map);
    } catch (e) { console.error("Users fetch error:", e); }
  };

  const fetchRecords = async () => {
    setLoading(true);
    try {
      const [y, m] = filterMonth.split('-').map(Number);
      const lastDay = new Date(y, m, 0).getDate();
      const start = `${filterMonth}-01`;
      const end = `${filterMonth}-${lastDay}`;

      const q = query(
        collection(db, 'work_records'), 
        where('date', '>=', start), 
        where('date', '<=', end), 
        orderBy('date', 'desc'), 
        orderBy('start_time', 'desc')
      );
      const snap = await getDocs(q);
      setRecords(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    } catch (e) {
      console.error("Fetch fallback:", e);
      const q2 = query(collection(db, 'work_records'), orderBy('created_at', 'desc'));
      const snap2 = await getDocs(q2);
      setRecords(snap2.docs.map(d => ({ id: d.id, ...d.data() })).filter((r: any) => r.date && r.date.startsWith(filterMonth)));
    } finally {
      setLoading(false);
    }
  };

  const fetchCorrectionRequests = async () => {
    try {
      const q = query(collection(db, 'attendance_correction_requests'), orderBy('created_at', 'desc'), limit(30));
      const snap = await getDocs(q);
      setCorrectionRequests(snap.docs.map(d => ({ id: d.id, ...d.data() } as CorrectionRequest)));
    } catch (e) {
      console.warn('Correction requests fetch error:', e);
      setCorrectionRequests([]);
    }
  };

  const handleCorrectionReview = async (requestId: string, status: 'approved' | 'rejected') => {
    const label = status === 'approved' ? '承認' : '却下';
    if (!confirm(`この打刻修正依頼を${label}しますか？`)) return;

    setProcessingCorrectionId(requestId);
    try {
      const token = await authUser?.getIdToken();
      if (!token) throw new Error('ログイン情報を確認できません。再ログインしてください。');
      const res = await fetch('/api/attendance-corrections', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ action: 'review', request_id: requestId, status }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.ok === false) {
        const message = data.error === 'work_record_id is missing on correction request'
          ? '対象の勤務記録が見つかりません。この依頼は古い形式か壊れているため、勤務記録から再申請してください。'
          : data.error || 'failed';
        throw new Error(message);
      }
      await fetchCorrectionRequests();
      await fetchRecords();
    } catch (e: any) {
      alert(`修正依頼の${label}に失敗しました: ${e.message || e}`);
    } finally {
      setProcessingCorrectionId('');
    }
  };

  // --- 一括操作関数 ---
  const handleSelectAll = (checked: boolean) => {
    if (checked) {
      setSelectedRecordIds(new Set(filteredRecords.map(r => r.id)));
    } else {
      setSelectedRecordIds(new Set());
    }
  };

  const handleSelectOne = (id: string, checked: boolean) => {
    const next = new Set(selectedRecordIds);
    if (checked) next.add(id);
    else next.delete(id);
    setSelectedRecordIds(next);
  };

  const handleBulkApprove = async () => {
    if (selectedRecordIds.size === 0) return;
    if (!confirm(`${selectedRecordIds.size}件の記録を一括承認しますか？`)) return;
    
    setIsBulkProcessing(true);
    try {
      const batch = writeBatch(db);
      selectedRecordIds.forEach(id => {
        batch.update(doc(db, 'work_records', id), { status: 'approved' });
      });
      await batch.commit();
      setRecords(prev => prev.map(r => selectedRecordIds.has(r.id) ? { ...r, status: 'approved' } : r));
      setSelectedRecordIds(new Set());
    } catch (e: any) {
      alert('承認エラー: ' + e.message);
    } finally {
      setIsBulkProcessing(false);
    }
  };

  const handleBulkDelete = async () => {
    if (selectedRecordIds.size === 0) return;
    if (!confirm(`${selectedRecordIds.size}件の記録を本当に削除しますか？\nこの操作は取り消せません。`)) return;
    
    setIsBulkProcessing(true);
    try {
      const batch = writeBatch(db);
      selectedRecordIds.forEach(id => {
        batch.delete(doc(db, 'work_records', id));
      });
      await batch.commit();
      setRecords(prev => prev.filter(r => !selectedRecordIds.has(r.id)));
      setSelectedRecordIds(new Set());
    } catch (e: any) {
      alert('削除エラー: ' + e.message);
    } finally {
      setIsBulkProcessing(false);
    }
  };

  // --- 単体操作関数 ---
  const handleApprove = async (id: string) => {
    if (!confirm('承認しますか？')) return;
    try {
      await updateDoc(doc(db, 'work_records', id), { status: 'approved' });
      setRecords(prev => prev.map(r => r.id === id ? { ...r, status: 'approved' } : r));
    } catch (e) { alert('承認エラー'); }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('本当に削除しますか？この操作は取り消せません。')) return;
    try {
      await deleteDoc(doc(db, 'work_records', id));
      setRecords(prev => prev.filter(r => r.id !== id));
      setSelectedRecordIds(prev => { const n = new Set(prev); n.delete(id); return n; });
    } catch (e) { alert('削除エラー'); }
  };

  const openEditor = (rec: any) => {
    setEditingRecord(rec);
    const toLocalISO = (iso: string) => {
      if (!iso) return '';
      const d = new Date(iso);
      const pad = (n: number) => n.toString().padStart(2, '0');
      return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
    };

    setMainTime({ 
      start: toLocalISO(rec.start_time), 
      end: toLocalISO(rec.end_time) 
    });
    
    const sortedSegments = (rec.work_segments || []).sort((a: WorkSegment, b: WorkSegment) => a.start.localeCompare(b.start));
    setSegments(sortedSegments);
    setExpenses(rec.transportation || []);
  };

  const updateSegment = (index: number, field: keyof WorkSegment, value: string) => {
    const newSegs = [...segments];
    const current = { ...newSegs[index] };
    
    if (field === 'type') {
      const prevType = current.type;
      current.type = value as any;
      if (prevType === 'break' && (current.note === '休憩' || current.note.includes('自動'))) current.note = '';
      if (value === 'break' && !current.note) current.note = '休憩';
    } else {
      // @ts-ignore
      current[field] = value;
    }
    newSegs[index] = current;
    setSegments(newSegs);
  };

  const addSegment = () => {
    let nextStart = '';
    if (segments.length > 0) nextStart = segments[segments.length - 1].end;
    setSegments([...segments, { start: nextStart, end: '', type: 'office', note: '' }]);
  };
  const removeSegment = (index: number) => setSegments(segments.filter((_, i) => i !== index));

  const updateExpense = (index: number, field: keyof Transportation, value: string | number) => {
    const newExps = [...expenses];
    newExps[index] = { ...newExps[index], [field]: value };
    setExpenses(newExps);
  };
  const addExpense = () => setExpenses([...expenses, { from: '', to: '', cost: '' }]);
  const removeExpense = (index: number) => setExpenses(expenses.filter((_, i) => i !== index));

  const handleCopyLastTransport = async () => {
    try {
      const q = query(
        collection(db, 'work_records'),
        where('teacher_id', '==', editingRecord.teacher_id),
        orderBy('created_at', 'desc'),
        limit(10)
      );
      const snap = await getDocs(q);
      const lastRecord = snap.docs
        .map(d => d.data())
        .find((d: any) => d.transportation && d.transportation.length > 0 && d.id !== editingRecord.id);

      if (lastRecord && confirm(`この講師の ${lastRecord.date} の交通費情報をコピーしますか？`)) {
        setExpenses(lastRecord.transportation);
      } else if(!lastRecord) { alert('過去の交通費データが見つかりませんでした'); }
    } catch (e) { console.error(e); }
  };

  // ★修正: 打刻時間を5分単位に丸めてから隙間を計算する
  const fillGaps = (currentSegments: WorkSegment[], startTime: string, endTime: string | null) => {
    if (!startTime || !endTime) return currentSegments;
    const toMinutes = (s: string) => {
      if(!s) return -1;
      const [h, m] = s.split(':').map(Number);
      return h * 60 + m;
    };
    const toTimeStr = (m: number) => {
      const h = Math.floor(m / 60);
      const min = m % 60;
      return `${String(h).padStart(2,'0')}:${String(min).padStart(2,'0')}`;
    };

    const shiftStart = new Date(startTime);
    const shiftEnd = new Date(endTime);
    // 出勤時刻は5分単位に「切り上げ」
    const startMin = Math.ceil((shiftStart.getHours() * 60 + shiftStart.getMinutes()) / 5) * 5;
    // 退勤時刻は5分単位に「切り捨て」
    const endMin = Math.floor((shiftEnd.getHours() * 60 + shiftEnd.getMinutes()) / 5) * 5;

    const sorted = [...currentSegments]
      .filter(s => s.start && s.end)
      .sort((a, b) => toMinutes(a.start) - toMinutes(b.start));

    const result: WorkSegment[] = [];
    let cursor = startMin;

    for (const seg of sorted) {
      const segStart = toMinutes(seg.start);
      const segEnd = toMinutes(seg.end);

      if (cursor < segStart) {
        result.push({ 
          start: toTimeStr(cursor), 
          end: toTimeStr(segStart), 
          type: 'break',
          note: '休憩(自動補完)', 
          isAuto: true 
        });
      }
      result.push(seg);
      cursor = Math.max(cursor, segEnd);
    }

    if (cursor < endMin) {
      result.push({ 
        start: toTimeStr(cursor), 
        end: toTimeStr(endMin), 
        type: 'break',
        note: '休憩(自動補完)', 
        isAuto: true 
      });
    }
    return result;
  };

  const saveAll = async () => {
    if (!editingRecord) return;
    try {
      const ref = doc(db, 'work_records', editingRecord.id);
      const newStartISO = mainTime.start ? new Date(mainTime.start).toISOString() : editingRecord.start_time;
      const newEndISO = mainTime.end ? new Date(mainTime.end).toISOString() : null;

      // ★ 修正: 詳細(業務内訳)の入力のみ5分単位であることをチェック
      const isTimeStrMultipleOf5 = (timeStr: string) => {
        if (!timeStr) return true;
        const [, m] = timeStr.split(':').map(Number);
        return m % 5 === 0;
      };

      const toMinutes = (s: string) => {
        if(!s) return -1;
        const [h, m] = s.split(':').map(Number);
        return h * 60 + m;
      };

      for (const seg of segments) {
        if (seg.start && seg.end) {
          if (!isTimeStrMultipleOf5(seg.start) || !isTimeStrMultipleOf5(seg.end)) {
            return alert('【エラー】業務内訳の開始・終了時刻は5分単位（0, 5, 10...）で入力してください。');
          }
        }
      }

      // ★ 修正: 打刻時間を丸めた範囲内に詳細が収まっているか、および開始直後の休憩禁止チェック
      if (newStartISO && newEndISO) {
        const shiftStart = new Date(newStartISO);
        const shiftEnd = new Date(newEndISO);
        // 出勤は切り上げ、退勤は切り捨て
        const startMin = Math.ceil((shiftStart.getHours() * 60 + shiftStart.getMinutes()) / 5) * 5;
        const endMin = Math.floor((shiftEnd.getHours() * 60 + shiftEnd.getMinutes()) / 5) * 5;

        // 範囲チェック
        for (const seg of segments) {
          if (seg.start && seg.end) {
            const sMin = toMinutes(seg.start);
            const eMin = toMinutes(seg.end);
            if (sMin < startMin || eMin > endMin) {
               return alert(`【エラー】業務内訳は打刻時間に基づき「${Math.floor(startMin/60)}:${String(startMin%60).padStart(2,'0')}」から「${Math.floor(endMin/60)}:${String(endMin%60).padStart(2,'0')}」の間で入力してください。`);
            }
          }
        }

        // 最初の業務までの空白チェック＆休憩チェック
        if (segments.length > 0) {
          const sortedSegments = [...segments].filter(s => s.start && s.end).sort((a, b) => toMinutes(a.start) - toMinutes(b.start));
          if (sortedSegments.length > 0) {
            const firstSegMin = toMinutes(sortedSegments[0].start);
            if (firstSegMin > startMin) {
              return alert(`【エラー】出勤時刻（打刻丸め後: ${Math.floor(startMin/60)}:${String(startMin%60).padStart(2,'0')}）から最初の業務までに空白時間を作ることはできません。\n最初の業務の開始時刻を合わせるか、出退勤時刻を変更してください。`);
            }
            if (sortedSegments[0].type === 'break') {
              return alert('【エラー】出勤直後の最初の業務区分に「休憩」を登録することはできません。');
            }
          }
        }
      }
      
      const filledSegments = fillGaps(segments, newStartISO, newEndISO);

      // ★ 修正: 最後が休憩で終わることを禁止するバリデーション
      if (filledSegments.length > 0) {
        const lastSeg = filledSegments[filledSegments.length - 1];
        if (lastSeg.type === 'break') {
          return alert('【エラー】最後が「休憩」で終わることはできません。\n退勤時刻を前倒しするか、最後の業務の終了時刻と退勤時刻(丸め後)を一致させてください。');
        }
      }

      const formattedExpenses = expenses.map(e => ({ ...e, cost: Number(e.cost) }));

      await updateDoc(ref, { 
        start_time: newStartISO,
        end_time: newEndISO,
        work_segments: filledSegments,
        transportation: formattedExpenses
      });

      setRecords(prev => prev.map(r => r.id === editingRecord.id ? { 
        ...r, start_time: newStartISO, end_time: newEndISO, work_segments: filledSegments, transportation: formattedExpenses 
      } : r));
      
      setEditingRecord(null);
      alert('保存しました。');
    } catch (e: any) { alert('保存エラー: ' + e.message); }
  };

  // 新規勤務データ作成処理
  const handleCreateNewRecord = async () => {
    if (!newRecordData.teacher_id) return alert('先生を選択してください');
    if (!newRecordData.date) return alert('日付を選択してください');

    const userInfo = usersMap[newRecordData.teacher_id];
    if (!userInfo) return alert('ユーザー情報が見つかりません');

    setIsBulkProcessing(true);
    try {
      const newDocRef = await addDoc(collection(db, 'work_records'), {
        teacher_id: newRecordData.teacher_id,
        teacher_name: userInfo.name,
        date: newRecordData.date,
        start_time: `${newRecordData.date}T00:00:00+09:00`,
        end_time: `${newRecordData.date}T00:00:00+09:00`,
        status: 'pending',
        work_segments: [],
        transportation: [],
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      });

      const newRecord = {
        id: newDocRef.id,
        teacher_id: newRecordData.teacher_id,
        teacher_name: userInfo.name,
        date: newRecordData.date,
        start_time: `${newRecordData.date}T00:00:00+09:00`,
        end_time: `${newRecordData.date}T00:00:00+09:00`,
        status: 'pending',
        work_segments: [],
        transportation: []
      };

      setRecords([newRecord, ...records]);
      setIsNewRecordModalOpen(false);
      openEditor(newRecord); // 作成後、既存の編集フローへ遷移
    } catch (e: any) {
      alert('作成エラー: ' + e.message);
    } finally {
      setIsBulkProcessing(false);
    }
  };

  // テストデータ一括生成機能
  const generateDummyData = async () => {
    if (!confirm(`現在の表示月（${filterMonth}）に、5人のダミー講師の1ヶ月分の勤怠データ（約100件）を一括生成しますか？\n※CSV出力や手当計算のテストに最適です。`)) return;
    
    setIsCsvGenerating(true); 
    try {
      const [yearStr, monthStr] = filterMonth.split('-');
      const year = parseInt(yearStr);
      const month = parseInt(monthStr);
      
      const dummyTeachers = [
        { id: 'dummy_teacher_1', name: 'テスト講師 山田', school: '101', staff_id: '9001' },
        { id: 'dummy_teacher_2', name: 'テスト講師 佐藤', school: '102', staff_id: '9002' },
        { id: 'dummy_teacher_3', name: 'テスト講師 鈴木', school: '101', staff_id: '9003' },
        { id: 'dummy_teacher_4', name: 'テスト講師 高橋', school: '103', staff_id: '9004' },
        { id: 'dummy_teacher_5', name: 'テスト講師 田中', school: '102', staff_id: '9005' }
      ];

      const batch1 = writeBatch(db);
      dummyTeachers.forEach(t => {
        const ref = doc(db, 'users', t.id);
        batch1.set(ref, {
          uid: t.id,
          role: 'teacher',
          name: t.name,
          school_code: t.school,
          staff_id: t.staff_id,
          lifetime_id: t.staff_id,
          created_at: new Date().toISOString()
        }, { merge: true });
      });
      await batch1.commit();

      const batch2 = writeBatch(db);
      let count = 0;
      const lastDay = new Date(year, month, 0).getDate();

      for (let day = 1; day <= lastDay; day++) {
        const dateStr = `${yearStr}-${monthStr}-${String(day).padStart(2, '0')}`;
        const dateObj = new Date(year, month - 1, day);
        const dayOfWeek = dateObj.getDay();
        
        if (dayOfWeek === 0) continue; 
        
        dummyTeachers.forEach((t, index) => {
          if ((day + index) % 3 === 0) return; 

          const docRef = doc(collection(db, 'work_records'));
          
          let segments = [];
          let startTime = '';
          let endTime = '';

          if ((day + index) % 4 === 0) {
            startTime = `${dateStr}T17:00:00+09:00`;
            endTime = `${dateStr}T22:00:00+09:00`;
            segments = [
              { start: '17:00', end: '18:30', type: 'office', note: '事務・プリント印刷', isAuto: false },
              { start: '18:30', end: '19:15', type: 'break', note: '休憩', isAuto: false },
              { start: '19:15', end: '21:30', type: 'support', note: '自習室監督・質問対応', isAuto: false },
              { start: '21:30', end: '22:00', type: 'office', note: '見回り・片付け', isAuto: false }
            ];
          } else if ((day + index) % 4 === 1) {
            startTime = `${dateStr}T16:00:00+09:00`;
            endTime = `${dateStr}T19:00:00+09:00`;
            segments = [
              { start: '16:00', end: '17:00', type: 'office', note: '事務', isAuto: false },
              { start: '17:00', end: '18:00', type: 'lesson', note: '授業', isAuto: false },
              { start: '18:00', end: '19:00', type: 'office', note: '事務', isAuto: false }
            ];
          } else {
            startTime = `${dateStr}T16:00:00+09:00`;
            endTime = `${dateStr}T22:30:00+09:00`;
            segments = [
              { start: '16:00', end: '18:30', type: 'office', note: '授業準備', isAuto: false },
              { start: '18:30', end: '19:20', type: 'break', note: '休憩', isAuto: false },
              { start: '19:20', end: '20:25', type: 'lesson', note: '1限 中2理科', isAuto: false },
              { start: '20:25', end: '20:35', type: 'break', note: '休憩', isAuto: false },
              { start: '20:35', end: '21:40', type: 'lesson', note: '2限 中2社会', isAuto: false },
              { start: '21:40', end: '22:30', type: 'support', note: '質問対応・片付け', isAuto: false }
            ];
          }
          
          batch2.set(docRef, {
            teacher_id: t.id,
            teacher_name: t.name,
            date: dateStr,
            start_time: startTime,
            end_time: endTime,
            status: count % 5 === 0 ? 'approved' : 'pending',
            work_segments: segments,
            transportation: [
              { from: '三宮', to: '学園都市', cost: 310 }
            ],
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
          });
          count++;
        });
      }

      await batch2.commit();
      await fetchUsers();
      await fetchRecords();
      alert(`テスト用データを ${count} 件作成しました！\n「CSV一括出力」などをテストしてみてください。`);
    } catch (e: any) {
      alert('データ生成エラー: ' + e.message);
    } finally {
      setIsCsvGenerating(false);
    }
  };

  // --- 計算関数 ---
  const calcDurationMinutes = (start: string, end: string) => {
    if (!start || !end) return 0;
    const s = new Date(start);
    const e = new Date(end);
    if(isNaN(s.getTime()) || isNaN(e.getTime())) return 0;
    return Math.floor((e.getTime() - s.getTime()) / (1000 * 60));
  };

  const calcDurationStr = (minutes: number) => {
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return `${h}h ${m}m`;
  };

  const calcTotalCost = (exps: Transportation[]) => exps ? exps.reduce((sum, item) => sum + Number(item.cost), 0) : 0;
  
  const splitTimeBy22 = (startTime: string, endTime: string) => {
    if (!startTime || !endTime) return { before22: 0, after22: 0 };
    const start = new Date(startTime);
    const end = new Date(endTime);
    const startM = start.getHours() * 60 + start.getMinutes();
    const endM = end.getHours() * 60 + end.getMinutes();
    const border = 22 * 60; 
    
    let before22 = 0;
    let after22 = 0;

    if (endM <= border) {
      before22 = endM - startM;
    } else if (startM >= border) {
      after22 = endM - startM;
    } else {
      before22 = border - startM;
      after22 = endM - border;
    }
    return { before22, after22 };
  };

  // --- フィルタリング ---
  const filteredRecords = useMemo(() => {
    return records.filter(r => {
      const userInfo = usersMap[r.teacher_id];
      const name = userInfo?.name || r.teacher_name || '';
      const nameMatch = name.includes(filterName);
      const statusMatch = showOnlyPending ? r.status !== 'approved' : true;
      const dateMatch = filterDate ? r.date === filterDate : true;
      
      return nameMatch && statusMatch && dateMatch;
    });
  }, [records, usersMap, filterName, showOnlyPending, filterDate]);

  // 日付ごとにグループ化
  const groupedRecords = useMemo(() => {
    const groups: { [date: string]: any[] } = {};
    filteredRecords.forEach(rec => {
      if (!groups[rec.date]) {
        groups[rec.date] = [];
      }
      groups[rec.date].push(rec);
    });
    // 日付の降順（新しい日付が上）でソート
    return Object.keys(groups).sort((a, b) => b.localeCompare(a)).map(date => ({
      date,
      records: groups[date]
    }));
  }, [filteredRecords]);

  // サマリー計算
  const summary = useMemo(() => {
    const pending = records.filter(r => r.status !== 'approved').length;
    let totalLessonMinutes = 0;
    let totalOfficeMinutes = 0;

    records.forEach(rec => {
      rec.work_segments?.forEach((seg: WorkSegment) => {
        if (!seg.start || !seg.end) return;
        const [sh, sm] = seg.start.split(':').map(Number);
        const [eh, em] = seg.end.split(':').map(Number);
        const duration = (eh * 60 + em) - (sh * 60 + sm);

        if (seg.type === 'lesson') totalLessonMinutes += duration;
        else if (seg.type === 'office' || seg.type === 'support') totalOfficeMinutes += duration;
      });
    });

    return { 
      pending, 
      lessonTime: calcDurationStr(totalLessonMinutes),
      officeTime: calcDurationStr(totalOfficeMinutes)
    };
  }, [records]);

  const pendingCorrectionRequests = useMemo(
    () => correctionRequests.filter(req => (req.status || 'pending') === 'pending'),
    [correctionRequests]
  );

  const formatCorrectionTime = (value?: string | null) => {
    if (!value) return '変更なし';
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return '変更なし';
    return d.toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  };

  const getRecordById = (id: string) => records.find(record => record.id === id);

  // CSV一括出力
  const handleBulkDownload = async () => {
    if (filteredRecords.length === 0) return alert('出力するデータがありません');
    if (!confirm('表示中の全データを校舎・職員番号順にソートしてCSV出力しますか？')) return;

    setIsCsvGenerating(true);

    try {
      const sortedRecords = [...filteredRecords].sort((a, b) => {
        const userA = usersMap[a.teacher_id] || { school_code: '999', staff_id: '9999', name: '' };
        const userB = usersMap[b.teacher_id] || { school_code: '999', staff_id: '9999', name: '' };

        if (userA.school_code !== userB.school_code) {
          return userA.school_code.localeCompare(userB.school_code, undefined, { numeric: true });
        }
        if (userA.staff_id !== userB.staff_id) {
          return userA.staff_id.localeCompare(userB.staff_id, undefined, { numeric: true });
        }
        return a.date.localeCompare(b.date);
      });

      const groupedData: { [key: string]: any[] } = {};
      const teacherOrder: string[] = [];

      sortedRecords.forEach(rec => {
        const tid = rec.teacher_id;
        if (!groupedData[tid]) {
          groupedData[tid] = [];
          teacherOrder.push(tid);
        }
        groupedData[tid].push(rec);
      });

      const header = [
        '校舎番号', '職員番号', '氏名',
        '日付', '曜日',
        '出勤時刻', '退勤時刻', '休憩時間',
        '授業(開始)', '授業(終了)',
        '事務・研修(開始)', '事務・研修(終了)',
        'サポート(開始)', 'サポート(終了)',
        '授業時間(~22時)', '授業時間(22時~)',
        '事務・研修時間(~22時)', '事務・研修時間(22時~)',
        'サポート時間(~22時)', 'サポート時間(22時~)',
        '勤務形態(授業)', '勤務形態(サポート)', 
        '交通費(区間)', '交通費(金額)'
      ].join(',');

      const csvRows: string[] = [];

      const minToHm = (m: number) => {
        if (m <= 0) return '';
        const h = Math.floor(m / 60);
        const min = m % 60;
        return `${h}:${String(min).padStart(2, '0')}`;
      };

      teacherOrder.forEach(tid => {
        const teacherRecords = groupedData[tid];
        const userInfo = usersMap[tid] || { name: teacherRecords[0].teacher_name || '不明', school_code: '', staff_id: '' };

        teacherRecords.forEach(rec => {
          const dateObj = new Date(rec.date);
          const dayOfWeek = ['日', '月', '火', '水', '木', '金', '土'][dateObj.getDay()];

          let lessonStart = '', lessonEnd = '';
          let officeStart = '', officeEnd = '';
          let supportStart = '', supportEnd = '';
          
          let lessonTimeNormal = 0, lessonTimeLate = 0;
          let officeTimeNormal = 0, officeTimeLate = 0;
          let supportTimeNormal = 0, supportTimeLate = 0;
          let breakTime = 0;

          rec.work_segments?.forEach((seg: WorkSegment) => {
            const startISO = `${rec.date}T${seg.start}:00`;
            const endISO = `${rec.date}T${seg.end}:00`;
            const { before22, after22 } = splitTimeBy22(startISO, endISO);

            if (seg.type === 'lesson') {
              if (!lessonStart || seg.start < lessonStart) lessonStart = seg.start;
              if (!lessonEnd || seg.end > lessonEnd) lessonEnd = seg.end;
              lessonTimeNormal += before22;
              lessonTimeLate += after22;
            } else if (seg.type === 'office') {
              if (!officeStart || seg.start < officeStart) officeStart = seg.start;
              if (!officeEnd || seg.end > officeEnd) officeEnd = seg.end;
              officeTimeNormal += before22;
              officeTimeLate += after22;
            } else if (seg.type === 'support') {
              if (!supportStart || seg.start < supportStart) supportStart = seg.start;
              if (!supportEnd || seg.end > supportEnd) supportEnd = seg.end;
              supportTimeNormal += before22;
              supportTimeLate += after22;
            } else if (seg.type === 'break') {
              breakTime += before22 + after22;
            }
          });

          let allowanceLesson = '';
          let allowanceSupport = '';
          if ((lessonTimeNormal + lessonTimeLate) > 0) {
            allowanceLesson = '1';
          } else if ((supportTimeNormal + supportTimeLate) > 0) {
            allowanceSupport = '1';
          }

          const transportText = rec.transportation?.map((t: any) => `${t.from}-${t.to}`).join(' / ') || '';
          const transportCost = calcTotalCost(rec.transportation);

          const startTimeStr = rec.start_time ? new Date(rec.start_time).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'}) : '';
          const endTimeStr = rec.end_time ? new Date(rec.end_time).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'}) : '';

          csvRows.push([
            `"${userInfo.school_code !== '999' ? userInfo.school_code : ''}"`, 
            `"${userInfo.staff_id !== '9999' ? userInfo.staff_id : ''}"`,
            `"${userInfo.name}"`,
            rec.date, dayOfWeek,
            startTimeStr, endTimeStr, minToHm(breakTime),
            lessonStart, lessonEnd,
            officeStart, officeEnd,
            supportStart, supportEnd,
            minToHm(lessonTimeNormal), minToHm(lessonTimeLate),
            minToHm(officeTimeNormal), minToHm(officeTimeLate),
            minToHm(supportTimeNormal), minToHm(supportTimeLate),
            `"${allowanceLesson}"`, `"${allowanceSupport}"`, 
            `"${transportText}"`, transportCost
          ].join(','));
        });
      });

      const csvContent = "\uFEFF" + [header, ...csvRows].join('\n');
      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = `勤怠一覧_${filterMonth}.csv`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);

    } catch (e) {
      console.error(e);
      alert('CSV生成に失敗しました');
    } finally {
      setIsCsvGenerating(false);
    }
  };

  const TimelineVisual = ({ record, currentSegments }: { record: any, currentSegments: WorkSegment[] }) => {
    if (!record.start_time || !record.end_time) return null;
    
    const startTime = new Date(record.start_time);
    const endTime = new Date(record.end_time);
    const displayStart = new Date(startTime);
    displayStart.setMinutes(displayStart.getMinutes() - 30);
    const displayEnd = new Date(endTime);
    displayEnd.setMinutes(displayEnd.getMinutes() + 30);
    const totalDuration = (displayEnd.getTime() - displayStart.getTime());

    const getPosition = (dateStr: string) => { 
      const d = new Date(record.start_time); 
      const [h, m] = dateStr.split(':').map(Number);
      d.setHours(h, m, 0);
      return ((d.getTime() - displayStart.getTime()) / totalDuration) * 100;
    };

    const getWidth = (startStr: string, endStr: string) => {
      const s = new Date(record.start_time);
      const [sh, sm] = startStr.split(':').map(Number);
      s.setHours(sh, sm, 0);
      const e = new Date(record.start_time);
      const [eh, em] = endStr.split(':').map(Number);
      e.setHours(eh, em, 0);
      return ((e.getTime() - s.getTime()) / totalDuration) * 100;
    };

    const workStartPos = ((startTime.getTime() - displayStart.getTime()) / totalDuration) * 100;
    const workWidth = ((endTime.getTime() - startTime.getTime()) / totalDuration) * 100;

    return (
      <div className="relative w-full h-12 bg-gray-100 rounded-lg overflow-hidden mb-4 border border-gray-200">
        <div className="absolute top-0 bottom-0 bg-gray-200/50 border-x-2 border-gray-300" style={{ left: `${workStartPos}%`, width: `${workWidth}%` }} />
        {currentSegments.map((seg, i) => {
          if (!seg.start || !seg.end) return null;
          const left = getPosition(seg.start);
          const width = getWidth(seg.start, seg.end);
          let colorClass = 'bg-gray-400';
          if (seg.type === 'lesson') colorClass = 'bg-blue-500';
          else if (seg.type === 'support') colorClass = 'bg-green-500';
          else if (seg.type === 'office') colorClass = 'bg-orange-500';
          else if (seg.type === 'break') colorClass = 'bg-slate-400';

          return (
            <div key={i} className={`absolute top-1 bottom-1 rounded-md shadow-sm ${colorClass} opacity-90 hover:opacity-100 transition-opacity flex items-center justify-center text-[10px] text-white font-bold truncate px-1`} style={{ left: `${left}%`, width: `${width}%` }} title={`${seg.start}-${seg.end} ${seg.note}`}>
              {width > 10 ? (seg.type === 'lesson' ? '授業' : seg.type === 'support' ? 'サポ' : seg.type === 'office' ? '事務' : '休憩') : ''}
            </div>
          );
        })}
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-gray-50/50 p-6 pb-32 font-sans text-slate-800">
      <div className="max-w-7xl mx-auto">
        
        {/* ヘッダーエリア */}
        <div className="flex flex-col md:flex-row items-start md:items-center justify-between mb-8 gap-4">
          <div className="flex items-center gap-4">
            <Link href="/master" className="bg-white p-2.5 rounded-full shadow-sm hover:bg-gray-100 text-gray-500 transition-colors border border-gray-200">
              <ArrowLeft size={20} />
            </Link>
            <div>
              <h1 className="text-2xl font-bold text-gray-800 flex items-center gap-2">
                <Briefcase className="text-indigo-600" /> 勤怠管理
              </h1>
              <p className="text-xs text-gray-500 mt-1">講師の出勤記録の確認と承認を行います</p>
            </div>
          </div>

          <div className="flex gap-4 flex-wrap">
            <Link href="/master/attendance-corrections" className="bg-amber-500 px-5 py-3 rounded-xl shadow-sm flex flex-col items-center min-w-[120px] text-white hover:bg-amber-600 transition-colors">
              <span className="text-[10px] font-bold uppercase flex items-center gap-1"><CheckSquare size={12}/> 打刻修正</span>
              <span className="text-xl font-black">{pendingCorrectionRequests.length}</span>
            </Link>
            <div className="bg-white px-5 py-3 rounded-xl border border-gray-200 shadow-sm flex flex-col items-center min-w-[100px]">
              <span className="text-[10px] text-gray-400 font-bold uppercase flex items-center gap-1"><FileText size={12}/> 授業時間</span>
              <span className="text-xl font-black text-blue-600 font-mono">{summary.lessonTime}</span>
            </div>
            <div className="bg-white px-5 py-3 rounded-xl border border-gray-200 shadow-sm flex flex-col items-center min-w-[100px]">
              <span className="text-[10px] text-gray-400 font-bold uppercase flex items-center gap-1"><Coffee size={12}/> 事務/サポ</span>
              <span className="text-xl font-black text-orange-500 font-mono">{summary.officeTime}</span>
            </div>
            <div className="bg-white px-5 py-3 rounded-xl border border-gray-200 shadow-sm flex flex-col items-center min-w-[100px]">
              <span className="text-[10px] text-gray-400 font-bold uppercase">承認待ち</span>
              <span className={`text-xl font-black ${summary.pending > 0 ? 'text-red-500' : 'text-gray-300'}`}>{summary.pending}</span>
            </div>
          </div>
        </div>

        {pendingCorrectionRequests.length > 0 && (
          <section className="mb-6 rounded-3xl border border-amber-200 bg-amber-50/70 p-4 shadow-sm">
            <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="flex items-center gap-2 text-lg font-black text-amber-900">
                  <AlertCircle size={20} /> 打刻修正依頼
                </h2>
                <p className="mt-1 text-xs font-bold text-amber-700">講師から届いた出退勤時刻の修正申請です。承認すると勤務記録へ反映されます。</p>
              </div>
              <span className="inline-flex w-fit rounded-full bg-white px-3 py-1 text-xs font-black text-amber-700 ring-1 ring-amber-200">
                未処理 {pendingCorrectionRequests.length}件
              </span>
            </div>

            <div className="grid gap-3 lg:grid-cols-2">
              {pendingCorrectionRequests.map(req => {
                const rec = getRecordById(req.work_record_id);
                const teacher = usersMap[req.teacher_id];
                return (
                  <div key={req.id} className="rounded-2xl border border-amber-100 bg-white p-4 shadow-sm">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div className="min-w-0">
                        <p className="text-sm font-black text-slate-900">{teacher?.name || rec?.teacher_name || '講師未設定'}</p>
                        <p className="mt-1 text-xs font-bold text-slate-400">{rec?.date || '日付未取得'} / 申請ID: {req.id.slice(0, 8)}</p>
                      </div>
                      <span className="w-fit rounded-full bg-amber-100 px-3 py-1 text-[10px] font-black text-amber-700">承認待ち</span>
                    </div>

                    <div className="mt-4 grid grid-cols-2 gap-2">
                      <div className="rounded-xl bg-slate-50 p-3">
                        <p className="text-[10px] font-black text-slate-400">現在の出勤</p>
                        <p className="mt-1 text-xs font-black text-slate-700">{formatCorrectionTime(rec?.start_time)}</p>
                      </div>
                      <div className="rounded-xl bg-indigo-50 p-3">
                        <p className="text-[10px] font-black text-indigo-400">修正後の出勤</p>
                        <p className="mt-1 text-xs font-black text-indigo-700">{formatCorrectionTime(req.requested_start_time)}</p>
                      </div>
                      <div className="rounded-xl bg-slate-50 p-3">
                        <p className="text-[10px] font-black text-slate-400">現在の退勤</p>
                        <p className="mt-1 text-xs font-black text-slate-700">{formatCorrectionTime(rec?.end_time)}</p>
                      </div>
                      <div className="rounded-xl bg-indigo-50 p-3">
                        <p className="text-[10px] font-black text-indigo-400">修正後の退勤</p>
                        <p className="mt-1 text-xs font-black text-indigo-700">{formatCorrectionTime(req.requested_end_time)}</p>
                      </div>
                    </div>

                    <div className="mt-3 rounded-xl bg-slate-50 p-3">
                      <p className="text-[10px] font-black text-slate-400">理由</p>
                      <p className="mt-1 text-sm font-bold leading-relaxed text-slate-700">{req.reason || '理由未入力'}</p>
                    </div>

                    <div className="mt-4 flex justify-end gap-2">
                      <button
                        onClick={() => handleCorrectionReview(req.id, 'rejected')}
                        disabled={processingCorrectionId === req.id}
                        className="rounded-xl border border-slate-200 px-4 py-2 text-xs font-black text-slate-500 hover:bg-slate-50 disabled:opacity-50"
                      >
                        却下
                      </button>
                      <button
                        onClick={() => handleCorrectionReview(req.id, 'approved')}
                        disabled={processingCorrectionId === req.id}
                        className="flex items-center gap-2 rounded-xl bg-amber-500 px-4 py-2 text-xs font-black text-white hover:bg-amber-600 disabled:opacity-50"
                      >
                        {processingCorrectionId === req.id ? <Loader2 className="animate-spin" size={14} /> : <CheckSquare size={14} />} 承認して反映
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {/* フィルター & 操作バー */}
        <div className="bg-white p-4 rounded-2xl shadow-sm border border-gray-200 mb-4 flex flex-col md:flex-row gap-4 items-center justify-between sticky top-4 z-20">
          <div className="flex flex-wrap items-center gap-3 w-full md:w-auto">
            <div className="flex items-center gap-2 bg-gray-50 px-3 py-2 rounded-xl border border-gray-200">
              <Calendar size={16} className="text-gray-400"/>
              <input type="month" value={filterMonth} onChange={e => setFilterMonth(e.target.value)} className="bg-transparent font-bold text-gray-700 outline-none text-sm cursor-pointer" />
            </div>

            <div className="flex items-center gap-2 bg-gray-50 px-3 py-2 rounded-xl border border-gray-200 relative">
              <Calendar size={16} className="text-indigo-400"/>
              <input 
                type="date" 
                value={filterDate} 
                onChange={e => setFilterDate(e.target.value)} 
                className="bg-transparent font-bold text-gray-700 outline-none text-sm cursor-pointer pr-4" 
              />
              {filterDate && (
                <button 
                  onClick={() => setFilterDate('')}
                  className="absolute right-2 text-gray-400 hover:text-gray-600 bg-gray-50"
                  title="日付をクリア"
                >
                  <X size={14}/>
                </button>
              )}
            </div>
            
            <div className="relative flex-1 md:w-64">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={16}/>
              <input 
                type="text" 
                placeholder="名前で検索..." 
                className="pl-10 pr-4 py-2 w-full border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-indigo-500 outline-none transition-all" 
                value={filterName} 
                onChange={e => setFilterName(e.target.value)} 
              />
            </div>

            <button 
              onClick={() => setShowOnlyPending(!showOnlyPending)}
              className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition-all border ${
                showOnlyPending 
                  ? 'bg-orange-50 text-orange-600 border-orange-200' 
                  : 'bg-white text-gray-500 border-gray-200 hover:bg-gray-50'
              }`}
            >
              {showOnlyPending ? <CheckSquare size={16}/> : <Filter size={16}/>}
              承認待ちのみ
            </button>
          </div>

          <div className="flex gap-2 w-full md:w-auto">
            <button 
              onClick={generateDummyData} 
              disabled={isCsvGenerating}
              className="w-full md:w-auto bg-slate-100 text-slate-600 px-4 py-2.5 rounded-xl font-bold text-sm flex items-center justify-center gap-2 hover:bg-slate-200 transition-all shadow-sm active:scale-95 disabled:opacity-50"
            >
              <Database size={16}/> テストデータ生成
            </button>
            <button 
              onClick={handleBulkDownload} 
              disabled={isCsvGenerating || filteredRecords.length === 0}
              className="w-full md:w-auto bg-emerald-600 text-white px-5 py-2.5 rounded-xl font-bold text-sm flex items-center justify-center gap-2 hover:bg-emerald-700 transition-all shadow-md active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isCsvGenerating ? <Loader2 className="animate-spin" size={18}/> : <Download size={18}/>}
              {isCsvGenerating ? '生成中...' : 'CSV一括出力'}
            </button>
            
            <button 
              onClick={() => {
                setNewRecordSearch('');
                setNewRecordData({ teacher_id: '', date: filterDate || filterMonth + '-01' });
                setIsNewRecordModalOpen(true);
              }}
              className="w-full md:w-auto bg-indigo-600 text-white px-4 py-2.5 rounded-xl font-bold text-sm flex items-center justify-center gap-2 hover:bg-indigo-700 transition-all shadow-md active:scale-95"
            >
              <Plus size={16}/> 新規追加
            </button>
          </div>
        </div>

        {/* リスト表示 */}
        {loading ? (
          <div className="flex justify-center py-20"><Loader2 className="animate-spin text-indigo-400" size={32}/></div>
        ) : filteredRecords.length === 0 ? (
          <div className="text-center py-20 text-gray-400 font-bold bg-white rounded-3xl border border-dashed border-gray-200">
            データが見つかりません
          </div>
        ) : (
          <div className="space-y-4">
            
            {/* 一括操作バー */}
            <div className="bg-white p-4 rounded-2xl shadow-sm border border-gray-200 flex flex-col sm:flex-row items-center justify-between gap-4">
              <div className="flex items-center gap-3 pl-2">
                <input 
                  type="checkbox" 
                  className="w-5 h-5 cursor-pointer rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                  checked={filteredRecords.length > 0 && selectedRecordIds.size === filteredRecords.length}
                  onChange={(e) => handleSelectAll(e.target.checked)}
                />
                <span className="text-sm font-bold text-gray-600">すべて選択 ({selectedRecordIds.size}件選択中)</span>
              </div>
              
              {selectedRecordIds.size > 0 && (
                <div className="flex items-center gap-2">
                  <button 
                    onClick={handleBulkApprove}
                    disabled={isBulkProcessing}
                    className="bg-indigo-50 text-indigo-600 px-5 py-2 rounded-xl text-xs font-bold hover:bg-indigo-100 flex items-center gap-2 transition-colors disabled:opacity-50"
                  >
                    {isBulkProcessing ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle size={14}/>}
                    選択した項目を承認
                  </button>
                  <button 
                    onClick={handleBulkDelete}
                    disabled={isBulkProcessing}
                    className="bg-red-50 text-red-600 px-5 py-2 rounded-xl text-xs font-bold hover:bg-red-100 flex items-center gap-2 transition-colors disabled:opacity-50"
                  >
                    {isBulkProcessing ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14}/>}
                    一括削除
                  </button>
                </div>
              )}
            </div>

            {/* 日付ごとにグループ化して表示 */}
            <div className="space-y-8">
              {groupedRecords.map(group => {
                const dateObj = new Date(group.date);
                const dayStr = isNaN(dateObj.getTime()) ? '' : ['日', '月', '火', '水', '木', '金', '土'][dateObj.getDay()] + '曜日';

                return (
                  <div key={group.date} className="space-y-4">
                    {/* 日付見出し */}
                    <h2 className="text-lg font-bold text-gray-700 flex items-center gap-2 border-b border-gray-200 pb-2 pl-1">
                      <Calendar className="text-indigo-500" size={20}/>
                      {group.date}
                      <span className="text-sm font-normal text-gray-400 ml-2">
                        ({dayStr}) - {group.records.length}件
                      </span>
                    </h2>

                    {/* その日のレコード一覧 */}
                    <div className="grid gap-4">
                      {group.records.map(rec => {
                        const userInfo = usersMap[rec.teacher_id];
                        const displayName = userInfo?.name || rec.teacher_name;
                        const displaySegments = rec.work_segments?.slice().sort((a: WorkSegment, b: WorkSegment) => a.start.localeCompare(b.start));
                        const isApproved = rec.status === 'approved';
                        const isSelected = selectedRecordIds.has(rec.id);

                        return (
                          <div key={rec.id} className={`relative bg-white p-5 rounded-2xl shadow-sm border transition-all hover:shadow-md ${isApproved ? 'border-gray-200 opacity-80' : 'border-orange-200 ring-1 ring-orange-100'} ${isSelected ? 'bg-indigo-50/30 border-indigo-300' : ''}`}>
                            
                            {/* 各行のチェックボックス */}
                            <div className="absolute top-5 left-4 z-10">
                              <input 
                                type="checkbox" 
                                className="w-5 h-5 cursor-pointer rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                                checked={isSelected}
                                onChange={(e) => handleSelectOne(rec.id, e.target.checked)}
                              />
                            </div>

                            <div className="flex flex-col md:flex-row gap-6 pl-8">
                              {/* 左側: 基本情報 */}
                              <div className="md:w-56 shrink-0 flex flex-col justify-center border-b md:border-b-0 md:border-r border-gray-100 pb-4 md:pb-0 md:pr-6">
                                <h3 className="text-lg font-bold text-gray-800 mb-1 flex items-center gap-2">
                                  <User size={18} className="text-gray-400"/>
                                  {displayName}
                                </h3>
                                {/* 校舎・職員番号表示 */}
                                <div className="flex items-center gap-2 text-[10px] text-gray-400 mb-2">
                                  <span className="bg-gray-100 px-1.5 py-0.5 rounded">校:{userInfo?.school_code !== '999' ? userInfo?.school_code : '-'}</span>
                                  <span className="bg-gray-100 px-1.5 py-0.5 rounded">員:{userInfo?.staff_id !== '9999' ? userInfo?.staff_id : '-'}</span>
                                </div>

                                <div className="bg-gray-50 rounded-lg p-2 text-center">
                                  <div className="text-xs text-gray-400 font-bold mb-1">拘束時間</div>
                                  <div className="text-xl font-black text-gray-700 font-mono">
                                    {calcDurationMinutes(rec.start_time, rec.end_time) > 0 ? calcDurationStr(calcDurationMinutes(rec.start_time, rec.end_time)) : '--'}
                                  </div>
                                </div>
                              </div>

                              {/* 中央: 詳細情報 */}
                              <div className="flex-1 space-y-3">
                                <div className="flex items-center gap-3 text-sm">
                                  <span className="px-2 py-1 bg-gray-100 text-gray-600 rounded text-xs font-bold">出勤</span>
                                  <span className="font-mono font-bold text-lg">
                                    {rec.start_time ? new Date(rec.start_time).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'}) : '--:--'}
                                  </span>
                                  <span className="text-gray-300">➜</span>
                                  <span className="px-2 py-1 bg-gray-100 text-gray-600 rounded text-xs font-bold">退勤</span>
                                  <span className="font-mono font-bold text-lg">
                                    {rec.end_time ? new Date(rec.end_time).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'}) : '--:--'}
                                  </span>
                                </div>

                                {displaySegments?.length > 0 ? (
                                  <div className="flex flex-wrap gap-2">
                                    {displaySegments.map((seg: any, i: number) => (
                                      <div key={i} className={`flex items-center gap-2 text-xs px-3 py-1.5 rounded-lg border ${
                                        seg.type === 'lesson' ? 'bg-blue-50 border-blue-100 text-blue-800' :
                                        seg.type === 'support' ? 'bg-green-50 border-green-100 text-green-800' :
                                        seg.type === 'office' ? 'bg-orange-50 border-orange-100 text-orange-800' :
                                        'bg-gray-50 border-gray-200 text-gray-500' // break
                                      }`}>
                                        <span className="font-mono font-bold">{seg.start}-{seg.end}</span>
                                        <span className="font-bold opacity-70">|</span>
                                        <span className="font-bold">
                                          {seg.type === 'lesson' ? '授業' : seg.type === 'support' ? 'サポ' : seg.type === 'office' ? '事務' : '休憩'}
                                        </span>
                                        {seg.note && !seg.isAuto && <span className="opacity-70 truncate max-w-[100px]">({seg.note})</span>}
                                      </div>
                                    ))}
                                  </div>
                                ) : (
                                  <span className="text-xs text-gray-400 italic">詳細なし</span>
                                )}

                                {rec.transportation?.length > 0 && (
                                  <div className="flex items-center gap-2 text-xs font-bold text-emerald-600 bg-emerald-50 px-3 py-1.5 rounded-lg w-fit">
                                    <Train size={14}/> 交通費: ¥{calcTotalCost(rec.transportation).toLocaleString()}
                                  </div>
                                )}
                              </div>

                              {/* 右側: アクション */}
                              <div className="flex flex-row md:flex-col justify-center gap-2 border-t md:border-t-0 md:border-l border-gray-100 pt-4 md:pt-0 md:pl-6">
                                {isApproved ? (
                                  <button disabled className="w-full bg-gray-100 text-gray-400 px-4 py-2 rounded-lg text-xs font-bold flex items-center justify-center gap-2 cursor-not-allowed">
                                    <CheckCircle size={16}/> 承認済
                                  </button>
                                ) : (
                                  <button onClick={() => handleApprove(rec.id)} className="w-full bg-indigo-600 text-white px-4 py-2 rounded-lg text-xs font-bold flex items-center justify-center gap-2 hover:bg-indigo-700 shadow-sm transition-all active:scale-95">
                                    <CheckCircle size={16}/> 承認する
                                  </button>
                                )}
                                <button onClick={() => openEditor(rec)} className="w-full bg-white border border-gray-200 text-gray-600 px-4 py-2 rounded-lg text-xs font-bold flex items-center justify-center gap-2 hover:bg-gray-50 transition-colors">
                                  <Edit size={14}/> 編集
                                </button>
                                <button onClick={() => handleDelete(rec.id)} className="w-full bg-white border border-red-100 text-red-500 px-4 py-2 rounded-lg text-xs font-bold flex items-center justify-center gap-2 hover:bg-red-50 transition-colors">
                                  <Trash2 size={14}/> 削除
                                </button>
                              </div>

                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>

          </div>
        )}
      </div>

      {/* 新規勤務データ作成用モーダル */}
      {isNewRecordModalOpen && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4 animate-in fade-in duration-200">
          <div className="bg-white w-full max-w-md rounded-3xl shadow-2xl flex flex-col overflow-hidden">
            <div className="bg-indigo-600 text-white px-6 py-4 flex justify-between items-center shrink-0">
              <h3 className="font-bold flex items-center gap-2 text-lg"><Plus size={20}/> 新規勤務データ作成</h3>
              <button onClick={() => setIsNewRecordModalOpen(false)} className="hover:bg-white/20 p-2 rounded-full transition-colors"><X size={20}/></button>
            </div>
            <div className="p-6 space-y-5">
              <div>
                <label className="text-xs font-bold text-gray-500 mb-2 block">対象の講師 <span className="text-red-500">*</span></label>
                
                {/* 検索ボックス */}
                <div className="relative mb-2">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={16}/>
                  <input
                    type="text"
                    placeholder="講師名や校舎番号で検索..."
                    className="pl-10 pr-4 py-2 w-full border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
                    value={newRecordSearch}
                    onChange={e => setNewRecordSearch(e.target.value)}
                  />
                </div>

                {/* フィルタリングされたリストボックス */}
                <select 
                  className="w-full bg-gray-50 border border-gray-200 rounded-xl p-3 text-sm font-bold focus:ring-2 focus:ring-indigo-500 outline-none"
                  value={newRecordData.teacher_id}
                  onChange={(e) => setNewRecordData({...newRecordData, teacher_id: e.target.value})}
                  size={5}
                >
                  <option value="">-- 講師を選択してください --</option>
                  {Object.entries(usersMap)
                    .filter(([id, info]) => info.name.includes(newRecordSearch) || info.school_code.includes(newRecordSearch))
                    .map(([id, info]) => (
                    <option key={id} value={id}>{info.name} (校舎:{info.school_code})</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-xs font-bold text-gray-500 mb-2 block">勤務日 <span className="text-red-500">*</span></label>
                <input 
                  type="date" 
                  className="w-full bg-gray-50 border border-gray-200 rounded-xl p-3 text-sm font-bold focus:ring-2 focus:ring-indigo-500 outline-none"
                  value={newRecordData.date}
                  onChange={(e) => setNewRecordData({...newRecordData, date: e.target.value})}
                />
              </div>
            </div>
            <div className="p-5 border-t bg-gray-50 shrink-0 flex justify-end gap-3">
              <button onClick={() => setIsNewRecordModalOpen(false)} className="px-5 py-2.5 rounded-xl font-bold text-gray-500 hover:bg-gray-200 transition-colors text-sm">キャンセル</button>
              <button onClick={handleCreateNewRecord} disabled={isBulkProcessing || !newRecordData.teacher_id} className="px-6 py-2.5 rounded-xl font-bold text-white bg-indigo-600 hover:bg-indigo-700 shadow-md transition-all active:scale-95 text-sm flex items-center gap-2 disabled:opacity-50">
                {isBulkProcessing ? <Loader2 size={16} className="animate-spin" /> : '作成して編集へ'} <ChevronRight size={16}/>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 編集モーダル */}
      {editingRecord && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-md flex items-center justify-center z-50 p-4 animate-in fade-in duration-200">
          <div className="bg-white w-full max-w-2xl h-[90vh] rounded-3xl shadow-2xl flex flex-col overflow-hidden">
            
            <div className="bg-slate-900 text-white px-6 py-4 flex justify-between items-center shrink-0">
              <div>
                <h3 className="font-bold flex items-center gap-2 text-lg"><Briefcase size={20}/> 勤怠データ編集</h3>
                <p className="text-xs text-slate-400 mt-0.5">{editingRecord.date} - {usersMap[editingRecord.teacher_id]?.name || editingRecord.teacher_name}</p>
              </div>
              <button onClick={() => setEditingRecord(null)} className="hover:bg-white/20 p-2 rounded-full transition-colors"><X size={24}/></button>
            </div>
            
            <div className="flex-1 overflow-y-auto p-6 bg-gray-50/50 space-y-8 custom-scrollbar">
              
              {/* 出退勤時間 */}
              <div className="bg-white p-5 rounded-2xl shadow-sm border border-gray-200">
                <h4 className="text-sm font-bold text-gray-700 mb-4 flex items-center gap-2 border-b pb-2"><Clock size={18} className="text-indigo-500"/> 出退勤時間</h4>
                <div className="grid grid-cols-2 gap-6">
                  <div>
                    <label className="text-xs font-bold text-gray-400 mb-1 block">出勤時刻</label>
                    <input type="datetime-local" className="w-full bg-gray-50 border border-gray-200 rounded-xl p-3 text-sm font-mono font-bold focus:ring-2 focus:ring-indigo-500 outline-none" value={mainTime.start} onChange={e => setMainTime({...mainTime, start: e.target.value})} />
                  </div>
                  <div>
                    <label className="text-xs font-bold text-gray-400 mb-1 block">退勤時刻</label>
                    <input type="datetime-local" className="w-full bg-gray-50 border border-gray-200 rounded-xl p-3 text-sm font-mono font-bold focus:ring-2 focus:ring-indigo-500 outline-none" value={mainTime.end} onChange={e => setMainTime({...mainTime, end: e.target.value})} />
                  </div>
                </div>
              </div>

              {/* 時間割・内訳 */}
              <div className="bg-white p-5 rounded-2xl shadow-sm border border-gray-200 overflow-hidden">
                <div className="flex flex-col sm:flex-row justify-between items-start mb-4 border-b pb-3 gap-2">
                  <h4 className="text-sm font-bold text-gray-700 flex items-center gap-2 shrink-0"><Layout size={18} className="text-orange-500"/> 業務内訳</h4>
                  <div className="text-[10px] text-gray-600 bg-gray-100 px-3 py-2 rounded-lg font-bold flex flex-col gap-1 w-full sm:w-auto">
                    <div className="flex items-center gap-1 text-gray-500"><AlertCircle size={12} className="shrink-0"/> 始まりと終わりの隙間は自動で「休憩」になり、空白時間を埋めます。</div>
                    <div className="flex items-center gap-1 text-red-500"><AlertCircle size={12} className="shrink-0"/> ※勤務時間が6時間を超える場合は45分以上、8時間を超える場合は1時間以上の休憩が必要です。</div>
                  </div>
                </div>

                <div className="mb-6">
                   <div className="flex justify-between items-center mb-2 px-1">
                     <h4 className="text-xs font-bold text-gray-500">1日の流れ</h4>
                     <div className="flex gap-2 text-[10px] font-bold">
                       <span className="flex items-center gap-1 text-blue-600"><span className="w-2 h-2 bg-blue-500 rounded-full"></span>授業</span>
                       <span className="flex items-center gap-1 text-green-600"><span className="w-2 h-2 bg-green-500 rounded-full"></span>サポ</span>
                       <span className="flex items-center gap-1 text-orange-600"><span className="w-2 h-2 bg-orange-500 rounded-full"></span>事務</span>
                       <span className="flex items-center gap-1 text-gray-400"><span className="w-2 h-2 bg-slate-400 rounded-full"></span>休憩</span>
                     </div>
                   </div>
                   <TimelineVisual record={editingRecord} currentSegments={segments} />
                </div>
                
                <div className="overflow-x-auto pb-2">
                  <table className="w-full text-sm border-collapse min-w-[600px] sm:min-w-0">
                    <thead className="bg-gray-100 text-gray-500 text-xs font-bold border-b border-gray-200">
                      <tr>
                        <th className="px-2 py-2 text-left w-16">開始</th>
                        <th className="px-2 py-2 text-left w-16">終了</th>
                        <th className="px-2 py-2 text-left w-32">区分</th>
                        <th className="px-2 py-2 text-left hidden sm:table-cell">詳細</th>
                        <th className="w-10"></th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {segments.map((seg, i) => (
                        <tr key={i} className={`transition-colors ${
                          seg.type === 'lesson' ? 'bg-blue-50/30' : 
                          seg.type === 'support' ? 'bg-green-50/30' : 
                          seg.type === 'office' ? 'bg-orange-50/30' : 
                          'bg-gray-100'
                        }`}>
                          {/* ★ step="300" で5分刻みに */}
                          <td className="p-2"><input type="time" step="300" className="w-full bg-white rounded border border-gray-300 font-mono text-xs font-bold p-1" value={seg.start} onChange={(e) => updateSegment(i, 'start', e.target.value)} /></td>
                          <td className="p-2"><input type="time" step="300" className="w-full bg-white rounded border border-gray-300 font-mono text-xs font-bold p-1" value={seg.end} onChange={(e) => updateSegment(i, 'end', e.target.value)} /></td>
                          <td className="p-2">
                            <div className="flex flex-col sm:flex-row gap-1">
                              <select 
                                className={`w-full text-xs font-bold p-1 rounded border outline-none ${
                                  seg.type === 'lesson' ? 'text-blue-600 border-blue-200 bg-blue-50' : 
                                  seg.type === 'support' ? 'text-green-600 border-green-200 bg-green-50' : 
                                  seg.type === 'office' ? 'text-orange-600 border-orange-200 bg-orange-50' :
                                  'text-gray-500 border-gray-300 bg-white'
                                }`}
                                value={seg.type}
                                onChange={(e) => updateSegment(i, 'type', e.target.value as any)}
                              >
                                <option value="lesson">授業</option>
                                <option value="support">サポート</option>
                                <option value="office">事務</option>
                                <option value="break">休憩</option>
                              </select>
                              <input type="text" className="sm:hidden w-full bg-transparent border-b border-gray-300 text-xs p-1 mt-1 min-w-0" placeholder="詳細..." value={seg.note} onChange={(e) => updateSegment(i, 'note', e.target.value)} />
                            </div>
                          </td>
                          <td className="p-2 hidden sm:table-cell"><input type="text" className="w-full bg-transparent border-b border-gray-300 focus:border-indigo-500 outline-none text-xs p-1 min-w-0" placeholder="詳細..." value={seg.note} onChange={(e) => updateSegment(i, 'note', e.target.value)} /></td>
                          <td className="p-2 text-center w-10 whitespace-nowrap"><button onClick={() => removeSegment(i)} className="text-gray-300 hover:text-red-500 p-2 hover:bg-red-50 rounded-lg transition-colors shrink-0"><Trash2 size={16}/></button></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                
                <div className="px-4 py-2 bg-gray-50 border-t border-gray-100 text-[10px] text-gray-400 flex items-center justify-between">
                  <span className="flex items-center gap-1"><Coffee size={12}/> 入力のない時間は自動的に「休憩」となります</span>
                  <button onClick={addSegment} className="text-blue-600 font-bold hover:underline flex items-center gap-1"><Plus size={12}/> 行を追加</button>
                </div>
              </div>

              {/* 交通費セクション */}
              <div className="bg-white p-5 rounded-2xl shadow-sm border border-gray-200">
                <div className="flex flex-col sm:flex-row justify-between items-start sm:items-end mb-4 border-b pb-3 gap-2">
                  <div>
                    <h4 className="text-sm font-bold text-gray-700 flex items-center gap-2"><Train size={18} className="text-emerald-500"/> 交通費申請</h4>
                    <p className="text-[10px] text-red-500 font-bold mt-1">※必ず駅名を入力してください。定期券区間は除外して申請してください。</p>
                  </div>
                  <button onClick={handleCopyLastTransport} className="text-[10px] bg-indigo-50 text-indigo-600 px-3 py-1.5 rounded-full font-bold hover:bg-indigo-100 flex items-center gap-1 transition-colors shrink-0"><Copy size={12}/> 前回をコピー</button>
                </div>
                
                <div className="space-y-3">
                  {expenses.map((exp, i) => (
                    <div key={i} className="flex flex-col sm:flex-row gap-3 items-center bg-emerald-50/30 p-3 rounded-xl border border-emerald-100/50">
                      <div className="flex items-center gap-2 flex-1 w-full sm:w-auto">
                        <div className="bg-white px-2 py-1 rounded text-[10px] font-bold text-emerald-600 border border-emerald-100 shrink-0">片道</div>
                        <input type="text" className="flex-1 bg-transparent border-b border-gray-300 focus:border-emerald-500 outline-none text-sm font-bold pb-1 placeholder:text-gray-300" placeholder="出発駅" value={exp.from} onChange={(e) => updateExpense(i, 'from', e.target.value)} />
                        <ChevronRight size={16} className="text-gray-300 shrink-0"/>
                        <input type="text" className="flex-1 bg-transparent border-b border-gray-300 focus:border-emerald-500 outline-none text-sm font-bold pb-1 placeholder:text-gray-300" placeholder="到着駅" value={exp.to} onChange={(e) => updateExpense(i, 'to', e.target.value)} />
                      </div>
                      
                      <div className="flex items-center gap-3 w-full sm:w-auto justify-end">
                        <div className="relative">
                          <DollarSign size={14} className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400"/>
                          <input type="number" className="w-24 bg-white border border-gray-200 rounded-lg pl-6 pr-2 py-1.5 text-sm font-mono font-bold text-right focus:ring-2 focus:ring-emerald-500 outline-none" placeholder="0" value={exp.cost} onChange={(e) => updateExpense(i, 'cost', e.target.value)} />
                        </div>
                        <button onClick={() => removeExpense(i)} className="text-gray-300 hover:text-red-500 p-1.5 hover:bg-red-50 rounded-lg transition-colors"><X size={16}/></button>
                      </div>
                    </div>
                  ))}
                  <button onClick={addExpense} className="w-full py-3 text-xs font-bold text-emerald-600 hover:bg-emerald-50 border border-dashed border-emerald-200 hover:border-emerald-400 rounded-xl flex items-center justify-center gap-2 transition-all">
                    <Plus size={16}/> 交通費を追加
                  </button>
                </div>
              </div>
              
              <div className="h-10"></div>
            </div>
            
            <div className="p-5 border-t bg-white shrink-0 z-10 flex justify-end gap-3">
              <button onClick={() => setEditingRecord(null)} className="px-6 py-3 rounded-xl font-bold text-gray-500 hover:bg-gray-100 transition-colors text-sm">キャンセル</button>
              <button onClick={saveAll} className="px-8 py-3 rounded-xl font-bold text-white bg-slate-900 hover:bg-slate-800 shadow-lg shadow-slate-200 transition-all active:scale-95 text-sm flex items-center gap-2">
                <Save size={18}/> 変更を保存
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
