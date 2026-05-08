'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/app/context/AuthContext'; // 認証コンテキスト（作成者ID用）

import { ArrowLeft, Plus, Calendar, BookOpen, Loader2 } from 'lucide-react';
import Link from 'next/link';

export default function CreateAssignmentPage() {
  const router = useRouter();
  const { user } = useAuth(); // 現在ログインしている先生の情報を取得
  const [loading, setLoading] = useState(false);

  // 入力フォームの状態
  const [formData, setFormData] = useState({
    title: '',
    subject: '理科', // 初期値
    target_grade: '中1',
    deadline: '',
    description: ''
  });

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) {
      alert('ログインが必要です');
      return;
    }
    
    setLoading(true);

    try {
      const token = await user.getIdToken();
      const res = await fetch('/api/teacher/homework', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ action: 'create', ...formData }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) throw new Error(data.error || 'homework-create-failed');

      alert('宿題を作成しました！');
      router.push('/teacher/homework'); // 一覧に戻る
      router.refresh();

    } catch (error) {
      console.error('Error adding document: ', error);
      alert('作成に失敗しました');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-100 p-4 font-sans">
      <div className="max-w-lg mx-auto bg-white p-8 rounded-2xl shadow-sm border border-gray-100">
        <div className="flex items-center gap-2 mb-6 text-gray-500">
          <Link href="/teacher/homework" className="hover:text-gray-800 flex items-center text-sm font-bold transition-colors">
            <ArrowLeft size={18} className="mr-1" /> キャンセルして戻る
          </Link>
        </div>

        <h1 className="text-2xl font-black text-gray-800 mb-8 flex items-center gap-3">
          <span className="bg-indigo-100 text-indigo-600 rounded-full p-2">
            <Plus size={24} strokeWidth={3} />
          </span>
          新しい宿題を作成
        </h1>

        <form onSubmit={handleSubmit} className="space-y-6">
          {/* 科目選択 */}
          <div>
            <label className="block text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">対象科目</label>
            <div className="flex gap-4">
              <label className="cursor-pointer flex-1">
                <input
                  type="radio"
                  name="subject"
                  value="理科"
                  checked={formData.subject === '理科'}
                  onChange={handleChange}
                  className="peer sr-only"
                />
                <div className="text-center px-4 py-3 rounded-xl border-2 border-gray-100 peer-checked:border-emerald-500 peer-checked:bg-emerald-50 peer-checked:text-emerald-700 transition-all font-bold text-gray-500 hover:bg-gray-50">
                  🧪 理科
                </div>
              </label>
              <label className="cursor-pointer flex-1">
                <input
                  type="radio"
                  name="subject"
                  value="社会"
                  checked={formData.subject === '社会'}
                  onChange={handleChange}
                  className="peer sr-only"
                />
                <div className="text-center px-4 py-3 rounded-xl border-2 border-gray-100 peer-checked:border-orange-500 peer-checked:bg-orange-50 peer-checked:text-orange-700 transition-all font-bold text-gray-500 hover:bg-gray-50">
                  🌏 社会
                </div>
              </label>
            </div>
          </div>

          {/* タイトル */}
          <div>
            <label className="block text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">宿題のタイトル</label>
            <div className="relative group">
              <BookOpen className="absolute left-3 top-3.5 text-gray-400 group-focus-within:text-indigo-500 transition-colors" size={20} />
              <input
                type="text"
                name="title"
                required
                value={formData.title}
                onChange={handleChange}
                placeholder="例：電流の性質 ワークp20-22"
                className="w-full pl-10 pr-4 py-3 bg-gray-50 border-2 border-gray-100 rounded-xl focus:border-indigo-500 focus:bg-white outline-none text-gray-900 font-bold transition-all"
              />
            </div>
          </div>

          {/* 期限 */}
          <div>
            <label className="block text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">対象学年</label>
            <select
              name="target_grade"
              value={formData.target_grade}
              onChange={handleChange}
              className="w-full px-4 py-3 bg-gray-50 border-2 border-gray-100 rounded-xl focus:border-indigo-500 focus:bg-white outline-none text-gray-900 font-bold transition-all"
            >
              <option>中1</option>
              <option>中2</option>
              <option>中3</option>
            </select>
          </div>

          {/* 期限 */}
          <div>
            <label className="block text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">提出期限</label>
            <div className="relative group">
              <Calendar className="absolute left-3 top-3.5 text-gray-400 group-focus-within:text-indigo-500 transition-colors" size={20} />
              <input
                type="date"
                name="deadline"
                required
                value={formData.deadline}
                onChange={handleChange}
                className="w-full pl-10 pr-4 py-3 bg-gray-50 border-2 border-gray-100 rounded-xl focus:border-indigo-500 focus:bg-white outline-none text-gray-900 font-bold transition-all"
              />
            </div>
          </div>

          {/* 詳細 */}
          <div>
            <label className="block text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">詳細・メモ (任意)</label>
            <textarea
              name="description"
              rows={4}
              value={formData.description}
              onChange={handleChange}
              placeholder="生徒への指示や補足があればここに入力..."
              className="w-full p-4 bg-gray-50 border-2 border-gray-100 rounded-xl focus:border-indigo-500 focus:bg-white outline-none text-gray-900 font-medium resize-none transition-all"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-indigo-600 text-white py-4 rounded-xl font-bold shadow-lg shadow-indigo-200 hover:bg-indigo-700 hover:shadow-xl transition-all active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            {loading ? <Loader2 className="animate-spin" /> : <Plus strokeWidth={3} size={20}/>}
            {loading ? '作成中...' : 'この内容で宿題を出す'}
          </button>
        </form>
      </div>
    </div>
  );
}
