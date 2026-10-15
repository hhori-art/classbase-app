'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { auth } from '@/lib/firebase';
import { signInWithEmailAndPassword } from 'firebase/auth';
import { Bell, ChevronRight, Lock, Mail, MessageCircle, Save, Shield, Smartphone } from 'lucide-react';
import { useAuth } from '@/app/context/AuthContext';
import LineLinkPanel from '@/app/components/LineLinkPanel';
import RecoveryEmailSettings from '@/app/components/RecoveryEmailSettings';

export default function ParentSettingsPage() {
  const { profile } = useAuth();
  const [prefs, setPrefs] = useState({
    email: false,
    line: false,
    in_app: true,
    class_start: true,
    homework: true,
    announcements: true,
  });
  const [saving, setSaving] = useState(false);
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordMessage, setPasswordMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [changingPassword, setChangingPassword] = useState(false);

  useEffect(() => {
    if (profile?.notification_preferences) {
      setPrefs(prev => ({ ...prev, ...profile.notification_preferences }));
    }
  }, [profile]);

  const save = async () => {
    setSaving(true);
    try {
      const token = await auth.currentUser?.getIdToken();
      const res = await fetch('/api/notifications/preferences', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(prefs),
      });
      if (!res.ok) throw new Error('failed');
      alert('通知設定を保存しました。');
    } catch {
      alert('保存に失敗しました。');
    } finally {
      setSaving(false);
    }
  };

  const items = [
    { key: 'email', label: 'メール通知', icon: Mail },
    { key: 'line', label: 'LINE通知', icon: MessageCircle },
    { key: 'in_app', label: 'アプリ内通知', icon: Smartphone },
    { key: 'class_start', label: '授業開始通知', icon: Bell },
    { key: 'homework', label: '宿題通知', icon: Bell },
    { key: 'announcements', label: 'お知らせ通知', icon: Bell },
  ] as const;

  const changePassword = async () => {
    if (newPassword.length < 6) return setPasswordMessage({ type: 'error', text: 'パスワードは6文字以上で入力してください。' });
    if (newPassword !== confirmPassword) return setPasswordMessage({ type: 'error', text: '確認用パスワードが一致しません。' });
    const currentUser = auth.currentUser;
    if (!currentUser?.email) return setPasswordMessage({ type: 'error', text: 'ログイン情報を確認できません。' });
    setChangingPassword(true);
    try {
      const token = await currentUser.getIdToken();
      const res = await fetch('/api/auth/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ password: newPassword }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) throw new Error(data.error || 'password-change-failed');
      sessionStorage.removeItem(`classbase_profile_cache:${currentUser.uid}`);
      const credential = await signInWithEmailAndPassword(auth, currentUser.email, newPassword);
      await credential.user.getIdToken(true);
      setNewPassword('');
      setConfirmPassword('');
      setPasswordMessage({ type: 'success', text: 'パスワードを変更しました。' });
      window.location.replace('/parent');
    } catch {
      setPasswordMessage({ type: 'error', text: 'パスワード変更に失敗しました。再度ログインしてお試しください。' });
    } finally {
      setChangingPassword(false);
    }
  };

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div>
        <p className="text-xs font-black uppercase tracking-wider text-indigo-400">Notification</p>
        <h2 className="text-2xl font-black text-slate-900">通知設定</h2>
      </div>
      <Link href="/manual" className="flex min-h-12 items-center justify-between rounded-2xl border border-indigo-200 bg-indigo-50 px-5 py-3 text-sm font-black text-indigo-800">保護者向け操作マニュアル <ChevronRight size={19} /></Link>
      {profile?.isFirstLogin === true && (
        <div className="rounded-2xl border-2 border-amber-300 bg-amber-50 p-4 text-sm font-black leading-relaxed text-amber-900">
          初回ログインのため、新しいパスワードを設定してください。変更後に通常画面を利用できます。
        </div>
      )}
      <div className="rounded-2xl bg-white p-4 shadow-sm">
        <h3 className="flex items-center gap-2 text-sm font-black text-slate-800"><Lock size={18} /> パスワード変更</h3>
        <div className="mt-4 space-y-3">
          <input type="password" autoComplete="new-password" value={newPassword} onChange={event => setNewPassword(event.target.value)} placeholder="新しいパスワード（6文字以上）" className="w-full rounded-xl border border-slate-200 px-3 py-3 text-sm font-bold" />
          <input type="password" autoComplete="new-password" value={confirmPassword} onChange={event => setConfirmPassword(event.target.value)} placeholder="もう一度入力" className="w-full rounded-xl border border-slate-200 px-3 py-3 text-sm font-bold" />
          {passwordMessage && <p className={`flex items-center gap-2 text-xs font-black ${passwordMessage.type === 'success' ? 'text-emerald-600' : 'text-red-600'}`}><Shield size={15} />{passwordMessage.text}</p>}
          <button onClick={changePassword} disabled={changingPassword} className="w-full rounded-xl bg-indigo-600 py-3 text-sm font-black text-white disabled:opacity-60">
            {changingPassword ? '変更中...' : 'パスワードを変更'}
          </button>
        </div>
      </div>
      <LineLinkPanel
        role="parent"
        lineUserId={profile?.line_user_id}
        description="連携すると、授業開始・欠席連絡・登録依頼・お知らせなどをLINEでも受け取れます。"
        compact
      />
      <div className="rounded-2xl bg-white p-4 shadow-sm">
        <RecoveryEmailSettings
          currentEmail={profile?.recovery_email}
          verified={Boolean(profile?.recovery_email_verified_at)}
          compact
        />
      </div>
      <div className="rounded-2xl bg-white p-4 shadow-sm">
        {items.map(item => {
          const Icon = item.icon;
          return (
            <label key={item.key} className="flex items-center justify-between border-b border-slate-100 py-4 last:border-b-0">
              <span className="flex items-center gap-3 text-sm font-black text-slate-700">
                <Icon size={18} className="text-indigo-500" />
                {item.label}
              </span>
              <input type="checkbox" checked={prefs[item.key]} onChange={e => setPrefs(prev => ({ ...prev, [item.key]: e.target.checked }))} className="h-5 w-5 accent-indigo-600" />
            </label>
          );
        })}
      </div>
      <button onClick={save} disabled={saving} className="flex w-full items-center justify-center gap-2 rounded-2xl bg-slate-900 py-4 text-sm font-black text-white hover:bg-slate-800 disabled:opacity-60">
        <Save size={18} /> {saving ? '保存中...' : '保存する'}
      </button>
    </div>
  );
}
