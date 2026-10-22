'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CalendarDays, ChevronDown, ChevronUp, FileUp, Pencil, Plus, Save, Trash2, X } from 'lucide-react';
import { Button, EmptyState, ErrorState, IconButton, ListSkeleton, buttonClass, useConfirm, useToast } from '@/app/components/ui';
import { formatDate } from '@/lib/format';
import { useAuth } from '@/app/context/AuthContext';
import { normalizeGrade } from '@/lib/test-prep-registration';

type Item = { id?: string; date: string; subject: string; unit: string; grade: string; time: string; lesson: string; level: string };
type Period = { id: string; name: string; start_date: string; end_date: string; subjects: string[]; items: Item[]; status: string };
const emptyItem = (): Item => ({ date: '', subject: '理科', unit: '', grade: '全学年', time: '', lesson: '1時間目', level: '通常' });
const GRADE_OPTIONS = ['全学年', '中1', '中2', '中3'];
// 学年は選択肢にそろえる（「中２」「2年」なども中2として扱う）。
const toGradeOption = (value: string) => {
  const text = String(value || '').trim();
  if (!text || text === '全学年') return '全学年';
  const grade = normalizeGrade(text);
  return GRADE_OPTIONS.includes(grade) ? grade : text;
};
const itemKey = (item: Item) => [item.date, item.subject, item.unit.trim(), toGradeOption(item.grade), item.lesson.trim()].join('|');
/** 編集中にCSVを取り込み直したときは、日付・科目・単元・学年・時間目が同じ行のIDを引き継ぐ（生徒の選択を保つため）。 */
const keepExistingIds = (imported: Item[], current: Item[]) => {
  const available = new Map<string, string[]>();
  current.forEach(item => {
    if (!item.id) return;
    const key = itemKey(item);
    available.set(key, [...(available.get(key) || []), item.id]);
  });
  return imported.map(item => {
    const ids = available.get(itemKey(item));
    const id = ids?.shift();
    return id ? { ...item, id } : item;
  });
};

function parseCsv(text: string): Item[] {
  const rows = text.replace(/^\uFEFF/, '').split(/\r?\n/).filter(Boolean).map(line => line.split(',').map(cell => cell.trim().replace(/^"|"$/g, '')));
  if (!rows.length) return [];
  const header = rows[0];
  const find = (...names: string[]) => header.findIndex(value => names.includes(value));
  const indexes = { date: find('日付', 'date'), subject: find('科目', 'subject'), unit: find('単元', 'unit'), grade: find('学年', 'grade'), time: find('時間', '時間帯', 'time'), lesson: find('時間目', 'lesson'), level: find('区分', 'コース', 'level') };
  if (indexes.date < 0 || indexes.subject < 0 || indexes.unit < 0) throw new Error('CSVには「日付・科目・単元」の列が必要です。');
  return rows.slice(1).map(row => ({ date: row[indexes.date] || '', subject: row[indexes.subject] || '', unit: row[indexes.unit] || '', grade: indexes.grade >= 0 ? toGradeOption(row[indexes.grade] || '全学年') : '全学年', time: indexes.time >= 0 ? row[indexes.time] || '' : '', lesson: indexes.lesson >= 0 ? row[indexes.lesson] || '' : '', level: indexes.level >= 0 ? row[indexes.level] || '通常' : '通常' })).filter(item => item.date || item.unit);
}

export default function ReviewPeriodsPanel() {
  const { user } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  const [periods, setPeriods] = useState<Period[]>([]);
  const [form, setForm] = useState({ id: '', name: '', start_date: '', end_date: '', items: [emptyItem()] as Item[] });
  const [busy, setBusy] = useState(false);
  const [expanded, setExpanded] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const formRef = useRef<HTMLElement>(null);
  const token = useCallback(() => user?.getIdToken(), [user]);
  const load = useCallback(async () => {
    if (!user) return;
    setLoadError(false);
    try {
      const res = await fetch('/api/review-periods', { headers: { Authorization: `Bearer ${await token()}` } });
      const data = await res.json();
      if (res.ok) setPeriods(data.periods || []);
      else setLoadError(true);
    } catch (error) {
      console.error(error);
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, [token, user]);
  useEffect(() => { void load(); }, [load]);
  const groupedCount = useMemo(() => new Set(form.items.map(item => item.date).filter(Boolean)).size, [form.items]);
  const save = async () => {
    if (!user || busy) return; setBusy(true);
    try { const res = await fetch('/api/review-periods', { method: 'POST', headers: { Authorization: `Bearer ${await token()}`, 'Content-Type': 'application/json' }, body: JSON.stringify(form) }); const data = await res.json(); if (!res.ok) throw new Error(data.error); setForm({ id: '', name: '', start_date: '', end_date: '', items: [emptyItem()] }); await load(); toast.success(form.id ? '復習期間を更新しました。' : '復習期間を保存しました。'); } catch (error) { console.error(error); toast.error(error instanceof Error ? error.message : '保存に失敗しました。'); } finally { setBusy(false); }
  };
  const archive = async (period: Period) => {
    if (!(await confirm({ title: `「${period.name}」を終了しますか？`, message: '終了した期間は生徒の画面に表示されなくなります。', confirmLabel: '終了する', tone: 'danger' }))) return;
    try { const res = await fetch('/api/review-periods', { method: 'POST', headers: { Authorization: `Bearer ${await token()}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'archive', id: period.id }) }); const data = await res.json(); if (!res.ok) throw new Error(data.error); await load(); } catch (error) { console.error(error); toast.error(error instanceof Error ? error.message : '復習期間を終了できませんでした。'); }
  };
  const importCsv = async (file?: File) => { if (!file) return; try { const items = parseCsv(await file.text()); setForm(current => ({ ...current, items: current.id ? keepExistingIds(items, current.items) : items })); } catch (error) { toast.error(error instanceof Error ? error.message : 'CSVを読み込めませんでした。'); } };
  const editPeriod = (period: Period) => {
    setForm({ id: period.id, name: period.name, start_date: period.start_date, end_date: period.end_date, items: period.items.map(item => ({ ...item, grade: toGradeOption(item.grade) })) });
    window.setTimeout(() => formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 0);
  };
  const cancelEdit = () => setForm({ id: '', name: '', start_date: '', end_date: '', items: [emptyItem()] });
  const updateItem = (index: number, patch: Partial<Item>) => setForm(current => ({ ...current, items: current.items.map((v, i) => i === index ? { ...v, ...patch } : v) }));
  const fieldClass = 'min-h-10 rounded-input border border-line bg-surface px-2 py-2 text-sm';
  const labelInputClass = 'mt-1 min-h-11 w-full rounded-input border border-line bg-surface p-3 text-sm font-medium text-fg';

  return <div className="space-y-6 pb-16">
    <p className="rounded-btn bg-emerald-50 px-4 py-3 text-xs font-medium text-emerald-900">テスト対策（復習期間）の期間と、日ごとの実施単元を登録します。生徒の「テスト期間一覧」には、ここで登録した期間に入る対策講座だけが表示されます。</p>
    <section ref={formRef} className="scroll-mt-4 rounded-card border border-line bg-surface p-5 shadow-card">
      {form.id && <div className="mb-4 flex items-center justify-between gap-2 rounded-btn bg-amber-50 p-3 text-sm font-bold text-amber-800"><span>「{form.name}」を編集中です</span><Button variant="secondary" size="sm" onClick={cancelEdit} icon={<X size={15} aria-hidden />}>編集をやめる</Button></div>}
      <div className="grid gap-3 md:grid-cols-3">
        <label className="text-xs font-bold text-slate-500">期間名<input className={labelInputClass} value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="例：秋期復習講座" /></label>
        <label className="text-xs font-bold text-slate-500">開始日<input type="date" className={labelInputClass} value={form.start_date} onChange={e => setForm({ ...form, start_date: e.target.value })} /></label>
        <label className="text-xs font-bold text-slate-500">終了日<input type="date" className={labelInputClass} value={form.end_date} onChange={e => setForm({ ...form, end_date: e.target.value })} /></label>
      </div>
      <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
        <div><h2 className="font-bold text-slate-800">実施日・科目・単元</h2><p className="text-xs font-medium text-slate-400">{form.items.length}講座・{groupedCount}日分</p></div>
        <div className="flex gap-2">
          <label className={buttonClass('secondary', 'md', 'cursor-pointer')}><FileUp size={16} aria-hidden />CSV取込<input type="file" accept=".csv,text/csv" className="hidden" onChange={e => { void importCsv(e.target.files?.[0]); e.target.value = ''; }} /></label>
          <Button variant="secondary" onClick={() => setForm(current => ({ ...current, items: [...current.items, emptyItem()] }))} icon={<Plus size={16} aria-hidden />}>行追加</Button>
        </div>
      </div>
      <p className="mt-2 rounded-btn bg-sky-50 p-3 text-xs font-medium text-sky-800">CSV列：日付, 科目, 単元（必須）／学年, 時間目, 区分, 時間（任意）。日付は YYYY-MM-DD、科目は「理科」または「社会」です。</p>
      <div className="mt-3 space-y-2">{form.items.map((item, index) => <div key={index} className="grid gap-2 rounded-btn bg-slate-50 p-3 md:grid-cols-[140px_86px_1fr_82px_92px_92px_120px_36px]">
        <input type="date" aria-label="日付" className={fieldClass} value={item.date} onChange={e => updateItem(index, { date: e.target.value })} />
        <select aria-label="科目" className={`${fieldClass} font-bold`} value={item.subject} onChange={e => updateItem(index, { subject: e.target.value })}><option>理科</option><option>社会</option></select>
        <input aria-label="単元" className={fieldClass} value={item.unit} placeholder="単元名" onChange={e => updateItem(index, { unit: e.target.value })} />
        <select aria-label="学年" className={`${fieldClass} font-bold`} value={item.grade} onChange={e => updateItem(index, { grade: e.target.value })}>{(GRADE_OPTIONS.includes(item.grade) ? GRADE_OPTIONS : [...GRADE_OPTIONS, item.grade]).map(grade => <option key={grade} value={grade}>{grade}</option>)}</select>
        <input aria-label="時間目" className={fieldClass} value={item.lesson} placeholder="1時間目" onChange={e => updateItem(index, { lesson: e.target.value })} />
        <input aria-label="区分" className={fieldClass} value={item.level} placeholder="通常/標準" onChange={e => updateItem(index, { level: e.target.value })} />
        <input aria-label="時間" className={fieldClass} value={item.time} placeholder="16:50〜18:00" onChange={e => updateItem(index, { time: e.target.value })} />
        <IconButton size="sm" label="行を削除" onClick={() => setForm(current => ({ ...current, items: current.items.filter((_, i) => i !== index) }))} className="hover:text-rose-500"><Trash2 size={18} aria-hidden /></IconButton>
      </div>)}</div>
      <Button fullWidth className="mt-5" loading={busy} onClick={save} icon={<Save size={18} aria-hidden />}>{busy ? '保存中…' : form.id ? '変更を保存' : '復習期間を保存'}</Button>
    </section>
    <section>
      <h2 className="mb-3 text-lg font-bold text-slate-800">登録済みのテスト対策期間（復習期間）</h2>
      {loading ? <ListSkeleton rows={3} /> : loadError ? <ErrorState onRetry={() => void load()} /> : periods.length === 0 ? <EmptyState icon={CalendarDays} title="登録済みの期間はまだありません" description="上のフォームから復習期間を保存すると、ここに表示されます。" /> : <div className="grid gap-3">{periods.map(period => {
        const isExpanded = expanded === period.id;
        return <article key={period.id} className={`rounded-card border bg-surface p-5 shadow-card ${period.status === 'archived' ? 'border-line opacity-60' : 'border-emerald-100'}`}>
          <div className="flex flex-wrap justify-between gap-3">
            <div><h3 className="font-bold text-slate-900">{period.name}</h3><p className="mt-1 text-sm font-medium text-slate-500">{formatDate(period.start_date, { withYear: true }) || period.start_date} 〜 {formatDate(period.end_date, { withYear: true }) || period.end_date}</p></div>
            <div className="flex items-center gap-2">{period.status !== 'archived' && <>
              <Button variant="secondary" size="sm" onClick={() => editPeriod(period)} icon={<Pencil size={14} aria-hidden />}>編集</Button>
              <Button variant="ghost" size="sm" onClick={() => void archive(period)} className="text-rose-600 hover:bg-rose-50 hover:text-rose-700">終了</Button>
            </>}</div>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">{period.subjects.map(subject => <span key={subject} className={`rounded-full px-3 py-1 text-xs font-bold ${subject === '理科' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>{subject}</span>)}<span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-bold text-slate-600">{period.items.length}講座</span></div>
          <button type="button" aria-expanded={isExpanded} onClick={() => setExpanded(isExpanded ? '' : period.id)} className="mt-3 flex min-h-10 w-full items-center justify-center gap-1 rounded-btn border border-line text-xs font-bold text-slate-600 hover:bg-slate-50">{isExpanded ? <><ChevronUp size={15} aria-hidden />内容を閉じる</> : <><ChevronDown size={15} aria-hidden />内容を確認</>}</button>
          {isExpanded && <div className="mt-3 max-h-96 overflow-auto rounded-btn border border-line"><table className="w-full min-w-[700px] text-left text-xs"><thead className="sticky top-0 bg-slate-100 text-slate-600"><tr><th className="p-2">日付</th><th className="p-2">学年</th><th className="p-2">科目</th><th className="p-2">時限</th><th className="p-2">区分</th><th className="p-2">単元</th></tr></thead><tbody>{period.items.map((item, index) => <tr key={item.id || `${item.date}-${index}`} className="border-t border-slate-100"><td className="p-2 font-bold">{formatDate(item.date) || item.date}</td><td className="p-2">{item.grade}</td><td className="p-2">{item.subject}</td><td className="p-2">{item.lesson || '—'}</td><td className="p-2">{item.level || '通常'}</td><td className="p-2 font-bold text-slate-800">{item.unit}</td></tr>)}</tbody></table></div>}
        </article>;
      })}</div>}
    </section>
  </div>;
}
