'use client';

import { useState, useEffect } from 'react';
import Calendar from 'react-calendar';
import 'react-calendar/dist/Calendar.css'; 
import { db } from '@/lib/firebase';
import { collection, query, getDocs, orderBy } from 'firebase/firestore';
import { CalendarCheck, ChevronRight, Clock, Loader2 } from 'lucide-react';
import Link from 'next/link';

type Value = Date | null | [Date | null, Date | null];

export default function CalendarWidget() {
  const [date, setDate] = useState<Value>(new Date());
  const [assignments, setAssignments] = useState<any[]>([]);
  const [selectedTasks, setSelectedTasks] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  // Firestoreから課題データを取得
  useEffect(() => {
    const fetchData = async () => {
      try {
        // 全課題を取得してクライアント側でフィルタリング
        // (データ量が増えたら where('deadline', '>=', startOfMonth) などで範囲を絞るべきですが、現状は全件でOK)
        const q = query(collection(db, 'assignments'), orderBy('deadline', 'asc'));
        const snapshot = await getDocs(q);
        const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        setAssignments(data);
      } catch (e) {
        console.error(e);
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, []);

  // 日付が変わった時の処理
  useEffect(() => {
    if (date instanceof Date) {
      const dateStr = date.toISOString().split('T')[0];
      // タイムゾーンのズレを考慮し、文字列比較で簡易マッチング
      // ※本格運用では date-fns などのライブラリ使用を推奨
      const tasks = assignments.filter((a: any) => a.deadline && a.deadline.startsWith(dateStr));
      setSelectedTasks(tasks);
    }
  }, [date, assignments]);

  const getTileContent = ({ date, view }: { date: Date; view: string }) => {
    if (view === 'month') {
      const dateStr = date.toISOString().split('T')[0];
      const hasDeadline = assignments.some((a: any) => a.deadline && a.deadline.startsWith(dateStr));
      if (hasDeadline) return <div className="dot-marker"></div>;
    }
    return null;
  };

  // 今日以降の直近の予定
  const todayStr = new Date().toISOString().split('T')[0];
  const upcomingTasks = assignments.filter((a: any) => a.deadline >= todayStr);

  return (
    <div className="bg-white p-5 rounded-2xl shadow-sm border border-gray-100 overflow-hidden w-full">
      <h2 className="text-sm font-bold text-gray-700 mb-4 flex items-center gap-2">
        <CalendarCheck className="text-orange-500" size={18} />
        学習カレンダー
      </h2>

      {loading ? (
        <div className="flex justify-center py-10"><Loader2 className="animate-spin text-gray-300"/></div>
      ) : (
        <>
          {/* カレンダー本体: カスタムクラス calendar-custom を適用 */}
          <div className="mb-6 w-full calendar-custom">
            <Calendar
              onChange={setDate}
              value={date}
              locale="ja-JP"
              tileContent={getTileContent}
              next2Label={null}
              prev2Label={null}
              formatDay={(locale, date) => date.getDate().toString()}
              className="w-full border-none font-bold text-gray-700 text-sm"
            />
          </div>

          {/* 選択した日のタスク */}
          {selectedTasks.length > 0 && (
            <div className="bg-blue-50 p-4 rounded-xl mb-4 border border-blue-100 animate-in slide-in-from-top-2">
              <h3 className="text-xs font-bold text-blue-800 mb-2">
                 {date instanceof Date ? `${date.getMonth() + 1}/${date.getDate()}` : ''} の提出期限
              </h3>
              <div className="space-y-2">
                {selectedTasks.map((task) => (
                  <Link href={`/student/homework/${task.id}`} key={task.id} className="block no-underline">
                    <div className="bg-white p-3 rounded-lg border border-blue-200 flex items-center justify-between shadow-sm hover:bg-blue-50 transition-colors">
                      <div className="flex items-center gap-2 overflow-hidden">
                        <span className={`text-[10px] px-2 py-0.5 rounded-full text-white shrink-0 ${task.subject?.includes('理科') ? 'bg-green-500' : 'bg-orange-500'}`}>
                          {task.subject}
                        </span>
                        <span className="text-sm font-bold text-gray-800 truncate">{task.title}</span>
                      </div>
                      <ChevronRight size={16} className="text-gray-400 shrink-0" />
                    </div>
                  </Link>
                ))}
              </div>
            </div>
          )}

          {/* 直近の予定 */}
          <div className="border-t border-gray-100 pt-4">
            <h3 className="text-xs font-bold text-gray-400 mb-3 ml-1">今後の予定</h3>
            <div className="space-y-2">
              {upcomingTasks.slice(0, 3).map((task) => (
                <Link href={`/student/homework/${task.id}`} key={task.id} className="block group no-underline">
                  <div className="flex items-center gap-3 p-2 hover:bg-gray-50 rounded-lg transition-colors">
                    <div className="bg-gray-100 text-gray-600 rounded-lg p-2 text-center w-12 shrink-0 group-hover:bg-white group-hover:shadow-sm transition-all">
                      <div className="text-[10px] font-bold">{new Date(task.deadline).getMonth() + 1}月</div>
                      <div className="text-lg font-bold leading-none">{new Date(task.deadline).getDate()}</div>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className={`w-2 h-2 shrink-0 rounded-full ${task.subject?.includes('理科') ? 'bg-green-500' : 'bg-orange-500'}`}></span>
                        <span className="text-sm font-bold text-gray-800 truncate">{task.title}</span>
                      </div>
                      <div className="text-xs text-gray-400 flex items-center gap-1">
                        <Clock size={10} /> {new Date(task.deadline).toLocaleDateString('ja-JP', { weekday: 'short' })}曜日まで
                      </div>
                    </div>
                    <ChevronRight size={16} className="text-gray-300 group-hover:text-blue-500" />
                  </div>
                </Link>
              ))}
              {upcomingTasks.length === 0 && (
                 <div className="text-center text-xs text-gray-400 py-4 bg-gray-50 rounded-lg border border-dashed border-gray-200">
                   予定はありません
                 </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}