'use client';

import { useState, useEffect, use } from 'react';
import { useRouter } from 'next/navigation';
import { db } from '@/lib/firebase';
import { doc, getDoc, collection, query, where, getDocs, updateDoc, setDoc } from 'firebase/firestore';
import { ArrowLeft, CheckCircle, User, MessageSquare, ExternalLink, RefreshCw, XCircle, Send } from 'lucide-react';
import Link from 'next/link';
import Image from 'next/image';

export default function TeacherHomeworkCheckPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const assignmentId = id;

  const [assignment, setAssignment] = useState<any>(null);
  const [submissions, setSubmissions] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  
  // モーダル・入力用
  const [zoomImage, setZoomImage] = useState<string | null>(null);
  const [feedbackInput, setFeedbackInput] = useState<{id: string, text: string} | null>(null); // 再提出コメント入力用

  useEffect(() => {
    fetchData();
  }, [assignmentId]);

  const fetchData = async () => {
    try {
      // 課題情報の取得
      const assignSnap = await getDoc(doc(db, 'assignments', assignmentId));
      if (!assignSnap.exists()) return;
      setAssignment({ id: assignSnap.id, ...assignSnap.data() });

      // 提出物の取得
      const q = query(collection(db, 'submissions'), where('assignment_id', '==', assignmentId));
      const subSnap = await getDocs(q);
      
      const list = subSnap.docs.map(d => ({ id: d.id, ...d.data() } as any));
      // 日付順にソート (新しい順)
      list.sort((a: any, b: any) => new Date(b.submitted_at).getTime() - new Date(a.submitted_at).getTime());
      setSubmissions(list);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  // ■ OK (合格) 処理
  const handleOk = async (sub: any) => {
    if (!confirm(`${sub.student_name} さんを「合格」にしますか？\n(PFに丸がつきます)`)) return;

    try {
      // 1. 提出ステータスを更新
      await updateDoc(doc(db, 'submissions', sub.id), {
        status: 'checked',
        checked_at: new Date().toISOString(),
        feedback: null // 再提出コメントがあれば消す
      });

      // 2. PF連携 (ここで成績をつける)
      if (assignment.target_week && assignment.subject) {
        const weekNum = assignment.target_week.replace(/[^0-9]/g, '');
        if (weekNum) {
          const pfId = `${sub.student_id}_w${weekNum}`;
          const pfRef = doc(db, 'pf_records', pfId);
          
          const pfUpdateData: any = {
            student_id: sub.student_id,
            week_number: weekNum,
            updated_at: new Date().toISOString()
          };

          // 科目判定
          if (assignment.subject.includes('理科') || assignment.subject.includes('物理') || assignment.subject.includes('化学') || assignment.subject.includes('生物')) {
            pfUpdateData.homework_science = '〇';
          } else if (assignment.subject.includes('社会') || assignment.subject.includes('地理') || assignment.subject.includes('歴史') || assignment.subject.includes('公民')) {
            pfUpdateData.homework_social = '〇';
          }

          // PF更新 (なければ作成)
          if (pfUpdateData.homework_science || pfUpdateData.homework_social) {
            await setDoc(pfRef, pfUpdateData, { merge: true });
          }
        }
      }

      // UI更新
      setSubmissions(prev => prev.map(item => 
        item.id === sub.id ? { ...item, status: 'checked' } : item
      ));

    } catch (e) {
      alert('エラー: ' + e);
    }
  };

  // ■ 再提出 処理 (コメント入力画面を開く)
  const openResubmitModal = (subId: string) => {
    setFeedbackInput({ id: subId, text: '' });
  };

  // 再提出実行
  const submitResubmit = async () => {
    if (!feedbackInput || !feedbackInput.text.trim()) return alert('再提出の理由を入力してください');
    
    try {
      await updateDoc(doc(db, 'submissions', feedbackInput.id), {
        status: 'resubmit', // ステータス変更
        feedback: feedbackInput.text, // 理由
        checked_at: new Date().toISOString()
      });

      setSubmissions(prev => prev.map(item => 
        item.id === feedbackInput.id ? { ...item, status: 'resubmit', feedback: feedbackInput.text } : item
      ));
      
      setFeedbackInput(null); // 閉じる

    } catch (e) {
      alert('エラー: ' + e);
    }
  };

  if (loading) return <div className="p-10 text-center">読み込み中...</div>;
  if (!assignment) return <div className="p-10 text-center">課題が見つかりません</div>;

  return (
    <div className="min-h-screen bg-gray-50 p-6 pb-32 font-sans">
      <div className="max-w-6xl mx-auto">
        
        {/* ヘッダー */}
        <div className="flex items-center justify-between mb-8">
          <div className="flex items-center gap-4">
            <Link href="/teacher/homework" className="bg-white p-2 rounded-full shadow text-gray-600">
              <ArrowLeft size={20} />
            </Link>
            <div>
              <h1 className="text-2xl font-bold text-gray-800">{assignment.title}</h1>
              <p className="text-sm text-gray-500">提出状況チェック</p>
            </div>
          </div>
          <div className="bg-white px-4 py-2 rounded-lg shadow-sm font-bold text-gray-600">
            提出数: {submissions.length} 名
          </div>
        </div>

        {/* 提出カード一覧 (ロイロノート風グリッド) */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {submissions.map((sub) => (
            <div key={sub.id} className={`bg-white rounded-2xl shadow-sm border-2 overflow-hidden flex flex-col ${
              sub.status === 'checked' ? 'border-green-400' :
              sub.status === 'resubmit' ? 'border-red-400' : 'border-gray-200'
            }`}>
              
              {/* ヘッダー: 生徒名とステータス */}
              <div className="p-3 border-b border-gray-100 flex justify-between items-center bg-gray-50">
                <div className="font-bold text-gray-800 flex items-center gap-2">
                  <User size={16} className="text-gray-400"/>
                  {sub.student_name}
                </div>
                <div>
                  {sub.status === 'checked' && <span className="text-[10px] font-bold bg-green-100 text-green-700 px-2 py-1 rounded-full">合格</span>}
                  {sub.status === 'resubmit' && <span className="text-[10px] font-bold bg-red-100 text-red-700 px-2 py-1 rounded-full">再提出</span>}
                  {sub.status === 'submitted' && <span className="text-[10px] font-bold bg-blue-100 text-blue-700 px-2 py-1 rounded-full">未チェック</span>}
                </div>
              </div>

              {/* 画像エリア */}
              <div className="relative aspect-video bg-gray-100 group">
                {sub.imageUrl ? (
                  <>
                    <Image 
                      src={sub.imageUrl} 
                      alt="提出画像" 
                      fill 
                      className="object-contain"
                      unoptimized
                    />
                    <button 
                      onClick={() => setZoomImage(sub.imageUrl)}
                      className="absolute inset-0 bg-black/20 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center text-white font-bold gap-2"
                    >
                      <ExternalLink size={24}/>
                    </button>
                  </>
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-gray-400 text-xs">画像なし</div>
                )}
              </div>

              {/* コメント・アクションエリア */}
              <div className="p-4 flex-1 flex flex-col gap-3">
                {sub.comment && (
                  <div className="bg-blue-50 p-2 rounded text-xs text-gray-700 relative">
                     <MessageSquare size={12} className="absolute top-2 right-2 text-blue-200"/>
                     <span className="font-bold text-blue-400 block mb-1">生徒コメント:</span>
                     {sub.comment}
                  </div>
                )}

                {sub.status === 'resubmit' && sub.feedback && (
                  <div className="bg-red-50 p-2 rounded text-xs text-red-700">
                    <span className="font-bold block mb-1">再提出理由:</span>
                    {sub.feedback}
                  </div>
                )}

                <div className="mt-auto grid grid-cols-2 gap-2 pt-2">
                  <button 
                    onClick={() => openResubmitModal(sub.id)}
                    className="bg-gray-100 text-gray-600 py-2 rounded-lg text-xs font-bold hover:bg-red-50 hover:text-red-600 transition-colors flex items-center justify-center gap-1"
                  >
                    <RefreshCw size={14}/> 再提出
                  </button>
                  <button 
                    onClick={() => handleOk(sub)}
                    className={`py-2 rounded-lg text-xs font-bold transition-colors flex items-center justify-center gap-1 ${
                      sub.status === 'checked' 
                      ? 'bg-green-100 text-green-700 cursor-default' 
                      : 'bg-blue-600 text-white hover:bg-blue-700 shadow-sm'
                    }`}
                    disabled={sub.status === 'checked'}
                  >
                    <CheckCircle size={14}/> {sub.status === 'checked' ? '合格済み' : 'OK (合格)'}
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* 画像拡大モーダル */}
      {zoomImage && (
        <div className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center p-4" onClick={() => setZoomImage(null)}>
          <div className="relative w-full max-w-5xl h-[90vh]">
            <Image src={zoomImage} alt="拡大" fill className="object-contain" unoptimized />
            <button className="absolute top-4 right-4 text-white bg-gray-800/50 p-2 rounded-full"><XCircle size={32}/></button>
          </div>
        </div>
      )}

      {/* 再提出理由入力モーダル */}
      {feedbackInput && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-md rounded-2xl p-6 shadow-xl animate-in zoom-in-95">
            <h3 className="text-lg font-bold text-gray-800 mb-4 flex items-center gap-2">
              <RefreshCw className="text-red-500"/> 再提出を求める
            </h3>
            <p className="text-sm text-gray-500 mb-2">理由を入力して返却してください</p>
            <textarea 
              className="w-full h-32 p-3 border border-gray-200 rounded-xl bg-gray-50 focus:bg-white outline-none focus:ring-2 focus:ring-red-200 resize-none text-sm"
              placeholder="例: 画像がぼやけて読めません。もう一度撮影してください。"
              value={feedbackInput.text}
              onChange={(e) => setFeedbackInput({...feedbackInput, text: e.target.value})}
              autoFocus
            />
            <div className="flex justify-end gap-3 mt-4">
              <button onClick={() => setFeedbackInput(null)} className="px-4 py-2 text-gray-500 font-bold hover:bg-gray-100 rounded-lg">キャンセル</button>
              <button onClick={submitResubmit} className="px-6 py-2 bg-red-500 text-white font-bold rounded-lg hover:bg-red-600 shadow-md flex items-center gap-2">
                <Send size={16}/> 送信
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}