'use client';

import { useState, useEffect, use, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { db, storage } from '@/lib/firebase';
import { doc, getDoc, setDoc, updateDoc, increment, arrayUnion } from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { useAuth } from '@/app/context/AuthContext';
import { ArrowLeft, Clock, Send, CheckCircle, AlertCircle, Loader2, Image as ImageIcon, X, Plus, ExternalLink, RefreshCw, Calendar, FileText, Stamp, MessageCircle } from 'lucide-react';
import Link from 'next/link';
import Image from 'next/image';

export default function HomeworkDetailPage({ params }: { params: Promise<{ id: string }> }) {
  // Next.js 13+ (App Router) の params アンラップ
  const { id } = use(params);
  const assignmentId = id;

  const { user, profile, loading: authLoading } = useAuth();
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [assignment, setAssignment] = useState<any>(null);
  const [submission, setSubmission] = useState<any>(null);
  
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [comment, setComment] = useState('');
  
  const [zoomImage, setZoomImage] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (assignmentId && !authLoading) {
      if (!user) { router.push('/'); return; }
      fetchData();
    }
  }, [assignmentId, user, authLoading, router]);

  const fetchData = async () => {
    try {
      // ★修正: コレクション名を 'assignments' から 'homework_assignments' に変更
      const assignSnap = await getDoc(doc(db, 'homework_assignments', assignmentId));
      
      if (!assignSnap.exists()) {
        // ID間違いなどで存在しない場合
        console.error('Homework not found:', assignmentId);
        setAssignment(null); 
        return;
      }
      setAssignment({ id: assignSnap.id, ...assignSnap.data() });

      // 提出状況の取得
      const subId = `${assignmentId}_${user!.uid}`;
      const subSnap = await getDoc(doc(db, 'submissions', subId));

      if (subSnap.exists()) {
        const subData = subSnap.data();
        setSubmission(subData);
        setComment(subData.comment || '');
      }
    } catch (e: any) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      if (!file.type.startsWith('image/')) { alert('画像ファイルを選択してください'); return; }
      setSelectedFile(file);
      const reader = new FileReader();
      reader.onloadend = () => setPreviewUrl(reader.result as string);
      reader.readAsDataURL(file);
    }
  };

  const clearSelection = () => {
    setSelectedFile(null);
    setPreviewUrl(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleSubmit = async () => {
    if (!selectedFile) return alert('提出する画像を選択してください');
    if (!confirm('この画像で提出しますか？\n(提出すると50コイン獲得できます！)')) return;

    setSubmitting(true);
    
    try {
      if (!user) throw new Error('ログインセッション切れ');

      // 画像アップロード
      const fileExtension = selectedFile.name.split('.').pop() || 'jpg';
      const storagePath = `submissions/${assignmentId}/${user.uid}_${Date.now()}.${fileExtension}`;
      const storageRef = ref(storage, storagePath);
      const snapshot = await uploadBytes(storageRef, selectedFile);
      const imageUrl = await getDownloadURL(snapshot.ref);

      // Firestoreへ保存
      const subId = `${assignmentId}_${user.uid}`;
      const subRef = doc(db, 'submissions', subId);

      const studentName = profile?.student_name || user.displayName || '生徒';

      const submissionData = {
        assignment_id: assignmentId,
        student_id: user.uid,
        student_name: studentName,
        imageUrl: imageUrl,
        comment: comment,
        status: 'submitted', // 提出済み (先生確認待ち)
        submitted_at: new Date().toISOString(),
        feedback: null
      };

      await setDoc(subRef, submissionData, { merge: true });

      // コイン付与 (初回提出時のみなど制御が必要な場合は別途ロジック追加)
      // ここでは提出ごとに加算（または1課題につき1回にするならsubmissionsコレクションをチェックするなど）
      const userRef = doc(db, 'users', user.uid);
      await updateDoc(userRef, {
        coins: increment(50),
        total_coins: increment(50),
        homework_count: increment(1),
        // 初めてならバッジ付与などの処理
        earned_badges: arrayUnion('badge_pencil') 
      });

      alert('提出しました！ 50コイン獲得！');
      setSelectedFile(null);
      setPreviewUrl(null);
      await fetchData(); // 画面更新

    } catch (e: any) {
      alert('エラー: ' + e.message);
    } finally {
      setSubmitting(false);
    }
  };

  if (loading || authLoading) return <div className="min-h-screen flex items-center justify-center bg-indigo-50"><Loader2 className="animate-spin text-indigo-400" size={40}/></div>;
  if (!assignment) return <div className="min-h-screen flex items-center justify-center text-gray-400 font-bold">課題が見つかりません</div>;

  const isLate = new Date() > new Date(assignment.deadline);
  // 再提出ステータスの場合もフォームを表示する
  const showForm = !submission || submission.status === 'resubmit';

  // 科目判定
  const subject = assignment.subject || '';
  const isScience = subject.includes('理科') || ['物理','化学','生物','地学'].some((s:string) => subject.includes(s));
  const isSociety = subject.includes('社会') || ['地理','歴史','公民'].some((s:string) => subject.includes(s));
  
  const bgAccent = isScience ? 'bg-green-500' : isSociety ? 'bg-yellow-500' : 'bg-blue-500';
  const textAccent = isScience ? 'text-green-600' : isSociety ? 'text-yellow-600' : 'text-blue-600';
  const bgSoftAccent = isScience ? 'bg-green-50' : isSociety ? 'bg-yellow-50' : 'bg-blue-50';

  return (
    <div className="min-h-screen bg-[#F0F4F8] p-4 pb-32 font-sans sm:p-8">
      <div className="max-w-3xl mx-auto">
        
        {/* ヘッダー */}
        <div className="flex items-center gap-4 mb-8">
          <Link href="/student/homework" className="bg-white p-4 rounded-full shadow-sm text-gray-400 hover:text-indigo-600 hover:shadow-md transition-all active:scale-95">
            <ArrowLeft size={24} strokeWidth={3} />
          </Link>
          <h1 className="text-2xl font-black text-gray-800">課題詳細</h1>
        </div>

        {/* 課題情報カード */}
        <div className="bg-white rounded-[40px] shadow-xl shadow-indigo-100 overflow-hidden mb-8 relative border-4 border-white">
          <div className={`${bgSoftAccent} p-6 sm:p-8 relative`}>
             <div className="absolute top-6 right-6 z-10">
                {submission?.status === 'checked' ? (
                   <span className="flex items-center gap-1.5 text-xs font-black text-green-600 bg-white px-4 py-2 rounded-full shadow-sm"><CheckCircle size={16} strokeWidth={3}/> 合格</span>
                ) : submission?.status === 'resubmit' ? (
                   <span className="flex items-center gap-1.5 text-xs font-black text-white bg-red-500 px-4 py-2 rounded-full shadow-sm animate-pulse"><RefreshCw size={16} strokeWidth={3}/> 再提出</span>
                ) : submission ? (
                   <span className="flex items-center gap-1.5 text-xs font-black text-blue-600 bg-white px-4 py-2 rounded-full shadow-sm"><Clock size={16} strokeWidth={3}/> 確認中</span>
                ) : isLate ? (
                   <span className="flex items-center gap-1.5 text-xs font-black text-red-600 bg-white px-4 py-2 rounded-full shadow-sm"><AlertCircle size={16} strokeWidth={3}/> 期限切れ</span>
                ) : (
                   <span className="flex items-center gap-1.5 text-xs font-black text-gray-500 bg-white/80 px-4 py-2 rounded-full shadow-sm backdrop-blur-sm">未提出</span>
                )}
             </div>

             <div className="pr-24">
               <span className={`inline-block px-4 py-1.5 rounded-xl text-xs font-black text-white ${bgAccent} mb-4 shadow-sm`}>
                 {assignment.subject || '課題'}
               </span>
               <h2 className="text-2xl sm:text-3xl font-black text-gray-900 mb-4 leading-tight">
                 {assignment.title}
               </h2>
               <div className="flex flex-wrap gap-3">
                 <span className="inline-flex items-center gap-2 text-sm font-bold text-gray-600 bg-white/60 px-3 py-1.5 rounded-lg backdrop-blur-sm">
                   <Calendar size={16} className={textAccent}/> {new Date(assignment.deadline).toLocaleDateString()}
                 </span>
                 <span className="inline-flex items-center gap-2 text-sm font-bold text-gray-600 bg-white/60 px-3 py-1.5 rounded-lg backdrop-blur-sm">
                   <Clock size={16} className={textAccent}/> {new Date(assignment.deadline).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}
                 </span>
               </div>
             </div>
          </div>
          
          <div className="p-6 sm:p-8 pt-6">
            <div className="flex items-start gap-3">
              <FileText className="text-gray-300 mt-1 shrink-0" size={24}/>
              <div className="prose prose-stone prose-sm sm:prose-base max-w-none text-gray-700 font-medium leading-relaxed whitespace-pre-wrap">
                {assignment.description || '詳細はありません'}
              </div>
            </div>
          </div>
        </div>

        {/* 先生からのコメント & スタンプ（合格時のみ表示） */}
        {submission?.status === 'checked' && (
           <div className="bg-green-50 border-4 border-green-200 p-6 rounded-[32px] mb-8 shadow-sm animate-in slide-in-from-top-2">
             <h3 className="text-green-600 font-black flex items-center gap-2 mb-4 text-lg">
               <Stamp size={24} strokeWidth={3}/>
               先生からのコメント
             </h3>
             
             {/* 先生コメント */}
             {submission.teacher_comment && (
               <div className="bg-white p-5 rounded-2xl text-gray-800 font-bold text-lg shadow-sm border border-green-100 relative mb-4">
                 <div className="absolute -top-3 left-6 w-6 h-6 bg-white rotate-45 border-t border-l border-green-100"></div>
                 <div className="flex items-start gap-2">
                   <MessageCircle size={20} className="text-green-400 mt-1 shrink-0"/>
                   {submission.teacher_comment}
                 </div>
               </div>
             )}

             {/* スタンプがなければデフォルトメッセージ */}
             {!submission.teacher_comment && !submission.stamp_url && (
               <p className="text-center font-bold text-green-600">よく頑張りました！合格です！🎉</p>
             )}
           </div>
        )}

        {/* 再提出時のフィードバック表示 */}
        {submission?.status === 'resubmit' && submission.feedback && (
          <div className="bg-red-50 border-4 border-red-200 p-6 rounded-[32px] mb-8 shadow-sm animate-in slide-in-from-top-2">
            <h3 className="text-red-500 font-black flex items-center gap-2 mb-2 text-lg">
              <RefreshCw size={24} strokeWidth={3}/>
              再提出について
            </h3>
            <div className="bg-white p-5 rounded-2xl text-gray-800 font-bold text-lg shadow-sm border border-red-100 relative">
              <div className="absolute -top-3 left-6 w-6 h-6 bg-white rotate-45 border-t border-l border-red-100"></div>
              {submission.feedback}
            </div>
            <p className="text-center text-xs font-bold text-red-400 mt-3">※内容を確認して、もう一度画像をアップロードしよう！</p>
          </div>
        )}

        {/* 提出フォーム or 提出済み表示 */}
        <div className="bg-white p-6 sm:p-8 rounded-[40px] shadow-xl shadow-indigo-50 border-2 border-indigo-50/50">
          <h3 className="text-xl font-black text-gray-800 mb-8 flex items-center gap-3">
            <span className={`p-2 rounded-xl ${showForm ? 'bg-orange-100 text-orange-500' : 'bg-green-100 text-green-500'}`}>
              {showForm ? <ImageIcon size={24} strokeWidth={3}/> : <CheckCircle size={24} strokeWidth={3}/>}
            </span>
            {showForm ? '回答を提出する' : '提出済みの回答'}
          </h3>

          {!showForm ? (
            // 提出済み (チェック待ち or 合格)
            <div className="flex flex-col items-center gap-6">
              <div 
                className="relative w-full sm:w-2/3 aspect-[4/3] rounded-3xl overflow-hidden border-4 border-gray-100 bg-gray-50 cursor-zoom-in group shadow-lg hover:shadow-xl transition-all"
                onClick={() => setZoomImage(submission.imageUrl)}
              >
                <Image src={submission.imageUrl} alt="提出画像" fill className="object-cover" unoptimized />
                
                {/* スタンプ表示 */}
                {submission.status === 'checked' && submission.stamp_url && (
                   <div className="absolute top-4 right-4 w-1/3 aspect-square rotate-12 drop-shadow-xl animate-in zoom-in duration-500">
                     <Image src={submission.stamp_url} alt="先生からのスタンプ" fill className="object-contain" unoptimized />
                   </div>
                )}

                <div className="absolute inset-0 bg-black/30 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center text-white font-bold gap-2 backdrop-blur-sm">
                  <ExternalLink strokeWidth={3}/> 拡大して見る
                </div>
              </div>
              <div className="text-center bg-gray-50 px-6 py-3 rounded-2xl">
                <p className="text-gray-500 font-bold text-sm">
                  {submission.status === 'checked' ? '🎉 合格です！よく頑張りました！' : '👨‍🏫 先生が確認中です。しばらくお待ちください。'}
                </p>
              </div>
            </div>
          ) : (
            // フォーム (未提出 or 再提出)
            <div className="space-y-8">
              <input type="file" accept="image/*" ref={fileInputRef} onChange={handleFileChange} className="hidden" />
              
              <div className="flex flex-col items-center">
                {previewUrl ? (
                  <div className="relative w-full sm:w-2/3 aspect-[4/3] rounded-3xl overflow-hidden border-4 border-orange-100 shadow-lg bg-gray-50 group">
                    <Image src={previewUrl} alt="プレビュー" fill className="object-contain" unoptimized />
                    <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-all flex items-center justify-center">
                      <button 
                        onClick={clearSelection} 
                        className="bg-white text-red-500 px-6 py-3 rounded-full font-bold shadow-lg flex items-center gap-2 hover:scale-105 active:scale-95 transition-transform"
                      >
                        <X size={20} strokeWidth={3} /> 取消する
                      </button>
                    </div>
                  </div>
                ) : (
                  <button 
                    onClick={() => fileInputRef.current?.click()} 
                    className="w-full aspect-video sm:aspect-[2/1] bg-indigo-50/50 border-4 border-dashed border-indigo-200 rounded-3xl flex flex-col items-center justify-center gap-4 text-indigo-300 hover:bg-indigo-50 hover:border-indigo-400 hover:text-indigo-500 transition-all group active:scale-[0.99]"
                  >
                    <div className="bg-white p-4 rounded-full shadow-sm group-hover:scale-110 transition-transform duration-300">
                      <Plus size={32} strokeWidth={4} className="text-indigo-400 group-hover:text-indigo-600"/>
                    </div>
                    <div className="text-center">
                      <span className="block font-black text-lg text-indigo-400 group-hover:text-indigo-600">写真を撮る・選ぶ</span>
                      <span className="text-xs font-bold opacity-70">ここをタップして画像をアップロード</span>
                    </div>
                  </button>
                )}
              </div>

              <div className="bg-gray-50 p-4 rounded-3xl border border-gray-100 focus-within:ring-4 focus-within:ring-orange-100 transition-all">
                <label className="block text-xs font-black text-gray-400 mb-2 pl-2">コメント (任意)</label>
                <textarea 
                  className="w-full h-24 p-2 bg-transparent border-none text-gray-700 font-medium focus:ring-0 outline-none resize-none placeholder:text-gray-300"
                  placeholder="質問や伝えたいことがあれば書いてね"
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  disabled={submitting}
                />
              </div>

              <div className="pt-2">
                <button 
                  onClick={handleSubmit} 
                  disabled={submitting || !selectedFile} 
                  className="w-full bg-gradient-to-r from-orange-500 to-pink-500 text-white py-5 rounded-2xl font-black text-xl shadow-xl shadow-orange-200 hover:shadow-orange-300 hover:-translate-y-1 active:scale-95 transition-all flex items-center justify-center gap-3 disabled:opacity-50 disabled:shadow-none disabled:transform-none"
                >
                  {submitting ? <Loader2 className="animate-spin" size={28}/> : <Send size={28} strokeWidth={3}/>} 
                  {submission?.status === 'resubmit' ? '修正して再提出する' : 'この内容で提出する'}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* 拡大モーダル */}
      {zoomImage && (
        <div className="fixed inset-0 z-50 bg-black/90 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-200" onClick={() => setZoomImage(null)}>
          <div className="relative w-full max-w-5xl h-[85vh] flex flex-col items-center justify-center">
            <Image src={zoomImage} alt="拡大" fill className="object-contain" unoptimized />
            <button className="absolute -top-12 right-0 sm:top-4 sm:right-4 text-white bg-white/20 hover:bg-white/40 p-3 rounded-full backdrop-blur-md transition-colors">
              <X size={24} strokeWidth={3}/>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}