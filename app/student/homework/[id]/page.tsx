'use client';

import { useState, useEffect, use, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { db } from '@/lib/firebase';
import { doc, getDoc } from 'firebase/firestore';
import { useAuth } from '@/app/context/AuthContext';
import { Clock, Send, CheckCircle, AlertCircle, Image as ImageIcon, X, Plus, ExternalLink, RefreshCw, Calendar, FileText, Stamp, MessageCircle, BookOpen } from 'lucide-react';
import { PageHeader, Button, IconButton, StatusPill, EmptyState, ErrorState, ListSkeleton, useToast, useConfirm } from '@/app/components/ui';
import Image from 'next/image';
import { loadStudentHomework } from '@/lib/client-student-homework';
import { formatDateKeySlash, isHomeworkOverdue, parseHomeworkDeadline } from '@/lib/homework-deadline';

export default function HomeworkDetailPage({ params }: { params: Promise<{ id: string }> }) {
  // Next.js 13+ (App Router) の params アンラップ
  const { id } = use(params);
  const assignmentId = id;

  const { user, loading: authLoading } = useAuth();
  const router = useRouter();
  const toast = useToast();
  const confirm = useConfirm();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [assignment, setAssignment] = useState<any>(null);
  const [submission, setSubmission] = useState<any>(null);
  
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [comment, setComment] = useState('');
  
  const [zoomImage, setZoomImage] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  // 読み込み失敗を「宿題が見つからない」と見分ける
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    if (assignmentId && !authLoading) {
      if (!user) { router.push('/'); return; }
      fetchData();
    }
  }, [assignmentId, user, authLoading, router]);

  const fetchData = async () => {
    setLoadError(false);
    try {
      const assignedHomework = await loadStudentHomework({ id: assignmentId });
      if (!assignedHomework) {
        console.error('Homework not found:', assignmentId);
        setAssignment(null); 
        return;
      }
      setAssignment(assignedHomework);

      // 提出状況の取得
      const subId = `${assignmentId}_${user!.uid}`;
      const subSnap = await getDoc(doc(db, 'submissions', subId));

      if (subSnap.exists()) {
        const subData = subSnap.data();
        setSubmission(subData);
        setComment(subData.comment || '');
      }
    } catch (e: any) {
      console.error(e);
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  };

  const retryLoad = () => {
    setLoading(true);
    fetchData();
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      if (!file.type.startsWith('image/')) { toast.error('画像ファイルを選択してください'); return; }
      setSelectedFile(file);
      const reader = new FileReader();
      reader.onloadend = () => setPreviewUrl(reader.result as string);
      reader.readAsDataURL(file);
    }
  };

  const clearSelection = () => {
    setSelectedFile(null);
    setPreviewUrl(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleSubmit = async () => {
    if (!selectedFile) { toast.error('提出する画像を選択してください'); return; }
    const ok = await confirm({ title: 'この画像で提出しますか？', message: '提出すると50コイン獲得できます！', confirmLabel: '提出する' });
    if (!ok) return;

    setSubmitting(true);
    
    try {
      if (!user) throw new Error('ログインセッション切れ');

      const token = await user.getIdToken();
      const form = new FormData();
      form.set('assignment_id', assignmentId);
      form.set('comment', comment);
      form.set('image', selectedFile);
      const submitRes = await fetch('/api/student/homework/submission', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: form,
      });
      const submitData = await submitRes.json().catch(() => ({}));
      if (!submitRes.ok || submitData.ok === false) throw new Error(submitData.error || '提出に失敗しました');

      toast.success(submitData.reward_applied ? '提出しました！ 50コイン獲得！' : '提出しました！この宿題のコインは受取済みです。');
      setSelectedFile(null);
      setPreviewUrl(null);
      await fetchData(); // 画面更新

    } catch (e: any) {
      toast.error(`提出できませんでした。${e.message || ''}`);
    } finally {
      setSubmitting(false);
    }
  };

  if (loading || authLoading) {
    return (
      <div className="mx-auto max-w-3xl space-y-5 px-4 py-6">
        <ListSkeleton rows={4} />
      </div>
    );
  }
  if (loadError) {
    return (
      <div className="mx-auto max-w-3xl space-y-5 px-4 py-6">
        <PageHeader tone="hero" title="宿題の詳細" icon={BookOpen} backHref="/student/homework" />
        <ErrorState title="宿題を読み込めませんでした" onRetry={retryLoad} />
      </div>
    );
  }
  if (!assignment) {
    return (
      <div className="mx-auto max-w-3xl space-y-5 px-4 py-6">
        <PageHeader tone="hero" title="宿題の詳細" icon={BookOpen} backHref="/student/homework" />
        <EmptyState icon={FileText} title="宿題が見つかりません" />
      </div>
    );
  }

  // 日本時間で判定する（日付だけの期限は期限日の終わりまで期限内）
  const deadline = parseHomeworkDeadline(assignment.deadline);
  const isLate = isHomeworkOverdue(assignment.deadline);
  // 再提出ステータスの場合もフォームを表示する
  const showForm = !submission || submission.status === 'resubmit';

  // 科目判定
  const subject = assignment.subject || '';
  const isScience = subject.includes('理科') || ['物理','化学','生物','地学'].some((s:string) => subject.includes(s));
  const isSociety = subject.includes('社会') || ['地理','歴史','公民'].some((s:string) => subject.includes(s));
  
  const bgAccent = isScience ? 'bg-emerald-500' : isSociety ? 'bg-amber-500' : 'bg-sky-500';
  const textAccent = isScience ? 'text-emerald-600' : isSociety ? 'text-amber-600' : 'text-sky-600';
  const bgSoftAccent = isScience ? 'bg-emerald-50' : isSociety ? 'bg-amber-50' : 'bg-sky-50';

  return (
    <div className="mx-auto max-w-3xl space-y-5 px-4 py-6">
      <PageHeader tone="hero" title="宿題の詳細" icon={BookOpen} backHref="/student/homework" />

      {/* 宿題情報カード */}
      <div className="cb-card relative overflow-hidden">
        <div className={`${bgSoftAccent} relative p-card sm:p-8`}>
          <div className="absolute right-4 top-4 z-10">
            {submission?.status === 'checked' ? (
              <StatusPill tone="success" icon={<CheckCircle size={14} aria-hidden />}>合格</StatusPill>
            ) : submission?.status === 'resubmit' ? (
              <StatusPill tone="danger" icon={<RefreshCw size={14} aria-hidden />}>再提出</StatusPill>
            ) : submission ? (
              <StatusPill tone="info" icon={<Clock size={14} aria-hidden />}>確認中</StatusPill>
            ) : isLate ? (
              <StatusPill tone="danger" icon={<AlertCircle size={14} aria-hidden />}>期限切れ</StatusPill>
            ) : (
              <StatusPill tone="neutral">未提出</StatusPill>
            )}
          </div>

          <div className="pr-24">
            <span className={`mb-4 inline-block rounded-input px-3 py-1.5 text-xs font-bold text-white shadow-sm ${bgAccent}`}>
              {assignment.subject || '宿題'}
            </span>
            <h2 className="mb-4 text-2xl font-black leading-tight text-fg sm:text-3xl">
              {assignment.title}
            </h2>
            <div className="flex flex-wrap gap-3">
              <span className="inline-flex items-center gap-2 rounded-input bg-white/70 px-3 py-1.5 text-sm font-bold text-slate-600">
                <Calendar size={16} className={textAccent} aria-hidden /> {formatDateKeySlash(deadline.dateKey) || '期限未設定'}
              </span>
              {/* 時刻つきの期限のときだけ時刻を出す（日付だけの期限に偽の時刻を出さない） */}
              {deadline.time && (
                <span className="inline-flex items-center gap-2 rounded-input bg-white/70 px-3 py-1.5 text-sm font-bold text-slate-600">
                  <Clock size={16} className={textAccent} aria-hidden /> {deadline.time}
                </span>
              )}
            </div>
          </div>
        </div>

        <div className="p-card sm:p-8">
          <div className="flex items-start gap-3">
            <FileText className="mt-1 shrink-0 text-slate-300" size={24} aria-hidden />
            <div className="prose prose-stone prose-sm max-w-none whitespace-pre-wrap font-medium leading-relaxed text-fg sm:prose-base">
              {assignment.description || '詳細はありません'}
            </div>
          </div>
        </div>
      </div>

      {/* 先生からのコメント & スタンプ（合格時のみ表示） */}
      {submission?.status === 'checked' && (
        <div className="rounded-card border-2 border-emerald-200 bg-emerald-50 p-card shadow-sm animate-in slide-in-from-top-2">
          <h3 className="mb-4 flex items-center gap-2 text-lg font-bold text-emerald-700">
            <Stamp size={24} aria-hidden />
            先生からのコメント
          </h3>

          {/* 先生コメント */}
          {submission.teacher_comment && (
            <div className="relative mb-4 rounded-btn border border-emerald-100 bg-white p-5 text-base font-medium text-fg shadow-sm">
              <div className="absolute -top-3 left-6 h-6 w-6 rotate-45 border-l border-t border-emerald-100 bg-white"></div>
              <div className="flex items-start gap-2">
                <MessageCircle size={20} className="mt-0.5 shrink-0 text-emerald-400" aria-hidden />
                {submission.teacher_comment}
              </div>
            </div>
          )}

          {/* スタンプがなければデフォルトメッセージ */}
          {!submission.teacher_comment && !submission.stamp_url && (
            <p className="text-center font-bold text-emerald-700">よく頑張りました！合格です！🎉</p>
          )}
        </div>
      )}

      {/* 再提出時のフィードバック表示 */}
      {submission?.status === 'resubmit' && submission.feedback && (
        <div className="rounded-card border-2 border-rose-200 bg-rose-50 p-card shadow-sm animate-in slide-in-from-top-2">
          <h3 className="mb-2 flex items-center gap-2 text-lg font-bold text-rose-600">
            <RefreshCw size={24} aria-hidden />
            再提出について
          </h3>
          <div className="relative rounded-btn border border-rose-100 bg-white p-5 text-base font-medium text-fg shadow-sm">
            <div className="absolute -top-3 left-6 h-6 w-6 rotate-45 border-l border-t border-rose-100 bg-white"></div>
            {submission.feedback}
          </div>
          <p className="mt-3 text-center text-xs font-bold text-rose-500">※内容を確認して、もう一度画像をアップロードしよう！</p>
        </div>
      )}

      {/* 提出フォーム or 提出済み表示 */}
      <div className="cb-card p-card sm:p-8">
        <h3 className="mb-6 flex items-center gap-3 text-xl font-bold text-fg">
          <span className={`rounded-btn p-2 ${showForm ? 'bg-accent-soft text-accent' : 'bg-success-soft text-success'}`}>
            {showForm ? <ImageIcon size={24} aria-hidden /> : <CheckCircle size={24} aria-hidden />}
          </span>
          {showForm ? '回答を提出する' : '提出済みの回答'}
        </h3>

        {!showForm ? (
          // 提出済み (チェック待ち or 合格)
          <div className="flex flex-col items-center gap-6">
            <button
              type="button"
              aria-label="提出画像を拡大して見る"
              className="group relative aspect-[4/3] w-full cursor-zoom-in overflow-hidden rounded-card border-2 border-line bg-slate-50 shadow-card transition-all sm:w-2/3"
              onClick={() => setZoomImage(submission.imageUrl)}
            >
              <Image src={submission.imageUrl} alt="提出画像" fill className="object-cover" unoptimized />

              {/* スタンプ表示 */}
              {submission.status === 'checked' && submission.stamp_url && (
                <div className="absolute right-4 top-4 aspect-square w-1/3 rotate-12 drop-shadow-xl animate-in zoom-in duration-500">
                  <Image src={submission.stamp_url} alt="先生からのスタンプ" fill className="object-contain" unoptimized />
                </div>
              )}

              <div className="absolute inset-0 flex items-center justify-center gap-2 bg-black/30 font-bold text-white opacity-0 backdrop-blur-sm transition-opacity group-hover:opacity-100">
                <ExternalLink aria-hidden /> 拡大して見る
              </div>
            </button>
            <div className="rounded-btn bg-slate-50 px-6 py-3 text-center">
              <p className="text-sm font-medium text-fg-muted">
                {submission.status === 'checked' ? '🎉 合格です！よく頑張りました！' : '👨‍🏫 先生が確認中です。しばらくお待ちください。'}
              </p>
            </div>
          </div>
        ) : (
          // フォーム (未提出 or 再提出)
          <div className="space-y-6">
            <input type="file" accept="image/*" ref={fileInputRef} onChange={handleFileChange} className="hidden" />

            <div className="flex flex-col items-center gap-3">
              {previewUrl ? (
                <>
                  <div className="relative aspect-[4/3] w-full overflow-hidden rounded-card border-2 border-accent/30 bg-slate-50 shadow-card sm:w-2/3">
                    <Image src={previewUrl} alt="プレビュー" fill className="object-contain" unoptimized />
                  </div>
                  <Button variant="secondary" onClick={clearSelection} icon={<X size={18} aria-hidden />}>
                    取消する
                  </Button>
                </>
              ) : (
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="group flex aspect-video w-full flex-col items-center justify-center gap-4 rounded-card border-2 border-dashed border-accent/30 bg-accent-soft/50 text-accent transition-all hover:border-accent hover:bg-accent-soft active:scale-[0.99] sm:aspect-[2/1]"
                >
                  <div className="rounded-full bg-white p-4 shadow-sm transition-transform duration-300 group-hover:scale-110">
                    <Plus size={32} strokeWidth={3} className="text-accent" aria-hidden />
                  </div>
                  <div className="text-center">
                    <span className="block text-lg font-bold text-accent">写真を撮る・選ぶ</span>
                    <span className="text-xs font-medium text-fg-muted">ここをタップして画像をアップロード</span>
                  </div>
                </button>
              )}
            </div>

            <div className="rounded-input border border-line bg-slate-50 p-4 transition-all focus-within:ring-2 focus-within:ring-accent">
              <label htmlFor="homework-comment" className="mb-2 block pl-2 text-xs font-bold text-fg-muted">コメント (任意)</label>
              <textarea
                id="homework-comment"
                className="h-24 w-full resize-none border-none bg-transparent p-2 font-medium text-fg outline-none placeholder:text-slate-400 focus:ring-0"
                placeholder="質問や伝えたいことがあれば書いてね"
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                disabled={submitting}
              />
            </div>

            <Button
              size="lg"
              fullWidth
              onClick={handleSubmit}
              disabled={submitting || !selectedFile}
              loading={submitting}
              icon={<Send size={22} aria-hidden />}
            >
              {submission?.status === 'resubmit' ? '修正して再提出する' : 'この内容で提出する'}
            </Button>
          </div>
        )}
      </div>

      {/* 拡大モーダル */}
      {zoomImage && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 p-4 backdrop-blur-sm animate-in fade-in duration-200" onClick={() => setZoomImage(null)}>
          <div className="relative flex h-[85vh] w-full max-w-5xl flex-col items-center justify-center">
            <Image src={zoomImage} alt="拡大" fill className="object-contain" unoptimized />
            <IconButton
              label="閉じる"
              className="absolute -top-12 right-0 bg-white/20 text-white hover:bg-white/40 sm:right-4 sm:top-4"
              onClick={() => setZoomImage(null)}
            >
              <X size={24} aria-hidden />
            </IconButton>
          </div>
        </div>
      )}
    </div>
  );
}
