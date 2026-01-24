'use client';

import { useState, useEffect } from 'react';
import { db } from '@/lib/firebase';
import { 
  collection, query, orderBy, limit, getDocs, addDoc, deleteDoc, doc, writeBatch 
} from 'firebase/firestore';
import { 
  Video, CheckCircle, XCircle, ArrowRight, ArrowLeft, 
  Calendar, User, MonitorPlay, ExternalLink, RefreshCw, Loader2, Link as LinkIcon, 
  Clock, FileUp, UploadCloud, Trash2, Search
} from 'lucide-react';
import Link from 'next/link';

// 型定義
type ShiftData = {
  id: string; 
  target_date: string;
  target_grade: string;
  target_subject: string;
  target_detail_subject?: string;
  unit?: string;
  teacher_name: string;
  target_recording_url?: string; 
  target_meeting_id?: string;
  note?: string;
};

type PublishedData = {
  id: string;
  original_shift_id?: string;
  target_date: string;
  title: string;
  video_url: string;
  grade: string;
  subject: string;
};

export default function MasterApprovalPage() {
  const [candidates, setCandidates] = useState<ShiftData[]>([]);
  const [published, setPublished] = useState<PublishedData[]>([]);
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState<string | null>(null);
  const [isImporting, setIsImporting] = useState(false);
  const [titles, setTitles] = useState<{ [key: string]: string }>({});

  // 検索用ステート（右側の公開リスト用）
  const [publishedSearch, setPublishedSearch] = useState('');

  const fetchData = async () => {
    setLoading(true);
    try {
      // 1. 公開済みデータ (class_recordings)
      // CSVで大量に入っても大丈夫なように300件取得
      const pubQ = query(collection(db, 'class_recordings'), orderBy('target_date', 'desc'), limit(300));
      const pubSnap = await getDocs(pubQ);
      const pubList = pubSnap.docs.map(d => ({ id: d.id, ...d.data() } as PublishedData));
      setPublished(pubList);

      const publishedShiftIds = new Set(pubList.map(p => p.original_shift_id).filter(Boolean));

      // 2. 承認候補（シフト）
      const shiftQ = query(collection(db, 'shift_assignments'), orderBy('target_date', 'desc'), limit(100));
      const shiftSnap = await getDocs(shiftQ);
      const rawCandidates = shiftSnap.docs.map(d => ({ id: d.id, ...d.data() } as ShiftData));

      // 3. フィルタリング (未公開 & URLあり)
      const validCandidates = rawCandidates.filter(c => 
        !publishedShiftIds.has(c.id) && c.target_recording_url 
      );

      setCandidates(validCandidates);

      // タイトル初期値
      const initialTitles: any = {};
      validCandidates.forEach(c => {
        initialTitles[c.id] = `${c.target_detail_subject || ''} ${c.unit || ''}`.trim() || `${c.target_subject}の授業`;
      });
      setTitles(initialTitles);

    } catch (e) {
      console.error(e);
      alert('データ取得エラー');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  // 承認処理
  const handleApprove = async (shift: ShiftData) => {
    const url = shift.target_recording_url;
    const title = titles[shift.id];
    if (!url) return alert('URLエラー');
    if (!title) return alert('タイトルを入力してください');

    setProcessing(shift.id);
    try {
      await addDoc(collection(db, 'class_recordings'), {
        original_shift_id: shift.id,
        target_date: shift.target_date,
        grade: shift.target_grade || 'その他',
        subject: shift.target_subject || '全科目',
        title: title,
        video_url: url,
        created_at: new Date().toISOString()
      });

      // ローカル更新
      setPublished(prev => [{
        id: 'temp_' + Date.now(),
        original_shift_id: shift.id,
        target_date: shift.target_date,
        grade: shift.target_grade || 'その他',
        subject: shift.target_subject || '全科目',
        title: title,
        video_url: url
      }, ...prev].sort((a,b) => b.target_date.localeCompare(a.target_date)));
      
      setCandidates(prev => prev.filter(c => c.id !== shift.id));

    } catch (e) {
      console.error(e);
      alert('公開に失敗しました');
    } finally {
      setProcessing(null);
    }
  };

  // 取り下げ処理
  const handleUnpublish = async (pubId: string) => {
    if(!confirm('公開を取り下げ（削除）しますか？')) return;
    setProcessing(pubId);
    try {
      await deleteDoc(doc(db, 'class_recordings', pubId));
      // 再取得して、もしシフト由来なら候補に戻す
      fetchData(); 
    } catch (e) {
      alert('削除失敗');
      setProcessing(null);
    }
  };

  // CSVインポート機能
  const handleCSVImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!confirm(`「${file.name}」をインポートしますか？`)) {
      e.target.value = ''; return;
    }

    setIsImporting(true);
    const reader = new FileReader();
    reader.readAsText(file, 'UTF-8');
    
    reader.onload = async (event) => {
      try {
        const text = event.target?.result as string;
        const rows = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
        // ヘッダー行をスキップする前提 (1行目からデータならi=0に)
        
        const batch = writeBatch(db);
        let count = 0;
        
        for (let i = 1; i < rows.length; i++) {
          const cols = rows[i].split(',');
          if (cols.length < 5) continue;
          
          // フォーマット: 日付,学年,科目,タイトル,URL
          const [date, grade, subject, title, url] = cols.map(c => c.trim().replace(/^"|"$/g, ''));

          if (!date || !url) continue;

          const ref = doc(collection(db, 'class_recordings'));
          batch.set(ref, {
            target_date: date,
            grade: grade || 'その他',
            subject: subject || '全科目',
            title: title || 'タイトルなし',
            video_url: url,
            created_at: new Date().toISOString()
          });
          count++;
        }
        
        await batch.commit();
        alert(`${count}件の過去データをインポートしました`);
        fetchData();
      } catch (e: any) {
        alert('インポートエラー: ' + e.message);
      } finally {
        setIsImporting(false);
        e.target.value = '';
      }
    };
  };

  // 公開リストの検索フィルタ
  const filteredPublished = published.filter(p => 
    p.title.includes(publishedSearch) || 
    p.target_date.includes(publishedSearch) || 
    p.subject.includes(publishedSearch)
  );

  return (
    <div className="min-h-screen bg-gray-50 p-6 font-sans">
      <div className="max-w-[1600px] mx-auto">
        
        {/* ヘッダー */}
        <div className="flex flex-col md:flex-row items-center justify-between mb-8 gap-4">
          <div className="flex items-center gap-4">
            <Link href="/master" className="bg-white p-3 rounded-full shadow hover:bg-gray-100 text-gray-600 transition-colors">
              <ArrowLeft size={24} />
            </Link>
            <div>
              <h1 className="text-2xl font-black text-gray-800 flex items-center gap-2">
                <Video className="text-red-600" /> 録画承認センター
              </h1>
              <p className="text-xs text-gray-500 font-bold mt-1">Zoom連携承認 ＆ 過去データのCSV一括登録</p>
            </div>
          </div>
          
          <div className="flex items-center gap-3">
            {/* CSVインポートボタン */}
            <div className="relative">
              <input 
                type="file" 
                accept=".csv" 
                onChange={handleCSVImport} 
                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                disabled={isImporting}
              />
              <button disabled={isImporting} className="bg-blue-600 text-white px-5 py-2.5 rounded-full font-bold hover:bg-blue-700 shadow-lg shadow-blue-200 flex items-center gap-2 transition-all active:scale-95">
                {isImporting ? <Loader2 className="animate-spin" size={18}/> : <FileUp size={18}/>}
                CSV一括登録
              </button>
            </div>

            <button onClick={fetchData} className="flex items-center gap-2 bg-white border border-gray-300 px-4 py-2.5 rounded-full text-sm font-bold text-gray-600 hover:bg-gray-100 transition-colors">
              <RefreshCw size={16} /> 更新
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-2 gap-8 items-start">
          
          {/* === 左カラム: 承認待ち (URLがあるものだけ) === */}
          <div className="space-y-4">
            <div className="flex items-center justify-between px-2">
              <h2 className="text-lg font-black text-gray-700 flex items-center gap-2">
                <span className="bg-blue-600 text-white px-3 py-1 rounded-full text-xs shadow-sm shadow-blue-200">Inbox</span>
                承認待ち（Zoom連携済み）
                <span className="bg-blue-100 text-blue-600 text-xs px-2 py-1 rounded-full font-bold">{candidates.length}</span>
              </h2>
            </div>

            {loading ? (
              <div className="p-20 flex justify-center"><Loader2 className="animate-spin text-gray-400" /></div>
            ) : candidates.length === 0 ? (
              <div className="bg-white p-12 rounded-3xl border-2 border-dashed border-gray-200 text-center flex flex-col items-center gap-2">
                <CheckCircle size={40} className="text-gray-200"/>
                <p className="text-gray-400 font-bold">承認待ちはありません</p>
                <p className="text-xs text-gray-300">Zoom録画が完了するとここに自動で表示されます</p>
              </div>
            ) : (
              <div className="space-y-4">
                {candidates.map((shift) => (
                  <div key={shift.id} className="bg-white p-5 rounded-3xl shadow-sm border border-blue-100 hover:shadow-lg transition-all group relative overflow-hidden">
                    {/* 背景装飾 */}
                    <div className="absolute top-0 right-0 w-20 h-20 bg-blue-50 rounded-bl-[100px] -z-0"></div>

                    {/* 上段: 連携情報 */}
                    <div className="flex justify-between items-start mb-4 relative z-10">
                      <div className="flex items-center gap-3">
                        <span className="bg-blue-100 text-blue-700 font-bold text-xs px-3 py-1 rounded-full flex items-center gap-1">
                          <LinkIcon size={12}/> Zoom連携完了
                        </span>
                        {shift.target_meeting_id && (
                          <span className="text-[10px] text-gray-400 font-mono flex items-center gap-1">
                            ID: {shift.target_meeting_id}
                          </span>
                        )}
                      </div>
                      <a href={shift.target_recording_url} target="_blank" rel="noreferrer" className="text-blue-500 hover:text-blue-700 p-1.5 hover:bg-blue-50 rounded-lg transition-colors" title="録画を確認">
                        <ExternalLink size={18}/>
                      </a>
                    </div>

                    {/* 中段: 授業情報 */}
                    <div className="mb-4 pl-1">
                      <div className="flex items-center gap-2 mb-1 text-sm font-bold text-gray-500">
                        <Calendar size={14}/> {shift.target_date}
                        <span className="text-gray-300">|</span>
                        <Clock size={14}/> {shift.note || '時間未定'}
                      </div>
                      <div className="text-lg font-black text-gray-800 flex items-center gap-2">
                        {shift.target_grade} {shift.target_subject}
                        <span className="text-sm font-medium text-gray-500">
                          / {shift.teacher_name} 先生
                        </span>
                      </div>
                    </div>

                    {/* 下段: 承認フォーム */}
                    <div className="bg-gray-50 p-3 rounded-2xl border border-gray-100 space-y-3">
                      <div>
                        <label className="text-[10px] font-bold text-gray-400 block mb-1 ml-1">公開タイトル</label>
                        <input 
                          type="text" 
                          className="w-full p-2.5 border border-gray-200 rounded-xl text-sm font-bold focus:border-blue-400 outline-none transition-colors"
                          value={titles[shift.id] || ''}
                          onChange={(e) => setTitles(prev => ({...prev, [shift.id]: e.target.value}))}
                        />
                      </div>
                      <button 
                        onClick={() => handleApprove(shift)}
                        disabled={!!processing}
                        className="w-full py-3 bg-blue-600 text-white rounded-xl font-bold hover:bg-blue-700 shadow-md shadow-blue-200 flex items-center justify-center gap-2 transition-all active:scale-95"
                      >
                        {processing === shift.id ? <Loader2 className="animate-spin" size={18}/> : <CheckCircle size={18}/>}
                        承認して公開する
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* === 右カラム: 公開済みリスト === */}
          <div className="space-y-4">
            <div className="flex items-center justify-between px-2">
              <h2 className="text-lg font-black text-gray-700 flex items-center gap-2">
                <span className="bg-green-100 text-green-700 px-3 py-1 rounded-full text-xs">Public</span>
                公開中（過去データ含む）
                <span className="bg-gray-100 text-gray-600 text-xs px-2 py-1 rounded-full font-bold">{published.length}</span>
              </h2>
              
              {/* 簡易検索 */}
              <div className="relative w-48">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"/>
                <input 
                  type="text" 
                  placeholder="タイトル検索" 
                  className="w-full pl-8 pr-3 py-1.5 bg-white border border-gray-200 rounded-full text-xs font-bold outline-none focus:border-green-400"
                  value={publishedSearch}
                  onChange={(e) => setPublishedSearch(e.target.value)}
                />
              </div>
            </div>

            <div className="bg-white rounded-3xl shadow-sm border border-gray-200 overflow-hidden max-h-[800px] overflow-y-auto custom-scrollbar">
              {filteredPublished.length === 0 ? (
                <div className="p-12 text-center text-gray-400">公開中の動画はありません</div>
              ) : (
                <div className="divide-y divide-gray-100">
                  {filteredPublished.map((pub) => (
                    <div key={pub.id} className="p-5 hover:bg-gray-50 transition-colors flex items-start gap-4 group">
                      
                      <div className="w-12 h-12 bg-green-50 text-green-600 rounded-2xl flex items-center justify-center shrink-0">
                        <MonitorPlay size={24} />
                      </div>

                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-xs font-bold text-gray-500 bg-gray-100 px-2 py-0.5 rounded">
                            {pub.target_date}
                          </span>
                          <span className={`text-xs font-bold px-2 py-0.5 rounded ${pub.subject.includes('理科') ? 'text-blue-600 bg-blue-50' : 'text-orange-600 bg-orange-50'}`}>
                            {pub.grade} {pub.subject}
                          </span>
                        </div>
                        <h4 className="text-sm font-bold text-gray-800 mb-1 truncate">{pub.title}</h4>
                        <a href={pub.video_url} target="_blank" rel="noreferrer" className="text-xs text-blue-500 hover:underline flex items-center gap-1 truncate font-mono">
                          <ExternalLink size={10}/> {pub.video_url}
                        </a>
                      </div>

                      <button 
                        onClick={() => handleUnpublish(pub.id)}
                        disabled={!!processing}
                        className="text-gray-300 hover:text-red-500 p-2 hover:bg-red-50 rounded-xl transition-colors shrink-0 opacity-0 group-hover:opacity-100"
                        title="削除・公開停止"
                      >
                        {processing === pub.id ? <Loader2 className="animate-spin" size={20}/> : <Trash2 size={20}/>}
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}