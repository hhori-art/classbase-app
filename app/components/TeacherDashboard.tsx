'use client';

import { useState } from 'react';
import { 
  Calendar as CalendarIcon, MonitorPlay, MapPin, User, Star,
  ChevronLeft, ChevronRight, LayoutList, Layout, Maximize2, Minimize2,
  Briefcase, Clock, KeyRound, ExternalLink,
  Video, Loader2, Zap,
  LogOut
} from 'lucide-react';
import { signOut } from 'firebase/auth';
import { auth } from '@/lib/firebase';
import NewsWidget from '@/app/components/NewsWidget';
// ★追加: 監視ボタンのインポート
import ShiftMonitorButton from '@/app/components/ShiftMonitorButton';

// --- 型定義 ---
type ShiftAssignment = {
  id: string;
  user_id?: string;
  teacher_name: string;
  target_date: string;
  role_type: 'main' | 'sub' | 'general';
  target_grade: string | null;
  target_subject: string | null;
  target_detail_subject: string | null;
  target_place?: string | null;
  target_meeting_id?: string | null; 
  target_signin_address?: string | null;
  unit: string | null;
  note: string;
  parent_id?: string;
  start_url?: string; 
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
  start_url: string | null;
  signin_address: string | null;
  meeting_id: string | null;
};

type Props = {
  profile: any;
  allAssignments: any[];
  pendingCount: number; 
  currentDate: string;
  onDateChange: (date: string) => void;
  viewMode: 'day' | 'week';
  onViewModeChange: (mode: 'day' | 'week') => void;
  isExpanded: boolean;
  onExpandChange: (expanded: boolean) => void;
};

const EmptyState = ({ text }: { text: string }) => (
  <div className="h-full min-h-[60px] border border-dashed border-slate-200 rounded-xl flex items-center justify-center bg-slate-50/50">
    <span className="text-[10px] font-bold text-slate-400 flex items-center gap-1">
      {text}
    </span>
  </div>
);

// --- クラスカード (ご提示のコードをそのまま維持) ---
const TeacherClassCard = ({ info, color, currentUserProfile, isExpanded }: { info: ClassGroup, color: 'emerald' | 'orange', currentUserProfile: any, isExpanded: boolean }) => {
  const [loading, setLoading] = useState(false);
  
  const currentUserId = currentUserProfile?.id || currentUserProfile?.uid || '';
  const isMyClass = (info.main?.user_id === currentUserId) || info.subs.some(s => s.user_id === currentUserId);

  const loginEmail = info.signin_address?.trim();
  const hasHostPermission = !!loginEmail && loginEmail.length > 0;
  
  // 表示用ID (@以下をカット)
  const displayLoginId = loginEmail ? loginEmail.split('@')[0] : '';

  const isEmerald = color === 'emerald';
  const theme = isEmerald ? {
    border: isMyClass ? 'border-emerald-500 ring-2 ring-emerald-100' : 'border-emerald-100',
    headerBg: isMyClass ? 'bg-emerald-600' : 'bg-emerald-50',
    headerText: isMyClass ? 'text-white' : 'text-emerald-800',
    badge: isMyClass ? 'bg-white/20 text-white' : 'bg-emerald-100 text-emerald-700',
    iconBg: 'bg-emerald-500',
    btn: hasHostPermission ? 'bg-rose-600 hover:bg-rose-700 text-white shadow-rose-200' : 'bg-emerald-600 hover:bg-emerald-700 text-white shadow-emerald-200',
  } : {
    border: isMyClass ? 'border-orange-500 ring-2 ring-orange-100' : 'border-orange-100',
    headerBg: isMyClass ? 'bg-orange-500' : 'bg-orange-50',
    headerText: isMyClass ? 'text-white' : 'text-orange-800',
    badge: isMyClass ? 'bg-white/20 text-white' : 'bg-orange-100 text-orange-700',
    iconBg: 'bg-orange-500',
    btn: hasHostPermission ? 'bg-rose-600 hover:bg-rose-700 text-white shadow-rose-200' : 'bg-orange-500 hover:bg-orange-600 text-white shadow-orange-200',
  };

  const myName = currentUserProfile?.student_name || currentUserProfile?.name || '講師';
  const confno = info.meeting_id?.replace(/\s/g, '') || (info.url ? info.url.split('/').pop()?.split('?')[0] : '');

  const launchWebUrl = (url: string) => {
    window.open(url, '_blank');
  };

  // ■■■ Zoom入室ハンドラ (元の正常動作するコード) ■■■
  const handleEnterZoom = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    if (!confno) {
      alert("ミーティングIDが設定されていません。");
      return;
    }

    if (hasHostPermission) {
      setLoading(true);
      try {
        console.log(`🚀 ホスト開始試行: Email=${loginEmail}`);
        
        // API呼び出し (名前変更ロジックは削除済み)
        const res = await fetch('/api/get-zoom-zak', { 
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: loginEmail }) 
        });
        const data = await res.json();
        
        if (data.success && data.zak && data.pmi) {
          // WebランチャーURLで起動 (ホスト権限)
          // https://zoom.us/s/ID?zak=TOKEN 形式は最も強力にホスト権限を渡せます
          const targetUrl = `https://zoom.us/s/${data.pmi}?zak=${data.zak}`;
          console.log("✅ Webランチャー起動:", targetUrl);
          launchWebUrl(targetUrl);
        } else {
          console.error("API Error:", data);
          alert(`ホスト権限の取得に失敗しました。\n\n理由: ${data.error}`);
          if(confirm("通常参加で開きますか？")) {
             launchWebUrl(info.url || `https://zoom.us/j/${confno}`);
          }
        }
      } catch (err) {
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
          targetUrl = `https://zoom.us/j/${confno}?pwd=${pwd || ''}&uname=${encodeURIComponent(myName)}`;
        } catch (e) {}
      }
      console.log("🚶 通常参加:", targetUrl);
      launchWebUrl(targetUrl);
    }
  };

  const widthClass = isExpanded ? 'w-full' : 'w-[140px] shrink-0';
  let buttonLabel = hasHostPermission ? 'ホスト開始' : '入室';
  if (loading) buttonLabel = '準備中...';

  return (
    <div className={`${widthClass} bg-white border ${theme.border} rounded-xl shadow-sm flex flex-col overflow-hidden transition-all duration-200 ${isMyClass ? 'shadow-md transform -translate-y-0.5 z-10' : 'hover:shadow-md'}`}>
      
      {/* ヘッダー */}
      <div className={`${theme.headerBg} px-2 py-1.5 transition-colors relative h-[38px]`}>
        <div className="flex justify-between items-start mb-0.5">
          <span className={`text-[9px] font-black px-1.5 py-0.5 rounded-md ${theme.badge} whitespace-nowrap truncate max-w-[85%]`}>
            {info.grade}/{info.place}
          </span>
          
          {/* スタジオ名表示 */}
          {info.studio && (
            <div className="flex items-center gap-0.5 text-[8px] bg-black/20 px-1.5 py-0.5 rounded text-white/90 font-bold whitespace-nowrap ml-1 max-w-[60px] truncate" title={info.studio}>
              <MapPin size={8}/> {info.studio}
            </div>
          )}
        </div>
        <div className={`text-[10px] font-bold ${theme.headerText} line-clamp-1 leading-tight`}>
          {info.unit || <span className="opacity-60 font-normal">未設定</span>}
        </div>
      </div>
      
      <div className="p-1.5 flex-1 flex flex-col gap-1.5 bg-white">
        
        {/* メイン講師情報 */}
        <div className="flex flex-col gap-0.5">
           <div className="flex items-center gap-1.5">
              <div className={`w-5 h-5 rounded-full flex items-center justify-center text-white text-[8px] font-bold shadow-sm shrink-0 ${theme.iconBg}`}>
                <User size={10}/>
              </div>
              <div className={`text-[10px] font-bold truncate ${isMyClass ? 'text-slate-900' : 'text-slate-600'}`}>
                {info.main?.teacher_name || '未定'}
              </div>
           </div>

           {/* ログインID表示 (@以下カット) */}
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

        <div className="border-t border-slate-100 pt-1 mt-0.5">
          <div className="space-y-0.5">
            {info.subs.length > 0 ? info.subs.map((s) => {
              const isMe = s.user_id === currentUserId;
              return (
                <div key={s.id} className={`text-[8px] flex items-center gap-1 p-0.5 rounded ${isMe ? 'font-bold text-indigo-700 bg-indigo-50 border border-indigo-100' : 'text-slate-400'}`}>
                  <div className={`w-1 h-1 rounded-full ${isMe ? 'bg-indigo-500' : 'bg-slate-300'} shrink-0`}></div> 
                  <span className="truncate">{s.teacher_name}</span>
                </div>
              );
            }) : (
              <div className="text-[8px] text-slate-300 pl-1">-</div>
            )}
          </div>
        </div>

        <div className="mt-auto pt-0.5">
          {confno ? (
            <button 
              type="button" 
              onClick={handleEnterZoom}
              disabled={loading}
              className={`w-full ${theme.btn} shadow-sm text-[9px] font-bold py-1.5 rounded-md flex items-center justify-center gap-1 transition-transform active:scale-95`}
            >
              {loading ? <Loader2 size={10} className="animate-spin"/> : hasHostPermission ? <Zap size={10}/> : <Video size={10}/>}
              {buttonLabel}
            </button>
          ) : (
            <div className="w-full bg-slate-100 text-slate-400 text-[9px] font-bold py-1.5 rounded-md flex items-center justify-center gap-1 cursor-not-allowed border border-slate-200">
              <Video size={10}/> -
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

// --- シフト表示エリア (変更なし) ---
const DailyShiftViewer = ({ assignments, currentUserProfile, isExpanded, date }: { assignments: ShiftAssignment[], currentUserProfile: any, isExpanded: boolean, date: string }) => {
  const getAllClasses = (time: string, subject: string) => {
    const slotAssignments = assignments.filter(a => a.note?.includes(`【${time}】`) && a.target_subject === subject && a.target_date === date);
    if (slotAssignments.length === 0) return [];
    const mains = slotAssignments.filter(a => a.role_type === 'main');
    const subs = slotAssignments.filter(a => a.role_type === 'sub');
    const classes: ClassGroup[] = mains.map(main => {
      const relatedSubs = subs.filter(sub => 
        sub.parent_id === main.id || 
        (!sub.parent_id && sub.target_grade === main.target_grade && sub.target_detail_subject === main.target_detail_subject)
      );
      return { 
        id: main.id, main, subs: relatedSubs, subject: main.target_subject, 
        grade: main.target_grade, unit: main.unit, place: main.target_detail_subject, 
        studio: main.target_place || null, url: main.target_meeting_id ? `https://zoom.us/j/${main.target_meeting_id.replace(/\s/g, '')}` : null, 
        signin_address: main.target_signin_address || null, meeting_id: main.target_meeting_id || null, start_url: main.start_url || null
      };
    });
    return classes.sort((a, b) => (a.grade || '').localeCompare(b.grade || ''));
  };
  const getGeneralSupport = (time: string) => assignments.filter(a => a.role_type === 'general' && a.note?.includes(`【${time}】`) && a.target_date === date);
  const containerClass = 'bg-white rounded-xl border border-slate-200 overflow-hidden shadow-sm flex flex-col';
  const listLayoutClass = isExpanded ? 'grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3' : 'flex gap-3 min-w-max'; 
  const scrollAreaClass = isExpanded ? 'p-4 bg-slate-50/50 flex-1 overflow-y-auto custom-scrollbar' : 'overflow-x-auto p-3 bg-slate-50/50 custom-scrollbar';

  return (
    <div className="space-y-4 h-full">
      {['1限', '2限'].map(period => (
        <div key={period} className={containerClass}>
          <div className={`px-3 py-2 flex items-center justify-between shrink-0 ${period === '1限' ? 'bg-slate-800 text-white' : 'bg-slate-700 text-slate-100'}`}>
            <div className="flex items-center gap-2 font-bold text-xs"><Clock size={12} className={period === '1限' ? 'text-blue-400' : 'text-indigo-400'}/>{period}</div>
            <div className="flex gap-2 text-[9px] font-bold"><span className="bg-emerald-500/20 px-1.5 py-0.5 rounded text-emerald-100">理 {getAllClasses(period, '理科').length}</span><span className="bg-orange-500/20 px-1.5 py-0.5 rounded text-orange-100">社 {getAllClasses(period, '社会').length}</span></div>
          </div>
          <div className={scrollAreaClass}>
            <div className={`flex ${isExpanded ? 'flex-col gap-4' : 'flex-row gap-4 items-start'}`}>
              <div className={`flex flex-col gap-2 ${isExpanded ? 'w-full' : 'min-w-[140px] shrink-0'}`}>
                {isExpanded && <div className="flex items-center gap-1 text-[10px] font-bold text-emerald-700 border-b border-emerald-100 pb-1 mb-1"><MonitorPlay size={10}/> 理科グループ</div>}
                {getAllClasses(period, '理科').length > 0 ? (
                  <div className={listLayoutClass}>{getAllClasses(period, '理科').map(info => (<TeacherClassCard key={info.id} info={info} color="emerald" currentUserProfile={currentUserProfile} isExpanded={isExpanded} />))}</div>
                ) : (<EmptyState text="理科なし" />)}
              </div>
              {!isExpanded && <div className="w-px bg-slate-200 self-stretch my-1 shrink-0"></div>}
              {isExpanded && <div className="h-px bg-slate-200 w-full my-1"></div>}
              <div className={`flex flex-col gap-2 ${isExpanded ? 'w-full' : 'min-w-[140px] shrink-0'}`}>
                {isExpanded && <div className="flex items-center gap-1 text-[10px] font-bold text-orange-700 border-b border-orange-100 pb-1 mb-1"><MapPin size={10}/> 社会グループ</div>}
                {getAllClasses(period, '社会').length > 0 ? (
                  <div className={listLayoutClass}>{getAllClasses(period, '社会').map(info => (<TeacherClassCard key={info.id} info={info} color="orange" currentUserProfile={currentUserProfile} isExpanded={isExpanded} />))}</div>
                ) : (<EmptyState text="社会なし" />)}
              </div>
              {getGeneralSupport(period).length > 0 && (
                <>
                  {!isExpanded && <div className="w-px bg-slate-200 self-stretch my-1 shrink-0"></div>}
                  {isExpanded && <div className="h-px bg-slate-200 w-full my-1"></div>}
                  <div className={`flex flex-col gap-1 ${isExpanded ? 'w-full' : 'ml-1 shrink-0'}`}>
                    <div className={`bg-slate-100 rounded-lg p-2 border border-slate-200 ${isExpanded ? 'w-full' : 'h-full w-[120px]'}`}>
                      <div className="text-[9px] font-bold text-slate-400 mb-2 flex items-center gap-1 uppercase tracking-wider shrink-0"><User size={10}/> Support</div>
                      <div className={`gap-2 ${isExpanded ? 'grid grid-cols-2 sm:grid-cols-4 md:grid-cols-6' : 'flex flex-col overflow-y-auto custom-scrollbar max-h-[140px]'}`}>
                        {getGeneralSupport(period).map(a => (<div key={a.id} className={`p-1.5 rounded-md border shadow-sm text-[10px] font-bold flex items-center gap-2 ${a.user_id===currentUserProfile?.id ? 'bg-slate-800 text-white' : 'bg-white text-slate-700'}`}><User size={9}/><span className="truncate">{a.teacher_name}</span></div>))}
                      </div>
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
};

// --- メインコンポーネント ---
export default function TeacherDashboard({ profile, allAssignments, pendingCount, currentDate, onDateChange, viewMode, onViewModeChange, isExpanded, onExpandChange }: Props) {
  const days = ['日', '月', '火', '水', '木', '金', '土'];
  const dayOfWeek = days[new Date(currentDate).getDay()];
  const handleLogout = async () => { if (confirm('ログアウトしますか？')) { await signOut(auth); window.location.href = '/'; } };
  const handleDateChange = (direction: number) => { const d = new Date(currentDate); const increment = viewMode === 'week' ? 7 : 1; d.setDate(d.getDate() + (direction * increment)); onDateChange(d.toISOString().split('T')[0]); };
  const targetDates = [currentDate];
  if (viewMode === 'week') { for (let i = 1; i < 7; i++) { const d = new Date(currentDate); d.setDate(d.getDate() + i); targetDates.push(d.toISOString().split('T')[0]); } }
  const containerClasses = isExpanded ? 'fixed inset-0 z-[200] bg-slate-100 flex flex-col h-screen overflow-hidden' : 'min-h-screen bg-slate-50 font-sans text-slate-800 pb-24';
  const contentClasses = isExpanded ? 'flex-1 overflow-hidden p-2 lg:p-6' : 'max-w-7xl mx-auto p-4 md:p-6 space-y-6';

  return (
    <div className={containerClasses}>
      {!isExpanded && (
        <header className="bg-white border-b border-slate-200 sticky top-0 z-30 shadow-sm/50 backdrop-blur-md bg-white/90">
          <div className="max-w-7xl mx-auto px-4 h-16 flex items-center justify-between">
            <div className="flex items-center gap-2"><div className="bg-slate-900 p-2 rounded-xl text-white shadow-lg shadow-indigo-500/20"><Briefcase size={20} /></div><span className="font-black text-lg tracking-tight text-slate-800 hidden md:inline">講師ポータル</span></div>
            <div className="flex items-center gap-4"><div className="hidden sm:flex items-center gap-2 px-3 py-1.5 bg-slate-50 rounded-full border border-slate-100"><div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></div><span className="text-xs font-bold text-slate-600">{profile?.student_name || '講師'}</span></div><button onClick={handleLogout} className="p-2 hover:bg-red-50 rounded-full text-slate-400 hover:text-red-500 transition-colors"><LogOut size={20} /></button></div>
          </div>
        </header>
      )}
      {isExpanded && (
        <div className="bg-slate-900 text-white p-2 flex justify-between items-center shadow-md z-20 shrink-0">
          <div className="flex items-center gap-3">
             <button onClick={() => onExpandChange(false)} className="p-2 bg-white/10 hover:bg-white/20 rounded-lg transition-colors text-white/80 flex items-center gap-2"><Minimize2 size={16}/> <span className="text-xs font-bold hidden sm:inline">戻る</span></button>
             <div className="flex bg-slate-800 p-0.5 rounded-lg border border-slate-700">
                 <button onClick={() => onViewModeChange('day')} className={`px-2 py-1 rounded-md text-[10px] font-bold transition-all flex items-center gap-1 ${viewMode === 'day' ? 'bg-slate-200 text-slate-900 shadow-sm' : 'text-slate-400 hover:text-white'}`}><Layout size={12}/> 1日</button>
                 <button onClick={() => onViewModeChange('week')} className={`px-3 py-1 rounded-md text-[10px] font-bold transition-all flex items-center gap-1 ${viewMode === 'week' ? 'bg-slate-200 text-slate-900 shadow-sm' : 'text-slate-400 hover:text-white'}`}><LayoutList size={12}/> 週間</button>
             </div>
          </div>
          <div className="flex items-center gap-2 bg-white/10 p-1 rounded-lg border border-white/10">
             <button onClick={() => handleDateChange(-1)} className="p-1 hover:bg-white/20 rounded-md transition text-white/70 hover:text-white"><ChevronLeft size={16}/></button>
             <span className="px-2 text-xs font-bold font-mono">{currentDate.replace(/-/g, '/')} {viewMode === 'week' ? '～' : `(${days[new Date(currentDate).getDay()]})`}</span>
             <button onClick={() => handleDateChange(1)} className="p-1 hover:bg-white/20 rounded-md transition text-white/70 hover:text-white"><ChevronRight size={16}/></button>
          </div>
        </div>
      )}
      <div className={contentClasses}>
        {!isExpanded && (
          <div className="flex flex-col md:flex-row items-center justify-between gap-4 bg-white p-4 rounded-2xl shadow-sm border border-slate-200">
            <div className="flex items-center gap-3 w-full md:w-auto">
              <div className="flex items-center bg-slate-50 rounded-xl p-1 border border-slate-100">
                 <button onClick={() => handleDateChange(-1)} className="p-2 hover:bg-white rounded-lg transition text-slate-400 hover:text-indigo-600 shadow-sm"><ChevronLeft size={18}/></button>
                 <div className="px-4 text-center w-32"><span className="block text-[10px] font-bold text-slate-400">TARGET DATE</span><div className="text-sm font-black text-slate-700 flex items-center justify-center gap-1">{currentDate} <span className="text-xs font-normal text-slate-400">({dayOfWeek})</span></div></div>
                 <button onClick={() => handleDateChange(1)} className="p-2 hover:bg-white rounded-lg transition text-slate-400 hover:text-indigo-600 shadow-sm"><ChevronRight size={18}/></button>
              </div>
            </div>
          </div>
        )}
        {!isExpanded && <NewsWidget role="teacher" />}
        <div className={`space-y-4 ${isExpanded ? 'h-full flex flex-col' : ''}`}>
          <div className="flex items-center justify-between px-1 shrink-0">
            <div className="flex items-center gap-3"><h3 className={`font-black text-slate-700 flex items-center gap-2 ${isExpanded ? 'hidden' : 'text-lg'}`}><CalendarIcon className="text-indigo-600"/> 講師配置</h3>
              
              {/* ★追加: 監視ボタン */}
              <ShiftMonitorButton assignments={allAssignments} currentDate={currentDate} />

              {!isExpanded && (
                <div className="flex bg-slate-200 p-1 rounded-lg">
                   <button onClick={() => onViewModeChange('day')} className={`px-3 py-1 rounded-md text-[10px] font-bold transition-all flex items-center gap-1 ${viewMode === 'day' ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}><Layout size={12}/> 1日</button>
                   <button onClick={() => onViewModeChange('week')} className={`px-3 py-1 rounded-md text-[10px] font-bold transition-all flex items-center gap-1 ${viewMode === 'week' ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}><LayoutList size={12}/> 週間</button>
                </div>
              )}
            </div>
            {!isExpanded && <button onClick={() => onExpandChange(true)} className="flex items-center gap-2 bg-slate-800 text-white px-3 py-1.5 rounded-lg hover:bg-slate-700 transition-all text-xs font-bold active:scale-95"><Maximize2 size={12}/> 拡大</button>}
          </div>
          <div className={`${isExpanded ? 'flex-1 overflow-y-auto custom-scrollbar space-y-4 pr-1 pb-32' : 'space-y-6'}`}>
            {targetDates.map((date, idx) => {
              const d = new Date(date);
              const dayStr = days[d.getDay()];
              const isToday = date === new Date().toISOString().split('T')[0];
              return (
                <div key={date} className="animate-in fade-in slide-in-from-bottom-4 duration-500" style={{animationDelay: `${idx * 30}ms`}}>
                  {(viewMode === 'week' || isExpanded) && (
                    <div className="flex items-center gap-2 mb-2 pl-1 sticky top-0 bg-slate-100 z-10 py-1 shadow-sm">
                      <div className={`text-sm font-black ${isToday ? 'text-indigo-600' : 'text-slate-400'}`}>{d.getMonth()+1}/{d.getDate()}</div>
                      <div className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${isToday ? 'bg-indigo-600 text-white' : 'bg-slate-200 text-slate-500'}`}>{dayStr}</div>
                      {isToday && <span className="text-[9px] font-bold text-indigo-400 tracking-wider">TODAY</span>}
                    </div>
                  )}
                  <DailyShiftViewer assignments={allAssignments} currentUserProfile={profile} isExpanded={isExpanded} date={date} />
                </div>
              );
            })}
            {allAssignments.length === 0 && (<div className="text-center py-10 bg-white rounded-xl border border-dashed border-slate-200"><p className="text-xs font-bold text-slate-400">シフトデータがありません</p></div>)}
          </div>
        </div>
      </div>
    </div>
  );
}