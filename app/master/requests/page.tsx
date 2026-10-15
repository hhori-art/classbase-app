'use client';

import { useState, useEffect } from 'react';
import { auth } from '@/lib/firebase';
import { 
  FileCheck, ArrowLeft, Check, ArrowRight, X, Loader2, 
  Truck, Package, History, User, Calendar
} from 'lucide-react';
import Link from 'next/link';

// 型定義
interface RequestData {
  id: string;
  type: 'change' | 'exchange' | 'absence' | 'transfer';
  user_id?: string;
  userId?: string;
  status: 'pending' | 'approved' | 'completed' | 'rejected';
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
  
  // exchange
  userName?: string;
  rewardName?: string;
  cost?: number;

  // 結合データ
  profiles?: any; 
}

export default function MasterRequestsPage() {
  const [requests, setRequests] = useState<RequestData[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'pending' | 'attendance' | 'history'>('pending');
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [canProcess, setCanProcess] = useState(false);

  useEffect(() => {
    fetchRequests();
  }, []);

  const fetchRequests = async () => {
    setLoading(true);
    try {
      const token = await auth.currentUser?.getIdToken();
      const response = await fetch('/api/admin/requests', { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || '申請を取得できませんでした');
      setRequests(data.requests || []);
      setCanProcess(data.can_process === true);
    } catch (e) {
      console.error(e);
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
    if (!confirm(`${studentName}さんの変更を承認しますか？\n(プロフィールとURLが更新されます)`)) return;
      
    setProcessingId(req.id);
    try {
      await processRequest(req.id, 'approve_change');
      alert('承認しました。プロフィールとURLを更新しました。');
      
      setRequests(prev => prev.map(r => r.id === req.id ? { ...r, status: 'approved' } : r));

    } catch (e: any) {
      console.error(e);
      alert('エラー: ' + e.message);
    } finally {
      setProcessingId(null);
    }
  };

  // ---------------------------------------------------------
  // 2. 景品交換の承認
  // ---------------------------------------------------------
  const handleApproveExchange = async (req: RequestData) => {
    const studentName = req.profiles?.student_name || req.userName || '生徒';
    if (!confirm(`「${studentName}」さんの「${req.rewardName}」を配送済み（完了）にしますか？`)) return;
    
    setProcessingId(req.id);
    try {
      await processRequest(req.id, 'complete_exchange');
      setRequests(prev => prev.map(r => r.id === req.id ? { ...r, status: 'completed' } : r));
    } catch (error) { console.error(error); } finally { setProcessingId(null); }
  };

  // ---------------------------------------------------------
  // 3. 却下処理
  // ---------------------------------------------------------
  const handleReject = async (req: RequestData) => {
    const isExchange = req.type === 'exchange';
    const msg = isExchange 
      ? `この申請を却下して、${req.cost}コインを返金しますか？`
      : 'この申請を却下しますか？';

    if (!confirm(msg)) return;

    setProcessingId(req.id);
    try {
      await processRequest(req.id, 'reject');
      setRequests(prev => prev.map(r => r.id === req.id ? { ...r, status: 'rejected' } : r));
      if (isExchange) alert('申請を却下し、コインを返還しました');

    } catch (e: any) { alert('エラー: ' + e.message); } finally { setProcessingId(null); }
  };

  const filteredRequests = requests.filter(r => {
    const attendanceNotice = r.type === 'absence' || r.type === 'transfer';
    if (activeTab === 'attendance') return attendanceNotice;
    if (activeTab === 'pending') return !attendanceNotice && r.status === 'pending';
    return !attendanceNotice && r.status !== 'pending';
  });

  return (
    <div className="min-h-screen bg-gray-50 p-8 pb-32 font-sans text-slate-800">
      <div className="max-w-5xl mx-auto">
        <div className="flex items-center gap-4 mb-8">
          <Link href="/master" className="bg-white p-3 rounded-full shadow-sm text-gray-500 hover:text-gray-800 transition-colors">
            <ArrowLeft size={20} />
          </Link>
          <h1 className="text-2xl font-bold text-gray-800 flex items-center gap-2">
            <FileCheck className="text-cyan-600" /> 
            承認・申請管理
          </h1>
        </div>

        {/* タブ */}
        <div className="flex bg-white p-1 rounded-xl shadow-sm border border-gray-100 mb-6 w-fit">
          <button
            onClick={() => setActiveTab('pending')}
            className={`px-6 py-2 rounded-lg text-sm font-bold flex items-center gap-2 transition-all ${
              activeTab === 'pending' ? 'bg-cyan-100 text-cyan-700' : 'text-gray-400 hover:bg-gray-50'
            }`}
          >
            <Loader2 size={16} className={activeTab === 'pending' ? 'animate-spin-slow' : ''}/>
            未対応 ({requests.filter(r => r.status === 'pending').length})
          </button>
          <button
            onClick={() => setActiveTab('attendance')}
            className={`px-6 py-2 rounded-lg text-sm font-bold flex items-center gap-2 transition-all ${
              activeTab === 'attendance' ? 'bg-orange-500 text-white' : 'text-gray-400 hover:bg-gray-50'
            }`}
          >
            <Calendar size={16} />
            欠席・遅刻・振替 ({requests.filter(r => r.type === 'absence' || r.type === 'transfer').length})
          </button>
          <button
            onClick={() => setActiveTab('history')}
            className={`px-6 py-2 rounded-lg text-sm font-bold flex items-center gap-2 transition-all ${
              activeTab === 'history' ? 'bg-gray-800 text-white' : 'text-gray-400 hover:bg-gray-50'
            }`}
          >
            <History size={16} />
            履歴
          </button>
        </div>

        <div className="space-y-4">
          {loading ? (
            <div className="text-center py-20"><Loader2 className="animate-spin inline text-cyan-500" /></div>
          ) : filteredRequests.length === 0 ? (
            <div className="text-center py-20 bg-white rounded-2xl border border-dashed border-gray-200 text-gray-400">
              {activeTab === 'pending' ? '未対応の申請はありません 🎉' : activeTab === 'attendance' ? '欠席・遅刻・振替の連絡はありません' : '履歴はありません'}
            </div>
          ) : (
            filteredRequests.map(req => {
              const isExchange = req.type === 'exchange';
              const isAttendanceNotice = req.type === 'absence' || req.type === 'transfer';
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
                <div key={req.id} className={`bg-white p-6 rounded-2xl shadow-sm border-2 transition-all hover:shadow-md ${
                  isAttendanceNotice ? 'border-orange-100' : isExchange ? 'border-yellow-100' : 'border-cyan-100'
                }`}>
                  <div className="flex flex-col md:flex-row gap-6 justify-between items-start">
                    
                    <div className="flex items-start gap-4 flex-1">
                      <div className={`p-4 rounded-2xl shrink-0 ${
                        isExchange ? 'bg-yellow-100 text-yellow-600' : 'bg-cyan-100 text-cyan-600'
                      }`}>
                        {isExchange ? <Package size={28} /> : <Calendar size={28} />}
                      </div>

                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-2">
                          <span className={`text-[10px] font-bold px-2 py-0.5 rounded text-white ${
                            isExchange ? 'bg-yellow-500' : 'bg-cyan-500'
                          }`}>
                            {isExchange ? '景品交換' : req.type === 'transfer' ? '振替確定' : req.type === 'absence' ? (req.absence_type === 'late' ? '遅刻連絡' : '欠席連絡') : '変更申請'}
                          </span>
                          <span className="text-xs text-gray-400">
                            {req.created_at?.toDate ? req.created_at.toDate().toLocaleString() : new Date(req.created_at).toLocaleDateString()}
                          </span>
                          {req.status !== 'pending' && (
                            <span className={`text-xs font-bold px-2 py-0.5 rounded ${
                              req.status === 'completed' || req.status === 'approved' 
                                ? 'bg-blue-100 text-blue-600' 
                                : 'bg-red-100 text-red-600'
                            }`}>
                              {req.status === 'rejected' ? '却下済み' : '完了済み'}
                            </span>
                          )}
                        </div>

                        <h3 className="text-lg font-bold text-gray-800 mb-3 flex items-center gap-2">
                          {studentName} 
                          <span className="text-xs font-normal text-gray-500 bg-gray-100 px-2 py-0.5 rounded-full">{grade}</span>
                        </h3>

                        {isExchange && (
                          <div className="bg-yellow-50 p-4 rounded-xl border border-yellow-200">
                            <div className="flex items-center gap-2 text-yellow-800 font-bold mb-1">
                              <Package size={16}/> 交換アイテム
                            </div>
                            <div className="text-xl font-black text-gray-800 mb-1">{req.rewardName}</div>
                            <div className="text-xs text-yellow-700 font-bold">消費コイン: {req.cost} coin</div>
                          </div>
                        )}

                        {isAttendanceNotice && (
                          <div className="rounded-xl border border-orange-200 bg-orange-50 p-4 text-sm font-bold text-orange-950">
                            <p><span className="text-xs text-orange-600">対象日：</span>{req.type === 'transfer' ? `${req.absence_date || '-'} → ${req.target_date || '-'}` : req.target_date || '-'}</p>
                            {req.type === 'transfer' && <p className="mt-2"><span className="text-xs text-orange-600">振替先：</span>{[req.transfer_subject, req.transfer_course_name].filter(Boolean).join(' / ') || '詳細未設定'}</p>}
                            <p className="mt-2 whitespace-pre-wrap"><span className="text-xs text-orange-600">連絡内容：</span>{req.reason || req.content || '記載なし'}</p>
                            <p className="mt-2 text-xs text-slate-500">校舎：{req.profiles?.school_name || req.profiles?.school || req.profiles?.school_id || '未設定'}</p>
                          </div>
                        )}

                        {!isExchange && !isAttendanceNotice && (
                          <div className="bg-cyan-50 p-4 rounded-xl border border-cyan-200 space-y-3">
                            <div className="flex items-center gap-3 text-sm">
                              <span className="text-cyan-700 font-bold w-12 text-xs uppercase tracking-wider">Day</span>
                              <div className="flex items-center gap-2 bg-white px-3 py-1.5 rounded-lg border border-cyan-100 shadow-sm">
                                <span className="text-gray-400 line-through">{req.profiles?.day_of_week || '-'}</span>
                                <ArrowRight size={14} className="text-cyan-400"/>
                                <span className={`font-bold ${isDayChanged ? 'text-cyan-700' : 'text-gray-400'}`}>
                                  {reqDay || '変更なし'}
                                </span>
                              </div>
                            </div>

                            <div className="flex items-center gap-3 text-sm">
                              <span className="text-emerald-700 font-bold w-12 text-xs uppercase tracking-wider">Science</span>
                              <div className="flex items-center gap-2 bg-white px-3 py-1.5 rounded-lg border border-emerald-100 shadow-sm">
                                <span className="text-gray-400 line-through">{req.profiles?.subject_science || '-'}</span>
                                <ArrowRight size={14} className="text-emerald-400"/>
                                {/* ★修正: 新旧フィールドどちらかを表示 */}
                                <span className={`font-bold ${isScienceChanged ? 'text-emerald-700' : 'text-gray-400'}`}>
                                  {reqScience || '変更なし'}
                                </span>
                              </div>
                            </div>

                            <div className="flex items-center gap-3 text-sm">
                              <span className="text-orange-700 font-bold w-12 text-xs uppercase tracking-wider">Social</span>
                              <div className="flex items-center gap-2 bg-white px-3 py-1.5 rounded-lg border border-orange-100 shadow-sm">
                                <span className="text-gray-400 line-through">{req.profiles?.subject_social || '-'}</span>
                                <ArrowRight size={14} className="text-orange-400"/>
                                {/* ★修正: 新旧フィールドどちらかを表示 */}
                                <span className={`font-bold ${isSocialChanged ? 'text-orange-700' : 'text-gray-400'}`}>
                                  {reqSocial || '変更なし'}
                                </span>
                              </div>
                            </div>

                            {req.reason && (
                              <div className="pt-2 border-t border-cyan-200/50 text-xs text-cyan-800">
                                <span className="font-bold mr-1">理由:</span> {req.reason}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    </div>

                    {canProcess && !isAttendanceNotice && req.status === 'pending' && (
                      <div className="flex flex-row md:flex-col gap-3 shrink-0 w-full md:w-auto mt-4 md:mt-0">
                        {isExchange ? (
                          <button 
                            onClick={() => handleApproveExchange(req)} 
                            disabled={!!processingId}
                            className="w-full md:w-40 bg-green-600 text-white px-4 py-3 rounded-xl font-bold text-sm hover:bg-green-700 shadow-md shadow-green-100 transition-all active:scale-95 flex items-center justify-center gap-2"
                          >
                            {processingId === req.id ? <Loader2 className="animate-spin" size={18}/> : <Truck size={18}/>}
                            配送済にする
                          </button>
                        ) : (
                          <button 
                            onClick={() => handleApproveChange(req)} 
                            disabled={!!processingId}
                            className="w-full md:w-40 bg-cyan-600 text-white px-4 py-3 rounded-xl font-bold text-sm hover:bg-cyan-700 shadow-md shadow-cyan-100 transition-all active:scale-95 flex items-center justify-center gap-2"
                          >
                            {processingId === req.id ? <Loader2 className="animate-spin" size={18}/> : <Check size={18}/>}
                            承認して更新
                          </button>
                        )}
                        
                        <button 
                          onClick={() => handleReject(req)} 
                          disabled={!!processingId}
                          className="w-full md:w-40 bg-white border-2 border-gray-100 text-gray-400 hover:text-red-500 hover:bg-red-50 hover:border-red-100 px-4 py-3 rounded-xl transition-all text-xs font-bold flex items-center justify-center gap-2"
                        >
                          <X size={16}/> 却下する
                        </button>
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
