'use client';

import { useState, useEffect } from 'react';
import { auth, db } from '@/lib/firebase';
import { collection, query, getDocs, where } from 'firebase/firestore';
import { MessageCircle, Send, Loader2, Users, Bell, AlertCircle, ArrowLeft, CheckCircle } from 'lucide-react';
import Link from 'next/link';

export default function MasterLineBroadcastPage() {
  const [teachers, setTeachers] = useState<any[]>([]);
  const [parents, setParents] = useState<any[]>([]);
  const [students, setStudents] = useState<any[]>([]);
  const [shifts, setShifts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [customMessage, setCustomMessage] = useState('');

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    setLoading(true);
    try {
      // 1. LINE連携済みのユーザーを取得
      const userSnap = await getDocs(collection(db, 'users'));
      const lineUsers = userSnap.docs.map(d => ({ id: d.id, ...d.data() } as any)).filter((u: any) => u.line_user_id);
      setTeachers(lineUsers.filter((u: any) => u.role === 'teacher'));
      setParents(lineUsers.filter((u: any) => u.role === 'parent' || u.role === 'guardian'));
      setStudents(lineUsers.filter((u: any) => u.role === 'student'));

      // 2. 今日のシフトを取得
      const today = new Date().toISOString().split('T')[0];
      const sQ = query(collection(db, 'shift_assignments'), where('target_date', '==', today));
      const sSnap = await getDocs(sQ);
      setShifts(sSnap.docs.map(d => ({ id: d.id, ...d.data() } as any)));
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  // メッセージ送信実行関数
  const executePush = async (tasks: { uid?: string; userId: string; role?: string; kind?: string; text: string }[]) => {
    if (tasks.length === 0) return alert('送信対象がいません。');
    if (!confirm(`${tasks.length}名にLINEを送信しますか？`)) return;

    setSending(true);
    try {
      const token = await auth.currentUser?.getIdToken();
      const res = await fetch('/api/line/push', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ tasks })
      });
      if (res.ok) {
        alert('送信が完了しました！');
        setCustomMessage('');
      } else {
        alert('送信に失敗しました。');
      }
    } catch (e) {
      alert('エラーが発生しました。');
    } finally {
      setSending(false);
    }
  };

  // ① 当日リマインドの作成と送信
  const handleSendReminders = () => {
    const tasks: any[] = [];
    
    teachers.forEach(teacher => {
      // この講師の今日のシフトを抽出
      const myShifts = shifts.filter(s => s.user_id === teacher.id);
      if (myShifts.length > 0) {
        // 時刻順などで並び替えや成形
        const shiftDetails = myShifts.map(s => `・${s.note} ${s.target_subject || s.role_type}`).join('\n');
        
        const messageText = `${teacher.name}先生\n\nおはようございます！\n本日の授業予定をお知らせします。\n\n${shiftDetails}\n\n本日もよろしくお願いいたします。`;
        
        tasks.push({ uid: teacher.id, userId: teacher.line_user_id, role: 'teacher', kind: 'class_start', text: messageText });
      }
    });

    executePush(tasks);
  };

  // ② シフト提出お願いの送信
  const handleSendShiftRequest = () => {
    const tasks = teachers.map(t => ({
      uid: t.id,
      userId: t.line_user_id,
      role: 'teacher',
      text: `${t.name}先生\n\nお疲れ様です。運営よりお知らせです。\n\n次回のシフト提出期限が近づいております。\nシステムにログインの上、提出をお願いいたします！`
    }));
    executePush(tasks);
  };

  // ③ 自由メッセージの送信
  const handleSendCustom = () => {
    if (!customMessage.trim()) return alert('メッセージを入力してください');
    const targets = [...teachers, ...parents, ...students];
    const tasks = targets.map(t => ({
      uid: t.id,
      userId: t.line_user_id,
      role: t.role || 'student',
      kind: 'announcements',
      text: `${t.name || t.student_name || t.display_name || 'ご利用者'}様\n\n${customMessage}`
    }));
    executePush(tasks);
  };

  if (loading) return <div className="min-h-screen flex items-center justify-center"><Loader2 className="animate-spin text-indigo-500" size={32}/></div>;

  return (
    <div className="min-h-screen bg-slate-50 p-6 pb-32 font-sans text-slate-800">
      <div className="max-w-3xl mx-auto space-y-6">
        
        <div className="flex items-center gap-4 bg-white p-4 rounded-2xl shadow-sm border border-slate-200">
          <Link href="/master" className="bg-slate-100 p-2 rounded-full hover:bg-slate-200 transition-colors">
            <ArrowLeft size={20} />
          </Link>
          <div>
            <h1 className="text-xl font-black text-slate-800 flex items-center gap-2">
              <MessageCircle className="text-[#06C755]" /> LINE一斉送信
            </h1>
            <p className="text-xs text-slate-500 mt-1">連携済みの講師・保護者・生徒へLINEメッセージを送信します</p>
          </div>
        </div>

        <div className="bg-[#06C755]/10 border border-[#06C755]/20 p-4 rounded-2xl flex items-center justify-between">
          <div className="flex items-center gap-2 text-[#06C755] font-bold">
            <CheckCircle size={20}/> LINE連携済み
          </div>
          <div className="text-right">
            <div className="text-2xl font-black text-[#06C755]">{teachers.length + parents.length + students.length} <span className="text-sm">名</span></div>
            <p className="text-[11px] font-bold text-slate-400">講師 {teachers.length} / 保護者 {parents.length} / 生徒 {students.length}</p>
          </div>
        </div>

        <div className="grid md:grid-cols-2 gap-4">
          {/* 当日リマインド */}
          <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200 flex flex-col">
            <h3 className="font-bold flex items-center gap-2 mb-2 text-indigo-700"><Bell size={18}/> 本日の授業リマインド</h3>
            <p className="text-xs text-slate-500 mb-6 leading-relaxed flex-1">
              本日のシフトが入っている講師を自動で抽出し、担当する時間と授業内容をまとめてLINEに送信します。
            </p>
            <button 
              onClick={handleSendReminders} disabled={sending}
              className="w-full bg-indigo-600 text-white font-bold py-3 rounded-xl hover:bg-indigo-700 transition-all flex items-center justify-center gap-2 active:scale-95 disabled:opacity-50"
            >
              {sending ? <Loader2 size={18} className="animate-spin"/> : <Send size={18}/>} リマインドを送信
            </button>
          </div>

          {/* シフト提出お願い */}
          <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200 flex flex-col">
            <h3 className="font-bold flex items-center gap-2 mb-2 text-orange-600"><AlertCircle size={18}/> シフト提出のお願い</h3>
            <p className="text-xs text-slate-500 mb-6 leading-relaxed flex-1">
              連携済みの全講師に対して、シフト提出期限が近づいていることを一斉送信します。
            </p>
            <button 
              onClick={handleSendShiftRequest} disabled={sending}
              className="w-full bg-orange-500 text-white font-bold py-3 rounded-xl hover:bg-orange-600 transition-all flex items-center justify-center gap-2 active:scale-95 disabled:opacity-50"
            >
              {sending ? <Loader2 size={18} className="animate-spin"/> : <Send size={18}/>} 提出依頼を送信
            </button>
          </div>
        </div>

        {/* 自由入力メッセージ */}
        <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200">
          <h3 className="font-bold flex items-center gap-2 mb-4 text-slate-700"><Users size={18}/> 自由入力で一斉送信</h3>
          <textarea 
            value={customMessage} onChange={e => setCustomMessage(e.target.value)}
            placeholder="授業連絡、登録依頼、代行募集などを入力してください..."
            className="w-full bg-slate-50 border border-slate-200 rounded-xl p-4 text-sm font-medium focus:ring-2 focus:ring-[#06C755] outline-none min-h-[120px] mb-4"
          />
          <button 
            onClick={handleSendCustom} disabled={sending || !customMessage.trim()}
            className="w-full bg-[#06C755] text-white font-bold py-3 rounded-xl hover:bg-[#05b34c] transition-all flex items-center justify-center gap-2 active:scale-95 disabled:opacity-50"
          >
            {sending ? <Loader2 size={18} className="animate-spin"/> : <MessageCircle size={18}/>} 全連携ユーザーへ送信
          </button>
        </div>

      </div>
    </div>
  );
}
