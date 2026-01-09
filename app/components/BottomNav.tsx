'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Home, BookOpen, Video, MessageCircle, AlertTriangle, User } from 'lucide-react';

export default function BottomNav() {
  const pathname = usePathname();

  // メニューの定義（色やアイコンを一括管理）
  const navItems = [
    { 
      label: 'ホーム', 
      path: '/student', 
      icon: <Home size={24} />, 
      activeColor: 'text-indigo-500', 
      bgColor: 'bg-indigo-50' 
    },
    { 
      label: '宿題', 
      path: '/student/homework', 
      icon: <BookOpen size={24} />, 
      activeColor: 'text-orange-500', 
      bgColor: 'bg-orange-50' 
    },
    { 
      label: '録画', 
      path: '/student/recordings', 
      icon: <Video size={24} />, 
      activeColor: 'text-red-500', 
      bgColor: 'bg-red-50' 
    },
    { 
      label: '相談', 
      path: '/student/chat', 
      icon: <MessageCircle size={24} />, 
      activeColor: 'text-purple-500', 
      bgColor: 'bg-purple-50' 
    },
    { 
      label: '欠席', // ★追加
      path: '/student/absence', 
      icon: <AlertTriangle size={24} />, 
      activeColor: 'text-green-500', 
      bgColor: 'bg-green-50' 
    },
    { 
      label: '設定', 
      path: '/student/settings', 
      icon: <User size={24} />, 
      activeColor: 'text-gray-600', 
      bgColor: 'bg-gray-100' 
    },
  ];

  const isActive = (path: string) => {
    if (path === '/student') return pathname === '/student';
    return pathname.startsWith(path);
  };

  return (
    <nav className="fixed bottom-0 left-0 right-0 bg-white/90 backdrop-blur-md border-t border-gray-200 pb-safe pt-2 px-2 flex justify-around items-end z-[100] h-[85px] shadow-[0_-5px_20px_-5px_rgba(0,0,0,0.1)] rounded-t-[20px]">
      {navItems.map((item) => {
        const active = isActive(item.path);
        
        return (
          <Link 
            key={item.path} 
            href={item.path} 
            className={`flex flex-col items-center gap-1 p-2 w-full transition-all duration-300 group ${
              active ? '-translate-y-2' : 'hover:-translate-y-1'
            }`}
          >
            {/* アイコン部分 */}
            <div className={`
              p-2.5 rounded-2xl transition-all duration-300 shadow-sm
              ${active ? `${item.bgColor} ${item.activeColor} scale-110 shadow-md` : 'bg-transparent text-gray-400 group-hover:bg-gray-50'}
            `}>
              {/* アイコンの線の太さもアクティブ時は太く */}
              <div style={{ strokeWidth: active ? 2.5 : 2 }}>
                {item.icon}
              </div>
            </div>

            {/* ラベル部分 */}
            <span className={`
              text-[10px] font-bold transition-all duration-300
              ${active ? `${item.activeColor} scale-105` : 'text-gray-400'}
            `}>
              {item.label}
            </span>
            
            {/* アクティブ時の下線ドット */}
            <span className={`
              w-1 h-1 rounded-full mt-1 transition-all duration-300
              ${active ? item.activeColor.replace('text-', 'bg-') : 'bg-transparent'}
            `}></span>
          </Link>
        );
      })}
    </nav>
  );
}