'use client';
import { useState, useEffect } from 'react';
import { db } from '@/lib/firebase';
import { collection, query, orderBy, onSnapshot, deleteDoc, doc, writeBatch, getDocs } from 'firebase/firestore';
import { Trash2, RefreshCcw } from 'lucide-react';
import { Button, IconButton, EmptyState, ErrorState, ListSkeleton, useToast, useConfirm } from '@/app/components/ui';

export default function QuizManager() {
  const toast = useToast();
  const confirm = useConfirm();
  const [quizzes, setQuizzes] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [isDeleting, setIsDeleting] = useState(false);

  useEffect(() => {
    const q = query(collection(db, 'quizzes'), orderBy('created_at', 'desc'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      setQuizzes(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
      setLoadError(false);
      setLoading(false);
    }, (error) => {
      console.error(error);
      setLoadError(true);
      setLoading(false);
    });
    return () => unsubscribe();
  }, [reloadKey]);

  const reload = () => {
    setLoading(true);
    setLoadError(false);
    setReloadKey(key => key + 1);
  };

  // 1件削除
  const handleDelete = async (id: string, question?: string) => {
    if (!(await confirm({
      title: question ? `「${question}」を削除しますか？` : 'この問題を削除しますか？',
      confirmLabel: '削除する',
      tone: 'danger',
    }))) return;
    await deleteDoc(doc(db, 'quizzes', id));
  };

  // 全削除（入れ替え用）
  const handleDeleteAll = async () => {
    if (!(await confirm({
      title: '登録済みの問題をすべて削除しますか？',
      message: 'この操作は取り消せません。',
      confirmLabel: 'すべて削除する',
      tone: 'danger',
    }))) return;
    setIsDeleting(true);
    try {
      const snapshot = await getDocs(collection(db, 'quizzes'));
      const batch = writeBatch(db);
      snapshot.docs.forEach((doc) => {
        batch.delete(doc.ref);
      });
      await batch.commit();
      toast.success('すべての問題を削除しました。新しいCSVをインポートしてください。');
    } catch (e) {
      console.error(e);
      toast.error('削除できませんでした。もう一度お試しください。');
    } finally {
      setIsDeleting(false);
    }
  };

  if (loading) return <div className="p-4"><ListSkeleton rows={3} /></div>;

  return (
    <div className="mt-6 rounded-card border border-line bg-surface p-6 shadow-sm">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="flex items-center gap-2 font-bold text-slate-700">
          <RefreshCcw size={18} aria-hidden />
          登録済み問題一覧 ({quizzes.length}件)
        </h3>
        {quizzes.length > 0 && (
          <Button
            variant="danger"
            size="sm"
            onClick={handleDeleteAll}
            disabled={isDeleting}
            loading={isDeleting}
            icon={<Trash2 size={14} aria-hidden />}
          >
            {isDeleting ? '削除中' : '全て削除'}
          </Button>
        )}
      </div>

      <div className="max-h-[300px] space-y-2 overflow-y-auto">
        {loadError ? (
          <ErrorState onRetry={reload} />
        ) : quizzes.length === 0 ? (
          <EmptyState title="問題が登録されていません" description="CSVをインポートしてください。" />
        ) : (
          quizzes.map((quiz) => (
            <div key={quiz.id} className="flex items-start justify-between rounded-btn border border-slate-100 bg-slate-50 p-3 transition-colors hover:bg-slate-100">
              <div>
                <p className="text-sm font-bold text-slate-800">{quiz.question}</p>
                <p className="mt-1 text-xs text-accent">正解: {quiz.correct_answer}</p>
              </div>
              <IconButton
                label="削除"
                size="sm"
                onClick={() => handleDelete(quiz.id, quiz.question)}
                className="text-slate-400 hover:text-rose-600"
              >
                <Trash2 size={16} aria-hidden />
              </IconButton>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
