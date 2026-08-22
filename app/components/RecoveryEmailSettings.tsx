'use client';

import { useEffect, useState } from 'react';
import { CheckCircle2, Loader2, Mail, ShieldCheck } from 'lucide-react';
import { auth } from '@/lib/firebase';

type Props = {
  currentEmail?: string | null;
  verified?: boolean;
  compact?: boolean;
};

export default function RecoveryEmailSettings({ currentEmail, verified, compact = false }: Props) {
  const [email, setEmail] = useState(currentEmail || '');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  useEffect(() => setEmail(currentEmail || ''), [currentEmail]);

  const sendVerification = async () => {
    setSaving(true);
    setMessage('');
    setError('');
    try {
      const token = await auth.currentUser?.getIdToken();
      if (!token) throw new Error('ログイン情報を確認できません。');
      const response = await fetch('/api/auth/recovery-email', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ email }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data.ok === false) {
        if (data.error === 'too-many-requests') throw new Error('送信回数が多いため、1時間ほど空けてお試しください。');
        throw new Error('メールアドレスを確認して、もう一度お試しください。');
      }
      setMessage('確認メールを送信しました。メール内のボタンを30分以内に押してください。');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '確認メールを送信できませんでした。');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={`${compact ? 'p-4' : 'p-5'} rounded-2xl border border-slate-200 bg-slate-50`}>
      <div className="flex items-start gap-3">
        <div className="rounded-xl bg-white p-2 text-indigo-600 shadow-sm">
          <ShieldCheck size={20} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-black text-slate-800">再設定用メール</h3>
            {verified && currentEmail && (
              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-1 text-[11px] font-black text-emerald-700">
                <CheckCircle2 size={13} /> 確認済み
              </span>
            )}
          </div>
          <p className="mt-1 text-xs font-bold leading-relaxed text-slate-500">
            パスワードを忘れたときに使います。受信できる本人または保護者のメールを登録してください。
          </p>
        </div>
      </div>
      <div className="mt-4 flex flex-col gap-2 sm:flex-row">
        <div className="relative min-w-0 flex-1">
          <Mail className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={17} />
          <input
            type="email"
            autoComplete="email"
            value={email}
            onChange={event => {
              setEmail(event.target.value);
              setMessage('');
              setError('');
            }}
            placeholder="example@email.com"
            className="w-full rounded-xl border border-slate-200 bg-white py-3 pl-10 pr-3 text-base font-bold text-slate-800 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
          />
        </div>
        <button
          type="button"
          onClick={sendVerification}
          disabled={saving || !email}
          className="flex shrink-0 items-center justify-center gap-2 rounded-xl bg-indigo-600 px-5 py-3 text-sm font-black text-white hover:bg-indigo-700 disabled:opacity-50"
        >
          {saving && <Loader2 size={16} className="animate-spin" />}
          {verified && email === currentEmail ? '変更する' : '確認メールを送る'}
        </button>
      </div>
      {message && <p className="mt-3 text-xs font-bold leading-relaxed text-emerald-700">{message}</p>}
      {error && <p className="mt-3 text-xs font-bold leading-relaxed text-red-600">{error}</p>}
    </div>
  );
}

