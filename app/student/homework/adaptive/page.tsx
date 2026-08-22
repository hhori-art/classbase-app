'use client';

import { useState, useEffect } from 'react';
import { auth, db } from '@/lib/firebase';
import { collection, query, where, getDocs, orderBy, limit } from 'firebase/firestore';
import { useAuth } from '@/app/context/AuthContext';
import {
  CheckCircle, XCircle, ArrowRight, ArrowLeft, Loader2,
  RotateCcw, AlertTriangle, Trophy, Star, Brain, Play, FlaskConical, Globe, BookOpenText,
  BookOpen, List, History
} from 'lucide-react';
import Link from 'next/link';
import { useSound } from '@/lib/sound';

// --- 設定値 ---
const PASS_THRESHOLD = 0.8;
const POINTS_PER_CLEAR = 10; // ★変更: 10コインに設定
const MASTERED_STREAK_REQUIRED = 1;

// --- ユーティリティ ---
const shuffleArray = (array: any[]) => {
  const newArray = [...array];
  for (let i = newArray.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [newArray[i], newArray[j]] = [newArray[j], newArray[i]];
  }
  return newArray;
};

function compactForAi(value: unknown, maxChars = 12000) {
  const text = String(value || '').replace(/\n{3,}/g, '\n\n').trim();
  if (text.length <= maxChars) return text;
  const head = text.slice(0, Math.floor(maxChars * 0.45));
  const middleStart = Math.max(0, Math.floor(text.length / 2 - maxChars * 0.15));
  const middle = text.slice(middleStart, middleStart + Math.floor(maxChars * 0.25));
  const tail = text.slice(-Math.floor(maxChars * 0.25));
  return `${head}\n\n【中略】\n\n${middle}\n\n【後半抜粋】\n\n${tail}`.slice(0, maxChars);
}

async function readJsonResponse(res: Response) {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    const title = text.match(/<title>(.*?)<\/title>/i)?.[1];
    throw new Error(title || `APIがJSON以外を返しました (${res.status})`);
  }
}

interface Question {
  id: string;
  question: string;
  correct_answer: string;
  wrong_answers: string[];
  explanation?: string;
  source_slide_id?: string;
  difficulty?: number;
  skill?: string;
}

type QuestionMastery = {
  total: number;
  wrong: number;
  correct: number;
  streak: number;
  mastered: boolean;
  masteryScore: number;
  lastIsCorrect?: boolean;
};

type UnitMastery = {
  unit_name?: string;
  learning_unit_id?: string;
  source_slide_id?: string;
  target_question_count?: number;
  attempted_question_count?: number;
  mastered_question_count?: number;
  mastered_rate?: number;
  stage?: string;
  stage_label?: string;
  completed?: boolean;
};

type AnswerRecord = {
  question_id: string;
  selected_answer: string;
  correct_answer: string;
  is_correct: boolean;
  source_slide_id?: string;
  difficulty?: number;
  skill?: string;
};

const SUBJECTS = {
  science: { label: '理科', icon: <FlaskConical size={18}/>, items: ['物理', '化学', '生物', '地学'], color: 'bg-purple-100 text-purple-700 hover:bg-purple-200' },
  society: { label: '社会', icon: <Globe size={18}/>, items: ['地理', '歴史', '公民'], color: 'bg-orange-100 text-orange-700 hover:bg-orange-200' },
  japanese: { label: '国語', icon: <BookOpenText size={18}/>, items: ['漢字', '語句', '古文単語', '文法'], color: 'bg-rose-100 text-rose-700 hover:bg-rose-200' }
};

export default function AdaptiveLearningPage() {
  const { user, profile } = useAuth();
  const { play } = useSound(profile?.settings?.sound_se !== false);

  // --- State ---
  const [loading, setLoading] = useState(false);
  const [mode, setMode] = useState<'SELECT' | 'UNIT_SELECT' | 'PLAY' | 'RESULT'>('SELECT');

  // 選択データ
  const [selectedGrade, setSelectedGrade] = useState('');
  const [selectedSubject, setSelectedSubject] = useState('');
  const [availableUnits, setAvailableUnits] = useState<any[]>([]);
  const [selectedUnit, setSelectedUnit] = useState<any>(null); // {id, unit_name, content}
  const [unitMasteryMap, setUnitMasteryMap] = useState<Record<string, UnitMastery>>({});

  // プレイ中データ
  const [sessionQueue, setSessionQueue] = useState<Question[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [currentQuestion, setCurrentQuestion] = useState<Question | null>(null);
  const [shuffledOptions, setShuffledOptions] = useState<string[]>([]);
  const [sessionResults, setSessionResults] = useState<boolean[]>([]);
  const [answerRecords, setAnswerRecords] = useState<AnswerRecord[]>([]);
  const [result, setResult] = useState<'correct' | 'incorrect' | null>(null);
  const [selectedAnswer, setSelectedAnswer] = useState<string | null>(null);

  // 結果
  const [isPassed, setIsPassed] = useState(false);
  const [earnedPoints, setEarnedPoints] = useState(0);
  const [latestUnitMastery, setLatestUnitMastery] = useState<UnitMastery | null>(null);

  const unitKey = (unit: any) => String(unit?.source_slide_id || unit?.id || unit?.unit_name || '');
  const unitKeys = (unit: any) => [
    String(unit?.source_slide_id || ''),
    String(unit?.id || unit?.learning_unit_id || ''),
    String(unit?.unit_name || ''),
  ].filter(Boolean);
  const masteryKeys = (mastery: UnitMastery) => [
    String(mastery.source_slide_id || ''),
    String(mastery.learning_unit_id || ''),
    String(mastery.unit_name || ''),
  ].filter(Boolean);

  const stableGeneratedQuestionId = (unit: any, question: any, index: number) => {
    const seed = `${unit?.source_slide_id || unit?.id || unit?.unit_name || 'unit'}:${question?.question || ''}:${question?.correct_answer || ''}:${index}`;
    let hash = 0;
    for (let i = 0; i < seed.length; i++) {
      hash = ((hash << 5) - hash + seed.charCodeAt(i)) | 0;
    }
    return `generated-${Math.abs(hash)}`;
  };

  const stageStyle = (stage?: string) => {
    if (stage === 'completed') return 'bg-emerald-50 text-emerald-700 border-emerald-100';
    if (stage === 'almost') return 'bg-yellow-50 text-yellow-700 border-yellow-100';
    if (stage === 'training') return 'bg-indigo-50 text-indigo-700 border-indigo-100';
    return 'bg-slate-50 text-slate-500 border-slate-100';
  };

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
      await fetchUnitMastery(units);
      setMode('UNIT_SELECT');
    } catch (e) {
      console.error(e);
      // インデックスエラー回避: orderByを外して再試行
      try {
        const q2 = query(collection(db, 'learning_units'), where('grade', '==', selectedGrade), where('subject', '==', selectedSubject));
        const snap2 = await getDocs(q2);
        const units = snap2.docs.map(d => ({ id: d.id, ...d.data() }));
        setAvailableUnits(units);
        await fetchUnitMastery(units);
        setMode('UNIT_SELECT');
      } catch(e2) {
        alert('単元の取得に失敗しました');
      }
    } finally {
      setLoading(false);
    }
  };

  const fetchUnitMastery = async (units: any[]) => {
    if (!user || units.length === 0) {
      setUnitMasteryMap({});
      return;
    }

    const keys = new Set(units.flatMap(unitKeys));
    const snap = await getDocs(query(
      collection(db, 'quest_unit_mastery'),
      where('student_id', '==', user.uid),
      limit(500)
    )).catch(() => ({ docs: [] as any[] }));

    const next: Record<string, UnitMastery> = {};
    snap.docs.forEach((doc: any) => {
      const data = doc.data();
      const candidates = [
        String(data.source_slide_id || ''),
        String(data.learning_unit_id || ''),
        String(data.unit_name || ''),
      ].filter(Boolean);
      const matched = candidates.find(key => keys.has(key));
      if (matched) {
        candidates.forEach(key => {
          if (keys.has(key)) next[key] = data;
        });
      }
    });
    setUnitMasteryMap(next);
  };

  const fetchPrebuiltQuestions = async (unit: any) => {
    const snapshots = [];
    if (unit.source_slide_id) {
      snapshots.push(await getDocs(query(
        collection(db, 'quizzes'),
        where('source_slide_id', '==', unit.source_slide_id),
        limit(80)
      )));
    }
    if (snapshots.length === 0 || snapshots.every(snap => snap.empty)) {
      snapshots.push(await getDocs(query(
        collection(db, 'quizzes'),
        where('unit_name', '==', unit.unit_name || ''),
        limit(80)
      )));
    }

    const map = new Map<string, Question>();
    snapshots.forEach(snap => {
      snap.docs.forEach(doc => {
        const data = doc.data();
        if (!data.question || !data.correct_answer || !Array.isArray(data.wrong_answers)) return;
        map.set(doc.id, {
          id: doc.id,
          question: String(data.question),
          correct_answer: String(data.correct_answer),
          wrong_answers: data.wrong_answers.map(String).slice(0, 3),
          explanation: String(data.explanation || ''),
          source_slide_id: String(data.source_slide_id || unit.source_slide_id || ''),
          difficulty: Number(data.difficulty || 3),
          skill: String(data.skill || ''),
        });
      });
    });
    return Array.from(map.values());
  };

  const fetchQuestionMastery = async (unit: any, questionIds: string[]) => {
    if (!user || questionIds.length === 0) return new Map<string, QuestionMastery>();
    const snap = await getDocs(query(
      collection(db, 'quest_question_mastery'),
      where('student_id', '==', user.uid),
      limit(500)
    )).catch(() => ({ docs: [] as any[] }));

    const target = new Set(questionIds);
    const unitSlideId = String(unit?.source_slide_id || '');
    const unitId = String(unit?.id || '');
    const stats = new Map<string, QuestionMastery>();
    snap.docs.forEach((doc: any) => {
      const data = doc.data();
      const qid = String(data.question_id || '');
      if (!target.has(qid)) return;
      const belongsToUnit =
        (unitSlideId && String(data.source_slide_id || '') === unitSlideId) ||
        (unitId && String(data.learning_unit_id || '') === unitId) ||
        String(data.unit_name || '') === String(unit?.unit_name || '');
      if (!belongsToUnit) return;
      stats.set(qid, {
        total: Number(data.total_attempts || 0),
        wrong: Number(data.wrong_count || 0),
        correct: Number(data.correct_count || 0),
        streak: Number(data.current_correct_streak || 0),
        mastered: Boolean(data.mastered),
        masteryScore: Number(data.mastery_score || 0),
        lastIsCorrect: typeof data.last_is_correct === 'boolean' ? data.last_is_correct : undefined,
      });
    });
    return stats;
  };

  const selectQuestionsForMemory = async (unit: any, questions: Question[]) => {
    const stats = await fetchQuestionMastery(unit, questions.map(q => q.id));
    const scored = questions.map(question => {
      const stat = stats.get(question.id);
      const total = stat?.total || 0;
      const wrong = stat?.wrong || 0;
      const correct = stat?.correct || 0;
      const mastery = total > 0 ? correct / total : 0;
      const masteredPenalty = stat?.mastered ? -60 : 0;
      const streakBonus = stat && stat.streak < MASTERED_STREAK_REQUIRED ? 20 : 0;
      const priority = total === 0
        ? 95 + Math.random() * 10
        : wrong * 28 + (1 - mastery) * 38 + streakBonus + masteredPenalty + Math.random() * 8;
      return { question, priority };
    });
    return scored
      .sort((a, b) => b.priority - a.priority)
      .slice(0, 10)
      .map(item => item.question);
  };

  // --- クエスト開始 ---
  const startQuest = async (unit: any) => {
    setSelectedUnit(unit);
    setLoading(true);

    try {
      let questions = await fetchPrebuiltQuestions(unit);

      if (questions.length === 0) {
        const res = await fetch('/api/homework/adaptive', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            grade: selectedGrade,
            subject: selectedSubject,
            unitName: unit.unit_name,
            unitContent: compactForAi(unit.content)
          }),
        });

        if (!res.ok) throw new Error('API Error');
        const data = await readJsonResponse(res);
        questions = (data.questions || []).map((q: any, i: number) => ({
          ...q,
          id: q.id || stableGeneratedQuestionId(unit, q, i),
          source_slide_id: unit.source_slide_id || '',
        }));
      }

      if (questions.length === 0) throw new Error('問題が生成されませんでした');

      const selectedQuestions = await selectQuestionsForMemory(unit, questions);
      const queue = shuffleArray(selectedQuestions);
      setSessionQueue(queue);
      setCurrentIndex(0);
      setSessionResults([]);
      setAnswerRecords([]);
      setSelectedAnswer(null);
      setResult(null);
      setLatestUnitMastery(null);
      setEarnedPoints(0);
      setIsPassed(false);
      setNextQuestion(queue[0]);
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
    play(isCorrect ? 'answer_correct' : 'answer_incorrect');
    setSelectedAnswer(ans);
    setResult(isCorrect ? 'correct' : 'incorrect');
    setSessionResults([...sessionResults, isCorrect]);
    setAnswerRecords(prev => [...prev, {
      question_id: currentQuestion.id,
      selected_answer: ans,
      correct_answer: currentQuestion.correct_answer,
      is_correct: isCorrect,
      source_slide_id: currentQuestion.source_slide_id,
      difficulty: currentQuestion.difficulty,
      skill: currentQuestion.skill,
    }]);
  };

  const handleNext = () => {
    const nextIdx = currentIndex + 1;
    if (nextIdx < sessionQueue.length) {
      setResult(null);
      setSelectedAnswer(null);
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
    if (passed) play('quest_cleared');

    if (user) {
      try {
        const token = await auth.currentUser?.getIdToken();
        const res = await fetch('/api/quest-results', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({
            grade: selectedGrade,
            subject: selectedSubject,
            unit_name: selectedUnit?.unit_name || '不明な単元',
            learning_unit_id: selectedUnit?.id || '',
            source_slide_id: selectedUnit?.source_slide_id || '',
            score: Math.round(scoreRate * 100),
            is_passed: passed,
            total_question_count: selectedUnit?.prebuilt_question_count || sessionQueue.length,
            question_results: answerRecords,
          }),
        });
        const saved = await res.json();
        if (passed) {
          setEarnedPoints(saved.earned_points || POINTS_PER_CLEAR);
          if (saved.earned_points > 0) play('coin_acquired');
        }
        if (saved.unit_mastery) {
          setLatestUnitMastery(saved.unit_mastery);
          setUnitMasteryMap(prev => {
            const next = { ...prev };
            [...unitKeys(selectedUnit), ...masteryKeys(saved.unit_mastery)].forEach(key => {
              next[key] = saved.unit_mastery;
            });
            return next;
          });
        }
      } catch (e) {
        console.error("Save Error:", e);
      }
    }
  };

  const retryCurrentUnit = () => {
    if (selectedUnit) startQuest(selectedUnit);
  };

  const returnToUnitSelect = async () => {
    if (availableUnits.length > 0) await fetchUnitMastery(availableUnits);
    setMode('UNIT_SELECT');
  };

  if (loading) return (
    <div className="h-screen flex items-center justify-center bg-indigo-50">
      <div className="text-center">
        <Loader2 className="animate-spin text-indigo-600 mx-auto mb-4" size={48}/>
        <p className="text-indigo-600 font-bold animate-pulse">
          {mode === 'UNIT_SELECT' ? '単元を読み込み中...' : '問題を準備中...'}
        </p>
      </div>
    </div>
  );

  // === 1. 学年・科目選択 ===
  if (mode === 'SELECT') {
    return (
      <div className="min-h-screen bg-[#F0F4F8] p-4 sm:p-6 flex flex-col items-center justify-center font-sans">
        <div className="max-w-xl w-full">

          <div className="flex justify-between mb-4">
            <Link href="/student" className="bg-white px-4 py-2 rounded-full shadow-sm text-sm font-bold text-gray-500 hover:text-indigo-600 flex items-center gap-2">
              <ArrowLeft size={16}/> 戻る
            </Link>
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
            <div className="mt-4 rounded-2xl border border-amber-100 bg-amber-50 px-4 py-3 text-left text-xs font-bold leading-relaxed text-amber-800">
              <span className="mr-2 inline-flex rounded-full bg-amber-200 px-2 py-0.5 text-[10px] font-black text-amber-900">ベータ版</span>
              AIが作成した問題を使うため、内容が必ず正しいとは限りません。気になる問題は先生に確認してください。
            </div>
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
                  <div className="flex items-center gap-2 text-xs font-bold text-rose-500 mb-2"><BookOpenText size={14}/> 国語</div>
                  <div className="grid grid-cols-2 gap-2">
                    {SUBJECTS.japanese.items.map(s => (
                      <button key={s} onClick={() => setSelectedSubject(s)} className={`py-2.5 rounded-lg text-sm font-bold transition-all ${selectedSubject === s ? 'bg-rose-500 text-white' : SUBJECTS.japanese.color}`}>{s}</button>
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
                  className="bg-white p-5 rounded-2xl shadow-sm border border-gray-100 hover:border-indigo-300 hover:shadow-md transition-all text-left flex justify-between items-center gap-4 group"
                >
                  <div className="min-w-0 flex-1">
                    <h3 className="font-bold text-lg text-gray-800 group-hover:text-indigo-600 transition-colors">{unit.unit_name}</h3>
                    {(() => {
                      const mastery = unitMasteryMap[unitKey(unit)];
                      const target = Number(mastery?.target_question_count || unit.prebuilt_question_count || 0);
                      const mastered = Number(mastery?.mastered_question_count || 0);
                      const rate = target > 0 ? Math.min(100, Math.round((mastered / target) * 100)) : Number(mastery?.mastered_rate || 0);
                      return (
                        <div className="mt-3 space-y-2">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className={`rounded-full border px-3 py-1 text-[11px] font-black ${stageStyle(mastery?.stage)}`}>
                              {mastery?.stage_label || '未挑戦'}
                            </span>
                            {target > 0 && <span className="text-[11px] font-bold text-slate-400">定着 {mastered}/{target}問</span>}
                          </div>
                          <div className="h-2 overflow-hidden rounded-full bg-slate-100">
                            <div className="h-full rounded-full bg-indigo-500 transition-all" style={{ width: `${rate}%` }} />
                          </div>
                        </div>
                      );
                    })()}
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
    const mastery = latestUnitMastery || unitMasteryMap[unitKey(selectedUnit)];
    const completed = Boolean(mastery?.completed);

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
              <p className="text-gray-500 font-bold mb-8">
                {completed ? `「${selectedUnit?.unit_name}」は全問定着！` : `「${selectedUnit?.unit_name}」の記憶が強くなったよ。`}
              </p>

              <div className="bg-indigo-50 p-6 rounded-3xl mb-8 relative overflow-hidden">
                <div className="relative z-10">
                  <p className="text-sm font-bold text-indigo-400 mb-1">スコア</p>
                  <p className="text-6xl font-black text-indigo-600 tracking-tight">{scorePercent}<span className="text-2xl ml-1">%</span></p>
                  {mastery && (
                    <div className="mt-4 rounded-2xl bg-white/80 p-3 text-sm font-black text-indigo-700">
                      到達段階: {mastery.stage_label || '学習中'}
                      {Number(mastery.target_question_count || 0) > 0 && (
                        <span className="ml-2 text-xs text-indigo-400">
                          {mastery.mastered_question_count || 0}/{mastery.target_question_count}問 定着
                        </span>
                      )}
                    </div>
                  )}
                </div>
                {earnedPoints > 0 && (
                  <div className="mt-4 inline-flex items-center gap-2 bg-yellow-400 text-yellow-900 px-6 py-2 rounded-full font-black shadow-lg animate-pulse">
                    <Star fill="currentColor" size={18}/> +{earnedPoints} コイン GET!
                  </div>
                )}
              </div>

              <button onClick={returnToUnitSelect} className="w-full bg-indigo-600 text-white py-4 rounded-2xl font-bold hover:bg-indigo-700 transition-all flex items-center justify-center gap-2 shadow-lg shadow-indigo-200">
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
                <button onClick={retryCurrentUnit} className="w-full bg-red-500 text-white py-4 rounded-2xl font-bold hover:bg-red-600 shadow-lg shadow-red-200 flex items-center justify-center gap-2 transition-transform active:scale-95">
                  <RotateCcw size={18}/> リトライする
                </button>
                <button onClick={returnToUnitSelect} className="w-full bg-white text-gray-400 py-3 rounded-2xl font-bold hover:bg-gray-50 hover:text-gray-600 text-sm transition-colors">
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
                else if (opt === selectedAnswer) btnStyle += "bg-red-100 border-red-300 text-red-500";
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
