'use client';

import { useState, useEffect, use, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { db, storage } from '@/lib/firebase';
import { doc, getDoc, collection, query, where, getDocs, updateDoc, setDoc } from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { ArrowLeft, CheckCircle, User, MessageSquare, ExternalLink, RefreshCw, XCircle, Send, Stamp, Plus, ImageIcon } from 'lucide-react';
import Link from 'next/link';
import Image from 'next/image';

// デフォルトのスタンプリスト（必要に応じて画像URLを差し替えてください）
const DEFAULT_STAMPS = [
  { id: 'good', url: 'https://placehold.co/150x150/FF9999/white?text=GOOD' },
  { id: 'great', url: 'https://placehold.co/150x150/99FF99/white?text=GREAT' },
  { id: 'check', url: 'https://placehold.co/150x150/9999FF/white?text=CHECK' },
  { id: 'ok', url: 'https://placehold.co/150x150/FFFF99/black?text=OK' },
];

export default function TeacherHomeworkCheckPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const assignmentId = id;

  const [assignment, setAssignment] = useState<any>(null);
  const [submissions, setSubmissions] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  
  // 拡大表示用
  const [zoomImage, setZoomImage] = useState<string | null>(null);
  
  // 再提出用モーダル状態
  const [feedbackInput, setFeedbackInput] = useState<{id: string, text: string} | null>(null);

  // ■ 合格・スタンプ用モーダル状態
  const [checkModal, setCheckModal] = useState<{id: string, student_name: string, imageUrl: string} | null>(null);
  const [teacherComment, setTeacherComment] = useState('');
  const [selectedStamp, setSelectedStamp] = useState<string | null>(null);
  const [customStamps, setCustomStamps] = useState<{id: string, url: string}[]>([]);
  const stampInputRef = useRef<HTMLInputElement>(null);

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

  // ■ OK (合格) モーダルを開く
  const openCheckModal = (sub: any) => {
    setCheckModal({
      id: sub.id,
      student_name: sub.student_name,
      imageUrl: sub.imageUrl
    });
    setTeacherComment('');
    setSelectedStamp(DEFAULT_STAMPS[0].url); // デフォルト選択
  };

  // ■ オリジナルスタンプ画像の追加
  const handleAddStamp = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      try {
        // Storageにスタンプ用としてアップロード
        const storageRef = ref(storage, `stamps/teacher_${Date.now()}_${file.name}`);
        const snapshot = await uploadBytes(storageRef, file);
        const url = await getDownloadURL(snapshot.ref);
        
        // リストに追加して選択状態にする
        setCustomStamps(prev => [...prev, { id: `custom_${Date.now()}`, url }]);
        setSelectedStamp(url);
      } catch (err) {
        alert('スタンプのアップロードに失敗しました');
      }
    }
  };

  // ■ 合格確定処理
  const submitCheck = async () => {
    if (!checkModal) return;

    try {
      // 1. 提出ステータスとコメント・スタンプを更新
      await updateDoc(doc(db, 'submissions', checkModal.id), {
        status: 'checked',
        checked_at: new Date().toISOString(),
        feedback: null, // 再提出理由があれば消す
        teacher_comment: teacherComment, // 先生のコメント
        stamp_url: selectedStamp // スタンプ画像URL
      });

      // 2. PF連携 (成績付与) - 既存ロジック
      const sub = submissions.find(s => s.id === checkModal.id);
      if (sub && assignment.target_week && assignment.subject) {
        const weekNum = assignment.target_week.replace(/[^0-9]/g, '');
        if (weekNum) {
          const pfId = `${sub.student_id}_w${weekNum}`;
          const pfRef = doc(db, 'pf_records', pfId);
          const pfUpdateData: any = {
            student_id: sub.student_id,
            week_number: weekNum,
            updated_at: new Date().toISOString()
          };
          if (assignment.subject.includes('理科') || assignment.subject.includes('物理') || assignment.subject.includes('化学') || assignment.subject.includes('生物')) {
            pfUpdateData.homework_science = '〇';
          } else if (assignment.subject.includes('社会') || assignment.subject.includes('地理') || assignment.subject.includes('歴史') || assignment.subject.includes('公民')) {
            pfUpdateData.homework_social = '〇';
          }
          if (pfUpdateData.homework_science || pfUpdateData.homework_social) {
            await setDoc(pfRef, pfUpdateData, { merge: true });
          }
        }
      }

      // UI更新
      setSubmissions(prev => prev.map(item => 
        item.id === checkModal.id ? { 
          ...item, 
          status: 'checked', 
          teacher_comment: teacherComment,
          stamp_url: selectedStamp
        } : item
      ));

      setCheckModal(null); // 閉じる

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
        status: 'resubmit',
        feedback: feedbackInput.text,
        checked_at: new Date().toISOString(),
        teacher_comment: null,
        stamp_url: null
      });

      setSubmissions(prev => prev.map(item => 
        item.id === feedbackInput.id ? { ...item, status: 'resubmit', feedback: feedbackInput.text, teacher_comment: null, stamp_url: null } : item
      ));
      
      setFeedbackInput(null);

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

        {/* 提出カード一覧 */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {submissions.map((sub) => (
            <div key={sub.id} className={`bg-white rounded-2xl shadow-sm border-2 overflow-hidden flex flex-col ${
              sub.status === 'checked' ? 'border-green-400' :
              sub.status === 'resubmit' ? 'border-red-400' : 'border-gray-200'
            }`}>
              
              {/* ヘッダー */}
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

              {/* 画像エリア (スタンプがあれば表示) */}
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
                    {/* スタンプ表示 */}
                    {sub.stamp_url && (
                      <div className="absolute top-2 right-2 w-16 h-16 rotate-12 drop-shadow-md">
                        <Image src={sub.stamp_url} alt="Stamp" fill className="object-contain" unoptimized />
                      </div>
                    )}
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

                {/* 先生のコメント表示 */}
                {sub.teacher_comment && (
                  <div className="bg-green-50 p-2 rounded text-xs text-green-800 border border-green-100">
                    <span className="font-bold block mb-1 flex items-center gap-1"><CheckCircle size={10}/> 先生コメント:</span>
                    {sub.teacher_comment}
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
                  {/* 合格ボタンを更新 */}
                  <button 
                    onClick={() => openCheckModal(sub)}
                    className={`py-2 rounded-lg text-xs font-bold transition-colors flex items-center justify-center gap-1 ${
                      sub.status === 'checked' 
                      ? 'bg-green-100 text-green-700 hover:bg-green-200' 
                      : 'bg-blue-600 text-white hover:bg-blue-700 shadow-sm'
                    }`}
                  >
                    <Stamp size={14}/> {sub.status === 'checked' ? '修正・コメント' : '合格・スタンプ'}
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

      {/* ■ 合格・スタンプ付与モーダル */}
      {checkModal && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4 backdrop-blur-sm animate-in fade-in">
          <div className="bg-white w-full max-w-2xl rounded-3xl overflow-hidden shadow-2xl flex flex-col md:flex-row max-h-[90vh]">
            
            {/* 左側：画像プレビューとスタンプ配置イメージ */}
            <div className="bg-gray-100 md:w-1/2 p-4 flex flex-col items-center justify-center relative min-h-[300px]">
               <div className="relative w-full h-full min-h-[250px] bg-white rounded-lg shadow-sm overflow-hidden">
                 <Image src={checkModal.imageUrl} alt="生徒の提出" fill className="object-contain" unoptimized />
                 {/* 選択中のスタンプをオーバーレイ表示 */}
                 {selectedStamp && (
                   <div className="absolute top-4 right-4 w-24 h-24 rotate-12 drop-shadow-lg transition-all animate-in zoom-in">
                     <Image src={selectedStamp} alt="スタンプ" fill className="object-contain" unoptimized />
                   </div>
                 )}
               </div>
               <p className="text-xs text-gray-400 mt-2 text-center">※スタンプは右上に表示されます</p>
            </div>

            {/* 右側：操作パネル */}
            <div className="md:w-1/2 p-6 flex flex-col bg-white overflow-y-auto">
              <h3 className="text-xl font-bold text-gray-800 mb-1 flex items-center gap-2">
                <Stamp className="text-green-500" /> 
                {checkModal.student_name} さん
              </h3>
              <p className="text-sm text-gray-400 mb-6">スタンプとコメントを送って合格にします</p>

              {/* スタンプ選択 */}
              <div className="mb-6">
                <label className="text-xs font-bold text-gray-500 mb-2 block">スタンプを選択</label>
                <div className="grid grid-cols-4 gap-2">
                  {/* デフォルトスタンプ */}
                  {DEFAULT_STAMPS.map(stamp => (
                    <button
                      key={stamp.id}
                      onClick={() => setSelectedStamp(stamp.url)}
                      className={`aspect-square rounded-xl border-2 p-1 relative overflow-hidden transition-all ${selectedStamp === stamp.url ? 'border-green-500 bg-green-50 ring-2 ring-green-200' : 'border-gray-100 hover:bg-gray-50'}`}
                    >
                      <Image src={stamp.url} alt={stamp.id} fill className="object-contain p-1" unoptimized />
                    </button>
                  ))}
                  
                  {/* 追加されたスタンプ */}
                  {customStamps.map(stamp => (
                    <button
                      key={stamp.id}
                      onClick={() => setSelectedStamp(stamp.url)}
                      className={`aspect-square rounded-xl border-2 p-1 relative overflow-hidden transition-all ${selectedStamp === stamp.url ? 'border-green-500 bg-green-50 ring-2 ring-green-200' : 'border-gray-100 hover:bg-gray-50'}`}
                    >
                      <Image src={stamp.url} alt={stamp.id} fill className="object-contain p-1" unoptimized />
                    </button>
                  ))}

                  {/* スタンプ追加ボタン */}
                  <button 
                    onClick={() => stampInputRef.current?.click()}
                    className="aspect-square rounded-xl border-2 border-dashed border-gray-300 flex flex-col items-center justify-center text-gray-400 hover:bg-gray-50 hover:border-gray-400 transition-colors"
                  >
                    <Plus size={20} />
                    <span className="text-[10px] font-bold">追加</span>
                  </button>
                  <input type="file" ref={stampInputRef} onChange={handleAddStamp} className="hidden" accept="image/*" />
                </div>
              </div>

              {/* コメント入力 */}
              <div className="mb-6 flex-1">
                <label className="text-xs font-bold text-gray-500 mb-2 block">先生からのコメント (任意)</label>
                <textarea 
                  className="w-full h-24 p-3 border border-gray-200 rounded-xl bg-gray-50 focus:bg-white outline-none focus:ring-2 focus:ring-green-200 resize-none text-sm"
                  placeholder="よくできました！この調子で頑張ろう！"
                  value={teacherComment}
                  onChange={(e) => setTeacherComment(e.target.value)}
                />
              </div>

              {/* アクションボタン */}
              <div className="flex gap-3 mt-auto">
                <button 
                  onClick={() => setCheckModal(null)} 
                  className="flex-1 py-3 text-gray-500 font-bold hover:bg-gray-100 rounded-xl transition-colors"
                >
                  キャンセル
                </button>
                <button 
                  onClick={submitCheck} 
                  className="flex-[2] py-3 bg-green-500 text-white font-bold rounded-xl hover:bg-green-600 shadow-lg shadow-green-100 flex items-center justify-center gap-2 transform active:scale-95 transition-all"
                >
                  <Send size={18} />
                  送信して合格
                </button>
              </div>
            </div>
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