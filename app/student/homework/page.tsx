'use client';

import { useState, useEffect } from 'react';
import { useAuth } from '@/app/context/AuthContext';
import { db } from '@/lib/firebase';
import { collection, query, orderBy, getDocs, where } from 'firebase/firestore';
import { ArrowLeft, BookOpen, Clock, CheckCircle, ChevronRight, AlertCircle, Loader2, Calendar } from 'lucide-react';
import Link from 'next/link';

export default function StudentHomeworkListPage() {
  const { user } = useAuth();
  const [assignments, setAssignments] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  
  // 自分の提出状況を管理するマップ {課題ID: true/false}
  const [submissionStatus, setSubmissionStatus] = useState<{[key:string]: boolean}>({});

  useEffect(() => {
    const fetchData = async () => {
      if (!user) return;

      try {
        // 1. 課題一覧を取得 (締め切りが新しい順)
        const qAssign = query(collection(db, 'assignments'), orderBy('deadline', 'desc'));
        const assignSnap = await getDocs(qAssign);
        const assignList = assignSnap.docs.map(d => ({ id: d.id, ...d.data() }));

        setAssignments(assignList);

        // 2. 自分の提出済みデータを取得して、提出済みフラグを立てる
        const qSub = query(collection(db, 'submissions'), where('student_id', '==', user.uid));
        const subSnap = await getDocs(qSub);
        
        const statusMap: {[key:string]: boolean} = {};
        subSnap.forEach(d => {
          const data = d.data();
          statusMap[data.assignment_id] = true;
        });
        setSubmissionStatus(statusMap);

      } catch (e) {
        console.error(e);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [user]);

  if (loading) return <div className="min-h-screen flex items-center justify-center bg-indigo-50"><Loader2 className="animate-spin text-indigo-400" size={40}/></div>;

  return (
    <div className="min-h-screen bg-indigo-50/50 p-4 pb-24 font-sans sm:p-8">
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
              課題一覧
            </h1>
            <p className="text-xs font-bold text-gray-400 mt-1 pl-1">期限を守ってスキルアップ！</p>
          </div>
        </div>

        {/* リスト表示 */}
        {assignments.length === 0 ? (
          <div className="py-16 px-6 text-center bg-white rounded-[32px] border-4 border-dashed border-indigo-100 text-gray-400 flex flex-col items-center">
            <div className="bg-indigo-50 p-6 rounded-full mb-4">
              <BookOpen size={48} className="text-indigo-200"/>
            </div>
            <p className="font-bold text-lg">現在出されている課題はありません</p>
            <p className="text-sm mt-2 opacity-70">ゆっくり休んでね！</p>
          </div>
        ) : (
          <div className="space-y-4">
            {assignments.map((assign) => {
              const isSubmitted = submissionStatus[assign.id];
              const isLate = new Date() > new Date(assign.deadline);
              
              // 科目による色分け
              const isScience = assign.subject?.includes('理科') || ['物理','化学','生物','地学'].some(s => assign.subject?.includes(s));
              const isSociety = assign.subject?.includes('社会') || ['地理','歴史','公民'].some(s => assign.subject?.includes(s));
              
              const subjectColor = isScience ? 'bg-purple-100 text-purple-600' : isSociety ? 'bg-pink-100 text-pink-600' : 'bg-blue-100 text-blue-600';

              return (
                <Link 
                  key={assign.id} 
                  href={`/student/homework/${assign.id}`} 
                  className="block group"
                >
                  <div className="bg-white p-5 sm:p-6 rounded-[32px] shadow-sm border border-gray-100 hover:border-indigo-200 hover:shadow-xl hover:shadow-indigo-100 hover:-translate-y-1 transition-all duration-300 relative overflow-hidden">
                    
                    {/* ステータスバッジ (絶対配置) */}
                    <div className="absolute top-0 right-0 p-5">
                      {isSubmitted ? (
                        <span className="flex items-center gap-1.5 text-[11px] font-black bg-green-100 text-green-600 px-3 py-1.5 rounded-full shadow-sm">
                          <CheckCircle size={14} strokeWidth={3}/> 提出済
                        </span>
                      ) : isLate ? (
                        <span className="flex items-center gap-1.5 text-[11px] font-black bg-red-100 text-red-600 px-3 py-1.5 rounded-full shadow-sm">
                          <AlertCircle size={14} strokeWidth={3}/> 期限切
                        </span>
                      ) : (
                        <span className="flex items-center gap-1.5 text-[11px] font-black bg-blue-100 text-blue-600 px-3 py-1.5 rounded-full shadow-sm">
                          <Clock size={14} strokeWidth={3}/> 受付中
                        </span>
                      )}
                    </div>

                    <div className="pr-20">
                      {/* 科目ラベル */}
                      <span className={`inline-block px-3 py-1 rounded-lg text-[10px] font-black mb-3 ${subjectColor}`}>
                        {assign.subject || '課題'}
                      </span>
                      
                      <h3 className="text-lg sm:text-xl font-black text-gray-800 line-clamp-2 mb-3 leading-tight group-hover:text-indigo-600 transition-colors">
                        {assign.title}
                      </h3>
                      
                      <div className="flex items-center gap-2 text-xs font-bold text-gray-400 bg-gray-50 inline-flex px-3 py-1.5 rounded-lg">
                        <Calendar size={14}/>
                        <span>期限: {new Date(assign.deadline).toLocaleDateString()}</span>
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