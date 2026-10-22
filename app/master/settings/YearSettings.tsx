'use client';

import { useState, useEffect } from 'react';
import { db } from '@/lib/firebase';
import { doc, getDoc, setDoc, collection, getDocs, writeBatch, query, where } from 'firebase/firestore';
import { CalendarClock, ArrowUpCircle } from 'lucide-react';
import { Button, useConfirm, useToast } from '@/app/components/ui';

export default function YearSettings() {
  const [currentYear, setCurrentYear] = useState(new Date().getFullYear().toString());
  const [loading, setLoading] = useState(false);
  const [processing, setProcessing] = useState(false);
  const toast = useToast();
  const confirm = useConfirm();

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
    toast.success(`システム年度を ${currentYear}年度 に設定しました。`);
    setLoading(false);
  };

  // 自動進級処理
  const handleUpgrade = async () => {
    if (!(await confirm({
      title: '全生徒の学年を1つ上げますか？',
      message: '例：中1 → 中2、中3 → 卒業。この操作は取り消せません。',
      confirmLabel: '進級させる',
      tone: 'danger',
    }))) return;
    
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
      toast.success(`${count}名の生徒を進級させました。`);
    } catch (e: any) {
      console.error(e);
      toast.error(`進級できませんでした。${e?.message || ''}`);
    } finally {
      setProcessing(false);
    }
  };

  return (
    <div className="cb-card mb-8 border-l-4 border-l-accent p-6">
      <h2 className="text-lg font-bold text-slate-800 mb-4 flex items-center gap-2">
        <CalendarClock className="text-accent" aria-hidden /> 年度・進級管理
      </h2>
      
      <div className="flex flex-col md:flex-row gap-6 items-start md:items-end">
        <div>
          <label className="block text-xs font-bold text-slate-500 mb-1">現在のシステム年度</label>
          <div className="flex gap-2">
            <input 
              type="number" 
              className="min-h-10 w-24 rounded-input border border-line p-2 text-center font-bold"
              value={currentYear}
              onChange={(e) => setCurrentYear(e.target.value)}
            />
            <Button variant="secondary" onClick={saveYear} loading={loading}>
              保存
            </Button>
          </div>
        </div>

        <div className="flex-1 border-l pl-6 border-line">
          <p className="text-xs text-slate-500 mb-2">
            新しい年度（2026年度など）になったら、下のボタンを押して生徒を一斉に進級させてください。
          </p>
          <Button onClick={handleUpgrade} loading={processing} icon={<ArrowUpCircle size={16} aria-hidden />}>
            全生徒を進級させる
          </Button>
        </div>
      </div>
    </div>
  );
}