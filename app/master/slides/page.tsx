'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { db } from '@/lib/firebase';
import { collection, addDoc, getDocs, deleteDoc, doc, query, orderBy, serverTimestamp } from 'firebase/firestore';
import { ArrowLeft, Plus, Trash2, Save, Loader2, FileText, Check } from 'lucide-react';

// 科目定義 (生徒側と合わせる)
const SUBJECT_CATEGORIES = {
  science: { label: '理科', items: ['物理', '化学', '生物', '地学'], color: 'bg-purple-100 text-purple-700' },
  society: { label: '社会', items: ['地理', '歴史', '公民'], color: 'bg-orange-100 text-orange-700' },
  basics:  { label: '主要', items: ['英語', '数学'], color: 'bg-blue-100 text-blue-700' }
};

export default function SlideManagerPage() {
  const [units, setUnits] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  // 入力フォーム
  const [grade, setGrade] = useState('中1');
  
  // カテゴリ選択管理
  const [selectedCategory, setSelectedCategory] = useState<keyof typeof SUBJECT_CATEGORIES>('science');
  const [subject, setSubject] = useState('物理'); // 具体的な科目 (例: 物理, 地理)

  const [unitName, setUnitName] = useState('');
  const [content, setContent] = useState('');

  useEffect(() => {
    fetchUnits();
  }, []);

  // カテゴリが変わったら、そのカテゴリの先頭の科目をデフォルトセット
  const handleCategoryChange = (cat: keyof typeof SUBJECT_CATEGORIES) => {
    setSelectedCategory(cat);
    setSubject(SUBJECT_CATEGORIES[cat].items[0]);
  };

  const fetchUnits = async () => {
    try {
      const q = query(collection(db, 'learning_units'), orderBy('created_at', 'desc'));
      const snap = await getDocs(q);
      setUnits(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!unitName || !content || !subject) return alert('全ての項目を入力してください');

    setSubmitting(true);
    try {
      await addDoc(collection(db, 'learning_units'), {
        grade,
        subject, // ここに '物理' や '地理' が入ります
        category: selectedCategory, // 後でフィルタリングしやすいようにカテゴリも保存
        unit_name: unitName,
        content: content, 
        created_at: serverTimestamp()
      });

      alert('単元を登録しました');
      setUnitName('');
      setContent('');
      fetchUnits();
    } catch (e) {
      console.error(e);
      alert('登録失敗');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('削除しますか？')) return;
    await deleteDoc(doc(db, 'learning_units', id));
    setUnits(prev => prev.filter(u => u.id !== id));
  };

  // 一覧表示用のバッジ色決定ヘルパー
  const getBadgeStyle = (subj: string) => {
    if (SUBJECT_CATEGORIES.science.items.includes(subj)) return 'bg-purple-100 text-purple-700';
    if (SUBJECT_CATEGORIES.society.items.includes(subj)) return 'bg-orange-100 text-orange-700';
    return 'bg-blue-100 text-blue-700';
  };

  return (
    <div className="min-h-screen bg-gray-50 p-8">
      <div className="max-w-6xl mx-auto">
        <div className="flex items-center gap-4 mb-8">
          <Link href="/master/imports" className="bg-white p-3 rounded-full shadow hover:bg-gray-100">
            <ArrowLeft size={20} />
          </Link>
          <h1 className="text-2xl font-bold text-gray-800 flex items-center gap-2">
            <FileText className="text-indigo-600" /> スライド(単元)・教材管理
          </h1>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* 左側：登録フォーム */}
          <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100 h-fit">
            <h2 className="font-bold text-gray-700 mb-6 flex items-center gap-2">
              <Plus className="bg-indigo-100 text-indigo-600 rounded p-1" size={20} />
              新規単元の登録
            </h2>
            <form onSubmit={handleSubmit} className="space-y-6">
              
              {/* 学年選択 */}
              <div>
                <label className="block text-xs font-bold text-gray-400 mb-2">対象学年</label>
                <div className="flex bg-gray-100 p-1 rounded-lg">
                  {['中1','中2','中3'].map(g => (
                    <button
                      key={g}
                      type="button"
                      onClick={() => setGrade(g)}
                      className={`flex-1 py-2 text-sm font-bold rounded-md transition-all ${grade === g ? 'bg-white shadow text-indigo-600' : 'text-gray-400 hover:text-gray-600'}`}
                    >
                      {g}
                    </button>
                  ))}
                </div>
              </div>

              {/* 科目カテゴリ選択 */}
              <div>
                <label className="block text-xs font-bold text-gray-400 mb-2">教科カテゴリー</label>
                <div className="grid grid-cols-3 gap-2">
                  {(Object.entries(SUBJECT_CATEGORIES) as [keyof typeof SUBJECT_CATEGORIES, any][]).map(([key, data]) => (
                    <button
                      key={key}
                      type="button"
                      onClick={() => handleCategoryChange(key)}
                      className={`py-2 rounded-lg text-sm font-bold border-2 transition-all ${selectedCategory === key ? `border-transparent ${data.color} ring-2 ring-offset-1 ring-gray-200` : 'border-gray-100 bg-white text-gray-500 hover:border-gray-200'}`}
                    >
                      {data.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* 詳細科目選択 */}
              <div>
                <label className="block text-xs font-bold text-gray-400 mb-2">詳細分野</label>
                <div className="flex flex-wrap gap-2">
                  {SUBJECT_CATEGORIES[selectedCategory].items.map((item) => (
                    <button
                      key={item}
                      type="button"
                      onClick={() => setSubject(item)}
                      className={`px-4 py-2 rounded-lg text-sm font-bold flex items-center gap-2 transition-all ${subject === item ? 'bg-gray-800 text-white shadow-md' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'}`}
                    >
                      {item}
                      {subject === item && <Check size={14}/>}
                    </button>
                  ))}
                </div>
              </div>

              <div className="h-px bg-gray-100 my-4"></div>

              {/* 単元名 */}
              <div>
                <label className="block text-xs font-bold text-gray-400 mb-1">単元名 (例: 世界の姿)</label>
                <input 
                  type="text" 
                  value={unitName} 
                  onChange={e => setUnitName(e.target.value)}
                  className="w-full p-3 border border-gray-200 rounded-xl font-bold focus:ring-2 focus:ring-indigo-200 outline-none"
                  placeholder="単元名を入力"
                />
              </div>

              {/* 内容 */}
              <div>
                <label className="block text-xs font-bold text-gray-400 mb-1">スライドの内容 (テキスト)</label>
                <p className="text-[10px] text-gray-400 mb-2 bg-gray-50 p-2 rounded border border-gray-100">
                  ※ここに貼り付けたテキストをAIが読み込んで問題を作成します。
                </p>
                <textarea 
                  value={content}
                  onChange={e => setContent(e.target.value)}
                  className="w-full h-48 p-3 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-indigo-200 outline-none resize-none"
                  placeholder="スライドの文字情報をコピー＆ペーストしてください..."
                />
              </div>

              <button 
                type="submit"
                disabled={submitting}
                className="w-full bg-indigo-600 text-white py-3.5 rounded-xl font-bold hover:bg-indigo-700 transition-all flex justify-center items-center gap-2 shadow-lg shadow-indigo-200 active:scale-95 disabled:opacity-50 disabled:transform-none"
              >
                {submitting ? <Loader2 className="animate-spin" size={20}/> : <Save size={20}/>} 
                この内容で登録
              </button>
            </form>
          </div>

          {/* 右側：一覧 */}
          <div className="lg:col-span-2 space-y-4">
            <h2 className="font-bold text-gray-700">登録済み単元リスト</h2>
            {loading ? <div className="text-center py-20"><Loader2 className="animate-spin inline text-indigo-400"/></div> : 
             units.length === 0 ? (
               <div className="text-gray-400 text-center py-20 bg-white rounded-2xl border border-dashed border-gray-200">
                 登録データがありません
               </div>
             ) : (
             <div className="grid grid-cols-1 gap-3">
               {units.map(unit => (
                 <div key={unit.id} className="bg-white p-5 rounded-xl border border-gray-100 shadow-sm hover:border-indigo-200 transition-all flex justify-between items-start group">
                   <div>
                     <div className="flex items-center gap-2 mb-2">
                       <span className="text-xs font-bold bg-gray-100 text-gray-600 px-2 py-1 rounded">{unit.grade}</span>
                       <span className={`text-xs font-bold px-2 py-1 rounded ${getBadgeStyle(unit.subject)}`}>
                         {unit.subject}
                       </span>
                       <span className="text-[10px] text-gray-400">
                         {unit.created_at?.toDate ? new Date(unit.created_at.toDate()).toLocaleDateString() : '日時不明'}
                       </span>
                     </div>
                     <h3 className="font-bold text-lg text-gray-800 mb-1">{unit.unit_name}</h3>
                     <p className="text-xs text-gray-500 line-clamp-2 bg-gray-50 p-2 rounded max-w-xl">
                       {unit.content}
                     </p>
                   </div>
                   <button 
                     onClick={() => handleDelete(unit.id)} 
                     className="p-2 text-gray-300 hover:text-red-500 hover:bg-red-50 rounded-full transition-colors opacity-0 group-hover:opacity-100"
                   >
                     <Trash2 size={18}/>
                   </button>
                 </div>
               ))}
             </div>
             )
            }
          </div>
        </div>
      </div>
    </div>
  );
}