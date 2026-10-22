'use client';

import { useState, useEffect, use, useRef } from 'react';
import { db } from '@/lib/firebase';
import { doc, getDoc, collection, query, where, getDocs } from 'firebase/firestore';
import { CheckCircle, User, MessageSquare, ExternalLink, RefreshCw, Send, Stamp, Plus, Inbox } from 'lucide-react';
import Image from 'next/image';
import { useAuth } from '@/app/context/AuthContext';
import {
  Button, Card, PageHeader, Modal, useToast, ListSkeleton, EmptyState, ErrorState, StatusPill,
} from '@/app/components/ui';

// デフォルトのスタンプリスト（必要に応じて画像URLを差し替えてください）
const DEFAULT_STAMPS = [
  { id: 'good', url: 'https://placehold.co/150x150/FF9999/white?text=GOOD' },
  { id: 'great', url: 'https://placehold.co/150x150/99FF99/white?text=GREAT' },
  { id: 'check', url: 'https://placehold.co/150x150/9999FF/white?text=CHECK' },
  { id: 'ok', url: 'https://placehold.co/150x150/FFFF99/black?text=OK' },
];

export default function TeacherHomeworkCheckPage({ params }: { params: Promise<{ id: string }> }) {
  const { user } = useAuth();
  const toast = useToast();
  const { id } = use(params);
  const assignmentId = id;

  const [assignment, setAssignment] = useState<any>(null);
  const [submissions, setSubmissions] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [sending, setSending] = useState(false);

  // 拡大表示用
  const [zoomImage, setZoomImage] = useState<string | null>(null);
  
  // 再提出用モーダル状態
  const [feedbackInput, setFeedbackInput] = useState<{id: string, text: string} | null>(null);

  // ■ 合格・スタンプ用モーダル状態
  const [checkModal, setCheckModal] = useState<{id: string, student_name: string, imageUrl: string} | null>(null);
  const [teacherComment, setTeacherComment] = useState('');
  const [selectedStamp, setSelectedStamp] = useState<string | null>(null);
  const [customStamps, setCustomStamps] = useState<{id: string, url: string}[]>([]);
  const stampInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetchData();
  }, [assignmentId]);

  const fetchData = async () => {
    try {
      setLoadError(false);
      // 宿題情報の取得
      const assignSnap = await getDoc(doc(db, 'homework_assignments', assignmentId));
      if (!assignSnap.exists()) return;
      setAssignment({ id: assignSnap.id, ...assignSnap.data() });

      // 提出物の取得
      const q = query(collection(db, 'submissions'), where('assignment_id', '==', assignmentId));
      const subSnap = await getDocs(q);
      
      const list = subSnap.docs.map(d => ({ id: d.id, ...d.data() } as any));
      // 日付順にソート (新しい順)
      const toMillis = (value: any) => {
        if (!value) return 0;
        if (typeof value.toMillis === 'function') return value.toMillis();
        if (typeof value.toDate === 'function') return value.toDate().getTime();
        if (typeof value.seconds === 'number') return value.seconds * 1000;
        const parsed = new Date(value).getTime();
        return Number.isFinite(parsed) ? parsed : 0;
      };
      list.sort((a: any, b: any) => toMillis(b.submitted_at) - toMillis(a.submitted_at));
      setSubmissions(list);
    } catch (e) {
      console.error(e);
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  };

  // ■ OK (合格) モーダルを開く
  const openCheckModal = (sub: any) => {
    setCheckModal({
      id: sub.id,
      student_name: sub.student_name,
      imageUrl: sub.imageUrl
    });
    setTeacherComment('');
    setSelectedStamp(DEFAULT_STAMPS[0].url); // デフォルト選択
  };

  // ■ オリジナルスタンプ画像の追加
  const handleAddStamp = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      try {
        const token = await user?.getIdToken();
        const form = new FormData();
        form.set('image', file);
        const response = await fetch('/api/teacher/homework/stamp', {
          method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: form,
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok || !data.ok || !data.url) throw new Error(data.error || 'stamp-upload-failed');
        const url = String(data.url);
        
        // リストに追加して選択状態にする
        setCustomStamps(prev => [...prev, { id: `custom_${Date.now()}`, url }]);
        setSelectedStamp(url);
      } catch (err: any) {
        toast.error(err?.message || 'スタンプのアップロードに失敗しました');
      }
    }
  };

  // ■ 合格確定処理
  const submitCheck = async () => {
    if (!checkModal) return;

    setSending(true);
    try {
      const token = await user?.getIdToken();
      const res = await fetch('/api/teacher/homework', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          action: 'review_submission',
          assignment_id: assignmentId,
          submission_id: checkModal.id,
          status: 'checked',
          teacher_comment: teacherComment,
          stamp_url: selectedStamp,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) throw new Error(data.error || 'submission-review-failed');

      // UI更新
      setSubmissions(prev => prev.map(item => 
        item.id === checkModal.id ? { 
          ...item, 
          status: 'checked', 
          teacher_comment: teacherComment,
          stamp_url: selectedStamp
        } : item
      ));

      setCheckModal(null); // 閉じる

    } catch (e) {
      toast.error('エラー: ' + e);
    } finally {
      setSending(false);
    }
  };

  // ■ 再提出 処理 (コメント入力画面を開く)
  const openResubmitModal = (subId: string) => {
    setFeedbackInput({ id: subId, text: '' });
  };

  // 再提出実行
  const submitResubmit = async () => {
    if (!feedbackInput || !feedbackInput.text.trim()) return toast.error('再提出の理由を入力してください');

    setSending(true);
    try {
      const token = await user?.getIdToken();
      const res = await fetch('/api/teacher/homework', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          action: 'review_submission',
          assignment_id: assignmentId,
          submission_id: feedbackInput.id,
          status: 'resubmit',
          feedback: feedbackInput.text,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) throw new Error(data.error || 'submission-review-failed');

      setSubmissions(prev => prev.map(item => 
        item.id === feedbackInput.id ? { ...item, status: 'resubmit', feedback: feedbackInput.text, teacher_comment: null, stamp_url: null } : item
      ));
      
      setFeedbackInput(null);

    } catch (e) {
      toast.error('エラー: ' + e);
    } finally {
      setSending(false);
    }
  };

  const stampButtonClass = (url: string) =>
    `relative aspect-square overflow-hidden rounded-btn border-2 p-1 transition-colors ${selectedStamp === url ? 'border-success bg-success-soft ring-2 ring-success/30' : 'border-line hover:bg-canvas'}`;

  if (loading) {
    return (
      <div className="px-4 py-5 sm:px-6">
        <div className="mx-auto max-w-6xl"><ListSkeleton rows={4} /></div>
      </div>
    );
  }
  if (loadError) {
    return (
      <div className="px-4 py-5 sm:px-6">
        <div className="mx-auto max-w-6xl space-y-6">
          <PageHeader tone="plain" title="提出状況チェック" backHref="/teacher/homework" />
          <ErrorState onRetry={() => { setLoading(true); fetchData(); }} />
        </div>
      </div>
    );
  }
  if (!assignment) {
    return (
      <div className="px-4 py-5 sm:px-6">
        <div className="mx-auto max-w-6xl space-y-6">
          <PageHeader tone="plain" title="提出状況チェック" backHref="/teacher/homework" />
          <EmptyState title="宿題が見つかりません" />
        </div>
      </div>
    );
  }

  return (
    <div className="px-4 py-5 pb-32 sm:px-6">
      <div className="mx-auto max-w-6xl space-y-6">

        {/* ヘッダー */}
        <PageHeader
          tone="plain"
          title={assignment.title}
          description="提出状況チェック"
          backHref="/teacher/homework"
          actions={(
            <span className="cb-card inline-flex min-h-11 items-center px-4 text-sm font-bold text-fg-muted">
              提出数: {submissions.length} 名
            </span>
          )}
        />

        {/* 提出カード一覧 */}
        {submissions.length === 0 ? (
          <EmptyState icon={Inbox} title="まだ提出はありません" />
        ) : (
          <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
            {submissions.map((sub) => (
              <Card key={sub.id} padded={false} className={`flex flex-col overflow-hidden border-2 ${
                sub.status === 'checked' ? 'border-emerald-400' :
                sub.status === 'resubmit' ? 'border-rose-400' : 'border-line'
              }`}>

                {/* ヘッダー */}
                <div className="flex items-center justify-between border-b border-line bg-canvas p-3">
                  <div className="flex items-center gap-2 font-bold text-fg">
                    <User size={16} className="text-slate-400" aria-hidden />
                    {sub.student_name}
                  </div>
                  <div>
                    {sub.status === 'checked' && <StatusPill tone="success">合格</StatusPill>}
                    {sub.status === 'resubmit' && <StatusPill tone="danger">再提出</StatusPill>}
                    {sub.status === 'submitted' && <StatusPill tone="info">未チェック</StatusPill>}
                  </div>
                </div>

                {/* 画像エリア (スタンプがあれば表示) */}
                <div className="group relative aspect-video bg-slate-100">
                  {sub.imageUrl ? (
                    <>
                      <Image
                        src={sub.imageUrl}
                        alt="提出画像"
                        fill
                        className="object-contain"
                        unoptimized
                      />
                      {/* スタンプ表示 */}
                      {sub.stamp_url && (
                        <div className="absolute right-2 top-2 h-16 w-16 rotate-12 drop-shadow-md">
                          <Image src={sub.stamp_url} alt="スタンプ" fill className="object-contain" unoptimized />
                        </div>
                      )}
                      <button
                        type="button"
                        aria-label="画像を拡大"
                        onClick={() => setZoomImage(sub.imageUrl)}
                        className="absolute inset-0 flex items-center justify-center gap-2 bg-black/20 font-bold text-white opacity-0 transition-opacity focus-visible:opacity-100 group-hover:opacity-100"
                      >
                        <ExternalLink size={24} aria-hidden />
                      </button>
                    </>
                  ) : (
                    <div className="flex h-full w-full items-center justify-center text-xs text-slate-400">画像なし</div>
                  )}
                </div>

                {/* コメント・アクションエリア */}
                <div className="flex flex-1 flex-col gap-3 p-4">
                  {sub.comment && (
                    <div className="relative rounded-input bg-info-soft p-2 text-xs text-slate-700">
                      <MessageSquare size={12} className="absolute right-2 top-2 text-info/40" aria-hidden />
                      <span className="mb-1 block font-bold text-info">生徒コメント:</span>
                      {sub.comment}
                    </div>
                  )}

                  {/* 講師のコメント表示 */}
                  {sub.teacher_comment && (
                    <div className="rounded-input border border-success/20 bg-success-soft p-2 text-xs text-emerald-800">
                      <span className="mb-1 flex items-center gap-1 font-bold"><CheckCircle size={12} aria-hidden /> 講師コメント:</span>
                      {sub.teacher_comment}
                    </div>
                  )}

                  {sub.status === 'resubmit' && sub.feedback && (
                    <div className="rounded-input bg-danger-soft p-2 text-xs text-rose-700">
                      <span className="mb-1 block font-bold">再提出理由:</span>
                      {sub.feedback}
                    </div>
                  )}

                  <div className="mt-auto grid grid-cols-2 gap-2 pt-2">
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => openResubmitModal(sub.id)}
                      icon={<RefreshCw size={14} aria-hidden />}
                      className="hover:bg-danger-soft hover:text-danger"
                    >
                      再提出
                    </Button>
                    <Button
                      variant={sub.status === 'checked' ? 'secondary' : 'primary'}
                      size="sm"
                      onClick={() => openCheckModal(sub)}
                      icon={<Stamp size={14} aria-hidden />}
                      className={sub.status === 'checked' ? 'border-success/30 bg-success-soft text-success hover:bg-success-soft' : undefined}
                    >
                      {sub.status === 'checked' ? '修正・コメント' : '合格・スタンプ'}
                    </Button>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>

      {/* 画像拡大モーダル */}
      <Modal open={!!zoomImage} onClose={() => setZoomImage(null)} title="提出画像" size="lg">
        {zoomImage && (
          <div className="relative h-[70vh] w-full">
            <Image src={zoomImage} alt="拡大" fill className="object-contain" unoptimized />
          </div>
        )}
      </Modal>

      {/* ■ 合格・スタンプ付与モーダル */}
      <Modal
        open={!!checkModal}
        onClose={() => setCheckModal(null)}
        title={checkModal ? `${checkModal.student_name} さん` : ''}
        description="スタンプとコメントを送って合格にします"
        size="lg"
        footer={(
          <>
            <Button variant="ghost" onClick={() => setCheckModal(null)}>キャンセル</Button>
            <Button loading={sending} onClick={submitCheck} icon={<Send size={18} aria-hidden />} className="bg-success text-white hover:bg-success/90">
              送信して合格
            </Button>
          </>
        )}
      >
        {checkModal && (
          <div className="flex flex-col gap-6 md:flex-row">
            {/* 左側：画像プレビューとスタンプ配置イメージ */}
            <div className="flex flex-col items-center justify-center rounded-card bg-slate-100 p-4 md:w-1/2">
              <div className="relative h-full min-h-[250px] w-full overflow-hidden rounded-input bg-surface shadow-sm">
                <Image src={checkModal.imageUrl} alt="生徒の提出" fill className="object-contain" unoptimized />
                {/* 選択中のスタンプをオーバーレイ表示 */}
                {selectedStamp && (
                  <div className="absolute right-4 top-4 h-24 w-24 rotate-12 drop-shadow-lg">
                    <Image src={selectedStamp} alt="スタンプ" fill className="object-contain" unoptimized />
                  </div>
                )}
              </div>
              <p className="mt-2 text-center text-xs text-fg-muted">※スタンプは右上に表示されます</p>
            </div>

            {/* 右側：操作パネル */}
            <div className="flex flex-col md:w-1/2">
              {/* スタンプ選択 */}
              <div className="mb-6">
                <label className="mb-2 block text-xs font-bold text-fg-muted">スタンプを選択</label>
                <div className="grid grid-cols-4 gap-2">
                  {/* デフォルトスタンプ */}
                  {DEFAULT_STAMPS.map(stamp => (
                    <button
                      type="button"
                      key={stamp.id}
                      aria-label={`スタンプ ${stamp.id}`}
                      aria-pressed={selectedStamp === stamp.url}
                      onClick={() => setSelectedStamp(stamp.url)}
                      className={stampButtonClass(stamp.url)}
                    >
                      <Image src={stamp.url} alt={stamp.id} fill className="object-contain p-1" unoptimized />
                    </button>
                  ))}

                  {/* 追加されたスタンプ */}
                  {customStamps.map(stamp => (
                    <button
                      type="button"
                      key={stamp.id}
                      aria-label="追加したスタンプ"
                      aria-pressed={selectedStamp === stamp.url}
                      onClick={() => setSelectedStamp(stamp.url)}
                      className={stampButtonClass(stamp.url)}
                    >
                      <Image src={stamp.url} alt={stamp.id} fill className="object-contain p-1" unoptimized />
                    </button>
                  ))}

                  {/* スタンプ追加ボタン */}
                  <button
                    type="button"
                    onClick={() => stampInputRef.current?.click()}
                    className="flex aspect-square flex-col items-center justify-center rounded-btn border-2 border-dashed border-slate-300 text-slate-400 transition-colors hover:border-slate-400 hover:bg-canvas"
                  >
                    <Plus size={20} aria-hidden />
                    <span className="text-xs font-bold">追加</span>
                  </button>
                  <input type="file" ref={stampInputRef} onChange={handleAddStamp} className="hidden" accept="image/*" />
                </div>
              </div>

              {/* コメント入力 */}
              <div className="flex-1">
                <label className="mb-2 block text-xs font-bold text-fg-muted">講師からのコメント (任意)</label>
                <textarea
                  className="h-24 w-full resize-none rounded-input border border-line bg-surface p-3 text-sm outline-none focus:ring-2 focus:ring-success/30"
                  placeholder="よくできました！この調子で頑張ろう！"
                  value={teacherComment}
                  onChange={(e) => setTeacherComment(e.target.value)}
                />
              </div>
            </div>
          </div>
        )}
      </Modal>

      {/* 再提出理由入力モーダル */}
      <Modal
        open={!!feedbackInput}
        onClose={() => setFeedbackInput(null)}
        title="再提出を求める"
        description="理由を入力して返却してください"
        footer={(
          <>
            <Button variant="ghost" onClick={() => setFeedbackInput(null)}>キャンセル</Button>
            <Button variant="danger" loading={sending} onClick={submitResubmit} icon={<Send size={16} aria-hidden />}>
              送信
            </Button>
          </>
        )}
      >
        {feedbackInput && (
          <textarea
            className="h-32 w-full resize-none rounded-input border border-line bg-surface p-3 text-sm outline-none focus:ring-2 focus:ring-danger/30"
            placeholder="例: 画像がぼやけて読めません。もう一度撮影してください。"
            value={feedbackInput.text}
            onChange={(e) => setFeedbackInput({...feedbackInput, text: e.target.value})}
            autoFocus
          />
        )}
      </Modal>
    </div>
  );
}
