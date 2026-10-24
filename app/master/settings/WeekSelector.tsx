'use client';

import { useState, useEffect } from 'react';
import { db } from '@/lib/firebase';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { Calendar, Save } from 'lucide-react';
import { Button, Skeleton, useConfirm, useToast } from '@/app/components/ui';
import { userErrorMessage } from '@/lib/user-error';

const WEEKS = ['1週','2週','3週','4週','5週','8週','9週','10週','14週','15週','16週','17週','18週','22週','23週','24週','25週','28週','29週','30週'];

export default function WeekSelector() {
  const [currentWeek, setCurrentWeek] = useState('1週');
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const toast = useToast();
  const confirm = useConfirm();

  useEffect(() => {
    const fetchWeek = async () => {
      try {
        // settings/global ドキュメントから設定を取得
        const docRef = doc(db, 'settings', 'global');
        const snap = await getDoc(docRef);
        
        if (snap.exists()) {
          const data = snap.data();
          if (data.current_week) {
            setCurrentWeek(data.current_week);
          }
        }
      } catch (error) {
        console.error('週設定の取得に失敗しました', error);
        setLoadError(true);
      } finally {
        setLoading(false);
      }
    };
    fetchWeek();
  }, []);

  const handleSave = async () => {
    if (!(await confirm({
      title: `週設定を「${currentWeek}」に変更しますか？`,
      message: '生徒の出席・宿題記録の保存先が切り替わります。',
      confirmLabel: '変更する',
      tone: 'danger',
    }))) return;
    
    setSaving(true);
    try {
      // settings/global ドキュメントを更新 (存在しなければ作成)
      const docRef = doc(db, 'settings', 'global');
      await setDoc(docRef, { 
        current_week: currentWeek,
        updated_at: new Date().toISOString()
      }, { merge: true });
      
      toast.success(`設定を「${currentWeek}」に変更しました。`);
    } catch (error: any) {
      console.error(error);
      toast.error(`保存できませんでした。${userErrorMessage(error, '')}`);
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="cb-card mb-8 border-l-4 border-l-amber-500 p-6">
        <Skeleton className="h-24 w-full" />
      </div>
    );
  }

  return (
    <div className="cb-card mb-8 border-l-4 border-l-amber-500 p-6">
      <h2 className="text-lg font-bold text-slate-800 mb-4 flex items-center gap-2">
        <Calendar className="text-amber-500" aria-hidden /> 現在の週設定
      </h2>
      <div className="flex gap-4 items-center flex-wrap">
        <div className="relative">
          <select 
            value={currentWeek} 
            onChange={(e) => setCurrentWeek(e.target.value)}
            className="block min-h-11 w-40 cursor-pointer appearance-none rounded-input border border-line bg-slate-50 p-2.5 pr-8 text-lg font-bold text-slate-900 focus:border-accent focus:ring-accent"
          >
            {WEEKS.map(w => <option key={w} value={w}>{w}</option>)}
          </select>
        </div>

        <Button onClick={handleSave} loading={saving} icon={<Save size={18} aria-hidden />}>
          {saving ? '保存中...' : '設定を更新'}
        </Button>
      </div>
      <p className="text-sm text-slate-500 mt-2 font-medium">
        ※ ここで設定した週に、生徒のZoom出席状況や宿題提出が記録されます。
      </p>
      {loadError && (
        <p role="alert" className="mt-2 text-sm font-bold text-rose-600">
          現在の週設定を読み込めませんでした。再読み込みしてから変更してください。
        </p>
      )}
    </div>
  );
}