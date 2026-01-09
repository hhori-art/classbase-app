'use client';

import { useState } from 'react';
import { createClient } from '@/lib/supabase-client';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Plus, Calendar, BookOpen } from 'lucide-react';
import Link from 'next/link';

export default function CreateAssignmentPage() {
  const router = useRouter();
  const supabase = createClient();
  const [loading, setLoading] = useState(false);

  // 入力フォームの状態
  const [formData, setFormData] = useState({
    title: '',
    subject: '理科', // 初期値
    deadline: '',
    description: ''
  });

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      const { error } = await supabase
        .from('assignments')
        .insert({
          title: formData.title,
          subject: formData.subject,
          deadline: new Date(formData.deadline).toISOString(),
          description: formData.description
        });

      if (error) throw error;

      alert('宿題を作成しました！');
      router.push('/teacher/homework'); // 一覧に戻る
      router.refresh();

    } catch (error) {
      alert('作成に失敗しました');
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-100 p-4">
      <div className="max-w-lg mx-auto bg-white p-8 rounded-2xl shadow-sm">
        <div className="flex items-center gap-2 mb-6 text-gray-500">
          <Link href="/teacher/homework" className="hover:text-gray-800 flex items-center">
            <ArrowLeft size={20} className="mr-1" /> キャンセル
          </Link>
        </div>

        <h1 className="text-2xl font-bold text-gray-800 mb-6 flex items-center gap-2">
          <Plus className="bg-blue-100 text-blue-600 rounded-full p-1" size={32} />
          新しい宿題を作成
        </h1>

        <form onSubmit={handleSubmit} className="space-y-6">
          {/* 科目選択 */}
          <div>
            <label className="block text-sm font-bold text-gray-700 mb-2">科目</label>
            <div className="flex gap-4">
              <label className="cursor-pointer">
                <input
                  type="radio"
                  name="subject"
                  value="理科"
                  checked={formData.subject === '理科'}
                  onChange={handleChange}
                  className="peer sr-only"
                />
                <div className="px-4 py-2 rounded-lg border-2 border-gray-200 peer-checked:border-green-500 peer-checked:bg-green-50 peer-checked:text-green-700 transition-all font-bold">
                  🧪 理科
                </div>
              </label>
              <label className="cursor-pointer">
                <input
                  type="radio"
                  name="subject"
                  value="社会"
                  checked={formData.subject === '社会'}
                  onChange={handleChange}
                  className="peer sr-only"
                />
                <div className="px-4 py-2 rounded-lg border-2 border-gray-200 peer-checked:border-orange-500 peer-checked:bg-orange-50 peer-checked:text-orange-700 transition-all font-bold">
                  🌏 社会
                </div>
              </label>
            </div>
          </div>

          {/* タイトル */}
          <div>
            <label className="block text-sm font-bold text-gray-700 mb-2">宿題のタイトル</label>
            <div className="relative">
              <BookOpen className="absolute left-3 top-3 text-gray-400" size={20} />
              <input
                type="text"
                name="title"
                required
                value={formData.title}
                onChange={handleChange}
                placeholder="例：電流の性質 ワークp20-22"
                className="w-full pl-10 pr-4 py-3 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none text-gray-900"
              />
            </div>
          </div>

          {/* 期限 */}
          <div>
            <label className="block text-sm font-bold text-gray-700 mb-2">提出期限</label>
            <div className="relative">
              <Calendar className="absolute left-3 top-3 text-gray-400" size={20} />
              <input
                type="date"
                name="deadline"
                required
                value={formData.deadline}
                onChange={handleChange}
                className="w-full pl-10 pr-4 py-3 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none text-gray-900"
              />
            </div>
          </div>

          {/* 詳細 */}
          <div>
            <label className="block text-sm font-bold text-gray-700 mb-2">詳細・メモ</label>
            <textarea
              name="description"
              rows={4}
              value={formData.description}
              onChange={handleChange}
              placeholder="生徒への指示があればここに入力..."
              className="w-full p-4 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none text-gray-900 resize-none"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-blue-600 text-white py-4 rounded-xl font-bold shadow-lg hover:bg-blue-700 transition-all active:scale-[0.98] disabled:opacity-50"
          >
            {loading ? '作成中...' : 'この内容で宿題を出す'}
          </button>
        </form>
      </div>
    </div>
  );
}