'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Bell, Home, Users, Settings } from 'lucide-react'; // アイコン変更
import { usePortalVisibility } from '@/app/hooks/usePortalVisibility';

export default function BottomNav() {
  const pathname = usePathname();
  const { visibility } = usePortalVisibility('student');

  // ★修正: メニューを3つに厳選
  const navItems = [
    { 
      label: 'ホーム', 
      path: '/student', 
      icon: <Home size={24} />, 
      activeColor: 'text-indigo-500', 
      bgColor: 'bg-indigo-50',
      visible: true,
    },
    { 
      label: '広場', // ★ここに追加
      path: '/student/community', 
      icon: <Users size={24} />, 
      activeColor: 'text-pink-500', 
      bgColor: 'bg-pink-50',
      visible: visibility.community !== false,
    },
    { 
      label: '通知',
      path: '/student/notifications',
      icon: <Bell size={24} />,
      activeColor: 'text-amber-500',
      bgColor: 'bg-amber-50',
      visible: visibility.notifications !== false,
    },
    {
      label: '設定', 
      path: '/student/settings', 
      icon: <Settings size={24} />, 
      activeColor: 'text-gray-600', 
      bgColor: 'bg-gray-100',
      visible: visibility.settings !== false,
    },
  ].filter(item => item.visible);

  const isActive = (path: string) => {
    if (path === '/student') return pathname === '/student';
    return pathname.startsWith(path);
  };

  return (
    <nav className="fixed bottom-0 left-0 right-0 bg-white/90 backdrop-blur-md border-t border-gray-200 pb-safe pt-2 px-6 flex justify-around items-end z-[100] h-[85px] shadow-[0_-5px_20px_-5px_rgba(0,0,0,0.1)] rounded-t-[20px]">
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
              p-3 rounded-2xl transition-all duration-300 shadow-sm
              ${active ? `${item.bgColor} ${item.activeColor} scale-110 shadow-md` : 'bg-transparent text-gray-400 group-hover:bg-gray-50'}
            `}>
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
          </Link>
        );
      })}
    </nav>
  );
}
