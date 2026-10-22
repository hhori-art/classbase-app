'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { auth } from '@/lib/firebase';
import { signInWithEmailAndPassword } from 'firebase/auth';
import { Bell, ChevronRight, Lock, Mail, MessageCircle, Settings, Shield, Smartphone } from 'lucide-react';
import { useAuth } from '@/app/context/AuthContext';
import LineLinkPanel from '@/app/components/LineLinkPanel';
import PushNotificationToggle from '@/app/components/PushNotificationToggle';
import RecoveryEmailSettings from '@/app/components/RecoveryEmailSettings';
import SignedInPasswordHelp, { displayLoginId } from '@/app/components/SignedInPasswordHelp';
import { ParentCard, ParentPageHeader, ParentSectionTitle } from '@/app/components/parent/ParentUI';
import { Button, Spinner, useToast } from '@/app/components/ui';
import { TERMS } from '@/lib/glossary';

const ITEMS = [
  { key: 'email', label: 'メール通知', icon: Mail },
  { key: 'line', label: 'LINE通知', icon: MessageCircle },
  { key: 'in_app', label: 'アプリ内通知', icon: Smartphone },
  { key: 'class_start', label: '授業開始通知', icon: Bell },
  { key: 'homework', label: '宿題通知', icon: Bell },
  { key: 'announcements', label: `${TERMS.news}の通知`, icon: Bell },
] as const;
type PrefKey = typeof ITEMS[number]['key'];

export default function ParentSettingsPage() {
  const { user, profile } = useAuth();
  const toast = useToast();
  const [prefs, setPrefs] = useState<Record<PrefKey, boolean>>({
    email: false,
    line: false,
    in_app: true,
    class_start: true,
    homework: true,
    announcements: true,
  });
  const [savingKey, setSavingKey] = useState<PrefKey | ''>('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordMessage, setPasswordMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [changingPassword, setChangingPassword] = useState(false);

  useEffect(() => {
    if (profile?.notification_preferences) {
      setPrefs(prev => ({ ...prev, ...profile.notification_preferences }));
    }
  }, [profile]);

  const lineLinked = Boolean(String(profile?.line_user_id || '').trim());

  /** 切り替えたらすぐ保存する。失敗したら元に戻して知らせる。 */
  const toggle = async (key: PrefKey, value: boolean) => {
    if (savingKey) return;
    const previous = prefs[key];
    setPrefs(current => ({ ...current, [key]: value }));
    setSavingKey(key);
    try {
      const token = await auth.currentUser?.getIdToken();
      const res = await fetch('/api/notifications/preferences', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ [key]: value }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.ok === false) throw new Error('failed');
      toast.success(`${ITEMS.find(item => item.key === key)?.label || '通知'}を${value ? 'オン' : 'オフ'}にしました。`);
    } catch {
      setPrefs(current => ({ ...current, [key]: previous }));
      toast.error('保存できませんでした。通信状態を確認して、もう一度お試しください。');
    } finally {
      setSavingKey('');
    }
  };


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

  const inputClass = 'min-h-11 w-full rounded-input border border-line bg-surface px-3 text-sm text-fg focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/30';

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <ParentPageHeader eyebrow="アカウント" title="設定" description="パスワード・LINE連携・通知の受け取り方を変更できます。" icon={Settings} />
      <Link href="/manual" className="cb-card flex min-h-12 items-center justify-between px-5 py-3 text-sm font-bold text-accent hover:bg-accent-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">保護者向け操作マニュアル <ChevronRight size={19} aria-hidden /></Link>
      {profile?.isFirstLogin === true && (
        <div role="status" className="rounded-card border-2 border-warning/40 bg-warning-soft p-4 text-sm font-bold leading-relaxed text-warning">
          初回ログインのため、新しいパスワードを設定してください。変更後に通常画面を利用できます。
        </div>
      )}
      <ParentCard>
        <ParentSectionTitle icon={Lock} title="パスワード変更" />
        <div className="space-y-3">
          <SignedInPasswordHelp
            loginId={displayLoginId(profile, user?.email)}
            hasVerifiedRecoveryEmail={Boolean(profile?.recovery_email && profile?.recovery_email_verified_at)}
            audience="parent"
          />
          <label className="block text-sm font-bold text-fg">新しいパスワード
            <input type="password" autoComplete="new-password" value={newPassword} onChange={event => setNewPassword(event.target.value)} placeholder="6文字以上" className={`mt-1 ${inputClass}`} />
          </label>
          <label className="block text-sm font-bold text-fg">もう一度入力
            <input type="password" autoComplete="new-password" value={confirmPassword} onChange={event => setConfirmPassword(event.target.value)} placeholder="確認のため同じものを入力" className={`mt-1 ${inputClass}`} />
          </label>
          {passwordMessage && <p role={passwordMessage.type === 'error' ? 'alert' : 'status'} className={`flex items-center gap-2 text-sm font-bold ${passwordMessage.type === 'success' ? 'text-success' : 'text-danger'}`}><Shield size={15} aria-hidden />{passwordMessage.text}</p>}
          <Button onClick={changePassword} loading={changingPassword} fullWidth>
            {changingPassword ? '変更中...' : 'パスワードを変更'}
          </Button>
        </div>
      </ParentCard>
      <LineLinkPanel
        role="parent"
        lineUserId={profile?.line_user_id}
        description="連携すると、授業開始・欠席連絡・登録依頼・お知らせなどをLINEでも受け取れます。"
        compact
      />
      <PushNotificationToggle compact />
      <ParentCard>
        <RecoveryEmailSettings
          currentEmail={profile?.recovery_email}
          verified={Boolean(profile?.recovery_email_verified_at)}
          compact
        />
      </ParentCard>
      <ParentCard>
        <ParentSectionTitle icon={Bell} title="通知の受け取り方" />
        <p className="mb-2 text-sm text-fg-muted">切り替えるとすぐに保存されます。</p>
        {ITEMS.map(item => {
          const Icon = item.icon;
          const lineLocked = item.key === 'line' && !lineLinked;
          const id = `pref-${item.key}`;
          return (
            <div key={item.key} className="flex min-h-12 items-center justify-between gap-3 border-b border-line py-3 last:border-b-0">
              <label htmlFor={id} className={`flex flex-1 items-center gap-3 text-sm font-bold ${lineLocked ? 'cursor-not-allowed text-fg-muted' : 'cursor-pointer text-fg'}`}>
                <Icon size={18} className={lineLocked ? 'text-fg-muted' : 'text-accent'} aria-hidden />
                <span>
                  {item.label}
                  {lineLocked && <span className="mt-0.5 block text-xs font-medium text-fg-muted">LINE連携をすると使えます</span>}
                </span>
              </label>
              {savingKey === item.key && <Spinner label="保存中" size={16} />}
              <input
                id={id}
                type="checkbox"
                checked={lineLocked ? false : prefs[item.key]}
                disabled={lineLocked || Boolean(savingKey)}
                onChange={event => void toggle(item.key, event.target.checked)}
                className="h-5 w-5 accent-accent disabled:cursor-not-allowed disabled:opacity-50"
              />
            </div>
          );
        })}
      </ParentCard>
    </div>
  );
}
