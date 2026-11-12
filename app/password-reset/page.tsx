'use client';

import { FormEvent, useState } from 'react';
import { ArrowLeft, CheckCircle2, GraduationCap, Headphones, KeyRound, Mail, Phone, Smartphone, User } from 'lucide-react';
import { Button, ButtonLink } from '@/app/components/ui';
import { RECOVERY_GRADES } from '@/lib/password-recovery-match';
import { PASSWORD_SUPPORT_HOURS, PASSWORD_SUPPORT_PHONE, selfServicePasswordResetEnabled } from '@/lib/password-reset-availability';

type ResetMode = 'match' | 'email' | 'support';

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

/** セキュリティチェックが終わるまで：自分での再設定は止め、サポートセンターへの電話を案内する。 */
function PasswordResetPaused() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-canvas px-4 py-10">
      <div className="w-full max-w-md rounded-card border border-line bg-surface p-6 shadow-card sm:p-8">
        <div className="flex items-center gap-2 text-accent">
          <KeyRound size={22} aria-hidden />
          <h1 className="text-xl font-black text-fg">パスワードを忘れた方</h1>
        </div>
        <p className="mt-3 text-sm font-bold leading-7 text-fg">
          パスワードの再設定は、現在この画面からは受け付けていません。サポートセンターへお電話ください。
        </p>
        <a
          href={`tel:${PASSWORD_SUPPORT_PHONE.replace(/-/g, '')}`}
          className="mt-4 flex items-center justify-center gap-2 rounded-card border border-accent/30 bg-accent-soft px-4 py-4 text-accent"
        >
          <Phone size={20} aria-hidden />
          <span className="font-mono text-2xl font-black tracking-wider">{PASSWORD_SUPPORT_PHONE}</span>
        </a>
        <p className="mt-2 text-center text-xs font-bold text-fg-muted">サポートセンター　受付 {PASSWORD_SUPPORT_HOURS}</p>
        <p className="mt-3 text-xs font-medium leading-6 text-fg-muted">
          お電話の際は、ログインID（生徒番号）とお名前をお伝えください。
        </p>
        <div className="mt-4"><SignedInDeviceGuide /></div>
        <ButtonLink href="/" variant="ghost" fullWidth className="mt-4" icon={<ArrowLeft size={16} aria-hidden />}>
          ログインへ戻る
        </ButtonLink>
      </div>
    </main>
  );
}

export default function PasswordResetRequestPage() {
  return selfServicePasswordResetEnabled() ? <PasswordResetForm /> : <PasswordResetPaused />;
}

function PasswordResetForm() {
  const [mode, setMode] = useState<ResetMode>('match');
  const [form, setForm] = useState({ login_id: '', name: '', email: '', phone_last4: '', school: '', grade: '' });
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
            {mode === 'match' ? (
              <>
                <p className="mt-3 text-sm font-bold leading-7 text-fg">
                  入力した内容が登録と一致した場合は、入力したメールアドレスに再設定のリンクを送りました。
                </p>
                <p className="mt-2 text-xs font-medium leading-6 text-fg-muted">
                  数分待っても届かないときは、迷惑メールのフォルダも確認してください。リンクは10分だけ有効で、1回だけ使えます。安全のため、保護者の方とご本人のアプリ・LINEにも、再設定が申し込まれたことをお知らせします。
                </p>
                <Button variant="secondary" fullWidth className="mt-4" icon={<Headphones size={16} aria-hidden />} onClick={() => restart('support')}>
                  届かない・メールが使えない
                </Button>
              </>
            ) : mode === 'email' ? (
              <>
                <p className="mt-3 text-sm font-bold leading-7 text-fg">
                  確認済みメールを登録している場合だけ届きます。届かない場合は『メールが使えない』から申し込むか、教室へ連絡してください。
                </p>
                <p className="mt-2 text-xs font-medium leading-6 text-fg-muted">
                  数分待っても届かないときは、迷惑メールのフォルダも確認してください。リンクは10分だけ有効で、1回だけ使えます。
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
            <div className="mt-2 grid grid-cols-3 rounded-btn bg-slate-100 p-1" role="group" aria-label="再設定の方法">
              <button type="button" aria-pressed={mode === 'match'} onClick={() => restart('match')} className={`flex min-h-11 items-center justify-center gap-1.5 rounded-btn px-2 text-xs font-bold ${mode === 'match' ? 'bg-surface text-accent shadow-sm' : 'text-fg-muted'}`}>
                <GraduationCap size={16} aria-hidden /> 生徒・保護者
              </button>
              <button type="button" aria-pressed={mode === 'email'} onClick={() => restart('email')} className={`flex min-h-11 items-center justify-center gap-1.5 rounded-btn px-2 text-xs font-bold ${mode === 'email' ? 'bg-surface text-accent shadow-sm' : 'text-fg-muted'}`}>
                <Mail size={16} aria-hidden /> 講師
              </button>
              <button type="button" aria-pressed={mode === 'support'} onClick={() => restart('support')} className={`flex min-h-11 items-center justify-center gap-2 rounded-btn px-2 text-xs font-bold ${mode === 'support' ? 'bg-surface text-accent shadow-sm' : 'text-fg-muted'}`}>
                <Headphones size={16} aria-hidden /> メールが使えない
              </button>
            </div>

            {mode === 'match' ? (
              <div className="mt-4 rounded-btn bg-sky-50 px-4 py-3 text-xs font-medium leading-5 text-sky-900">
                <p className="font-bold">登録されている内容と一致すれば、入力したメールアドレスに再設定のリンクが届きます。</p>
                <p className="mt-1">保護者の方は、ご自身のログインID・氏名・電話番号と、お子さまの校舎・学年を入力してください。生徒は、電話番号に保護者の登録の電話番号も使えます。</p>
              </div>
            ) : mode === 'email' ? (
              <div className="mt-4 rounded-btn bg-sky-50 px-4 py-3 text-xs font-medium leading-5 text-sky-900">
                <p className="font-bold">講師は、前もって『設定』で確認済みのメールを登録した人だけ、メールで再設定できます。</p>
                <p className="mt-1">登録していない（覚えていない）場合は『メールが使えない』から申し込んでください。</p>
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
              {mode === 'match' && (
                <>
                  <div className="grid grid-cols-2 gap-3">
                    <label className="block">
                      <span className="mb-1.5 block text-xs font-bold text-fg-muted">校舎</span>
                      <input required maxLength={40} value={form.school} onChange={event => setForm({ ...form, school: event.target.value })} placeholder="例: 西明石" className={inputClass} />
                    </label>
                    <label className="block">
                      <span className="mb-1.5 block text-xs font-bold text-fg-muted">学年（保護者はお子さまの学年）</span>
                      <select required value={form.grade} onChange={event => setForm({ ...form, grade: event.target.value })} className={inputClass}>
                        <option value="">選ぶ</option>
                        {RECOVERY_GRADES.map(grade => <option key={grade} value={grade}>{grade}</option>)}
                      </select>
                    </label>
                  </div>
                  <label className="block">
                    <span className="mb-1.5 block text-xs font-bold text-fg-muted">登録電話番号の下4桁</span>
                    <input required inputMode="numeric" pattern="\d{4}" maxLength={4} value={form.phone_last4} onChange={event => setForm({ ...form, phone_last4: event.target.value.replace(/\D/g, '').slice(0, 4) })} placeholder="例: 4123" className={`${inputClass} font-mono`} />
                  </label>
                  <label className="block">
                    <span className="mb-1.5 block text-xs font-bold text-fg-muted">リンクを受け取るメールアドレス</span>
                    <div className="relative">
                      <Mail className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} aria-hidden />
                      <input required type="email" autoComplete="email" value={form.email} onChange={event => setForm({ ...form, email: event.target.value })} className={`${inputClass} pl-10`} />
                    </div>
                  </label>
                </>
              )}
              {mode === 'match' ? null : mode === 'email' ? (
                <label className="block">
                  <span className="mb-1.5 block text-xs font-bold text-fg-muted">登録した確認済みメール</span>
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
                {mode === 'support' ? '本人確認を申し込む' : '再設定メールを送る'}
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
