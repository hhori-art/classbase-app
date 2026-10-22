'use client';

import { useState, useEffect } from 'react';
import { auth, db } from '@/lib/firebase';
import { collection, query, where, getDocs, orderBy, limit } from 'firebase/firestore';
import { useAuth } from '@/app/context/AuthContext';
import {
  CheckCircle, XCircle, ArrowRight, ArrowLeft,
  RotateCcw, AlertTriangle, Trophy, Star, Brain, Play, FlaskConical, Globe, BookOpenText,
  List, History, X
} from 'lucide-react';
import Link from 'next/link';
import { PageHeader, Button, Card, EmptyState, Spinner, useToast, useConfirm } from '@/app/components/ui';
import { normalizeCourseGrade } from '@/lib/course-registration-rules';
import { useSound } from '@/lib/sound';

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

// 正解はサーバー（quest_sessions）にだけあり、回答ごとに /api/quest-sessions/answer で受け取る。
interface Question {
  id: string;
  question: string;
  options: string[];
  source_slide_id?: string;
  difficulty?: number;
  skill?: string;
}

type RevealedAnswer = { correct_answer: string; explanation: string };

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

const SUBJECTS = {
  science: { label: '理科', icon: <FlaskConical size={18}/>, items: ['物理', '化学', '生物', '地学'], color: 'bg-emerald-100 text-emerald-700 hover:bg-emerald-200' },
  society: { label: '社会', icon: <Globe size={18}/>, items: ['地理', '歴史', '公民'], color: 'bg-amber-100 text-amber-800 hover:bg-amber-200' },
  japanese: { label: '国語', icon: <BookOpenText size={18}/>, items: ['漢字', '語句', '古文単語', '文法'], color: 'bg-rose-100 text-rose-700 hover:bg-rose-200' }
};

export default function AdaptiveLearningPage() {
  const { user, profile } = useAuth();
  const { play } = useSound(profile?.settings?.sound_se !== false);
  const toast = useToast();
  const confirm = useConfirm();

  // --- State ---
  const [loading, setLoading] = useState(false);
  const [mode, setMode] = useState<'SELECT' | 'UNIT_SELECT' | 'PLAY' | 'RESULT'>('SELECT');

  // 選択データ
  const [selectedGrade, setSelectedGrade] = useState('');
  const [selectedSubject, setSelectedSubject] = useState('');
  const [gradeTouched, setGradeTouched] = useState(false);

  // プロフィールの学年を最初から選んでおく（変更もできる）。
  const profileGrade = normalizeCourseGrade(profile?.grade);
  useEffect(() => {
    if (gradeTouched || selectedGrade) return;
    if (['中1', '中2', '中3'].includes(profileGrade)) setSelectedGrade(profileGrade);
  }, [profileGrade, gradeTouched, selectedGrade]);
  const [availableUnits, setAvailableUnits] = useState<any[]>([]);
  const [selectedUnit, setSelectedUnit] = useState<any>(null); // {id, unit_name, content}
  const [unitMasteryMap, setUnitMasteryMap] = useState<Record<string, UnitMastery>>({});

  // プレイ中データ
  const [sessionQueue, setSessionQueue] = useState<Question[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [currentQuestion, setCurrentQuestion] = useState<Question | null>(null);
  const [shuffledOptions, setShuffledOptions] = useState<string[]>([]);
  const [sessionResults, setSessionResults] = useState<boolean[]>([]);
  const [revealed, setRevealed] = useState<RevealedAnswer | null>(null);
  const [answering, setAnswering] = useState(false);
  const [questSessionId, setQuestSessionId] = useState('');
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

  const stageStyle = (stage?: string) => {
    if (stage === 'completed') return 'bg-emerald-50 text-emerald-700 border-emerald-100';
    if (stage === 'almost') return 'bg-amber-50 text-amber-700 border-amber-100';
    if (stage === 'training') return 'bg-accent-soft text-accent border-accent/20';
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
        toast.error('単元を読み込めませんでした。通信状態を確認して、もう一度お試しください。');
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

  const postJson = async (url: string, payload: Record<string, unknown>) => {
    const token = await auth.currentUser?.getIdToken();
    if (!token) throw new Error('ログイン情報を確認できません');
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(payload),
    });
    const data = await readJsonResponse(res);
    if (!res.ok || data.ok === false) throw new Error(data.error || 'API Error');
    return data;
  };

  const toQuestions = (items: any[], unit: any): Question[] => (Array.isArray(items) ? items : []).map(item => ({
    id: String(item.id || ''),
    question: String(item.question || ''),
    options: Array.isArray(item.options) ? item.options.map(String) : [],
    source_slide_id: String(item.source_slide_id || unit.source_slide_id || ''),
    difficulty: Number(item.difficulty || 3),
    skill: String(item.skill || ''),
  })).filter(item => item.id && item.question && item.options.length > 0);

  // --- クエスト開始 ---
  const startQuest = async (unit: any) => {
    setSelectedUnit(unit);
    setLoading(true);

    try {
      setQuestSessionId('');
      // 作成済み問題があればサーバーが未定着の問題を優先して選ぶ。なければAIで生成する。
      let data = await postJson('/api/quest-sessions', { learning_unit_id: unit.id || '' });
      if (!data.session_id) {
        data = await postJson('/api/homework/adaptive', {
          grade: selectedGrade,
          subject: selectedSubject,
          unitName: unit.unit_name,
          unitContent: compactForAi(unit.content),
          learningUnitId: unit.id || '',
          sourceSlideId: unit.source_slide_id || '',
        });
      }
      const questions = toQuestions(data.questions, unit);
      if (!data.session_id || questions.length === 0) throw new Error('問題が生成されませんでした');
      setQuestSessionId(String(data.session_id));

      const queue = shuffleArray(questions);
      setSessionQueue(queue);
      setCurrentIndex(0);
      setSessionResults([]);
      setRevealed(null);
      setSelectedAnswer(null);
      setResult(null);
      setLatestUnitMastery(null);
      setEarnedPoints(0);
      setIsPassed(false);
      setNextQuestion(queue[0]);
      setMode('PLAY');

    } catch (e) {
      console.error(e);
      toast.error('問題を作成できませんでした。もう一度お試しください。');
    } finally {
      setLoading(false);
    }
  };

  const setNextQuestion = (question: Question) => {
    if (!question) return;
    setCurrentQuestion(question);
    setShuffledOptions(question.options);
  };

  const handleAnswer = async (ans: string) => {
    if (!currentQuestion || answering) return;
    setAnswering(true);
    setSelectedAnswer(ans);
    try {
      const data = await postJson('/api/quest-sessions/answer', {
        session_id: questSessionId,
        question_id: currentQuestion.id,
        selected_answer: ans,
      });
      const isCorrect = data.is_correct === true;
      play(isCorrect ? 'answer_correct' : 'answer_incorrect');
      setRevealed({ correct_answer: String(data.correct_answer || ''), explanation: String(data.explanation || '') });
      setResult(isCorrect ? 'correct' : 'incorrect');
      setSessionResults(prev => [...prev, isCorrect]);
    } catch (e) {
      console.error(e);
      setSelectedAnswer(null);
      toast.error('回答を送信できませんでした。通信環境を確認して、もう一度選んでください。');
    } finally {
      setAnswering(false);
    }
  };

  const handleNext = () => {
    const nextIdx = currentIndex + 1;
    if (nextIdx < sessionQueue.length) {
      setResult(null);
      setRevealed(null);
      setSelectedAnswer(null);
      setCurrentIndex(nextIdx);
      setNextQuestion(sessionQueue[nextIdx]);
    } else {
      finishSession();
    }
  };

  const finishSession = async () => {
    setMode('RESULT');

    if (user) {
      try {
        const token = await auth.currentUser?.getIdToken();
        const res = await fetch('/api/quest-results', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          // 採点はサーバーが記録済みの回答から行う。
          body: JSON.stringify({ session_id: questSessionId }),
        });
        const saved = await res.json();
        if (!res.ok) throw new Error(saved.error || '結果を保存できませんでした');
        setIsPassed(Boolean(saved.is_passed));
        if (saved.is_passed) {
          play('quest_cleared');
          setEarnedPoints(Number(saved.earned_points || 0));
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
        toast.error('結果を保存できませんでした。通信状態を確認してください。');
      }
    }
  };

  const retryCurrentUnit = () => {
    if (selectedUnit) startQuest(selectedUnit);
  };

  // 途中でやめる。結果（/api/quest-results）は全問に答えたときだけ保存されるので、この回は記録もコインもつかない。
  const quitQuest = async () => {
    const ok = await confirm({
      title: 'クエストをやめますか？',
      message: '最後まで答えていないので、この回の結果は記録されず、コインももらえません。',
      confirmLabel: 'やめる',
      cancelLabel: '続ける',
    });
    if (!ok) return;
    setResult(null);
    setRevealed(null);
    setSelectedAnswer(null);
    setQuestSessionId('');
    await returnToUnitSelect();
  };

  const returnToUnitSelect = async () => {
    if (availableUnits.length > 0) await fetchUnitMastery(availableUnits);
    setMode('UNIT_SELECT');
  };

  if (loading) return (
    <div className="mx-auto flex min-h-[60vh] max-w-xl items-center justify-center px-4 py-6">
      <div className="text-center">
        <Spinner size={44} className="mb-4" label={mode === 'UNIT_SELECT' ? '単元を読み込み中' : '問題を準備中'} />
        <p className="font-bold text-accent motion-safe:animate-pulse">
          {mode === 'UNIT_SELECT' ? '単元を読み込み中...' : '問題を準備中...'}
        </p>
      </div>
    </div>
  );

  const subjectChipClass = 'rounded-full bg-amber-500 px-3 py-1 text-xs font-bold text-white';
  const gradeChipClass = 'rounded-full bg-accent px-3 py-1 text-xs font-bold text-accent-ink';

  // === 1. 学年・科目選択 ===
  if (mode === 'SELECT') {
    return (
      <div className="mx-auto max-w-xl space-y-5 px-4 py-6">
        <PageHeader
          tone="hero"
          title="AI学習クエスト"
          description="好きな分野を選んで挑戦しよう！"
          icon={Brain}
          backHref="/student"
          actions={(
            <Link href="/student/history" className="inline-flex min-h-11 items-center gap-2 rounded-btn bg-white/15 px-4 text-sm font-bold text-accent-ink hover:bg-white/25">
              <History size={16} aria-hidden /> 履歴を見る
            </Link>
          )}
        />

        <div className="rounded-card border border-amber-100 bg-amber-50 px-4 py-3 text-xs font-medium leading-relaxed text-amber-800">
          <span className="mr-2 inline-flex rounded-full bg-amber-200 px-2 py-0.5 text-[11px] font-bold text-amber-900">ベータ版</span>
          AIが作成した問題を使うため、内容が必ず正しいとは限りません。気になる問題は先生に確認してください。
        </div>

        <Card className="space-y-8">
          <div>
            <p className="mb-3 ml-1 block text-xs font-bold text-fg-muted">学年</p>
            <div className="grid grid-cols-3 gap-3">
              {['中1', '中2', '中3'].map(g => (
                <button key={g} type="button" aria-pressed={selectedGrade === g} onClick={() => { setGradeTouched(true); setSelectedGrade(g); }} className={`min-h-11 rounded-btn py-3 text-sm font-bold transition-all ${selectedGrade === g ? 'bg-accent text-accent-ink shadow-sm' : 'bg-slate-100 text-slate-600'}`}>{g}</button>
              ))}
            </div>
          </div>

          <div>
            <p className="mb-3 ml-1 block text-xs font-bold text-fg-muted">科目・分野</p>
            <div className="space-y-4">
              <div>
                <div className="mb-2 flex items-center gap-2 text-xs font-bold text-emerald-600"><FlaskConical size={14} aria-hidden /> 理科</div>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {SUBJECTS.science.items.map(s => (
                    <button key={s} type="button" aria-pressed={selectedSubject === s} onClick={() => setSelectedSubject(s)} className={`min-h-11 rounded-btn py-2.5 text-sm font-bold transition-all ${selectedSubject === s ? 'bg-emerald-500 text-white' : SUBJECTS.science.color}`}>{s}</button>
                  ))}
                </div>
              </div>
              <div>
                <div className="mb-2 flex items-center gap-2 text-xs font-bold text-amber-600"><Globe size={14} aria-hidden /> 社会</div>
                <div className="grid grid-cols-3 gap-2">
                  {SUBJECTS.society.items.map(s => (
                    <button key={s} type="button" aria-pressed={selectedSubject === s} onClick={() => setSelectedSubject(s)} className={`min-h-11 rounded-btn py-2.5 text-sm font-bold transition-all ${selectedSubject === s ? 'bg-amber-500 text-white' : SUBJECTS.society.color}`}>{s}</button>
                  ))}
                </div>
              </div>
              <div>
                <div className="mb-2 flex items-center gap-2 text-xs font-bold text-rose-500"><BookOpenText size={14} aria-hidden /> 国語</div>
                <div className="grid grid-cols-2 gap-2">
                  {SUBJECTS.japanese.items.map(s => (
                    <button key={s} type="button" aria-pressed={selectedSubject === s} onClick={() => setSelectedSubject(s)} className={`min-h-11 rounded-btn py-2.5 text-sm font-bold transition-all ${selectedSubject === s ? 'bg-rose-500 text-white' : SUBJECTS.japanese.color}`}>{s}</button>
                  ))}
                </div>
              </div>
            </div>
          </div>

          <Button
            size="lg"
            fullWidth
            onClick={fetchUnits}
            disabled={!selectedGrade || !selectedSubject}
            icon={<List size={22} aria-hidden />}
          >
            単元を選ぶ
          </Button>
        </Card>
      </div>
    );
  }

  // === 1.5 単元選択画面 ===
  if (mode === 'UNIT_SELECT') {
    return (
      <div className="mx-auto max-w-xl space-y-5 px-4 py-6">
        <Button variant="ghost" onClick={() => setMode('SELECT')} icon={<ArrowLeft size={18} aria-hidden />}>
          戻る
        </Button>

        <div>
          <div className="mb-2 flex items-center gap-2">
            <span className={gradeChipClass}>{selectedGrade}</span>
            <span className={subjectChipClass}>{selectedSubject}</span>
          </div>
          <h1 className="text-2xl font-black text-fg">挑戦する単元を選ぼう</h1>
        </div>

        {availableUnits.length === 0 ? (
          <EmptyState
            icon={BookOpenText}
            title="まだ登録された単元がありません。"
            description="先生がスライドを追加するのを待ってね！"
          />
        ) : (
          <div className="grid gap-3">
            {availableUnits.map((unit) => (
              <button
                key={unit.id}
                type="button"
                onClick={() => startQuest(unit)}
                className="cb-card p-card group flex items-center justify-between gap-4 text-left transition-all hover:ring-2 hover:ring-accent/30"
              >
                <div className="min-w-0 flex-1">
                  <h3 className="text-lg font-bold text-fg transition-colors group-hover:text-accent">{unit.unit_name}</h3>
                  {(() => {
                    const mastery = unitMasteryMap[unitKey(unit)];
                    const target = Number(mastery?.target_question_count || unit.prebuilt_question_count || 0);
                    const mastered = Number(mastery?.mastered_question_count || 0);
                    const rate = target > 0 ? Math.min(100, Math.round((mastered / target) * 100)) : Number(mastery?.mastered_rate || 0);
                    return (
                      <div className="mt-3 space-y-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className={`rounded-full border px-3 py-1 text-xs font-bold ${stageStyle(mastery?.stage)}`}>
                            {mastery?.stage_label || '未挑戦'}
                          </span>
                          {target > 0 && <span className="text-xs font-medium text-fg-muted">定着 {mastered}/{target}問</span>}
                        </div>
                        <div className="h-2 overflow-hidden rounded-full bg-slate-100">
                          <div className="h-full rounded-full bg-accent transition-all" style={{ width: `${rate}%` }} />
                        </div>
                      </div>
                    );
                  })()}
                </div>
                <Play size={24} className="text-slate-300 transition-colors group-hover:text-accent" fill="currentColor" aria-hidden />
              </button>
            ))}
          </div>
        )}
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
      <div className="mx-auto flex min-h-[70vh] max-w-md items-center justify-center px-4 py-6 animate-in fade-in">
        <Card className="w-full p-8 text-center animate-in zoom-in-95">

          {isPassed ? (
            <>
              <div className="relative mb-6 inline-block">
                <div className="absolute inset-0 bg-yellow-400 opacity-50 blur-2xl motion-safe:animate-pulse"></div>
                <Trophy size={80} className="relative text-yellow-400 drop-shadow-sm motion-safe:animate-bounce" aria-hidden />
              </div>
              <h2 className="mb-2 text-3xl font-black text-fg">クエストクリア！</h2>
              <p className="mb-8 font-medium text-fg-muted">
                {completed ? `「${selectedUnit?.unit_name}」は全問定着！` : `「${selectedUnit?.unit_name}」の記憶が強くなったよ。`}
              </p>

              <div className="relative mb-8 overflow-hidden rounded-card bg-accent-soft p-6">
                <div className="relative z-10">
                  <p className="mb-1 text-sm font-bold text-accent">スコア</p>
                  <p className="text-6xl font-black tracking-tight text-accent">{scorePercent}<span className="ml-1 text-2xl">%</span></p>
                  {mastery && (
                    <div className="mt-4 rounded-btn bg-white/80 p-3 text-sm font-bold text-accent">
                      到達段階: {mastery.stage_label || '学習中'}
                      {Number(mastery.target_question_count || 0) > 0 && (
                        <span className="ml-2 text-xs font-medium text-fg-muted">
                          {mastery.mastered_question_count || 0}/{mastery.target_question_count}問 定着
                        </span>
                      )}
                    </div>
                  )}
                </div>
                {earnedPoints > 0 && (
                  <div className="mt-4 inline-flex items-center gap-2 rounded-full bg-yellow-400 px-6 py-2 font-bold text-yellow-900 shadow-lg motion-safe:animate-pulse">
                    <Star fill="currentColor" size={18} aria-hidden /> +{earnedPoints} コイン ゲット！
                  </div>
                )}
              </div>

              <Button size="lg" fullWidth onClick={returnToUnitSelect} icon={<ArrowRight size={20} aria-hidden />}>
                他の単元へ
              </Button>
            </>
          ) : (
            <>
              <AlertTriangle size={64} className="mx-auto mb-4 text-rose-400" aria-hidden />
              <h2 className="mb-2 text-2xl font-black text-fg">クリアならず...</h2>
              <p className="mb-6 font-medium text-fg-muted">合格ラインは <span className="font-bold text-danger">{PASS_THRESHOLD * 100}%</span> です。</p>

              <div className="mb-8 rounded-card border-2 border-rose-100 bg-rose-50 p-6">
                <p className="text-sm font-bold text-rose-500">今回のスコア</p>
                <p className="text-5xl font-black text-danger">{scorePercent}<span className="text-lg">%</span></p>
              </div>

              <div className="space-y-3">
                <Button size="lg" fullWidth onClick={retryCurrentUnit} icon={<RotateCcw size={18} aria-hidden />}>
                  リトライする
                </Button>
                <Button variant="ghost" fullWidth onClick={returnToUnitSelect}>
                  単元を選び直す
                </Button>
              </div>
            </>
          )}
        </Card>
      </div>
    );
  }

  // === プレイ画面 ===
  return (
    <div className="mx-auto max-w-2xl space-y-5 px-4 py-6">
      <div className="flex items-start justify-between gap-2 px-1">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
          <span className={gradeChipClass}>{selectedGrade}</span>
          <span className={subjectChipClass}>{selectedSubject}</span>
          <span className="max-w-full break-words rounded-full bg-surface px-3 py-1 text-xs font-bold text-fg-muted shadow-sm">{selectedUnit?.unit_name}</span>
          <span className="whitespace-nowrap rounded-full bg-surface px-3 py-1 text-xs font-bold text-fg shadow-sm">{currentIndex + 1} / {sessionQueue.length}問</span>
        </div>
        <Button variant="secondary" size="sm" onClick={quitQuest} disabled={answering} icon={<X size={14} aria-hidden />} className="shrink-0">
          やめる
        </Button>
      </div>

      <Card className="relative flex min-h-[300px] flex-col justify-center overflow-hidden md:p-10">
        <h2 className="mb-8 text-center text-xl font-bold leading-relaxed text-fg md:text-2xl">{currentQuestion?.question}</h2>
        <div className="grid gap-3">
          {shuffledOptions.map((opt, i) => {
            let btnStyle = "w-full min-h-12 p-4 rounded-btn text-center border-b-4 font-bold transition-all duration-200 text-lg ";
            if (result) {
              if (opt === revealed?.correct_answer) btnStyle += "bg-emerald-500 border-emerald-700 text-white shadow-md transform scale-105";
              else if (opt === selectedAnswer) btnStyle += "bg-rose-100 border-rose-300 text-rose-600";
              else btnStyle += "bg-slate-50 border-slate-200 text-slate-400 opacity-50";
            } else {
              btnStyle += "bg-surface border-accent/20 text-accent hover:bg-accent-soft hover:border-accent/40 active:scale-[0.98] shadow-sm";
            }
            return <button key={i} type="button" onClick={() => !result && handleAnswer(opt)} disabled={!!result || answering} className={btnStyle}>{opt}</button>;
          })}
        </div>
      </Card>

      {result && (
        <div className="space-y-4 animate-in slide-in-from-bottom-4 fade-in duration-300">
          <div role="status" className={`flex items-start gap-4 rounded-card border-b-4 p-6 text-white shadow-card ${result === 'correct' ? 'border-emerald-700 bg-emerald-500' : 'border-rose-700 bg-rose-500'}`}>
            <div className="shrink-0 rounded-full bg-white/20 p-2">{result === 'correct' ? <CheckCircle size={32} strokeWidth={3} aria-hidden /> : <XCircle size={32} strokeWidth={3} aria-hidden />}</div>
            <div>
              <span className="mb-1 block text-2xl font-black">{result === 'correct' ? '正解！' : '残念...'}</span>
              <p className="text-sm font-medium leading-relaxed opacity-95">{result === 'correct' ? '素晴らしい！この調子で進もう。' : `正解は「${revealed?.correct_answer}」だよ。`}<br/>{revealed?.explanation}</p>
            </div>
          </div>
          <button type="button" onClick={handleNext} className="group flex min-h-14 w-full items-center justify-center gap-3 rounded-btn bg-slate-900 py-4 text-xl font-bold text-white shadow-card transition-all hover:bg-black active:scale-95">
            {currentIndex + 1 === sessionQueue.length ? '結果を見る' : '次へ進む'} <ArrowRight size={24} strokeWidth={3} className="transition-transform group-hover:translate-x-1" aria-hidden />
          </button>
        </div>
      )}
    </div>
  );
}
