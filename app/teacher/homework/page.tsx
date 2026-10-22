'use client';

import { useState, useEffect } from 'react';
import { useAuth } from '@/app/context/AuthContext';
import { db } from '@/lib/firebase';
import { collection, query, getDocs } from 'firebase/firestore';
import { Plus, Trash2, Calendar, BookOpen, ChevronRight } from 'lucide-react';
import Link from 'next/link';
import {
  Button, IconButton, Card, PageHeader, Modal, useToast, useConfirm,
  ListSkeleton, EmptyState, ErrorState,
} from '@/app/components/ui';
import { formatDate } from '@/lib/format';

const INPUT = 'w-full min-h-11 rounded-input border border-line bg-surface px-3 py-2.5 text-sm text-fg focus:outline-none focus:ring-2 focus:ring-accent';

export default function TeacherHomeworkPage() {
  const { user } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  const [assignments, setAssignments] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [creating, setCreating] = useState(false);

  // 新規作成フォーム
  const [form, setForm] = useState({
    title: '',
    content: '',
    subject: '理科',
    grade: '中1',
    deadline: ''
  });

  // データ取得
  const fetchAssignments = async () => {
    if (!user) return;
    try {
      setLoadError(false);
      // 作成日順などで並べたいが、複合インデックスが必要になる可能性があるため
      // シンプルに取得してからJSでソートします
      const q = query(collection(db, 'homework_assignments'));
      const snapshot = await getDocs(q);
      const list = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as any))
        .filter(item => item.archived !== true && item.status !== 'archived');

      // 締め切りが近い順にソート
      list.sort((a: any, b: any) => new Date(a.deadline).getTime() - new Date(b.deadline).getTime());

      setAssignments(list);
    } catch (e) {
      console.error(e);
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (user) fetchAssignments();
  }, [user]);

  // 新規作成
  const handleCreate = async () => {
    if (!form.title || !form.deadline) return toast.error('タイトルと提出期限は必須です');
    if (!(await confirm({ title: 'この内容で宿題を配信しますか？', confirmLabel: '配信する' }))) return;

    setCreating(true);
    try {
      const token = await user?.getIdToken();
      const res = await fetch('/api/teacher/homework', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ action: 'create', ...form, target_grade: form.grade, description: form.content }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) throw new Error(data.error || 'homework-create-failed');
      toast.success('宿題を作成しました');
      setShowModal(false);
      setForm({ title: '', content: '', subject: '理科', grade: '中1', deadline: '' });
      fetchAssignments();
    } catch (e: any) {
      toast.error('エラー: ' + e.message);
    } finally {
      setCreating(false);
    }
  };

  // 削除
  const handleDelete = async (id: string, title?: string) => {
    if (!(await confirm({
      title: title ? `「${title}」の配信を終了しますか？` : 'この宿題の配信を終了しますか？',
      message: '提出履歴と確認記録は削除せず保管します。',
      tone: 'danger',
      confirmLabel: '配信を終了',
    }))) return;
    try {
      const token = await user?.getIdToken();
      const res = await fetch('/api/teacher/homework', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ action: 'delete', assignment_id: id }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) throw new Error(data.error || 'homework-delete-failed');
      setAssignments(prev => prev.filter(a => a.id !== id));
    } catch (e: any) {
      toast.error('削除エラー: ' + e.message);
    }
  };

  return (
    <div className="px-4 py-5 pb-32 sm:px-6">
      <div className="mx-auto max-w-4xl space-y-6">
        <PageHeader
          tone="plain"
          title="宿題管理"
          icon={BookOpen}
          backHref="/teacher/work"
          actions={(
            <Button icon={<Plus size={18} aria-hidden />} onClick={() => setShowModal(true)}>
              新規作成
            </Button>
          )}
        />

        {/* リスト表示 */}
        {loading ? (
          <ListSkeleton rows={4} />
        ) : loadError ? (
          <ErrorState onRetry={() => { setLoading(true); fetchAssignments(); }} />
        ) : assignments.length === 0 ? (
          <EmptyState icon={BookOpen} title="現在、宿題はありません" />
        ) : (
          <div className="space-y-4">
            {assignments.map((assign) => (
              <Card key={assign.id} className="group flex flex-col justify-between gap-4 transition-colors hover:border-accent/40 md:flex-row md:items-center">
                <Link href={`/teacher/homework/${assign.id}`} className="flex-1 cursor-pointer">
                  <div className="flex items-start gap-4">
                    <div className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-btn text-lg font-bold text-white ${assign.subject === '理科' ? 'bg-emerald-500' : assign.subject === '数学' ? 'bg-blue-500' : 'bg-amber-500'}`}>
                      {assign.subject?.charAt(0)}
                    </div>
                    <div>
                      <div className="mb-1 flex items-center gap-2">
                        <span className="rounded bg-slate-100 px-2 py-0.5 text-xs font-bold text-slate-600">{assign.target_grade || assign.grade}</span>
                        <h3 className="text-lg font-bold text-fg transition-colors group-hover:text-accent">
                          {assign.title}
                        </h3>
                      </div>
                      <p className="flex items-center gap-1 text-xs font-bold text-danger">
                        <Calendar size={12} aria-hidden /> 期限: {formatDate(assign.deadline) || assign.deadline}
                      </p>
                    </div>
                  </div>
                </Link>

                <div className="flex items-center justify-end gap-2 border-t border-line pt-3 md:border-t-0 md:pt-0">
                  <Link href={`/teacher/homework/${assign.id}`} className="flex min-h-11 items-center gap-1 rounded-btn px-3 text-sm font-bold text-accent hover:bg-accent-soft">
                    提出確認 <ChevronRight size={16} aria-hidden />
                  </Link>
                  <IconButton label="配信を終了" onClick={() => handleDelete(assign.id, assign.title)} className="text-slate-400 hover:bg-danger-soft hover:text-danger">
                    <Trash2 size={18} aria-hidden />
                  </IconButton>
                </div>
              </Card>
            ))}
          </div>
        )}

        {/* 新規作成モーダル */}
        <Modal
          open={showModal}
          onClose={() => setShowModal(false)}
          title="新しい宿題を作成"
          footer={(
            <Button fullWidth loading={creating} onClick={handleCreate}>
              作成する
            </Button>
          )}
        >
          <div className="space-y-4">
            <div>
              <label className="mb-1 block text-xs font-bold text-fg-muted">タイトル</label>
              <input type="text" className={INPUT} placeholder="例: 電流と磁界の復習" value={form.title} onChange={e => setForm({...form, title: e.target.value})} />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="mb-1 block text-xs font-bold text-fg-muted">教科</label>
                <select className={INPUT} value={form.subject} onChange={e => setForm({...form, subject: e.target.value})}>
                  <option>理科</option><option>社会</option><option>数学</option><option>英語</option><option>国語</option>
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-bold text-fg-muted">対象学年</label>
                <select className={INPUT} value={form.grade} onChange={e => setForm({...form, grade: e.target.value})}>
                  <option>中1</option><option>中2</option><option>中3</option>
                </select>
              </div>
            </div>

            <div>
              <label className="mb-1 block text-xs font-bold text-fg-muted">提出期限</label>
              <input type="date" className={INPUT} value={form.deadline} onChange={e => setForm({...form, deadline: e.target.value})} />
            </div>

            <div>
              <label className="mb-1 block text-xs font-bold text-fg-muted">詳細・説明</label>
              <textarea className={`${INPUT} h-24`} placeholder="テキストのP.20〜22を解いて提出してください" value={form.content} onChange={e => setForm({...form, content: e.target.value})} />
            </div>
          </div>
        </Modal>
      </div>
    </div>
  );
}
