'use client';

import { useEffect, useMemo, useState } from 'react';
import { auth } from '@/lib/firebase';
import {
  CheckCircle2,
  CameraOff,
  FileUp,
  GraduationCap,
  Loader2,
  LockKeyhole,
  PauseCircle,
  PhoneOff,
  Plus,
  Printer,
  RefreshCw,
  Search,
  UserPlus,
  X,
  XCircle,
} from 'lucide-react';
import { useAuth } from '@/app/context/AuthContext';

const STATUSES = [
  { id: 'active', label: '有効', icon: CheckCircle2, className: 'bg-emerald-50 text-emerald-700 border-emerald-100' },
  { id: 'suspended', label: '一時停止', icon: PauseCircle, className: 'bg-amber-50 text-amber-700 border-amber-100' },
  { id: 'withdrawn', label: '解除', icon: XCircle, className: 'bg-rose-50 text-rose-700 border-rose-100' },
  { id: 'archived', label: '保管', icon: LockKeyhole, className: 'bg-slate-100 text-slate-600 border-slate-200' },
];

const initialForm = {
  display_name: '',
  login_id: '',
  password: 'class1234',
  grade: '中1',
  classroom: '',
  day_of_week: '',
  subject_science: '',
  subject_social: '',
  phone_number: '',
  camera_off_requested: false,
  absence_call_not_required: false,
};

export default function SchoolStudentsPage() {
  const { profile } = useAuth();
  const [students, setStudents] = useState<any[]>([]);
  const [school, setSchool] = useState('');
  const [status, setStatus] = useState('all');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState(initialForm);
  const [printStudent, setPrintStudent] = useState<any | null>(null);
  const [csvEncoding, setCsvEncoding] = useState('Shift_JIS');
  const [csvImporting, setCsvImporting] = useState(false);
  const [csvLog, setCsvLog] = useState<string[]>([]);

  const mySchool = useMemo(() => {
    const ids = Array.isArray(profile?.school_ids) ? profile?.school_ids : [];
    return ids[0] || profile?.school_id || profile?.school || '';
  }, [profile]);

  const filtered = useMemo(() => {
    return students.filter(student => {
      const statusValue = student.account_status || 'active';
      const haystack = `${student.student_name || ''} ${student.grade || ''} ${student.classroom || ''} ${student.lifetime_id || ''}`.toLowerCase();
      if (status !== 'all' && statusValue !== status) return false;
      if (search && !haystack.includes(search.toLowerCase())) return false;
      return true;
    });
  }, [students, status, search]);

  const counts = useMemo(() => {
    return STATUSES.reduce((acc, item) => {
      acc[item.id] = students.filter(student => (student.account_status || 'active') === item.id).length;
      return acc;
    }, {} as Record<string, number>);
  }, [students]);

  const loadStudents = async () => {
    setLoading(true);
    try {
      const token = await auth.currentUser?.getIdToken();
      const res = await fetch('/api/admin/school-students', {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || 'failed');
      setSchool(data.school || mySchool || '');
      setStudents(data.students || []);
    } catch (e: any) {
      alert(`生徒一覧の取得に失敗しました: ${e.message || e}`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (profile) loadStudents();
  }, [profile]);

  const updateStatus = async (target: any, nextStatus: string) => {
    if (!confirm(`${target.student_name || target.id} を「${STATUSES.find(s => s.id === nextStatus)?.label}」に変更しますか？`)) return;
    setSavingId(target.id);
    try {
      const token = await auth.currentUser?.getIdToken();
      const res = await fetch('/api/admin/accounts/status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ user_id: target.id, status: nextStatus }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || 'failed');
      setStudents(prev => prev.map(student => student.id === target.id ? { ...student, account_status: nextStatus } : student));
    } catch (e: any) {
      alert(`状態変更に失敗しました: ${e.message || e}`);
    } finally {
      setSavingId('');
    }
  };

  const createStudent = async () => {
    if (!form.display_name.trim()) return alert('氏名は必須です');
    if (!form.login_id.trim()) return alert('初期IDは必須です');
    if (!school) return alert('校舎が設定されていません。管理者アカウントの school_ids を確認してください。');
    setSaving(true);
    try {
      const token = await auth.currentUser?.getIdToken();
      const res = await fetch('/api/admin/accounts/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          ...form,
          role: 'student',
          school_id: school,
          account_status: 'active',
          auto_create_parent: true,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || 'failed');
      const createdStudent = {
        id: data.uid,
        uid: data.uid,
        student_name: form.display_name,
        lifetime_id: form.login_id,
        initial_password: form.password,
        grade: form.grade,
        classroom: form.classroom,
        day_of_week: form.day_of_week,
        subject_science: form.subject_science,
        subject_social: form.subject_social,
        phone_number: form.phone_number,
        school_id: school,
        camera_off_requested: form.camera_off_requested,
        absence_call_not_required: form.absence_call_not_required,
        account_status: 'active',
        parent_uid: data.parent?.uid || '',
        parent_name: data.parent?.parent_name || `${form.display_name} 保護者`,
        parent_login_id: data.parent?.login_id || `${form.login_id}P`,
        parent_initial_password: data.parent?.initial_password || form.password,
      };
      setModalOpen(false);
      setForm(initialForm);
      await loadStudents();
      setPrintStudent(createdStudent);
      alert(data.updated ? '生徒アカウントを更新しました' : '生徒アカウントを作成しました');
    } catch (e: any) {
      alert(`作成に失敗しました: ${e.message || e}`);
    } finally {
      setSaving(false);
    }
  };

  const updateStudentOptions = async (student: any, key: 'camera_off_requested' | 'absence_call_not_required', value: boolean) => {
    setStudents(prev => prev.map(item => item.id === student.id ? { ...item, [key]: value } : item));
    try {
      const token = await auth.currentUser?.getIdToken();
      const res = await fetch('/api/admin/school-students/options', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          user_id: student.id,
          camera_off_requested: key === 'camera_off_requested' ? value : Boolean(student.camera_off_requested),
          absence_call_not_required: key === 'absence_call_not_required' ? value : Boolean(student.absence_call_not_required),
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || 'failed');
    } catch (e: any) {
      setStudents(prev => prev.map(item => item.id === student.id ? { ...item, [key]: !value } : item));
      alert(`設定変更に失敗しました: ${e.message || e}`);
    }
  };

  const printGuide = (student: any) => {
    setPrintStudent(student);
    window.setTimeout(() => window.print(), 80);
  };

  const addCsvLog = (message: string) => {
    setCsvLog(prev => [`${new Date().toLocaleTimeString()} ${message}`, ...prev].slice(0, 12));
  };

  const handleCsvImport = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!school) {
      alert('校舎が設定されていません。管理者アカウントの school_ids を確認してください。');
      event.target.value = '';
      return;
    }
    if (!confirm(`生徒CSVを「${school}」の生徒として取り込みますか？\n保護者アカウントも自動作成します。`)) {
      event.target.value = '';
      return;
    }
    setCsvImporting(true);
    setCsvLog([]);
    addCsvLog(`読み込み開始: ${file.name} (${csvEncoding})`);
    const reader = new FileReader();
    reader.onload = async e => {
      try {
        const csvText = String(e.target?.result || '');
        const token = await auth.currentUser?.getIdToken();
        const res = await fetch('/api/admin/school-students/import', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ csv_text: csvText, school_id: school, default_password: 'class1234' }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.ok) throw new Error(data.error || 'failed');
        addCsvLog(`完了: ${data.count || 0}件を登録しました`);
        if (Array.isArray(data.errors) && data.errors.length > 0) {
          addCsvLog(`注意: ${data.errors.length}件は登録できませんでした`);
          data.errors.slice(0, 3).forEach((item: any) => addCsvLog(`行${item.row}: ${item.error}`));
        }
        await loadStudents();
        if (Array.isArray(data.students) && data.students.length > 0) {
          setPrintStudent(data.students[0]);
        }
      } catch (e: any) {
        addCsvLog(`エラー: ${e.message || e}`);
        alert(`CSV取り込みに失敗しました: ${e.message || e}`);
      } finally {
        setCsvImporting(false);
        event.target.value = '';
      }
    };
    reader.onerror = () => {
      setCsvImporting(false);
      addCsvLog('ファイル読み込みに失敗しました');
      event.target.value = '';
    };
    reader.readAsText(file, csvEncoding);
  };

  return (
    <>
    <div className="space-y-6 print:hidden">
      <section className="rounded-[28px] bg-slate-950 p-6 text-white shadow-xl">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-center gap-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white text-slate-950">
              <GraduationCap size={24} />
            </div>
            <div>
              <p className="text-xs font-black uppercase tracking-[0.25em] text-slate-400">School Students</p>
              <h1 className="text-2xl font-black">校舎別 生徒管理</h1>
              <div className="mt-2 inline-flex rounded-2xl bg-white/10 px-4 py-2 text-sm font-black text-indigo-100 ring-1 ring-white/10">
                現在ログイン中の校舎: {school || mySchool || '未設定'}
              </div>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <button onClick={loadStudents} className="flex items-center gap-2 rounded-2xl bg-slate-800 px-4 py-3 text-sm font-black hover:bg-slate-700">
              <RefreshCw size={18} /> 更新
            </button>
            <label className="relative flex cursor-pointer items-center gap-2 overflow-hidden rounded-2xl bg-emerald-400 px-4 py-3 text-sm font-black text-slate-950 hover:bg-emerald-300">
              {csvImporting ? <Loader2 className="animate-spin" size={18} /> : <FileUp size={18} />} 生徒CSV追加
              <input type="file" accept=".csv" onChange={handleCsvImport} disabled={csvImporting} className="absolute inset-0 cursor-pointer opacity-0" />
            </label>
            <button onClick={() => setModalOpen(true)} className="flex items-center gap-2 rounded-2xl bg-white px-4 py-3 text-sm font-black text-slate-950 hover:bg-indigo-50">
              <UserPlus size={18} /> 新規生徒登録
            </button>
          </div>
        </div>
      </section>

      <section className="rounded-[28px] bg-white p-5 shadow-sm">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h2 className="text-lg font-black text-slate-900">CSV一括追加</h2>
            <p className="mt-1 text-xs font-bold text-slate-400">`生涯番号`、`氏名`または`氏`・`名`、`学年`、`所属教室`などの列を自動判定します。保護者IDは「生徒ID + P」で作成します。</p>
          </div>
          <div className="flex items-center gap-2 rounded-2xl bg-amber-50 px-4 py-3">
            <span className="text-xs font-black text-slate-500">文字コード</span>
            <select value={csvEncoding} onChange={e => setCsvEncoding(e.target.value)} className="bg-transparent text-sm font-black text-amber-700 outline-none">
              <option value="Shift_JIS">Shift_JIS</option>
              <option value="UTF-8">UTF-8</option>
            </select>
          </div>
        </div>
        <div className="mt-4 rounded-2xl bg-slate-950 p-4 font-mono text-xs text-emerald-300">
          {csvLog.length === 0 ? '> CSV追加の結果がここに表示されます' : csvLog.map((line, index) => <div key={index}>{line}</div>)}
        </div>
        {printStudent && (
          <div className="mt-3 flex justify-end">
            <button onClick={() => window.print()} className="rounded-2xl border border-indigo-100 px-4 py-3 text-xs font-black text-indigo-600 hover:bg-indigo-50">
              <Printer size={14} className="inline" /> 最後に作成した案内所面を印刷
            </button>
          </div>
        )}
      </section>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <button onClick={() => setStatus('all')} className={`rounded-2xl border bg-white p-4 text-left shadow-sm ${status === 'all' ? 'border-indigo-300 ring-2 ring-indigo-100' : 'border-white'}`}>
          <p className="text-xs font-black text-slate-400">全件</p>
          <p className="mt-1 text-3xl font-black text-slate-900">{students.length}</p>
        </button>
        {STATUSES.map(item => {
          const Icon = item.icon;
          return (
            <button key={item.id} onClick={() => setStatus(item.id)} className={`rounded-2xl border p-4 text-left shadow-sm ${item.className} ${status === item.id ? 'ring-2 ring-indigo-100' : ''}`}>
              <Icon className="mb-2" size={20} />
              <p className="text-xs font-black">{item.label}</p>
              <p className="mt-1 text-2xl font-black">{counts[item.id] || 0}</p>
            </button>
          );
        })}
      </section>

      <section className="rounded-[28px] bg-white p-5 shadow-sm">
        <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div className="relative w-full md:max-w-sm">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-300" size={18} />
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="名前・学年・IDで検索" className="w-full rounded-2xl border border-slate-200 bg-slate-50 py-3 pl-11 pr-4 text-sm font-bold outline-none focus:ring-2 focus:ring-indigo-100" />
          </div>
          <p className="text-xs font-black text-slate-400">{filtered.length}件表示</p>
        </div>

        {loading ? (
          <div className="flex justify-center py-12"><Loader2 className="animate-spin text-indigo-500" /></div>
        ) : filtered.length === 0 ? (
          <div className="rounded-2xl border-2 border-dashed border-slate-100 py-12 text-center text-sm font-bold text-slate-400">表示できる生徒がいません</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1120px] text-left text-sm">
              <thead>
                <tr className="border-b border-slate-100 text-xs font-black text-slate-400">
                  <th className="px-4 py-3">生徒</th>
                  <th className="px-4 py-3">初期ID</th>
                  <th className="px-4 py-3">学年</th>
                  <th className="px-4 py-3">曜日</th>
                  <th className="px-4 py-3">科目</th>
                  <th className="px-4 py-3">個別設定</th>
                  <th className="px-4 py-3">状態</th>
                  <th className="px-4 py-3 text-right">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {filtered.map(student => (
                  <tr key={student.id} className="hover:bg-slate-50">
                    <td className="px-4 py-4">
                      <p className="font-black text-slate-800">{student.student_name || '名称未設定'}</p>
                      <p className="text-xs font-bold text-slate-400">{student.school_id || school}</p>
                    </td>
                    <td className="px-4 py-4 font-mono text-xs font-bold text-slate-500">{student.lifetime_id || '-'}</td>
                    <td className="px-4 py-4 font-bold text-slate-600">{student.grade || '-'}</td>
                    <td className="px-4 py-4 font-bold text-slate-600">{student.day_of_week || '-'}</td>
                    <td className="px-4 py-4 text-xs font-bold text-slate-500">
                      理: {student.subject_science || '-'} / 社: {student.subject_social || '-'}
                    </td>
                    <td className="px-4 py-4">
                      <div className="flex flex-col gap-2">
                        <label className="flex items-center gap-2 text-[11px] font-black text-slate-500">
                          <input type="checkbox" checked={Boolean(student.camera_off_requested)} onChange={e => updateStudentOptions(student, 'camera_off_requested', e.target.checked)} className="h-4 w-4 accent-indigo-600" />
                          <CameraOff size={13} /> カメラオフ希望
                        </label>
                        <label className="flex items-center gap-2 text-[11px] font-black text-slate-500">
                          <input type="checkbox" checked={Boolean(student.absence_call_not_required)} onChange={e => updateStudentOptions(student, 'absence_call_not_required', e.target.checked)} className="h-4 w-4 accent-rose-600" />
                          <PhoneOff size={13} /> 欠席電話不要
                        </label>
                      </div>
                    </td>
                    <td className="px-4 py-4">
                      <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-black text-slate-500">{STATUSES.find(s => s.id === student.account_status)?.label || student.account_status}</span>
                    </td>
                    <td className="px-4 py-4">
                      <div className="flex justify-end gap-2">
                        <button onClick={() => printGuide(student)} className="rounded-xl border border-indigo-100 px-3 py-2 text-[11px] font-black text-indigo-600 hover:bg-indigo-50">
                          <Printer size={13} className="inline" /> 案内所面
                        </button>
                        {STATUSES.map(item => (
                          <button key={item.id} disabled={savingId === student.id || student.account_status === item.id} onClick={() => updateStatus(student, item.id)} className="rounded-xl border border-slate-100 px-3 py-2 text-[11px] font-black text-slate-500 hover:bg-slate-50 disabled:opacity-40">
                            {item.label}
                          </button>
                        ))}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
          <div className="w-full max-w-2xl rounded-[28px] bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-100 p-5">
              <h2 className="text-lg font-black text-slate-900">新規生徒登録</h2>
              <button onClick={() => setModalOpen(false)} className="rounded-xl bg-slate-100 p-2 text-slate-400 hover:text-slate-700"><X size={18} /></button>
            </div>
            <div className="grid gap-4 p-5 md:grid-cols-2">
              <Field label="氏名" value={form.display_name} onChange={value => setForm(prev => ({ ...prev, display_name: value }))} />
              <Field label="初期ID" value={form.login_id} onChange={value => setForm(prev => ({ ...prev, login_id: value }))} />
              <Field label="初期パスワード" value={form.password} onChange={value => setForm(prev => ({ ...prev, password: value }))} />
              <Field label="電話番号" value={form.phone_number} onChange={value => setForm(prev => ({ ...prev, phone_number: value }))} />
              <Field label="教室/クラス" value={form.classroom} onChange={value => setForm(prev => ({ ...prev, classroom: value }))} />
              <SelectField label="学年" value={form.grade} options={['中1', '中2', '中3']} onChange={value => setForm(prev => ({ ...prev, grade: value }))} />
              <SelectField label="曜日" value={form.day_of_week} options={['', '月', '火', '水', '木', '金', '土']} onChange={value => setForm(prev => ({ ...prev, day_of_week: value }))} />
              <SelectField label="理科" value={form.subject_science} options={['', '物理', '化学', '生物', '地学']} onChange={value => setForm(prev => ({ ...prev, subject_science: value }))} />
              <SelectField label="社会" value={form.subject_social} options={['', '地理', '歴史', '公民']} onChange={value => setForm(prev => ({ ...prev, subject_social: value }))} />
              <label className="flex items-center gap-3 rounded-2xl bg-slate-50 px-4 py-3 text-sm font-black text-slate-600">
                <input type="checkbox" checked={form.camera_off_requested} onChange={e => setForm(prev => ({ ...prev, camera_off_requested: e.target.checked }))} className="h-5 w-5 accent-indigo-600" />
                カメラオフ希望
              </label>
              <label className="flex items-center gap-3 rounded-2xl bg-slate-50 px-4 py-3 text-sm font-black text-slate-600">
                <input type="checkbox" checked={form.absence_call_not_required} onChange={e => setForm(prev => ({ ...prev, absence_call_not_required: e.target.checked }))} className="h-5 w-5 accent-rose-600" />
                欠席電話不要
              </label>
            </div>
            <div className="flex justify-end gap-3 border-t border-slate-100 bg-slate-50 p-5">
              <button onClick={() => setModalOpen(false)} className="rounded-2xl px-5 py-3 text-sm font-black text-slate-500 hover:bg-slate-200">キャンセル</button>
              <button onClick={createStudent} disabled={saving} className="flex items-center gap-2 rounded-2xl bg-slate-900 px-5 py-3 text-sm font-black text-white hover:bg-slate-800 disabled:opacity-60">
                {saving ? <Loader2 className="animate-spin" size={18} /> : <Plus size={18} />} 登録する
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
    <div className="hidden print:block">
      {printStudent && <GuidePrintSheet student={printStudent} school={school || mySchool} />}
    </div>
    </>
  );
}

function Field({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label>
      <span className="mb-2 block text-xs font-black text-slate-500">{label}</span>
      <input value={value} onChange={e => onChange(e.target.value)} className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-bold outline-none focus:ring-2 focus:ring-indigo-100" />
    </label>
  );
}

function GuidePrintSheet({ student, school }: { student: any; school: string }) {
  return (
    <div className="fixed inset-0 z-[9999] bg-white p-10 text-slate-900 print:static print:block">
      <div className="mx-auto max-w-3xl border-4 border-slate-900 p-8">
        <div className="border-b-2 border-slate-900 pb-4">
          <p className="text-sm font-black tracking-[0.3em]">CLASSBASE ACCOUNT GUIDE</p>
          <h1 className="mt-2 text-3xl font-black">理社講座アプリ ご案内所面</h1>
          <p className="mt-2 text-base font-bold">校舎: {school || '-'}</p>
        </div>
        <div className="mt-8 grid grid-cols-2 gap-6">
          <PrintBox label="氏名" value={student.student_name || '-'} />
          <PrintBox label="学年" value={student.grade || '-'} />
          <PrintBox label="生徒 初期ID" value={student.lifetime_id || '-'} />
          <PrintBox label="生徒 初期パスワード" value={student.initial_password || '-'} />
          <PrintBox label="保護者氏名" value={student.parent_name || `${student.student_name || ''} 保護者`.trim() || '-'} />
          <PrintBox label="保護者 初期ID" value={student.parent_login_id || '-'} />
          <PrintBox label="保護者 初期パスワード" value={student.parent_initial_password || '-'} />
          <PrintBox label="保護者メール" value={student.parent_email || (student.parent_login_id ? `${student.parent_login_id}@classbase.local` : '-')} />
          <PrintBox label="曜日" value={student.day_of_week ? `${student.day_of_week}曜日` : '-'} />
          <PrintBox label="教室/クラス" value={student.classroom || '-'} />
          <PrintBox label="理科" value={student.subject_science || '-'} />
          <PrintBox label="社会" value={student.subject_social || '-'} />
        </div>
        <div className="mt-8 rounded-2xl border-2 border-slate-200 p-5">
          <p className="text-sm font-black">個別連絡事項</p>
          <div className="mt-3 space-y-2 text-sm font-bold">
            <p>カメラオフ希望: {student.camera_off_requested ? 'あり' : 'なし'}</p>
            <p>欠席電話不要: {student.absence_call_not_required ? 'あり' : 'なし'}</p>
          </div>
        </div>
        <p className="mt-8 text-xs font-bold leading-relaxed text-slate-500">
          初回ログイン後、必要に応じてパスワードを変更してください。IDとパスワードは大切に保管してください。
        </p>
      </div>
    </div>
  );
}

function PrintBox({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border-2 border-slate-200 p-4">
      <p className="text-xs font-black text-slate-400">{label}</p>
      <p className="mt-2 text-xl font-black">{value}</p>
    </div>
  );
}

function SelectField({ label, value, options, onChange }: { label: string; value: string; options: string[]; onChange: (value: string) => void }) {
  return (
    <label>
      <span className="mb-2 block text-xs font-black text-slate-500">{label}</span>
      <select value={value} onChange={e => onChange(e.target.value)} className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-bold outline-none focus:ring-2 focus:ring-indigo-100">
        {options.map(option => <option key={option || 'none'} value={option}>{option || '未設定'}</option>)}
      </select>
    </label>
  );
}
