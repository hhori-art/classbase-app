'use client';

import { useState, useEffect } from 'react';
import { db } from '@/lib/firebase';
import { 
  collection, 
  query, 
  getDocs, 
  doc, 
  getDoc, 
  writeBatch, 
  orderBy,
  updateDoc,
  increment,
  serverTimestamp
} from 'firebase/firestore';
import { 
  FileCheck, ArrowLeft, Check, ArrowRight, X, Loader2, AlertCircle, 
  Truck, Package, User, Clock, History, CheckCircle
} from 'lucide-react';
import Link from 'next/link';

// リクエストデータの型定義
interface RequestData {
  student_name: any;
  id: string;
  type: 'change' | 'absence' | 'exchange' | string;
  user_id?: string; // change/absence用
  userId?: string;  // exchange用 (表記ゆれ吸収)
  status: 'pending' | 'approved' | 'completed' | 'rejected';
  created_at: any;
  
  // change (変更申請) 用
  target_day?: string;
  target_science?: string;
  target_social?: string;
  reason?: string;
  
  // absence (欠席) 用
  target_date?: string;

  // exchange (景品交換) 用
  userName?: string; // 申請時に保存された名前（"生徒"になっている可能性がある）
  rewardName?: string;
  cost?: number;

  // 結合データ (ユーザー情報)
  profiles?: any; 
}

export default function MasterRequestsPage() {
  const [requests, setRequests] = useState<RequestData[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'pending' | 'history'>('pending');
  const [processingId, setProcessingId] = useState<string | null>(null);

  useEffect(() => {
    fetchRequests();
  }, []);

  const fetchRequests = async () => {
    setLoading(true);
    try {
      // 全てのリクエストを取得（日付順）
      const q = query(collection(db, 'requests'), orderBy('created_at', 'desc'));
      const querySnapshot = await getDocs(q);

      // ユーザー情報を結合
      const requestsData = await Promise.all(querySnapshot.docs.map(async (reqDoc) => {
        const reqData = reqDoc.data();
        let profiles = {};
        
        // user_id または userId からユーザー情報を取得
        const uid = reqData.user_id || reqData.userId;
        if (uid) {
          const userSnap = await getDoc(doc(db, 'users', uid));
          if (userSnap.exists()) {
            profiles = userSnap.data();
          }
        }
        
        return {
          id: reqDoc.id,
          ...reqData,
          profiles
        } as RequestData;
      }));
      
      setRequests(requestsData);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  // ---------------------------------------------------------
  // 1. 科目変更・欠席申請の承認処理
  // ---------------------------------------------------------
  const handleApproveChange = async (req: any) => {
    // ★修正: プロフィール情報の名前を優先的に使用する
    const studentName = req.profiles?.student_name || req.student_name || '生徒';
    
    // ▼ 科目変更の場合（自動更新ロジック）
    if (req.type === 'change') {
      if (!confirm(`${studentName}さんの変更を承認しますか？\n(URLと科目が自動更新されます)`)) return;
      
      setProcessingId(req.id);
      try {
        const batch = writeBatch(db);
        const updates: any = {};
        
        // 変更後の曜日（指定がなければ元のまま）
        const targetDay = req.target_day || req.profiles?.day_of_week;
        
        // 基本情報の更新
        if (req.target_day) updates.day_of_week = req.target_day;
        updates.updated_at = new Date().toISOString();

        // 理科の更新 & URL自動取得
        if (req.target_science) {
          updates.science_subject = req.target_science;
          const scienceKey = `${req.target_science}_${targetDay}`;
          const scienceSnap = await getDoc(doc(db, 'subject_urls', scienceKey));
          if (scienceSnap.exists()) updates.science_url = scienceSnap.data().url;
        }

        // 社会の更新 & URL自動取得
        if (req.target_social) {
          updates.social_subject = req.target_social;
          const socialKey = `${req.target_social}_${targetDay}`;
          const socialSnap = await getDoc(doc(db, 'subject_urls', socialKey));
          if (socialSnap.exists()) updates.social_url = socialSnap.data().url;
        }

        // ユーザープロフィールの更新
        const uid = req.user_id || req.userId;
        const userRef = doc(db, 'users', uid);
        batch.update(userRef, updates);

        // 申請ステータス更新
        const reqRef = doc(db, 'requests', req.id);
        batch.update(reqRef, { status: 'approved', processed_at: new Date().toISOString() });

        await batch.commit();
        alert('承認しました。データが更新されました。');
        
        // ローカル更新
        setRequests(prev => prev.map(r => r.id === req.id ? { ...r, status: 'approved' } : r));

      } catch (e: any) {
        console.error(e);
        alert('エラー: ' + e.message);
      } finally {
        setProcessingId(null);
      }

    // ▼ 欠席連絡などの単なる確認完了
    } else {
      setProcessingId(req.id);
      try {
        await updateDoc(doc(db, 'requests', req.id), { status: 'approved', processed_at: new Date().toISOString() });
        setRequests(prev => prev.map(r => r.id === req.id ? { ...r, status: 'approved' } : r));
      } catch (e) { console.error(e); } finally { setProcessingId(null); }
    }
  };

  // ---------------------------------------------------------
  // 2. 景品交換リクエストの承認（配送完了）処理
  // ---------------------------------------------------------
  const handleApproveExchange = async (req: any) => {
    // ★修正: プロフィール情報の名前を優先的に使用する
    const studentName = req.profiles?.student_name || req.userName || '生徒';
    if (!confirm(`「${studentName}」さんの「${req.rewardName}」を配送済み（完了）にしますか？`)) return;
    
    setProcessingId(req.id);
    try {
      await updateDoc(doc(db, 'requests', req.id), {
        status: 'completed',
        updated_at: serverTimestamp()
      });
      
      setRequests(prev => prev.map(r => r.id === req.id ? { ...r, status: 'completed' } : r));
      alert('処理を完了しました');
    } catch (error) {
      console.error(error);
      alert('エラーが発生しました');
    } finally {
      setProcessingId(null);
    }
  };

  // ---------------------------------------------------------
  // 3. 却下処理（共通：交換の場合は返金もする）
  // ---------------------------------------------------------
  const handleReject = async (req: any) => {
    const isExchange = req.type === 'exchange';
    const msg = isExchange 
      ? `この申請を却下して、${req.cost}コインを返金しますか？`
      : 'この申請を却下しますか？';

    if (!confirm(msg)) return;

    setProcessingId(req.id);
    try {
      const batch = writeBatch(db);
      
      // ステータス更新
      const reqRef = doc(db, 'requests', req.id);
      batch.update(reqRef, { 
        status: 'rejected', 
        processed_at: new Date().toISOString() 
      });

      // 交換申請ならコイン返金
      if (isExchange) {
        const uid = req.userId || req.user_id;
        const userRef = doc(db, 'users', uid);
        batch.update(userRef, { coins: increment(req.cost) });
      }

      await batch.commit();
      setRequests(prev => prev.map(r => r.id === req.id ? { ...r, status: 'rejected' } : r));
      
      if (isExchange) alert('申請を却下し、コインを返還しました');

    } catch (e: any) {
      alert('エラー: ' + e.message);
    } finally {
      setProcessingId(null);
    }
  };

  // タブ切り替え用のフィルタリング
  const filteredRequests = requests.filter(r => {
    if (activeTab === 'pending') return r.status === 'pending';
    return r.status !== 'pending'; // approved, completed, rejected
  });

  return (
    <div className="min-h-screen bg-gray-50 p-8 pb-32">
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
            <Clock size={16} />
            未対応 ({requests.filter(r => r.status === 'pending').length})
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
              {activeTab === 'pending' ? '現在、未対応の申請はありません' : '履歴はありません'}
            </div>
          ) : (
            filteredRequests.map(req => {
              const isExchange = req.type === 'exchange';
              const isChange = req.type === 'change';
              const isAbsence = req.type === 'absence';
              
              // ★修正: 一覧表示部分でもプロフィール情報を優先
              const studentName = req.profiles?.student_name || req.userName || req.student_name || '不明な生徒';
              const grade = req.profiles?.grade || '';

              return (
                <div key={req.id} className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100 hover:border-cyan-200 transition-all">
                  <div className="flex flex-col md:flex-row gap-4 justify-between">
                    
                    {/* 左側: アイコンと基本情報 */}
                    <div className="flex items-start gap-4">
                      {/* アイコン */}
                      <div className={`p-3 rounded-full shrink-0 ${
                        isExchange ? 'bg-yellow-100 text-yellow-600' : 
                        isChange ? 'bg-blue-100 text-blue-600' : 
                        isAbsence ? 'bg-red-100 text-red-600' : 'bg-gray-100'
                      }`}>
                        {isExchange ? <Package size={24} /> : 
                         isChange ? <FileCheck size={24} /> : 
                         isAbsence ? <AlertCircle size={24} /> : <CheckCircle size={24} />}
                      </div>

                      <div>
                        {/* ラベルと日付 */}
                        <div className="flex items-center gap-2 mb-1">
                          <span className={`text-[10px] font-bold px-2 py-0.5 rounded text-white ${
                            isExchange ? 'bg-yellow-500' : 
                            isChange ? 'bg-blue-500' : 
                            isAbsence ? 'bg-red-500' : 'bg-gray-400'
                          }`}>
                            {isExchange ? '景品交換' : isChange ? '変更申請' : isAbsence ? '欠席連絡' : 'その他'}
                          </span>
                          <span className="text-xs text-gray-400">
                            {req.created_at?.toDate ? req.created_at.toDate().toLocaleString() : new Date(req.created_at).toLocaleDateString()}
                          </span>
                          {/* ステータスバッジ */}
                          {req.status === 'completed' && <span className="text-xs font-bold bg-green-100 text-green-600 px-2 py-0.5 rounded">配送完了</span>}
                          {req.status === 'approved' && <span className="text-xs font-bold bg-blue-100 text-blue-600 px-2 py-0.5 rounded">承認済み</span>}
                          {req.status === 'rejected' && <span className="text-xs font-bold bg-red-100 text-red-600 px-2 py-0.5 rounded">却下済み</span>}
                        </div>

                        {/* 生徒名と内容タイトル */}
                        <h3 className="text-lg font-bold text-gray-800 mb-2">
                          {studentName} <span className="text-sm font-normal text-gray-400">{grade}</span>
                        </h3>

                        {/* --- 詳細コンテンツ --- */}
                        <div className="bg-gray-50 p-3 rounded-lg border border-gray-200 text-sm">
                          
                          {/* 1. 景品交換の場合 */}
                          {isExchange && (
                            <div className="flex items-center gap-2">
                              <span className="font-bold text-gray-500">申請アイテム:</span>
                              <span className="font-bold text-lg text-yellow-600 border-b-2 border-yellow-200">{req.rewardName}</span>
                              <span className="text-xs text-gray-400 ml-2">(消費: {req.cost}コイン)</span>
                            </div>
                          )}

                          {/* 2. 科目変更の場合 */}
                          {isChange && (
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-x-6 gap-y-2">
                              {/* 曜日 */}
                              <div className="flex items-center gap-2">
                                <span className="text-gray-400 text-xs w-8">曜日:</span>
                                <span className="line-through text-gray-300">{req.profiles?.day_of_week || '-'}</span>
                                <ArrowRight size={12} className="text-blue-400"/>
                                <span className={`font-bold ${req.target_day ? 'text-blue-600' : 'text-gray-400'}`}>
                                  {req.target_day || '変更なし'}
                                </span>
                              </div>
                              {/* 理科 */}
                              <div className="flex items-center gap-2">
                                <span className="text-gray-400 text-xs w-8">理科:</span>
                                <span className="line-through text-gray-300">{req.profiles?.science_subject || '-'}</span>
                                <ArrowRight size={12} className="text-blue-400"/>
                                <span className={`font-bold ${req.target_science ? 'text-blue-600' : 'text-gray-400'}`}>
                                  {req.target_science || '変更なし'}
                                </span>
                              </div>
                              {/* 社会 */}
                              <div className="flex items-center gap-2">
                                <span className="text-gray-400 text-xs w-8">社会:</span>
                                <span className="line-through text-gray-300">{req.profiles?.social_subject || '-'}</span>
                                <ArrowRight size={12} className="text-blue-400"/>
                                <span className={`font-bold ${req.target_social ? 'text-blue-600' : 'text-gray-400'}`}>
                                  {req.target_social || '変更なし'}
                                </span>
                              </div>
                            </div>
                          )}

                          {/* 3. 欠席の場合 */}
                          {isAbsence && (
                            <div className="font-bold text-red-600">
                              欠席予定日: {req.target_date}
                            </div>
                          )}

                          {/* 理由・コメント */}
                          {req.reason && (
                            <div className="mt-2 text-gray-600 border-t border-gray-200 pt-2">
                              <span className="text-xs text-gray-400 mr-2">理由:</span>
                              {req.reason}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* 右側: アクションボタン (未対応時のみ) */}
                    {req.status === 'pending' && (
                      <div className="flex items-center gap-3 shrink-0 mt-4 md:mt-0 md:self-center">
                        <button 
                          onClick={() => handleReject(req)} 
                          disabled={!!processingId}
                          className="flex items-center gap-1 text-gray-400 hover:text-red-500 hover:bg-red-50 px-3 py-2 rounded-lg transition-colors text-xs font-bold"
                        >
                          <X size={16}/> 却下
                        </button>
                        
                        {isExchange ? (
                          <button 
                            onClick={() => handleApproveExchange(req)} 
                            disabled={!!processingId}
                            className="flex items-center gap-2 bg-green-600 text-white px-5 py-2.5 rounded-xl font-bold text-sm hover:bg-green-700 shadow-md shadow-green-100 transition-all active:scale-95"
                          >
                            {processingId === req.id ? <Loader2 className="animate-spin" size={16}/> : <Truck size={18}/>}
                            配送済にする
                          </button>
                        ) : (
                          <button 
                            onClick={() => handleApproveChange(req)} 
                            disabled={!!processingId}
                            className="flex items-center gap-2 bg-cyan-600 text-white px-5 py-2.5 rounded-xl font-bold text-sm hover:bg-cyan-700 shadow-md shadow-cyan-100 transition-all active:scale-95"
                          >
                            {processingId === req.id ? <Loader2 className="animate-spin" size={16}/> : <Check size={18}/>}
                            {isChange ? '承認して更新' : '確認完了'}
                          </button>
                        )}
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