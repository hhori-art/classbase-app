'use client';

import { useState } from 'react';
import { db } from '@/lib/firebase';
import { addDoc, collection, serverTimestamp, doc, updateDoc } from 'firebase/firestore';
import { X, Check, Loader2 } from 'lucide-react';
import { logActivity } from '@/lib/logActivity';

type Props = {
  isOpen: boolean;
  onClose: () => void;
  onComplete: () => void;
  request: any; // subjectsが含まれている前提
  studentId: string;
};

// デフォルト値 (古いデータ用)
const DEFAULT_SUBJECTS = ['英語', '数学', '国語', '理科', '社会'];

export default function RegistrationModal({ isOpen, onClose, onComplete, request, studentId }: Props) {
  const [selectedSubjects, setSelectedSubjects] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);

  if (!isOpen || !request) return null;

  // ★修正: リクエストデータ内の科目を使う（なければデフォルト）
  const subjectsToDisplay = request.subjects && request.subjects.length > 0 
    ? request.subjects 
    : DEFAULT_SUBJECTS;

  const toggleSubject = (sub: string) => {
    if (selectedSubjects.includes(sub)) {
      setSelectedSubjects(prev => prev.filter(s => s !== sub));
    } else {
      setSelectedSubjects(prev => [...prev, sub]);
    }
  };

  const handleSubmit = async () => {
    if (selectedSubjects.length === 0) return alert('科目を1つ以上選択してください');
    
    const message = request.type === 'initial' 
      ? '選択した科目でプロフィールを更新してよろしいですか？'
      : 'この内容でテスト対策科目を登録しますか？';

    if (!confirm(message)) return;

    setSubmitting(true);
    try {
      // 1. 回答履歴として保存
      await addDoc(collection(db, 'student_registrations'), {
        request_id: request.id,
        student_id: studentId,
        subjects: selectedSubjects,
        submitted_at: serverTimestamp(),
      });

      // 2. 生徒プロフィール更新
      const userRef = doc(db, 'users', studentId);
      const updateData: any = {
        updated_at: new Date().toISOString()
      };

      if (request.type === 'initial') {
        updateData.subjects = selectedSubjects;
      } else {
        updateData.subjects = selectedSubjects;
        // updateData.test_subjects = selectedSubjects; // 必要であれば
      }

      await updateDoc(userRef, updateData);

      alert('登録し、科目を更新しました！');
      onComplete(); 
    } catch (e) {
      console.error(e);
      alert('エラーが発生しました');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[200] bg-black/50 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-200">
      <div className="bg-white w-full max-w-md rounded-3xl shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200 max-h-[90vh] flex flex-col">
        
        {/* ヘッダー */}
        <div className="bg-gradient-to-r from-indigo-600 to-purple-600 p-6 text-white relative shrink-0">
          <h2 className="text-xl font-black mb-1">📝 {request.title}</h2>
          <p className="text-xs opacity-90 font-bold">受講したい科目を選択してください</p>
          <button 
            onClick={onClose} 
            className="absolute top-4 right-4 bg-white/20 p-2 rounded-full hover:bg-white/30 transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        {/* コンテンツ (スクロール可能に) */}
        <div className="p-6 overflow-y-auto">
          <div className="grid grid-cols-2 gap-3 mb-8">
            {subjectsToDisplay.map((sub: string) => {
              const isSelected = selectedSubjects.includes(sub);
              return (
                <button
                  key={sub}
                  onClick={() => toggleSubject(sub)}
                  className={`p-4 rounded-xl font-bold text-sm flex items-center justify-between transition-all border-2 ${
                    isSelected 
                      ? 'border-indigo-500 bg-indigo-50 text-indigo-700 shadow-md transform scale-[1.02]' 
                      : 'border-gray-100 bg-white text-gray-500 hover:bg-gray-50'
                  }`}
                >
                  {sub}
                  {isSelected && <Check size={16} className="text-indigo-600"/>}
                </button>
              );
            })}
          </div>

          <div className="bg-yellow-50 p-3 rounded-xl mb-4 border border-yellow-100">
            <p className="text-[10px] text-yellow-700 font-bold">
              ※「登録する」を押すと、あなたの受講科目が選択した内容に変更されます。
            </p>
          </div>

          <div className="flex gap-3">
            <button 
              onClick={onClose}
              className="flex-1 py-3 text-gray-400 font-bold text-sm hover:bg-gray-50 rounded-xl"
            >
              あとで
            </button>
            <button 
              onClick={handleSubmit}
              disabled={submitting}
              className="flex-[2] bg-indigo-600 text-white font-bold py-3 rounded-xl shadow-lg hover:bg-indigo-700 active:scale-95 transition-all flex items-center justify-center gap-2"
            >
              {submitting ? <Loader2 className="animate-spin"/> : <Check size={18}/>}
              登録・変更する
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}