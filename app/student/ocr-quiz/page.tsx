'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { auth } from '@/lib/firebase';
import { useAuth } from '@/app/context/AuthContext';
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  FileImage,
  Loader2,
  Lock,
  RotateCcw,
  ShieldCheck,
  XCircle,
} from 'lucide-react';

type QuizQuestion = {
  id: string;
  question: string;
  correct_answer: string;
  wrong_answers: string[];
  explanation: string;
};

type StoredSession = {
  createdAt: string;
  questions: QuizQuestion[];
};

const STORAGE_PREFIX = 'classbase_private_ocr_quiz:';
const MAX_IMAGE_BYTES = 7 * 1024 * 1024;

function shuffle<T>(items: T[]) {
  const next = [...items];
  for (let i = next.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [next[i], next[j]] = [next[j], next[i]];
  }
  return next;
}

function getJstLabel() {
  return new Date().toLocaleString('ja-JP', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error || new Error('file-read-failed'));
    reader.readAsDataURL(file);
  });
}

export default function PrivateOcrQuizPage() {
  const { user, profile, loading: authLoading } = useAuth();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [showConsent, setShowConsent] = useState(false);
  const [agreed, setAgreed] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [questions, setQuestions] = useState<QuizQuestion[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [selectedAnswer, setSelectedAnswer] = useState<string | null>(null);
  const [answered, setAnswered] = useState(false);
  const [accessLabel, setAccessLabel] = useState(getJstLabel());

  const storageKey = user?.uid ? `${STORAGE_PREFIX}${user.uid}` : '';
  const currentQuestion = questions[currentIndex];
  const options = useMemo(() => {
    if (!currentQuestion) return [];
    return shuffle([currentQuestion.correct_answer, ...currentQuestion.wrong_answers]);
  }, [currentQuestion]);
  const userName = profile?.student_name || profile?.name || user?.displayName || 'unknown-user';
  const watermark = `${userName} / ${user?.uid || 'no-uid'} / ${accessLabel} JST`;

  useEffect(() => {
    setAccessLabel(getJstLabel());
  }, [currentIndex]);

  useEffect(() => {
    if (!storageKey) return;
    try {
      const stored = localStorage.getItem(storageKey);
      if (!stored) return;
      const parsed = JSON.parse(stored) as StoredSession;
      if (Array.isArray(parsed.questions)) setQuestions(parsed.questions);
    } catch {
      localStorage.removeItem(storageKey);
    }
  }, [storageKey]);

  useEffect(() => {
    const blockCopy = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();
      if ((event.metaKey || event.ctrlKey) && ['c', 'x', 'p', 's'].includes(key)) {
        event.preventDefault();
      }
    };
    window.addEventListener('keydown', blockCopy, true);
    return () => window.removeEventListener('keydown', blockCopy, true);
  }, []);

  const openConsent = () => {
    setAgreed(false);
    setShowConsent(true);
  };

  const proceedToFilePicker = () => {
    if (!agreed) return;
    setShowConsent(false);
    fileInputRef.current?.click();
  };

  const saveSession = (nextQuestions: QuizQuestion[]) => {
    if (!storageKey) return;
    const payload: StoredSession = {
      createdAt: new Date().toISOString(),
      questions: nextQuestions,
    };
    localStorage.setItem(storageKey, JSON.stringify(payload));
  };

  const clearSession = () => {
    setQuestions([]);
    setCurrentIndex(0);
    setSelectedAnswer(null);
    setAnswered(false);
    if (storageKey) localStorage.removeItem(storageKey);
  };

  const handleFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setMessage('画像ファイルを選択してください。');
      return;
    }
    if (file.size > MAX_IMAGE_BYTES) {
      setMessage('画像サイズが大きすぎます。7MB以下にしてください。');
      return;
    }
    if (!user) return;

    setGenerating(true);
    setMessage(null);
    let imageDataUrl: string | null = null;
    try {
      imageDataUrl = await readFileAsDataUrl(file);
      const token = await auth.currentUser?.getIdToken();
      if (!token) throw new Error('ログイン情報を確認できません');

      const res = await fetch('/api/ocr-quiz', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
          'Cache-Control': 'no-store',
        },
        body: JSON.stringify({
          imageDataUrl,
          legalConsent: true,
          privateUseOnly: true,
          questionCount: 5,
          grade: profile?.grade || '',
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) throw new Error(data.error || '問題作成に失敗しました');

      setQuestions(data.questions || []);
      setCurrentIndex(0);
      setSelectedAnswer(null);
      setAnswered(false);
      saveSession(data.questions || []);
    } catch (error: any) {
      setMessage(error?.message || '問題作成に失敗しました。');
    } finally {
      imageDataUrl = null;
      setGenerating(false);
    }
  };

  const handleAnswer = (answer: string) => {
    if (answered) return;
    setSelectedAnswer(answer);
    setAnswered(true);
  };

  const goNext = () => {
    setSelectedAnswer(null);
    setAnswered(false);
    setCurrentIndex((prev) => Math.min(questions.length - 1, prev + 1));
  };

  const goPrev = () => {
    setSelectedAnswer(null);
    setAnswered(false);
    setCurrentIndex((prev) => Math.max(0, prev - 1));
  };

  if (authLoading) {
    return <div className="flex min-h-screen items-center justify-center"><Loader2 className="animate-spin text-indigo-500" size={32} /></div>;
  }

  if (!user) {
    return null;
  }

  return (
    <div className="min-h-screen bg-slate-100 p-4 pb-32 text-slate-800">
      <style jsx global>{`
        .private-ocr-quiz-container,
        .private-ocr-quiz-container * {
          user-select: none;
          -webkit-user-select: none;
        }
        @media print {
          body * {
            visibility: hidden !important;
          }
          body::before {
            content: "印刷禁止";
            visibility: visible !important;
            display: flex !important;
            min-height: 100vh;
            align-items: center;
            justify-content: center;
            font-size: 28px;
            font-weight: 900;
            color: #111827;
          }
        }
      `}</style>

      <input ref={fileInputRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={handleFile} />

      <div className="mx-auto max-w-2xl space-y-5">
        <header className="flex items-center gap-3">
          <Link href="/student" className="rounded-full bg-white p-3 text-slate-500 shadow-sm">
            <ArrowLeft size={20} />
          </Link>
          <div>
            <p className="text-xs font-black uppercase tracking-wider text-indigo-500">Private OCR Quiz</p>
            <h1 className="text-2xl font-black text-slate-900">OCR問題作成</h1>
          </div>
        </header>

        <section className="rounded-3xl border border-indigo-100 bg-white p-5 shadow-sm">
          <div className="flex items-start gap-3">
            <div className="rounded-2xl bg-indigo-50 p-3 text-indigo-600">
              <ShieldCheck size={24} />
            </div>
            <div className="min-w-0">
              <h2 className="font-black text-slate-900">私的利用専用</h2>
              <p className="mt-1 text-xs font-bold leading-relaxed text-slate-500">
                画像とOCRテキストはサーバーに保存しません。生成問題はこの端末のブラウザ内にのみ保存され、共有URL・PDF出力・印刷・エクスポートはありません。
              </p>
            </div>
          </div>
          <button
            onClick={openConsent}
            disabled={generating}
            className="mt-4 flex w-full items-center justify-center gap-2 rounded-2xl bg-slate-900 py-4 text-sm font-black text-white shadow-lg active:scale-[0.99] disabled:opacity-60"
          >
            {generating ? <Loader2 className="animate-spin" size={18} /> : <FileImage size={18} />}
            画像から私用問題を作成
          </button>
          {message && (
            <div className="mt-3 rounded-2xl bg-rose-50 p-3 text-xs font-bold leading-relaxed text-rose-600">
              {message}
            </div>
          )}
        </section>

        {questions.length > 0 ? (
          <section
            className="private-ocr-quiz-container relative overflow-hidden rounded-3xl border border-slate-200 bg-white p-5 shadow-sm"
            onContextMenu={(event) => event.preventDefault()}
            onCopy={(event) => event.preventDefault()}
            onCut={(event) => event.preventDefault()}
            data-sound="off"
          >
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-0 opacity-[0.12]"
              style={{
                backgroundImage: `repeating-linear-gradient(135deg, transparent 0 34px, rgba(15,23,42,.08) 34px 35px), url("data:image/svg+xml,${encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' width='420' height='160'><text x='0' y='80' transform='rotate(-18 210 80)' fill='%231f2937' font-size='14' font-family='sans-serif'>${watermark.replace(/[<>&"']/g, '')}</text></svg>`)}")`,
                backgroundSize: '120px 120px, 420px 160px',
              }}
            />

            <div className="relative z-10">
              <div className="mb-4 flex items-center justify-between">
                <span className="rounded-full bg-indigo-50 px-3 py-1 text-xs font-black text-indigo-600">
                  {currentIndex + 1} / {questions.length}
                </span>
                <span className="flex items-center gap-1 rounded-full bg-slate-100 px-3 py-1 text-[10px] font-black text-slate-500">
                  <Lock size={12} /> 共有不可
                </span>
              </div>

              <h2 className="min-h-24 rounded-2xl bg-slate-50 p-4 text-lg font-black leading-relaxed text-slate-900">
                {currentQuestion.question}
              </h2>

              <div className="mt-4 space-y-3">
                {options.map((option) => {
                  const correct = option === currentQuestion.correct_answer;
                  const selected = option === selectedAnswer;
                  const className = answered
                    ? correct
                      ? 'border-emerald-300 bg-emerald-50 text-emerald-700'
                      : selected
                        ? 'border-rose-300 bg-rose-50 text-rose-700'
                        : 'border-slate-100 bg-slate-50 text-slate-400'
                    : 'border-slate-200 bg-white text-slate-700 active:scale-[0.99]';
                  return (
                    <button
                      key={option}
                      onClick={() => handleAnswer(option)}
                      className={`flex w-full items-center justify-between rounded-2xl border-2 p-4 text-left text-sm font-black transition ${className}`}
                    >
                      <span>{option}</span>
                      {answered && correct && <CheckCircle2 size={18} />}
                      {answered && selected && !correct && <XCircle size={18} />}
                    </button>
                  );
                })}
              </div>

              {answered && (
                <div className="mt-4 rounded-2xl bg-indigo-50 p-4 text-sm font-bold leading-relaxed text-indigo-800">
                  {currentQuestion.explanation}
                </div>
              )}

              <div className="mt-5 flex gap-3">
                <button onClick={goPrev} disabled={currentIndex === 0} className="flex-1 rounded-2xl bg-slate-100 py-3 text-sm font-black text-slate-500 disabled:opacity-40">
                  戻る
                </button>
                {currentIndex < questions.length - 1 ? (
                  <button onClick={goNext} className="flex flex-1 items-center justify-center gap-2 rounded-2xl bg-indigo-600 py-3 text-sm font-black text-white">
                    次へ <ArrowRight size={16} />
                  </button>
                ) : (
                  <button onClick={() => setCurrentIndex(0)} className="flex flex-1 items-center justify-center gap-2 rounded-2xl bg-indigo-600 py-3 text-sm font-black text-white">
                    もう一周 <RotateCcw size={16} />
                  </button>
                )}
              </div>

              <button onClick={clearSession} className="mt-3 w-full rounded-2xl border border-slate-200 bg-white py-3 text-xs font-black text-slate-400">
                この端末の生成問題を削除
              </button>
            </div>
          </section>
        ) : (
          <section className="rounded-3xl border-2 border-dashed border-slate-200 bg-white p-8 text-center">
            <AlertTriangle className="mx-auto mb-3 text-slate-300" size={34} />
            <p className="text-sm font-bold text-slate-500">生成済みの私用問題はありません。</p>
          </section>
        )}
      </div>

      {showConsent && (
        <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-3xl bg-white p-6 shadow-2xl">
            <h2 className="text-xl font-black text-slate-900">【ご利用前の確認】</h2>
            <p className="mt-4 whitespace-pre-wrap text-sm font-bold leading-relaxed text-slate-600">
              本機能は、お客様が私的に利用する目的（ご自身の学習など）に限り、お手元の資料をAIで問題化できます。
              {'\n'}※作成された問題は、他者への共有、配布、公開は一切できません。
              {'\n'}※送信されたデータは問題作成後に即時破棄され、当社のサーバーには保存されません。
            </p>
            <label className="mt-5 flex items-start gap-3 rounded-2xl bg-slate-50 p-4">
              <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} className="mt-1 h-5 w-5 accent-indigo-600" />
              <span className="text-xs font-black leading-relaxed text-slate-700">
                私的利用に限定し、共有・配布・公開・印刷・外部出力を行わないことに同意します。
              </span>
            </label>
            <div className="mt-5 grid grid-cols-2 gap-3">
              <button onClick={() => setShowConsent(false)} className="rounded-2xl bg-slate-100 py-3 text-sm font-black text-slate-500">
                キャンセル
              </button>
              <button onClick={proceedToFilePicker} disabled={!agreed} className="rounded-2xl bg-slate-900 py-3 text-sm font-black text-white disabled:opacity-40">
                同意して選択
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
