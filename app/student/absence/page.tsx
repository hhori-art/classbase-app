'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/app/context/AuthContext';
import { db } from '@/lib/firebase';
import { doc, getDoc } from 'firebase/firestore';
import { CalendarCheck, Clock, AlertTriangle, Send, CheckCircle, ArrowLeft, CalendarDays, MessageSquare, Repeat, Loader2 } from 'lucide-react';
import Link from 'next/link';

type TransferOption = {
  id: string;
  title: string;
  target_date: string;
  subject: string;
  course_name: string;
  unit: string;
  period: number;
};

export default function StudentAbsencePage() {
  const { user, profile } = useAuth();
  const router = useRouter();

  const [mode, setMode] = useState<'absence' | 'transfer'>('absence');
  const [type, setType] = useState<'absent' | 'late'>('absent');
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
  const [reason, setReason] = useState('');
  const [absences, setAbsences] = useState<any[]>([]);
  const [selectedAbsenceId, setSelectedAbsenceId] = useState('');
  const [transferOptions, setTransferOptions] = useState<TransferOption[]>([]);
  const [selectedTransferId, setSelectedTransferId] = useState('');
  const [loadingTransfers, setLoadingTransfers] = useState(false);
  const [loading, setLoading] = useState(false);
  const [featureEnabled, setFeatureEnabled] = useState(true);
  const [transferEnabled, setTransferEnabled] = useState(true);
  const [visibilityLoading, setVisibilityLoading] = useState(true);
  const [submitted, setSubmitted] = useState(false);

  useEffect(() => {
    const loadVisibility = async () => {
      try {
        const snap = await getDoc(doc(db, 'settings', 'portal_visibility'));
        if (snap.exists()) {
          setFeatureEnabled(snap.data().student?.absence !== false);
          setTransferEnabled(snap.data().student?.transfer !== false);
        }
      } catch (error) {
        console.warn('Absence visibility read failed:', error);
      } finally {
        setVisibilityLoading(false);
      }
    };
    loadVisibility();
  }, []);

  useEffect(() => {
    const loadTransferOptions = async () => {
      if (!user || mode !== 'transfer') return;
      setLoadingTransfers(true);
      setSelectedTransferId('');
      try {
        const token = await user.getIdToken();
        const params = selectedAbsenceId ? `?absence_id=${encodeURIComponent(selectedAbsenceId)}` : '';
        const res = await fetch(`/api/student/transfer-options${params}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || data.ok === false) throw new Error(data.error || 'failed');
        setAbsences(data.absences || []);
        setSelectedAbsenceId(data.selected_absence?.id || data.absences?.[0]?.id || '');
        setTransferOptions(data.options || []);
      } catch (error) {
        console.error(error);
        setTransferOptions([]);
      } finally {
        setLoadingTransfers(false);
      }
    };
    loadTransferOptions();
  }, [user, mode, selectedAbsenceId]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    if (mode === 'transfer' && (!selectedAbsenceId || !selectedTransferId)) {
      alert('欠席連絡と振替先を選択してください。');
      return;
    }
    
    setLoading(true);

    try {
      const token = await user.getIdToken();
      const res = mode === 'transfer'
        ? await fetch('/api/student/transfers', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
            body: JSON.stringify({
              absence_id: selectedAbsenceId,
              transfer_shift_id: selectedTransferId,
              note: reason,
            }),
          })
        : await fetch('/api/parent/absence-requests', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
            body: JSON.stringify({
              student_id: user.uid,
              type: 'absence',
              absence_type: type,
              target_date: date,
              reason,
            }),
          });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.ok === false) throw new Error(data.error || 'failed');

      setSubmitted(true);
      setTimeout(() => router.push('/student'), 3000);

    } catch (error) {
      console.error(error);
      alert('送信に失敗しました。');
      setLoading(false);
    }
  };

  if (submitted) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-blue-50 p-6 font-sans">
        <div className="bg-white p-10 rounded-[40px] shadow-xl shadow-blue-100 text-center max-w-sm w-full animate-in zoom-in-95 border-4 border-white">
          <div className="w-24 h-24 bg-green-100 text-green-500 rounded-full flex items-center justify-center mx-auto mb-6 animate-bounce">
            <CheckCircle size={48} strokeWidth={3} />
          </div>
          <h2 className="text-2xl font-black text-gray-800 mb-2 tracking-tight">送信完了！</h2>
          <p className="text-gray-500 font-bold mb-8 leading-relaxed">
            {mode === 'transfer' ? '振替登録が完了しました。' : '先生にお知らせしました。'}<br />ダッシュボードへ戻ります。
          </p>
          <Link href="/student" className="block w-full bg-blue-500 text-white px-6 py-4 rounded-2xl font-black shadow-lg shadow-blue-200 hover:bg-blue-600 hover:shadow-xl hover:-translate-y-1 transition-all">
            ダッシュボードへ戻る
          </Link>
        </div>
      </div>
    );
  }

  if (visibilityLoading) {
    return <div className="min-h-screen flex items-center justify-center bg-blue-50"><Loader2 className="animate-spin text-blue-500" size={32} /></div>;
  }

  if (!featureEnabled) {
    return (
      <div className="min-h-screen bg-slate-50 p-6 font-sans flex items-center justify-center">
        <div className="max-w-sm rounded-[32px] bg-white p-8 text-center shadow-sm">
          <AlertTriangle className="mx-auto mb-4 text-slate-400" size={36} />
          <h1 className="text-xl font-black text-slate-800">欠席連絡は現在利用できません</h1>
          <p className="mt-2 text-sm font-bold text-slate-400">管理者設定で非表示になっています。</p>
          <Link href="/student" className="mt-6 inline-flex rounded-2xl bg-slate-900 px-5 py-3 text-sm font-black text-white">ホームへ戻る</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#F0F4F8] p-6 pb-32 font-sans flex flex-col items-center">
      {/* 幅を max-w-4xl に広げ、PCでは広く使えるように変更 */}
      <div className="w-full max-w-4xl mx-auto">
        
        {/* ヘッダー */}
        <div className="flex items-center gap-4 mb-8">
          <Link href="/student" className="bg-white p-3 rounded-2xl shadow-sm border border-gray-100 text-gray-400 hover:text-blue-600 hover:border-blue-200 transition-all">
            <ArrowLeft size={24} strokeWidth={3} />
          </Link>
          <div>
            <h1 className="text-2xl font-black text-gray-800 flex items-center gap-2 tracking-tight">
              欠席・遅刻の連絡
            </h1>
            <p className="text-xs font-bold text-gray-400">先生にメッセージを送ります</p>
          </div>
        </div>

        {/* フォームレイアウト:
          スマホ (default): grid-cols-1 (縦積み)
          PC/タブレット (md): grid-cols-2 (2カラム)
        */}
        <form onSubmit={handleSubmit} className="grid grid-cols-1 md:grid-cols-2 gap-6 md:gap-8 items-start">
          
          {/* 左カラム: 選択系 */}
          <div className="space-y-6">
            <div className="bg-white p-6 rounded-[32px] shadow-sm border border-gray-100">
              <label className="flex items-center gap-2 text-sm font-black text-gray-700 mb-4">
                <span className="bg-slate-100 text-slate-600 p-1.5 rounded-lg"><Repeat size={18} strokeWidth={3}/></span>
                登録する内容
              </label>
              <div className="grid grid-cols-2 gap-4">
                <button type="button" onClick={() => setMode('absence')} className={`p-4 rounded-2xl border-2 font-black transition-all ${mode === 'absence' ? 'border-blue-400 bg-blue-50 text-blue-700' : 'border-gray-100 bg-gray-50 text-gray-400'}`}>
                  欠席・遅刻
                </button>
                <button type="button" onClick={() => transferEnabled && setMode('transfer')} disabled={!transferEnabled} className={`p-4 rounded-2xl border-2 font-black transition-all ${mode === 'transfer' ? 'border-indigo-400 bg-indigo-50 text-indigo-700' : 'border-gray-100 bg-gray-50 text-gray-400'} ${!transferEnabled ? 'cursor-not-allowed opacity-50' : ''}`}>
                  振替登録
                </button>
              </div>
              {!transferEnabled && (
                <p className="mt-3 rounded-2xl bg-slate-50 p-3 text-xs font-bold text-slate-400">
                  通常の振替登録は現在非表示です。保護者から「お子様が選択する」で届いた振替はホーム画面に表示されます。
                </p>
              )}
            </div>
            
            {/* 1. 種類の選択 */}
            {mode === 'absence' && <div className="bg-white p-6 rounded-[32px] shadow-sm border border-gray-100 h-full">
              <label className="flex items-center gap-2 text-sm font-black text-gray-700 mb-4">
                <span className="bg-indigo-100 text-indigo-600 p-1.5 rounded-lg"><CalendarCheck size={18} strokeWidth={3}/></span>
                どうしましたか？
              </label>
              <div className="grid grid-cols-2 gap-4">
                <button
                  type="button"
                  onClick={() => setType('absent')}
                  className={`group relative p-5 rounded-2xl border-2 transition-all duration-200 overflow-hidden ${
                    type === 'absent'
                      ? 'border-red-400 bg-gradient-to-br from-red-500 to-rose-400 text-white shadow-lg shadow-red-200 scale-[1.02]'
                      : 'border-gray-100 bg-gray-50 text-gray-400 hover:bg-gray-100'
                  }`}
                >
                  <div className="flex flex-col items-center gap-2 relative z-10">
                    <AlertTriangle size={32} strokeWidth={3} className={type === 'absent' ? 'animate-pulse' : ''} />
                    <span className="font-black text-lg">お休み</span>
                  </div>
                  {type === 'absent' && <div className="absolute top-0 right-0 w-16 h-16 bg-white/20 rounded-full -translate-y-1/2 translate-x-1/2 blur-xl"></div>}
                </button>

                <button
                  type="button"
                  onClick={() => setType('late')}
                  className={`group relative p-5 rounded-2xl border-2 transition-all duration-200 overflow-hidden ${
                    type === 'late'
                      ? 'border-amber-400 bg-gradient-to-br from-amber-400 to-orange-400 text-white shadow-lg shadow-orange-200 scale-[1.02]'
                      : 'border-gray-100 bg-gray-50 text-gray-400 hover:bg-gray-100'
                  }`}
                >
                  <div className="flex flex-col items-center gap-2 relative z-10">
                    <Clock size={32} strokeWidth={3} className={type === 'late' ? 'animate-pulse' : ''} />
                    <span className="font-black text-lg">遅刻</span>
                  </div>
                  {type === 'late' && <div className="absolute top-0 right-0 w-16 h-16 bg-white/20 rounded-full -translate-y-1/2 translate-x-1/2 blur-xl"></div>}
                </button>
              </div>
            </div>}

            {/* 2. 日付の選択 */}
            {mode === 'absence' ? <div className="bg-white p-6 rounded-[32px] shadow-sm border border-gray-100">
               <label className="flex items-center gap-2 text-sm font-black text-gray-700 mb-4">
                <span className="bg-blue-100 text-blue-600 p-1.5 rounded-lg"><CalendarDays size={18} strokeWidth={3}/></span>
                いつのことですか？
              </label>
              <div className="relative">
                <input
                  type="date"
                  required
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  className="w-full p-5 bg-blue-50/50 text-gray-800 border-2 border-transparent rounded-2xl text-xl font-black outline-none focus:bg-white focus:border-blue-400 focus:ring-4 focus:ring-blue-100 transition-all text-center"
                />
              </div>
            </div> : <div className="bg-white p-6 rounded-[32px] shadow-sm border border-gray-100">
              <label className="flex items-center gap-2 text-sm font-black text-gray-700 mb-4">
                <span className="bg-indigo-100 text-indigo-600 p-1.5 rounded-lg"><CalendarDays size={18} strokeWidth={3}/></span>
                振替する欠席連絡
              </label>
              {loadingTransfers ? (
                <div className="flex items-center gap-2 rounded-2xl bg-indigo-50 p-4 text-sm font-black text-indigo-600">
                  <Loader2 size={18} className="animate-spin" /> 候補を読み込み中
                </div>
              ) : absences.length === 0 ? (
                <div className="rounded-2xl bg-slate-50 p-4 text-sm font-bold text-slate-500">振替登録できる欠席連絡がありません。</div>
              ) : (
                <select value={selectedAbsenceId} onChange={e => setSelectedAbsenceId(e.target.value)} className="w-full rounded-2xl border-2 border-indigo-100 bg-indigo-50 p-4 text-sm font-black text-slate-800 outline-none focus:border-indigo-400">
                  {absences.map(absence => (
                    <option key={absence.id} value={absence.id}>{absence.target_date || '-'} {absence.reason || absence.content || ''}</option>
                  ))}
                </select>
              )}
            </div>}

          </div>

          {/* 右カラム: 入力・送信系 */}
          <div className="flex flex-col gap-6 h-full">
            
            {/* 3. 理由の入力 (PCでは高さを伸ばす) */}
            <div className="bg-white p-6 rounded-[32px] shadow-sm border border-gray-100 flex-1 flex flex-col">
              <label className="flex items-center gap-2 text-sm font-black text-gray-700 mb-4">
                <span className="bg-green-100 text-green-600 p-1.5 rounded-lg"><MessageSquare size={18} strokeWidth={3}/></span>
                {mode === 'transfer' ? '振替候補を選んでください' : '理由をおしえてください'}
              </label>
              {mode === 'transfer' && (
                <div className="mb-4 space-y-3">
                  {transferOptions.length === 0 ? (
                    <div className="rounded-2xl bg-slate-50 p-4 text-sm font-bold text-slate-500">同じ単元の振替候補がありません。</div>
                  ) : transferOptions.map(option => (
                    <button
                      key={option.id}
                      type="button"
                      onClick={() => setSelectedTransferId(option.id)}
                      className={`w-full rounded-2xl border-2 p-4 text-left transition-all ${selectedTransferId === option.id ? 'border-indigo-400 bg-indigo-50 text-indigo-700' : 'border-gray-100 bg-gray-50 text-gray-600 hover:border-indigo-200'}`}
                    >
                      <p className="font-black">{option.title}</p>
                      <p className="mt-1 text-xs font-bold text-gray-400">{option.unit || '単元名未設定'} / {option.period ? `${option.period}限` : '時限未設定'}</p>
                    </button>
                  ))}
                </div>
              )}
              <textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                required={mode === 'absence'}
                placeholder={mode === 'transfer' ? "補足があれば入力してください。" : type === 'absent' ? "（例）熱があるので病院に行きます。" : "（例）部活が長引いたため15分ほど遅れます。"}
                className="w-full flex-1 p-4 min-h-[120px] md:min-h-0 bg-gray-50 text-gray-800 border-2 border-transparent rounded-2xl outline-none focus:bg-white focus:border-green-400 focus:ring-4 focus:ring-green-100 transition-all resize-none font-bold placeholder:font-medium placeholder:text-gray-400"
              />
            </div>

            {/* 送信ボタン */}
            <button
              type="submit"
              disabled={loading || (mode === 'transfer' && (!selectedAbsenceId || !selectedTransferId))}
              className={`w-full py-5 rounded-2xl font-black text-xl text-white shadow-xl flex items-center justify-center gap-3 active:scale-95 transition-all disabled:opacity-50 disabled:scale-100 ${
                mode === 'transfer'
                  ? 'bg-gradient-to-r from-indigo-500 to-blue-500 hover:from-indigo-600 hover:to-blue-600 shadow-indigo-200'
                  : type === 'absent'
                  ? 'bg-gradient-to-r from-red-500 to-rose-500 hover:from-red-600 hover:to-rose-600 shadow-red-200' 
                  : 'bg-gradient-to-r from-amber-400 to-orange-500 hover:from-amber-500 hover:to-orange-600 shadow-orange-200'
              }`}
            >
              {loading ? (
                <span className="animate-pulse">送信中...</span>
              ) : (
                <>
                  <Send size={24} strokeWidth={3} />
                  {mode === 'transfer' ? '振替を確定する' : '連絡する'}
                </>
              )}
            </button>
          </div>
          
        </form>
      </div>
    </div>
  );
}
