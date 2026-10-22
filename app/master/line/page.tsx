'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { auth } from '@/lib/firebase';
import {
  AlertCircle,
  Bell,
  Check,
  CheckCircle,
  Filter,
  GraduationCap,
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
import AdminPageHeader from '@/app/components/master/AdminPageHeader';
import { Button, EmptyState, ListSkeleton, Skeleton, useConfirm, useToast } from '@/app/components/ui';

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
  line_linked?: boolean;
  notification_preferences?: Record<string, boolean>;
};

const ROLE_OPTIONS: { key: RoleKey; label: string; icon: React.ReactNode; color: string }[] = [
  { key: 'student', label: '生徒', icon: <GraduationCap size={16} />, color: 'bg-sky-50 text-sky-700 border-sky-100' },
  { key: 'parent', label: '保護者', icon: <UserRound size={16} />, color: 'bg-accent-soft text-accent border-accent/20' },
  { key: 'teacher', label: '講師', icon: <Users size={16} />, color: 'bg-emerald-50 text-emerald-700 border-emerald-100' },
  { key: 'admin', label: '校舎管理者', icon: <ShieldCheck size={16} />, color: 'bg-slate-100 text-slate-700 border-slate-200' },
];

const CHANNEL_OPTIONS: { key: ChannelKey; label: string; icon: React.ReactNode; description: string }[] = [
  { key: 'line', label: 'LINE', icon: <MessageCircle size={16} />, description: '連携済みユーザーへ即時送信します' },
  { key: 'in_app', label: 'アプリ内', icon: <Bell size={16} />, description: '選択した対象の通知一覧へすぐに追加します' },
  { key: 'email', label: 'メール', icon: <Mail size={16} />, description: '登録メールアドレスへ即時送信します' },
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

function schoolOf(user: AppUser) {
  return user.school || user.school_id || user.classroom || '';
}

function roleLabel(role: RoleKey) {
  return ROLE_OPTIONS.find(item => item.key === role)?.label || role;
}

export default function MasterLineBroadcastPage() {
  const [users, setUsers] = useState<AppUser[]>([]);
  const [todayTeacherIds, setTodayTeacherIds] = useState<string[]>([]);
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
  const [resultHasError, setResultHasError] = useState(false);
  const [loadError, setLoadError] = useState('');
  const sendAttemptId = useRef('');
  const [campaigns, setCampaigns] = useState<any[]>([]);
  const toast = useToast();
  const confirm = useConfirm();

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    setLoading(true);
    setLoadError('');
    try {
      const token = await auth.currentUser?.getIdToken();
      if (!token) return;
      const [response, campaignResponse] = await Promise.all([
        fetch('/api/admin/notifications?view=recipients', { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' }),
        fetch('/api/admin/notifications', { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' }),
      ]);
      const [data, campaignData] = await Promise.all([response.json().catch(() => ({})), campaignResponse.json().catch(() => ({}))]);
      if (!response.ok || !data.ok) throw new Error(data.error || 'recipients-load-failed');
      if (!campaignResponse.ok || !campaignData.ok) throw new Error(campaignData.error || 'campaigns-load-failed');
      const loaded: AppUser[] = (Array.isArray(data.recipients) ? data.recipients : []).map((item: any) => ({
        id: String(item.id || ''), role: normalizeRole(item.role), rawRole: String(item.raw_role || ''),
        name: String(item.name || '名称未設定'), email: String(item.email || ''), grade: String(item.grade || ''),
        school: String(item.school || ''), line_linked: item.line_linked === true,
        notification_preferences: item.notification_preferences || {},
      }));
      setUsers(loaded);
      setTodayTeacherIds(Array.isArray(data.today_teacher_ids) ? data.today_teacher_ids.map(String) : []);
      setCampaigns(Array.isArray(campaignData.campaigns) ? campaignData.campaigns.slice(0, 20) : []);
    } catch (error) {
      console.error(error);
      setLoadError('ユーザー情報または配信履歴を取得できませんでした。通信状況を確認して再取得してください。');
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
      if (lineOnly && !user.line_linked) return false;
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

  const lineTargets = selectedUsers.filter(user => user.line_linked && user.notification_preferences?.line !== false);

  const stats = useMemo(() => {
    return ROLE_OPTIONS.map(role => {
      const roleUsers = users.filter(user => user.role === role.key);
      return {
        ...role,
        total: roleUsers.length,
        line: roleUsers.filter(user => user.line_linked).length,
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
    if (!sendAttemptId.current) sendAttemptId.current = crypto.randomUUID();
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
        request_id: sendAttemptId.current,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) throw new Error(data.error || '通知作成に失敗しました。');
    if (Number(data.line_failed_count || 0) === 0 && Number(data.email_failed_count || 0) === 0) {
      sendAttemptId.current = '';
    }
    return data;
  };

  const handleCreateOnly = async () => {
    if (!title.trim() || !body.trim()) return toast.error('タイトルと本文を入力してください。');
    if (selectedUsers.length === 0) return toast.error('送信対象を選択してください。');
    const channels = selectedChannels.filter(channel => channel !== 'line');
    if (channels.length === 0) return toast.error('LINEだけが選択されています。「作成して送信」を使うか、アプリ内・メールを選択してください。');
    if (!(await confirm({ title: `${selectedUsers.length}名を対象に通知を作成しますか？`, message: `「${title.trim()}」をLINE以外（${channels.map(channel => CHANNEL_OPTIONS.find(item => item.key === channel)?.label || channel).join('・')}）で送ります。`, confirmLabel: '通知だけ作成' }))) return;

    setSending(true);
    setResult('');
    setResultHasError(false);
    try {
      const data = await sendCampaign(channels);
      setResultHasError(Number(data.email_failed_count || 0) > 0);
      setResult(`通知を作成しました。アプリ内: ${data.in_app_count || 0}件 / メール送信: ${data.email_sent_count || 0}件 / 失敗: ${data.email_failed_count || 0}件`);
    } catch (error: any) {
      toast.error(error.message || '通知作成に失敗しました。');
    } finally {
      setSending(false);
    }
  };

  const handleSend = async () => {
    if (!title.trim() || !body.trim()) return toast.error('タイトルと本文を入力してください。');
    if (selectedUsers.length === 0) return toast.error('送信対象を選択してください。');
    if (!(await confirm({ title: `${selectedUsers.length}名に「${title.trim()}」を送信しますか？`, message: `通知を作成し、LINEは${lineTargets.length}名へ即時送信します。送信後は取り消せません。`, confirmLabel: '作成して送信' }))) return;

    setSending(true);
    setResult('');
    setResultHasError(false);
    try {
      const data = await sendCampaign(selectedChannels);
      const hasError = Number(data.line_failed_count || 0) > 0 || Number(data.email_failed_count || 0) > 0;
      setResultHasError(hasError);
      setResult(`通知を作成しました。アプリ内: ${data.in_app_count || 0}件 / LINE: ${data.line_sent_count || 0}名（失敗${data.line_failed_count || 0}名） / メール: ${data.email_sent_count || 0}件（失敗${data.email_failed_count || 0}件）${hasError ? '。23時間以内に同じ内容で再度送信すると、失敗分を安全に再試行します。' : ''}`);
    } catch (error: any) {
      toast.error(error.message || '送信に失敗しました。');
    } finally {
      setSending(false);
    }
  };

  const handleTodayTeacherReminder = () => {
    const teacherIds = new Set(todayTeacherIds);
    setSelectedRoles(['teacher']);
    setSelectedIds(users.filter(user => user.role === 'teacher' && teacherIds.has(user.id)).map(user => user.id));
    setSelectedChannels(['line']);
    setKind('class_start');
    setTitle('本日の授業リマインド');
    setBody('本日の授業予定をお知らせします。\n講師マイページから担当内容をご確認ください。\n本日もよろしくお願いいたします。');
  };

  if (loading) {
    return (
      <div className="space-y-6">
        <AdminPageHeader />
        <div className="grid gap-3 md:grid-cols-4">{[0, 1, 2, 3].map(index => <Skeleton key={index} className="h-24" />)}</div>
        <ListSkeleton rows={5} />
      </div>
    );
  }

  return (
    <div className="font-sans text-slate-800">
      <AdminPageHeader
        description="対象を選び、選択した利用者へ LINE・アプリ内・メールの通知を送信します。"
        actions={
          <Button variant="secondary" icon={<RefreshCw size={16} aria-hidden />} onClick={fetchData} loading={loading}>再読み込み</Button>
        }
      />
      <div className="space-y-6">
        <div className="grid gap-3 md:grid-cols-4">
          {stats.map(item => (
            <div key={item.key} className={`rounded-card border p-4 ${item.color}`}>
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-2 text-sm font-bold">{item.icon}{item.label}</span>
                <span className="text-2xl font-black">{item.total}</span>
              </div>
              <p className="mt-2 text-xs font-bold opacity-75">LINE連携済み {item.line}名</p>
            </div>
          ))}
        </div>

        {loadError && (
          <div role="alert" className="flex flex-col gap-3 rounded-card border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-bold text-rose-700 sm:flex-row sm:items-center sm:justify-between">
            <span className="flex items-center gap-2"><AlertCircle size={17} />{loadError}</span>
            <Button variant="secondary" size="sm" onClick={fetchData}>もう一度読み込む</Button>
          </div>
        )}

        <div className="grid gap-6 xl:grid-cols-12">
          <section className="space-y-4 xl:col-span-5">
            <div className="rounded-card border border-line bg-white p-5 shadow-sm">
              <div className="mb-4 flex items-center justify-between">
                <h2 className="flex items-center gap-2 text-lg font-bold"><Filter size={18} className="text-slate-500" /> 送信対象</h2>
                <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-bold text-slate-600">選択 {selectedUsers.length}名</span>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="mb-2 block text-xs font-bold text-slate-500">アカウント種別</label>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                    {ROLE_OPTIONS.map(role => (
                      <button
                        key={role.key}
                        onClick={() => toggleRole(role.key)}
                        aria-pressed={selectedRoles.includes(role.key)}
                        className={`flex min-h-11 items-center justify-center gap-1.5 rounded-btn border px-3 py-2 text-xs font-bold transition-all ${
                          selectedRoles.includes(role.key) ? role.color : 'border-slate-100 bg-slate-50 text-slate-400'
                        }`}
                      >
                        {role.icon}{role.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <select value={school} onChange={e => setSchool(e.target.value)} className="rounded-input border border-line bg-slate-50 px-4 py-2.5 min-h-11 text-sm font-bold outline-none">
                    <option value="all">校舎: 全て</option>
                    {schools.map(value => <option key={value} value={value}>{value}</option>)}
                  </select>
                  <select value={grade} onChange={e => setGrade(e.target.value)} className="rounded-input border border-line bg-slate-50 px-4 py-2.5 min-h-11 text-sm font-bold outline-none">
                    <option value="all">学年: 全て</option>
                    {grades.map(value => <option key={value} value={value}>{value}</option>)}
                  </select>
                </div>

                <div className="relative">
                  <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={18} aria-hidden />
                  <input aria-label="氏名・メール・校舎で検索" value={search} onChange={e => setSearch(e.target.value)} placeholder="氏名・メール・校舎で検索" className="min-h-11 w-full rounded-input border border-line bg-slate-50 py-2.5 pl-11 pr-4 text-sm outline-none focus:ring-2 focus:ring-accent/30" />
                </div>

                <label className="flex items-center justify-between rounded-btn bg-slate-50 px-4 py-3">
                  <span className="text-sm font-bold text-slate-600">LINE連携済みだけ表示</span>
                  <input type="checkbox" checked={lineOnly} onChange={e => setLineOnly(e.target.checked)} className="h-5 w-5 accent-[#06C755]" />
                </label>

                <div className="flex gap-2">
                  <Button variant="secondary" className="flex-1" onClick={selectFiltered}>表示中を全選択</Button>
                  <Button variant="ghost" className="flex-1" onClick={clearFiltered}>表示中を解除</Button>
                </div>
              </div>
            </div>

            <div className="max-h-[560px] overflow-y-auto rounded-card border border-line bg-white p-3 shadow-sm">
              {filteredUsers.length === 0 ? (
                <EmptyState icon={Users} title="対象が見つかりません" description="アカウント種別・校舎・学年・検索の条件を変えてみてください。" className="border-0" />
              ) : (
                <div className="space-y-2">
                  {filteredUsers.map(user => {
                    const selected = selectedIds.includes(user.id);
                    return (
                      <button
                        key={user.id}
                        onClick={() => toggleUser(user.id)}
                        aria-pressed={selected}
                        className={`w-full rounded-btn border p-3 text-left transition-all ${selected ? 'border-emerald-500 bg-emerald-50' : 'border-slate-100 bg-white hover:bg-slate-50'}`}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="truncate text-sm font-bold text-slate-800">{user.name}</span>
                              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-bold text-slate-500">{roleLabel(user.role)}</span>
                              {user.line_linked && <span className="rounded-full bg-[#06C755]/10 px-2 py-0.5 text-xs font-bold text-[#06C755]">LINE</span>}
                            </div>
                            <p className="mt-1 truncate text-xs font-bold text-slate-400">{[schoolOf(user), user.grade, user.email].filter(Boolean).join(' / ') || '詳細なし'}</p>
                          </div>
                          <span className={`mt-1 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border ${selected ? 'border-emerald-500 bg-emerald-500 text-white' : 'border-slate-200 text-transparent'}`}>
                            <Check size={14} strokeWidth={4} aria-hidden />
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
            <div className="rounded-card border border-line bg-white p-5 shadow-sm">
              <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <h2 className="flex items-center gap-2 text-lg font-bold"><Megaphone size={18} className="text-[#06C755]" /> 通知作成</h2>
                {result && <span role="status" className={`rounded-btn px-3 py-2 text-xs font-bold ${resultHasError ? 'bg-amber-50 text-amber-800' : 'bg-emerald-50 text-emerald-700'}`}>{resultHasError ? <AlertCircle size={13} className="mr-1 inline" /> : <CheckCircle size={13} className="mr-1 inline" />}{result}</span>}
              </div>

              <div className="mb-5 grid gap-2 md:grid-cols-4">
                {TEMPLATES.map(template => (
                  <button key={template.title} onClick={() => applyTemplate(template)} className="rounded-btn border border-slate-100 bg-slate-50 p-3 text-left hover:border-accent/30 hover:bg-accent-soft">
                    <Sparkles size={15} className="mb-2 text-accent" aria-hidden />
                    <p className="text-xs font-bold text-slate-700">{template.title}</p>
                  </button>
                ))}
              </div>

              <div className="grid gap-4">
                <div>
                  <label className="mb-2 block text-xs font-bold text-slate-500">送り方</label>
                  <div className="grid gap-2 md:grid-cols-3">
                    {CHANNEL_OPTIONS.map(channel => (
                      <button
                        key={channel.key}
                        onClick={() => toggleChannel(channel.key)}
                        aria-pressed={selectedChannels.includes(channel.key)}
                        className={`rounded-btn border p-4 text-left transition-all ${selectedChannels.includes(channel.key) ? 'border-accent bg-accent-soft text-accent' : 'border-slate-100 bg-slate-50 text-slate-500'}`}
                      >
                        <span className="flex items-center gap-2 text-sm font-bold">{channel.icon}{channel.label}</span>
                        <span className="mt-1 block text-xs font-medium leading-relaxed opacity-70">{channel.description}</span>
                      </button>
                    ))}
                  </div>
                </div>

                <div className="grid gap-3 md:grid-cols-2">
                  <input aria-label="通知タイトル" value={title} onChange={e => setTitle(e.target.value)} placeholder="タイトル" className="min-h-11 rounded-input border border-line bg-slate-50 px-4 py-2.5 text-sm font-bold outline-none focus:ring-2 focus:ring-accent/30" />
                  <select aria-label="通知の種類" value={kind} onChange={e => setKind(e.target.value)} className="min-h-11 rounded-input border border-line bg-slate-50 px-4 py-2.5 text-sm font-bold outline-none">
                    {KIND_OPTIONS.map(item => <option key={item.key} value={item.key}>{item.label}</option>)}
                  </select>
                </div>

                <textarea aria-label="通知本文" value={body} onChange={e => setBody(e.target.value)} placeholder="本文を入力してください" className="min-h-56 resize-y rounded-input border border-line bg-slate-50 p-4 text-sm leading-relaxed outline-none focus:ring-2 focus:ring-accent/30" />

                <label className="flex items-center justify-between rounded-btn bg-slate-50 px-4 py-3">
                  <span className="text-sm font-bold text-slate-600">LINE本文の先頭に宛名を入れる</span>
                  <input type="checkbox" checked={includeName} onChange={e => setIncludeName(e.target.checked)} className="h-5 w-5 accent-[#06C755]" />
                </label>
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-3">
              <div className="rounded-card border border-line bg-white p-5 shadow-sm md:col-span-1">
                <h3 className="text-sm font-bold text-slate-700">送信サマリー</h3>
                <div className="mt-4 space-y-3 text-sm font-bold text-slate-500">
                  <p className="flex justify-between"><span>選択対象</span><span className="font-bold text-slate-900">{selectedUsers.length}名</span></p>
                  <p className="flex justify-between"><span>LINE即時送信</span><span className="font-bold text-[#06C755]">{lineTargets.length}名</span></p>
                  <p className="flex justify-between"><span>表示中</span><span>{filteredUsers.length}名</span></p>
                </div>
                <Button variant="secondary" fullWidth className="mt-5" onClick={handleTodayTeacherReminder}>
                  本日の講師リマインドを作成
                </Button>
              </div>

              <div className="rounded-card border border-line bg-white p-5 shadow-sm md:col-span-2">
                <h3 className="text-sm font-bold text-slate-700">プレビュー</h3>
                <div className="mt-3 min-h-40 whitespace-pre-wrap rounded-btn bg-slate-900 p-4 text-sm leading-relaxed text-white">
                  {selectedUsers[0] ? buildText(selectedUsers[0]) : '対象を選ぶと、ここにLINE本文のプレビューが表示されます。'}
                </div>
                <div className="mt-4 flex flex-col gap-3 sm:flex-row">
                  <Button variant="secondary" size="lg" className="flex-1" onClick={handleCreateOnly} loading={sending} icon={<Bell size={18} aria-hidden />}>通知だけ作成</Button>
                  <Button size="lg" className="flex-1" onClick={handleSend} loading={sending} icon={<Send size={18} aria-hidden />}>作成して送信</Button>
                </div>
                {selectedChannels.includes('line') && lineTargets.length < selectedUsers.length && (
                  <p className="mt-3 flex items-center gap-2 rounded-btn bg-amber-50 px-4 py-3 text-xs font-bold text-amber-700">
                    <AlertCircle size={15} aria-hidden /> LINE未連携またはLINE通知OFFの対象はLINE送信されません。
                  </p>
                )}
              </div>
            </div>
          </section>
        </div>

        <section className="rounded-card border border-line bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between gap-3"><div><h2 className="text-lg font-bold text-slate-900">最近の配信履歴</h2><p className="mt-1 text-xs font-bold text-slate-400">完了件数と外部配信の失敗件数を確認できます。</p></div><span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-bold text-slate-600">{campaigns.length}件</span></div>
          <div className="mt-4 overflow-x-auto"><table className="min-w-[760px] w-full text-left text-xs"><thead><tr className="border-b border-slate-200 text-slate-400">{['状態', 'タイトル', '対象', 'アプリ内', 'LINE', 'メール', '除外'].map(label => <th key={label} className="px-3 py-3 font-bold">{label}</th>)}</tr></thead><tbody>{campaigns.map(item => <tr key={item.id} className="border-b border-slate-100"><td className="px-3 py-3"><span className={`whitespace-nowrap rounded-full px-2 py-1 font-bold ${item.status === 'processing' ? 'bg-sky-100 text-sky-700' : item.status === 'failed' ? 'bg-rose-100 text-rose-700' : item.status === 'completed_with_errors' ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700'}`}>{item.status === 'processing' ? '処理中' : item.status === 'failed' ? '失敗' : item.status === 'completed_with_errors' ? '一部失敗' : '完了'}</span></td><td className="px-3 py-3 font-bold text-slate-800">{item.title || '無題'}</td><td className="px-3 py-3 font-bold">{Number(item.target_count || 0)}名</td><td className="px-3 py-3 font-bold">{Number(item.in_app_count || 0)}件</td><td className="px-3 py-3 font-bold text-[#06C755]">成功{Number(item.line_sent_count || 0)} / 失敗{Number(item.line_failed_count || 0)}</td><td className="px-3 py-3 font-bold text-sky-700">成功{Number(item.email_sent_count || 0)} / 失敗{Number(item.email_failed_count || 0)}</td><td className="px-3 py-3 font-bold text-slate-500">{Number(item.skipped_count || 0)}件</td></tr>)}</tbody></table>{campaigns.length === 0 && <EmptyState icon={Send} title="配信履歴はまだありません" className="mt-2" />}</div>
        </section>
      </div>
    </div>
  );
}
