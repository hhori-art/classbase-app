'use client';

import { useState, useEffect } from 'react';
import { db } from '@/lib/firebase';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { Calendar, Save, Loader2 } from 'lucide-react';

const WEEKS = ['1週','2週','3週','4週','5週','8週','9週','10週','14週','15週','16週','17週','18週','22週','23週','24週','25週','28週','29週','30週'];

export default function WeekSelector() {
  const [currentWeek, setCurrentWeek] = useState('1週');
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);

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
      } finally {
        setLoading(false);
      }
    };
    fetchWeek();
  }, []);

  const handleSave = async () => {
    if (!confirm(`設定を「${currentWeek}」に変更しますか？\n\n※ 生徒の出席・宿題記録の保存先が切り替わります。`)) return;
    
    setSaving(true);
    try {
      // settings/global ドキュメントを更新 (存在しなければ作成)
      const docRef = doc(db, 'settings', 'global');
      await setDoc(docRef, { 
        current_week: currentWeek,
        updated_at: new Date().toISOString()
      }, { merge: true });
      
      alert(`設定を「${currentWeek}」に変更しました。`);
    } catch (error: any) {
      console.error(error);
      alert('保存エラー: ' + error.message);
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="bg-white p-6 rounded-2xl shadow-sm border-l-4 border-orange-500 mb-8 flex justify-center items-center h-32">
        <Loader2 className="animate-spin text-orange-500" />
      </div>
    );
  }

  return (
    <div className="bg-white p-6 rounded-2xl shadow-sm border-l-4 border-orange-500 mb-8">
      <h2 className="text-lg font-bold text-gray-800 mb-4 flex items-center gap-2">
        <Calendar className="text-orange-500" /> 現在の週設定
      </h2>
      <div className="flex gap-4 items-center flex-wrap">
        <div className="relative">
          <select 
            value={currentWeek} 
            onChange={(e) => setCurrentWeek(e.target.value)}
            className="appearance-none bg-gray-50 border border-gray-300 text-gray-900 text-lg font-bold rounded-lg focus:ring-orange-500 focus:border-orange-500 block w-40 p-2.5 pr-8 cursor-pointer"
          >
            {WEEKS.map(w => <option key={w} value={w}>{w}</option>)}
          </select>
        </div>

        <button 
          onClick={handleSave} 
          disabled={saving}
          className="bg-orange-500 text-white px-6 py-2.5 rounded-lg font-bold hover:bg-orange-600 flex items-center gap-2 transition-colors disabled:opacity-50 shadow-sm shadow-orange-200"
        >
          {saving ? <Loader2 className="animate-spin" size={18}/> : <Save size={18}/>} 
          {saving ? '保存中...' : '設定を更新'}
        </button>
      </div>
      <p className="text-sm text-gray-500 mt-2 font-medium">
        ※ ここで設定した週に、生徒のZoom出席状況や宿題提出が記録されます。
      </p>
    </div>
  );
}