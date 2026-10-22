'use client';

import { useEffect, useMemo, useState } from 'react';
import { auth } from '@/lib/firebase';
import { ArrowDownUp, CalendarDays, Plus, Save, Search, Settings2, Trash2 } from 'lucide-react';
import AdminPageHeader from '@/app/components/master/AdminPageHeader';
import { Button, EmptyState, ErrorState, IconButton, ListSkeleton, useConfirm, useToast } from '@/app/components/ui';
import { cn } from '@/lib/cn';

const GRADES = ['全学年', '中1', '中2', '中3'];
const TERM_GRADES = ['中1', '中2', '中3'];
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
  const toast = useToast();
  const confirm = useConfirm();
  const [year, setYear] = useState(new Date().getFullYear());
  const [terms, setTerms] = useState<any[]>([]);
  const [curriculum, setCurriculum] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
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
    setLoadError('');
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
      console.error(e);
      setLoadError(e.message || '読み込みに失敗しました');
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

  const updateTerm = (index: number, key: string, value: any) => {
    setTerms(prev => prev.map((term, i) => i === index ? { ...term, [key]: key.includes('week') ? Number(value) : value } : term));
  };

  const assignSsToTerm = (index: number) => {
    setTerms(prev => {
      const targetGrades = Array.isArray(prev[index]?.grades) ? prev[index].grades : [];
      const overlapsTarget = (term: any) => {
        const grades = Array.isArray(term.grades) ? term.grades : [];
        if (targetGrades.length === 0 || grades.length === 0) return true;
        return grades.some((grade: string) => targetGrades.includes(grade));
      };
      return prev.map((term, i) => ({
        ...term,
        includes_ss: i === index ? true : (overlapsTarget(term) ? false : term.includes_ss === true),
      }));
    });
  };

  const toggleTermGrade = (index: number, grade: string) => {
    setTerms(prev => prev.map((term, i) => {
      if (i !== index) return term;
      const current = Array.isArray(term.grades) ? term.grades : [];
      return {
        ...term,
        grades: current.includes(grade)
          ? current.filter((item: string) => item !== grade)
          : [...current, grade],
      };
    }));
  };

  const splitTermsByGradePace = async () => {
    if (!(await confirm({
      title: 'ターム設定を「中1・中2用」と「中3用」に分けますか？',
      message: '「保存して講座候補へ反映」を押すまでは保存されません。',
      confirmLabel: '分ける',
    }))) return;
    setTerms(prev => prev.flatMap(term => {
      const base = { ...term, grades: [] };
      return [
        { ...base, label: `${term.label || term.id}（中1・中2）`, grades: ['中1', '中2'] },
        { ...base, label: `${term.label || term.id}（中3）`, grades: ['中3'] },
      ];
    }));
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
      grades: [],
      includes_ss: false,
    }]);
  };

  const deleteTerm = async (index: number) => {
    const target = terms[index];
    if (!(await confirm({
      title: target?.label ? `「${target.label}」を削除しますか？` : 'このタームを削除しますか？',
      message: '保存すると、登録済みのターム設定からも削除されます。',
      confirmLabel: '削除する',
      tone: 'danger',
    }))) return;
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
      toast.success(`ターム設定を保存しました（カリキュラム ${data.updated_curriculum || 0}件・講座候補 ${data.updated_options || 0}件を更新）。`);
      await load();
    } catch (e: any) {
      console.error(e);
      toast.error(e.message || '保存に失敗しました');
    } finally {
      setSaving(false);
    }
  };

  const updateEditingRow = (id: string, key: string, value: string) => {
    setEditingRows(prev => ({ ...prev, [id]: { ...(prev[id] || {}), [key]: value } }));
  };

  const rowValue = (item: any, key: string) => editingRows[item.id]?.[key] ?? item[key] ?? '';

  const termOptionsForGrade = (grade: string) => {
    const specific = terms.filter(term => Array.isArray(term.grades) && term.grades.includes(grade));
    return specific.length > 0 ? specific : terms.filter(term => !Array.isArray(term.grades) || term.grades.length === 0);
  };

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
      console.error(e);
      toast.error(e.message || '保存に失敗しました');
    } finally {
      setSavingRows(prev => ({ ...prev, [item.id]: false }));
    }
  };

  return (
    <div className="pb-24 text-slate-800">
      <div className="space-y-6">
        <AdminPageHeader
          description="年間予定の授業週と連動して、保護者の講座登録に使うタームと単元を整理します。"
          actions={<label className="flex min-h-11 items-center gap-2 rounded-input border border-line bg-surface px-3">
            <CalendarDays size={18} className="text-slate-400" aria-hidden />
            <span className="sr-only">年度</span>
            <input value={year} onChange={e => setYear(Number(e.target.value) || year)} className="w-24 bg-transparent text-sm font-bold outline-none" inputMode="numeric" />
          </label>}
        />

        <section className="rounded-card border border-line bg-surface p-6 shadow-sm">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <p className="flex items-center gap-2 text-xs font-bold text-accent"><Settings2 size={15} aria-hidden /> ターム設定</p>
              <h2 className="mt-1 text-lg font-bold">授業週からタームを作成</h2>
              <p className="mt-1 text-xs font-bold text-slate-400">開始日・終了日は年間授業予定から推定されます。SSは週数に加えず、選択した期の夏期講習として扱います。</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" onClick={splitTermsByGradePace}>
                中1・中2 / 中3に分ける
              </Button>
              <Button variant="secondary" onClick={addTerm} icon={<Plus size={16} aria-hidden />}>
                ターム追加
              </Button>
              <Button onClick={saveTerms} disabled={saving || terms.length === 0} loading={saving} icon={<Save size={16} aria-hidden />}>
                保存して講座候補へ反映
              </Button>
            </div>
          </div>
          <div className="grid gap-3 lg:grid-cols-4">
            {terms.map((term, index) => (
              <div key={`${term.id || 'term'}_${(term.grades || []).join('_')}_${index}`} className="rounded-card border border-slate-100 bg-slate-50 p-4">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <span className="rounded-full bg-surface px-2 py-1 text-xs font-bold text-slate-500">
                    {term.id} / {term.grades?.length ? term.grades.join('・') : '全学年'}
                  </span>
                  <IconButton label="ターム削除" size="sm" onClick={() => deleteTerm(index)} className="text-slate-400 hover:bg-rose-50 hover:text-rose-600">
                    <Trash2 size={14} aria-hidden />
                  </IconButton>
                </div>
                <div className="mb-3">
                  <p className="mb-1 text-xs font-bold text-slate-500">対象学年</p>
                  <div className="flex flex-wrap gap-1.5">
                    <button
                      type="button"
                      onClick={() => updateTerm(index, 'grades', [])}
                      className={cn('rounded-btn px-2 py-1 text-xs font-bold', !term.grades?.length ? 'bg-accent text-accent-ink' : 'bg-surface text-slate-500')}
                    >
                      全学年
                    </button>
                    {TERM_GRADES.map(grade => (
                      <button
                        key={grade}
                        type="button"
                        onClick={() => toggleTermGrade(index, grade)}
                        className={cn('rounded-btn px-2 py-1 text-xs font-bold', term.grades?.includes(grade) ? 'bg-accent text-accent-ink' : 'bg-surface text-slate-500')}
                      >
                        {grade}
                      </button>
                    ))}
                  </div>
                </div>
                <label className="mb-1 block text-xs font-bold text-slate-500">ターム名</label>
                <input value={term.label || ''} onChange={e => updateTerm(index, 'label', e.target.value)} className="mb-3 min-h-10 w-full rounded-input border border-line bg-surface px-3 py-2 text-sm font-bold outline-none focus:ring-2 focus:ring-accent/30" />
                <div className="grid grid-cols-2 gap-2">
                  <Field label="開始週" value={term.start_week || ''} onChange={v => updateTerm(index, 'start_week', v)} />
                  <Field label="終了週" value={term.end_week || ''} onChange={v => updateTerm(index, 'end_week', v)} />
                  <Field label="開始日" type="date" value={term.start_date || ''} onChange={v => updateTerm(index, 'start_date', v)} />
                  <Field label="終了日" type="date" value={term.end_date || ''} onChange={v => updateTerm(index, 'end_date', v)} />
                </div>
                <Field label="登録開始日" type="date" value={term.registration_opens_at || ''} onChange={v => updateTerm(index, 'registration_opens_at', v)} />
                <button
                  type="button"
                  onClick={() => assignSsToTerm(index)}
                  className={cn('mt-3 w-full rounded-btn border px-3 py-2 text-left text-xs font-bold transition', term.includes_ss ? 'border-amber-300 bg-amber-50 text-amber-800' : 'border-line bg-surface text-slate-500 hover:border-amber-200')}
                >
                  <span className="block">{term.includes_ss ? 'SS（夏期講習）を含む' : 'SSをこの期に含める'}</span>
                  <span className="mt-0.5 block text-xs font-bold opacity-70">SSは開始週・終了週の数には加算されません</span>
                </button>
                <p className="mt-2 text-xs font-bold text-slate-500">年間予定連動: {term.linked_lesson_count || 0}件</p>
              </div>
            ))}
          </div>
        </section>

        <section className="rounded-card border border-line bg-surface p-6 shadow-sm">
          <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <p className="text-xs font-bold text-accent">カリキュラム一覧</p>
              <h2 className="mt-1 text-lg font-bold">登録済み単元の確認</h2>
            </div>
            <div className="grid gap-2 sm:grid-cols-5">
              <select value={filterGrade} onChange={e => setFilterGrade(e.target.value)} className="min-h-10 rounded-input border border-line bg-surface px-3 py-2 text-sm font-bold outline-none">{GRADES.map(v => <option key={v}>{v}</option>)}</select>
              <select value={filterSubject} onChange={e => setFilterSubject(e.target.value)} className="min-h-10 rounded-input border border-line bg-surface px-3 py-2 text-sm font-bold outline-none">{SUBJECTS.map(v => <option key={v}>{v}</option>)}</select>
              <select value={sortKey} onChange={e => setSortKey(e.target.value)} className="min-h-10 rounded-input border border-line bg-surface px-3 py-2 text-sm font-bold outline-none">{SORT_OPTIONS.map(v => <option key={v.key} value={v.key}>{v.label}でソート</option>)}</select>
              <Button variant="secondary" onClick={() => setSortDir(prev => prev === 'asc' ? 'desc' : 'asc')} icon={<ArrowDownUp size={15} aria-hidden />}>
                {sortDir === 'asc' ? '昇順' : '降順'}
              </Button>
              <label className="flex min-h-10 items-center gap-2 rounded-input border border-line bg-surface px-3 py-2">
                <Search size={15} className="text-slate-400" aria-hidden />
                <input value={search} onChange={e => setSearch(e.target.value)} placeholder="単元検索" className="w-full bg-transparent text-sm font-bold outline-none" />
              </label>
            </div>
          </div>
          {loading ? (
            <ListSkeleton rows={5} />
          ) : loadError ? (
            <ErrorState message={loadError} onRetry={load} />
          ) : filtered.length === 0 ? (
            <EmptyState title="該当する単元がありません" description={curriculum.length === 0 ? 'この年度のカリキュラムはまだ登録されていません。' : '絞り込み条件を変えてください。'} />
          ) : (
            <div className="overflow-x-auto rounded-card border border-slate-100">
              <table className="w-full min-w-[900px] border-collapse text-sm">
                <thead className="bg-slate-50 text-left text-xs font-bold text-slate-500">
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
                          const term = termOptionsForGrade(item.grade).find(t => t.id === e.target.value);
                          updateEditingRow(item.id, 'term', e.target.value);
                          updateEditingRow(item.id, 'term_label', term?.label || e.target.value);
                        }} className="w-32 rounded-input border border-line bg-surface px-2 py-2 text-xs font-bold outline-none">
                          {termOptionsForGrade(item.grade).map((term, index) => <option key={`${term.id}_${index}`} value={term.id}>{term.label}</option>)}
                        </select>
                      </td>
                      <td className="px-3 py-3"><EditInput value={rowValue(item, 'grade')} onChange={v => updateEditingRow(item.id, 'grade', v)} className="w-20" /></td>
                      <td className="px-3 py-3"><EditInput value={rowValue(item, 'subject')} onChange={v => updateEditingRow(item.id, 'subject', v)} className="w-20" /></td>
                      <td className="px-3 py-3"><EditInput value={rowValue(item, 'course_name')} onChange={v => updateEditingRow(item.id, 'course_name', v)} className="w-32" /></td>
                      <td className="px-3 py-3"><EditInput value={rowValue(item, 'unit')} onChange={v => updateEditingRow(item.id, 'unit', v)} className="w-72" /></td>
                      <td className="px-3 py-3">
                        <div className="flex items-center gap-2">
                          <EditInput value={rowValue(item, 'month_label')} onChange={v => updateEditingRow(item.id, 'month_label', v)} className="w-20" />
                          <Button size="sm" onClick={() => saveCurriculumRow(item)} disabled={!editingRows[item.id] || savingRows[item.id]} loading={savingRows[item.id]}>
                            {savingRows[item.id] ? '保存中' : '保存'}
                          </Button>
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
      <span className="mb-1 block text-xs font-bold text-slate-500">{label}</span>
      <input type={type} value={value} onChange={e => onChange(e.target.value)} className="min-h-10 w-full rounded-input border border-line bg-surface px-3 py-2 text-sm font-bold outline-none focus:ring-2 focus:ring-accent/30" />
    </label>
  );
}

function EditInput({ value, onChange, className = '' }: { value: string | number; onChange: (value: string) => void; className?: string }) {
  return (
    <input
      value={value}
      onChange={e => onChange(e.target.value)}
      className={cn('rounded-input border border-line bg-surface px-2 py-2 text-xs font-bold outline-none focus:ring-2 focus:ring-accent/30', className)}
    />
  );
}
