'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { 
  Home, Users, Calendar, Briefcase, Megaphone, CheckSquare, 
  ClipboardList, FileText, Video, MessageCircle, ShoppingBag, 
  Activity, Database, Trash2, Settings, Menu, X, LogOut, 
  GraduationCap, ListChecks
} from 'lucide-react';
import { useAuth } from '@/app/context/AuthContext';
import { auth } from '@/lib/firebase';
import { signOut } from 'firebase/auth';

// メニュー項目の定義
const MENU_ITEMS = [
  { 
    category: "メイン", 
    items: [
      { title: 'ダッシュボード', icon: Home, href: '/master' },
    ]
  },
  { 
    category: "運営・管理", 
    items: [
      { title: '生徒・講師管理', icon: Users, href: '/master/users' },
      { title: 'シフト管理', icon: Calendar, href: '/master/shifts' },
      { title: '勤怠管理', icon: Briefcase, href: '/master/attendance' },
      { title: 'お知らせ配信', icon: Megaphone, href: '/master/announcements' },
      { title: '承認・申請', icon: CheckSquare, href: '/master/requests' },
      { title: '登録依頼作成', icon: ClipboardList, href: '/master/registration-tasks' },
    ]
  },
  { 
    category: "学習・コミュニティ", 
    items: [
      { title: 'PFデータ管理', icon: FileText, href: '/master/pf' },
      { title: '授業アーカイブ', icon: Video, href: '/master/recordings' },
      { title: 'コミュニティ', icon: MessageCircle, href: '/master/community' },
      { title: '景品・コイン', icon: ShoppingBag, href: '/master/rewards' },
    ]
  },
  { 
    category: "システム", 
    items: [
      { title: '統計・分析', icon: Activity, href: '/master/stats' },
      { title: 'アンケート設定', icon: ListChecks, href: '/master/survey-settings' },
      { title: 'CSV一括登録', icon: Database, href: '/master/imports' },
      { title: '一括削除', icon: Trash2, href: '/master/delete' },
      { title: '設定', icon: Settings, href: '/master/settings' },
    ]
  }
];

export default function MasterLayout({ children }: { children: React.ReactNode }) {
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const pathname = usePathname();
  const router = useRouter();
  const { user } = useAuth();

  // ログアウト処理
  const handleLogout = async () => {
    if (confirm('管理画面からログアウトしますか？')) {
      try {
        await signOut(auth);
        router.push('/'); // ログイン画面へリダイレクト
      } catch (error) {
        console.error('Logout error:', error);
        alert('ログアウトに失敗しました。');
      }
    }
  };

  return (
    <div className="flex h-screen w-full bg-[#F0F3FF] font-sans overflow-hidden">
      
      {/* サイドバー */}
      <aside 
        className={`bg-slate-900 text-slate-300 flex-shrink-0 transition-all duration-300 ease-in-out flex flex-col z-50 h-full
          ${isSidebarOpen ? 'w-64' : 'w-20'}
        `}
      >
        {/* ロゴエリア */}
        <div className="h-16 flex items-center justify-between px-4 border-b border-slate-800 bg-slate-950/50 backdrop-blur-sm">
          {isSidebarOpen ? (
            <Link href="/master" className="flex items-center gap-3 hover:opacity-80 transition-opacity">
              <div className="bg-indigo-600 p-1.5 rounded-lg text-white shadow-lg shadow-indigo-900/50">
                <GraduationCap size={20} strokeWidth={2.5} />
              </div>
              <span className="text-lg font-black text-white tracking-tight">理社講座アプリ</span>
            </Link>
          ) : (
            <Link href="/master" className="mx-auto bg-indigo-600 p-1.5 rounded-lg text-white shadow-lg shadow-indigo-900/50 hover:bg-indigo-500 transition-colors">
              <GraduationCap size={20} strokeWidth={2.5} />
            </Link>
          )}
          
          {/* 開閉ボタン */}
          {isSidebarOpen && (
            <button 
              onClick={() => setIsSidebarOpen(false)}
              className="p-1.5 rounded-lg hover:bg-slate-800 text-slate-500 hover:text-slate-300 transition-colors"
            >
              <Menu size={18} />
            </button>
          )}
        </div>

        {/* 閉じた状態での開くボタン */}
        {!isSidebarOpen && (
          <div className="h-8 flex items-center justify-center border-b border-slate-800 hover:bg-slate-800 cursor-pointer transition-colors" onClick={() => setIsSidebarOpen(true)}>
             <Menu size={16} className="text-slate-500"/>
          </div>
        )}

        {/* メニューリスト */}
        <div className="flex-1 overflow-y-auto py-4 custom-scrollbar">
          <nav className="space-y-6 px-3">
            {MENU_ITEMS.map((section, idx) => (
              <div key={idx}>
                {isSidebarOpen && (
                  <h3 className="px-3 text-[10px] font-black text-slate-500 uppercase tracking-wider mb-2 animate-in fade-in duration-500">
                    {section.category}
                  </h3>
                )}
                {!isSidebarOpen && idx > 0 && <div className="h-px bg-slate-800 my-2 mx-2"></div>}

                <ul className="space-y-1">
                  {section.items.map((item) => {
                    const isActive = pathname === item.href;
                    const Icon = item.icon;
                    return (
                      <li key={item.href}>
                        <Link 
                          href={item.href}
                          className={`flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all duration-200 group relative
                            ${isActive 
                              ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-900/50 font-bold' 
                              : 'hover:bg-slate-800 hover:text-white text-slate-400 font-medium'
                            }
                            ${!isSidebarOpen ? 'justify-center' : ''}
                          `}
                          title={!isSidebarOpen ? item.title : ''}
                        >
                          <span className={`transition-colors ${isActive ? 'text-white' : 'text-slate-400 group-hover:text-white'}`}>
                            <Icon size={20} strokeWidth={isActive ? 2.5 : 2} />
                          </span>
                          {isSidebarOpen && (
                            <span className="text-sm truncate">{item.title}</span>
                          )}
                          {isActive && isSidebarOpen && (
                            <div className="absolute right-2 w-1.5 h-1.5 bg-white rounded-full opacity-50"></div>
                          )}
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </nav>
        </div>

        {/* ユーザー情報・ログアウト */}
        <div className="p-4 border-t border-slate-800 bg-slate-950/30">
          <div className={`flex items-center gap-3 ${!isSidebarOpen ? 'justify-center' : ''}`}>
            <div className="w-10 h-10 rounded-full bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center text-white font-bold shrink-0 shadow-lg border-2 border-slate-800">
              {user?.displayName?.[0] || 'M'}
            </div>
            {isSidebarOpen && (
              <div className="min-w-0 flex-1 animate-in fade-in duration-300">
                <p className="text-sm font-bold text-white truncate">{user?.displayName || '管理者'}</p>
                <button 
                  onClick={handleLogout}
                  className="text-xs text-slate-400 hover:text-red-400 flex items-center gap-1 transition-colors mt-0.5 font-medium group w-full text-left"
                >
                  <LogOut size={12} className="group-hover:-translate-x-0.5 transition-transform" /> ログアウト
                </button>
              </div>
            )}
          </div>
        </div>
      </aside>

      {/* メインコンテンツエリア */}
      <main className="flex-1 overflow-y-auto relative scroll-smooth h-full">
        {/* ★修正箇所: コンテンツラッパーにパディングを追加
          p-8 (32px) 〜 md:p-12 (48px) の余白を設定し、コンテンツを右下に配置します。
        */}
        <div className="min-h-full p-8 md:p-10 max-w-[1600px] mx-auto">
          {children}
        </div>
      </main>
    </div>
  );
}