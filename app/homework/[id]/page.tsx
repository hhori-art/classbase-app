'use client';

import { useState, useEffect, use, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { db, storage } from '@/lib/firebase'; 
import { doc, getDoc, setDoc, collection, query, where, getDocs } from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { useAuth } from '@/app/context/AuthContext';
import { ArrowLeft, Clock, Send, CheckCircle, AlertCircle, Loader2, Image as ImageIcon, X, Plus, MessageSquareText, ExternalLink } from 'lucide-react';
import Link from 'next/link';
import Image from 'next/image';

export default function HomeworkDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const assignmentId = id;
  const { user, loading: authLoading } = useAuth();
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
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    if (assignmentId && !authLoading) {
      if (!user) { router.push('/'); return; }
      fetchData();
    }
  }, [assignmentId, user, authLoading, router]);

  const fetchData = async () => {
    try {
      const assignSnap = await getDoc(doc(db, 'assignments', assignmentId));
      if (!assignSnap.exists()) throw new Error('課題が見つかりませんでした');
      setAssignment({ id: assignSnap.id, ...assignSnap.data() });
      const q = query(collection(db, 'submissions'), where('assignment_id', '==', assignmentId), where('student_id', '==', user!.uid));
      const subSnap = await getDocs(q);
      if (!subSnap.empty) {
        const subData = subSnap.docs[0].data();
        setSubmission(subData);
        setComment(subData.comment || '');
        if (subData.imageUrl) setPreviewUrl(subData.imageUrl);
      }
    } catch (e: any) { setErrorMsg(e.message); } finally { setLoading(false); }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      if (!file.type.startsWith('image/')) { alert('画像ファイルを選択してください。'); return; }
      setSelectedFile(file);
      const reader = new FileReader();
      reader.onloadend = () => setPreviewUrl(reader.result as string);
      reader.readAsDataURL(file);
    }
  };

  const handleSubmit = async () => {
    if (!selectedFile) return alert('提出する画像を選択してください');
    if (!confirm('この画像で提出しますか？')) return;
    setSubmitting(true);
    
    try {
      if (!user) throw new Error('ログインセッションが切れました。');
      const fileExtension = selectedFile.name.split('.').pop() || 'jpg';
      const storagePath = `submissions/${assignmentId}/${user.uid}_${Date.now()}.${fileExtension}`;
      const storageRef = ref(storage, storagePath);
      const snapshot = await uploadBytes(storageRef, selectedFile);
      const imageUrl = await getDownloadURL(snapshot.ref);
      const subId = `${assignmentId}_${user.uid}`;
      const subRef = doc(db, 'submissions', subId);
      await setDoc(subRef, {
        assignment_id: assignmentId,
        student_id: user.uid,
        student_name: user.displayName || '生徒',
        imageUrl: imageUrl,
        comment: comment,
        status: 'submitted',
        submitted_at: new Date().toISOString(),
      }, { merge: true });

      // PF連携部分は既存ロジック維持
      if (assignment.target_week && assignment.subject) {
        const weekNum = assignment.target_week.replace(/[^0-9]/g, '');
        if (weekNum) {
          const pfUpdateData: any = { student_id: user.uid, week_number: weekNum, updated_at: new Date().toISOString() };
          if (assignment.subject.includes('理科') || assignment.subject.includes('物理') || assignment.subject.includes('化学') || assignment.subject.includes('生物')) pfUpdateData.homework_science = '〇';
          else if (assignment.subject.includes('社会') || assignment.subject.includes('地理') || assignment.subject.includes('歴史') || assignment.subject.includes('公民')) pfUpdateData.homework_social = '〇';
          if (pfUpdateData.homework_science || pfUpdateData.homework_social) await setDoc(doc(db, 'pf_records', `${user.uid}_w${weekNum}`), pfUpdateData, { merge: true });
        }
      }
      alert('クエスト完了！提出しました！');
      setSelectedFile(null);
      await fetchData();
    } catch (e: any) { setErrorMsg('提出に失敗しました: ' + e.message); } finally { setSubmitting(false); }
  };

  if (loading || authLoading) return <div className="min-h-screen flex items-center justify-center bg-[#F0F4F8]"><Loader2 className="animate-spin text-gray-400"/></div>;
  if (!assignment) return <div className="p-10 text-center text-gray-400">課題が見つかりません</div>;

  const isLate = new Date() > new Date(assignment.deadline);

  return (
    <div className="min-h-screen bg-[#F0F4F8] p-6 pb-32 font-sans">
      <div className="max-w-2xl mx-auto">
        <div className="flex items-center gap-4 mb-8">
          <Link href="/student/homework" className="bg-white p-3 rounded-full shadow-sm text-gray-600 hover:bg-gray-50 transition-colors"><ArrowLeft size={20} /></Link>
          <h1 className="text-2xl font-extrabold text-gray-800">クエスト詳細</h1>
        </div>

        <div className="bg-white p-6 md:p-8 rounded-3xl shadow-sm border border-gray-100 mb-6 relative overflow-hidden">
          <div className="absolute top-6 right-6">
            {submission ? <span className="flex items-center gap-1 text-sm font-bold text-green-600 bg-green-50 px-3 py-1.5 rounded-full border border-green-100"><CheckCircle size={16}/> CLEAR!</span>
            : isLate ? <span className="flex items-center gap-1 text-sm font-bold text-red-500 bg-red-50 px-3 py-1.5 rounded-full border border-red-100"><AlertCircle size={16}/> TIME OVER</span>
            : <span className="flex items-center gap-1 text-sm font-bold text-blue-500 bg-blue-50 px-3 py-1.5 rounded-full border border-blue-100"><Clock size={16}/> FIGHT!</span>}
          </div>
          <div className="pr-32">
            <span className={`inline-block px-3 py-1 rounded-full text-xs font-bold text-white mb-3 ${assignment.subject?.includes('理科')?'bg-green-500':assignment.subject?.includes('社会')?'bg-orange-500':'bg-blue-500'}`}>{assignment.subject||'一般'}</span>
            <h2 className="text-3xl font-extrabold text-gray-900 mb-2 leading-tight">{assignment.title}</h2>
            <p className="text-sm text-gray-500 font-bold flex items-center gap-1.5 mb-6"><Clock size={16} className="text-gray-400"/> LIMIT: {new Date(assignment.deadline).toLocaleString('ja-JP')}</p>
          </div>
          <div className="prose prose-sm max-w-none text-gray-700 bg-gray-50 p-5 rounded-2xl border border-gray-100 whitespace-pre-wrap">{assignment.description}</div>
        </div>

        <div className="bg-white p-6 md:p-8 rounded-3xl shadow-sm border border-gray-100">
          <h3 className="text-xl font-bold text-gray-800 mb-6 flex items-center gap-2.5">
            <ImageIcon className="text-orange-500" /> {submission ? '提出した成果' : '成果を報告する'}
          </h3>
          <div className="space-y-6">
            {submission ? (
              <div className="space-y-4">
                <div className="relative w-full aspect-[4/3] rounded-2xl overflow-hidden border border-gray-200 bg-gray-50 group cursor-pointer" onClick={() => setZoomImage(submission.imageUrl)}>
                  <Image src={submission.imageUrl} alt="提出画像" fill className="object-contain" unoptimized />
                  <div className="absolute inset-0 bg-black/20 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center text-white font-bold gap-2"><ExternalLink size={24}/> タップして拡大</div>
                </div>
                {submission.comment && <div className="bg-gray-50 p-4 rounded-xl border border-gray-100 text-sm text-gray-700 relative"><MessageSquareText size={16} className="text-gray-300 absolute top-3 right-3"/><span className="font-bold text-gray-500 block mb-1">コメント:</span>{submission.comment}</div>}
              </div>
            ) : (
              <>
                <input type="file" accept="image/*" ref={fileInputRef} onChange={handleFileChange} className="hidden" />
                {previewUrl ? (
                  <div className="relative w-full aspect-[4/3] rounded-2xl overflow-hidden border-2 border-orange-200 bg-gray-50 animate-in fade-in">
                    <Image src={previewUrl} alt="プレビュー" fill className="object-contain" />
                    <button onClick={() => {setSelectedFile(null); setPreviewUrl(null);}} className="absolute top-3 right-3 bg-black/50 text-white p-1.5 rounded-full"><X size={18} /></button>
                  </div>
                ) : (
                  <button onClick={() => fileInputRef.current?.click()} className="w-full aspect-[4/3] bg-gray-50 border-2 border-dashed border-gray-200 rounded-2xl flex flex-col items-center justify-center gap-3 text-gray-400 hover:border-orange-300 hover:bg-orange-50 hover:text-orange-500 transition-all group">
                    <Plus size={40} strokeWidth={1.5} className="group-hover:scale-110 transition-transform" />
                    <span className="font-bold text-sm">写真を撮る・アルバムから選ぶ</span>
                  </button>
                )}
                <div>
                  <label className="block text-xs font-bold text-gray-400 mb-2 uppercase tracking-wider">先生へのコメント (任意)</label>
                  <textarea className="w-full h-24 p-4 bg-gray-50 border border-gray-200 rounded-xl text-sm text-gray-800 focus:ring-2 focus:ring-orange-200 outline-none resize-none" placeholder="ここが難しかったです！など" value={comment} onChange={(e) => setComment(e.target.value)} disabled={submitting} />
                </div>
                <div className="flex justify-end pt-4 border-t border-gray-100">
                  <button onClick={handleSubmit} disabled={submitting || !selectedFile} className="bg-gradient-to-r from-orange-500 to-red-500 text-white px-10 py-3.5 rounded-2xl font-bold text-lg shadow-lg hover:scale-[1.02] active:scale-95 transition-all flex items-center gap-2 disabled:opacity-50">
                    {submitting ? <Loader2 className="animate-spin" size={20} /> : <Send size={20} />} 提出する
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
      {zoomImage && (
        <div className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center p-4 animate-in fade-in" onClick={() => setZoomImage(null)}>
          <div className="relative w-full max-w-4xl max-h-[90vh] h-full">
            <Image src={zoomImage} alt="拡大" fill className="object-contain" unoptimized />
            <button className="absolute top-4 right-4 text-white bg-gray-800/50 p-2 rounded-full"><X size={24}/></button>
          </div>
        </div>
      )}
    </div>
  );
}