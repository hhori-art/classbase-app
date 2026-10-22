'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { auth } from '@/lib/firebase';
import { useAuth } from '@/app/context/AuthContext';
import {
  ArrowRight,
  CheckCircle2,
  FileImage,
  Lock,
  RotateCcw,
  ShieldCheck,
  XCircle,
} from 'lucide-react';
import { Button, Card, EmptyState, Modal, PageHeader, Spinner } from '@/app/components/ui';

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

  const downloadDiagnosisSample = () => {
    const canvas = document.createElement('canvas');
    canvas.width = 1200;
    canvas.height = 800;
    const context = canvas.getContext('2d');
    if (!context) return;
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = '#0f172a';
    context.font = 'bold 48px sans-serif';
    context.fillText('診断用 OCR テスト教材', 70, 100);
    context.font = '32px sans-serif';
    ['中学3年 理科：イオン', '・原子が電子を失うと陽イオンになる。', '・原子が電子を受け取ると陰イオンになる。', '・電解質の水溶液には電流が流れる。', '問：塩化ナトリウム水溶液中の粒子を説明しなさい。']
      .forEach((line, index) => context.fillText(line, 70, 210 + index * 100));
    canvas.toBlob(blob => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = 'diagnosis-ocr-sample.png';
      anchor.click();
      URL.revokeObjectURL(url);
    }, 'image/png');
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
    return <div className="flex min-h-[60vh] items-center justify-center"><Spinner size={32} /></div>;
  }

  if (!user) {
    return null;
  }

  return (
    <div className="px-4 py-6 text-fg">
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
        <PageHeader tone="hero" eyebrow="私用問題" title="OCR問題作成" icon={FileImage} backHref="/student" />

        <Card>
          <div className="flex items-start gap-3">
            <div className="rounded-btn bg-accent-soft p-3 text-accent">
              <ShieldCheck size={24} aria-hidden />
            </div>
            <div className="min-w-0">
              <h2 className="font-bold text-fg">私的利用専用</h2>
              <p className="mt-1 text-sm leading-relaxed text-fg-muted">
                画像とOCRテキストはサーバーに保存しません。生成問題はこの端末のブラウザ内にのみ保存され、共有URL・PDF出力・印刷・エクスポートはありません。
              </p>
            </div>
          </div>
          <Button
            onClick={openConsent}
            loading={generating}
            size="lg"
            fullWidth
            icon={<FileImage size={18} aria-hidden />}
            className="mt-4"
          >
            画像から私用問題を作成
          </Button>
          {process.env.NEXT_PUBLIC_SECURITY_DIAGNOSIS_MODE === 'true' && (
            <Button
              variant="secondary"
              onClick={downloadDiagnosisSample}
              fullWidth
              icon={<FileImage size={16} aria-hidden />}
              className="mt-3"
            >
              診断用サンプル画像をダウンロード
            </Button>
          )}
          {message && (
            <div role="alert" className="mt-3 rounded-btn bg-danger-soft p-3 text-sm font-bold leading-relaxed text-danger">
              {message}
            </div>
          )}
        </Card>

        {questions.length > 0 ? (
          <section
            className="private-ocr-quiz-container cb-card relative overflow-hidden p-card"
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
                <span className="rounded-full bg-accent-soft px-3 py-1 text-xs font-bold text-accent">
                  {currentIndex + 1} / {questions.length}
                </span>
                <span className="flex items-center gap-1 rounded-full bg-slate-100 px-3 py-1 text-xs font-bold text-fg-muted">
                  <Lock size={12} aria-hidden /> 共有不可
                </span>
              </div>

              <h2 className="min-h-24 rounded-btn bg-slate-50 p-4 text-lg font-bold leading-relaxed text-fg">
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
                        : 'border-line bg-slate-50 text-slate-400'
                    : 'border-line bg-surface text-fg hover:border-accent/30 active:scale-[0.99]';
                  return (
                    <button
                      key={option}
                      onClick={() => handleAnswer(option)}
                      className={`flex min-h-11 w-full items-center justify-between rounded-btn border-2 p-4 text-left text-sm font-bold transition ${className}`}
                    >
                      <span>{option}</span>
                      {answered && correct && <CheckCircle2 size={18} aria-label="正解" />}
                      {answered && selected && !correct && <XCircle size={18} aria-label="不正解" />}
                    </button>
                  );
                })}
              </div>

              {answered && (
                <div className="mt-4 rounded-btn bg-accent-soft p-4 text-sm leading-relaxed text-fg">
                  {currentQuestion.explanation}
                </div>
              )}

              <div className="mt-5 flex gap-3">
                <Button variant="secondary" onClick={goPrev} disabled={currentIndex === 0} className="flex-1">
                  戻る
                </Button>
                {currentIndex < questions.length - 1 ? (
                  <Button onClick={goNext} className="flex-1">
                    次へ <ArrowRight size={16} aria-hidden />
                  </Button>
                ) : (
                  <Button onClick={() => setCurrentIndex(0)} className="flex-1">
                    もう一周 <RotateCcw size={16} aria-hidden />
                  </Button>
                )}
              </div>

              <Button variant="ghost" onClick={clearSession} fullWidth className="mt-3">
                この端末の生成問題を削除
              </Button>
            </div>
          </section>
        ) : (
          <EmptyState icon={FileImage} title="生成済みの私用問題はありません。" className="bg-surface" />
        )}
      </div>

      <Modal
        open={showConsent}
        onClose={() => setShowConsent(false)}
        title="ご利用前の確認"
        footer={(
          <>
            <Button variant="secondary" onClick={() => setShowConsent(false)}>
              キャンセル
            </Button>
            <Button onClick={proceedToFilePicker} disabled={!agreed}>
              同意して選択
            </Button>
          </>
        )}
      >
        <p className="whitespace-pre-wrap text-sm leading-relaxed text-fg-muted">
          本機能は、お客様が私的に利用する目的（ご自身の学習など）に限り、お手元の資料をAIで問題化できます。
          {'\n'}※作成された問題は、他者への共有、配布、公開は一切できません。
          {'\n'}※送信されたデータは問題作成後に即時破棄され、当社のサーバーには保存されません。
        </p>
        <label className="mt-5 flex cursor-pointer items-start gap-3 rounded-btn bg-slate-50 p-4">
          <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} className="mt-1 h-5 w-5 accent-[rgb(var(--cb-accent))]" />
          <span className="text-sm font-bold leading-relaxed text-fg">
            私的利用に限定し、共有・配布・公開・印刷・外部出力を行わないことに同意します。
          </span>
        </label>
      </Modal>
    </div>
  );
}
