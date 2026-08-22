'use client';

import { useEffect, useMemo, useState } from 'react';
import { auth, db } from '@/lib/firebase';
import { collection, getDocs, query, where } from 'firebase/firestore';
import {
  AlertCircle,
  ArrowLeft,
  Bell,
  Check,
  CheckCircle,
  Filter,
  GraduationCap,
  Loader2,
  Mail,
  Megaphone,
  MessageCircle,
  RefreshCw,
  Search,
  Send,
  ShieldCheck,
  Sparkles,
  Users,
  UserRound,
} from 'lucide-react';
import Link from 'next/link';

type RoleKey = 'student' | 'parent' | 'teacher' | 'admin';
type ChannelKey = 'line' | 'in_app' | 'email';

type AppUser = {
  id: string;
  role: RoleKey;
  rawRole?: string;
  name: string;
  email?: string;
  grade?: string;
  school?: string;
  school_id?: string;
  classroom?: string;
  line_user_id?: string;
  notification_preferences?: Record<string, boolean>;
};

const ROLE_OPTIONS: { key: RoleKey; label: string; icon: React.ReactNode; color: string }[] = [
  { key: 'student', label: '生徒', icon: <GraduationCap size={16} />, color: 'bg-blue-50 text-blue-700 border-blue-100' },
  { key: 'parent', label: '保護者', icon: <UserRound size={16} />, color: 'bg-purple-50 text-purple-700 border-purple-100' },
  { key: 'teacher', label: '講師', icon: <Users size={16} />, color: 'bg-emerald-50 text-emerald-700 border-emerald-100' },
  { key: 'admin', label: '校舎管理者', icon: <ShieldCheck size={16} />, color: 'bg-slate-100 text-slate-700 border-slate-200' },
];

const CHANNEL_OPTIONS: { key: ChannelKey; label: string; icon: React.ReactNode; description: string }[] = [
  { key: 'line', label: 'LINE', icon: <MessageCircle size={16} />, description: '連携済みユーザーへ即時送信します' },
  { key: 'in_app', label: 'アプリ内', icon: <Bell size={16} />, description: 'お知らせと通知ジョブを作成します' },
  { key: 'email', label: 'メール', icon: <Mail size={16} />, description: 'メール送信用の通知ジョブを作成します' },
];

const KIND_OPTIONS = [
  { key: 'announcements', label: 'お知らせ' },
  { key: 'class_start', label: '授業開始' },
  { key: 'homework', label: '宿題' },
  { key: 'registration', label: '登録依頼' },
  { key: 'shift', label: 'シフト・勤怠' },
  { key: 'substitution', label: '代行依頼' },
];

const TEMPLATES = [
  {
    title: '授業開始のお知らせ',
    body: '本日の授業開始時間が近づいています。\nマイページからZoom参加ボタンを確認してください。',
    kind: 'class_start',
    roles: ['student', 'parent'] as RoleKey[],
  },
  {
    title: '講座登録のお願い',
    body: '次期講座の登録受付を開始しました。\n保護者マイページから受講講座の登録をお願いいたします。',
    kind: 'registration',
    roles: ['parent'] as RoleKey[],
  },
  {
    title: '宿題提出の確認',
    body: '宿題の提出期限が近づいています。\nマイページから提出状況をご確認ください。',
    kind: 'homework',
    roles: ['student', 'parent'] as RoleKey[],
  },
  {
    title: 'シフト提出のお願い',
    body: '次回の勤務希望提出期限が近づいています。\n講師マイページから提出をお願いいたします。',
    kind: 'shift',
    roles: ['teacher'] as RoleKey[],
  },
];

function normalizeRole(role: unknown): RoleKey {
  const value = String(role || '').toLowerCase();
  if (value === 'parent' || value === 'guardian') return 'parent';
  if (value === 'teacher') return 'teacher';
  if (value.includes('admin') || value === 'master') return 'admin';
  return 'student';
}

function userName(data: any) {
  return data.name || data.display_name || data.student_name || data.parent_name || data.teacher_name || data.email || '名称未設定';
}

function schoolOf(user: AppUser) {
  return user.school || user.school_id || user.classroom || '';
}

function roleLabel(role: RoleKey) {
  return ROLE_OPTIONS.find(item => item.key === role)?.label || role;
}

export default function MasterLineBroadcastPage() {
  const [users, setUsers] = useState<AppUser[]>([]);
  const [shifts, setShifts] = useState<any[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [selectedRoles, setSelectedRoles] = useState<RoleKey[]>(['teacher']);
  const [selectedChannels, setSelectedChannels] = useState<ChannelKey[]>(['line']);
  const [school, setSchool] = useState('all');
  const [grade, setGrade] = useState('all');
  const [lineOnly, setLineOnly] = useState(false);
  const [search, setSearch] = useState('');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [kind, setKind] = useState('announcements');
  const [includeName, setIncludeName] = useState(true);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState('');

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    setLoading(true);
    try {
      const userSnap = await getDocs(collection(db, 'users'));
      const loaded = userSnap.docs.map(d => {
        const data = d.data() as any;
        return {
          id: d.id,
          role: normalizeRole(data.role),
          rawRole: data.role,
          name: userName(data),
          email: data.email,
          grade: data.grade || data.student_grade,
          school: data.school,
          school_id: data.school_id,
          classroom: data.classroom,
          line_user_id: data.line_user_id,
          notification_preferences: data.notification_preferences,
        } satisfies AppUser;
      });
      setUsers(loaded);

      const today = new Date().toISOString().split('T')[0];
      const sQ = query(collection(db, 'shift_assignments'), where('target_date', '==', today));
      const sSnap = await getDocs(sQ);
      setShifts(sSnap.docs.map(d => ({ id: d.id, ...d.data() })));
    } catch (error) {
      console.error(error);
      alert('ユーザー情報の取得に失敗しました。');
    } finally {
      setLoading(false);
    }
  };

  const schools = useMemo(() => {
    const values = users.map(schoolOf).filter(Boolean);
    return Array.from(new Set(values)).sort();
  }, [users]);

  const grades = useMemo(() => {
    const values = users.map(u => u.grade).filter(Boolean) as string[];
    return Array.from(new Set(values)).sort();
  }, [users]);

  const filteredUsers = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    return users.filter(user => {
      if (!selectedRoles.includes(user.role)) return false;
      if (school !== 'all' && schoolOf(user) !== school) return false;
      if (grade !== 'all' && user.grade !== grade) return false;
      if (lineOnly && !user.line_user_id) return false;
      if (!keyword) return true;
      return [user.name, user.email, user.grade, schoolOf(user), user.rawRole]
        .filter(Boolean)
        .some(value => String(value).toLowerCase().includes(keyword));
    });
  }, [users, selectedRoles, school, grade, lineOnly, search]);

  const selectedUsers = useMemo(() => {
    const selected = new Set(selectedIds);
    return users.filter(user => selected.has(user.id));
  }, [selectedIds, users]);

  const lineTargets = selectedUsers.filter(user => user.line_user_id && user.notification_preferences?.line !== false);

  const stats = useMemo(() => {
    return ROLE_OPTIONS.map(role => {
      const roleUsers = users.filter(user => user.role === role.key);
      return {
        ...role,
        total: roleUsers.length,
        line: roleUsers.filter(user => user.line_user_id).length,
      };
    });
  }, [users]);

  const toggleRole = (role: RoleKey) => {
    setSelectedRoles(prev => {
      const next = prev.includes(role) ? prev.filter(item => item !== role) : [...prev, role];
      return next.length ? next : prev;
    });
  };

  const toggleChannel = (channel: ChannelKey) => {
    setSelectedChannels(prev => {
      const next = prev.includes(channel) ? prev.filter(item => item !== channel) : [...prev, channel];
      return next.length ? next : prev;
    });
  };

  const toggleUser = (id: string) => {
    setSelectedIds(prev => prev.includes(id) ? prev.filter(item => item !== id) : [...prev, id]);
  };

  const selectFiltered = () => {
    const ids = filteredUsers.map(user => user.id);
    setSelectedIds(prev => Array.from(new Set([...prev, ...ids])));
  };

  const clearFiltered = () => {
    const ids = new Set(filteredUsers.map(user => user.id));
    setSelectedIds(prev => prev.filter(id => !ids.has(id)));
  };

  const applyTemplate = (template: typeof TEMPLATES[number]) => {
    setTitle(template.title);
    setBody(template.body);
    setKind(template.kind);
    setSelectedRoles(template.roles);
    setSelectedIds([]);
  };

  const buildText = (user: AppUser) => {
    const prefix = includeName ? `${user.name}様\n\n` : '';
    return `${prefix}${title ? `【${title}】\n` : ''}${body}`.trim();
  };

  const sendCampaign = async (channels: ChannelKey[]) => {
    const token = await auth.currentUser?.getIdToken();
    const res = await fetch('/api/admin/notifications', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        title,
        message: body,
        kind,
        channels,
        selected_user_ids: selectedIds,
        selected_roles: selectedRoles,
        school: school === 'all' ? '' : school,
        grade: grade === 'all' ? '' : grade,
        include_name: includeName,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) throw new Error(data.error || '通知作成に失敗しました。');
    return data;
  };

  const handleCreateOnly = async () => {
    if (!title.trim() || !body.trim()) return alert('タイトルと本文を入力してください。');
    if (selectedUsers.length === 0) return alert('送信対象を選択してください。');
    const channels = selectedChannels.filter(channel => channel !== 'line');
    if (channels.length === 0) return alert('LINEだけが選択されています。「作成して送信」を使うか、アプリ内・メールを選択してください。');
    if (!confirm(`${selectedUsers.length}名を対象に通知ジョブを作成しますか？`)) return;

    setSending(true);
    setResult('');
    try {
      const data = await sendCampaign(channels);
      setResult(`通知を作成しました。アプリ内: ${data.in_app_count || 0}件 / メールジョブ: ${data.email_job_count || 0}件`);
    } catch (error: any) {
      alert(error.message || '通知作成に失敗しました。');
    } finally {
      setSending(false);
    }
  };

  const handleSend = async () => {
    if (!title.trim() || !body.trim()) return alert('タイトルと本文を入力してください。');
    if (selectedUsers.length === 0) return alert('送信対象を選択してください。');
    if (!confirm(`${selectedUsers.length}名を対象に通知を作成します。LINEは${lineTargets.length}名へ即時送信します。よろしいですか？`)) return;

    setSending(true);
    setResult('');
    try {
      const data = await sendCampaign(selectedChannels);
      setResult(`通知を作成しました。アプリ内: ${data.in_app_count || 0}件 / LINE: ${data.line_sent_count || 0}名 / メールジョブ: ${data.email_job_count || 0}件`);
    } catch (error: any) {
      alert(error.message || '送信に失敗しました。');
    } finally {
      setSending(false);
    }
  };

  const handleTodayTeacherReminder = () => {
    const teacherIds = new Set(shifts.map(shift => shift.user_id).filter(Boolean));
    setSelectedRoles(['teacher']);
    setSelectedIds(users.filter(user => user.role === 'teacher' && teacherIds.has(user.id)).map(user => user.id));
    setSelectedChannels(['line']);
    setKind('class_start');
    setTitle('本日の授業リマインド');
    setBody('本日の授業予定をお知らせします。\n講師マイページから担当内容をご確認ください。\n本日もよろしくお願いいたします。');
  };

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50">
        <Loader2 className="animate-spin text-[#06C755]" size={36} />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 p-4 pb-32 font-sans text-slate-800 sm:p-6">
      <div className="mx-auto max-w-7xl space-y-6">
        <div className="flex flex-col gap-4 rounded-3xl border border-slate-200 bg-white p-5 shadow-sm lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-center gap-4">
            <Link href="/master" className="rounded-full bg-slate-100 p-2.5 text-slate-600 transition-colors hover:bg-slate-200">
              <ArrowLeft size={20} />
            </Link>
            <div>
              <h1 className="flex items-center gap-2 text-2xl font-black text-slate-900">
                <MessageCircle className="text-[#06C755]" /> LINE・通知作成
              </h1>
              <p className="mt-1 text-xs font-bold text-slate-400">対象を選び、LINE・アプリ内・メール用通知を作成できます。</p>
            </div>
          </div>
          <button onClick={fetchData} className="flex items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-xs font-black text-slate-600 hover:bg-slate-50">
            <RefreshCw size={15} /> 最新の対象を再取得
          </button>
        </div>

        <div className="grid gap-3 md:grid-cols-4">
          {stats.map(item => (
            <div key={item.key} className={`rounded-2xl border p-4 ${item.color}`}>
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-2 text-sm font-black">{item.icon}{item.label}</span>
                <span className="text-2xl font-black">{item.total}</span>
              </div>
              <p className="mt-2 text-xs font-bold opacity-75">LINE連携済み {item.line}名</p>
            </div>
          ))}
        </div>

        <div className="grid gap-6 xl:grid-cols-12">
          <section className="space-y-4 xl:col-span-5">
            <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="mb-4 flex items-center justify-between">
                <h2 className="flex items-center gap-2 text-lg font-black"><Filter size={18} className="text-slate-500" /> 送信対象</h2>
                <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-black text-slate-600">選択 {selectedUsers.length}名</span>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="mb-2 block text-xs font-black text-slate-400">アカウント種別</label>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                    {ROLE_OPTIONS.map(role => (
                      <button
                        key={role.key}
                        onClick={() => toggleRole(role.key)}
                        className={`flex items-center justify-center gap-1.5 rounded-2xl border px-3 py-3 text-xs font-black transition-all ${
                          selectedRoles.includes(role.key) ? role.color : 'border-slate-100 bg-slate-50 text-slate-400'
                        }`}
                      >
                        {role.icon}{role.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <select value={school} onChange={e => setSchool(e.target.value)} className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-bold outline-none">
                    <option value="all">校舎: 全て</option>
                    {schools.map(value => <option key={value} value={value}>{value}</option>)}
                  </select>
                  <select value={grade} onChange={e => setGrade(e.target.value)} className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-bold outline-none">
                    <option value="all">学年: 全て</option>
                    {grades.map(value => <option key={value} value={value}>{value}</option>)}
                  </select>
                </div>

                <div className="relative">
                  <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-300" size={18} />
                  <input value={search} onChange={e => setSearch(e.target.value)} placeholder="氏名・メール・校舎で検索" className="w-full rounded-2xl border border-slate-200 bg-slate-50 py-3 pl-11 pr-4 text-sm font-bold outline-none focus:ring-2 focus:ring-green-100" />
                </div>

                <label className="flex items-center justify-between rounded-2xl bg-slate-50 px-4 py-3">
                  <span className="text-sm font-black text-slate-600">LINE連携済みだけ表示</span>
                  <input type="checkbox" checked={lineOnly} onChange={e => setLineOnly(e.target.checked)} className="h-5 w-5 accent-[#06C755]" />
                </label>

                <div className="flex gap-2">
                  <button onClick={selectFiltered} className="flex-1 rounded-2xl bg-slate-900 py-3 text-xs font-black text-white">表示中を全選択</button>
                  <button onClick={clearFiltered} className="flex-1 rounded-2xl border border-slate-200 bg-white py-3 text-xs font-black text-slate-500">表示中を解除</button>
                </div>
              </div>
            </div>

            <div className="max-h-[560px] overflow-y-auto rounded-3xl border border-slate-200 bg-white p-3 shadow-sm">
              {filteredUsers.length === 0 ? (
                <div className="py-16 text-center text-sm font-bold text-slate-400">対象が見つかりません</div>
              ) : (
                <div className="space-y-2">
                  {filteredUsers.map(user => {
                    const selected = selectedIds.includes(user.id);
                    return (
                      <button
                        key={user.id}
                        onClick={() => toggleUser(user.id)}
                        className={`w-full rounded-2xl border p-3 text-left transition-all ${selected ? 'border-[#06C755] bg-green-50' : 'border-slate-100 bg-white hover:bg-slate-50'}`}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="truncate text-sm font-black text-slate-800">{user.name}</span>
                              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-black text-slate-500">{roleLabel(user.role)}</span>
                              {user.line_user_id && <span className="rounded-full bg-[#06C755]/10 px-2 py-0.5 text-[10px] font-black text-[#06C755]">LINE</span>}
                            </div>
                            <p className="mt-1 truncate text-xs font-bold text-slate-400">{[schoolOf(user), user.grade, user.email].filter(Boolean).join(' / ') || '詳細なし'}</p>
                          </div>
                          <span className={`mt-1 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border ${selected ? 'border-[#06C755] bg-[#06C755] text-white' : 'border-slate-200 text-transparent'}`}>
                            <Check size={14} strokeWidth={4} />
                          </span>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </section>

          <section className="space-y-4 xl:col-span-7">
            <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <h2 className="flex items-center gap-2 text-lg font-black"><Megaphone size={18} className="text-[#06C755]" /> 通知作成</h2>
                {result && <span className="rounded-full bg-green-50 px-3 py-1 text-xs font-black text-green-700"><CheckCircle size={13} className="mr-1 inline" />{result}</span>}
              </div>

              <div className="mb-5 grid gap-2 md:grid-cols-4">
                {TEMPLATES.map(template => (
                  <button key={template.title} onClick={() => applyTemplate(template)} className="rounded-2xl border border-slate-100 bg-slate-50 p-3 text-left hover:border-green-200 hover:bg-green-50">
                    <Sparkles size={15} className="mb-2 text-[#06C755]" />
                    <p className="text-xs font-black text-slate-700">{template.title}</p>
                  </button>
                ))}
              </div>

              <div className="grid gap-4">
                <div>
                  <label className="mb-2 block text-xs font-black text-slate-400">通知チャネル</label>
                  <div className="grid gap-2 md:grid-cols-3">
                    {CHANNEL_OPTIONS.map(channel => (
                      <button
                        key={channel.key}
                        onClick={() => toggleChannel(channel.key)}
                        className={`rounded-2xl border p-4 text-left transition-all ${selectedChannels.includes(channel.key) ? 'border-[#06C755] bg-green-50 text-green-800' : 'border-slate-100 bg-slate-50 text-slate-500'}`}
                      >
                        <span className="flex items-center gap-2 text-sm font-black">{channel.icon}{channel.label}</span>
                        <span className="mt-1 block text-[11px] font-bold leading-relaxed opacity-70">{channel.description}</span>
                      </button>
                    ))}
                  </div>
                </div>

                <div className="grid gap-3 md:grid-cols-2">
                  <input value={title} onChange={e => setTitle(e.target.value)} placeholder="タイトル" className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-black outline-none focus:ring-2 focus:ring-green-100" />
                  <select value={kind} onChange={e => setKind(e.target.value)} className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-black outline-none">
                    {KIND_OPTIONS.map(item => <option key={item.key} value={item.key}>{item.label}</option>)}
                  </select>
                </div>

                <textarea value={body} onChange={e => setBody(e.target.value)} placeholder="本文を入力してください" className="min-h-56 resize-y rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm font-bold leading-relaxed outline-none focus:ring-2 focus:ring-green-100" />

                <label className="flex items-center justify-between rounded-2xl bg-slate-50 px-4 py-3">
                  <span className="text-sm font-black text-slate-600">LINE本文の先頭に宛名を入れる</span>
                  <input type="checkbox" checked={includeName} onChange={e => setIncludeName(e.target.checked)} className="h-5 w-5 accent-[#06C755]" />
                </label>
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-3">
              <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm md:col-span-1">
                <h3 className="text-sm font-black text-slate-700">送信サマリー</h3>
                <div className="mt-4 space-y-3 text-sm font-bold text-slate-500">
                  <p className="flex justify-between"><span>選択対象</span><span className="font-black text-slate-900">{selectedUsers.length}名</span></p>
                  <p className="flex justify-between"><span>LINE即時送信</span><span className="font-black text-[#06C755]">{lineTargets.length}名</span></p>
                  <p className="flex justify-between"><span>表示中</span><span>{filteredUsers.length}名</span></p>
                </div>
                <button onClick={handleTodayTeacherReminder} className="mt-5 w-full rounded-2xl bg-indigo-50 px-4 py-3 text-xs font-black text-indigo-700 hover:bg-indigo-100">
                  本日の講師リマインドを作成
                </button>
              </div>

              <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm md:col-span-2">
                <h3 className="text-sm font-black text-slate-700">プレビュー</h3>
                <div className="mt-3 min-h-40 rounded-2xl bg-slate-900 p-4 text-sm font-bold leading-relaxed text-white">
                  {selectedUsers[0] ? buildText(selectedUsers[0]) : '対象を選ぶと、ここにLINE本文のプレビューが表示されます。'}
                </div>
                <div className="mt-4 flex flex-col gap-3 sm:flex-row">
                  <button onClick={handleCreateOnly} disabled={sending} className="flex flex-1 items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white py-4 text-sm font-black text-slate-700 hover:bg-slate-50 disabled:opacity-50">
                    {sending ? <Loader2 className="animate-spin" size={18} /> : <Bell size={18} />} 通知だけ作成
                  </button>
                  <button onClick={handleSend} disabled={sending} className="flex flex-1 items-center justify-center gap-2 rounded-2xl bg-[#06C755] py-4 text-sm font-black text-white shadow-lg shadow-green-100 hover:bg-[#05b34c] disabled:opacity-50">
                    {sending ? <Loader2 className="animate-spin" size={18} /> : <Send size={18} />} 作成して送信
                  </button>
                </div>
                {selectedChannels.includes('line') && lineTargets.length < selectedUsers.length && (
                  <p className="mt-3 flex items-center gap-2 rounded-2xl bg-amber-50 px-4 py-3 text-xs font-bold text-amber-700">
                    <AlertCircle size={15} /> LINE未連携またはLINE通知OFFの対象はLINE送信されません。
                  </p>
                )}
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
