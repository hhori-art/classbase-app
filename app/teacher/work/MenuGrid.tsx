'use client';

import Link from 'next/link';
import { 
  ClipboardList, CalendarPlus, MessageCircle, Users, 
  Phone, BarChart3, Briefcase, AlertTriangle, Lock 
} from 'lucide-react';
import { useAuth } from '@/app/context/AuthContext';

type Props = {
  isInternalNetwork: boolean;
};

export default function TeacherWorkMenu({ isInternalNetwork }: Props) {
  const { profile } = useAuth();
  const pendingCount = 0; 

  // メニュー項目の定義
  // restricted: true のものは社外からアクセス不可
  const menuItems = [
    {
      title: '勤怠打刻',
      href: '/teacher/attendance',
      icon: <Briefcase size={28}/>,
      color: 'teal',
      desc: '出退勤の記録',
      restricted: false // 許可
    },
    {
      title: '連絡',
      href: '/teacher/contacts',
      icon: <Phone size={28}/>,
      color: 'green',
      desc: '保護者・生徒へ',
      restricted: true // ★制限
    },
    {
      title: 'チャット',
      href: '/teacher/chat',
      icon: <MessageCircle size={28}/>,
      color: 'blue',
      desc: 'メッセージ確認',
      restricted: false // 許可
    },
    {
      title: '宿題管理',
      href: '/teacher/homework',
      icon: <ClipboardList size={28}/>,
      color: 'orange',
      desc: '提出状況・採点',
      badge: pendingCount > 0 ? pendingCount : null,
      restricted: true // ★制限
    },
    {
      title: '生徒名簿',
      href: '/teacher/students',
      icon: <Users size={28}/>,
      color: 'purple',
      desc: '学習状況・詳細',
      restricted: true // ★制限
    },
    {
      title: 'PF管理',
      href: '/teacher/pf',
      icon: <BarChart3 size={28}/>,
      color: 'indigo',
      desc: '成績・進捗データ',
      restricted: true // ★制限
    },
    {
      title: 'シフト提出',
      href: '/teacher/shifts',
      icon: <CalendarPlus size={28}/>,
      color: 'yellow',
      desc: '来月の希望提出',
      restricted: false // 許可
    },
    {
      title: '退塾アラート',
      href: '/teacher/risk-monitor',
      icon: <AlertTriangle size={28}/>,
      color: 'red',
      desc: '要注意生徒',
      animate: true,
      restricted: true // ★制限
    },
  ];

  const getColorClasses = (color: string) => {
    const map: {[key: string]: { bg: string, text: string, border: string, hover: string }} = {
      teal:   { bg: 'bg-teal-50',   text: 'text-teal-600',   border: 'border-teal-100',   hover: 'group-hover:bg-teal-100' },
      green:  { bg: 'bg-green-50',  text: 'text-green-600',  border: 'border-green-100',  hover: 'group-hover:bg-green-100' },
      blue:   { bg: 'bg-blue-50',   text: 'text-blue-600',   border: 'border-blue-100',   hover: 'group-hover:bg-blue-100' },
      orange: { bg: 'bg-orange-50', text: 'text-orange-600', border: 'border-orange-100', hover: 'group-hover:bg-orange-100' },
      purple: { bg: 'bg-purple-50', text: 'text-purple-600', border: 'border-purple-100', hover: 'group-hover:bg-purple-100' },
      indigo: { bg: 'bg-indigo-50', text: 'text-indigo-600', border: 'border-indigo-100', hover: 'group-hover:bg-indigo-100' },
      yellow: { bg: 'bg-yellow-50', text: 'text-yellow-600', border: 'border-yellow-100', hover: 'group-hover:bg-yellow-100' },
      red:    { bg: 'bg-red-50',    text: 'text-red-600',    border: 'border-red-100',    hover: 'group-hover:bg-red-100' },
    };
    return map[color] || map.blue;
  };

  return (
    <div className="p-4 sm:p-6 lg:p-8 space-y-6 animate-in fade-in duration-300 pb-24">
      
      {/* プロフィールカード */}
      <div className="bg-gradient-to-br from-gray-800 to-gray-900 p-6 rounded-[28px] shadow-lg text-white relative overflow-hidden">
        <div className="absolute top-0 right-0 w-40 h-40 bg-white/5 rounded-full blur-3xl -translate-y-10 translate-x-10"></div>
        <div className="flex items-center gap-5 relative z-10">
          <div className="w-16 h-16 bg-white/10 backdrop-blur-md rounded-2xl flex items-center justify-center text-3xl font-bold shadow-inner border border-white/10">
            {profile?.name?.charAt(0) || 'T'}
          </div>
          <div>
            <p className="text-xs font-bold opacity-60 mb-1">お疲れ様です</p>
            <h1 className="text-2xl font-extrabold tracking-tight leading-none mb-2">{profile?.name} 先生</h1>
            <div className="flex items-center gap-2">
              <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border flex items-center gap-1 ${isInternalNetwork ? 'bg-green-500/20 text-green-300 border-green-500/30' : 'bg-orange-500/20 text-orange-300 border-orange-500/30'}`}>
                <span className={`w-1.5 h-1.5 rounded-full ${isInternalNetwork ? 'bg-green-400' : 'bg-orange-400'} animate-pulse`}></span>
                {isInternalNetwork ? '社内ネットワーク接続中' : '社外ネットワーク接続中'}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* メニューグリッド */}
      <div>
        <h2 className="text-sm font-bold text-gray-500 mb-3 px-1">業務メニュー</h2>
        
        {!isInternalNetwork && (
          <div className="mb-4 bg-orange-50 border border-orange-100 rounded-xl p-3 flex items-center gap-2 text-xs text-orange-800">
            <AlertTriangle size={16} />
            <span>社外ネットワークからのアクセスため、個人情報を含む機能は制限されています。</span>
          </div>
        )}

        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 sm:gap-4">
          {menuItems.map((item, idx) => {
            const styles = getColorClasses(item.color);
            // 制限対象 かつ 社外ネットワーク の場合にロックする
            const isLocked = item.restricted && !isInternalNetwork;

            return (
              <Link 
                key={idx} 
                href={isLocked ? '#' : item.href} 
                className={`
                  relative group no-underline
                  flex flex-col items-center justify-center text-center
                  bg-white border-2 
                  rounded-3xl p-4 aspect-[4/3]
                  shadow-sm 
                  transition-all duration-200
                  ${isLocked 
                    ? 'border-gray-100 bg-gray-50 cursor-not-allowed grayscale opacity-60' 
                    : `${styles.border} hover:shadow-md active:scale-[0.98]`
                  }
                `}
                onClick={(e) => { if(isLocked) e.preventDefault(); }}
              >
                {/* アイコン */}
                <div className={`
                  mb-3 p-3 rounded-2xl transition-colors duration-300 relative
                  ${isLocked ? 'bg-gray-200 text-gray-400' : `${styles.bg} ${styles.text} ${styles.hover}`}
                  ${!isLocked && item.animate ? 'animate-pulse' : ''}
                `}>
                  {item.icon}
                  
                  {/* ロックアイコンのオーバーレイ */}
                  {isLocked && (
                    <div className="absolute inset-0 flex items-center justify-center bg-black/10 rounded-2xl">
                      <Lock size={16} className="text-gray-600" />
                    </div>
                  )}
                </div>

                {/* タイトル */}
                <span className={`text-sm font-black leading-tight ${isLocked ? 'text-gray-400' : 'text-gray-700'}`}>
                  {item.title}
                </span>
                
                {/* 説明文 */}
                <span className="text-[10px] font-bold text-gray-400 mt-1">
                  {isLocked ? '社内アクセス限定' : item.desc}
                </span>

                {/* バッジ */}
                {!isLocked && item.badge && (
                  <span className="absolute top-3 right-3 bg-red-500 text-white text-[10px] font-black min-w-[20px] h-5 px-1.5 rounded-full flex items-center justify-center border-2 border-white shadow-sm z-10">
                    {item.badge}
                  </span>
                )}
              </Link>
            );
          })}
        </div>
      </div>
    </div>
  );
}