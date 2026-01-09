'use client';

import { useState, useEffect } from 'react';
import { db } from '@/lib/firebase';
import { doc, getDoc, setDoc, collection, getDocs, writeBatch, query, where } from 'firebase/firestore';
import { CalendarClock, ArrowUpCircle, Loader2 } from 'lucide-react';

export default function YearSettings() {
  const [currentYear, setCurrentYear] = useState(new Date().getFullYear().toString());
  const [loading, setLoading] = useState(false);
  const [processing, setProcessing] = useState(false);

  useEffect(() => {
    // 現在の設定年度を取得
    getDoc(doc(db, 'settings', 'global')).then(snap => {
      if (snap.exists() && snap.data().current_year) {
        setCurrentYear(snap.data().current_year);
      }
    });
  }, []);

  const saveYear = async () => {
    setLoading(true);
    await setDoc(doc(db, 'settings', 'global'), { current_year: currentYear }, { merge: true });
    alert(`システム年度を ${currentYear}年度 に設定しました。`);
    setLoading(false);
  };

  // 自動進級処理
  const handleUpgrade = async () => {
    if (!confirm(`【重要】全生徒の学年を1つ上げますか？\n\n例: 中1 → 中2, 中3 → 卒業\n※この操作は取り消せません。`)) return;
    
    setProcessing(true);
    try {
      const q = query(collection(db, 'users'), where('role', '==', 'student'));
      const snapshot = await getDocs(q);
      
      const batch = writeBatch(db);
      let count = 0;

      snapshot.forEach(d => {
        const data = d.data();
        let newGrade = data.grade;

        // 学年更新ロジック
        if (data.grade === '中1') newGrade = '中2';
        else if (data.grade === '中2') newGrade = '中3';
        else if (data.grade === '中3') newGrade = '卒業';
        
        if (newGrade !== data.grade) {
          batch.update(d.ref, { grade: newGrade });
          count++;
        }
      });

      await batch.commit();
      alert(`${count}名の生徒を進級させました。`);
    } catch (e: any) {
      alert('エラー: ' + e.message);
    } finally {
      setProcessing(false);
    }
  };

  return (
    <div className="bg-white p-6 rounded-2xl shadow-sm border-l-4 border-blue-500 mb-8">
      <h2 className="text-lg font-bold text-gray-800 mb-4 flex items-center gap-2">
        <CalendarClock className="text-blue-500" /> 年度・進級管理
      </h2>
      
      <div className="flex flex-col md:flex-row gap-6 items-start md:items-end">
        <div>
          <label className="block text-xs font-bold text-gray-500 mb-1">現在のシステム年度</label>
          <div className="flex gap-2">
            <input 
              type="number" 
              className="p-2 border rounded-lg font-bold w-24 text-center"
              value={currentYear}
              onChange={(e) => setCurrentYear(e.target.value)}
            />
            <button 
              onClick={saveYear} 
              disabled={loading}
              className="bg-gray-800 text-white px-4 py-2 rounded-lg font-bold text-sm hover:bg-black"
            >
              {loading ? '...' : '保存'}
            </button>
          </div>
        </div>

        <div className="flex-1 border-l pl-6 border-gray-100">
          <p className="text-xs text-gray-500 mb-2">
            新しい年度（2026年度など）になったら、下のボタンを押して生徒を一斉に進級させてください。
          </p>
          <button 
            onClick={handleUpgrade}
            disabled={processing}
            className="bg-blue-600 text-white px-6 py-2 rounded-lg font-bold text-sm hover:bg-blue-700 flex items-center gap-2 shadow-sm shadow-blue-200"
          >
            {processing ? <Loader2 className="animate-spin" size={16}/> : <ArrowUpCircle size={16}/>}
            全生徒を進級させる
          </button>
        </div>
      </div>
    </div>
  );
}