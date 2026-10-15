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
      const currentUser = auth.currentUser;
      if (!currentUser) throw new Error('ログイン情報を確認できません。');
      let token = '';
      try {
        token = await currentUser.getIdToken(true);
      } catch {
        throw new Error('ログイン期限が切れています。一度ログアウトし、新しいパスワードでログインしてください。');
      }
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
        if (response.status === 401) throw new Error('ログイン期限が切れています。一度ログアウトし、もう一度ログインしてください。');
        if (data.error === 'too-many-requests') throw new Error('送信回数が多いため、1時間ほど空けてお試しください。');
        if (data.error === 'email-sender-not-verified') throw new Error('確認メールの送信元設定を確認中です。少し時間を空けてもう一度お試しください。');
        if (data.error === 'email-delivery-failed') throw new Error('確認メールの送信に失敗しました。時間を空けてもう一度お試しください。');
        if (data.error === 'invalid-email') throw new Error('受信可能なメールアドレスを入力してください。');
        throw new Error(`確認メールを送信できませんでした（${String(data.error || response.status)}）。管理者へお知らせください。`);
      }
      setMessage('創造学園アプリの確認メールを送信しました。30分以内にメール内のリンクを押してください。見つからない場合は迷惑メールもご確認ください。');
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
          <p className="mt-2 rounded-lg border border-blue-100 bg-blue-50 px-3 py-2 text-[11px] font-bold leading-relaxed text-blue-800">
            確認メールは「SOZO-GAKUEN-APP」名義で送られます。送信元は noreply@class-base-app.firebaseapp.com です。パスワードの入力を求めることはありません。
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
