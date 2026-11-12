'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { auth } from '@/lib/firebase';
import { signOut } from 'firebase/auth';
import { changeOwnPassword, PasswordChangeError } from '@/lib/client-password-change';
import { BASIC_PASSWORD_MIN_LENGTH, passwordPolicyError } from '@/lib/password-policy';
import { PASSWORD_CHANGED_RELOGIN_MESSAGE, passwordChangedButReloginFailed } from '@/lib/password-change-error';
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
  const [currentPassword, setCurrentPassword] = useState('');
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


  const firstLogin = profile?.isFirstLogin === true;
  const changePassword = async () => {
    if (!firstLogin && !currentPassword) return setPasswordMessage({ type: 'error', text: '今のパスワードを入力してください。' });
    const policyError = passwordPolicyError(newPassword, 'parent', [profile?.lifetime_id, profile?.parent_login_id]);
    if (policyError) return setPasswordMessage({ type: 'error', text: policyError });
    if (newPassword !== confirmPassword) return setPasswordMessage({ type: 'error', text: '確認用パスワードが一致しません。' });
    const currentUser = auth.currentUser;
    if (!currentUser) return setPasswordMessage({ type: 'error', text: 'ログイン情報を確認できません。' });
    setChangingPassword(true);
    try {
      await changeOwnPassword(currentUser, { password: newPassword, currentPassword: firstLogin ? undefined : currentPassword });
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setPasswordMessage({ type: 'success', text: 'パスワードを変更しました。' });
      window.location.replace('/parent');
    } catch (e) {
      if (passwordChangedButReloginFailed(e)) { setPasswordMessage({ type: 'success', text: PASSWORD_CHANGED_RELOGIN_MESSAGE }); await signOut(auth).catch(() => undefined); window.setTimeout(() => window.location.replace('/'), 2500); return; }
      setPasswordMessage({ type: 'error', text: e instanceof PasswordChangeError ? e.message : 'パスワードを変更できませんでした。もう一度お試しください。' });
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
          {!firstLogin && (
            <label className="block text-sm font-bold text-fg">今のパスワード
              <input type="password" autoComplete="current-password" value={currentPassword} onChange={event => setCurrentPassword(event.target.value)} placeholder="今のパスワード" className={`mt-1 ${inputClass}`} />
              <span className="mt-1 block text-xs font-medium text-fg-muted">忘れたときは、校舎で変更してもらってください。</span>
            </label>
          )}
          <label className="block text-sm font-bold text-fg">新しいパスワード
            <input type="password" autoComplete="new-password" value={newPassword} onChange={event => setNewPassword(event.target.value)} placeholder={`${BASIC_PASSWORD_MIN_LENGTH}文字以上`} className={`mt-1 ${inputClass}`} />
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
