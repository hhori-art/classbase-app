'use client';

import { useState } from 'react';
import { User, MapPin, Hash, KeyRound, Mail, RefreshCw } from 'lucide-react';

interface StudentRowProps {
  student: any;
}

export default function StudentRow({ student }: StudentRowProps) {
  const [displayPass, setDisplayPass] = useState(student.raw_password || '不明');
  const displayId = student.email ? student.email.split('@')[0] : '未設定';

  const handleChangePassword = async () => {
    const newPass = prompt(`「${student.student_name}」さんの新しいパスワードを入力してください:`, "class1234");
    if (!newPass) return;
    if (newPass.length < 6) return alert('パスワードは6文字以上で設定してください');

    try {
      const res = await fetch('/api/teacher/password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: student.id, newPassword: newPass }),
      });
      const data = await res.json();
      if (data.success) {
        alert('パスワードを変更しました！');
        setDisplayPass(newPass);
      } else {
        alert('変更失敗: ' + data.error);
      }
    } catch (e) {
      alert('通信エラー');
    }
  };

  return (
    <div className="flex flex-col p-4 hover:bg-gray-50 border-b border-gray-100 transition-colors group">
      
      {/* 1行目: 基本情報 */}
      <div className="flex justify-between items-start mb-2">
        <div className="flex items-center gap-3">
           <div className="w-1.5 h-10 rounded-full bg-gray-200"></div>
           
           <div>
             <div className="flex items-center gap-2">
               <span className="font-bold text-gray-800 text-lg">{student.student_name}</span>
               {student.name_kana && <span className="text-xs text-gray-400">({student.name_kana})</span>}
             </div>
             <div className="flex gap-2 text-xs mt-1">
               <span className="bg-blue-50 text-blue-700 px-1.5 py-0.5 rounded border border-blue-100 font-bold">{student.grade}</span>
               <span className="bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded border border-gray-200 flex items-center gap-1"><MapPin size={10}/> {student.classroom || '教室未定'}</span>
             </div>
           </div>
        </div>
        
        <div className="text-right">
           <div className="flex items-center justify-end gap-1 mb-1">
             <span className="text-xs font-bold text-gray-500 bg-gray-100 px-2 py-0.5 rounded">{student.day_of_week}曜</span>
           </div>
           <div className="flex gap-1">
             {/* ★修正: 理科のラベルに social_subject (逆になっているデータ) を表示 */}
             <span className="text-[10px] bg-green-50 text-green-700 px-1.5 py-0.5 rounded border border-green-200">理: {student.social_subject || '-'}</span>
             {/* ★修正: 社会のラベルに science_subject を表示 */}
             <span className="text-[10px] bg-orange-50 text-orange-700 px-1.5 py-0.5 rounded border border-orange-200">社: {student.science_subject || '-'}</span>
           </div>
        </div>
      </div>

      {/* 2行目: ID/PASS情報 */}
      <div className="flex flex-wrap gap-4 text-xs text-gray-500 mb-2 pl-5 items-center">
        <span className="flex items-center gap-1"><Hash size={12}/> 学籍: {student.student_id || '-'}</span>
        <span className="flex items-center gap-1"><User size={12}/> 生涯: {student.lifetime_id || '-'}</span>
        
        <div className="flex items-center gap-2 ml-auto">
          <div className="flex items-center gap-3 bg-yellow-50 px-3 py-1 rounded border border-yellow-200">
            <span className="flex items-center gap-1 font-bold text-gray-700">
              <Mail size={12} className="text-gray-400"/>
              ID: <span className="select-all cursor-text text-blue-600 text-base">{displayId}</span>
            </span>
            <span className="text-gray-300">|</span>
            <span className="flex items-center gap-1 font-bold text-gray-700">
              <KeyRound size={12} className="text-gray-400"/>
              PASS: <span className="select-all cursor-text text-red-500 text-base">{displayPass}</span>
            </span>
          </div>
          <button 
            onClick={handleChangePassword}
            className="bg-gray-100 hover:bg-gray-200 text-gray-600 p-1.5 rounded border border-gray-300 transition-colors"
            title="パスワードを変更"
          >
            <RefreshCw size={14} />
          </button>
        </div>
      </div>
    </div>
  );
}