'use client';

import { KeyRound, MailWarning } from 'lucide-react';

const LOGIN_EMAIL_DOMAINS = /^(.+)@(classbase\.local|sozogakuen\.co\.jp)$/i;

/** 画面に出すログインID。ログイン画面と同じく、作られたメール（ID@classbase.local など）の前半がID。 */
export function displayLoginId(profile: Record<string, any> | null | undefined, authEmail?: string | null) {
  const email = String(authEmail || '').trim();
  const synthetic = email.match(LOGIN_EMAIL_DOMAINS);
  if (synthetic) return synthetic[1];
  const stored = [profile?.lifetime_id, profile?.login_id, profile?.initial_login_id]
    .map(value => String(value ?? '').trim())
    .find(Boolean);
  return stored || email;
}

type Props = {
  loginId: string;
  /** 本人の確認済み再設定メールがあるか。 */
  hasVerifiedRecoveryEmail: boolean;
  /** 生徒は保護者の確認済みメールでも再設定できるため、案内を変える。 */
  audience?: 'student' | 'parent' | 'teacher';
};

/**
 * 設定のパスワード変更の近くに出す案内：自分のログインID、ログイン中は今のパスワードが要らないこと、
 * 再設定用メールが未登録ならその登録のすすめ。
 */
export default function SignedInPasswordHelp({ loginId, hasVerifiedRecoveryEmail, audience = 'teacher' }: Props) {
  return (
    <div className="space-y-3">
      <div>
        <p className="mb-1.5 text-xs font-bold text-fg-muted">あなたのログインID</p>
        <p className="min-h-11 select-all rounded-input border border-line bg-canvas px-3 py-2.5 font-mono text-sm font-bold tracking-wide text-fg">
          {loginId || '-'}
        </p>
      </div>
      <p className="flex gap-2 rounded-btn bg-sky-50 px-3 py-2.5 text-xs font-medium leading-5 text-sky-900">
        <KeyRound size={16} className="mt-0.5 shrink-0" aria-hidden />
        <span>ログイン中のこの端末では、<strong className="font-bold">今のパスワードを入れずに</strong>新しいパスワードを決められます。パスワードを忘れたときも、ログインしたままの端末があればここから変えてください。</span>
      </p>
      {!hasVerifiedRecoveryEmail && (
        <p role="note" className="flex gap-2 rounded-btn border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs font-medium leading-5 text-amber-900">
          <MailWarning size={16} className="mt-0.5 shrink-0" aria-hidden />
          <span>
            <strong className="font-bold">再設定用メールが未登録です。</strong>
            登録して確認しておくと、ログインできなくなったときにメールでパスワードを再設定できます（下の「再設定用メール」から登録できます）。
            {audience === 'student' && ' 保護者の方が確認済みメールを登録している場合は、そのメールでも再設定できます。'}
          </span>
        </p>
      )}
    </div>
  );
}
