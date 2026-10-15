'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Bell, Home, Briefcase, Settings, MessageCircle, Clock, LogOut, ClipboardCheck, Users, CalendarDays } from 'lucide-react';
import { usePortalVisibility } from '@/app/hooks/usePortalVisibility';
import { useAuth } from '@/app/context/AuthContext';
import { hasScienceSocialProgram } from '@/lib/teacher-programs';
import { isDedicatedAttendanceApproverProfile, isDedicatedProfile } from '@/lib/employment-category';

export default function TeacherBottomNav() {
  const pathname = usePathname();
  const { visibility } = usePortalVisibility('teacher');
  const { profile, logout } = useAuth();
  const isAttendanceOnly = !hasScienceSocialProgram(profile);
  const isDedicatedScienceSocial = Boolean(profile && isDedicatedProfile(profile) && !isAttendanceOnly);
  const canApproveAttendance = Boolean(profile && isDedicatedAttendanceApproverProfile(profile));

  const handleLogout = async () => {
    if (!confirm('ログアウトしますか？')) return;
    await logout();
  };

  const attendanceNavItems = [
    {
      label: '勤怠',
      path: '/teacher/attendance',
      icon: <Clock size={24} />,
      activeColor: 'text-blue-500',
      bgColor: 'bg-blue-50',
      visible: true,
    },
    ...(canApproveAttendance ? [{
      label: '承認',
      path: '/teacher/attendance-approvals',
      icon: <ClipboardCheck size={24} />,
      activeColor: 'text-emerald-600',
      bgColor: 'bg-emerald-50',
      visible: true,
    }] : []),
    ...(canApproveAttendance ? [{
      label: 'シフト',
      path: '/teacher/shift-management',
      icon: <CalendarDays size={24} />,
      activeColor: 'text-indigo-600',
      bgColor: 'bg-indigo-50',
      visible: true,
    }] : []),
    {
      label: '設定',
      path: '/teacher/settings',
      icon: <Settings size={24} />,
      activeColor: 'text-gray-600',
      bgColor: 'bg-gray-100',
      visible: true,
    },
    {
      label: '通知',
      path: '/teacher/notifications',
      icon: <Bell size={24} />,
      activeColor: 'text-amber-500',
      bgColor: 'bg-amber-50',
      visible: true,
    },
    {
      label: 'ログアウト',
      path: '#logout',
      icon: <LogOut size={24} />,
      activeColor: 'text-red-500',
      bgColor: 'bg-red-50',
      visible: true,
      onClick: handleLogout,
    },
  ];
  const dedicatedNavItems = [
    {
      label: '校舎生徒',
      path: '/teacher/school-students',
      icon: <Users size={24} />,
      activeColor: 'text-indigo-600',
      bgColor: 'bg-indigo-50',
      visible: true,
    },
    ...attendanceNavItems.filter(item => item.path !== '#logout'),
    attendanceNavItems.find(item => item.path === '#logout')!,
  ];
  const scienceSocialNavItems = [
    { 
      label: 'ホーム', 
      path: '/teacher', 
      icon: <Home size={24} />, 
      activeColor: 'text-indigo-500', 
      bgColor: 'bg-indigo-50',
      visible: true,
    },
    { 
      label: '仕事', 
      path: '/teacher/work', 
      icon: <Briefcase size={24} />, 
      activeColor: 'text-orange-500', 
      bgColor: 'bg-orange-50',
      visible: visibility.work !== false,
    },
    // ★ コミュニティリンクを追加
    { 
      label: '掲示板',
      path: '/teacher/community', 
      icon: <MessageCircle size={24} />, 
      activeColor: 'text-blue-500', 
      bgColor: 'bg-blue-50',
      visible: visibility.community !== false,
    },
    {
      label: '通知',
      path: '/teacher/notifications',
      icon: <Bell size={24} />,
      activeColor: 'text-amber-500',
      bgColor: 'bg-amber-50',
      visible: visibility.notifications !== false,
    },
    { 
      label: '設定', 
      path: '/teacher/settings', 
      icon: <Settings size={24} />, 
      activeColor: 'text-gray-600', 
      bgColor: 'bg-gray-100',
      visible: visibility.settings !== false,
    },
  ];
  const navItems = (isAttendanceOnly
    ? attendanceNavItems
    : isDedicatedScienceSocial ? dedicatedNavItems : scienceSocialNavItems
  ).filter(item => item.visible);

  // パス判定
  const isActive = (path: string) => {
    if (path === '/teacher') return pathname === '/teacher';
    return pathname.startsWith(path);
  };

  return (
    <nav className="fixed bottom-0 left-0 right-0 bg-white/90 backdrop-blur-md border-t border-gray-200 pb-safe pt-2 px-6 flex justify-around items-end z-[100] h-[85px] shadow-[0_-5px_20px_-5px_rgba(0,0,0,0.1)] rounded-t-[20px]">
      {navItems.map((item) => {
        const active = isActive(item.path);
        const baseClassName = `flex flex-col items-center gap-1 p-2 w-full transition-all duration-300 group ${
          active ? '-translate-y-2' : 'hover:-translate-y-1'
        }`;
        const content = (
          <>
            <div className={`
              p-3 rounded-2xl transition-all duration-300 shadow-sm
              ${active ? `${item.bgColor} ${item.activeColor} scale-110 shadow-md` : 'bg-transparent text-gray-400 group-hover:bg-gray-50'}
            `}>
              <div style={{ strokeWidth: active ? 2.5 : 2 }}>
                {item.icon}
              </div>
            </div>

            <span className={`
              text-[10px] font-bold transition-all duration-300 whitespace-nowrap
              ${active ? `${item.activeColor} scale-105` : 'text-gray-400'}
            `}>
              {item.label}
            </span>

            <span className={`
              w-1 h-1 rounded-full mt-1 transition-all duration-300
              ${active ? item.activeColor.replace('text-', 'bg-') : 'bg-transparent'}
            `}></span>
          </>
        );

        if ('onClick' in item && typeof item.onClick === 'function') {
          const onClick = item.onClick as () => void;
          return (
            <button
              key={item.path}
              type="button"
              onClick={() => void onClick()}
              className={baseClassName}
            >
              {content}
            </button>
          );
        }

        return (
          <Link
            key={item.path}
            href={item.path}
            className={baseClassName}
          >
            {content}
          </Link>
        );
      })}
    </nav>
  );
}
