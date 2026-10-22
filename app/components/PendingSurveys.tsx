'use client';

import { useState, useEffect } from 'react';
import { auth, db } from '@/lib/firebase';
import { collection, query, where, getDocs, doc, getDoc } from 'firebase/firestore';
import { MessageSquare, Send, Trophy } from 'lucide-react';
import { jstDateKey } from '@/lib/date-key';
import { Button, Modal, useToast } from '@/app/components/ui';

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
  const toast = useToast();
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
      const today = jstDateKey();
      
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
      toast.error('評価項目はすべて入力してください。');
      return;
    }

    setSubmitting(true);
    try {
      const rewardCoins = 10;
      const token = await auth.currentUser?.getIdToken();
      if (!token) throw new Error('ログイン情報を確認できません');
      const rewardRes = await fetch('/api/coin-transactions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ action: 'survey_reward', shift_id: selectedClass.id, answers }),
      });
      const rewardData = await rewardRes.json().catch(() => ({}));
      if (!rewardRes.ok || rewardData.ok === false) throw new Error(rewardData.error || 'reward failed');
      
      toast.success(rewardData.applied ? `回答ありがとうございました！ボーナスとして ${rewardCoins}コイン GETしました！` : '回答ありがとうございました！この授業の回答ボーナスは受取済みです。');
      
      setIsModalOpen(false);
      // リスト更新（次の未回答があればそれが表示される）
      fetchPendingSurveys(); 
      
    } catch (e) {
      console.error(e);
      toast.error('アンケートを送信できませんでした。通信状態を確認して、もう一度お試しください。');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) return null;
  if (pendingClasses.length === 0) return null;

  return (
    <>
      {/* 未回答リスト表示エリア */}
      <div className="cb-card relative mb-8 overflow-hidden !border-2 !border-rose-100 p-card animate-in slide-in-from-top-2">
        {/* 目立たせるための装飾 */}
        <div className="absolute -right-4 -top-4 rotate-12 bg-rose-500 px-4 pb-1 pt-5 text-xs font-bold text-white shadow-sm">
          未回答
        </div>

        <h3 className="mb-4 flex items-center gap-2 text-sm font-bold text-rose-800">
          <MessageSquare size={20} aria-hidden className="text-rose-500 motion-safe:animate-bounce" /> 今日の授業アンケート
          <span className="rounded-full bg-rose-100 px-2 py-0.5 text-xs font-bold text-rose-600">
            残り {pendingClasses.length}件
          </span>
        </h3>

        <p className="mb-3 text-xs font-medium text-fg-muted">
          回答すると <span className="font-bold text-amber-600">🪙コイン</span> がもらえます！
        </p>

        <div className="grid gap-3">
          {pendingClasses.map(cls => (
            <div key={cls.id} className="flex items-center justify-between gap-3 rounded-btn border border-rose-100 bg-surface p-4 shadow-sm transition-shadow hover:shadow-md">
              <div className="min-w-0">
                <div className="flex items-center gap-2 text-sm font-bold text-fg">
                  <span className="rounded bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">{cls.note.replace(/[【】]/g, '')}</span>
                  {cls.target_subject}
                </div>
                <div className="mt-1 flex items-center gap-1 text-xs text-fg-muted">
                  担当: <span className="font-bold text-fg">{cls.teacher_name}</span> 先生
                </div>
              </div>
              <button
                type="button"
                onClick={() => openSurveyModal(cls)}
                className="inline-flex min-h-11 shrink-0 items-center gap-1 rounded-full bg-rose-500 px-5 text-sm font-bold text-white shadow-md shadow-rose-200 transition-all hover:bg-rose-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-400 focus-visible:ring-offset-2 active:scale-95"
              >
                回答する
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* 回答モーダル */}
      <Modal
        open={isModalOpen && Boolean(selectedClass)}
        onClose={() => setIsModalOpen(false)}
        title="授業アンケート"
        description={selectedClass ? (
          <span className="flex flex-wrap items-center gap-2 text-xs">
            <span className="flex items-center gap-1 rounded-full bg-amber-400 px-2 py-0.5 font-bold text-slate-900"><Trophy size={12} aria-hidden /> コイン対象</span>
            <span className="rounded bg-accent-soft px-2 py-0.5 font-bold text-fg">{selectedClass.target_subject}</span>
            <span>{selectedClass.teacher_name} 先生</span>
          </span>
        ) : undefined}
        footer={(
          <>
            <Button variant="ghost" onClick={() => setIsModalOpen(false)}>
              あとで
            </Button>
            <Button
              onClick={handleSubmit}
              loading={submitting}
              icon={<Send size={18} aria-hidden />}
            >
              送信してコインGET
            </Button>
          </>
        )}
      >
            {/* 質問リスト */}
            <div className="-mx-5 -my-4 bg-canvas px-5 py-4">
              <div className="space-y-6">
                {questions.map(q => (
                  <div key={q.id} className="cb-card p-card">
                    <label className="mb-3 block text-sm font-bold text-fg">
                      Q. {q.text}
                      {q.type === 'rating' && <span className="ml-1 text-xs text-danger">(必須)</span>}
                    </label>

                    {q.type === 'rating' ? (
                      <div className="flex items-center justify-between px-1">
                        {[1, 2, 3, 4, 5].map(num => (
                          <button
                            key={num}
                            type="button"
                            aria-pressed={answers[q.id] === num}
                            aria-label={`${num}${num === 1 ? '（悪い）' : num === 5 ? '（良い）' : ''}`}
                            onClick={() => setAnswers({...answers, [q.id]: num})}
                            className={`group flex flex-col items-center gap-1 rounded-full transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${answers[q.id] === num ? 'scale-110' : 'opacity-60 hover:scale-105 hover:opacity-100'}`}
                          >
                            <div className={`flex h-12 w-12 items-center justify-center rounded-full border-2 text-lg font-black transition-all ${
                              answers[q.id] === num
                                ? 'border-accent bg-accent text-accent-ink shadow-lg'
                                : 'border-line bg-surface text-fg-muted'
                            }`}>
                              {num}
                            </div>
                            <span className="min-h-4 text-xs font-bold text-fg-muted">
                              {num === 1 ? '悪い' : num === 5 ? '良い' : ''}
                            </span>
                          </button>
                        ))}
                      </div>
                    ) : (
                      <textarea
                        className="min-h-[100px] w-full resize-none rounded-input border border-line bg-canvas p-3 text-sm text-fg outline-none transition-all focus:border-accent focus:ring-2 focus:ring-accent/30"
                        placeholder="感想や要望があれば入力してください..."
                        value={answers[q.id] || ''}
                        onChange={(e) => setAnswers({...answers, [q.id]: e.target.value})}
                      />
                    )}
                  </div>
                ))}
              </div>
            </div>

      </Modal>
    </>
  );
}
