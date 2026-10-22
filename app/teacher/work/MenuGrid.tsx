'use client';

import Link from 'next/link';
import { 
  ClipboardList, CalendarPlus, MessageCircle, Users, 
  Phone, BarChart3, Briefcase, AlertTriangle, Lock, Megaphone, BookOpen, Smartphone
} from 'lucide-react';
import { useAuth } from '@/app/context/AuthContext';
import { isDedicatedAttendanceApproverProfile } from '@/lib/employment-category';

type Props = {
  isInternalNetwork: boolean;
};

export default function TeacherWorkMenu({ isInternalNetwork }: Props) {
  const { profile } = useAuth();
  const pendingCount = 0; 
  const canApproveAttendance = Boolean(profile && isDedicatedAttendanceApproverProfile(profile));

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
    ...(canApproveAttendance ? [{
      title: '自校舎の勤怠承認',
      href: '/teacher/attendance-approvals',
      icon: <ClipboardList size={28}/>,
      color: 'green',
      desc: '打刻修正・詳細承認',
      restricted: false,
    }] : []),
    ...(canApproveAttendance ? [{
      title: '勤怠シフト管理',
      href: '/teacher/shift-management',
      icon: <CalendarPlus size={28}/>,
      color: 'indigo',
      desc: '自校舎の勤務予定を管理',
      restricted: false,
    }] : []),
    {
      title: '代行掲示板',
      href: '/teacher/substitutions',
      icon: <Megaphone size={28}/>,
      color: 'red',
      desc: '代行募集・引受',
      restricted: false
    },
    {
      title: '生徒画面テスト',
      href: '/teacher/student-preview',
      icon: <Smartphone size={28}/>,
      color: 'green',
      desc: '生徒画面を確認',
      restricted: false
    },
    {
      title: 'オンライン校 管理',
      href: '/teacher/online-school',
      icon: <BookOpen size={28}/>,
      color: 'purple',
      desc: '10分学習の実施状況',
      restricted: true
    },
    {
      title: '授業PPT',
      href: '/teacher/slides',
      icon: <BookOpen size={28}/>,
      color: 'indigo',
      desc: '教材ダウンロード',
      restricted: false
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
      title: '担当クラスPF',
      href: '/teacher/pf',
      icon: <BarChart3 size={28}/>,
      color: 'indigo',
      desc: '出欠・宿題・小テスト',
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
      teal:   { bg: 'bg-teal-50',    text: 'text-teal-600',    border: 'border-teal-100',    hover: 'group-hover:bg-teal-100' },
      green:  { bg: 'bg-emerald-50', text: 'text-emerald-600', border: 'border-emerald-100', hover: 'group-hover:bg-emerald-100' },
      blue:   { bg: 'bg-sky-50',     text: 'text-sky-600',     border: 'border-sky-100',     hover: 'group-hover:bg-sky-100' },
      orange: { bg: 'bg-amber-50',   text: 'text-amber-600',   border: 'border-amber-100',   hover: 'group-hover:bg-amber-100' },
      purple: { bg: 'bg-violet-50',  text: 'text-violet-600',  border: 'border-violet-100',  hover: 'group-hover:bg-violet-100' },
      indigo: { bg: 'bg-indigo-50',  text: 'text-indigo-600',  border: 'border-indigo-100',  hover: 'group-hover:bg-indigo-100' },
      yellow: { bg: 'bg-amber-50',   text: 'text-amber-600',   border: 'border-amber-100',   hover: 'group-hover:bg-amber-100' },
      red:    { bg: 'bg-rose-50',    text: 'text-rose-600',    border: 'border-rose-100',    hover: 'group-hover:bg-rose-100' },
    };
    return map[color] || map.blue;
  };

  return (
    <div className="space-y-6 px-4 py-5 sm:px-6">
      
      {/* プロフィールカード */}
      <div className="relative overflow-hidden rounded-hero bg-gradient-to-br from-slate-800 to-slate-900 p-6 text-white shadow-card">
        <div className="relative flex items-center gap-5">
          <div className="flex h-16 w-16 items-center justify-center rounded-card border border-white/10 bg-white/10 text-3xl font-bold">
            {profile?.name?.charAt(0) || 'T'}
          </div>
          <div>
            <p className="mb-1 text-xs font-bold opacity-70">お疲れ様です</p>
            <h1 className="mb-2 text-2xl font-black leading-none tracking-tight">{profile?.name} さん</h1>
            <div className="flex items-center gap-2">
              <span className={`flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-bold ${isInternalNetwork ? 'border-emerald-500/30 bg-emerald-500/20 text-emerald-300' : 'border-amber-500/30 bg-amber-500/20 text-amber-300'}`}>
                <span className={`h-1.5 w-1.5 rounded-full ${isInternalNetwork ? 'bg-emerald-400' : 'bg-amber-400'} motion-safe:animate-pulse`}></span>
                {isInternalNetwork ? '社内ネットワーク接続中' : '社外ネットワーク接続中'}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* メニューグリッド */}
      <div>
        <h2 className="mb-3 px-1 text-sm font-bold text-fg-muted">業務メニュー</h2>
        
        {!isInternalNetwork && (
          <div className="mb-4 flex items-center gap-2 rounded-card border border-amber-100 bg-amber-50 p-3 text-sm text-amber-800">
            <AlertTriangle size={16} className="shrink-0" aria-hidden />
            <span>社外ネットワークからのアクセスのため、個人情報を含む機能は制限されています。</span>
          </div>
        )}

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-4">
          {menuItems.map((item, idx) => {
            const styles = getColorClasses(item.color);
            // 制限対象 かつ 社外ネットワーク の場合にロックする
            const isLocked = item.restricted && !isInternalNetwork;

            return (
              <Link 
                key={idx} 
                href={isLocked ? '#' : item.href} 
                aria-disabled={isLocked || undefined}
                className={`
                  group relative no-underline
                  flex aspect-[4/3] flex-col items-center justify-center text-center
                  rounded-card border-2 bg-surface p-4
                  shadow-sm transition-shadow
                  focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent
                  ${isLocked 
                    ? 'cursor-not-allowed border-line bg-canvas opacity-60 grayscale' 
                    : `${styles.border} hover:shadow-md`
                  }
                `}
                onClick={(e) => { if(isLocked) e.preventDefault(); }}
              >
                {/* アイコン */}
                <div className={`
                  relative mb-3 rounded-card p-3 transition-colors
                  ${isLocked ? 'bg-slate-200 text-slate-400' : `${styles.bg} ${styles.text} ${styles.hover}`}
                  ${!isLocked && item.animate ? 'motion-safe:animate-pulse' : ''}
                `}>
                  {item.icon}
                  
                  {/* ロックアイコンのオーバーレイ */}
                  {isLocked && (
                    <div className="absolute inset-0 flex items-center justify-center rounded-card bg-black/10">
                      <Lock size={16} className="text-slate-600" aria-hidden />
                    </div>
                  )}
                </div>

                {/* タイトル */}
                <span className={`text-sm font-bold leading-tight ${isLocked ? 'text-slate-400' : 'text-fg'}`}>
                  {item.title}
                </span>
                
                {/* 説明文 */}
                <span className="mt-1 text-xs font-bold text-fg-muted">
                  {isLocked ? '社内アクセス限定' : item.desc}
                </span>

                {/* バッジ */}
                {!isLocked && item.badge && (
                  <span className="absolute right-3 top-3 z-10 flex h-5 min-w-[20px] items-center justify-center rounded-full border-2 border-white bg-danger px-1.5 text-xs font-bold text-white shadow-sm">
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
