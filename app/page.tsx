import Link from 'next/link';
import { GraduationCap, LayoutDashboard, UserCircle } from 'lucide-react';

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center p-6">
      <div className="max-w-md w-full bg-white rounded-3xl shadow-xl p-10 text-center border border-slate-200">
        <div className="bg-blue-600 w-20 h-20 rounded-2xl flex items-center justify-center mx-auto mb-6 shadow-lg shadow-blue-200">
          <GraduationCap className="text-white" size={40} />
        </div>
        
        <h1 className="text-3xl font-black text-slate-900 mb-2">Classbase App</h1>
        <p className="text-slate-500 mb-10 font-medium">クラスベース・ポータルサイト</p>

        <div className="space-y-4">
          <Link 
            href="/teacher" 
            className="flex items-center justify-between w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-4 px-6 rounded-2xl transition-all shadow-md active:scale-95"
          >
            <div className="flex items-center gap-3">
              <LayoutDashboard size={20} />
              <span>先生・管理者</span>
            </div>
            <span className="opacity-50 text-sm">→</span>
          </Link>

          <Link 
            href="/student" 
            className="flex items-center justify-between w-full bg-white border-2 border-slate-200 hover:border-blue-600 hover:text-blue-600 text-slate-700 font-bold py-4 px-6 rounded-2xl transition-all active:scale-95"
          >
            <div className="flex items-center gap-3">
              <UserCircle size={20} />
              <span>生徒用ログイン</span>
            </div>
            <span className="opacity-50 text-sm">→</span>
          </Link>
        </div>

        <p className="mt-10 text-xs text-slate-400">
          © 2024 Classbase Project
        </p>
      </div>
    </div>
  );
}