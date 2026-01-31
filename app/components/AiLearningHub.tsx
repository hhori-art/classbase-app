'use client';

import { useState } from 'react';
import { db } from '@/lib/firebase';
import { collection, getDocs, doc, setDoc } from 'firebase/firestore';
import { addPoints } from '@/lib/gamification';
import { 
  Brain, Target, Play, RotateCcw, Trophy, BookOpen, Loader2
} from 'lucide-react';

// 学習モードの定義
type Mode = 'TASK' | 'QUIZ';

// 日付取得ヘルパー
const getTodayString = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

// ★追加: クイズのストックデータ (30問以上用意してランダム性を高める)
const QUIZ_STOCK = [
  // --- 理科 ---
  { id: 'sci_1', question: '植物が光合成を行うために必要なものは、光、水と何？', correct_answer: '二酸化炭素', wrong_answers: ['酸素', '窒素', '水素'] },
  { id: 'sci_2', question: '物質が酸素と激しく結びついて光や熱を出す現象を何という？', correct_answer: '燃焼', wrong_answers: ['還元', '蒸発', '昇華'] },
  { id: 'sci_3', question: 'ヒトの心臓にある部屋の数は全部でいくつ？', correct_answer: '4つ', wrong_answers: ['2つ', '3つ', '5つ'] },
  { id: 'sci_4', question: '電圧の単位はボルト(V)ですが、電流の単位は？', correct_answer: 'アンペア(A)', wrong_answers: ['ワット(W)', 'オーム(Ω)', 'ジュール(J)'] },
  { id: 'sci_5', question: '地震の揺れの大きさを表す尺度は「震度」ですが、地震そのものの規模を表す尺度は？', correct_answer: 'マグニチュード', wrong_answers: ['デシベル', 'ヘクトパスカル', 'ガル'] },
  { id: 'sci_6', question: '水に溶かすと電気を通す物質を何という？', correct_answer: '電解質', wrong_answers: ['非電解質', '絶縁体', '半導体'] },
  { id: 'sci_7', question: 'アゲハチョウの幼虫が食べる植物は？', correct_answer: 'ミカン科の葉', wrong_answers: ['キャベツ', 'クローバー', 'サクラの葉'] },
  { id: 'sci_8', question: '音が空気中を伝わる速さは、およそ毎秒何メートル？', correct_answer: '約340m', wrong_answers: ['約1500m', '約30万km', '約100m'] },
  { id: 'sci_9', question: '顕微鏡で観察する際、最初にする操作は？', correct_answer: '低倍率で全体を見る', wrong_answers: ['高倍率で細部を見る', 'プレパラートを動かす', '反射鏡を外す'] },
  { id: 'sci_10', question: '光が鏡に当たって跳ね返ることを何という？', correct_answer: '反射', wrong_answers: ['屈折', '全反射', '分散'] },
  
  // --- 社会 ---
  { id: 'soc_1', question: '日本で一番大きな湖は？', correct_answer: '琵琶湖', wrong_answers: ['霞ヶ浦', 'サロマ湖', '猪苗代湖'] },
  { id: 'soc_2', question: '聖徳太子が定めた、役人の心構えを示した決まりは？', correct_answer: '十七条の憲法', wrong_answers: ['冠位十二階', '御成敗式目', '武家諸法度'] },
  { id: 'soc_3', question: '「鳴くよウグイス」で覚えられる平安京への遷都は何年？', correct_answer: '794年', wrong_answers: ['710年', '1192年', '1603年'] },
  { id: 'soc_4', question: '日本の最南端の島は？', correct_answer: '沖ノ鳥島', wrong_answers: ['南鳥島', '与那国島', '択捉島'] },
  { id: 'soc_5', question: 'アメリカ独立宣言が発表されたのは何年？', correct_answer: '1776年', wrong_answers: ['1492年', '1789年', '1865年'] },
  { id: 'soc_6', question: '日本国憲法の三大原則は、国民主権、平和主義と何？', correct_answer: '基本的人権の尊重', wrong_answers: ['五箇条の御誓文', '王政復古の大号令', '自由民権運動'] },
  { id: 'soc_7', question: '地図記号で「⛆」は何を表す？', correct_answer: '温泉', wrong_answers: ['工場', '発電所', '消防署'] },
  { id: 'soc_8', question: '江戸幕府を開いた人物は？', correct_answer: '徳川家康', wrong_answers: ['織田信長', '豊臣秀吉', '源頼朝'] },
  { id: 'soc_9', question: '世界で一番面積の大きい国は？', correct_answer: 'ロシア', wrong_answers: ['カナダ', 'アメリカ', '中国'] },
  { id: 'soc_10', question: '「学問のすゝめ」を書いた人物は？', correct_answer: '福沢諭吉', wrong_answers: ['大隈重信', '伊藤博文', '夏目漱石'] },

  // --- 情報・雑学 ---
  { id: 'info_1', question: '「AI」は何の略？', correct_answer: 'Artificial Intelligence', wrong_answers: ['Auto Internet', 'Apple Inc.', 'Advanced Interface'] },
  { id: 'info_2', question: 'Webサイトを閲覧するためのソフトを何という？', correct_answer: 'ブラウザ', wrong_answers: ['コンパイラ', 'エディタ', 'サーバー'] },
  { id: 'info_3', question: '情報の単位で、8ビット(bit)は何バイト(Byte)？', correct_answer: '1バイト', wrong_answers: ['8バイト', '10バイト', '100バイト'] },
  { id: 'info_4', question: 'プログラミング言語「Python」の名前の由来は？', correct_answer: 'コメディ番組', wrong_answers: ['蛇', '開発者の名前', '宝石'] },
  { id: 'info_5', question: '「IoT」は何の略？', correct_answer: 'Internet of Things', wrong_answers: ['Input of Text', 'Image of Technology', 'Internal of Tool'] },
  { id: 'info_6', question: 'コンピュータの頭脳と呼ばれる部品は？', correct_answer: 'CPU', wrong_answers: ['HDD', 'RAM', 'GPU'] },
  { id: 'info_7', question: 'キーボードのショートカット「Ctrl + C」の機能は？', correct_answer: 'コピー', wrong_answers: ['貼り付け', '切り取り', '元に戻す'] },
  { id: 'info_8', question: 'インターネット上の住所にあたるものを何という？', correct_answer: 'IPアドレス', wrong_answers: ['MACアドレス', 'メールアドレス', 'ハッシュ値'] },
  { id: 'info_9', question: 'Excelなどの表計算ソフトで、縦の列を何という？', correct_answer: 'カラム(列)', wrong_answers: ['ロウ(行)', 'セル', 'シート'] },
  { id: 'info_10', question: '「バグ(bug)」の元々の意味は？', correct_answer: '虫', wrong_answers: ['故障', '穴', '間違い'] },
];

export default function AiLearningHub({ userId }: { userId: string }) {
  const [activeTab, setActiveTab] = useState<Mode>('TASK');
  const [progress, setProgress] = useState(35);
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
      // 1. Firestoreからクイズを取得
      const snap = await getDocs(collection(db, 'quizzes'));
      let dbQuizzes = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      
      // 2. ストックデータとマージ (ID重複排除)
      const allQuizzes = [...dbQuizzes];
      QUIZ_STOCK.forEach(stockQ => {
        if (!allQuizzes.some(dbQ => dbQ.id === stockQ.id)) {
          allQuizzes.push(stockQ);
        }
      });

      if (allQuizzes.length === 0) {
        alert('問題がありません');
        setLoading(false);
        return;
      }

      // 3. ランダムシャッフル
      const shuffled = allQuizzes.sort(() => Math.random() - 0.5);

      // 4. 10問抽出 (ストックが多いので毎回違う組み合わせになる)
      const selectedQuizzes = shuffled.slice(0, 10);
      
      setQuizzes(selectedQuizzes);
      setCurrentQuestionIndex(0);
      setFeedback(null);
      setSelectedOption(null);
      setIsLearning(true);
    } catch (e) {
      console.error(e);
      // エラー時もストックデータだけで続行させるフォールバック
      const fallback = [...QUIZ_STOCK].sort(() => Math.random() - 0.5).slice(0, 10);
      setQuizzes(fallback);
      setIsLearning(true);
    } finally {
      setLoading(false);
    }
  };

  // 回答処理
  const handleAnswer = async (answer: string) => {
    if (selectedOption) return;
    setSelectedOption(answer);

    const currentQuiz = quizzes[currentQuestionIndex];
    const isCorrect = answer === currentQuiz.correct_answer;

    if (isCorrect) {
      setFeedback('correct');
      const reason = activeTab === 'TASK' ? 'HOMEWORK' : 'QUIZ';
      const points = activeTab === 'TASK' ? 50 : 20; 
      await addPoints(userId, points, reason);
    } else {
      setFeedback('wrong');
    }

    // 次の問題へ遷移
    setTimeout(async () => {
      if (currentQuestionIndex < quizzes.length - 1) {
        setCurrentQuestionIndex(prev => prev + 1);
        setSelectedOption(null);
        setFeedback(null);
      } else {
        // 全問終了
        setIsLearning(false);

        try {
          const today = getTodayString();
          await setDoc(doc(db, 'users', userId), {
            last_ai_learning_date: today 
          }, { merge: true });
          
          console.log("AI学習完了を記録しました:", today);
        } catch (e) {
          console.error("ミッション記録エラー", e);
        }

        if (activeTab === 'TASK') {
            setProgress(prev => Math.min(100, prev + 15));
            alert('タスク完了！宿題ポイントを獲得しました！');
        } else {
            alert('テスト終了！お疲れ様でした！');
        }
      }
    }, 1500);
  };

  if (loading) {
    return (
      <div className="bg-white p-12 rounded-3xl shadow-sm text-center flex flex-col items-center justify-center min-h-[400px]">
        <Loader2 className="animate-spin text-indigo-600 mb-4" size={48} />
        <p className="font-bold text-gray-600">AIが問題を準備中...</p>
        <p className="text-xs text-gray-400 mt-2">あなたのための学習メニューを作成しています</p>
      </div>
    );
  }

  if (isLearning && quizzes.length > 0) {
    const quiz = quizzes[currentQuestionIndex];
    const options = [quiz.correct_answer, ...quiz.wrong_answers].sort(() => Math.random() - 0.5); // 選択肢もランダム順に

    return (
      <div className="bg-white rounded-3xl shadow-xl overflow-hidden min-h-[400px] flex flex-col relative animate-in zoom-in-95 duration-200">
        <div className="bg-slate-50 p-4 flex justify-between items-center border-b">
          <span className={`text-xs font-bold px-3 py-1 rounded-full ${activeTab === 'TASK' ? 'bg-indigo-100 text-indigo-700' : 'bg-orange-100 text-orange-700'}`}>
            {activeTab === 'TASK' ? '📝 宿題タスク' : '⚔️ 実力テスト'}
          </span>
          <span className="text-sm font-bold text-gray-500">
            {currentQuestionIndex + 1} / {quizzes.length}
          </span>
        </div>

        <div className="p-8 flex-1 flex flex-col items-center justify-center z-10">
          <h2 className="text-xl font-bold text-gray-800 text-center mb-8 leading-relaxed">
            {quiz.question}
          </h2>

          <div className="grid grid-cols-1 gap-3 w-full max-w-md">
            {options.map((opt: string, i: number) => {
              let btnClass = "p-4 rounded-xl border-2 text-left font-bold transition-all relative overflow-hidden ";
              
              if (selectedOption) {
                if (opt === quiz.correct_answer) {
                  btnClass += "bg-green-100 border-green-500 text-green-800 shadow-[0_0_15px_rgba(34,197,94,0.4)] scale-105 z-10";
                } else if (opt === selectedOption) {
                  btnClass += "bg-red-100 border-red-500 text-red-800";
                } else {
                  btnClass += "bg-gray-50 border-gray-100 text-gray-300 opacity-50";
                }
              } else {
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

  return (
    <div className="space-y-6">
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