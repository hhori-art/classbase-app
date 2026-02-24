// app/print/page.tsx
'use client';

import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { db } from '@/lib/firebase';
import { doc, getDoc } from 'firebase/firestore';
import { Shield, AlertTriangle, CheckCircle, Loader2 } from 'lucide-react';

export default function PrintPage() {
  const searchParams = useSearchParams();
  const idsParam = searchParams.get('ids');
  
  const [users, setUsers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [qrBaseUrl, setQrBaseUrl] = useState('');

  useEffect(() => {
    if (typeof window !== 'undefined') {
      setQrBaseUrl(window.location.origin);
    }
  }, []);

  useEffect(() => {
    const fetchUsers = async () => {
      if (!idsParam) {
        setLoading(false);
        return;
      }
      
      const ids = idsParam.split(',');
      const fetchedUsers = [];
      
      for (const id of ids) {
        try {
          const docRef = doc(db, 'users', id);
          const docSnap = await getDoc(docRef);
          if (docSnap.exists()) {
            fetchedUsers.push({ id: docSnap.id, ...docSnap.data() });
          }
        } catch (e) {
          console.error("Error fetching user:", e);
        }
      }
      
      setUsers(fetchedUsers);
      setLoading(false);
      
      // ★ データ取得後、0.5秒待ってから自動で印刷ダイアログを開く
      if (fetchedUsers.length > 0) {
        setTimeout(() => {
          window.print();
        }, 500);
      }
    };

    fetchUsers();
  }, [idsParam]);

  if (loading) {
    return <div className="min-h-screen flex flex-col items-center justify-center bg-gray-100"><Loader2 className="animate-spin text-blue-500 mb-4" size={40}/><p className="font-bold text-gray-500">印刷データを準備中...</p></div>;
  }

  if (users.length === 0) {
    return <div className="p-10 text-center font-bold text-gray-500">印刷対象のユーザーが見つかりません。</div>;
  }

  return (
    <div className="bg-gray-200 min-h-screen pb-10 print:bg-white print:p-0">
      {/* 印刷用の最強CSS */}
      <style dangerouslySetInnerHTML={{__html: `
        @media print {
          @page { size: A4 portrait; margin: 0; }
          body { background-color: white !important; }
          .print-page {
            display: block !important;
            position: relative !important;
            page-break-after: always !important;
            break-after: page !important;
            page-break-inside: avoid !important;
            width: 210mm !important;
            height: 297mm !important;
            padding: 12mm 18mm !important; 
            margin: 0 !important;
            box-sizing: border-box !important;
            box-shadow: none !important;
            border: none !important;
          }
          .print-page:last-child {
            page-break-after: auto !important;
            break-after: auto !important;
          }
          .print-footer {
            position: absolute !important;
            bottom: 12mm !important;
            left: 18mm !important;
            right: 18mm !important;
          }
          * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
          .no-print { display: none !important; }
        }
      `}} />

      <div className="no-print bg-indigo-600 text-white p-4 shadow-md mb-8 text-center font-bold">
        🖨️ 印刷ダイアログが自動で開きます。<br/>
        <span className="text-sm font-normal opacity-80">もし開かない場合は、ブラウザの印刷機能（Ctrl+P または Cmd+P）を使用してください。</span>
      </div>

      <div className="flex flex-col items-center gap-8 print:block print:gap-0 font-sans">
        {users.map((user) => {
          const loginId = user.lifetime_id || user.email || '';
          const safeBaseUrl = qrBaseUrl || 'https://www.edic.jp'; 
          const qrUrl = `https://chart.googleapis.com/chart?chs=150x150&cht=qr&chl=${encodeURIComponent(safeBaseUrl)}`;
          
          const isStudent = user.role === 'student';
          const isTeacher = user.role === 'teacher';
          const displayName = user.student_name || user.name || '名称未設定';
          const nameSuffix = isStudent ? 'さん' : isTeacher ? '先生' : '様';
          const formattedDate = `${new Date().getFullYear()}年${new Date().getMonth() + 1}月${new Date().getDate()}日`;
          
          return (
            <div key={user.id} className="print-page bg-white shadow-lg relative block" style={{ width: '210mm', height: '297mm', padding: '12mm 18mm' }}>
              <div className="block">
                <div className="text-right text-sm text-gray-500 font-medium mb-3">発行日: {formattedDate}</div>

                <div className="bg-blue-50 border-2 border-blue-100 rounded-2xl py-3 px-4 mb-5 flex items-center justify-center gap-4 shadow-sm">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src="/icon.png" alt="App Icon" className="w-10 h-10 rounded-xl shadow-sm border border-white" />
                  <h1 className="text-xl font-black text-blue-800 tracking-wider">理社講座新システム 初回ログインのご案内</h1>
                </div>

                <div className="mb-5 px-2">
                  <p className="text-lg mb-2 text-gray-800 font-bold">
                    {isStudent && "保護者 様"}<br/>
                    <span className="text-2xl tracking-wide ml-4 text-blue-900">{displayName}</span> {nameSuffix}
                  </p>
                  <p className="text-[13px] text-gray-700 leading-relaxed mt-2">
                    いつも当塾の教育活動にご理解とご協力をいただき、ありがとうございます。<br/>
                    この度、ご家庭と塾をつなぐ「理社講座新システム」のアカウントをご用意いたしました。<br/>
                    お手持ちのスマートフォンやパソコンから簡単にアクセスできますので、<br/>
                    下記のアカウント情報を使って、ぜひ最初のログインをお試しくださいませ！
                  </p>
                </div>
                
                <div className="bg-white border-4 border-blue-50 rounded-3xl p-4 mb-6 flex justify-between items-center shadow-sm">
                  <div className="flex-1 pl-2 pr-4">
                    <h2 className="text-md font-black text-blue-800 mb-4 flex items-center gap-2 border-b-2 border-blue-50 pb-1.5 inline-flex">
                      <Shield size={18} className="text-blue-500"/> あなたの専用アカウント情報
                    </h2>
                    <div className="space-y-4">
                      <div>
                        <p className="text-[11px] font-bold text-gray-500 mb-1">① ログインID (生涯番号)</p>
                        <p className="text-xl font-mono font-black tracking-widest text-gray-800 bg-blue-50 px-3 py-1.5 rounded-xl inline-block border border-blue-100">{loginId}</p>
                      </div>
                      <div className="flex gap-4 items-end">
                        <div>
                          <p className="text-[11px] font-bold text-gray-500 mb-1">② 初期パスワード</p>
                          <p className="text-lg font-mono font-bold tracking-widest text-gray-800 bg-blue-50 px-3 py-1.5 rounded-xl inline-block border border-blue-100">{user.initial_password || '********'}</p>
                        </div>
                        <div className="flex-1 border-b-2 border-dashed border-gray-300 pb-1 mb-1">
                          <span className="text-[10px] font-bold text-red-500 mr-2">変更後の新パスワード メモ :</span>
                        </div>
                      </div>
                    </div>
                  </div>
                  
                  <div className="text-center ml-2 flex flex-col items-center justify-center bg-blue-50 p-3 rounded-2xl border-2 border-blue-100 w-40 shrink-0">
                    <p className="text-[11px] font-bold text-blue-800 mb-1.5 bg-white px-3 py-1 rounded-full shadow-sm">ここからログイン！</p>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={qrUrl} alt="Login QR Code" className="w-20 h-20 mb-1" />
                    <p className="text-[9px] font-bold text-gray-500 leading-tight">カメラで読み取れます</p>
                  </div>
                </div>
                
                <div className="bg-yellow-50/50 border-2 border-yellow-100 rounded-2xl p-4">
                  <h3 className="font-bold text-yellow-800 mb-2 flex items-center gap-2 text-[14px]">
                    <AlertTriangle size={16} className="text-yellow-600"/> ご利用にあたってのお願い
                  </h3>
                  <ul className="space-y-2 text-[12px] text-gray-700 leading-relaxed font-medium">
                    <li className="flex gap-2 items-start"><CheckCircle size={14} className="text-yellow-500 shrink-0 mt-0.5"/><div><strong>パスワードの変更について：</strong><br/>セキュリティ保護のため、初回ログイン後に必ずメニューの「設定」画面から、<span className="text-red-500 font-bold bg-red-50 px-1 rounded">ご自身しか分からない新しいパスワードに変更</span>をお願いいたします。</div></li>
                    <li className="flex gap-2 items-start"><CheckCircle size={14} className="text-yellow-500 shrink-0 mt-0.5"/><div><strong>アカウントの管理について：</strong><br/>この用紙に記載されているIDとパスワードは、第三者に知られないよう大切に保管してください。</div></li>
                    <li className="flex gap-2 items-start"><CheckCircle size={14} className="text-yellow-500 shrink-0 mt-0.5"/><div><strong>アプリの追加方法：</strong><br/>SafariやChrome等のブラウザでログイン後、画面の案内に従って「ホーム画面に追加」を行っていただくと、次回以降スマホアプリのように便利にご利用いただけます。</div></li>
                  </ul>
                </div>
              </div>

              <div className="print-footer flex justify-between items-end border-t-2 border-blue-100 pt-2">
                <div className="text-[10px] text-gray-400 font-medium pb-1">※本用紙は大切に保管してください。</div>
                <div className="text-xl font-black text-blue-900 tracking-widest">創造学園エディック</div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}