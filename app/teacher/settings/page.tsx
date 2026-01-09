'use client';

import { useState, useEffect, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { db } from '@/lib/firebase';
import { collection, getDocs } from 'firebase/firestore';
import { ArrowLeft, SlidersHorizontal, Loader2, Link as LinkIcon } from 'lucide-react';
import Link from 'next/link';

function SettingsContent() {
  const searchParams = useSearchParams();
  const isFromMaster = searchParams.get('from') === 'master';
  const backLink = isFromMaster ? '/master' : '/teacher';

  const [rules, setRules] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchRules = async () => {
      try {
        // 管理者画面で設定した "subject_urls" コレクションを取得
        const querySnapshot = await getDocs(collection(db, 'subject_urls'));
        const data = querySnapshot.docs.map(doc => ({
          id: doc.id,
          ...doc.data()
        }));

        // 曜日順にソート (月 -> 土)
        const daysOrder = ['月', '火', '水', '木', '金', '土', '日'];
        data.sort((a: any, b: any) => {
          return daysOrder.indexOf(a.day_of_week) - daysOrder.indexOf(b.day_of_week);
        });

        setRules(data);
      } catch (e) {
        console.error('Error fetching settings:', e);
      } finally {
        setLoading(false);
      }
    };

    fetchRules();
  }, []);

  return (
    <div className={`min-h-screen p-6 pb-20 ${isFromMaster ? 'bg-gray-100' : 'bg-gray-50'}`}>
      <div className="max-w-4xl mx-auto">
        
        {/* ヘッダー */}
        <div className="flex items-center gap-4 mb-6">
          <Link href={backLink} className="bg-white p-2 rounded-full shadow hover:bg-gray-50 text-gray-600 transition-colors">
            <ArrowLeft size={20} />
          </Link>
          <div>
            <h1 className="text-2xl font-bold text-gray-800 flex items-center gap-2">
              <SlidersHorizontal className="text-green-600" /> 授業URL自動割当ルール
            </h1>
            <p className="text-xs text-gray-500">
              {isFromMaster ? 'マスター権限で設定中' : '現在の科目・曜日ごとのZoom URL設定一覧'}
            </p>
          </div>
        </div>

        <div className="bg-white p-6 rounded-xl shadow-sm mb-6 border border-gray-100">
           <p className="text-sm text-gray-500 mb-4 flex justify-between items-center">
             <span>現在登録されているルール ({rules.length}件)</span>
             {loading && <Loader2 className="animate-spin text-gray-400" size={16}/>}
           </p>
           
           <div className="space-y-3">
             {!loading && rules.length === 0 ? (
               <div className="text-center py-8 text-gray-400 border border-dashed rounded-lg">
                 ルールが設定されていません
               </div>
             ) : (
               rules.map((rule) => (
                 <div key={rule.id} className="border border-gray-100 p-4 rounded-lg flex flex-col md:flex-row justify-between items-start md:items-center bg-gray-50 hover:bg-white transition-colors gap-3">
                   <div>
                     <div className="flex items-center gap-2 mb-1">
                       <span className="font-bold text-gray-800 text-lg">
                         {rule.subject}
                       </span>
                       <span className={`text-xs font-bold px-2 py-0.5 rounded text-white ${
                         rule.day_of_week === '土' ? 'bg-blue-400' : 'bg-orange-400'
                       }`}>
                         {rule.day_of_week}曜
                       </span>
                     </div>
                     <div className="flex items-center gap-1 text-xs text-blue-600 break-all font-mono bg-blue-50 px-2 py-1 rounded">
                       <LinkIcon size={12} />
                       {rule.url || 'URL未設定'}
                     </div>
                   </div>
                   <div className="text-[10px] text-gray-400 bg-white border px-2 py-1 rounded-full whitespace-nowrap">
                     自動適用
                   </div>
                 </div>
               ))
             )}
           </div>
        </div>
        
        {/* 説明書き */}
        <div className="bg-blue-50 p-4 rounded-lg border border-blue-100 text-xs text-blue-800 leading-relaxed">
          <strong>💡 仕組みについて</strong><br/>
          ここで表示されているURLが、生徒の「科目変更申請」などが承認された際に自動的に割り当てられます。<br/>
          変更が必要な場合は、管理者メニューの「システム設定」から行ってください。
        </div>

      </div>
    </div>
  );
}

export default function ClassSettingsPage() {
  return (
    // useSearchParamsを使うためSuspenseでラップする
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center"><Loader2 className="animate-spin text-gray-400"/></div>}>
      <SettingsContent />
    </Suspense>
  );
}