'use client';

import { useState, useEffect } from 'react';
import { db } from '@/lib/firebase';
import { collection, getDocs } from 'firebase/firestore';
import { addPoints } from '@/lib/gamification';
import { 
  Brain, Target, Play, RotateCcw, Trophy, BookOpen, Loader2
} from 'lucide-react';

// 学習モードの定義
type Mode = 'TASK' | 'QUIZ';

export default function AiLearningHub({ userId }: { userId: string }) {
  const [activeTab, setActiveTab] = useState<Mode>('TASK');
  const [progress, setProgress] = useState(35); // タスク進捗率（デモ用初期値）
  const [quizzes, setQuizzes] = useState<any[]>([]);
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
  const [isLearning, setIsLearning] = useState(false);
  const [selectedOption, setSelectedOption] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<'correct' | 'wrong' | null>(null);
  const [loading, setLoading] = useState(false);

  // 学習開始処理
  const startLearning = async (mode: Mode) => {
    setLoading(true);
    setActiveTab(mode);
    
    try {
      const snap = await getDocs(collection(db, 'quizzes'));
      let data = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      
      if (data.length === 0) {
        alert('問題がまだ登録されていません');
        setLoading(false);
        return;
      }

      // ランダムシャッフル
      data = data.sort(() => Math.random() - 0.5);

      // モードによる出題数の違い
      if (mode === 'QUIZ') {
        data = data.slice(0, 10); // テストは10問限定
      }
      
      setQuizzes(data);
      setCurrentQuestionIndex(0);
      setFeedback(null);
      setSelectedOption(null);
      setIsLearning(true);
    } catch (e) {
      console.error(e);
      alert('読み込みエラーが発生しました');
    } finally {
      setLoading(false);
    }
  };

  // 回答処理
  const handleAnswer = async (answer: string) => {
    if (selectedOption) return; // 連打防止
    setSelectedOption(answer);

    const currentQuiz = quizzes[currentQuestionIndex];
    const isCorrect = answer === currentQuiz.correct_answer;

    if (isCorrect) {
      setFeedback('correct');
      // ポイント加算（モードによって種類を変える）
      const pointType = activeTab === 'TASK' ? 'HOMEWORK' : 'QUIZ';
      await addPoints(userId, pointType);
    } else {
      setFeedback('wrong');
    }

    // 次の問題へ遷移
    setTimeout(() => {
      if (currentQuestionIndex < quizzes.length - 1) {
        setCurrentQuestionIndex(prev => prev + 1);
        setSelectedOption(null);
        setFeedback(null);
      } else {
        // 全問終了
        setIsLearning(false);
        if (activeTab === 'TASK') {
            setProgress(prev => Math.min(100, prev + 15)); // 進捗を進める演出
            alert('タスク完了！宿題ポイントを獲得しました！');
        } else {
            alert('テスト終了！お疲れ様でした！');
        }
      }
    }, 1500);
  };

  // ■ 読み込み中画面
  if (loading) {
    return (
      <div className="bg-white p-12 rounded-3xl shadow-sm text-center flex flex-col items-center justify-center min-h-[400px]">
        <Loader2 className="animate-spin text-indigo-600 mb-4" size={48} />
        <p className="font-bold text-gray-600">AIが問題を準備中...</p>
      </div>
    );
  }

  // ■ 学習実行画面（クイズ中）
  if (isLearning && quizzes.length > 0) {
    const quiz = quizzes[currentQuestionIndex];
    // 選択肢生成（正解 + 誤答 を混ぜる）
    const options = [quiz.correct_answer, ...quiz.wrong_answers].sort();

    return (
      <div className="bg-white rounded-3xl shadow-xl overflow-hidden min-h-[400px] flex flex-col relative animate-in zoom-in-95 duration-200">
        {/* ヘッダー */}
        <div className="bg-slate-50 p-4 flex justify-between items-center border-b">
          <span className={`text-xs font-bold px-3 py-1 rounded-full ${activeTab === 'TASK' ? 'bg-indigo-100 text-indigo-700' : 'bg-orange-100 text-orange-700'}`}>
            {activeTab === 'TASK' ? '📝 宿題タスク' : '⚔️ 実力テスト'}
          </span>
          <span className="text-sm font-bold text-gray-500">
            {currentQuestionIndex + 1} / {quizzes.length}
          </span>
        </div>

        {/* 問題エリア */}
        <div className="p-8 flex-1 flex flex-col items-center justify-center z-10">
          <h2 className="text-xl font-bold text-gray-800 text-center mb-8 leading-relaxed">
            {quiz.question}
          </h2>

          <div className="grid grid-cols-1 gap-3 w-full max-w-md">
            {options.map((opt: string, i: number) => {
              // ボタンのスタイル判定
              let btnClass = "p-4 rounded-xl border-2 text-left font-bold transition-all relative overflow-hidden ";
              
              if (selectedOption) {
                if (opt === quiz.correct_answer) {
                  // 正解の選択肢（自分が選んでなくても光らせる）
                  btnClass += "bg-green-100 border-green-500 text-green-800 shadow-[0_0_15px_rgba(34,197,94,0.4)] scale-105 z-10";
                } else if (opt === selectedOption) {
                  // 間違って選んだ選択肢
                  btnClass += "bg-red-100 border-red-500 text-red-800";
                } else {
                  // 選ばなかった不正解
                  btnClass += "bg-gray-50 border-gray-100 text-gray-300 opacity-50";
                }
              } else {
                // 未回答時
                btnClass += "bg-white border-gray-100 hover:border-indigo-300 hover:bg-indigo-50 text-gray-600 hover:shadow-md active:scale-95";
              }

              return (
                <button
                  key={i}
                  onClick={() => handleAnswer(opt)}
                  disabled={!!selectedOption}
                  className={btnClass}
                >
                  {opt}
                </button>
              );
            })}
          </div>
        </div>

        {/* フィードバック演出 */}
        {feedback && (
            <div className={`absolute inset-x-0 bottom-0 p-6 text-center font-black text-white text-xl animate-in slide-in-from-bottom duration-300 z-20 ${feedback === 'correct' ? 'bg-green-500' : 'bg-red-500'}`}>
              {feedback === 'correct' ? 'Excellent!! 🎉' : 'Don\'t mind... 💪'}
            </div>
        )}
        
        {!feedback && (
          <button onClick={() => setIsLearning(false)} className="w-full py-4 text-gray-400 text-xs text-center hover:text-gray-600 border-t mt-auto">
            学習を中断する
          </button>
        )}
      </div>
    );
  }

  // ■ ダッシュボード画面（トップ）
  return (
    <div className="space-y-6">
      
      {/* タブ切り替え */}
      <div className="flex bg-gray-200 p-1 rounded-2xl">
        <button 
          onClick={() => setActiveTab('TASK')}
          className={`flex-1 py-3 rounded-xl text-sm font-bold flex items-center justify-center gap-2 transition-all ${activeTab === 'TASK' ? 'bg-white shadow-sm text-indigo-600' : 'text-gray-500 hover:text-gray-700'}`}
        >
          <BookOpen size={18} />
          宿題タスク
        </button>
        <button 
          onClick={() => setActiveTab('QUIZ')}
          className={`flex-1 py-3 rounded-xl text-sm font-bold flex items-center justify-center gap-2 transition-all ${activeTab === 'QUIZ' ? 'bg-white shadow-sm text-orange-600' : 'text-gray-500 hover:text-gray-700'}`}
        >
          <Target size={18} />
          実力テスト
        </button>
      </div>

      {activeTab === 'TASK' ? (
        /* === 宿題タスクモード === */
        <div className="bg-white p-6 rounded-3xl shadow-sm border border-indigo-50 animate-in fade-in">
          <div className="flex justify-between items-end mb-4">
            <div>
              <h3 className="text-lg font-extrabold text-gray-800">今週の学習タスク</h3>
              <p className="text-xs text-gray-400 mt-1">期限: 次回の授業まで</p>
            </div>
            <div className="text-right">
              <span className="text-3xl font-black text-indigo-600">{progress}%</span>
              <span className="text-xs font-bold text-gray-400 block">完了</span>
            </div>
          </div>

          <div className="h-4 bg-gray-100 rounded-full overflow-hidden mb-6">
            <div 
              className="h-full bg-gradient-to-r from-indigo-500 to-blue-500 transition-all duration-1000 ease-out"
              style={{ width: `${progress}%` }}
            />
          </div>

          <div className="bg-indigo-50 rounded-xl p-4 mb-6 flex items-center gap-4">
            <div className="bg-white p-3 rounded-full text-indigo-500 shadow-sm">
              <Brain size={24} />
            </div>
            <div>
              <p className="font-bold text-indigo-900">AIからの提案</p>
              <p className="text-xs text-indigo-700 mt-1">
                前回間違えた問題を中心に<br/>復習メニューを作成しました。
              </p>
            </div>
          </div>

          <button 
            onClick={() => startLearning('TASK')}
            className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-4 rounded-xl shadow-lg shadow-indigo-200 active:scale-95 transition-all flex items-center justify-center gap-2"
          >
            <Play fill="currentColor" />
            学習をスタート
          </button>
        </div>
      ) : (
        /* === 実力テストモード === */
        <div className="bg-white p-6 rounded-3xl shadow-sm border border-orange-50 animate-in fade-in">
          <div className="text-center mb-6">
            <div className="inline-block p-4 bg-orange-100 rounded-full text-orange-600 mb-3">
              <Trophy size={32} />
            </div>
            <h3 className="text-lg font-extrabold text-gray-800">実力確認テスト</h3>
            <p className="text-xs text-gray-400 mt-2">
              ランダムに10問出題されます。<br/>現在のランクポイントに反映されます。
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3 mb-6">
            <div className="bg-gray-50 p-3 rounded-xl text-center border border-gray-100">
              <p className="text-xs text-gray-400">最高スコア</p>
              <p className="font-black text-xl text-gray-700">95点</p>
            </div>
            <div className="bg-gray-50 p-3 rounded-xl text-center border border-gray-100">
              <p className="text-xs text-gray-400">実施回数</p>
              <p className="font-black text-xl text-gray-700">12回</p>
            </div>
          </div>

          <button 
            onClick={() => startLearning('QUIZ')}
            className="w-full bg-gradient-to-r from-orange-500 to-red-500 hover:from-orange-600 hover:to-red-600 text-white font-bold py-4 rounded-xl shadow-lg shadow-orange-200 active:scale-95 transition-all flex items-center justify-center gap-2"
          >
            <RotateCcw />
            テストに挑戦
          </button>
        </div>
      )}
    </div>
  );
}