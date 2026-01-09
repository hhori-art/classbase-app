'use client';

import { useAuth } from '@/app/context/AuthContext';
// Trash2 を追加しました
import { Users, Calendar, Megaphone, Video, Settings, FileText, FileSpreadsheet, Database, Briefcase, Trash2 } from 'lucide-react';
import Link from 'next/link';
import LogoutButton from '@/app/components/LogoutButton';

export default function MasterDashboard() {
  const { user } = useAuth();

  const menuItems = [
    { title: '生徒・講師管理', icon: <FileSpreadsheet size={24} />, href: '/master/users', color: 'bg-blue-500' },
    { title: 'シフト作成・管理', icon: <Calendar size={24} />, href: '/master/shifts', color: 'bg-purple-500' },
    { title: 'お知らせ配信', icon: <Megaphone size={24} />, href: '/master/announcements', color: 'bg-orange-500' },
    { title: '授業アーカイブ', icon: <Video size={24} />, href: '/master/recordings', color: 'bg-red-500' },
    { title: 'PFデータ管理', icon: <FileText size={24} />, href: '/master/pf', color: 'bg-indigo-600' },
    { title: '承認・申請確認', icon: <Users size={24} />, href: '/master/requests', color: 'bg-green-600' },
    
    // ★各種CSV一括登録
    { title: 'CSV一括登録', icon: <Database size={24} />, href: '/master/imports', color: 'bg-teal-600' },
    
    // ★アカウント一括削除 (新規追加)
    { title: 'アカウント一括削除', icon: <Trash2 size={24} />, href: '/master/delete', color: 'bg-rose-600' },
    
    // ★勤怠管理・承認
    { title: '勤怠管理・承認', icon: <Briefcase size={24} />, href: '/master/attendance', color: 'bg-indigo-500' },
    
    { title: 'システム設定', icon: <Settings size={24} />, href: '/master/settings', color: 'bg-gray-600' },
  ];

  return (
    <div className="min-h-screen bg-gray-50 p-8">
      <div className="max-w-5xl mx-auto">
        <div className="flex justify-between items-center mb-10">
          <div>
            <h1 className="text-3xl font-bold text-gray-800">管理者ダッシュボード</h1>
            <p className="text-gray-500 mt-1">ようこそ、{user?.displayName || '管理者'}さん</p>
          </div>
          <LogoutButton />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {menuItems.map((item, index) => (
            <Link key={index} href={item.href} className="group relative overflow-hidden bg-white p-6 rounded-2xl shadow-sm border border-gray-100 hover:shadow-md transition-all hover:-translate-y-1">
              <div className={`absolute top-0 right-0 w-24 h-24 ${item.color} opacity-10 rounded-bl-full -mr-4 -mt-4 transition-transform group-hover:scale-110`} />
              <div className={`${item.color} w-12 h-12 rounded-xl flex items-center justify-center text-white mb-4 shadow-sm`}>
                {item.icon}
              </div>
              <h2 className="text-xl font-bold text-gray-800 mb-1">{item.title}</h2>
              <p className="text-xs text-gray-400 font-bold flex items-center gap-1">
                アクセスする <span className="group-hover:translate-x-1 transition-transform">→</span>
              </p>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}