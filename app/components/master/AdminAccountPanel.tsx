'use client';

import { useState } from 'react';
import { Lock, LogOut } from 'lucide-react';
import { auth } from '@/lib/firebase';
import { minPasswordLength, passwordPolicyError } from '@/lib/password-policy';
import { changeOwnPassword, PasswordChangeError } from '@/lib/client-password-change';
import { useAuth } from '@/app/context/AuthContext';
import LineLinkPanel from '@/app/components/LineLinkPanel';
import PushNotificationToggle from '@/app/components/PushNotificationToggle';
import { Button, Card, SectionTitle, useConfirm, useToast } from '@/app/components/ui';

/**
 * 管理者の「自分のアカウント」（パスワード変更・LINE連携・ログアウト）。
 * マスターの設定画面と、どの管理者でも開ける /master/account の両方で使う。
 */
export default function AdminAccountPanel({ onPasswordChanged }: {
  /** パスワードを変えたあと（初回ログインならホームへ移るなど）。 */
  onPasswordChanged?: () => void;
}) {
  const { profile, logout } = useAuth();
  const confirm = useConfirm();
  const toast = useToast();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [message, setMessage] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const minLength = minPasswordLength(profile?.role);

  const changePassword = async () => {
    if (!newPassword || newPassword !== confirmPassword) {
      setMessage({ tone: 'error', text: 'パスワードが一致しません' });
      return;
    }
    if (!currentPassword) {
      setMessage({ tone: 'error', text: '今のパスワードを入力してください' });
      return;
    }
    const policyError = passwordPolicyError(newPassword, profile?.role, [profile?.lifetime_id, profile?.email]);
    if (policyError) {
      setMessage({ tone: 'error', text: policyError });
      return;
    }
    setSaving(true);
    setMessage(null);
    try {
      const currentUser = auth.currentUser;
      if (!currentUser) throw new Error('missing-auth-user');
      // 今のパスワードはサーバーで確かめる。変更でほかの端末のログインは切れ、この端末は入り直す。
      await changeOwnPassword(currentUser, { password: newPassword, currentPassword });
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setMessage({ tone: 'success', text: 'パスワードを変更しました' });
      toast.success('パスワードを変更しました');
      onPasswordChanged?.();
    } catch (error) {
      setMessage({ tone: 'error', text: error instanceof PasswordChangeError ? error.message : '変更できませんでした。いったんログアウトして入り直してから、もう一度お試しください。' });
    } finally {
      setSaving(false);
    }
  };

  const handleLogout = async () => {
    if (!(await confirm({ title: '管理画面からログアウトしますか？', confirmLabel: 'ログアウト' }))) return;
    try {
      await logout();
    } catch {
      toast.error('ログアウトできませんでした。もう一度お試しください。');
    }
  };

  return (
    <div className="space-y-6">
      <Card>
        <SectionTitle icon={Lock} title="パスワード変更" description={`${minLength}文字以上。変更するとほかの端末ではログインし直しになります。`} />
        <form className="space-y-3" onSubmit={event => { event.preventDefault(); void changePassword(); }}>
          <label className="block">
            <span className="mb-1 block text-xs font-bold text-fg-muted">今のパスワード</span>
            <input type="password" autoComplete="current-password" value={currentPassword} onChange={event => setCurrentPassword(event.target.value)}
              className="min-h-11 w-full rounded-input border border-line bg-slate-50 p-3 text-sm font-bold outline-none focus:border-accent" />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-bold text-fg-muted">新しいパスワード</span>
            <input type="password" autoComplete="new-password" value={newPassword} onChange={event => setNewPassword(event.target.value)}
              className="min-h-11 w-full rounded-input border border-line bg-slate-50 p-3 text-sm font-bold outline-none focus:border-accent" />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-bold text-fg-muted">確認のためもう一度</span>
            <input type="password" autoComplete="new-password" value={confirmPassword} onChange={event => setConfirmPassword(event.target.value)}
              className="min-h-11 w-full rounded-input border border-line bg-slate-50 p-3 text-sm font-bold outline-none focus:border-accent" />
          </label>
          <div className="flex items-center justify-between gap-3">
            <span role="status" className={`text-xs font-bold ${message?.tone === 'error' ? 'text-rose-600' : 'text-emerald-600'}`}>{message?.text}</span>
            <Button type="submit" loading={saving}>変更する</Button>
          </div>
        </form>
      </Card>

      <LineLinkPanel
        role={profile?.role === 'master' ? 'master' : 'admin'}
        lineUserId={profile?.line_user_id}
        description="連携すると、管理者向けのお知らせ・代行・運営通知をLINEでも受け取れます。"
      />

      <PushNotificationToggle />

      <Button variant="secondary" fullWidth className="border-rose-200 text-rose-600 hover:bg-rose-50" onClick={handleLogout} icon={<LogOut size={18} aria-hidden />}>
        ログアウト
      </Button>
    </div>
  );
}
