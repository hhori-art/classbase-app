'use client';
import { useState, useEffect } from 'react';
import { db } from '@/lib/firebase';
import { collection, query, orderBy, onSnapshot, deleteDoc, doc, writeBatch, getDocs } from 'firebase/firestore';
import { Trash2, RefreshCcw, AlertTriangle } from 'lucide-react';

export default function QuizManager() {
  const [quizzes, setQuizzes] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [isDeleting, setIsDeleting] = useState(false);

  useEffect(() => {
    const q = query(collection(db, 'quizzes'), orderBy('created_at', 'desc'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      setQuizzes(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
      setLoading(false);
    });
    return () => unsubscribe();
  }, []);

  // 1件削除
  const handleDelete = async (id: string) => {
    if (!confirm('この問題を削除しますか？')) return;
    await deleteDoc(doc(db, 'quizzes', id));
  };

  // 全削除（入れ替え用）
  const handleDeleteAll = async () => {
    if (!confirm('【警告】すべての問題を削除しますか？\nこの操作は取り消せません。')) return;
    setIsDeleting(true);
    try {
      const snapshot = await getDocs(collection(db, 'quizzes'));
      const batch = writeBatch(db);
      snapshot.docs.forEach((doc) => {
        batch.delete(doc.ref);
      });
      await batch.commit();
      alert('すべての問題を削除しました。新しいCSVをインポートしてください。');
    } catch (e) {
      console.error(e);
      alert('削除中にエラーが発生しました');
    } finally {
      setIsDeleting(false);
    }
  };

  if (loading) return <div className="p-4 text-gray-500">データを読み込み中...</div>;

  return (
    <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-200 mt-6">
      <div className="flex justify-between items-center mb-4">
        <h3 className="font-bold text-gray-700 flex items-center gap-2">
          <RefreshCcw size={18} />
          登録済み問題一覧 ({quizzes.length}件)
        </h3>
        {quizzes.length > 0 && (
          <button 
            onClick={handleDeleteAll} 
            disabled={isDeleting}
            className="text-xs bg-red-100 text-red-600 px-3 py-1.5 rounded hover:bg-red-200 flex items-center gap-1 transition-colors"
          >
            {isDeleting ? '削除中...' : <><Trash2 size={14} /> 全て削除</>}
          </button>
        )}
      </div>

      <div className="overflow-y-auto max-h-[300px] space-y-2">
        {quizzes.length === 0 ? (
          <div className="text-center py-8 text-gray-400 bg-gray-50 rounded-lg border border-dashed border-gray-300">
            問題が登録されていません。<br/>CSVをインポートしてください。
          </div>
        ) : (
          quizzes.map((quiz) => (
            <div key={quiz.id} className="flex justify-between items-start p-3 bg-gray-50 rounded-lg border border-gray-100 hover:bg-gray-100 transition-colors">
              <div>
                <p className="font-bold text-sm text-gray-800">{quiz.question}</p>
                <p className="text-xs text-blue-600 mt-1">正解: {quiz.correct_answer}</p>
              </div>
              <button 
                onClick={() => handleDelete(quiz.id)}
                className="text-gray-400 hover:text-red-500 p-1"
              >
                <Trash2 size={16} />
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}