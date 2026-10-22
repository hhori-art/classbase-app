'use client';

import { FormEvent, useState } from 'react';
import { ArrowLeft, CheckCircle2, Headphones, KeyRound, Mail, Phone, Smartphone, User } from 'lucide-react';
import { Button, ButtonLink } from '@/app/components/ui';

type ResetMode = 'email' | 'support';

const inputClass = 'min-h-12 w-full rounded-input border border-line bg-surface px-3 text-base font-bold text-fg outline-none focus:border-accent focus:ring-2 focus:ring-accent/20';

/** ログイン中の端末から変える方法（いちばん早い）。生徒・保護者・講師のどれにも当てはまる書き方にする。 */
function SignedInDeviceGuide() {
  return (
    <section aria-labelledby="signed-in-device-title" className="rounded-card border border-emerald-200 bg-emerald-50 p-4">
      <h2 id="signed-in-device-title" className="flex items-center gap-2 text-sm font-bold text-emerald-900">
        <Smartphone size={18} aria-hidden /> まず確認：ログイン中の端末はありませんか？
      </h2>
      <p className="mt-2 text-sm font-medium leading-6 text-emerald-950">
        ログイン中のスマホ・端末がある場合は、その端末の『設定 → パスワード変更』から、今のパスワードを入れずに新しいパスワードを決められます（いちばん早い方法です）。
      </p>
      <p className="mt-1 text-xs font-medium leading-5 text-emerald-900">
        生徒・保護者・講師のどのアカウントでも同じです。新しいパスワードを決めたら、このパソコンなどでもそのパスワードでログインできます。
      </p>
    </section>
  );
}

export default function PasswordResetRequestPage() {
  const [mode, setMode] = useState<ResetMode>('email');
  const [form, setForm] = useState({ login_id: '', name: '', email: '', phone_last4: '' });
  const [sending, setSending] = useState(false);
  const [complete, setComplete] = useState(false);
  const [requestCode, setRequestCode] = useState('');
  const [error, setError] = useState('');

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSending(true);
    setError('');
    try {
      const response = await fetch('/api/auth/password-reset/request', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...form, mode }),
      });
      if (!response.ok) throw new Error('request-failed');
      const data = await response.json().catch(() => ({}));
      setRequestCode(String(data.request_code || ''));
      setComplete(true);
    } catch {
      setError('送信できませんでした。通信状態を確認して、もう一度お試しください。');
    } finally {
      setSending(false);
    }
  };

  const restart = (nextMode: ResetMode) => {
    setMode(nextMode);
    setComplete(false);
    setRequestCode('');
    setError('');
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-canvas px-4 py-10">
      <div className="w-full max-w-md rounded-card border border-line bg-surface p-6 shadow-card sm:p-8">
        {complete ? (
          <div className="text-center">
            <CheckCircle2 className="mx-auto text-emerald-500" size={48} aria-hidden />
            <h1 className="mt-4 text-xl font-black text-fg">受付が完了しました</h1>
            {mode === 'email' ? (
              <>
                <p className="mt-3 text-sm font-bold leading-7 text-fg">
                  確認済みメールを登録している場合だけ届きます。届かない場合は『メールが使えない』から申し込むか、教室へ連絡してください。
                </p>
                <p className="mt-2 text-xs font-medium leading-6 text-fg-muted">
                  数分待っても届かないときは、迷惑メールのフォルダも確認してください。メールは30分だけ有効です。
                </p>
                <Button variant="secondary" fullWidth className="mt-4" icon={<Headphones size={16} aria-hidden />} onClick={() => restart('support')}>
                  メールが使えない
                </Button>
                <div className="mt-4 text-left"><SignedInDeviceGuide /></div>
              </>
            ) : (
              <>
                {requestCode && (
                  <div className="mt-4 rounded-card border border-accent/30 bg-accent-soft p-4">
                    <p className="text-xs font-bold text-accent">受付番号</p>
                    <p className="mt-1 select-all font-mono text-2xl font-black tracking-wider text-fg">{requestCode}</p>
                    <p className="mt-1 text-xs font-medium text-fg-muted">メモするか、画面を撮っておいてください。</p>
                  </div>
                )}
                <ol className="mt-4 space-y-2 text-left text-sm font-medium leading-6 text-fg">
                  <li className="flex gap-2"><span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent-soft text-xs font-bold text-accent">1</span>教室が登録内容を確認して、登録の電話番号などへ連絡します。</li>
                  <li className="flex gap-2"><span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent-soft text-xs font-bold text-accent">2</span>本人確認ができたら、新しいパスワードを決めるためのリンクが届きます。</li>
                  <li className="flex gap-2"><span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent-soft text-xs font-bold text-accent">3</span>急ぐときや問い合わせるときは、受付番号を伝えてください。</li>
                </ol>
                <p className="mt-3 text-xs font-medium leading-6 text-fg-muted">
                  安全のため、この申し込みだけでパスワードが自動で変わることはありません。
                </p>
                <a href="tel:0783214123" className="mt-4 inline-flex min-h-11 items-center gap-2 text-base font-bold text-fg">
                  <Phone size={18} aria-hidden /> 創造学園アプリ サポート窓口 078-321-4123
                </a>
              </>
            )}
            <ButtonLink href="/" variant="primary" fullWidth className="mt-6" icon={<ArrowLeft size={17} aria-hidden />}>
              ログインへ戻る
            </ButtonLink>
          </div>
        ) : (
          <>
            <div className="flex items-center gap-3">
              <div className="rounded-btn bg-accent-soft p-3 text-accent"><KeyRound size={24} aria-hidden /></div>
              <div>
                <h1 className="text-xl font-black text-fg">パスワードを忘れたとき</h1>
                <p className="mt-1 text-xs font-bold text-fg-muted">生徒・保護者・講師のどなたでも使えます</p>
              </div>
            </div>

            <div className="mt-5"><SignedInDeviceGuide /></div>

            <h2 className="mt-6 text-sm font-bold text-fg">ログイン中の端末がない場合</h2>
            <div className="mt-2 grid grid-cols-2 rounded-btn bg-slate-100 p-1" role="group" aria-label="再設定の方法">
              <button type="button" aria-pressed={mode === 'email'} onClick={() => restart('email')} className={`flex min-h-11 items-center justify-center gap-2 rounded-btn px-2 text-xs font-bold ${mode === 'email' ? 'bg-surface text-accent shadow-sm' : 'text-fg-muted'}`}>
                <Mail size={16} aria-hidden /> メールで再設定
              </button>
              <button type="button" aria-pressed={mode === 'support'} onClick={() => restart('support')} className={`flex min-h-11 items-center justify-center gap-2 rounded-btn px-2 text-xs font-bold ${mode === 'support' ? 'bg-surface text-accent shadow-sm' : 'text-fg-muted'}`}>
                <Headphones size={16} aria-hidden /> メールが使えない
              </button>
            </div>

            {mode === 'email' ? (
              <div className="mt-4 rounded-btn bg-sky-50 px-4 py-3 text-xs font-medium leading-5 text-sky-900">
                <p className="font-bold">メールで再設定できるのは、前もって『設定』で確認済みのメールを登録した人だけです。</p>
                <p className="mt-1">生徒は、つながっている保護者の確認済みメールでも再設定できます。登録していない（覚えていない）場合は『メールが使えない』から申し込んでください。</p>
              </div>
            ) : (
              <p className="mt-4 rounded-btn bg-amber-50 px-4 py-3 text-xs font-medium leading-5 text-amber-900">
                教室が本人確認をしてから、再設定の方法を連絡します。安全のため、IDや氏名だけでパスワードが自動で変わることはありません。
              </p>
            )}

            <form onSubmit={submit} className="mt-5 space-y-4">
              <label className="block">
                <span className="mb-1.5 block text-xs font-bold text-fg-muted">ログインID</span>
                <div className="relative">
                  <User className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} aria-hidden />
                  <input required maxLength={64} autoComplete="username" value={form.login_id} onChange={event => setForm({ ...form, login_id: event.target.value })} className={`${inputClass} pl-10 font-mono`} />
                </div>
              </label>
              <label className="block">
                <span className="mb-1.5 block text-xs font-bold text-fg-muted">氏名（登録されている表記）</span>
                <input required maxLength={64} autoComplete="name" value={form.name} onChange={event => setForm({ ...form, name: event.target.value })} className={inputClass} />
              </label>
              {mode === 'email' ? (
                <label className="block">
                  <span className="mb-1.5 block text-xs font-bold text-fg-muted">登録した確認済みメール（生徒は保護者のメールでも可）</span>
                  <div className="relative">
                    <Mail className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} aria-hidden />
                    <input required type="email" autoComplete="email" value={form.email} onChange={event => setForm({ ...form, email: event.target.value })} className={`${inputClass} pl-10`} />
                  </div>
                </label>
              ) : (
                <label className="block">
                  <span className="mb-1.5 block text-xs font-bold text-fg-muted">登録電話番号の下4桁（任意・生徒は保護者の電話でも可）</span>
                  <input inputMode="numeric" maxLength={4} value={form.phone_last4} onChange={event => setForm({ ...form, phone_last4: event.target.value.replace(/\D/g, '').slice(0, 4) })} placeholder="例: 4123" className={`${inputClass} font-mono`} />
                </label>
              )}
              {error && <p role="alert" className="text-sm font-bold text-danger">{error}</p>}
              <Button type="submit" size="lg" fullWidth loading={sending}>
                {mode === 'email' ? '再設定メールを送る' : '本人確認を申し込む'}
              </Button>
            </form>
            <ButtonLink href="/" variant="ghost" fullWidth className="mt-4" icon={<ArrowLeft size={16} aria-hidden />}>
              ログインへ戻る
            </ButtonLink>
          </>
        )}
      </div>
    </main>
  );
}
