'use client';

import { FormEvent, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, CheckCircle2, Headphones, KeyRound, Loader2, Mail, Phone, User } from 'lucide-react';

type ResetMode = 'email' | 'support';

export default function PasswordResetRequestPage() {
  const [mode, setMode] = useState<ResetMode>('email');
  const [form, setForm] = useState({ login_id: '', name: '', email: '', phone_last4: '' });
  const [sending, setSending] = useState(false);
  const [complete, setComplete] = useState(false);
  const [requestCode, setRequestCode] = useState('');

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSending(true);
    try {
      const response = await fetch('/api/auth/password-reset/request', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...form, mode }),
      });
      const data = await response.json().catch(() => ({}));
      setRequestCode(String(data.request_code || ''));
      setComplete(true);
    } finally {
      setSending(false);
    }
  };

  const restart = (nextMode: ResetMode) => {
    setMode(nextMode);
    setComplete(false);
    setRequestCode('');
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 px-4 py-10">
      <div className="w-full max-w-md rounded-lg border border-slate-200 bg-white p-6 shadow-lg sm:p-8">
        {complete ? (
          <div className="text-center">
            <CheckCircle2 className="mx-auto text-emerald-500" size={48} />
            <h1 className="mt-4 text-xl font-black text-slate-900">受付が完了しました</h1>
            {mode === 'email' ? (
              <>
                <p className="mt-3 text-sm font-bold leading-7 text-slate-600">
                  入力内容が登録情報と一致する場合、本人または紐づく保護者の確認済みメールへ再設定用メールを送信します。
                </p>
                <p className="mt-3 text-xs font-bold leading-6 text-slate-400">
                  数分待っても届かない場合は迷惑メールをご確認ください。
                </p>
                <button onClick={() => restart('support')} className="mt-4 text-sm font-black text-indigo-600 hover:text-indigo-800">
                  メールを利用できない場合はこちら
                </button>
              </>
            ) : (
              <>
                <p className="mt-3 text-sm font-bold leading-7 text-slate-600">
                  自動でパスワードは変更されません。サポート担当が登録情報を確認してから再設定をご案内します。
                </p>
                {requestCode && (
                  <div className="mt-4 rounded-lg border border-indigo-200 bg-indigo-50 p-4">
                    <p className="text-xs font-black text-indigo-600">受付番号</p>
                    <p className="mt-1 font-mono text-xl font-black tracking-wider text-indigo-950">{requestCode}</p>
                  </div>
                )}
                <a href="tel:0783214123" className="mt-5 inline-flex items-center gap-2 text-base font-black text-slate-900">
                  <Phone size={18} /> 理社講座サポートセンター 078-321-4123
                </a>
                <p className="mt-2 text-xs font-bold leading-6 text-slate-400">受付番号とログインIDをお伝えください。</p>
              </>
            )}
            <Link href="/" className="mt-6 inline-flex items-center gap-2 rounded-lg bg-slate-900 px-6 py-3 text-sm font-black text-white">
              <ArrowLeft size={17} /> ログインへ戻る
            </Link>
          </div>
        ) : (
          <>
            <div className="flex items-center gap-3">
              <div className="rounded-lg bg-indigo-100 p-3 text-indigo-600"><KeyRound size={24} /></div>
              <div>
                <h1 className="text-xl font-black text-slate-900">パスワード再設定</h1>
                <p className="mt-1 text-xs font-bold text-slate-500">登録済みの情報を入力してください</p>
              </div>
            </div>

            <div className="mt-6 grid grid-cols-2 rounded-lg bg-slate-100 p-1">
              <button type="button" onClick={() => setMode('email')} className={`flex min-h-11 items-center justify-center gap-2 rounded-md px-2 text-xs font-black ${mode === 'email' ? 'bg-white text-indigo-700 shadow-sm' : 'text-slate-500'}`}>
                <Mail size={16} /> メールで再設定
              </button>
              <button type="button" onClick={() => setMode('support')} className={`flex min-h-11 items-center justify-center gap-2 rounded-md px-2 text-xs font-black ${mode === 'support' ? 'bg-white text-indigo-700 shadow-sm' : 'text-slate-500'}`}>
                <Headphones size={16} /> メールが使えない
              </button>
            </div>

            {mode === 'email' ? (
              <p className="mt-4 rounded-lg bg-blue-50 px-4 py-3 text-xs font-bold leading-5 text-blue-800">
                生徒本人にメール登録がなくても、紐づく保護者が確認済みメールを登録していれば、そのメールで再設定できます。
              </p>
            ) : (
              <p className="mt-4 rounded-lg bg-amber-50 px-4 py-3 text-xs font-bold leading-5 text-amber-800">
                本人確認の受付を行います。安全のため、IDや氏名だけでパスワードが自動変更されることはありません。
              </p>
            )}

            <form onSubmit={submit} className="mt-5 space-y-4">
              <label className="block">
                <span className="mb-1.5 block text-xs font-black text-slate-600">ログインID</span>
                <div className="relative">
                  <User className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
                  <input required autoComplete="username" value={form.login_id} onChange={event => setForm({ ...form, login_id: event.target.value })} className="w-full rounded-lg border border-slate-200 py-3 pl-10 pr-3 font-mono text-base outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100" />
                </div>
              </label>
              <label className="block">
                <span className="mb-1.5 block text-xs font-black text-slate-600">氏名（登録されている表記）</span>
                <input required autoComplete="name" value={form.name} onChange={event => setForm({ ...form, name: event.target.value })} className="w-full rounded-lg border border-slate-200 px-3 py-3 text-base font-bold outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100" />
              </label>
              {mode === 'email' ? (
                <label className="block">
                  <span className="mb-1.5 block text-xs font-black text-slate-600">本人または保護者の確認済みメール</span>
                  <div className="relative">
                    <Mail className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
                    <input required type="email" autoComplete="email" value={form.email} onChange={event => setForm({ ...form, email: event.target.value })} className="w-full rounded-lg border border-slate-200 py-3 pl-10 pr-3 text-base font-bold outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100" />
                  </div>
                </label>
              ) : (
                <label className="block">
                  <span className="mb-1.5 block text-xs font-black text-slate-600">登録電話番号の下4桁（任意）</span>
                  <input inputMode="numeric" maxLength={4} value={form.phone_last4} onChange={event => setForm({ ...form, phone_last4: event.target.value.replace(/\D/g, '').slice(0, 4) })} placeholder="例: 4123" className="w-full rounded-lg border border-slate-200 px-3 py-3 font-mono text-base font-bold outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100" />
                </label>
              )}
              <button disabled={sending} className="flex w-full items-center justify-center gap-2 rounded-lg bg-indigo-600 py-3.5 text-sm font-black text-white hover:bg-indigo-700 disabled:opacity-60">
                {sending && <Loader2 size={18} className="animate-spin" />}
                {mode === 'email' ? '再設定メールを送る' : '本人確認を申し込む'}
              </button>
            </form>
            <Link href="/" className="mt-5 flex items-center justify-center gap-2 text-sm font-black text-slate-500 hover:text-indigo-600">
              <ArrowLeft size={16} /> ログインへ戻る
            </Link>
          </>
        )}
      </div>
    </main>
  );
}
