'use client';

import { useState, useEffect } from 'react';
import { auth } from '@/lib/firebase';
import {
  Check, ArrowRight, X, Inbox,
  Truck, Package, History, Calendar, RefreshCw
} from 'lucide-react';
import AdminPageHeader from '@/app/components/master/AdminPageHeader';
import AdminTabs from '@/app/components/master/AdminTabs';
import { Button, EmptyState, ErrorState, IconButton, ListSkeleton, StatusPill, useConfirm, useToast, type StatusTone } from '@/app/components/ui';
import { formatDate, formatDateTime } from '@/lib/format';
import { userErrorMessage } from '@/lib/user-error';

// 型定義
interface RequestData {
  id: string;
  type: 'change' | 'exchange' | 'absence' | 'transfer';
  user_id?: string;
  userId?: string;
  status: 'pending' | 'approved' | 'completed' | 'rejected' | 'confirmed' | 'cancelled';
  created_at: any;
  
  // change (新仕様)
  target_day?: string;
  target_science?: string;
  target_social?: string;
  
  // change (旧仕様互換用)
  target_subject_1?: string; // 旧: 社会
  target_subject_2?: string; // 旧: 理科

  reason?: string;
  content?: string;
  target_date?: string;
  absence_date?: string;
  absence_type?: 'absent' | 'late';
  transfer_course_name?: string;
  transfer_subject?: string;
  source?: string;
  transfer_status?: string | null;
  transfer_selection_mode?: string | null;
  
  // exchange
  userName?: string;
  rewardName?: string;
  cost?: number;

  // 結合データ
  profiles?: any; 
}

const SOURCE_LABELS: Record<string, string> = { parent_portal: '保護者から', student_portal: '生徒から' };

/** 欠席・振替の連絡は「完了済み」ではなく、振替の進み具合で表示する。 */
const attendanceStatusLabel = (req: RequestData): { label: string; tone: StatusTone } => {
  if (req.status === 'cancelled' || req.status === 'rejected') return { label: '取り消し', tone: 'neutral' };
  if (req.type === 'transfer') return { label: '振替 確定', tone: 'info' };
  if (req.absence_type === 'late') return { label: '遅刻 連絡済み', tone: 'warning' };
  if (req.transfer_status === 'registered') return { label: '振替 登録済み', tone: 'info' };
  if (req.transfer_status === 'waiting_student_selection' || req.transfer_selection_mode === 'student') {
    return { label: '振替 未選択（生徒が選ぶ）', tone: 'danger' };
  }
  return { label: '振替 未定', tone: 'warning' };
};

const isAttendanceNotice = (req: RequestData) => req.type === 'absence' || req.type === 'transfer';
/** 未対応タブの件数と一覧で同じ条件を使う（欠席・振替の連絡は含めない）。 */
const isPendingRequest = (req: RequestData) => !isAttendanceNotice(req) && req.status === 'pending';

export default function MasterRequestsPage() {
  const [requests, setRequests] = useState<RequestData[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'pending' | 'attendance' | 'history'>('pending');
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [canProcess, setCanProcess] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [actionError, setActionError] = useState('');
  const toast = useToast();
  const confirm = useConfirm();

  useEffect(() => {
    fetchRequests();
  }, []);

  const fetchRequests = async () => {
    setLoading(true);
    setLoadError('');
    try {
      const token = await auth.currentUser?.getIdToken();
      const response = await fetch('/api/admin/requests', { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || '申請を取得できませんでした');
      setRequests(data.requests || []);
      setCanProcess(data.can_process === true);
    } catch (e: any) {
      console.error(e);
      setLoadError(e?.message || '申請を取得できませんでした');
    } finally {
      setLoading(false);
    }
  };

  const processRequest = async (requestId: string, action: 'approve_change' | 'complete_exchange' | 'reject') => {
    const token = await auth.currentUser?.getIdToken();
    const response = await fetch('/api/admin/requests', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ request_id: requestId, action }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || '申請を処理できませんでした');
    return data;
  };

  // ---------------------------------------------------------
  // 1. 変更申請の承認（科目・曜日更新）
  // ---------------------------------------------------------
  const handleApproveChange = async (req: RequestData) => {
    const studentName = req.profiles?.student_name || '生徒';
    if (!(await confirm({ title: `${studentName}さんの変更を承認しますか？`, message: 'プロフィールとURLが更新されます。', confirmLabel: '承認して更新' }))) return;

    setProcessingId(req.id);
    try {
      await processRequest(req.id, 'approve_change');
      toast.success('承認しました。プロフィールとURLを更新しました。');

      setRequests(prev => prev.map(r => r.id === req.id ? { ...r, status: 'approved' } : r));

    } catch (e: any) {
      console.error(e);
      toast.error(`承認できませんでした: ${userErrorMessage(e, '')}`);
    } finally {
      setProcessingId(null);
    }
  };

  // ---------------------------------------------------------
  // 2. 景品交換の承認
  // ---------------------------------------------------------
  const handleApproveExchange = async (req: RequestData) => {
    const studentName = req.profiles?.student_name || req.userName || '生徒';
    if (!(await confirm({ title: `「${studentName}」さんの「${req.rewardName}」を配送済み（完了）にしますか？`, confirmLabel: '配送済にする' }))) return;

    setProcessingId(req.id);
    setActionError('');
    try {
      await processRequest(req.id, 'complete_exchange');
      setRequests(prev => prev.map(r => r.id === req.id ? { ...r, status: 'completed' } : r));
    } catch (error: any) {
      console.error(error);
      const message = error?.message || '配送済みにできませんでした';
      setActionError(`「${studentName}」さんの景品交換を完了できませんでした: ${message}`);
    } finally { setProcessingId(null); }
  };

  // ---------------------------------------------------------
  // 3. 却下処理
  // ---------------------------------------------------------
  const handleReject = async (req: RequestData) => {
    const isExchange = req.type === 'exchange';
    const studentName = req.profiles?.student_name || req.userName || '生徒';
    const ok = await confirm({
      title: isExchange ? `「${studentName}」さんの「${req.rewardName}」の交換申請を却下しますか？` : `「${studentName}」さんの変更申請を却下しますか？`,
      message: isExchange ? `却下すると${req.cost}コインを返金します。` : undefined,
      confirmLabel: '却下する',
      tone: 'danger',
    });
    if (!ok) return;

    setProcessingId(req.id);
    try {
      await processRequest(req.id, 'reject');
      setRequests(prev => prev.map(r => r.id === req.id ? { ...r, status: 'rejected' } : r));
      if (isExchange) toast.success('申請を却下し、コインを返還しました');
    } catch (e: any) { console.error(e); toast.error(`却下できませんでした: ${userErrorMessage(e, '')}`); } finally { setProcessingId(null); }
  };

  const filteredRequests = requests.filter(r => {
    if (activeTab === 'attendance') return isAttendanceNotice(r);
    if (activeTab === 'pending') return isPendingRequest(r);
    return !isAttendanceNotice(r) && r.status !== 'pending';
  });

  return (
    <div className="font-sans text-slate-800">
      <div>
        <AdminPageHeader
          actions={<Button variant="secondary" icon={<RefreshCw size={16} aria-hidden />} onClick={fetchRequests} loading={loading}>再読み込み</Button>}
        />

        <AdminTabs
          className="mb-6"
          ariaLabel="申請の種類"
          urlParam="tab"
          value={activeTab}
          onChange={setActiveTab}
          tabs={[
            { id: 'pending', icon: Inbox, label: <>未対応 ({requests.filter(isPendingRequest).length})</> },
            { id: 'attendance', icon: Calendar, label: <>欠席・遅刻・振替 ({requests.filter(isAttendanceNotice).length})</> },
            { id: 'history', icon: History, label: '履歴' },
          ]}
        />

        {actionError && (
          <div role="alert" className="mb-4 flex items-start justify-between gap-3 rounded-card border border-rose-200 bg-rose-50 p-4 text-sm font-bold text-rose-700">
            <span>{actionError}</span>
            <IconButton label="エラーを閉じる" size="sm" onClick={() => setActionError('')} className="shrink-0 text-rose-400 hover:text-rose-600"><X size={16} aria-hidden /></IconButton>
          </div>
        )}

        <div className="space-y-4">
          {loading ? (
            <ListSkeleton rows={4} />
          ) : loadError ? (
            <ErrorState title="申請を読み込めませんでした" message={loadError} onRetry={fetchRequests} />
          ) : filteredRequests.length === 0 ? (
            <EmptyState
              title={activeTab === 'pending' ? '未対応の申請はありません' : activeTab === 'attendance' ? '欠席・遅刻・振替の連絡はありません' : '履歴はありません'}
            />
          ) : (
            filteredRequests.map(req => {
              const isExchange = req.type === 'exchange';
              const isAttendance = isAttendanceNotice(req);
              const studentName = req.profiles?.student_name || req.userName || '不明な生徒';
              const grade = req.profiles?.grade || '';

              // ★修正: 新旧フィールドの両方をチェックして値を決定
              const reqDay = req.target_day;
              const reqScience = req.target_science || req.target_subject_2;
              const reqSocial = req.target_social || req.target_subject_1;

              // 現在の値（DB）と申請値が違う場合のみ強調表示するためのフラグ
              const isDayChanged = reqDay && reqDay !== req.profiles?.day_of_week;
              const isScienceChanged = reqScience && reqScience !== req.profiles?.subject_science;
              const isSocialChanged = reqSocial && reqSocial !== req.profiles?.subject_social;

              return (
                <div key={req.id} className={`bg-white p-6 rounded-card shadow-sm border-2 transition-all hover:shadow-md ${
                  isAttendance ? 'border-amber-100' : isExchange ? 'border-amber-100' : 'border-accent/20'
                }`}>
                  <div className="flex flex-col md:flex-row gap-6 justify-between items-start">
                    
                    <div className="flex items-start gap-4 flex-1">
                      <div className={`p-4 rounded-btn shrink-0 ${
                        isExchange ? 'bg-amber-100 text-amber-600' : 'bg-accent-soft text-accent'
                      }`}>
                        {isExchange ? <Package size={28} /> : <Calendar size={28} />}
                      </div>

                      <div className="flex-1">
                        <div className="flex flex-wrap items-center gap-2 mb-2">
                          <StatusPill tone={isExchange ? 'warning' : 'accent'}>
                            {isExchange ? '景品交換' : req.type === 'transfer' ? '振替確定' : req.type === 'absence' ? (req.absence_type === 'late' ? '遅刻連絡' : '欠席連絡') : '変更申請'}
                          </StatusPill>
                          <span className="text-xs text-slate-400">
                            {req.created_at?.toDate ? formatDateTime(req.created_at, { withYear: true }) : formatDate(req.created_at, { withYear: true })}
                          </span>
                          {isAttendance && (() => {
                            const badge = attendanceStatusLabel(req);
                            return <StatusPill tone={badge.tone}>{badge.label}</StatusPill>;
                          })()}
                          {isAttendance && req.source && SOURCE_LABELS[req.source] && (
                            <StatusPill>{SOURCE_LABELS[req.source]}</StatusPill>
                          )}
                          {!isAttendance && req.status !== 'pending' && (
                            <StatusPill tone={req.status === 'completed' || req.status === 'approved' ? 'success' : 'danger'}>
                              {req.status === 'rejected' ? '却下済み' : '完了済み'}
                            </StatusPill>
                          )}
                        </div>

                        <h3 className="text-lg font-bold text-slate-800 mb-3 flex items-center gap-2">
                          {studentName} 
                          <span className="text-xs font-normal text-slate-500 bg-slate-100 px-2 py-0.5 rounded-full">{grade}</span>
                        </h3>

                        {isExchange && (
                          <div className="bg-amber-50 p-4 rounded-btn border border-amber-200">
                            <div className="flex items-center gap-2 text-amber-800 font-bold mb-1">
                              <Package size={16}/> 交換アイテム
                            </div>
                            <div className="text-xl font-bold text-slate-800 mb-1">{req.rewardName}</div>
                            <div className="text-xs text-amber-700 font-bold">消費コイン: {req.cost}コイン</div>
                          </div>
                        )}

                        {isAttendance && (
                          <div className="rounded-btn border border-amber-200 bg-amber-50 p-4 text-sm font-bold text-amber-950">
                            <p><span className="text-xs text-amber-600">対象日：</span>{req.type === 'transfer' ? `${req.absence_date || '-'} → ${req.target_date || '-'}` : req.target_date || '-'}</p>
                            {req.type === 'transfer' && <p className="mt-2"><span className="text-xs text-amber-600">振替先：</span>{[req.transfer_subject, req.transfer_course_name].filter(Boolean).join(' / ') || '詳細未設定'}</p>}
                            <p className="mt-2 whitespace-pre-wrap"><span className="text-xs text-amber-600">連絡内容：</span>{req.reason || req.content || '記載なし'}</p>
                            <p className="mt-2 text-xs text-slate-500">校舎：{req.profiles?.school_name || req.profiles?.school || req.profiles?.school_id || '未設定'}</p>
                          </div>
                        )}

                        {!isExchange && !isAttendance && (
                          <div className="bg-slate-50 p-4 rounded-btn border border-line space-y-3">
                            <div className="flex items-center gap-3 text-sm">
                              <span className="text-accent font-bold w-12 text-xs">曜日</span>
                              <div className="flex items-center gap-2 bg-white px-3 py-1.5 rounded-btn border border-accent/20 shadow-sm">
                                <span className="text-slate-400 line-through">{req.profiles?.day_of_week || '-'}</span>
                                <ArrowRight size={14} className="text-accent/60"/>
                                <span className={`font-bold ${isDayChanged ? 'text-accent' : 'text-slate-400'}`}>
                                  {reqDay || '変更なし'}
                                </span>
                              </div>
                            </div>

                            <div className="flex items-center gap-3 text-sm">
                              <span className="text-emerald-700 font-bold w-12 text-xs">理科</span>
                              <div className="flex items-center gap-2 bg-white px-3 py-1.5 rounded-btn border border-emerald-100 shadow-sm">
                                <span className="text-slate-400 line-through">{req.profiles?.subject_science || '-'}</span>
                                <ArrowRight size={14} className="text-emerald-400"/>
                                {/* ★修正: 新旧フィールドどちらかを表示 */}
                                <span className={`font-bold ${isScienceChanged ? 'text-emerald-700' : 'text-slate-400'}`}>
                                  {reqScience || '変更なし'}
                                </span>
                              </div>
                            </div>

                            <div className="flex items-center gap-3 text-sm">
                              <span className="text-amber-700 font-bold w-12 text-xs">社会</span>
                              <div className="flex items-center gap-2 bg-white px-3 py-1.5 rounded-btn border border-amber-100 shadow-sm">
                                <span className="text-slate-400 line-through">{req.profiles?.subject_social || '-'}</span>
                                <ArrowRight size={14} className="text-amber-400"/>
                                {/* ★修正: 新旧フィールドどちらかを表示 */}
                                <span className={`font-bold ${isSocialChanged ? 'text-amber-700' : 'text-slate-400'}`}>
                                  {reqSocial || '変更なし'}
                                </span>
                              </div>
                            </div>

                            {req.reason && (
                              <div className="pt-2 border-t border-line text-xs text-slate-700">
                                <span className="font-bold mr-1">理由:</span> {req.reason}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    </div>

                    {canProcess && !isAttendance && req.status === 'pending' && (
                      <div className="flex flex-row md:flex-col gap-3 shrink-0 w-full md:w-auto mt-4 md:mt-0">
                        {isExchange ? (
                          <Button
                            onClick={() => handleApproveExchange(req)}
                            disabled={!!processingId}
                            loading={processingId === req.id}
                            icon={<Truck size={18} aria-hidden />}
                            className="w-full md:w-40"
                          >
                            配送済にする
                          </Button>
                        ) : (
                          <Button
                            onClick={() => handleApproveChange(req)}
                            disabled={!!processingId}
                            loading={processingId === req.id}
                            icon={<Check size={18} aria-hidden />}
                            className="w-full md:w-40"
                          >
                            承認して更新
                          </Button>
                        )}
                        
                        <Button
                          variant="danger"
                          onClick={() => handleReject(req)}
                          disabled={!!processingId}
                          icon={<X size={16} aria-hidden />}
                          className="w-full md:w-40"
                        >
                          却下する
                        </Button>
                      </div>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
