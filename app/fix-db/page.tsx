'use client';

import { useState } from 'react';
import { db } from '@/lib/firebase';
import { doc, setDoc } from 'firebase/firestore';

export default function FixDbPage() {
  const [msg, setMsg] = useState('');
  const [loading, setLoading] = useState(false);

  // あなたのIDとメールアドレス
  const targetUid = 'ycxZPrnnN6hD2JeIee7mOpodAr43';
  const targetEmail = 'h_hori@sozogakuen.co.jp';

  const handleFix = async () => {
    setLoading(true);
    try {
      // usersコレクションにデータを強制書き込み
      await setDoc(doc(db, 'users', targetUid), {
        uid: targetUid,
        name: '堀 先生(管理者)', // 仮の名前
        email: targetEmail,
        role: 'master',        // 重要: ここでマスター権限を付与
        created_at: new Date().toISOString()
      });

      setMsg(`✅ 修復成功！\nFirestoreにデータを書き込みました。\nこれでログインできるはずです。`);
    } catch (e: any) {
      setMsg(`❌ エラー: ${e.message}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-100 p-10 flex items-center justify-center">
      <div className="bg-white p-8 rounded shadow text-center max-w-md w-full">
        <h1 className="text-xl font-bold mb-4 text-red-600">データベース修復ツール</h1>
        <p className="mb-6 text-sm text-gray-600">
          Auth認証は成功していますが、Firestoreデータが欠落しているため修復します。
        </p>
        
        <div className="bg-gray-100 p-4 rounded text-left text-xs font-mono mb-6 break-all">
          TARGET UID:<br/>
          {targetUid}
        </div>

        <button 
          onClick={handleFix} 
          disabled={loading}
          className="w-full bg-red-600 text-white font-bold py-3 rounded hover:bg-red-700 disabled:opacity-50"
        >
          {loading ? '書き込み中...' : 'データを強制作成する'}
        </button>

        {msg && (
          <div className="mt-6 p-4 bg-blue-50 text-blue-800 rounded text-left whitespace-pre-wrap font-bold">
            {msg}
          </div>
        )}
      </div>
    </div>
  );
}