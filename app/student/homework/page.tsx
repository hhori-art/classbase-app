'use client';

import { useState, useEffect } from 'react';
import { useAuth } from '@/app/context/AuthContext';
import { db } from '@/lib/firebase';
import { collection, query, orderBy, getDocs, where, doc, getDoc } from 'firebase/firestore';
import { ArrowLeft, BookOpen, Clock, CheckCircle, ChevronRight, AlertCircle, Loader2, Calendar, FileText, ExternalLink, Smartphone, Monitor } from 'lucide-react';
import Link from 'next/link';

const MONOXER_WEB_URL = process.env.NEXT_PUBLIC_MONOXER_WEB_URL || 'https://app.monoxer.com/';
const MONOXER_APP_URL = process.env.NEXT_PUBLIC_MONOXER_APP_URL || 'monoxer://';
const MONOXER_APP_URLS = (process.env.NEXT_PUBLIC_MONOXER_APP_URLS || MONOXER_APP_URL)
  .split(',')
  .map(url => url.trim())
  .filter(Boolean);

const isMobileOrTablet = () => {
  if (typeof navigator === 'undefined') return false;
  return /iPhone|iPad|iPod|Android|Mobile|Tablet|Line|CriOS|FxiOS|EdgiOS/i.test(navigator.userAgent);
};

const openAppThenFallback = (appUrls: string[], webUrl: string) => {
  let completed = false;
  let timer: number;
  const cleanup = () => {
    completed = true;
    window.clearTimeout(timer);
    window.removeEventListener('pagehide', cleanup);
    document.removeEventListener('visibilitychange', handleVisibilityChange);
  };
  const handleVisibilityChange = () => {
    if (document.hidden) cleanup();
  };
  timer = window.setTimeout(() => {
    if (!completed && !document.hidden) window.location.href = webUrl;
  }, 1600);

  window.addEventListener('pagehide', cleanup, { once: true });
  document.addEventListener('visibilitychange', handleVisibilityChange);
  window.location.href = appUrls[0] || webUrl;
};

export default function StudentHomeworkListPage() {
  const { user } = useAuth();
  const [assignments, setAssignments] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [studentInfo, setStudentInfo] = useState<{ grade: string, subjects: string[] } | null>(null);
  
  // 自分の提出状況 {課題ID: true/false}
  const [submissionStatus, setSubmissionStatus] = useState<{[key:string]: boolean}>({});

  const openMonoxer = () => {
    if (isMobileOrTablet()) {
      openAppThenFallback(MONOXER_APP_URLS, MONOXER_WEB_URL);
      return;
    }
    window.open(MONOXER_WEB_URL, '_blank', 'noopener,noreferrer');
  };

  useEffect(() => {
    const fetchData = async () => {
      if (!user) return;

      try {
        // 1. 生徒のプロフィール（学年・受講科目）を取得
        const userDoc = await getDoc(doc(db, 'users', user.uid));
        if (!userDoc.exists()) throw new Error("User data not found");
        
        const userData = userDoc.data();
        const userGrade = userData.grade; // 例: "中2"
        // 受講科目が未設定の場合は空配列 (全科目表示を防ぐため、または初期設定として全科目を入れる運用も可)
        const userSubjects = userData.subjects || ['英語', '数学', '国語', '理科', '社会']; 

        setStudentInfo({ grade: userGrade, subjects: userSubjects });

        // 2. 学年に一致する課題を取得 (homework_assignmentsに変更)
        // ※自動作成システムは、授業終了時にこのコレクションにデータを追加している前提
        let qAssign;
        if (userGrade) {
          qAssign = query(
            collection(db, 'homework_assignments'), 
            where('target_grade', '==', userGrade), // 学年でまず絞る
            orderBy('deadline', 'desc')
          );
        } else {
          // 学年未設定の場合は全件取得（または表示なし）
          qAssign = query(collection(db, 'homework_assignments'), orderBy('deadline', 'desc'));
        }

        const assignSnap = await getDocs(qAssign);
        let assignList = assignSnap.docs.map(d => ({ id: d.id, ...d.data() } as any));

        // 3. 受講科目でフィルタリング (クライアントサイド)
        // 自動作成された宿題の科目が、生徒の受講科目リストに含まれているかチェック
        if (userSubjects.length > 0) {
          assignList = assignList.filter(assign => 
            // 科目が設定されていない、または受講科目リストに含まれている場合
            !assign.subject || userSubjects.includes(assign.subject)
          );
        }

        setAssignments(assignList);

        // 4. 自分の提出状況を取得
        const qSub = query(collection(db, 'submissions'), where('student_id', '==', user.uid));
        const subSnap = await getDocs(qSub);
        
        const statusMap: {[key:string]: boolean} = {};
        subSnap.forEach(d => {
          const data = d.data();
          statusMap[data.assignment_id] = true;
        });
        setSubmissionStatus(statusMap);

      } catch (e) {
        console.error("Data fetch error:", e);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [user]);

  if (loading) return <div className="min-h-screen flex items-center justify-center bg-indigo-50"><Loader2 className="animate-spin text-indigo-400" size={40}/></div>;

  return (
    <div className="min-h-screen bg-[#F0F4F8] p-4 pb-24 font-sans sm:p-8">
      <div className="max-w-xl mx-auto">
        
        {/* ヘッダー */}
        <div className="flex items-center gap-4 mb-8">
          <Link href="/student" className="bg-white p-4 rounded-full shadow-sm text-gray-400 hover:text-indigo-600 hover:shadow-md transition-all active:scale-95">
            <ArrowLeft size={24} strokeWidth={3} />
          </Link>
          <div>
            <h1 className="text-2xl font-black text-gray-800 flex items-center gap-2 tracking-tight">
              <span className="bg-orange-100 text-orange-500 p-2 rounded-xl">
                <BookOpen size={24} strokeWidth={3} />
              </span>
              Monoxer宿題
            </h1>
            <p className="text-xs font-bold text-gray-400 mt-1 pl-1">
              メインの宿題はMonoxerで取り組みます
            </p>
          </div>
        </div>

        <section className="mb-6 overflow-hidden rounded-[32px] bg-slate-950 text-white shadow-xl">
          <div className="p-6">
            <div className="flex items-start gap-4">
              <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-white/10">
                {typeof window !== 'undefined' && isMobileOrTablet() ? <Smartphone size={28} /> : <Monitor size={28} />}
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-xs font-black uppercase tracking-[0.2em] text-orange-200">Main Homework</p>
                <h2 className="mt-1 text-2xl font-black">Monoxerで宿題を進める</h2>
                <p className="mt-2 text-sm font-bold leading-relaxed text-slate-300">
                  スマホ・タブレットではMonoxerアプリ、PCではブラウザ版を開きます。
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={openMonoxer}
              className="mt-5 flex w-full items-center justify-center gap-2 rounded-2xl bg-white px-5 py-4 text-sm font-black text-slate-950 transition active:scale-[0.99]"
            >
              <ExternalLink size={18} /> Monoxerを開く
            </button>
          </div>
        </section>

        <div className="mb-4 flex items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-black text-slate-700">画像提出が必要な宿題</h2>
            <p className="text-xs font-bold text-slate-400">
              {studentInfo ? `${studentInfo.grade}の受講科目のみ表示中` : '全ての課題を表示中'}
            </p>
          </div>
        </div>

        {/* リスト表示 */}
        {assignments.length === 0 ? (
          <div className="py-16 px-6 text-center bg-white rounded-[32px] border-4 border-dashed border-indigo-100 text-gray-400 flex flex-col items-center">
            <div className="bg-indigo-50 p-6 rounded-full mb-4">
              <FileText size={48} className="text-indigo-200"/>
            </div>
            <p className="font-bold text-lg">現在、取り組むべき宿題はありません</p>
            <p className="text-sm mt-2 opacity-70">
              授業が終わるとここに追加されます。<br/>
              今はゆっくり休みましょう！
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {assignments.map((assign) => {
              const isSubmitted = submissionStatus[assign.id];
              const deadlineDate = new Date(assign.deadline);
              const today = new Date();
              // 期限切れ判定（当日中はOKとする場合などロジック調整可）
              const isLate = today > deadlineDate && !isSubmitted;
              
              // 科目による色分け
              const subj = assign.subject || '';
              const isScience = subj.includes('理科') || ['物理','化学','生物','地学'].some(s => subj.includes(s));
              const isSociety = subj.includes('社会') || ['地理','歴史','公民'].some(s => subj.includes(s));
              const isEnglish = subj.includes('英語');
              const isMath = subj.includes('数学');
              
              let subjectColor = 'bg-gray-100 text-gray-600';
              if (isScience) subjectColor = 'bg-green-100 text-green-700';
              else if (isSociety) subjectColor = 'bg-yellow-100 text-yellow-700';
              else if (isEnglish) subjectColor = 'bg-orange-100 text-orange-700';
              else if (isMath) subjectColor = 'bg-blue-100 text-blue-700';

              return (
                <Link 
                  key={assign.id} 
                  href={`/student/homework/${assign.id}`} 
                  className="block group"
                >
                  <div className={`bg-white p-5 sm:p-6 rounded-[32px] shadow-sm border transition-all duration-300 relative overflow-hidden ${
                    isSubmitted 
                      ? 'border-green-100 opacity-80 hover:opacity-100 hover:shadow-green-100' 
                      : 'border-indigo-50 hover:border-indigo-300 hover:shadow-xl hover:shadow-indigo-100 hover:-translate-y-1'
                  }`}>
                    
                    {/* ステータスバッジ */}
                    <div className="absolute top-0 right-0 p-5">
                      {isSubmitted ? (
                        <span className="flex items-center gap-1.5 text-[10px] font-black bg-green-500 text-white px-3 py-1 rounded-full shadow-md shadow-green-200">
                          <CheckCircle size={12} strokeWidth={4}/> COMPLETE
                        </span>
                      ) : isLate ? (
                        <span className="flex items-center gap-1.5 text-[10px] font-black bg-red-500 text-white px-3 py-1 rounded-full shadow-md shadow-red-200 animate-pulse">
                          <AlertCircle size={12} strokeWidth={4}/> OVERDUE
                        </span>
                      ) : (
                        <span className="flex items-center gap-1.5 text-[10px] font-black bg-blue-500 text-white px-3 py-1 rounded-full shadow-md shadow-blue-200">
                          <Clock size={12} strokeWidth={4}/> OPEN
                        </span>
                      )}
                    </div>

                    <div className="pr-24">
                      {/* 科目ラベル & 自動作成のヒント */}
                      <div className="flex items-center gap-2 mb-3">
                        <span className={`inline-block px-3 py-1 rounded-lg text-[10px] font-black ${subjectColor}`}>
                          {assign.subject || '一般'}
                        </span>
                        {assign.class_date && (
                          <span className="text-[10px] text-gray-400 font-bold">
                            {new Date(assign.class_date).getMonth()+1}/{new Date(assign.class_date).getDate()} 授業分
                          </span>
                        )}
                      </div>
                      
                      <h3 className="text-lg sm:text-lg font-black text-gray-800 line-clamp-2 mb-3 leading-tight group-hover:text-indigo-600 transition-colors">
                        {assign.title}
                      </h3>
                      
                      <div className="flex items-center gap-2 text-xs font-bold text-gray-500 bg-gray-50 inline-flex px-3 py-1.5 rounded-xl">
                        <Calendar size={14} className={isLate ? "text-red-500" : "text-indigo-400"}/>
                        <span className={isLate ? "text-red-500" : ""}>
                          期限: {new Date(assign.deadline).toLocaleDateString()} まで
                        </span>
                      </div>
                    </div>
                    
                    {/* 矢印アイコン */}
                    <div className="absolute bottom-5 right-5 text-gray-300 group-hover:text-indigo-500 transition-colors">
                        <ChevronRight size={24} strokeWidth={3}/>
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
