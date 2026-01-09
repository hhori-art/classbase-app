'use client';

import { useState } from 'react';
import { createClient } from '@/lib/supabase-client';
import { Zap, Filter, Clock } from 'lucide-react';
import { useRouter } from 'next/navigation';

export default function BulkUrlUpdate() {
  const [filters, setFilters] = useState({
    grade: '', science: '', social: '', day: '', classroom: ''
  });
  
  const [url1, setUrl1] = useState('');
  const [url2, setUrl2] = useState('');
  
  const [loading, setLoading] = useState(false);
  const supabase = createClient();
  const router = useRouter();

  const handleChange = (key: string, value: string) => {
    setFilters(prev => ({ ...prev, [key]: value }));
  };

  const handleBulkUpdate = async () => {
    if (!url1 && !url2) return alert('更新したいZoom URLを入力してください');

    const targets = [];
    if (url1) targets.push('【1時間目】');
    if (url2) targets.push('【2時間目】');

    const conditions = [];
    if (filters.grade) conditions.push(`学年: ${filters.grade}`);
    if (filters.science) conditions.push(`理科: ${filters.science}`);
    if (filters.social) conditions.push(`社会: ${filters.social}`);
    if (filters.day) conditions.push(`曜日: ${filters.day}`);
    if (filters.classroom) conditions.push(`教室: ${filters.classroom}`);
    
    if (conditions.length === 0) {
      if (!confirm(`【警告】条件なしで ${targets.join(' と ')} のURLを一括更新しますか？\n全生徒が対象になります。`)) return;
    } else {
      if (!confirm(`以下の条件の生徒の ${targets.join(' と ')} を更新します。\n\n条件:\n${conditions.join('\n')}\n\n実行しますか？`)) return;
    }

    setLoading(true);
    try {
      const updates: any = {};
      if (url1) updates.zoom_url = url1;
      if (url2) updates.zoom_url_2 = url2;

      let query = supabase.from('profiles').update(updates).eq('role', 'student');

      if (filters.grade) query = query.eq('grade', filters.grade);
      if (filters.science) query = query.eq('science_subject', filters.science);
      if (filters.social) query = query.eq('social_subject', filters.social);
      if (filters.day) query = query.eq('day_of_week', filters.day);
      if (filters.classroom) query = query.eq('classroom', filters.classroom);

      const { error } = await query;
      if (error) throw error;

      alert('一括更新が完了しました！');
      if (url1) setUrl1('');
      if (url2) setUrl2('');
      router.refresh();
      
    } catch (e) {
      alert('更新に失敗しました');
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bg-white p-6 rounded-xl shadow-md border-l-4 border-blue-600 mb-8">
      <h2 className="font-bold text-gray-800 text-lg flex items-center gap-2 mb-4">
        <Zap className="text-blue-600 fill-blue-600" />
        条件を指定してZoom URLを一括配布
      </h2>
      
      {/* フィルター条件エリア */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-4 p-4 bg-gray-50 rounded-lg border border-gray-200">
        <div>
          <label className="block text-xs font-bold text-gray-500 mb-1">学年</label>
          <select className="w-full p-2 text-sm border rounded text-gray-900" value={filters.grade} onChange={(e) => handleChange('grade', e.target.value)}>
            <option value="">指定なし</option>
            <option value="中1">中1</option>
            <option value="中2">中2</option>
            <option value="中3">中3</option>
          </select>
        </div>
        <div>
          <label className="block text-xs font-bold text-gray-500 mb-1">理科科目</label>
          <select className="w-full p-2 text-sm border rounded text-gray-900" value={filters.science} onChange={(e) => handleChange('science', e.target.value)}>
            <option value="">指定なし</option>
            <option value="生物">生物</option>
            <option value="物理">物理</option>
            <option value="化学">化学</option>
            <option value="地学">地学</option>
          </select>
        </div>
        <div>
          <label className="block text-xs font-bold text-gray-500 mb-1">社会科目</label>
          <select className="w-full p-2 text-sm border rounded text-gray-900" value={filters.social} onChange={(e) => handleChange('social', e.target.value)}>
            <option value="">指定なし</option>
            <option value="地理">地理</option>
            <option value="歴史">歴史</option>
            <option value="公民">公民</option>
          </select>
        </div>
        <div>
          <label className="block text-xs font-bold text-gray-500 mb-1">曜日</label>
          <select className="w-full p-2 text-sm border rounded text-gray-900" value={filters.day} onChange={(e) => handleChange('day', e.target.value)}>
            <option value="">指定なし</option>
            <option value="月">月曜</option>
            <option value="火">火曜</option>
            <option value="水">水曜</option>
            <option value="木">木曜</option>
            <option value="金">金曜</option>
            {/* ★ここに追加 */}
            <option value="土">土曜</option>
          </select>
        </div>
        <div>
          <label className="block text-xs font-bold text-gray-500 mb-1">教室</label>
          <input type="text" placeholder="例: 神戸校" className="w-full p-2 text-sm border rounded text-gray-900" value={filters.classroom} onChange={(e) => handleChange('classroom', e.target.value)}/>
        </div>
      </div>

      {/* URL入力と実行 */}
      <div className="flex flex-col md:flex-row gap-4 items-end">
        <div className="flex-1 w-full">
          <label className="block text-xs font-bold text-blue-600 mb-1 flex items-center gap-1">
            <Clock size={12}/> 1時間目のURL
          </label>
          <input
            type="text"
            value={url1}
            onChange={(e) => setUrl1(e.target.value)}
            placeholder="入力すると更新されます..."
            className="w-full p-3 border border-blue-200 rounded-lg text-gray-900 bg-white focus:ring-2 focus:ring-blue-200 outline-none font-mono"
          />
        </div>

        <div className="flex-1 w-full">
          <label className="block text-xs font-bold text-purple-600 mb-1 flex items-center gap-1">
            <Clock size={12}/> 2時間目のURL
          </label>
          <input
            type="text"
            value={url2}
            onChange={(e) => setUrl2(e.target.value)}
            placeholder="入力すると更新されます..."
            className="w-full p-3 border border-purple-200 rounded-lg text-gray-900 bg-white focus:ring-2 focus:ring-purple-200 outline-none font-mono"
          />
        </div>

        <button
          onClick={handleBulkUpdate}
          disabled={loading}
          className="w-full md:w-auto bg-blue-600 text-white px-8 py-3 rounded-lg font-bold hover:bg-blue-700 transition-colors shadow-sm disabled:opacity-50 whitespace-nowrap h-[50px]"
        >
          {loading ? '更新中...' : '適用する'}
        </button>
      </div>
      <p className="text-xs text-gray-400 mt-2 text-right">※空欄のまま適用ボタンを押すと、その時間のURLは変更されません。</p>
    </div>
  );
}