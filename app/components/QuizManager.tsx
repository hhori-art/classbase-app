'use client';

import { useState, useEffect } from 'react';
import { db } from '@/lib/firebase';
import { collection, query, orderBy, onSnapshot, deleteDoc, doc, writeBatch, getDocs } from 'firebase/firestore';
import { Trash2, RefreshCcw, FileUp, Loader2, AlertTriangle, CheckCircle } from 'lucide-react';

export default function QuizManager() {
  const [quizzes, setQuizzes] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState(false);

  // ■ リアルタイムで問題一覧を取得
  useEffect(() => {
    const q = query(collection(db, 'quizzes'), orderBy('created_at', 'desc'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      setQuizzes(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
      setLoading(false);
    });
    return () => unsubscribe();
  }, []);

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
        alert(`${count}件の問題を追加登録しました！`);
      } else {
        alert('追加できるデータが見つかりませんでした。CSVを確認してください。');
      }
    } catch (error) {
      console.error(error);
      alert('エラーが発生しました');
    } finally {
      setProcessing(false);
      e.target.value = ''; // ファイル選択をリセット
    }
  };

  // ■ 全削除機能
  const handleDeleteAll = async () => {
    if (quizzes.length === 0) return;
    if (!confirm(`現在登録されている ${quizzes.length}件 の問題をすべて削除しますか？\nこの操作は元に戻せません。`)) return;
    
    setProcessing(true);
    try {
      const snapshot = await getDocs(collection(db, 'quizzes'));
      const batch = writeBatch(db);
      snapshot.docs.forEach((doc) => batch.delete(doc.ref));
      await batch.commit();
      alert('すべての問題を削除しました。');
    } catch (e) {
      console.error(e);
      alert('削除に失敗しました');
    } finally {
      setProcessing(false);
    }
  };

  // ■ 個別削除機能
  const handleDeleteOne = async (id: string) => {
    if (!confirm('この問題を削除しますか？')) return;
    try {
      await deleteDoc(doc(db, 'quizzes', id));
    } catch(e) {
      alert('削除エラー');
    }
  };

  return (
    <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-200 w-full max-w-4xl mx-auto">
      <div className="flex flex-col md:flex-row justify-between items-center mb-6 gap-4">
        <h3 className="font-bold text-gray-800 flex items-center gap-2 text-lg">
          <RefreshCcw size={20} className="text-indigo-600"/> 
          小テスト問題管理 
          <span className="text-sm font-normal text-gray-500 ml-2">
            (現在 {quizzes.length}問)
          </span>
        </h3>

        <div className="flex gap-3 w-full md:w-auto">
          {/* CSVアップロードボタン */}
          <label className={`flex-1 md:flex-none flex items-center justify-center gap-2 bg-indigo-600 text-white px-5 py-2.5 rounded-lg cursor-pointer hover:bg-indigo-700 transition-colors shadow-sm ${processing ? 'opacity-50 cursor-not-allowed' : ''}`}>
            {processing ? <Loader2 className="animate-spin" size={18}/> : <FileUp size={18}/>}
            <span className="font-bold text-sm">CSV追加</span>
            <input type="file" accept=".csv" className="hidden" onChange={handleFileUpload} disabled={processing}/>
          </label>

          {/* 全削除ボタン（常に表示・件数0ならグレーアウト） */}
          <button 
            onClick={handleDeleteAll}
            disabled={processing || quizzes.length === 0}
            className={`flex-1 md:flex-none flex items-center justify-center gap-2 px-5 py-2.5 rounded-lg font-bold text-sm border transition-colors ${
              quizzes.length === 0 
                ? 'bg-gray-100 text-gray-400 border-gray-200 cursor-not-allowed' 
                : 'bg-white text-red-600 border-red-200 hover:bg-red-50 hover:border-red-300'
            }`}
          >
            <Trash2 size={18} />
            全削除
          </button>
        </div>
      </div>

      {/* 問題リスト表示エリア */}
      <div className="bg-gray-50 rounded-xl border border-gray-200 overflow-hidden min-h-[200px] max-h-[500px] overflow-y-auto relative">
        {loading ? (
          <div className="absolute inset-0 flex items-center justify-center text-gray-400 gap-2">
            <Loader2 className="animate-spin"/> 読み込み中...
          </div>
        ) : quizzes.length === 0 ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center text-gray-400 p-6 text-center">
            <FileUp size={48} className="mb-2 opacity-20"/>
            <p>問題が登録されていません</p>
            <p className="text-xs mt-1">CSVファイルをアップロードしてください</p>
          </div>
        ) : (
          <div className="divide-y divide-gray-200">
            {quizzes.map((quiz, index) => (
              <div key={quiz.id} className="p-4 bg-white hover:bg-indigo-50/30 transition-colors flex justify-between items-start group">
                <div className="flex gap-3">
                  <span className="text-xs font-bold text-gray-400 mt-1 min-w-[20px]">
                    {String(index + 1).padStart(2, '0')}
                  </span>
                  <div>
                    <p className="text-sm font-bold text-gray-800 mb-1 leading-snug">
                      {quiz.question}
                    </p>
                    <div className="flex flex-wrap gap-2 text-xs">
                      <span className="inline-flex items-center gap-1 text-green-700 bg-green-50 px-2 py-0.5 rounded border border-green-100">
                        <CheckCircle size={10}/> {quiz.correct_answer}
                      </span>
                      {quiz.wrong_answers?.map((ans: string, i: number) => (
                        <span key={i} className="text-gray-500 bg-gray-100 px-2 py-0.5 rounded border border-gray-200">
                          {ans}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
                
                <button 
                  onClick={() => handleDeleteOne(quiz.id)}
                  className="text-gray-300 hover:text-red-500 p-2 rounded-full hover:bg-red-50 transition-colors opacity-0 group-hover:opacity-100 focus:opacity-100"
                  title="削除"
                >
                  <Trash2 size={16}/>
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}