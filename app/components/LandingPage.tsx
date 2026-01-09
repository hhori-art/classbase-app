'use client';

import Link from 'next/link';
import { ArrowRight, ShieldCheck, Sparkles, GraduationCap } from 'lucide-react';

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-white flex flex-col font-sans text-slate-800">
      
      {/* ナビゲーション */}
      <nav className="flex items-center justify-between p-6 max-w-6xl mx-auto w-full">
        <div className="flex items-center gap-2">
          <div className="bg-blue-600 text-white p-2 rounded-lg">
            <GraduationCap size={24} />
          </div>
          <span className="text-xl font-bold tracking-tight text-slate-900">ClassBase</span>
        </div>
        <Link 
          href="/admin/login" 
          className="text-sm font-bold text-slate-500 hover:text-blue-600 flex items-center gap-1 transition-colors"
        >
          <ShieldCheck size={16} /> 先生・管理者はこちら
        </Link>
      </nav>

      {/* メインエリア (Hero) */}
      <main className="flex-1 flex flex-col items-center justify-center text-center p-6 pb-20">
        <div className="max-w-2xl space-y-8 animate-in slide-in-from-bottom-5 duration-700 fade-in">
          
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-blue-50 text-blue-600 text-xs font-bold border border-blue-100 mb-4">
            <Sparkles size={12} />
            <span>新しい学習管理体験</span>
          </div>

          <h1 className="text-5xl md:text-6xl font-extrabold tracking-tight text-slate-900 leading-[1.1]">
            学びをもっと、<br />
            <span className="text-blue-600">スマート</span>に。
          </h1>
          
          <p className="text-lg text-slate-500 leading-relaxed max-w-md mx-auto">
            宿題の提出、欠席連絡、授業動画の視聴。<br />
            すべての連絡をこのアプリひとつで完結させましょう。
          </p>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-4 pt-4">
            <Link 
              href="/login" 
              className="w-full sm:w-auto px-8 py-4 bg-blue-600 text-white rounded-full font-bold text-lg shadow-lg shadow-blue-200 hover:bg-blue-700 hover:scale-105 transition-all flex items-center justify-center gap-2"
            >
              生徒ログイン <ArrowRight size={20} />
            </Link>
            {/* 新規登録などは塾側の管理なのでボタンは置かない */}
          </div>

          <div className="pt-12 grid grid-cols-3 gap-8 opacity-60 grayscale hover:grayscale-0 transition-all duration-500">
            {/* 装飾用アイコン */}
            <div className="flex flex-col items-center gap-2">
              <div className="w-12 h-12 bg-gray-100 rounded-2xl flex items-center justify-center">📚</div>
              <span className="text-xs font-bold text-gray-400">宿題管理</span>
            </div>
            <div className="flex flex-col items-center gap-2">
              <div className="w-12 h-12 bg-gray-100 rounded-2xl flex items-center justify-center">🎥</div>
              <span className="text-xs font-bold text-gray-400">授業録画</span>
            </div>
            <div className="flex flex-col items-center gap-2">
              <div className="w-12 h-12 bg-gray-100 rounded-2xl flex items-center justify-center">💬</div>
              <span className="text-xs font-bold text-gray-400">相談チャット</span>
            </div>
          </div>
        </div>
      </main>

      <footer className="p-6 text-center text-xs text-gray-400 border-t border-gray-100">
        © 2025 ClassBase System. All rights reserved.
      </footer>
    </div>
  );
}