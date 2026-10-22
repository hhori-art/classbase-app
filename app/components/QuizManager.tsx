'use client';

import { useState, useEffect } from 'react';
import { db } from '@/lib/firebase';
import { collection, query, orderBy, onSnapshot, deleteDoc, doc, writeBatch, getDocs } from 'firebase/firestore';
import { Trash2, RefreshCcw, FileUp, Loader2, CheckCircle } from 'lucide-react';
import { Button, IconButton, buttonClass, EmptyState, ErrorState, ListSkeleton, useToast, useConfirm } from '@/app/components/ui';
import { cn } from '@/lib/cn';

export default function QuizManager() {
  const toast = useToast();
  const confirm = useConfirm();
  const [quizzes, setQuizzes] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [processing, setProcessing] = useState(false);

  // ■ リアルタイムで問題一覧を取得
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

  // ■ Shift-JIS対応ファイル読み込み
  const readShiftJisFile = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => resolve(e.target?.result as string);
      reader.onerror = (error) => reject(error);
      reader.readAsText(file, 'Shift-JIS');
    });
  };

  // ■ CSVアップロード処理
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setProcessing(true);

    try {
      const text = await readShiftJisFile(file);
      const lines = text.replace(/\r\n/g, '\n').split('\n');
      const batch = writeBatch(db);
      let count = 0;

      lines.forEach((line) => {
        const trimmed = line.trim();
        // ヘッダーやコメント行をスキップ
        if (!trimmed || trimmed.startsWith('//') || trimmed.startsWith('context') || trimmed.startsWith('alternatives')) return;

        const cols = line.split(',');
        if (cols.length < 2) return;

        const question = cols[0].trim();
        const correct = cols[1].trim();

        if (!question || !correct) return;

        // 誤答リスト（空文字を除外）
        const wrongs = cols.slice(3).map(c => c.trim()).filter(c => c && c !== 'explanation');

        const newRef = doc(collection(db, 'quizzes'));
        batch.set(newRef, {
          question: question,
          correct_answer: correct,
          wrong_answers: wrongs,
          difficulty: 3, // デフォルト難易度
          created_at: new Date().toISOString()
        });
        count++;
      });

      if (count > 0) {
        await batch.commit();
        toast.success(`${count}件の問題を追加登録しました。`);
      } else {
        toast.error('追加できるデータが見つかりませんでした。CSVを確認してください。');
      }
    } catch (error) {
      console.error(error);
      toast.error('問題を追加できませんでした。もう一度お試しください。');
    } finally {
      setProcessing(false);
      e.target.value = ''; // ファイル選択をリセット
    }
  };

  // ■ 全削除機能
  const handleDeleteAll = async () => {
    if (quizzes.length === 0) return;
    if (!(await confirm({
      title: `登録済みの問題${quizzes.length}件をすべて削除しますか？`,
      message: 'この操作は元に戻せません。',
      confirmLabel: 'すべて削除する',
      tone: 'danger',
    }))) return;

    setProcessing(true);
    try {
      const snapshot = await getDocs(collection(db, 'quizzes'));
      const batch = writeBatch(db);
      snapshot.docs.forEach((doc) => batch.delete(doc.ref));
      await batch.commit();
      toast.success('すべての問題を削除しました。');
    } catch (e) {
      console.error(e);
      toast.error('削除できませんでした。もう一度お試しください。');
    } finally {
      setProcessing(false);
    }
  };

  // ■ 個別削除機能
  const handleDeleteOne = async (id: string, question?: string) => {
    if (!(await confirm({
      title: question ? `「${question}」を削除しますか？` : 'この問題を削除しますか？',
      confirmLabel: '削除する',
      tone: 'danger',
    }))) return;
    try {
      await deleteDoc(doc(db, 'quizzes', id));
    } catch (e) {
      console.error(e);
      toast.error('削除できませんでした。もう一度お試しください。');
    }
  };

  return (
    <div className="mx-auto w-full max-w-4xl rounded-card border border-line bg-surface p-6 shadow-sm">
      <div className="mb-6 flex flex-col items-center justify-between gap-4 md:flex-row">
        <h3 className="flex items-center gap-2 text-lg font-bold text-slate-800">
          <RefreshCcw size={20} className="text-accent" aria-hidden />
          小テスト問題管理
          <span className="ml-2 text-sm font-normal text-slate-500">
            (現在 {quizzes.length}問)
          </span>
        </h3>

        <div className="flex w-full gap-3 md:w-auto">
          {/* CSVアップロードボタン */}
          <label className={buttonClass('primary', 'md', cn('flex-1 cursor-pointer md:flex-none', processing && 'cursor-not-allowed opacity-50'))}>
            {processing ? <Loader2 className="animate-spin" size={18} aria-hidden /> : <FileUp size={18} aria-hidden />}
            <span>CSV追加</span>
            <input type="file" accept=".csv" className="hidden" onChange={handleFileUpload} disabled={processing} />
          </label>

          {/* 全削除ボタン（常に表示・件数0ならグレーアウト） */}
          <Button
            variant="danger"
            onClick={handleDeleteAll}
            disabled={processing || quizzes.length === 0}
            icon={<Trash2 size={18} aria-hidden />}
            className="flex-1 md:flex-none"
          >
            全削除
          </Button>
        </div>
      </div>

      {/* 問題リスト表示エリア */}
      <div className="max-h-[500px] min-h-[200px] overflow-y-auto rounded-card border border-line bg-slate-50">
        {loading ? (
          <div className="p-4"><ListSkeleton rows={4} /></div>
        ) : loadError ? (
          <ErrorState onRetry={reload} />
        ) : quizzes.length === 0 ? (
          <EmptyState icon={FileUp} title="問題が登録されていません" description="CSVファイルをアップロードしてください" />
        ) : (
          <div className="divide-y divide-slate-200">
            {quizzes.map((quiz, index) => (
              <div key={quiz.id} className="group flex items-start justify-between bg-surface p-4 transition-colors hover:bg-slate-50">
                <div className="flex gap-3">
                  <span className="mt-1 min-w-[20px] text-xs font-bold text-slate-400">
                    {String(index + 1).padStart(2, '0')}
                  </span>
                  <div>
                    <p className="mb-1 text-sm font-bold leading-snug text-slate-800">
                      {quiz.question}
                    </p>
                    <div className="flex flex-wrap gap-2 text-xs">
                      <span className="inline-flex items-center gap-1 rounded-btn border border-emerald-100 bg-emerald-50 px-2 py-0.5 text-emerald-700">
                        <CheckCircle size={12} aria-hidden /> {quiz.correct_answer}
                      </span>
                      {quiz.wrong_answers?.map((ans: string, i: number) => (
                        <span key={i} className="rounded-btn border border-slate-200 bg-slate-100 px-2 py-0.5 text-slate-500">
                          {ans}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>

                <IconButton
                  label="削除"
                  size="sm"
                  onClick={() => handleDeleteOne(quiz.id, quiz.question)}
                  className="text-slate-400 hover:text-rose-600"
                >
                  <Trash2 size={16} aria-hidden />
                </IconButton>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
