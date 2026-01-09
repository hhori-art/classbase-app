'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { ClipboardList, Calendar, CalendarPlus, MessageCircle, Users, MonitorPlay, Phone, BarChart3, LogOut, Briefcase, Video, MapPin, User, Loader2, Star } from 'lucide-react';
import { auth, db } from '@/lib/firebase';
import { signOut } from 'firebase/auth';
import { collection, query, where, getDocs } from 'firebase/firestore';

import NewsWidget from '@/app/components/NewsWidget';
import RiskMonitorWidget from '@/app/components/RiskMonitorWidget';

// 閲覧用シフトデータの型定義
type ShiftAssignment = {
  id: string;
  teacher_name: string;
  target_date: string;
  role_type: 'main' | 'sub' | 'general';
  target_grade: string | null;
  target_subject: string | null;
  target_detail_subject: string | null;
  target_meeting_id?: string | null; // ★追加: Zoom ID
  unit: string | null;
  note: string;
  parent_id?: string;
};

// 表示用グループデータの型定義
type ClassGroup = {
  id: string;
  main: ShiftAssignment | null;
  subs: ShiftAssignment[];
  subject: string | null;
  grade: string | null;
  unit: string | null;
  place: string | null;
  url: string | null;
};

// ▼▼▼ シフト閲覧コンポーネント ▼▼▼
const ShiftViewer = ({ date, teacherName }: { date: string, teacherName: string }) => {
  const [assignments, setAssignments] = useState<ShiftAssignment[]>([]);
  const [urlMaster, setUrlMaster] = useState<{[key: string]: string}>({});
  const [loading, setLoading] = useState(true);
  const [dayOfWeek, setDayOfWeek] = useState('');

  useEffect(() => {
    const fetchShiftData = async () => {
      setLoading(true);
      try {
        // シフト取得
        const q = query(collection(db, 'shift_assignments'), where('target_date', '==', date));
        const snap = await getDocs(q);
        setAssignments(snap.docs.map(d => ({ id: d.id, ...d.data() } as ShiftAssignment)));

        // URLマスタ取得
        const uSnap = await getDocs(collection(db, 'subject_urls'));
        const urls: {[key: string]: string} = {};
        uSnap.forEach(d => { urls[d.id] = d.data().url; });
        setUrlMaster(urls);

        const d = new Date(date);
        setDayOfWeek(['日','月','火','水','木','金','土'][d.getDay()]);
      } catch (e) { console.error(e); } finally { setLoading(false); }
    };
    fetchShiftData();
  }, [date]);

  // データ整形ロジック
  const getAllClassesForSubject = (time: string, subject: string) => {
    const slotAssignments = assignments.filter(a => a.note.includes(`【${time}】`) && a.target_subject === subject);
    if (slotAssignments.length === 0) return [];

    const mains = slotAssignments.filter(a => a.role_type === 'main');
    const subs = slotAssignments.filter(a => a.role_type === 'sub');

    const classes: ClassGroup[] = mains.map(main => {
      const relatedSubs = subs.filter(sub => 
        sub.parent_id === main.id || 
        (!sub.parent_id && sub.target_grade === main.target_grade && sub.target_detail_subject === main.target_detail_subject)
      );

      // ★修正: Zoomリンク生成ロジック (Zoom ID優先)
      let joinUrl = null;
      if (main.target_meeting_id) {
        // Zoom IDがある場合は直接リンク生成 (スペース除去)
        joinUrl = `https://zoom.us/j/${main.target_meeting_id.replace(/\s/g, '')}`;
      } else if (main.target_detail_subject && dayOfWeek) {
        // なければURLマスタから取得
        joinUrl = urlMaster[`${main.target_detail_subject}_${dayOfWeek}`];
      }

      return {
        id: main.id,
        main,
        subs: relatedSubs,
        subject: main.target_subject,
        grade: main.target_grade,
        unit: main.unit,
        place: main.target_detail_subject,
        url: joinUrl // 生成したURLを設定
      };
    });

    const orphans = subs.filter(sub => 
      !mains.some(m => sub.parent_id === m.id || (!sub.parent_id && m.target_grade === sub.target_grade && m.target_detail_subject === sub.target_detail_subject))
    );
    
    if (orphans.length > 0) {
      classes.push({ 
        id: 'orphans', 
        main: null, 
        subs: orphans, 
        subject, 
        grade: '未割当', 
        unit: '-', 
        place: '-', 
        url: null 
      });
    }
    return classes.sort((a, b) => (a.grade || '').localeCompare(b.grade || ''));
  };

  const getGeneralSupport = (time: string) => assignments.filter(a => a.role_type === 'general' && a.note.includes(`【${time}】`));

  if (loading) return <div className="p-10 flex justify-center"><Loader2 className="animate-spin text-gray-400"/></div>;

  return (
    <div className="space-y-6">
      {['1限', '2限'].map(period => (
        <div key={period} className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
          <div className={`px-4 py-2 text-white font-bold text-sm flex items-center justify-between ${period === '1限' ? 'bg-blue-600' : 'bg-indigo-600'}`}>
            <span>{period} ({period === '1限' ? '19:20 - 20:25' : '20:35 - 21:40'})</span>
          </div>
          <div className="overflow-x-auto">
            <div className="flex min-w-max divide-x divide-gray-100">
              
              {/* 理科 */}
              <div className="flex flex-col p-3 gap-2 min-w-[300px]">
                <span className="text-xs font-bold text-emerald-700 bg-emerald-50 px-2 py-1 rounded inline-block w-fit">理科グループ</span>
                <div className="flex gap-3">
                  {getAllClassesForSubject(period, '理科').map(info => (
                    <ClassCard key={info.id} info={info} color="emerald" currentTeacherName={teacherName} />
                  ))}
                  {getAllClassesForSubject(period, '理科').length === 0 && <EmptyState text="授業なし"/>}
                </div>
              </div>

              {/* 社会 */}
              <div className="flex flex-col p-3 gap-2 min-w-[300px]">
                <span className="text-xs font-bold text-orange-700 bg-orange-50 px-2 py-1 rounded inline-block w-fit">社会グループ</span>
                <div className="flex gap-3">
                  {getAllClassesForSubject(period, '社会').map(info => (
                    <ClassCard key={info.id} info={info} color="orange" currentTeacherName={teacherName} />
                  ))}
                  {getAllClassesForSubject(period, '社会').length === 0 && <EmptyState text="授業なし"/>}
                </div>
              </div>

              {/* 全体サポート */}
              <div className="flex flex-col p-3 gap-2 min-w-[180px] bg-gray-50/50">
                <span className="text-xs font-bold text-gray-500 bg-gray-100 px-2 py-1 rounded inline-block w-fit">全体サポート</span>
                <div className="flex flex-col gap-2">
                  {getGeneralSupport(period).map(a => {
                    const isMe = a.teacher_name === teacherName;
                    return (
                      <div key={a.id} className={`p-2 rounded border shadow-sm text-xs font-bold flex items-center gap-2 transition-all ${isMe ? 'bg-indigo-600 text-white border-indigo-600 shadow-md scale-105' : 'bg-white text-gray-700 border-gray-200'}`}>
                        <User size={12} className={isMe ? 'text-white' : 'text-gray-400'}/> 
                        {a.teacher_name}
                        {isMe && <span className="ml-auto text-[8px] bg-white text-indigo-600 px-1.5 rounded">YOU</span>}
                      </div>
                    );
                  })}
                  {getGeneralSupport(period).length === 0 && <EmptyState text="なし" small/>}
                </div>
              </div>

            </div>
          </div>
        </div>
      ))}
    </div>
  );
};

// 授業カード (自分をハイライト)
const ClassCard = ({ info, color, currentTeacherName }: { info: ClassGroup, color: 'emerald' | 'orange', currentTeacherName: string }) => {
  const isEmerald = color === 'emerald';
  const isMyMain = info.main?.teacher_name === currentTeacherName;

  let bgHeader = isEmerald ? 'bg-emerald-50' : 'bg-orange-50';
  let textHeader = isEmerald ? 'text-emerald-800' : 'text-orange-800';
  let border = isEmerald ? 'border-emerald-100' : 'border-orange-100';
  const badge = isEmerald ? 'bg-emerald-100 text-emerald-700' : 'bg-orange-100 text-orange-700';
  const btn = isEmerald ? 'bg-emerald-500 hover:bg-emerald-600' : 'bg-orange-500 hover:bg-orange-600';

  if (isMyMain) {
    border = isEmerald ? 'border-emerald-500 ring-2 ring-emerald-200' : 'border-orange-500 ring-2 ring-orange-200';
    bgHeader = isEmerald ? 'bg-emerald-100' : 'bg-orange-100';
  }

  return (
    <div className={`w-[200px] bg-white border-2 ${border} rounded-xl shadow-sm flex flex-col overflow-hidden shrink-0 transition-all ${isMyMain ? 'shadow-md transform scale-[1.02]' : ''}`}>
      <div className={`${bgHeader} p-2.5 border-b ${isEmerald ? 'border-emerald-100' : 'border-orange-100'}`}>
        <div className="flex justify-between items-start mb-1.5">
          <span className={`text-[10px] font-black px-1.5 py-0.5 rounded ${badge}`}>{info.grade} / {info.place}</span>
          {isMyMain && <span className="text-[9px] font-bold bg-gray-800 text-white px-1.5 py-0.5 rounded-full flex items-center gap-0.5 animate-pulse"><Star size={8} fill="white"/> あなた</span>}
        </div>
        <div className={`text-xs font-bold ${textHeader} line-clamp-1`}>{info.unit || '-'}</div>
      </div>
      
      <div className="p-2.5 flex-1 flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <div className={`w-7 h-7 rounded-full flex items-center justify-center text-white text-[10px] font-bold ${isEmerald ? 'bg-emerald-300' : 'bg-orange-300'}`}>T</div>
          <div className={`text-xs font-bold ${isMyMain ? 'text-gray-900 text-sm' : 'text-gray-600'}`}>{info.main?.teacher_name || '未定'}</div>
        </div>

        {info.subs.length > 0 && (
          <div className="bg-gray-50 p-2 rounded-lg border border-gray-100 space-y-1">
            <span className="text-[8px] text-gray-400 font-bold block uppercase tracking-wider">Support</span>
            {info.subs.map((s) => {
              const isMySub = s.teacher_name === currentTeacherName;
              return (
                <div key={s.id} className={`text-[10px] flex items-center gap-1.5 ${isMySub ? 'font-bold text-indigo-600 bg-indigo-50 px-1 rounded' : 'text-gray-600'}`}>
                  <div className={`w-1.5 h-1.5 rounded-full ${isMySub ? 'bg-indigo-500' : 'bg-gray-300'}`}></div> 
                  {s.teacher_name}
                  {isMySub && <span className="text-[8px] text-indigo-400">(あなた)</span>}
                </div>
              );
            })}
          </div>
        )}

        <div className="mt-auto pt-1">
          {info.url ? (
            <a href={info.url} target="_blank" rel="noreferrer" className={`w-full ${btn} text-white text-[10px] font-bold py-2 rounded-lg flex items-center justify-center gap-1.5 transition-transform active:scale-95 shadow-sm`}>
              <Video size={12}/> 入室
            </a>
          ) : (
            <div className="w-full bg-gray-100 text-gray-400 text-[10px] font-bold py-2 rounded-lg flex items-center justify-center gap-1 cursor-not-allowed">
              <Video size={12}/> URL未設定
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

const EmptyState = ({ text, small }: { text: string, small?: boolean }) => (
  <div className={`border-2 border-dashed border-gray-200 rounded-xl flex items-center justify-center text-gray-300 font-bold text-xs ${small ? 'h-[40px]' : 'w-[100px] h-[100px]'}`}>
    {text}
  </div>
);

// ▲▲▲ シフト閲覧コンポーネント終了 ▲▲▲

type Props = {
  profile: any;
  mainShifts: any[];
  pendingCount: number;
};

export default function TeacherDashboard({ profile, mainShifts, pendingCount }: Props) {
  const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD

  const handleLogout = async () => {
    if (!confirm('ログアウトしますか？')) return;
    await signOut(auth);
    window.location.href = '/';
  };

  return (
    <div className="min-h-screen bg-gray-100 p-4 md:p-6 pb-20 font-sans">
      
      {/* ヘッダー */}
      <header className="mb-6 flex justify-between items-center bg-white p-4 rounded-xl shadow-sm border border-gray-100">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-indigo-100 rounded-full flex items-center justify-center text-indigo-600 font-bold">
            {profile?.name?.charAt(0) || 'T'}
          </div>
          <div>
            <h1 className="text-lg font-bold text-gray-800">{profile?.name} 先生</h1>
            <p className="text-xs text-gray-500">業務ポータル</p>
          </div>
        </div>
        <button onClick={handleLogout} className="flex items-center gap-2 text-xs font-bold text-gray-500 hover:text-red-600 bg-gray-50 px-3 py-2 rounded-lg border border-gray-200 transition-colors">
          <LogOut size={14}/> ログアウト
        </button>
      </header>

      {/* 連絡事項 */}
      <div className="mb-6">
        <NewsWidget role="teacher" />
      </div>

      <div className="grid lg:grid-cols-12 gap-6">
        
        {/* 左カラム: メニュー (4/12) */}
        <section className="lg:col-span-4 space-y-4">
          {/* メニューグリッド */}
          <div className="grid grid-cols-2 gap-3">
            <Link href="/teacher/attendance" className="bg-white p-4 rounded-xl shadow-sm border border-gray-200 hover:border-teal-500 hover:bg-teal-50 transition-all flex flex-col items-center justify-center gap-2 text-center h-24 group no-underline">
              <Briefcase size={24} className="text-teal-600 group-hover:scale-110 transition-transform"/>
              <span className="text-xs font-bold text-gray-700">勤怠打刻</span>
            </Link>
            <Link href="/teacher/contacts" className="bg-white p-4 rounded-xl shadow-sm border border-gray-200 hover:border-green-500 hover:bg-green-50 transition-all flex flex-col items-center justify-center gap-2 text-center h-24 group no-underline">
              <Phone size={24} className="text-green-600 group-hover:scale-110 transition-transform"/>
              <span className="text-xs font-bold text-gray-700">連絡</span>
            </Link>
            <Link href="/teacher/chat" className="bg-white p-4 rounded-xl shadow-sm border border-gray-200 hover:border-blue-300 transition-all flex flex-col items-center justify-center gap-2 text-center h-24 no-underline">
              <MessageCircle size={24} className="text-blue-600"/>
              <span className="text-xs font-bold text-gray-700">チャット</span>
            </Link>
            <Link href="/teacher/homework" className="bg-white p-4 rounded-xl shadow-sm border border-gray-200 hover:border-orange-300 transition-all flex flex-col items-center justify-center gap-2 text-center h-24 no-underline relative">
              <ClipboardList size={24} className="text-orange-500"/>
              <span className="text-xs font-bold text-gray-700">宿題管理</span>
              {pendingCount > 0 && <span className="bg-red-500 text-white text-[10px] px-1.5 py-0.5 rounded-full absolute top-2 right-2 animate-pulse">{pendingCount}</span>}
            </Link>
            <Link href="/teacher/pf" className="bg-white p-4 rounded-xl shadow-sm border border-gray-200 hover:border-indigo-300 transition-all flex flex-col items-center justify-center gap-2 text-center h-24 no-underline">
              <BarChart3 size={24} className="text-indigo-600"/>
              <span className="text-xs font-bold text-gray-700">PF</span>
            </Link>
            <Link href="/teacher/students" className="bg-white p-4 rounded-xl shadow-sm border border-gray-200 hover:border-purple-300 transition-all flex flex-col items-center justify-center gap-2 text-center h-24 no-underline">
              <Users size={24} className="text-purple-600"/>
              <span className="text-xs font-bold text-gray-700">名簿</span>
            </Link>
            <Link href="/teacher/shifts" className="bg-white p-4 rounded-xl shadow-sm border border-gray-200 hover:border-yellow-300 transition-all flex flex-col items-center justify-center gap-2 text-center h-24 no-underline col-span-2">
              <CalendarPlus size={24} className="text-yellow-600"/>
              <span className="text-xs font-bold text-gray-700">シフト提出</span>
            </Link>
          </div>

          {/* AIリスクモニター */}
          <RiskMonitorWidget />
        </section>

        {/* 右カラム: 今日のシフト表 (8/12) */}
        <section className="lg:col-span-8 space-y-4">
          <div className="bg-white rounded-xl shadow-sm border-t-4 border-indigo-500 overflow-hidden min-h-[600px] flex flex-col">
            <div className="p-4 border-b border-gray-100 bg-indigo-50/50 flex justify-between items-center">
              <h2 className="text-base font-bold text-gray-800 flex items-center gap-2"><Calendar className="text-indigo-600" size={20}/> 本日の講師配置表</h2>
              <span className="text-xs font-bold text-gray-500 bg-white px-3 py-1 rounded-full border border-gray-200">{today}</span>
            </div>
            <div className="p-4 bg-gray-50 flex-1">
              {/* シフトビュワー埋め込み */}
              <ShiftViewer date={today} teacherName={profile?.name || ''} />
            </div>
          </div>
        </section>

      </div>
    </div>
  );
}