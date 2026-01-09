'use client';

import { useState, useEffect } from 'react';
import { db } from '@/lib/firebase';
import { collection, getDocs, addDoc } from 'firebase/firestore';
import { addPoints } from '@/lib/gamification';
import { 
  CheckCircle, XCircle, ArrowRight, Loader2, 
  RotateCcw, Clock, Layers, AlertTriangle, Trophy 
} from 'lucide-react';

// --- 設定値 ---
const PASS_THRESHOLD = 0.8; // 合格ライン (80%)

// --- ユーティリティ: 配列シャッフル ---
const shuffleArray = (array: any[]) => {
  const newArray = [...array];
  for (let i = newArray.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [newArray[i], newArray[j]] = [newArray[j], newArray[i]];
  }
  return newArray;
};

// --- 型定義 ---
type InternalMode = 'SRS_REVIEW' | 'RANDOM_DRILL';

export default function SafeLearningPage() {
  // ※認証コンテキストから実際のUIDを取得してください
  const user = { uid: 'dummy_user_id' }; 

  // --- State管理 ---
  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState<InternalMode>('SRS_REVIEW');
  
  // セッションデータ
  const [sessionQueue, setSessionQueue] = useState<any[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [currentQuestion, setCurrentQuestion] = useState<any>(null);
  const [shuffledOptions, setShuffledOptions] = useState<string[]>([]);
  
  // 結果管理
  const [sessionResults, setSessionResults] = useState<boolean[]>([]); // 正誤リスト
  const [result, setResult] = useState<'correct' | 'incorrect' | null>(null); // 現在の問題の結果
  
  // 終了画面用
  const [isFinished, setIsFinished] = useState(false);
  const [isPassed, setIsPassed] = useState(false);
  const [earnedPoints, setEarnedPoints] = useState(0);

  // --- 初期化 ---
  useEffect(() => {
    buildSession('SRS_REVIEW');
  }, []);

  // --- セッション構築 (特許回避: 都度生成ロジック) ---
  const buildSession = async (selectedMode: InternalMode) => {
    setLoading(true);
    // 状態リセット
    setIsFinished(false);
    setIsPassed(false);
    setCurrentIndex(0);
    setResult(null);
    setEarnedPoints(0);
    setSessionResults([]);
    setSessionQueue([]);

    try {
      // DBから問題取得 (デモ用: 全件取得してランダムに10件抽出)
      // ※本番ではタグや復習日でフィルタリングする
      const snap = await getDocs(collection(db, 'quizzes'));
      const all = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      
      const pool = shuffleArray(all).slice(0, 10); // 10問に制限

      setSessionQueue(pool);
      if (pool.length > 0) {
        setNextQuestion(pool[0]);
      } else {
        // 問題がない場合
        setIsFinished(true);
      }
    } catch (e) {
      console.error("Session build error:", e);
    } finally {
      setLoading(false);
    }
  };

  // --- 次の問題をセット ---
  const setNextQuestion = (question: any) => {
    if (!question) return;
    setCurrentQuestion(question);
    const opts = [question.correct_answer, ...question.wrong_answers];
    setShuffledOptions(shuffleArray(opts));
  };

  // --- 回答処理 ---
  const handleAnswer = async (ans: string) => {
    if (!currentQuestion) return;

    const isCorrect = ans === currentQuestion.correct_answer;
    setResult(isCorrect ? 'correct' : 'incorrect');

    // 今回の結果を配列に追加保存
    // (setStateは非同期なので、finishSession判定用にはこの変数を直接使うと安全)
    const updatedResults = [...sessionResults, isCorrect];
    setSessionResults(updatedResults);

    // ログ保存 (親子関係を持たないフラットなログ)
    if (user) {
      addDoc(collection(db, `users/${user.uid}/study_logs`), {
        questionId: currentQuestion.id,
        isCorrect,
        mode: mode,
        reviewed_at: new Date().toISOString()
      }).catch(e => console.error(e));
    }
  };

  // --- 「次へ」ボタン処理 ---
  const handleNext = () => {
    const nextIdx = currentIndex + 1;
    
    if (nextIdx < sessionQueue.length) {
      // まだ問題がある場合
      setResult(null);
      setCurrentIndex(nextIdx);
      setNextQuestion(sessionQueue[nextIdx]);
    } else {
      // 全問終了 -> 判定へ
      finishSession();
    }
  };

  // --- 終了判定 & ポイント付与 ---
  const finishSession = async () => {
    // 最新のsessionResultsを使って正答率を計算
    // ※handleAnswerでの更新が反映されていない可能性を考慮し、state依存の場合は注意が必要ですが、
    // ここでは「次へ」ボタンを押す(handleNext)タイミングで呼ぶため、stateは更新済みと仮定します。
    // 安全のため、計算ロジックは sessionResults を使用。
    
    const correctCount = sessionResults.filter(Boolean).length;
    const totalCount = sessionQueue.length;
    // 0除算回避
    const scoreRate = totalCount > 0 ? correctCount / totalCount : 0;
    
    const passed = scoreRate >= PASS_THRESHOLD;
    
    setIsPassed(passed);
    setIsFinished(true);

    // 合格時のみポイント付与
    if (passed && user) {
      try {
        // ★修正ポイント: 型エラー回避のため、明示的に 'HOMEWORK' を渡す
        const res = await addPoints(user.uid, 'HOMEWORK');
        if (res?.success) {
          setEarnedPoints(res.earned ?? 0);
        }
      } catch (e) {
        console.error("Points Error:", e);
      }
    }
  };

  // --- リトライ処理 ---
  const handleRetry = () => {
    // 現在の問題キューを維持したまま、状態だけリセットして再挑戦
    setIsFinished(false);
    setIsPassed(false);
    setCurrentIndex(0);
    setResult(null);
    setEarnedPoints(0);
    setSessionResults([]);
    
    // 選択肢のシャッフルなどは再度行うためにセットし直し
    if (sessionQueue.length > 0) {
      setNextQuestion(sessionQueue[0]);
    }
  };

  // --- ローディング表示 ---
  if (loading) return (
    <div className="h-screen flex items-center justify-center bg-slate-50">
      <Loader2 className="animate-spin text-indigo-600" size={40}/>
    </div>
  );

  // --- 結果画面 (合否分岐) ---
  if (isFinished) {
    const correctCount = sessionResults.filter(Boolean).length;
    const scorePercent = Math.round((correctCount / sessionQueue.length) * 100) || 0;

    return (
      <div className="min-h-screen bg-slate-50 p-6 flex items-center justify-center animate-in fade-in">
        <div className="bg-white p-8 rounded-[32px] shadow-xl text-center max-w-md w-full animate-in zoom-in-95">
          
          {isPassed ? (
            // === 合格画面 ===
            <>
              <Trophy size={64} className="mx-auto text-yellow-400 mb-4 animate-bounce"/>
              <h2 className="text-2xl font-black text-gray-800 mb-2">課題クリア！</h2>
              <p className="text-gray-500 mb-6">合格ライン達成です。お見事！</p>
              
              <div className="bg-indigo-50 p-6 rounded-2xl mb-6">
                <p className="text-sm font-bold text-indigo-400">正答率</p>
                <p className="text-5xl font-black text-indigo-600">{scorePercent}<span className="text-lg">%</span></p>
                {earnedPoints > 0 && (
                  <div className="mt-3 inline-block bg-yellow-100 text-yellow-700 px-4 py-1 rounded-full text-xs font-bold shadow-sm">
                    +{earnedPoints} pt GET
                  </div>
                )}
              </div>

              <button 
                onClick={() => buildSession(mode)} 
                className="w-full bg-indigo-600 text-white py-4 rounded-2xl font-bold hover:bg-indigo-700 transition-all flex items-center justify-center gap-2 shadow-lg shadow-indigo-200"
              >
                <ArrowRight size={20}/> 次の課題へ進む
              </button>
            </>
          ) : (
            // === 不合格画面 ===
            <>
              <AlertTriangle size={64} className="mx-auto text-red-400 mb-4 animate-pulse"/>
              <h2 className="text-2xl font-black text-gray-800 mb-2">クリアならず...</h2>
              <p className="text-gray-500 mb-6">
                合格ラインは <span className="font-bold text-red-500">{PASS_THRESHOLD * 100}%</span> です。<br/>
                もう一度復習して挑戦しよう！
              </p>
              
              <div className="bg-red-50 p-6 rounded-2xl mb-6 border border-red-100">
                <p className="text-sm font-bold text-red-400">今回のスコア</p>
                <p className="text-5xl font-black text-red-500">{scorePercent}<span className="text-lg">%</span></p>
                <p className="text-xs text-red-400 mt-2 font-bold">
                  あと {Math.ceil(sessionQueue.length * PASS_THRESHOLD) - correctCount} 問正解で合格
                </p>
              </div>

              <div className="space-y-3">
                <button 
                  onClick={handleRetry} 
                  className="w-full bg-red-500 text-white py-3.5 rounded-2xl font-bold hover:bg-red-600 shadow-lg shadow-red-200 flex items-center justify-center gap-2 transition-transform active:scale-95"
                >
                  <RotateCcw size={18}/> リトライする
                </button>
                <button 
                  onClick={() => buildSession(mode)} 
                  className="w-full bg-white text-gray-400 py-3 rounded-2xl font-bold hover:bg-gray-50 hover:text-gray-600 text-sm transition-colors"
                >
                  諦めて別の問題にする
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    );
  }

  // --- 学習画面 (メイン) ---
  return (
    <div className="min-h-screen bg-slate-50 p-4 md:p-6 flex flex-col items-center font-sans">
      <div className="w-full max-w-2xl">
        
        {/* モード切替タブ */}
        <div className="flex bg-gray-200 p-1.5 rounded-2xl mb-6">
          <button 
            onClick={() => { setMode('SRS_REVIEW'); buildSession('SRS_REVIEW'); }}
            className={`flex-1 py-2.5 rounded-xl text-sm font-black flex items-center justify-center gap-2 transition-all ${mode === 'SRS_REVIEW' ? 'bg-white shadow-sm text-indigo-600 scale-105' : 'text-gray-500 hover:text-gray-600'}`}
          >
            <Clock size={18} /> 復習 (SRS)
          </button>
          <button 
            onClick={() => { setMode('RANDOM_DRILL'); buildSession('RANDOM_DRILL'); }}
            className={`flex-1 py-2.5 rounded-xl text-sm font-black flex items-center justify-center gap-2 transition-all ${mode === 'RANDOM_DRILL' ? 'bg-white shadow-sm text-orange-600 scale-105' : 'text-gray-500 hover:text-gray-600'}`}
          >
            <Layers size={18} /> ドリル
          </button>
        </div>

        {/* 進捗バー */}
        <div className="flex justify-between items-center mb-4 px-2">
          <span className="text-xs font-bold text-gray-400 tracking-wider">SESSION PROGRESS</span>
          <span className="text-xs font-black text-indigo-600 bg-indigo-50 px-3 py-1 rounded-full border border-indigo-100">
            {currentIndex + 1} / {sessionQueue.length}
          </span>
        </div>

        {/* 問題カード */}
        <div className="bg-white rounded-[32px] shadow-xl shadow-slate-200 p-6 md:p-8 mb-6 relative overflow-hidden border border-white">
          <h2 className="text-lg md:text-xl font-bold text-gray-800 mb-6 leading-relaxed">
            {currentQuestion?.question}
          </h2>

          <div className="space-y-3">
            {shuffledOptions.map((opt, i) => {
              // ボタンのスタイル判定
              let btnStyle = "w-full p-4 rounded-xl text-left border-2 font-bold transition-all duration-200 ";
              if (result) {
                if (opt === currentQuestion.correct_answer) btnStyle += "bg-green-100 border-green-500 text-green-700";
                else if (opt === result) btnStyle += "bg-red-50 border-red-200 text-red-400";
                else btnStyle += "opacity-40 border-gray-100";
              } else {
                btnStyle += "bg-white border-gray-100 hover:border-indigo-300 hover:bg-indigo-50 text-gray-600 active:scale-[0.98]";
              }

              return (
                <button 
                  key={i} 
                  onClick={() => !result && handleAnswer(opt)} 
                  disabled={!!result} 
                  className={btnStyle}
                >
                  <span className="mr-3 text-gray-400 font-normal">{String.fromCharCode(65+i)}.</span>
                  {opt}
                </button>
              );
            })}
          </div>
        </div>

        {/* 結果フィードバック & 次へボタン */}
        {result && (
          <div className="animate-in slide-in-from-bottom-2 pb-10">
            <div className={`p-4 rounded-2xl mb-4 flex items-center gap-3 border ${result === 'correct' ? 'bg-green-50 border-green-200 text-green-800' : 'bg-red-50 border-red-200 text-red-800'}`}>
              {result === 'correct' ? <CheckCircle size={24}/> : <XCircle size={24}/>}
              <div>
                <span className="font-bold block text-lg">{result === 'correct' ? '正解！' : '不正解...'}</span>
              </div>
            </div>
            
            <button 
              onClick={handleNext} 
              className="group w-full bg-gray-900 text-white py-4 rounded-2xl font-bold text-lg hover:bg-black shadow-lg flex items-center justify-center gap-2 transition-all active:scale-95"
            >
              {currentIndex + 1 === sessionQueue.length ? '結果を見る' : '次へ進む'} 
              <ArrowRight size={20} className="group-hover:translate-x-1 transition-transform"/>
            </button>
          </div>
        )}

      </div>
    </div>
  );
}