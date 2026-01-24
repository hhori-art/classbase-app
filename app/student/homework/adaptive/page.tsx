'use client';

import { useState, useEffect } from 'react';
import { db } from '@/lib/firebase';
import { doc, updateDoc, increment, collection, addDoc, serverTimestamp, query, where, getDocs, orderBy } from 'firebase/firestore';
import { useAuth } from '@/app/context/AuthContext';
import { 
  CheckCircle, XCircle, ArrowRight, ArrowLeft, Loader2, 
  RotateCcw, AlertTriangle, Trophy, Star, Brain, Play, FlaskConical, Globe, Calculator,
  BookOpen, List, History
} from 'lucide-react';
import Link from 'next/link';

// --- 設定値 ---
const PASS_THRESHOLD = 0.8; 
const POINTS_PER_CLEAR = 10; // ★変更: 10コインに設定

// --- ユーティリティ ---
const shuffleArray = (array: any[]) => {
  const newArray = [...array];
  for (let i = newArray.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [newArray[i], newArray[j]] = [newArray[j], newArray[i]];
  }
  return newArray;
};

interface Question {
  id: string;
  question: string;
  correct_answer: string;
  wrong_answers: string[];
  explanation?: string;
}

const SUBJECTS = {
  science: { label: '理科', icon: <FlaskConical size={18}/>, items: ['物理', '化学', '生物', '地学'], color: 'bg-purple-100 text-purple-700 hover:bg-purple-200' },
  society: { label: '社会', icon: <Globe size={18}/>, items: ['地理', '歴史', '公民'], color: 'bg-orange-100 text-orange-700 hover:bg-orange-200' },
  basics:  { label: '主要', icon: <Calculator size={18}/>, items: ['英語', '数学'], color: 'bg-blue-100 text-blue-700 hover:bg-blue-200' }
};

export default function AdaptiveLearningPage() {
  const { user } = useAuth();

  // --- State ---
  const [loading, setLoading] = useState(false);
  const [mode, setMode] = useState<'SELECT' | 'UNIT_SELECT' | 'PLAY' | 'RESULT'>('SELECT');
  
  // 選択データ
  const [selectedGrade, setSelectedGrade] = useState('');
  const [selectedSubject, setSelectedSubject] = useState('');
  const [availableUnits, setAvailableUnits] = useState<any[]>([]);
  const [selectedUnit, setSelectedUnit] = useState<any>(null); // {id, unit_name, content}
  
  // プレイ中データ
  const [sessionQueue, setSessionQueue] = useState<Question[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [currentQuestion, setCurrentQuestion] = useState<Question | null>(null);
  const [shuffledOptions, setShuffledOptions] = useState<string[]>([]);
  const [sessionResults, setSessionResults] = useState<boolean[]>([]);
  const [result, setResult] = useState<'correct' | 'incorrect' | null>(null);
  
  // 結果
  const [isPassed, setIsPassed] = useState(false);
  const [earnedPoints, setEarnedPoints] = useState(0);

  // --- 単元一覧の取得 ---
  const fetchUnits = async () => {
    setLoading(true);
    try {
      const q = query(
        collection(db, 'learning_units'),
        where('grade', '==', selectedGrade),
        where('subject', '==', selectedSubject),
        orderBy('created_at', 'desc')
      );
      const snap = await getDocs(q);
      const units = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      setAvailableUnits(units);
      setMode('UNIT_SELECT');
    } catch (e) {
      console.error(e);
      // インデックスエラー回避: orderByを外して再試行
      try {
        const q2 = query(collection(db, 'learning_units'), where('grade', '==', selectedGrade), where('subject', '==', selectedSubject));
        const snap2 = await getDocs(q2);
        setAvailableUnits(snap2.docs.map(d => ({ id: d.id, ...d.data() })));
        setMode('UNIT_SELECT');
      } catch(e2) {
        alert('単元の取得に失敗しました');
      }
    } finally {
      setLoading(false);
    }
  };

  // --- クエスト開始 ---
  const startQuest = async (unit: any) => {
    setSelectedUnit(unit);
    setLoading(true);
    
    try {
      // APIに単元の内容(content)を送って問題を生成してもらう
      const res = await fetch('/api/homework/adaptive', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          grade: selectedGrade, 
          subject: selectedSubject,
          unitName: unit.unit_name,
          unitContent: unit.content // ここが重要
        }),
      });

      if (!res.ok) throw new Error('API Error');
      const data = await res.json();

      if (!data.questions || data.questions.length === 0) {
        throw new Error('問題が生成されませんでした');
      }

      setSessionQueue(shuffleArray(data.questions));
      setCurrentIndex(0);
      setSessionResults([]);
      setResult(null);
      setNextQuestion(data.questions[0]);
      setMode('PLAY');

    } catch (e) {
      console.error(e);
      alert('問題の生成に失敗しました');
    } finally {
      setLoading(false);
    }
  };

  const setNextQuestion = (question: Question) => {
    if (!question) return;
    setCurrentQuestion(question);
    const opts = [question.correct_answer, ...question.wrong_answers];
    setShuffledOptions(shuffleArray(opts));
  };

  const handleAnswer = (ans: string) => {
    if (!currentQuestion) return;
    const isCorrect = ans === currentQuestion.correct_answer;
    setResult(isCorrect ? 'correct' : 'incorrect');
    setSessionResults([...sessionResults, isCorrect]);
  };

  const handleNext = () => {
    const nextIdx = currentIndex + 1;
    if (nextIdx < sessionQueue.length) {
      setResult(null);
      setCurrentIndex(nextIdx);
      setNextQuestion(sessionQueue[nextIdx]);
    } else {
      finishSession();
    }
  };

  const finishSession = async () => {
    const correctCount = sessionResults.filter(Boolean).length;
    const scoreRate = sessionQueue.length > 0 ? correctCount / sessionQueue.length : 0;
    const passed = scoreRate >= PASS_THRESHOLD;
    
    setIsPassed(passed);
    setMode('RESULT');

    if (user) {
      try {
        // 1. 結果履歴を保存
        await addDoc(collection(db, 'quest_results'), {
          student_id: user.uid,
          grade: selectedGrade,
          subject: selectedSubject,
          unit_name: selectedUnit?.unit_name || '不明な単元',
          score: Math.round(scoreRate * 100),
          is_passed: passed,
          created_at: serverTimestamp()
        });

        // 2. 合格ならポイント付与
        if (passed) {
          const userRef = doc(db, 'users', user.uid);
          await updateDoc(userRef, {
            points: increment(POINTS_PER_CLEAR),
            total_coins: increment(POINTS_PER_CLEAR),
            quest_clear_count: increment(1)
          });
          setEarnedPoints(POINTS_PER_CLEAR);
        }
      } catch (e) {
        console.error("Save Error:", e);
      }
    }
  };

  if (loading) return (
    <div className="h-screen flex items-center justify-center bg-indigo-50">
      <div className="text-center">
        <Loader2 className="animate-spin text-indigo-600 mx-auto mb-4" size={48}/>
        <p className="text-indigo-600 font-bold animate-pulse">
          {mode === 'UNIT_SELECT' ? '単元を読み込み中...' : 'AIが問題を生成中...'}
        </p>
      </div>
    </div>
  );

  // === 1. 学年・科目選択 ===
  if (mode === 'SELECT') {
    return (
      <div className="min-h-screen bg-[#F0F4F8] p-4 sm:p-6 flex flex-col items-center justify-center font-sans">
        <div className="max-w-xl w-full">
          
          <div className="flex justify-end mb-4">
            <Link href="/student/history" className="bg-white px-4 py-2 rounded-full shadow-sm text-sm font-bold text-gray-500 hover:text-indigo-600 flex items-center gap-2">
              <History size={16}/> 履歴を見る
            </Link>
          </div>

          <div className="text-center mb-8">
            <div className="inline-block bg-white p-4 rounded-full shadow-lg mb-4">
              <Brain size={40} className="text-indigo-500" />
            </div>
            <h1 className="text-2xl font-black text-gray-800 mb-2">AI学習クエスト</h1>
            <p className="text-gray-500 text-sm font-bold">好きな分野を選んで挑戦しよう！</p>
          </div>

          <div className="bg-white p-6 rounded-[32px] shadow-xl shadow-indigo-100 border-2 border-white space-y-8">
            <div>
              <label className="block text-xs font-black text-gray-400 mb-3 ml-1">学年</label>
              <div className="grid grid-cols-3 gap-3">
                {['中1', '中2', '中3'].map(g => (
                  <button key={g} onClick={() => setSelectedGrade(g)} className={`py-3 rounded-xl font-bold transition-all text-sm ${selectedGrade === g ? 'bg-indigo-600 text-white shadow-md' : 'bg-gray-100 text-gray-500'}`}>{g}</button>
                ))}
              </div>
            </div>

            <div>
              <label className="block text-xs font-black text-gray-400 mb-3 ml-1">科目・分野</label>
              <div className="space-y-4">
                <div>
                  <div className="flex items-center gap-2 text-xs font-bold text-purple-500 mb-2"><FlaskConical size={14}/> 理科</div>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    {SUBJECTS.science.items.map(s => (
                      <button key={s} onClick={() => setSelectedSubject(s)} className={`py-2.5 rounded-lg text-sm font-bold transition-all ${selectedSubject === s ? 'bg-purple-500 text-white' : SUBJECTS.science.color}`}>{s}</button>
                    ))}
                  </div>
                </div>
                <div>
                  <div className="flex items-center gap-2 text-xs font-bold text-orange-500 mb-2"><Globe size={14}/> 社会</div>
                  <div className="grid grid-cols-3 gap-2">
                    {SUBJECTS.society.items.map(s => (
                      <button key={s} onClick={() => setSelectedSubject(s)} className={`py-2.5 rounded-lg text-sm font-bold transition-all ${selectedSubject === s ? 'bg-orange-500 text-white' : SUBJECTS.society.color}`}>{s}</button>
                    ))}
                  </div>
                </div>
                <div>
                  <div className="flex items-center gap-2 text-xs font-bold text-blue-500 mb-2"><Calculator size={14}/> 主要</div>
                  <div className="grid grid-cols-2 gap-2">
                    {SUBJECTS.basics.items.map(s => (
                      <button key={s} onClick={() => setSelectedSubject(s)} className={`py-2.5 rounded-lg text-sm font-bold transition-all ${selectedSubject === s ? 'bg-blue-500 text-white' : SUBJECTS.basics.color}`}>{s}</button>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            <button
              onClick={fetchUnits}
              disabled={!selectedGrade || !selectedSubject}
              className="w-full bg-gradient-to-r from-indigo-600 to-purple-600 text-white py-4 rounded-2xl font-black text-lg shadow-xl shadow-indigo-200 hover:shadow-indigo-300 hover:-translate-y-1 transition-all disabled:opacity-50 disabled:transform-none flex items-center justify-center gap-2 mt-4"
            >
              <List size={24} /> 単元を選ぶ
            </button>
          </div>
          
          <div className="text-center mt-8">
            <Link href="/student" className="text-gray-400 font-bold text-sm hover:text-gray-600">ホームに戻る</Link>
          </div>
        </div>
      </div>
    );
  }

  // === 1.5 単元選択画面 ===
  if (mode === 'UNIT_SELECT') {
    return (
      <div className="min-h-screen bg-[#F0F4F8] p-4 sm:p-6 flex flex-col items-center justify-center font-sans">
        <div className="max-w-xl w-full">
          <button onClick={() => setMode('SELECT')} className="flex items-center gap-2 text-gray-500 font-bold mb-6 hover:text-gray-800">
            <ArrowLeft size={20}/> 戻る
          </button>
          
          <div className="mb-6">
            <div className="flex items-center gap-2 mb-2">
               <span className="bg-indigo-600 text-white text-xs font-black px-3 py-1 rounded-full">{selectedGrade}</span>
               <span className="bg-orange-500 text-white text-xs font-black px-3 py-1 rounded-full">{selectedSubject}</span>
            </div>
            <h1 className="text-2xl font-black text-gray-800">挑戦する単元を選ぼう</h1>
          </div>

          {availableUnits.length === 0 ? (
             <div className="bg-white p-10 rounded-3xl text-center text-gray-400">
                <p>まだ登録された単元がありません。</p>
                <p className="text-xs mt-2">先生がスライドを追加するのを待ってね！</p>
             </div>
          ) : (
            <div className="grid gap-4">
              {availableUnits.map((unit) => (
                <button
                  key={unit.id}
                  onClick={() => startQuest(unit)}
                  className="bg-white p-5 rounded-2xl shadow-sm border border-gray-100 hover:border-indigo-300 hover:shadow-md transition-all text-left flex justify-between items-center group"
                >
                  <div>
                    <h3 className="font-bold text-lg text-gray-800 group-hover:text-indigo-600 transition-colors">{unit.unit_name}</h3>
                    <p className="text-xs text-gray-400 mt-1 line-clamp-1">{unit.content.substring(0, 30)}...</p>
                  </div>
                  <Play size={24} className="text-gray-300 group-hover:text-indigo-500 transition-colors" fill="currentColor" />
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }

  // === 2. プレイ画面 & 3. 結果画面 ===
  if (mode === 'RESULT') {
    const correctCount = sessionResults.filter(Boolean).length;
    const scorePercent = Math.round((correctCount / sessionQueue.length) * 100) || 0;

    return (
      <div className="min-h-screen bg-[#F0F4F8] p-6 flex items-center justify-center animate-in fade-in">
        <div className="bg-white p-8 rounded-[40px] shadow-xl text-center max-w-md w-full animate-in zoom-in-95 border-4 border-white">
          
          {isPassed ? (
            <>
              <div className="relative inline-block mb-6">
                <div className="absolute inset-0 bg-yellow-400 blur-2xl opacity-50 animate-pulse"></div>
                <Trophy size={80} className="relative text-yellow-400 drop-shadow-sm animate-bounce"/>
              </div>
              <h2 className="text-3xl font-black text-gray-800 mb-2">クエストクリア！</h2>
              <p className="text-gray-500 font-bold mb-8">「{selectedUnit?.unit_name}」マスターだ！</p>
              
              <div className="bg-indigo-50 p-6 rounded-3xl mb-8 relative overflow-hidden">
                <div className="relative z-10">
                  <p className="text-sm font-bold text-indigo-400 mb-1">スコア</p>
                  <p className="text-6xl font-black text-indigo-600 tracking-tight">{scorePercent}<span className="text-2xl ml-1">%</span></p>
                </div>
                {earnedPoints > 0 && (
                  <div className="mt-4 inline-flex items-center gap-2 bg-yellow-400 text-yellow-900 px-6 py-2 rounded-full font-black shadow-lg animate-pulse">
                    <Star fill="currentColor" size={18}/> +{earnedPoints} コイン GET!
                  </div>
                )}
              </div>

              <button onClick={() => setMode('UNIT_SELECT')} className="w-full bg-indigo-600 text-white py-4 rounded-2xl font-bold hover:bg-indigo-700 transition-all flex items-center justify-center gap-2 shadow-lg shadow-indigo-200">
                <ArrowRight size={20}/> 他の単元へ
              </button>
            </>
          ) : (
            <>
              <AlertTriangle size={64} className="mx-auto text-red-400 mb-4 animate-pulse"/>
              <h2 className="text-2xl font-black text-gray-800 mb-2">クリアならず...</h2>
              <p className="text-gray-500 font-bold mb-6">合格ラインは <span className="text-red-500">{PASS_THRESHOLD * 100}%</span> です。</p>
              
              <div className="bg-red-50 p-6 rounded-3xl mb-8 border-2 border-red-100">
                <p className="text-sm font-bold text-red-400">今回のスコア</p>
                <p className="text-5xl font-black text-red-500">{scorePercent}<span className="text-lg">%</span></p>
              </div>

              <div className="space-y-3">
                <button onClick={() => { setSessionResults([]); setCurrentIndex(0); setResult(null); setMode('PLAY'); }} className="w-full bg-red-500 text-white py-4 rounded-2xl font-bold hover:bg-red-600 shadow-lg shadow-red-200 flex items-center justify-center gap-2 transition-transform active:scale-95">
                  <RotateCcw size={18}/> リトライする
                </button>
                <button onClick={() => setMode('UNIT_SELECT')} className="w-full bg-white text-gray-400 py-3 rounded-2xl font-bold hover:bg-gray-50 hover:text-gray-600 text-sm transition-colors">
                  単元を選び直す
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    );
  }

  // === プレイ画面 ===
  return (
    <div className="min-h-screen bg-indigo-50 p-4 md:p-6 flex flex-col items-center font-sans">
      <div className="w-full max-w-2xl">
        <div className="flex justify-between items-center mb-6 px-2">
          <div className="flex items-center gap-2">
            <span className="bg-indigo-600 text-white text-xs font-black px-3 py-1 rounded-full">{selectedGrade}</span>
            <span className="bg-orange-500 text-white text-xs font-black px-3 py-1 rounded-full">{selectedSubject}</span>
            <span className="bg-white text-gray-600 text-xs font-bold px-3 py-1 rounded-full shadow-sm">{selectedUnit?.unit_name}</span>
          </div>
          <span className="text-xs font-black text-indigo-900 bg-white px-4 py-1.5 rounded-full shadow-sm">Q. {currentIndex + 1} / {sessionQueue.length}</span>
        </div>

        <div className="bg-white rounded-[32px] shadow-xl shadow-indigo-100 p-6 md:p-10 mb-6 relative overflow-hidden border-4 border-white min-h-[300px] flex flex-col justify-center">
          <h2 className="text-xl md:text-2xl font-black text-gray-800 mb-8 leading-relaxed text-center">{currentQuestion?.question}</h2>
          <div className="grid gap-3">
            {shuffledOptions.map((opt, i) => {
              let btnStyle = "w-full p-5 rounded-2xl text-center border-b-4 font-bold transition-all duration-200 text-lg ";
              if (result) {
                if (opt === currentQuestion?.correct_answer) btnStyle += "bg-green-500 border-green-700 text-white shadow-md transform scale-105"; 
                else if (opt === result) btnStyle += "bg-gray-100 border-gray-300 text-gray-400"; 
                else btnStyle += "bg-gray-50 border-gray-200 text-gray-300 opacity-50"; 
              } else {
                btnStyle += "bg-white border-indigo-100 text-indigo-600 hover:bg-indigo-50 hover:border-indigo-300 active:scale-[0.98] shadow-sm";
              }
              return <button key={i} onClick={() => !result && handleAnswer(opt)} disabled={!!result} className={btnStyle}>{opt}</button>;
            })}
          </div>
        </div>

        {result && (
          <div className="animate-in slide-in-from-bottom-4 fade-in duration-300">
            <div className={`p-6 rounded-[24px] mb-4 flex items-start gap-4 border-b-4 shadow-lg ${result === 'correct' ? 'bg-green-500 border-green-700 text-white' : 'bg-red-500 border-red-700 text-white'}`}>
              <div className="bg-white/20 p-2 rounded-full shrink-0">{result === 'correct' ? <CheckCircle size={32} strokeWidth={3}/> : <XCircle size={32} strokeWidth={3}/>}</div>
              <div>
                <span className="font-black text-2xl block mb-1">{result === 'correct' ? '正解！' : '残念...'}</span>
                <p className="text-sm font-bold opacity-90 leading-relaxed">{result === 'correct' ? '素晴らしい！この調子で進もう。' : `正解は「${currentQuestion?.correct_answer}」だよ。`}<br/>{currentQuestion?.explanation}</p>
              </div>
            </div>
            <button onClick={handleNext} className="group w-full bg-gray-900 text-white py-5 rounded-[24px] font-black text-xl hover:bg-black shadow-xl flex items-center justify-center gap-3 transition-all active:scale-95 active:shadow-sm">
              {currentIndex + 1 === sessionQueue.length ? '結果を見る' : '次へ進む'} <ArrowRight size={24} strokeWidth={3} className="group-hover:translate-x-1 transition-transform"/>
            </button>
          </div>
        )}
      </div>
    </div>
  );
}