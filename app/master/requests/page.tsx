'use client';

import { useState, useEffect } from 'react';
import { db } from '@/lib/firebase';
import { 
  collection, 
  query, 
  where, 
  getDocs, 
  doc, 
  getDoc, 
  writeBatch, 
  orderBy 
} from 'firebase/firestore';
import { FileCheck, ArrowLeft, Check, ArrowRight, X, Loader2, AlertCircle } from 'lucide-react';
import Link from 'next/link';

export default function MasterRequestsPage() {
  const [requests, setRequests] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchRequests();
  }, []);

  const fetchRequests = async () => {
    setLoading(true);
    try {
      // 1. 保留中の申請を取得
      // ※インデックス未作成エラーが出る場合は orderBy を外してください
      const q = query(
        collection(db, 'requests'),
        where('status', '==', 'pending'),
        orderBy('created_at', 'desc')
      );
      const querySnapshot = await getDocs(q);

      // 2. 申請者の現在のプロフィール(名前など)を取得して結合
      const requestsData = await Promise.all(querySnapshot.docs.map(async (reqDoc) => {
        const reqData = reqDoc.data();
        let profiles = {};
        
        if (reqData.user_id) {
          const userSnap = await getDoc(doc(db, 'users', reqData.user_id));
          if (userSnap.exists()) {
            profiles = userSnap.data();
          }
        }
        
        return {
          id: reqDoc.id,
          ...reqData,
          profiles
        };
      }));
      
      setRequests(requestsData);
    } catch (e) {
      console.error(e);
      // インデックスエラー時のフォールバック
      if (requests.length === 0) {
        const qRetry = query(collection(db, 'requests'), where('status', '==', 'pending'));
        const snapRetry = await getDocs(qRetry);
        const retryData = snapRetry.docs.map(d => ({ id: d.id, ...d.data(), profiles: {} }));
        setRequests(retryData);
      }
    } finally {
      setLoading(false);
    }
  };

  // ★重要: 承認と同時にURLと科目を自動更新する処理
  const handleApprove = async (req: any) => {
    const studentName = req.profiles?.student_name || req.student_name;
    if (!confirm(`${studentName}さんの変更を承認しますか？\n(URLと科目が自動更新されます)`)) return;
    
    try {
      const batch = writeBatch(db);
      const updates: any = {};

      // --- 科目・曜日変更申請の場合 ---
      if (req.type === 'change') {
        const targetDay = req.target_day; // 例: "月"
        
        // 基本情報の更新
        updates.day_of_week = targetDay;
        updates.updated_at = new Date().toISOString();

        // 理科の更新 & URL自動取得
        if (req.target_science) {
          updates.science_subject = req.target_science;
          
          // subject_urls コレクションからURLを取得 (ID: "生物_月" など)
          const scienceKey = `${req.target_science}_${targetDay}`;
          const scienceSnap = await getDoc(doc(db, 'subject_urls', scienceKey));
          
          if (scienceSnap.exists()) {
            updates.science_url = scienceSnap.data().url; // プロフィールに保存
          }
        }

        // 社会の更新 & URL自動取得
        if (req.target_social) {
          updates.social_subject = req.target_social;
          
          const socialKey = `${req.target_social}_${targetDay}`;
          const socialSnap = await getDoc(doc(db, 'subject_urls', socialKey));
          
          if (socialSnap.exists()) {
            updates.social_url = socialSnap.data().url; // プロフィールに保存
          }
        }

        // ユーザープロフィールの更新を実行
        const userRef = doc(db, 'users', req.user_id);
        batch.update(userRef, updates);
      }

      // --- 申請ステータスを「承認済み」に変更 ---
      const reqRef = doc(db, 'requests', req.id);
      batch.update(reqRef, { 
        status: 'approved',
        processed_at: new Date().toISOString()
      });

      await batch.commit();
      
      alert('承認しました。生徒のZoom URLと科目が自動更新されました。');
      setRequests(prev => prev.filter(r => r.id !== req.id));

    } catch (e: any) {
      console.error(e);
      alert('エラーが発生しました: ' + e.message);
    }
  };

  // 却下処理
  const handleReject = async (id: string) => {
    if (!confirm('この申請を却下しますか？')) return;
    try {
      const batch = writeBatch(db);
      const reqRef = doc(db, 'requests', id);
      
      batch.update(reqRef, { 
        status: 'rejected',
        processed_at: new Date().toISOString()
      });
      
      await batch.commit();
      setRequests(prev => prev.filter(r => r.id !== id));
    } catch (e: any) {
      alert('エラー: ' + e.message);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 p-8 pb-32">
      <div className="max-w-4xl mx-auto">
        <div className="flex items-center gap-4 mb-8">
          <Link href="/master" className="bg-white p-2 rounded-full shadow hover:bg-gray-100 text-gray-600 transition-colors">
            <ArrowLeft size={24} />
          </Link>
          <h1 className="text-2xl font-bold flex items-center gap-2 text-gray-800">
            <FileCheck className="text-cyan-600" /> 変更申請の承認
          </h1>
        </div>

        <div className="bg-white rounded-xl overflow-hidden border border-gray-200 shadow-sm">
          {loading ? (
            <div className="p-8 text-center text-gray-500 flex justify-center"><Loader2 className="animate-spin"/></div>
          ) : requests.length === 0 ? (
            <div className="p-10 text-center text-gray-400">
              現在、未処理の申請はありません
            </div>
          ) : (
            <div className="divide-y divide-gray-100">
              {requests.map(req => (
                <div key={req.id} className="p-6 flex flex-col gap-4 hover:bg-gray-50 transition-colors">
                  <div className="flex justify-between items-start">
                    <div>
                      <div className="flex items-center gap-2 mb-1">
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded text-white 
                          ${req.type === 'change' ? 'bg-blue-500' : req.type === 'absence' ? 'bg-red-500' : 'bg-green-500'}`}>
                          {req.type === 'change' ? '変更申請' : req.type === 'absence' ? '欠席連絡' : '連絡'}
                        </span>
                        <span className="text-xs text-gray-400">
                          {new Date(req.created_at).toLocaleDateString()}
                        </span>
                      </div>
                      <div className="font-bold text-lg text-gray-800">
                        {req.profiles?.student_name || req.student_name}
                        <span className="text-sm font-normal text-gray-400 ml-2">
                          ({req.target_grade || req.profiles?.grade})
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* 申請内容詳細 */}
                  <div className="bg-gray-50 p-4 rounded-lg border border-gray-200 text-sm space-y-2">
                    
                    {/* 科目変更 */}
                    {req.type === 'change' && (
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <div className="flex items-center gap-2">
                           <span className="text-gray-500 font-bold">曜日:</span>
                           <span className="text-gray-400 line-through decoration-red-400">{req.profiles?.day_of_week || '-'}</span>
                           <ArrowRight size={14} className="text-blue-500"/>
                           <span className="font-bold text-blue-600">{req.target_day}</span>
                        </div>
                        <div className="flex items-center gap-2">
                           <span className="text-gray-500 font-bold">理科:</span>
                           <span className="text-gray-400 line-through decoration-red-400">{req.profiles?.science_subject || '-'}</span>
                           <ArrowRight size={14} className="text-blue-500"/>
                           <span className="font-bold text-blue-600">{req.target_science}</span>
                        </div>
                        <div className="flex items-center gap-2">
                           <span className="text-gray-500 font-bold">社会:</span>
                           <span className="text-gray-400 line-through decoration-red-400">{req.profiles?.social_subject || '-'}</span>
                           <ArrowRight size={14} className="text-blue-500"/>
                           <span className="font-bold text-blue-600">{req.target_social}</span>
                        </div>
                      </div>
                    )}

                    {/* 欠席連絡 */}
                    {req.type === 'absence' && (
                       <div className="flex items-center gap-2 text-red-600 font-bold bg-white p-2 rounded border border-red-100 inline-block">
                         <AlertCircle size={16}/>
                         <span>欠席予定日: {req.target_date}</span>
                       </div>
                    )}
                    
                    {/* 理由・メッセージ */}
                    {req.reason && (
                      <div className="text-gray-600 mt-2 pt-2 border-t border-gray-200">
                        <span className="font-bold text-gray-400 text-xs block mb-1">内容:</span>
                        {req.reason}
                      </div>
                    )}
                  </div>

                  <div className="flex gap-3 justify-end mt-2">
                    <button 
                      onClick={() => handleReject(req.id)} 
                      className="flex items-center gap-2 text-gray-500 hover:text-red-500 hover:bg-red-50 px-4 py-2 rounded-lg transition-colors text-sm font-bold"
                    >
                      <X size={16}/> 却下
                    </button>
                    <button 
                      onClick={() => handleApprove(req)} 
                      className="flex items-center gap-2 bg-cyan-600 text-white px-6 py-2 rounded-lg font-bold text-sm hover:bg-cyan-700 shadow-md shadow-cyan-100 transition-all active:scale-95"
                    >
                      <Check size={16}/> 
                      {req.type === 'change' ? '承認して更新' : '確認完了'}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}