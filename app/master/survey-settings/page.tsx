'use client';

import { useState, useEffect } from 'react';
import { db } from '@/lib/firebase';
import { collection, getDocs, doc, addDoc, updateDoc, deleteDoc, serverTimestamp, getDoc, setDoc } from 'firebase/firestore';
import { 
  Plus, Trash2, Save, Loader2, ArrowLeft, GripVertical, Copy, 
  Star, AlignLeft, ToggleLeft, ToggleRight, ListOrdered, Calendar, Users, Clock, Edit3, Check, BookOpen, AlertCircle
} from 'lucide-react';
import Link from 'next/link';

// --- 型定義 ---

type Question = {
  id: number;
  text: string;
  type: 'rating' | 'text';
  required: boolean;
  ratingLabels?: { [key: number]: string };
};

type SurveyConfig = {
  id?: string;
  type: 'default' | 'custom'; // 通常授業用かカスタムか
  title: string;
  isActive: boolean;
  targetType: 'all' | 'grade';
  targetGrades: string[];
  startAt: string;
  endAt: string;
  questions: Question[];
};

const GRADE_OPTIONS = ['中1', '中2', '中3', '高1', '高2', '高3'];
const DEFAULT_SURVEY_ID = 'default_class_survey'; // 通常授業用の固定ID

export default function SurveySettingsPage() {
  // --- State ---
  const [mode, setMode] = useState<'list' | 'edit'>('list');
  const [surveys, setSurveys] = useState<SurveyConfig[]>([]);
  const [defaultSurvey, setDefaultSurvey] = useState<SurveyConfig | null>(null); // 通常授業用
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // 編集中のデータ
  const [currentSurvey, setCurrentSurvey] = useState<SurveyConfig | null>(null);
  const [activeQId, setActiveQId] = useState<number | null>(null);

  // --- データ取得 ---
  const fetchSurveys = async () => {
    setLoading(true);
    try {
      // 1. 通常授業用設定の取得
      const defaultDocRef = doc(db, 'survey_templates', DEFAULT_SURVEY_ID);
      const defaultDocSnap = await getDoc(defaultDocRef);
      
      if (defaultDocSnap.exists()) {
        setDefaultSurvey({ id: defaultDocSnap.id, ...defaultDocSnap.data() } as SurveyConfig);
      } else {
        // 存在しない場合は初期データを作成するための準備（保存時に作成）
        setDefaultSurvey({
          id: DEFAULT_SURVEY_ID,
          type: 'default',
          title: '授業振り返りアンケート（標準）',
          isActive: true,
          targetType: 'all',
          targetGrades: [],
          startAt: '',
          endAt: '',
          questions: [
            { id: 1, text: '授業はわかりやすかったですか？', type: 'rating', required: true, ratingLabels: { 1: '悪い', 5: '良い' } },
            { id: 2, text: '先生の声の大きさやスピードはどうでしたか？', type: 'rating', required: true, ratingLabels: { 1: '悪い', 5: '良い' } },
          ]
        });
      }

      // 2. カスタムアンケートの取得
      const colRef = collection(db, 'survey_templates');
      const snap = await getDocs(colRef);
      const list = snap.docs
        .map(d => ({ id: d.id, ...d.data() } as SurveyConfig))
        .filter(d => d.id !== DEFAULT_SURVEY_ID); // デフォルト以外を抽出

      setSurveys(list);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSurveys();
  }, []);

  // --- 新規作成（カスタム） ---
  const handleCreateCustom = () => {
    const now = new Date();
    const nextWeek = new Date();
    nextWeek.setDate(now.getDate() + 7);

    const toLocalISO = (d: Date) => {
      const pad = (n: number) => n < 10 ? '0' + n : n;
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
    };

    setCurrentSurvey({
      type: 'custom',
      title: '特別アンケート（名称未設定）',
      isActive: true,
      targetType: 'all',
      targetGrades: [],
      startAt: toLocalISO(now),
      endAt: toLocalISO(nextWeek),
      questions: [
        { 
          id: 1, 
          text: 'アンケート内容を入力してください', 
          type: 'rating', 
          required: true, 
          ratingLabels: { 1: '悪い', 5: '良い' } 
        }
      ]
    });
    setMode('edit');
  };

  // --- 編集開始 ---
  const handleEdit = (survey: SurveyConfig) => {
    setCurrentSurvey({ 
      ...survey,
      targetGrades: survey.targetGrades || [],
      questions: survey.questions || []
    }); 
    setMode('edit');
  };

  // --- 保存処理 ---
  const handleSave = async () => {
    if (!currentSurvey) return;
    if (!currentSurvey.title.trim()) return alert('タイトルを入力してください');
    if (currentSurvey.questions.length === 0) return alert('質問を1つ以上設定してください');
    
    // カスタムの場合のみ期間チェック
    if (currentSurvey.type === 'custom') {
      if (currentSurvey.startAt >= currentSurvey.endAt) return alert('終了日時は開始日時より後に設定してください');
    }

    setSaving(true);
    try {
      const dataToSave = {
        ...currentSurvey,
        updated_at: serverTimestamp()
      };

      if (currentSurvey.id === DEFAULT_SURVEY_ID) {
        // デフォルト設定の保存（ID指定）
        await setDoc(doc(db, 'survey_templates', DEFAULT_SURVEY_ID), dataToSave);
      } else if (currentSurvey.id) {
        // 既存カスタムの更新
        await updateDoc(doc(db, 'survey_templates', currentSurvey.id), dataToSave);
      } else {
        // 新規カスタムの作成
        await addDoc(collection(db, 'survey_templates'), dataToSave);
      }
      
      await fetchSurveys();
      setMode('list');
      alert('保存しました');
    } catch (e) {
      console.error(e);
      alert('保存エラー');
    } finally {
      setSaving(false);
    }
  };

  // --- 削除 ---
  const handleDeleteSurvey = async (id: string) => {
    if (!confirm('本当に削除しますか？')) return;
    try {
      await deleteDoc(doc(db, 'survey_templates', id));
      setSurveys(prev => prev.filter(s => s.id !== id));
    } catch (e) {
      alert('削除エラー');
    }
  };

  // --- 質問編集ロジック (共通) ---
  const updateSurveyField = (field: keyof SurveyConfig, value: any) => {
    if (!currentSurvey) return;
    setCurrentSurvey({ ...currentSurvey, [field]: value });
  };

  const toggleGrade = (grade: string) => {
    if (!currentSurvey) return;
    const current = currentSurvey.targetGrades || [];
    const newGrades = current.includes(grade)
      ? current.filter(g => g !== grade)
      : [...current, grade];
    updateSurveyField('targetGrades', newGrades);
  };

  const addQuestion = () => {
    if (!currentSurvey) return;
    const newId = Date.now();
    updateSurveyField('questions', [...currentSurvey.questions, { 
      id: newId, text: '', type: 'rating', required: true, ratingLabels: { 1: '', 2: '', 3: '', 4: '', 5: '' } 
    }]);
    setActiveQId(newId);
  };

  const updateQuestion = (qId: number, field: string, val: any) => {
    if (!currentSurvey) return;
    updateSurveyField('questions', currentSurvey.questions.map(q => q.id === qId ? { ...q, [field]: val } : q));
  };

  const updateRatingLabel = (qId: number, level: number, text: string) => {
    if (!currentSurvey) return;
    updateSurveyField('questions', currentSurvey.questions.map(q => {
      if (q.id !== qId) return q;
      return { ...q, ratingLabels: { ...q.ratingLabels, [level]: text } };
    }));
  };

  const deleteQuestion = (qId: number) => {
    if (!currentSurvey) return;
    updateSurveyField('questions', currentSurvey.questions.filter(q => q.id !== qId));
  };

  const duplicateQuestion = (q: Question) => {
    if (!currentSurvey) return;
    const newId = Date.now();
    const idx = currentSurvey.questions.findIndex(item => item.id === q.id);
    const newArr = [...currentSurvey.questions];
    newArr.splice(idx + 1, 0, { ...q, id: newId });
    updateSurveyField('questions', newArr);
    setActiveQId(newId);
  };

  if (loading) return <div className="flex justify-center items-center h-screen"><Loader2 className="animate-spin text-purple-600" /></div>;

  // --- 表示切り替え ---

  if (mode === 'list') {
    return (
      <div className="min-h-screen bg-[#F0F3FF] p-6 font-sans text-slate-800">
        <div className="max-w-5xl mx-auto">
          <div className="flex items-center justify-between mb-8">
            <div className="flex items-center gap-4">
              <Link href="/master" className="bg-white p-3 rounded-full shadow-sm hover:shadow-md transition-all text-slate-600">
                <ArrowLeft size={20} />
              </Link>
              <div>
                <h1 className="text-xl font-black text-slate-800">アンケート設定</h1>
                <p className="text-xs font-bold text-slate-400">授業後の振り返りや特別アンケートの管理</p>
              </div>
            </div>
          </div>

          <div className="space-y-8">
            {/* 1. 通常授業用 (固定) */}
            <div className="space-y-4">
              <h2 className="text-sm font-black text-slate-500 flex items-center gap-2">
                <BookOpen size={18} className="text-purple-500"/>
                通常の授業アンケート
              </h2>
              {defaultSurvey && (
                <div className="bg-white p-6 rounded-2xl shadow-md border-l-8 border-purple-500 flex items-center justify-between group">
                  <div>
                    <h3 className="text-lg font-black text-slate-700 mb-1">{defaultSurvey.title}</h3>
                    <p className="text-xs text-slate-400 font-bold leading-relaxed">
                      このアンケートは<span className="text-purple-600">すべての授業終了後</span>に自動的に生徒へ表示されます。<br/>
                      回答結果は受講科目の<span className="text-purple-600">担当講師に自動集計</span>されます。
                    </p>
                  </div>
                  <button onClick={() => handleEdit(defaultSurvey)} className="px-6 py-3 bg-purple-50 text-purple-700 rounded-xl hover:bg-purple-100 transition-colors font-bold flex items-center gap-2">
                    <Edit3 size={18}/> 内容を編集
                  </button>
                </div>
              )}
            </div>

            {/* 2. カスタムアンケート */}
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-black text-slate-500 flex items-center gap-2">
                  <Calendar size={18} className="text-blue-500"/>
                  期間・対象指定アンケート (イベント等)
                </h2>
                <button onClick={handleCreateCustom} className="bg-blue-600 text-white px-4 py-2 rounded-lg font-bold shadow-sm hover:bg-blue-700 transition-all flex items-center gap-2 text-xs">
                  <Plus size={16}/> 新規追加
                </button>
              </div>

              {surveys.length === 0 ? (
                <div className="text-center py-10 text-slate-400 font-bold border-2 border-dashed border-slate-200 rounded-2xl text-sm">
                  カスタムアンケートはありません
                </div>
              ) : (
                <div className="grid gap-4">
                  {surveys.map(survey => {
                    const now = new Date().getTime();
                    const start = new Date(survey.startAt).getTime();
                    const end = new Date(survey.endAt).getTime();
                    let status = '待機中';
                    let statusColor = 'bg-gray-100 text-gray-500';
                    
                    if (!survey.isActive) {
                      status = '無効';
                    } else if (now > end) {
                      status = '終了';
                      statusColor = 'bg-red-100 text-red-600';
                    } else if (now >= start) {
                      status = '実施中';
                      statusColor = 'bg-green-100 text-green-600 animate-pulse';
                    } else {
                      statusColor = 'bg-blue-100 text-blue-600';
                    }

                    return (
                      <div key={survey.id} className="bg-white p-5 rounded-2xl shadow-sm border border-slate-100 hover:shadow-md transition-all flex items-center justify-between">
                        <div>
                          <div className="flex items-center gap-3 mb-1">
                            <span className={`text-[10px] font-black px-2 py-0.5 rounded ${statusColor}`}>{status}</span>
                            <h3 className="font-bold text-slate-700">{survey.title}</h3>
                          </div>
                          <div className="flex items-center gap-3 text-[10px] font-bold text-slate-400">
                            <span className="flex items-center gap-1"><Users size={12}/> {survey.targetType === 'all' ? '全員' : (survey.targetGrades?.join(', ') || '指定なし')}</span>
                            <span className="flex items-center gap-1"><Clock size={12}/> {new Date(survey.startAt).toLocaleString()} 〜 {new Date(survey.endAt).toLocaleString()}</span>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <button onClick={() => handleEdit(survey)} className="p-2 bg-slate-50 text-slate-500 rounded-lg hover:bg-slate-100 transition-colors">
                            <Edit3 size={16}/>
                          </button>
                          <button onClick={() => handleDeleteSurvey(survey.id!)} className="p-2 text-slate-300 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors">
                            <Trash2 size={16}/>
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }

  // --- 編集モード ---
  return (
    <div className="min-h-screen bg-[#F0F3FF] p-6 font-sans text-slate-800">
      <div className="max-w-4xl mx-auto pb-40">
        
        {/* ヘッダー */}
        <div className="flex items-center justify-between mb-6 sticky top-4 z-30 bg-[#F0F3FF]/90 backdrop-blur-sm p-2 rounded-2xl">
          <div className="flex items-center gap-4">
            <button onClick={() => setMode('list')} className="bg-white p-3 rounded-full shadow-sm hover:shadow-md transition-all text-slate-600">
              <ArrowLeft size={20} />
            </button>
            <div>
              <h1 className="text-xl font-black text-slate-800">
                {currentSurvey?.type === 'default' ? '通常授業アンケートの編集' : '特別アンケートの編集'}
              </h1>
            </div>
          </div>
          <button onClick={handleSave} disabled={saving} className="bg-purple-600 hover:bg-purple-700 text-white px-8 py-3 rounded-xl font-bold shadow-lg shadow-purple-200 transition-all active:scale-95 disabled:opacity-50 flex items-center gap-2">
            {saving ? <Loader2 className="animate-spin" size={20}/> : <Save size={20}/>} 保存する
          </button>
        </div>

        {currentSurvey && (
          <div className="space-y-8">
            
            {/* 1. 基本設定エリア */}
            <div className={`bg-white p-8 rounded-[32px] shadow-sm border relative overflow-hidden ${currentSurvey.type === 'default' ? 'border-purple-100' : 'border-blue-100'}`}>
              <div className={`absolute top-0 left-0 w-2 h-full ${currentSurvey.type === 'default' ? 'bg-purple-500' : 'bg-blue-500'}`}></div>
              
              <h2 className="text-lg font-black text-slate-700 mb-6 flex items-center gap-2">
                <Edit3 size={20} className={currentSurvey.type === 'default' ? 'text-purple-500' : 'text-blue-500'}/> 基本設定
              </h2>

              <div className="grid gap-6">
                {/* デフォルト設定の場合の案内表示 */}
                {currentSurvey.type === 'default' && (
                  <div className="bg-purple-50 p-4 rounded-xl border border-purple-100 text-sm text-purple-800 font-bold flex items-start gap-2">
                    <AlertCircle size={20} className="shrink-0 mt-0.5"/>
                    <div>
                      <p className="mb-1">これは「通常の授業」に対するアンケート設定です。</p>
                      <ul className="list-disc list-inside text-xs opacity-80 font-normal space-y-1">
                        <li>生徒が授業を完了したタイミングで自動的に表示されます。</li>
                        <li>回答は受講した科目の担当講師に紐づけられます。</li>
                        <li>日時や対象学年の指定は不要です（全生徒・全授業が対象）。</li>
                      </ul>
                    </div>
                  </div>
                )}

                {/* タイトル & 有効スイッチ */}
                <div className="flex gap-4">
                  <div className="flex-1">
                    <label className="block text-xs font-bold text-slate-400 mb-1">管理用タイトル</label>
                    <input 
                      type="text" 
                      value={currentSurvey.title} 
                      onChange={e => updateSurveyField('title', e.target.value)}
                      className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl font-bold text-slate-700 focus:outline-none focus:ring-2 focus:ring-purple-500"
                      placeholder="アンケートのタイトル"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-400 mb-1">状態</label>
                    <button 
                      onClick={() => updateSurveyField('isActive', !currentSurvey.isActive)}
                      className={`flex items-center gap-2 px-4 py-3 rounded-xl font-bold border-2 transition-all ${currentSurvey.isActive ? 'border-green-500 bg-green-50 text-green-700' : 'border-slate-200 bg-slate-50 text-slate-400'}`}
                    >
                      {currentSurvey.isActive ? <ToggleRight size={24}/> : <ToggleLeft size={24}/>}
                      {currentSurvey.isActive ? '有効' : '無効'}
                    </button>
                  </div>
                </div>

                {/* カスタムの場合のみ表示する設定（期間・対象） */}
                {currentSurvey.type === 'custom' && (
                  <div className="space-y-6 pt-4 border-t border-slate-100 animate-in fade-in">
                    {/* 対象設定 */}
                    <div>
                      <label className="block text-xs font-bold text-slate-400 mb-2">対象生徒</label>
                      <div className="flex gap-4 mb-3">
                        <label className={`flex-1 p-3 rounded-xl border-2 cursor-pointer font-bold text-sm flex items-center justify-center gap-2 ${currentSurvey.targetType === 'all' ? 'border-blue-500 bg-blue-50 text-blue-700' : 'border-slate-200 text-slate-500'}`}>
                          <input type="radio" className="hidden" checked={currentSurvey.targetType === 'all'} onChange={() => updateSurveyField('targetType', 'all')}/>
                          全員
                        </label>
                        <label className={`flex-1 p-3 rounded-xl border-2 cursor-pointer font-bold text-sm flex items-center justify-center gap-2 ${currentSurvey.targetType === 'grade' ? 'border-blue-500 bg-blue-50 text-blue-700' : 'border-slate-200 text-slate-500'}`}>
                          <input type="radio" className="hidden" checked={currentSurvey.targetType === 'grade'} onChange={() => updateSurveyField('targetType', 'grade')}/>
                          学年指定
                        </label>
                      </div>
                      
                      {currentSurvey.targetType === 'grade' && (
                        <div className="flex flex-wrap gap-2 bg-slate-50 p-4 rounded-xl border border-slate-200">
                          {GRADE_OPTIONS.map(g => (
                            <button 
                              key={g} 
                              onClick={() => toggleGrade(g)}
                              className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition-all ${currentSurvey.targetGrades.includes(g) ? 'bg-blue-500 text-white border-blue-500' : 'bg-white text-slate-500 border-slate-200'}`}
                            >
                              {g}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* 期間設定 */}
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="block text-xs font-bold text-slate-400 mb-1">表示開始日時</label>
                        <input 
                          type="datetime-local" 
                          value={currentSurvey.startAt}
                          onChange={e => updateSurveyField('startAt', e.target.value)}
                          className="w-full p-3 bg-white border border-slate-200 rounded-xl font-bold text-slate-700 focus:outline-none focus:border-blue-500"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-bold text-slate-400 mb-1">表示終了日時</label>
                        <input 
                          type="datetime-local" 
                          value={currentSurvey.endAt}
                          onChange={e => updateSurveyField('endAt', e.target.value)}
                          className="w-full p-3 bg-white border border-slate-200 rounded-xl font-bold text-slate-700 focus:outline-none focus:border-blue-500"
                        />
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* 2. 質問設定エリア (UIは維持) */}
            <div className="space-y-6">
              <div className="flex items-center gap-2 px-2">
                <div className="h-px bg-slate-300 flex-1"></div>
                <span className="text-sm font-black text-slate-400">質問フォームの内容</span>
                <div className="h-px bg-slate-300 flex-1"></div>
              </div>

              {currentSurvey.questions.map((q, index) => {
                const isActive = activeQId === q.id;
                return (
                  <div 
                    key={q.id} 
                    onClick={() => setActiveQId(q.id)}
                    className={`bg-white rounded-2xl shadow-sm transition-all duration-300 relative group border-l-[6px] ${isActive ? 'border-purple-500 ring-2 ring-purple-100 scale-[1.01] shadow-md z-10' : 'border-transparent hover:border-slate-200'}`}
                  >
                    <div className="absolute top-2 left-1/2 -translate-x-1/2 text-slate-300 opacity-0 group-hover:opacity-100 cursor-grab active:cursor-grabbing p-2">
                      <GripVertical size={16}/>
                    </div>

                    <div className="p-6 sm:p-8">
                      <div className="flex flex-col gap-6">
                        <div className="flex flex-col sm:flex-row gap-4 items-start">
                          <div className="flex-1 w-full">
                            <input 
                              type="text" 
                              value={q.text} 
                              onChange={(e) => updateQuestion(q.id, 'text', e.target.value)}
                              placeholder="質問タイトル"
                              className={`w-full p-4 bg-slate-50 border-b-2 rounded-t-lg font-bold text-lg outline-none transition-colors ${isActive ? 'border-purple-500 bg-purple-50/10' : 'border-slate-300 focus:border-purple-500'}`}
                            />
                          </div>
                          
                          <div className="relative w-full sm:w-48 shrink-0">
                            <select 
                              value={q.type} 
                              onChange={(e) => updateQuestion(q.id, 'type', e.target.value)}
                              className="w-full p-3 pl-10 bg-white border border-slate-200 rounded-lg text-sm font-bold text-slate-600 outline-none focus:border-purple-500 appearance-none cursor-pointer hover:bg-slate-50"
                            >
                              <option value="rating">5段階評価</option>
                              <option value="text">記述式 (短文)</option>
                            </select>
                            <div className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none">
                              {q.type === 'rating' ? <ListOrdered size={16}/> : <AlignLeft size={16}/>}
                            </div>
                          </div>
                        </div>

                        {q.type === 'rating' && (
                          <div className="bg-slate-50 p-5 rounded-xl border border-slate-100">
                            <p className="text-xs font-bold text-slate-400 mb-3 flex items-center gap-1"><Star size={12}/> 評価ラベルの設定</p>
                            <div className="space-y-3">
                              {[1, 2, 3, 4, 5].map((level) => (
                                <div key={level} className="flex items-center gap-3">
                                  <span className={`w-6 h-6 flex items-center justify-center rounded-full text-xs font-bold shrink-0 ${level === 1 || level === 5 ? 'bg-purple-100 text-purple-600' : 'bg-white text-slate-400 border border-slate-200'}`}>{level}</span>
                                  <input 
                                    type="text" 
                                    value={q.ratingLabels?.[level] || ''} 
                                    onChange={(e) => updateRatingLabel(q.id, level, e.target.value)}
                                    placeholder="ラベル (任意)"
                                    className="flex-1 p-2 bg-white border border-slate-200 rounded-lg text-sm outline-none focus:border-purple-400 focus:ring-2 focus:ring-purple-50 transition-all"
                                  />
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        <div className="flex items-center justify-end gap-4 pt-4 border-t border-slate-100">
                          <button onClick={() => updateQuestion(q.id, 'required', !q.required)} className="flex items-center gap-2 text-sm font-bold text-slate-600 hover:text-purple-600 transition-colors mr-auto">
                            {q.required ? <ToggleRight size={24} className="text-purple-600"/> : <ToggleLeft size={24} className="text-slate-300"/>}<span>必須</span>
                          </button>
                          <div className="h-6 w-px bg-slate-200 mx-2"></div>
                          <button onClick={() => duplicateQuestion(q)} className="p-2 text-slate-400 hover:text-purple-600 hover:bg-purple-50 rounded-full transition-colors"><Copy size={18}/></button>
                          <button onClick={() => deleteQuestion(q.id)} className="p-2 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-full transition-colors"><Trash2 size={18}/></button>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}

              <button onClick={addQuestion} className="w-full py-4 bg-white border-2 border-dashed border-slate-300 rounded-2xl text-slate-400 font-bold hover:border-purple-400 hover:text-purple-600 hover:bg-purple-50 transition-all flex items-center justify-center gap-2 shadow-sm">
                <Plus size={24}/> 質問を追加
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}