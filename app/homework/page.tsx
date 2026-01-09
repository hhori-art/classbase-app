'use client';

import { useState, useEffect } from 'react';
import { useAuth } from '@/app/context/AuthContext';
import { db } from '@/lib/firebase';
import { collection, query, orderBy, getDocs, where } from 'firebase/firestore';
import { ArrowLeft, BookOpen, Clock, CheckCircle, ChevronRight, AlertCircle, Loader2 } from 'lucide-react';
import Link from 'next/link';

export default function StudentHomeworkListPage() {
  const { user } = useAuth();
  const [assignments, setAssignments] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [submissionStatus, setSubmissionStatus] = useState<{[key:string]: boolean}>({});

  useEffect(() => {
    const fetchData = async () => {
      if (!user) return;
      try {
        const qAssign = query(collection(db, 'assignments'), orderBy('deadline', 'desc'));
        const assignSnap = await getDocs(qAssign);
        const assignList = assignSnap.docs.map(d => ({ id: d.id, ...d.data() }));
        setAssignments(assignList);

        const qSub = query(collection(db, 'submissions'), where('student_id', '==', user.uid));
        const subSnap = await getDocs(qSub);
        const statusMap: {[key:string]: boolean} = {};
        subSnap.forEach(d => { statusMap[d.data().assignment_id] = true; });
        setSubmissionStatus(statusMap);
      } catch (e) {
        console.error(e);
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, [user]);

  if (loading) return <div className="min-h-screen flex items-center justify-center bg-[#F0F4F8]"><Loader2 className="animate-spin text-gray-400"/></div>;

  return (
    <div className="min-h-screen bg-[#F0F4F8] p-6 pb-20 font-sans">
      <div className="max-w-lg mx-auto">
        
        <div className="flex items-center gap-4 mb-8">
          <Link href="/student" className="bg-white p-3 rounded-full shadow-sm text-gray-600 hover:bg-gray-50 transition-colors">
            <ArrowLeft size={20} />
          </Link>
          <div>
            <h1 className="text-2xl font-extrabold text-gray-800 flex items-center gap-2">
              <span className="bg-orange-100 text-orange-500 p-1.5 rounded-lg"><BookOpen size={24} /></span>
              課題クエスト
            </h1>
            <p className="text-xs text-gray-500 mt-1 font-bold">期限までにクリアしよう！</p>
          </div>
        </div>

        {assignments.length === 0 ? (
          <div className="p-10 text-center bg-white rounded-3xl border-2 border-dashed border-gray-200 text-gray-400">
            <BookOpen size={48} className="mx-auto mb-3 opacity-20"/>
            <p className="font-bold">現在クエストはありません</p>
          </div>
        ) : (
          <div className="grid gap-4">
            {assignments.map((assign) => {
              const isSubmitted = submissionStatus[assign.id];
              const isLate = new Date() > new Date(assign.deadline);
              
              return (
                <Link 
                  key={assign.id} 
                  href={`/student/homework/${assign.id}`} 
                  className="block group"
                >
                  <div className="bg-white p-5 rounded-3xl shadow-sm border border-gray-100 hover:border-orange-200 hover:shadow-md transition-all relative overflow-hidden transform hover:-translate-y-1">
                    
                    {/* ステータスバッジ */}
                    <div className="absolute top-4 right-4 z-10">
                      {isSubmitted ? (
                        <span className="flex items-center gap-1 text-[10px] font-bold bg-green-100 text-green-600 px-3 py-1.5 rounded-full border border-green-200 shadow-sm">
                          <CheckCircle size={12}/> CLEAR!
                        </span>
                      ) : isLate ? (
                        <span className="flex items-center gap-1 text-[10px] font-bold bg-red-100 text-red-600 px-3 py-1.5 rounded-full border border-red-200 animate-pulse">
                          <AlertCircle size={12}/> TIME OVER
                        </span>
                      ) : (
                        <span className="flex items-center gap-1 text-[10px] font-bold bg-blue-100 text-blue-600 px-3 py-1.5 rounded-full border border-blue-200">
                          <Clock size={12}/> CHALLENGE
                        </span>
                      )}
                    </div>

                    <div className="pr-16 relative z-10">
                      <span className={`inline-block px-2 py-0.5 rounded-md text-[10px] font-bold text-white mb-2 shadow-sm ${
                        assign.subject?.includes('理科') ? 'bg-gradient-to-r from-green-400 to-green-500' : 
                        assign.subject?.includes('社会') ? 'bg-gradient-to-r from-orange-400 to-orange-500' : 'bg-gradient-to-r from-blue-400 to-blue-500'
                      }`}>
                        {assign.subject || '課題'}
                      </span>
                      <h3 className="text-lg font-extrabold text-gray-800 line-clamp-1 mb-1 group-hover:text-orange-500 transition-colors">
                        {assign.title}
                      </h3>
                      <div className="flex items-center gap-2 text-xs text-gray-400 font-bold">
                        <Clock size={12}/>
                        LIMIT: {new Date(assign.deadline).toLocaleDateString()}
                      </div>
                    </div>
                    
                    {/* 装飾 */}
                    <div className="absolute -bottom-4 -right-4 w-24 h-24 bg-gray-50 rounded-full group-hover:bg-orange-50 transition-colors"></div>
                    <ChevronRight className="absolute bottom-5 right-5 text-gray-300 group-hover:text-orange-400 transition-colors" size={20}/>
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