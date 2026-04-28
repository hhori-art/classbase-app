'use client';

import { useEffect, useMemo, useState } from 'react';
import { auth } from '@/lib/firebase';
import { ArrowDownUp, BookOpen, CalendarDays, Loader2, Plus, Save, Search, Settings2, Trash2 } from 'lucide-react';

const GRADES = ['全学年', '中1', '中2', '中3'];
const SUBJECTS = ['全科目', '理科', '社会'];
const SORT_OPTIONS = [
  { key: 'week_no', label: '週' },
  { key: 'term_label', label: 'ターム' },
  { key: 'grade', label: '学年' },
  { key: 'subject', label: '科目' },
  { key: 'course_name', label: '講座/クラス' },
  { key: 'unit', label: '単元名' },
  { key: 'month_label', label: '月' },
];

export default function MasterCurriculumPage() {
  const [year, setYear] = useState(new Date().getFullYear());
  const [terms, setTerms] = useState<any[]>([]);
  const [curriculum, setCurriculum] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [filterGrade, setFilterGrade] = useState('全学年');
  const [filterSubject, setFilterSubject] = useState('全科目');
  const [search, setSearch] = useState('');
  const [sortKey, setSortKey] = useState('week_no');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [editingRows, setEditingRows] = useState<Record<string, any>>({});
  const [savingRows, setSavingRows] = useState<Record<string, boolean>>({});

  const load = async () => {
    setLoading(true);
    try {
      const token = await auth.currentUser?.getIdToken();
      const res = await fetch(`/api/curriculum-admin?year=${year}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      const data = await res.json();
      if (!res.ok || data.ok === false) throw new Error(data.error || '読み込みに失敗しました');
      setTerms(data.terms || []);
      setCurriculum(data.curriculum || []);
    } catch (e: any) {
      alert(e.message || '読み込みに失敗しました');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, [year]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return curriculum
      .filter(item => filterGrade === '全学年' || item.grade === filterGrade)
      .filter(item => filterSubject === '全科目' || item.subject === filterSubject)
      .filter(item => !q || `${item.course_name} ${item.unit} ${item.week_no} ${item.term_label}`.toLowerCase().includes(q))
      .sort((a, b) => {
        const normalize = (value: any) => sortKey === 'week_no' ? String(value || '').padStart(3, '0') : String(value || '');
        const result = normalize(a[sortKey]).localeCompare(normalize(b[sortKey]), 'ja', { numeric: true });
        return sortDir === 'asc' ? result : -result;
      });
  }, [curriculum, filterGrade, filterSubject, search, sortKey, sortDir]);

  const updateTerm = (index: number, key: string, value: string) => {
    setTerms(prev => prev.map((term, i) => i === index ? { ...term, [key]: key.includes('week') ? Number(value) : value } : term));
  };

  const addTerm = () => {
    const nextNo = terms.length + 1;
    setTerms(prev => [...prev, {
      id: `term_custom_${Date.now()}`,
      year,
      label: `追加ターム${nextNo}`,
      start_week: 1,
      end_week: 1,
      start_date: '',
      end_date: '',
      registration_opens_at: '',
    }]);
  };

  const deleteTerm = (index: number) => {
    const target = terms[index];
    if (!confirm(`${target?.label || 'このターム'}を削除しますか？\n保存するとDB上のターム設定からも削除されます。`)) return;
    setTerms(prev => prev.filter((_, i) => i !== index));
  };

  const saveTerms = async () => {
    setSaving(true);
    try {
      const token = await auth.currentUser?.getIdToken();
      const res = await fetch('/api/curriculum-admin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ year, terms, replace_terms: true }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.ok === false) throw new Error(data.error || '保存に失敗しました');
      alert(`ターム設定を保存しました。\nカリキュラム ${data.updated_curriculum || 0}件、講座候補 ${data.updated_options || 0}件を更新しました。`);
      await load();
    } catch (e: any) {
      alert(e.message || '保存に失敗しました');
    } finally {
      setSaving(false);
    }
  };

  const updateEditingRow = (id: string, key: string, value: string) => {
    setEditingRows(prev => ({ ...prev, [id]: { ...(prev[id] || {}), [key]: value } }));
  };

  const rowValue = (item: any, key: string) => editingRows[item.id]?.[key] ?? item[key] ?? '';

  const saveCurriculumRow = async (item: any) => {
    const patch = editingRows[item.id];
    if (!patch) return;
    setSavingRows(prev => ({ ...prev, [item.id]: true }));
    try {
      const token = await auth.currentUser?.getIdToken();
      const res = await fetch('/api/curriculum-admin', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ id: item.id, ...patch }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.ok === false) throw new Error(data.error || '保存に失敗しました');
      setCurriculum(prev => prev.map(row => row.id === item.id ? { ...row, ...patch } : row));
      setEditingRows(prev => {
        const next = { ...prev };
        delete next[item.id];
        return next;
      });
    } catch (e: any) {
      alert(e.message || '保存に失敗しました');
    } finally {
      setSavingRows(prev => ({ ...prev, [item.id]: false }));
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 p-6 pb-24 text-slate-800">
      <div className="mx-auto max-w-7xl space-y-6">
        <header className="rounded-[28px] bg-white p-6 shadow-sm">
          <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
            <div>
              <p className="flex items-center gap-2 text-xs font-black text-indigo-500"><BookOpen size={16} /> Curriculum Master</p>
              <h1 className="mt-2 text-2xl font-black">カリキュラム・ターム管理</h1>
              <p className="mt-1 text-sm font-bold text-slate-500">年間予定の授業週と連動して、保護者の講座登録に使うタームと単元を整理します。</p>
            </div>
            <div className="flex items-center gap-2 rounded-2xl bg-slate-100 p-2">
              <CalendarDays size={18} className="text-slate-400" />
              <input value={year} onChange={e => setYear(Number(e.target.value) || year)} className="w-24 bg-transparent text-sm font-black outline-none" inputMode="numeric" />
            </div>
          </div>
        </header>

        <section className="rounded-[28px] bg-white p-6 shadow-sm">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <p className="flex items-center gap-2 text-xs font-black text-indigo-500"><Settings2 size={15} /> ターム設定</p>
              <h2 className="mt-1 text-lg font-black">授業週からタームを作成</h2>
              <p className="mt-1 text-xs font-bold text-slate-400">開始日・終了日は年間授業予定から推定されます。必要な場合だけ手で上書きしてください。</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button onClick={addTerm} className="inline-flex items-center gap-2 rounded-2xl border border-indigo-100 bg-indigo-50 px-4 py-3 text-sm font-black text-indigo-700 hover:bg-indigo-100">
                <Plus size={16} /> ターム追加
              </button>
              <button onClick={saveTerms} disabled={saving || terms.length === 0} className="inline-flex items-center gap-2 rounded-2xl bg-slate-900 px-5 py-3 text-sm font-black text-white hover:bg-slate-800 disabled:opacity-50">
                {saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
                保存して講座候補へ反映
              </button>
            </div>
          </div>
          <div className="grid gap-3 lg:grid-cols-4">
            {terms.map((term, index) => (
              <div key={term.id || index} className="rounded-2xl border border-slate-100 bg-slate-50 p-4">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <span className="rounded-full bg-white px-2 py-1 text-[10px] font-black text-slate-400">{term.id}</span>
                  <button onClick={() => deleteTerm(index)} className="rounded-lg bg-white p-2 text-slate-300 hover:bg-rose-50 hover:text-rose-500" title="削除">
                    <Trash2 size={14} />
                  </button>
                </div>
                <label className="mb-1 block text-[11px] font-black text-slate-400">ターム名</label>
                <input value={term.label || ''} onChange={e => updateTerm(index, 'label', e.target.value)} className="mb-3 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-black outline-none" />
                <div className="grid grid-cols-2 gap-2">
                  <Field label="開始週" value={term.start_week || ''} onChange={v => updateTerm(index, 'start_week', v)} />
                  <Field label="終了週" value={term.end_week || ''} onChange={v => updateTerm(index, 'end_week', v)} />
                  <Field label="開始日" type="date" value={term.start_date || ''} onChange={v => updateTerm(index, 'start_date', v)} />
                  <Field label="終了日" type="date" value={term.end_date || ''} onChange={v => updateTerm(index, 'end_date', v)} />
                </div>
                <Field label="登録開始日" type="date" value={term.registration_opens_at || ''} onChange={v => updateTerm(index, 'registration_opens_at', v)} />
                <p className="mt-2 text-[10px] font-bold text-slate-400">年間予定連動: {term.linked_lesson_count || 0}件</p>
              </div>
            ))}
          </div>
        </section>

        <section className="rounded-[28px] bg-white p-6 shadow-sm">
          <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <p className="text-xs font-black text-indigo-500">カリキュラム一覧</p>
              <h2 className="mt-1 text-lg font-black">登録済み単元の確認</h2>
            </div>
            <div className="grid gap-2 sm:grid-cols-5">
              <select value={filterGrade} onChange={e => setFilterGrade(e.target.value)} className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-black outline-none">{GRADES.map(v => <option key={v}>{v}</option>)}</select>
              <select value={filterSubject} onChange={e => setFilterSubject(e.target.value)} className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-black outline-none">{SUBJECTS.map(v => <option key={v}>{v}</option>)}</select>
              <select value={sortKey} onChange={e => setSortKey(e.target.value)} className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-black outline-none">{SORT_OPTIONS.map(v => <option key={v.key} value={v.key}>{v.label}でソート</option>)}</select>
              <button onClick={() => setSortDir(prev => prev === 'asc' ? 'desc' : 'asc')} className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-black text-slate-600">
                <ArrowDownUp size={15} /> {sortDir === 'asc' ? '昇順' : '降順'}
              </button>
              <label className="flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
                <Search size={15} className="text-slate-400" />
                <input value={search} onChange={e => setSearch(e.target.value)} placeholder="単元検索" className="w-full bg-transparent text-sm font-bold outline-none" />
              </label>
            </div>
          </div>
          {loading ? (
            <div className="flex justify-center py-10"><Loader2 className="animate-spin text-indigo-500" /></div>
          ) : (
            <div className="overflow-x-auto rounded-2xl border border-slate-100">
              <table className="w-full min-w-[900px] border-collapse text-sm">
                <thead className="bg-slate-50 text-left text-xs font-black text-slate-400">
                  <tr>
                    <th className="px-4 py-3">週</th>
                    <th className="px-4 py-3">ターム</th>
                    <th className="px-4 py-3">学年</th>
                    <th className="px-4 py-3">科目</th>
                    <th className="px-4 py-3">講座/クラス</th>
                    <th className="px-4 py-3">単元名</th>
                    <th className="px-4 py-3">月</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filtered.slice(0, 500).map(item => (
                    <tr key={item.id} className="hover:bg-slate-50">
                      <td className="px-3 py-3"><EditInput value={rowValue(item, 'week_no')} onChange={v => updateEditingRow(item.id, 'week_no', v)} className="w-16" /></td>
                      <td className="px-3 py-3">
                        <select value={rowValue(item, 'term')} onChange={e => {
                          const term = terms.find(t => t.id === e.target.value);
                          updateEditingRow(item.id, 'term', e.target.value);
                          updateEditingRow(item.id, 'term_label', term?.label || e.target.value);
                        }} className="w-32 rounded-xl border border-slate-200 bg-white px-2 py-2 text-xs font-black outline-none">
                          {terms.map(term => <option key={term.id} value={term.id}>{term.label}</option>)}
                        </select>
                      </td>
                      <td className="px-3 py-3"><EditInput value={rowValue(item, 'grade')} onChange={v => updateEditingRow(item.id, 'grade', v)} className="w-20" /></td>
                      <td className="px-3 py-3"><EditInput value={rowValue(item, 'subject')} onChange={v => updateEditingRow(item.id, 'subject', v)} className="w-20" /></td>
                      <td className="px-3 py-3"><EditInput value={rowValue(item, 'course_name')} onChange={v => updateEditingRow(item.id, 'course_name', v)} className="w-32" /></td>
                      <td className="px-3 py-3"><EditInput value={rowValue(item, 'unit')} onChange={v => updateEditingRow(item.id, 'unit', v)} className="w-72" /></td>
                      <td className="px-3 py-3">
                        <div className="flex items-center gap-2">
                          <EditInput value={rowValue(item, 'month_label')} onChange={v => updateEditingRow(item.id, 'month_label', v)} className="w-20" />
                          <button onClick={() => saveCurriculumRow(item)} disabled={!editingRows[item.id] || savingRows[item.id]} className="rounded-xl bg-slate-900 px-3 py-2 text-xs font-black text-white disabled:opacity-30">
                            {savingRows[item.id] ? '保存中' : '保存'}
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

function Field({ label, value, onChange, type = 'text' }: { label: string; value: string | number; onChange: (value: string) => void; type?: string }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] font-black text-slate-400">{label}</span>
      <input type={type} value={value} onChange={e => onChange(e.target.value)} className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-bold outline-none focus:ring-2 focus:ring-indigo-100" />
    </label>
  );
}

function EditInput({ value, onChange, className = '' }: { value: string | number; onChange: (value: string) => void; className?: string }) {
  return (
    <input
      value={value}
      onChange={e => onChange(e.target.value)}
      className={`rounded-xl border border-slate-200 bg-white px-2 py-2 text-xs font-bold outline-none focus:ring-2 focus:ring-indigo-100 ${className}`}
    />
  );
}
