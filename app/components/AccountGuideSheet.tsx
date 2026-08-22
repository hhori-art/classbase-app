import ReadablePassword from '@/app/components/ReadablePassword';

export const ACCOUNT_GUIDE_PRINT_CSS = `
  @media print {
    @page { size: A4 portrait; margin: 0; }
    .account-guide-print-root {
      position: static !important;
      display: block !important;
      width: 100% !important;
      height: auto !important;
      overflow: visible !important;
      background: white !important;
    }
    .account-guide-print-hide { display: none !important; }
    .account-guide-print-page {
      display: block !important;
      position: relative !important;
      width: 210mm !important;
      height: 297mm !important;
      min-height: 297mm !important;
      margin: 0 !important;
      padding: 11mm 16mm !important;
      box-sizing: border-box !important;
      break-after: page !important;
      page-break-after: always !important;
      break-inside: avoid !important;
      page-break-inside: avoid !important;
      overflow: hidden !important;
      box-shadow: none !important;
      border: 0 !important;
      background: white !important;
    }
    .account-guide-print-page:last-child {
      break-after: auto !important;
      page-break-after: auto !important;
    }
    * {
      -webkit-print-color-adjust: exact !important;
      print-color-adjust: exact !important;
    }
  }
`;

type AccountGuideSheetProps = {
  account: Record<string, any>;
  school?: string;
  loginUrl: string;
};

const displayValue = (value: unknown, fallback = '-') => {
  const text = String(value || '').trim();
  return text || fallback;
};

export default function AccountGuideSheet({ account, school = '', loginUrl }: AccountGuideSheetProps) {
  const isStudent = account.role === 'student';
  const isTeacher = ['teacher', 'attendance_admin', 'attendance_only', 'attendance_manager'].includes(String(account.role || ''));
  const name = displayValue(account.student_name || account.name || account.teacher_name, '名称未設定');
  const loginId = displayValue(account.lifetime_id || account.initial_login_id || account.email);
  const password = displayValue(account.initial_password || account.raw_password);
  const parentLoginId = displayValue(account.parent_login_id, '');
  const parentPassword = displayValue(account.parent_initial_password, '');
  const hasParentAccount = isStudent && Boolean(parentLoginId || parentPassword);
  const normalizedLoginUrl = displayValue(loginUrl, 'https://classbase-app.vercel.app');
  const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(normalizedLoginUrl)}`;
  const today = new Date();
  const issuedAt = `${today.getFullYear()}年${today.getMonth() + 1}月${today.getDate()}日`;
  const accountKind = isStudent ? '生徒' : isTeacher ? '講師' : '管理者';
  const courseSummary = [
    account.grade,
    account.day_of_week ? `${String(account.day_of_week).replace('曜日', '')}曜日` : '',
    account.subject_science ? `理科: ${account.subject_science}` : '',
    account.subject_social ? `社会: ${account.subject_social}` : '',
  ].filter(Boolean);

  return (
    <article
      className="account-guide-print-page relative overflow-hidden bg-white text-slate-900 shadow-xl"
      style={{ width: '210mm', height: '297mm', padding: '11mm 16mm' }}
    >
      <div className="flex items-center justify-between text-[10px] font-bold text-slate-500">
        <span>{displayValue(school || account.school_id || account.school || account.classroom, '創造学園')}</span>
        <span>発行日: {issuedAt}</span>
      </div>

      <header className="mt-2 flex items-center justify-center gap-3 rounded-2xl border-2 border-blue-100 bg-blue-50 px-5 py-3">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/icon.png" alt="" className="h-10 w-10 rounded-xl border border-white shadow-sm" />
        <div>
          <p className="text-[10px] font-black tracking-[0.2em] text-blue-500">SOZO GAKUEN APP</p>
          <h1 className="text-xl font-black text-blue-900">創造学園アプリ 初回ログインのご案内</h1>
        </div>
      </header>

      <section className="mt-4 px-2">
        <p className="text-lg font-black text-slate-800">
          {name} <span className="text-sm">{isStudent ? 'さん・保護者 様' : isTeacher ? '先生' : '様'}</span>
        </p>
        <p className="mt-1.5 text-[12px] font-bold leading-relaxed text-slate-600">
          創造学園アプリの{accountKind}アカウントをご用意しました。下記のIDと初期パスワードでログインしてください。
        </p>
      </section>

      <section className="mt-4 rounded-3xl border-4 border-blue-50 p-4">
        <div className="flex items-stretch gap-4">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-black text-blue-800">{accountKind}アカウント</p>
            <div className="mt-3 grid grid-cols-[130px_1fr] gap-x-3 gap-y-2">
              <GuideLabel>ログインID</GuideLabel>
              <GuideValue value={loginId} />
              <GuideLabel>初期パスワード</GuideLabel>
              <div className="min-w-0"><ReadablePassword value={password === '-' ? '' : password} compact /></div>
            </div>
          </div>
          <div className="flex w-36 shrink-0 flex-col items-center justify-center rounded-2xl border-2 border-blue-100 bg-blue-50 p-3 text-center">
            <p className="mb-1 text-[10px] font-black text-blue-800">ログインはこちら</p>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={qrUrl} alt="ログイン用QRコード" className="h-24 w-24 bg-white" crossOrigin="anonymous" />
            <p className="mt-1 text-[9px] font-bold text-slate-500">カメラで読み取れます</p>
          </div>
        </div>

        <div className="mt-3 rounded-xl border border-indigo-100 bg-indigo-50/70 px-3 py-2">
          <p className="text-[9px] font-black text-indigo-600">ログインURL</p>
          <p className="break-all font-mono text-[12px] font-black leading-tight text-indigo-900">{normalizedLoginUrl}</p>
        </div>
      </section>

      {isStudent && (
        <section className="mt-4 grid grid-cols-2 gap-3">
          <div className="rounded-2xl border-2 border-slate-100 p-3">
            <p className="text-xs font-black text-slate-700">受講情報</p>
            <p className="mt-2 text-[11px] font-bold leading-relaxed text-slate-600">
              {courseSummary.length > 0 ? courseSummary.join(' / ') : '受講情報はアプリ内でご確認ください。'}
            </p>
            {(account.middle_school || account.course_start_month) && (
              <p className="mt-1 text-[10px] font-bold text-slate-400">
                {[account.middle_school, account.course_start_month && `開始: ${account.course_start_month}`].filter(Boolean).join(' / ')}
              </p>
            )}
          </div>

          <div className="rounded-2xl border-2 border-slate-100 p-3">
            <p className="text-xs font-black text-slate-700">保護者アカウント</p>
            {hasParentAccount ? (
              <div className="mt-2 space-y-1.5 text-[10px] font-bold text-slate-500">
                <p>ログインID: <span className="font-mono text-[12px] font-black text-slate-800">{parentLoginId || '-'}</span></p>
                <div className="flex items-start gap-2">
                  <span className="shrink-0 pt-2">初期パスワード:</span>
                  <ReadablePassword value={parentPassword} compact />
                </div>
              </div>
            ) : (
              <p className="mt-2 text-[11px] font-bold text-slate-500">保護者アカウントが発行されている場合は、別途ご案内します。</p>
            )}
          </div>
        </section>
      )}

      <section className="mt-4 rounded-2xl border-2 border-emerald-100 bg-emerald-50/60 p-3">
        <p className="text-xs font-black text-emerald-800">初回ログインの手順</p>
        <ol className="mt-2 grid grid-cols-3 gap-3 text-[10px] font-bold leading-relaxed text-slate-700">
          <li><b className="mr-1 text-emerald-700">1.</b>QRコードを読み取るか、ログインURLを開きます。</li>
          <li><b className="mr-1 text-emerald-700">2.</b>記載されたIDと初期パスワードを入力します。</li>
          <li><b className="mr-1 text-emerald-700">3.</b>画面の案内に沿って新しいパスワードを設定します。</li>
        </ol>
      </section>

      <section className="mt-3 rounded-2xl border-2 border-amber-100 bg-amber-50/60 p-3">
        <p className="text-xs font-black text-amber-800">大切なお願い</p>
        <ul className="mt-1.5 space-y-1 text-[10px] font-bold leading-relaxed text-slate-700">
          <li>・IDとパスワードは第三者に知られないよう、大切に保管してください。</li>
          <li>・パスワード入力時は、書面上の区切り用スペースを入力する必要はありません。</li>
          <li>・ログインできない場合は、入力文字の大文字・小文字と数字をご確認ください。</li>
        </ul>
      </section>

      <footer className="absolute bottom-[11mm] left-[16mm] right-[16mm] flex items-end justify-between border-t-2 border-blue-100 pt-2">
        <div className="text-[9px] font-bold leading-relaxed text-slate-500">
          <p>※本用紙は大切に保管してください。</p>
          <p>お問い合わせ先：理社講座サポートセンター（078-321-4123）</p>
        </div>
        <p className="text-lg font-black tracking-widest text-blue-900">創造学園エディック</p>
      </footer>
    </article>
  );
}

function GuideLabel({ children }: { children: React.ReactNode }) {
  return <p className="self-center text-[10px] font-black text-slate-500">{children}</p>;
}

function GuideValue({ value }: { value: string }) {
  return (
    <p className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap rounded-xl border border-blue-100 bg-blue-50 px-3 py-2 font-mono text-lg font-black tracking-wider text-slate-900" title={value}>
      {value}
    </p>
  );
}
