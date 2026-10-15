'use client';

import Link from 'next/link';
import { AlertTriangle, ArrowLeft, CheckCircle2, ChevronRight, ClipboardCheck, GraduationCap, HelpCircle, KeyRound, Loader2, LogIn, ShieldCheck, UserRound, UsersRound } from 'lucide-react';
import { useAuth } from '@/app/context/AuthContext';

const guides = [
  {
    id: 'student', title: '生徒', icon: GraduationCap, tone: 'indigo',
    start: 'ログイン後のホーム画面',
    steps: [
      '「今日の授業」で教科・時刻を確認し、開始時刻になったら参加します。',
      '宿題は対象教科・期限を確認し、画像を選んで提出完了表示まで待ちます。',
      '欠席・振替は対象日と講座を確認して送信し、履歴の状態を確認します。',
      '通知とお知らせを確認し、設定画面で必要な通知を有効にします。',
    ],
    trouble: '授業が表示されない場合は、日時・登録講座・振替状態を確認し、校舎へ連絡してください。Zoom URLを他の人から受け取って直接開かないでください。',
  },
  {
    id: 'parent', title: '保護者', icon: UserRound, tone: 'sky',
    start: '保護者ダッシュボード',
    steps: [
      '複数のお子さまがいる場合は、対象のお子さまを選択してから操作します。',
      '欠席・遅刻は対象日と理由を確認して送信します。振替は表示された候補から選びます。',
      '講座登録・変更は内容を確認し、完了後に履歴へ反映されたことを確認します。',
      'FAQで解決しない場合は「お問い合わせ」から送信し、回答通知と履歴を確認します。',
    ],
    trouble: '別のお子さまの情報が表示された場合は操作を止め、画面を再読み込みしてください。改善しない場合はサポートへ連絡してください。',
  },
  {
    id: 'teacher', title: '講師・職員', icon: UsersRound, tone: 'emerald',
    start: '講師ホーム／勤怠',
    steps: [
      '勤務開始前に勤務校舎を選び、出勤します。所属校舎以外でも実際の勤務校舎を選べます。',
      '退勤後、授業・事務・休憩などを5分単位で分け、まとめて保存します。交通費は金額、定期区間、または「なし」を登録します。',
      '打刻間違いは修正依頼、打刻自体がない日は打刻忘れ申請を使用し、承認状態を確認します。',
      '担当配置を確認し、当日の授業を開始します。他講師の代行開始時も必ず対象配置を確認します。',
    ],
    trouble: '打刻できない場合は時刻・勤務校舎・通信状態を記録し、障害時勤怠表へ残して承認者へ連絡してください。',
    extra: <Link href="/manual/attendance" className="mt-4 inline-flex items-center gap-2 rounded-xl bg-emerald-700 px-4 py-3 text-sm font-black text-white">勤怠登録の詳しい手順 <ChevronRight size={16} /></Link>,
  },
  {
    id: 'approver', title: '勤怠承認者', icon: ClipboardCheck, tone: 'amber',
    start: '勤務実績を承認／打刻修正を承認',
    steps: [
      '「承認待ち」で対象月・勤務校舎を確認します。所属校舎ではなく実際の勤務校舎が判断基準です。',
      '詳細を閉じたまま、日ごとの全選択または職員×日ごとの全選択ができます。必要な行だけ選択し「承認」します。',
      '時刻・詳細・交通費を直す場合は対象実績を開いて編集し、複数明細をまとめて保存します。誤った打刻は削除できます。',
      '理社講座の実績は校舎承認者が承認・編集できません。理社管理者へ引き継ぎます。',
    ],
    trouble: '他校舎の職員、理社講座、承認済み実績が操作できる場合は変更せず、対象者・日付・画面を記録してマスター管理者へ連絡してください。',
  },
  {
    id: 'admin', title: '校舎管理者', icon: ShieldCheck, tone: 'sky',
    start: '校舎運営ダッシュボード',
    steps: [
      'ダッシュボードで、自校舎の授業参加率・宿題提出率・小テスト実施率と「要確認」を確認します。',
      '要確認の生徒は「校舎別 生徒管理」で氏名・学年・受講状況を確認します。この画面は閲覧専用です。',
      '「月間予定」で授業日・休講日・行事を確認します。予定の登録や変更はマスター管理者へ依頼します。',
      '「シフト配置」で当日の講師配置を確認します。配置の変更はできません。',
    ],
    trouble: '数値が表示されない、生徒や予定が不足している場合は、校舎名・対象期間・生徒名を控えてマスター管理者へ連絡してください。',
  },
  {
    id: 'master', title: 'マスター管理者', icon: ShieldCheck, tone: 'rose',
    start: '管理アプリ選択',
    steps: [
      '作業目的に合う管理アプリを選び、対象校舎・月・役割を必ず絞り込みます。',
      '講師配置との不一致はマスターだけが、終了済み日付を確認し「該当実績へ」から未登録・詳細なし・通常誤登録・時間不一致を直します。',
      'アカウント、講座、配置、勤怠、通知の一括処理は、事前件数と処理後件数を記録します。',
      '給与確定前に修正依頼、未承認、単価未登録、重複、不一致アラートが0件であることを確認します。',
      '通知は対象ロール・校舎・チャネルを確認し、検証宛先で1件試してから本配信します。',
      'CSV出力・週次月次レポートは対象期間と母数を確認し、原本または手計算と突合します。',
    ],
    trouble: '一括処理の途中失敗、件数不一致、他校舎データ表示があれば再実行せず、時刻・条件・件数を記録して技術担当へ連絡してください。',
  },
] as const;

const tones: Record<string, string> = {
  indigo: 'border-indigo-200 bg-indigo-50 text-indigo-800',
  sky: 'border-sky-200 bg-sky-50 text-sky-800',
  emerald: 'border-emerald-200 bg-emerald-50 text-emerald-800',
  amber: 'border-amber-200 bg-amber-50 text-amber-900',
  rose: 'border-rose-200 bg-rose-50 text-rose-900',
};

export default function ManualIndexPage() {
  const { user, profile, loading } = useAuth();

  if (loading) return <main className="grid min-h-screen place-items-center bg-slate-50"><div className="flex items-center gap-3 text-sm font-black text-slate-600"><Loader2 className="animate-spin" />マニュアルを確認しています</div></main>;

  if (!user || !profile) return <CommonLoginManual />;

  const role = String(profile.role || '').toLowerCase();
  const isAttendanceApprover = profile.attendance_school_manager === true || ['attendance_admin', 'attendance_only', 'attendance_manager'].includes(role) || profile.admin_permissions?.attendance === true;
  const allowedGuideIds = new Set<string>(
    role === 'student' ? ['student']
      : role === 'parent' ? ['parent']
        : role === 'teacher' ? ['teacher', ...(isAttendanceApprover ? ['approver'] : [])]
          : role === 'master' ? ['master', ...(isAttendanceApprover ? ['approver'] : [])]
            : ['admin']
  );
  const visibleGuides = guides.filter(guide => allowedGuideIds.has(guide.id));

  return <main className="min-h-screen bg-slate-50 px-4 py-6 text-slate-900 sm:px-6">
    <div className="mx-auto max-w-4xl space-y-6">
      <header className="rounded-3xl bg-slate-950 p-6 text-white shadow-xl sm:p-9">
        <Link href={role === 'student' ? '/student' : role === 'parent' ? '/parent' : role === 'teacher' ? '/teacher' : '/master'} className="inline-flex items-center gap-1 text-xs font-black text-slate-300"><ArrowLeft size={15} />アプリへ戻る</Link>
        <p className="mt-7 text-xs font-black tracking-[0.18em] text-indigo-300">SOZO GAKUEN APP</p>
        <h1 className="mt-2 text-3xl font-black">あなたの操作マニュアル</h1>
        <p className="mt-3 max-w-2xl text-sm font-bold leading-7 text-slate-300">ログイン中の役割で使用できる手順だけを表示しています。上から順に操作し、画面にない対象は推測で処理しないでください。</p>
      </header>

      <nav aria-label="役割を選ぶ" className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        {visibleGuides.map(guide => <a key={guide.id} href={`#${guide.id}`} className={`rounded-2xl border p-4 text-center text-xs font-black shadow-sm ${tones[guide.tone]}`}>{guide.title}</a>)}
      </nav>

      {visibleGuides.map(guide => {
        const Icon = guide.icon;
        return <section key={guide.id} id={guide.id} className="scroll-mt-5 rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-7">
          <div className="flex items-start gap-3"><div className={`grid h-12 w-12 shrink-0 place-items-center rounded-2xl border ${tones[guide.tone]}`}><Icon size={24} /></div><div><h2 className="text-xl font-black">{guide.title}</h2><p className="mt-1 text-xs font-bold text-slate-500">開始画面：{guide.start}</p></div></div>
          <ol className="mt-5 space-y-3">{guide.steps.map((step, index) => <li key={step} className="flex gap-3 rounded-2xl bg-slate-50 p-4 text-sm font-bold leading-6 text-slate-700"><span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-slate-900 text-xs text-white">{index + 1}</span><span>{step}</span></li>)}</ol>
          {'extra' in guide ? guide.extra : null}
          <div className="mt-4 flex gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4"><AlertTriangle className="mt-0.5 shrink-0 text-amber-600" size={19} /><div><p className="text-xs font-black text-amber-900">うまくいかないとき</p><p className="mt-1 text-xs font-bold leading-6 text-amber-800">{guide.trouble}</p></div></div>
        </section>;
      })}

      <section className="rounded-3xl border border-indigo-200 bg-indigo-50 p-6">
        <h2 className="flex items-center gap-2 text-lg font-black text-indigo-950"><HelpCircle size={21} />問い合わせ前の確認</h2>
        <ul className="mt-4 space-y-2 text-sm font-bold leading-6 text-indigo-900">
          <li>1. 画面を再読み込みし、同じ操作を何度も連打しない。</li>
          <li>2. 校舎、役割、氏名、対象日、発生時刻、操作名を控える。</li>
          <li>3. 個人情報・パスワード・URL中のトークンが写る画像は共有しない。</li>
          <li>4. 生徒・保護者は校舎へ、職員は担当管理者へ、管理者は運用窓口へ連絡する。</li>
        </ul>
      </section>

      <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="flex items-center gap-2 text-lg font-black text-slate-900"><HelpCircle size={21} />よくある質問</h2>
        <div className="mt-4 space-y-3 text-sm font-bold text-slate-700">
          <details className="rounded-2xl bg-slate-50 p-4"><summary className="cursor-pointer font-black">カレンダーの色は何を表しますか？</summary><p className="mt-2 leading-7 text-slate-600">青は授業実施日、赤は休み・休講・休館日、緑は模試などのその他予定です。予定がない日を自動で休みとは判定しません。</p></details>
          <details className="rounded-2xl bg-slate-50 p-4"><summary className="cursor-pointer font-black">AIチャットと先生への連絡はどう違いますか？</summary><p className="mt-2 leading-7 text-slate-600">AIチューターの通常入力はAI宛です。先生との欄から送ると担当講師へ届きます。AI会話を共有するときだけ「先生へ報告」を使用します。</p></details>
          <details className="rounded-2xl bg-slate-50 p-4"><summary className="cursor-pointer font-black">LINE通知が届きません</summary><p className="mt-2 leading-7 text-slate-600">設定画面で「連携済み」を確認し、LINE公式アカウントのブロック解除と端末の通知設定を確認してください。別のLINEへ変える場合は一度解除して連携し直します。</p></details>
          <details className="rounded-2xl bg-slate-50 p-4"><summary className="cursor-pointer font-black">処理できたか分からないときは？</summary><p className="mt-2 leading-7 text-slate-600">完了表示、履歴、件数を確認してください。反映されない場合は同じ操作を連打せず、対象と発生時刻を控えて問い合わせてください。</p></details>
        </div>
      </section>

      <footer className="flex items-center justify-center gap-2 py-4 text-xs font-bold text-slate-500"><CheckCircle2 size={16} />操作後は必ず完了表示・履歴・件数を確認してください。</footer>
    </div>
  </main>;
}

function CommonLoginManual() {
  const steps = [
    { icon: LogIn, title: 'ログインする', body: '案内書面のログインIDとパスワードを入力します。スペースや全角・半角、英字の入力を確認してください。' },
    { icon: KeyRound, title: '初回パスワードを変更する', body: '初回ログイン後は自動的に変更画面が開きます。6文字以上の、他人に推測されないパスワードを設定します。' },
    { icon: HelpCircle, title: 'ログインできないとき', body: '画面を再読み込みし、通信を確認します。パスワードが不明な場合は「パスワードを忘れた方」を使用してください。' },
  ];
  return <main className="min-h-screen bg-slate-50 px-4 py-6 text-slate-900 sm:px-6"><div className="mx-auto max-w-3xl space-y-6">
    <header className="rounded-3xl bg-slate-950 p-6 text-white shadow-xl sm:p-9"><Link href="/" className="inline-flex items-center gap-1 text-xs font-black text-slate-300"><ArrowLeft size={15} />ログイン画面へ</Link><p className="mt-7 text-xs font-black tracking-[0.18em] text-indigo-300">SOZO GAKUEN APP</p><h1 className="mt-2 text-3xl font-black">共通 ログインマニュアル</h1><p className="mt-3 text-sm font-bold leading-7 text-slate-300">ログイン前は全利用者共通の手順だけを表示しています。生徒・保護者・職員・管理者ごとの操作マニュアルは、ログイン後に表示されます。</p></header>
    <section className="space-y-3">{steps.map((step, index) => { const Icon = step.icon; return <article key={step.title} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><div className="flex gap-4"><div className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-indigo-100 font-black text-indigo-800">{index + 1}</div><div><h2 className="flex items-center gap-2 text-base font-black"><Icon size={19} />{step.title}</h2><p className="mt-2 text-sm font-bold leading-7 text-slate-600">{step.body}</p></div></div></article>; })}</section>
    <div className="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm font-bold leading-7 text-amber-900"><p className="font-black">問い合わせ時に伝える内容</p><p className="mt-1">校舎、氏名、種別（生徒・保護者・職員）、端末、発生時刻、表示された文言を伝えてください。パスワードやURL内のトークンは送らないでください。</p></div>
    <Link href="/" className="flex min-h-12 items-center justify-center rounded-xl bg-indigo-700 px-5 py-3 text-sm font-black text-white">ログイン画面を開く</Link>
  </div></main>;
}
