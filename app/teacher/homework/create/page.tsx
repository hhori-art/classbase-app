'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/app/context/AuthContext'; // 認証コンテキスト（作成者ID用）

import { Plus, Calendar, BookOpen } from 'lucide-react';
import { Button, Card, PageHeader, useToast } from '@/app/components/ui';

const FIELD = 'w-full min-h-11 rounded-input border border-line bg-surface py-3 font-bold text-fg outline-none transition-colors focus:border-accent focus:ring-2 focus:ring-accent/30';
const LABEL = 'mb-2 block text-xs font-bold text-fg-muted';

export default function CreateAssignmentPage() {
  const router = useRouter();
  const toast = useToast();
  const { user } = useAuth(); // 現在ログインしている講師の情報を取得
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
      toast.error('ログインが必要です');
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

      toast.success('宿題を作成しました');
      router.push('/teacher/homework'); // 一覧に戻る
      router.refresh();

    } catch (error) {
      console.error('Error adding document: ', error);
      toast.error('作成に失敗しました');
    } finally {
      setLoading(false);
    }
  };

  const subjectOption = (value: string, label: string) => (
    <label className="flex-1 cursor-pointer">
      <input
        type="radio"
        name="subject"
        value={value}
        checked={formData.subject === value}
        onChange={handleChange}
        className="peer sr-only"
      />
      <div className="flex min-h-11 items-center justify-center rounded-btn border-2 border-line px-4 py-3 text-center font-bold text-fg-muted transition-colors hover:bg-canvas peer-checked:border-accent peer-checked:bg-accent-soft peer-checked:text-accent peer-focus-visible:ring-2 peer-focus-visible:ring-accent">
        {label}
      </div>
    </label>
  );

  return (
    <div className="px-4 py-5 sm:px-6">
      <div className="mx-auto max-w-lg space-y-6">
        <PageHeader tone="plain" title="新しい宿題を作成" icon={Plus} backHref="/teacher/homework" />

        <Card>
          <form onSubmit={handleSubmit} className="space-y-6">
            {/* 科目選択 */}
            <fieldset>
              <legend className={LABEL}>対象科目</legend>
              <div className="flex gap-4">
                {subjectOption('理科', '🧪 理科')}
                {subjectOption('社会', '🌏 社会')}
              </div>
            </fieldset>

            {/* タイトル */}
            <div>
              <label htmlFor="hw-title" className={LABEL}>宿題のタイトル</label>
              <div className="group relative">
                <BookOpen className="absolute left-3 top-3.5 text-slate-400 transition-colors group-focus-within:text-accent" size={20} aria-hidden />
                <input
                  id="hw-title"
                  type="text"
                  name="title"
                  required
                  value={formData.title}
                  onChange={handleChange}
                  placeholder="例：電流の性質 ワークp20-22"
                  className={`${FIELD} pl-10 pr-4`}
                />
              </div>
            </div>

            {/* 学年 */}
            <div>
              <label htmlFor="hw-grade" className={LABEL}>対象学年</label>
              <select
                id="hw-grade"
                name="target_grade"
                value={formData.target_grade}
                onChange={handleChange}
                className={`${FIELD} px-4`}
              >
                <option>中1</option>
                <option>中2</option>
                <option>中3</option>
              </select>
            </div>

            {/* 期限 */}
            <div>
              <label htmlFor="hw-deadline" className={LABEL}>提出期限</label>
              <div className="group relative">
                <Calendar className="absolute left-3 top-3.5 text-slate-400 transition-colors group-focus-within:text-accent" size={20} aria-hidden />
                <input
                  id="hw-deadline"
                  type="date"
                  name="deadline"
                  required
                  value={formData.deadline}
                  onChange={handleChange}
                  className={`${FIELD} pl-10 pr-4`}
                />
              </div>
            </div>

            {/* 詳細 */}
            <div>
              <label htmlFor="hw-description" className={LABEL}>詳細・メモ (任意)</label>
              <textarea
                id="hw-description"
                name="description"
                rows={4}
                value={formData.description}
                onChange={handleChange}
                placeholder="生徒への指示や補足があればここに入力..."
                className={`${FIELD} resize-none px-4 font-medium`}
              />
            </div>

            <Button
              type="submit"
              size="lg"
              fullWidth
              loading={loading}
              icon={<Plus strokeWidth={3} size={20} aria-hidden />}
            >
              {loading ? '作成中...' : 'この内容で宿題を出す'}
            </Button>
          </form>
        </Card>
      </div>
    </div>
  );
}
