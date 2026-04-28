'use client';

import { useState, useEffect } from 'react';
import { auth, db } from '@/lib/firebase';
import { collection, query, where, getDocs, addDoc, serverTimestamp, doc, getDoc } from 'firebase/firestore';
import { Loader2, MessageSquare, Star, X, Send, Trophy } from 'lucide-react';

// 型定義
type Student = {
  uid: string;
  student_name?: string;
  grade?: string;
};

type Shift = {
  id: string;
  target_date: string;
  note: string;
  teacher_name: string;
  user_id: string;
  target_grade: string;
  target_subject: string;
  target_detail_subject: string;
};

type SurveyQuestion = {
  id: number;
  text: string;
  type: 'rating' | 'text';
};

export default function PendingSurveys({ student }: { student: Student }) {
  const [loading, setLoading] = useState(true);
  const [pendingClasses, setPendingClasses] = useState<Shift[]>([]);
  
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedClass, setSelectedClass] = useState<Shift | null>(null);
  const [questions, setQuestions] = useState<SurveyQuestion[]>([]);
  const [answers, setAnswers] = useState<{[key: number]: any}>({});
  const [submitting, setSubmitting] = useState(false);
  
  // 自動ポップアップ制御用フラグ（1回のアクセスで何度も開かないようにする）
  const [hasAutoOpened, setHasAutoOpened] = useState(false);

  useEffect(() => {
    if (!student) return;
    fetchPendingSurveys();
  }, [student]);

  const fetchPendingSurveys = async () => {
    setLoading(true);
    try {
      const today = new Date().toISOString().split('T')[0];
      
      // 1. 今日のシフトを取得
      const q = query(
        collection(db, 'shift_assignments'),
        where('target_date', '==', today),
        where('role_type', '==', 'main')
      );
      
      const shiftSnap = await getDocs(q);
      let shifts = shiftSnap.docs.map(d => ({ id: d.id, ...d.data() } as Shift));

      // 2. 学年フィルタ
      if (student.grade) {
        shifts = shifts.filter(s => s.target_grade === student.grade);
      }

      // 3. 回答済み除外
      const responseQ = query(
        collection(db, 'survey_responses'),
        where('student_id', '==', student.uid),
        where('target_date', '==', today)
      );
      const responseSnap = await getDocs(responseQ);
      const answeredShiftIds = new Set(responseSnap.docs.map(d => d.data().shift_id));

      const pending = shifts.filter(s => !answeredShiftIds.has(s.id));
      setPendingClasses(pending);

      // ★追加: 未回答があり、かつまだ自動で開いていなければ、最初の1件を自動で開く
      if (pending.length > 0 && !hasAutoOpened) {
        // 少し遅延させて開く（画面描画を待つため）
        setTimeout(() => {
          setSelectedClass(pending[0]);
          setAnswers({});
          setIsModalOpen(true);
          setHasAutoOpened(true);
        }, 800);
      }

      // 4. テンプレート取得
      try {
        const tmplSnap = await getDoc(doc(db, 'survey_templates', 'default'));
        if (tmplSnap.exists() && tmplSnap.data().questions) {
          setQuestions(tmplSnap.data().questions);
        }
      } catch (e) {
        console.error("Template fetch error", e);
      }

    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const openSurveyModal = (cls: Shift) => {
    setSelectedClass(cls);
    setAnswers({});
    setIsModalOpen(true);
  };

  const handleSubmit = async () => {
    if (!selectedClass || !student) return;
    
    const missing = questions.filter(q => q.type === 'rating' && !answers[q.id]);
    if (missing.length > 0) {
      alert('評価項目はすべて入力してください。');
      return;
    }

    setSubmitting(true);
    try {
      // 1. 回答を保存
      await addDoc(collection(db, 'survey_responses'), {
        student_id: student.uid,
        student_name: student.student_name || '名無し',
        teacher_id: selectedClass.user_id || '', 
        teacher_name: selectedClass.teacher_name,
        shift_id: selectedClass.id,
        target_date: selectedClass.target_date,
        subject: selectedClass.target_subject,
        answers: answers,
        created_at: serverTimestamp()
      });

      const rewardCoins = 10;
      const token = await auth.currentUser?.getIdToken();
      if (!token) throw new Error('ログイン情報を確認できません');
      const rewardRes = await fetch('/api/coin-transactions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ action: 'survey_reward', shift_id: selectedClass.id }),
      });
      const rewardData = await rewardRes.json().catch(() => ({}));
      if (!rewardRes.ok || rewardData.ok === false) throw new Error(rewardData.error || 'reward failed');
      
      alert(rewardData.applied ? `回答ありがとうございました！\nボーナスとして ${rewardCoins}コイン GETしました！` : '回答ありがとうございました！この授業の回答ボーナスは受取済みです。');
      
      setIsModalOpen(false);
      // リスト更新（次の未回答があればそれが表示される）
      fetchPendingSurveys(); 
      
    } catch (e) {
      console.error(e);
      alert('送信エラーが発生しました');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) return null;
  if (pendingClasses.length === 0) return null;

  return (
    <>
      {/* 未回答リスト表示エリア */}
      <div className="bg-gradient-to-r from-rose-50 to-orange-50 border-2 border-rose-100 rounded-2xl p-5 mb-8 shadow-md animate-in slide-in-from-top-2 relative overflow-hidden">
        {/* 目立たせるための装飾 */}
        <div className="absolute -right-4 -top-4 bg-rose-500 text-white text-[10px] font-bold px-3 py-1 rotate-12 shadow-sm">
          未回答
        </div>

        <h3 className="font-bold text-rose-800 flex items-center gap-2 mb-4 text-sm">
          <MessageSquare size={20} className="text-rose-500 animate-bounce"/> 今日の授業アンケート
          <span className="text-[10px] bg-rose-100 text-rose-600 px-2 py-0.5 rounded-full font-bold">
            残り {pendingClasses.length}件
          </span>
        </h3>
        
        <p className="text-xs text-slate-500 mb-3 font-bold">
          回答すると <span className="text-yellow-600">🪙コイン</span> がもらえます！
        </p>

        <div className="grid gap-3">
          {pendingClasses.map(cls => (
            <div key={cls.id} className="bg-white p-4 rounded-xl border border-rose-100 flex justify-between items-center shadow-sm hover:shadow-md transition-shadow">
              <div>
                <div className="font-bold text-slate-800 text-sm flex items-center gap-2">
                  <span className="text-xs bg-slate-100 text-slate-500 px-2 py-0.5 rounded">{cls.note.replace(/[【】]/g, '')}</span>
                  {cls.target_subject}
                </div>
                <div className="text-xs text-slate-500 mt-1 flex items-center gap-1">
                  担当: <span className="font-bold text-slate-700">{cls.teacher_name}</span> 先生
                </div>
              </div>
              <button 
                onClick={() => openSurveyModal(cls)}
                className="bg-rose-500 hover:bg-rose-600 text-white text-xs font-bold px-5 py-2.5 rounded-full transition-all shadow-md shadow-rose-200 flex items-center gap-1 active:scale-95"
              >
                回答する
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* 回答モーダル */}
      {isModalOpen && selectedClass && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-[200] p-4 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-white rounded-3xl w-full max-w-lg shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
            
            {/* ヘッダー */}
            <div className="bg-slate-800 text-white p-5 shrink-0 flex justify-between items-start">
              <div>
                <h3 className="font-bold text-lg flex items-center gap-2">
                  授業アンケート <span className="bg-yellow-500 text-slate-900 text-[10px] px-2 py-0.5 rounded-full flex items-center gap-1"><Trophy size={10}/> コイン対象</span>
                </h3>
                <div className="flex items-center gap-2 text-xs opacity-80 mt-1">
                  <span className="bg-white/20 px-2 py-0.5 rounded">{selectedClass.target_subject}</span>
                  <span>{selectedClass.teacher_name} 先生</span>
                </div>
              </div>
              {/* 強制的に答えさせたい場合は、この閉じるボタンを削除または小さくする手もあります */}
              <button onClick={() => setIsModalOpen(false)} className="text-slate-400 hover:text-white transition-colors bg-white/10 p-1.5 rounded-full"><X size={20}/></button>
            </div>
            
            {/* 質問リスト */}
            <div className="p-6 overflow-y-auto custom-scrollbar bg-slate-50">
              <div className="space-y-6">
                {questions.map(q => (
                  <div key={q.id} className="bg-white p-5 rounded-2xl border border-slate-100 shadow-sm">
                    <label className="block text-sm font-bold text-slate-700 mb-3">
                      Q. {q.text}
                      {q.type === 'rating' && <span className="text-rose-500 ml-1 text-xs">(必須)</span>}
                    </label>
                    
                    {q.type === 'rating' ? (
                      <div className="flex justify-between items-center px-1">
                        {[1, 2, 3, 4, 5].map(num => (
                          <button
                            key={num}
                            onClick={() => setAnswers({...answers, [q.id]: num})}
                            className={`flex flex-col items-center gap-1 group transition-all ${answers[q.id] === num ? 'scale-110' : 'hover:scale-105 opacity-60 hover:opacity-100'}`}
                          >
                            <div className={`w-12 h-12 rounded-full font-black text-lg flex items-center justify-center border-2 transition-all ${
                              answers[q.id] === num 
                                ? 'bg-indigo-600 text-white border-indigo-600 shadow-lg shadow-indigo-200' 
                                : 'bg-white text-slate-400 border-slate-200'
                            }`}>
                              {num}
                            </div>
                            <span className="text-[10px] font-bold text-slate-400">
                              {num === 1 ? '悪い' : num === 5 ? '良い' : ''}
                            </span>
                          </button>
                        ))}
                      </div>
                    ) : (
                      <textarea
                        className="w-full bg-slate-50 border border-slate-200 rounded-xl p-3 text-sm focus:ring-2 focus:ring-indigo-500 outline-none transition-all resize-none min-h-[100px]"
                        placeholder="感想や要望があれば入力してください..."
                        value={answers[q.id] || ''}
                        onChange={(e) => setAnswers({...answers, [q.id]: e.target.value})}
                      />
                    )}
                  </div>
                ))}
              </div>
            </div>

            {/* フッター */}
            <div className="p-5 border-t border-slate-100 bg-white flex justify-end gap-3 shrink-0">
              <button 
                onClick={() => setIsModalOpen(false)}
                className="px-6 py-3 text-sm font-bold text-slate-500 hover:bg-slate-100 rounded-xl transition-colors"
              >
                あとで
              </button>
              <button 
                onClick={handleSubmit}
                disabled={submitting}
                className="px-8 py-3 text-sm font-bold text-white bg-indigo-600 hover:bg-indigo-700 rounded-xl shadow-lg shadow-indigo-200 transition-all active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
              >
                {submitting ? <Loader2 className="animate-spin" size={18}/> : <Send size={18}/>}
                送信してコインGET
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
