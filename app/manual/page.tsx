'use client';

import Link from 'next/link';
import { AlertTriangle, ArrowLeft, CheckCircle2, HelpCircle, Info, KeyRound, Loader2, LogIn } from 'lucide-react';
import { useAuth } from '@/app/context/AuthContext';
import { manualGuidesFor, type ManualGuide } from './manual-content';

const TONES: Record<ManualGuide['tone'], { chip: string; icon: string; ring: string }> = {
  indigo: { chip: 'bg-indigo-50 text-indigo-800 border-indigo-200', icon: 'bg-indigo-600', ring: 'border-indigo-100' },
  sky: { chip: 'bg-sky-50 text-sky-800 border-sky-200', icon: 'bg-sky-600', ring: 'border-sky-100' },
  emerald: { chip: 'bg-emerald-50 text-emerald-800 border-emerald-200', icon: 'bg-emerald-600', ring: 'border-emerald-100' },
  amber: { chip: 'bg-amber-50 text-amber-900 border-amber-200', icon: 'bg-amber-500', ring: 'border-amber-100' },
  rose: { chip: 'bg-rose-50 text-rose-900 border-rose-200', icon: 'bg-rose-600', ring: 'border-rose-100' },
  violet: { chip: 'bg-violet-50 text-violet-800 border-violet-200', icon: 'bg-violet-600', ring: 'border-violet-100' },
  slate: { chip: 'bg-slate-50 text-slate-800 border-slate-200', icon: 'bg-slate-800', ring: 'border-slate-200' },
};

export default function ManualIndexPage() {
  const { user, profile, loading } = useAuth();

  if (loading) return <main className="grid min-h-screen place-items-center bg-slate-50"><div className="flex items-center gap-3 text-sm font-bold text-slate-600"><Loader2 className="animate-spin" />マニュアルを確認しています</div></main>;
  if (!user || !profile) return <CommonLoginManual />;

  const guides = manualGuidesFor(profile);
  const backHref = guides[0]?.home || '/';

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-6 text-slate-900 sm:px-6">
      <div className="mx-auto max-w-4xl space-y-6">
        <header className="rounded-3xl bg-slate-950 p-6 text-white shadow-xl sm:p-9">
          <Link href={backHref} className="inline-flex items-center gap-1 text-xs font-bold text-slate-300 hover:text-white"><ArrowLeft size={15} />アプリへ戻る</Link>
          <p className="mt-7 text-xs font-bold tracking-[0.18em] text-indigo-300">SOZO GAKUEN APP</p>
          <h1 className="mt-2 text-3xl font-black">操作マニュアル</h1>
          <p className="mt-3 max-w-2xl text-sm font-bold leading-7 text-slate-300">
            {guides.map(guide => guide.title).join('・')}のアカウントで使う手順です。ボタン名は画面の表示と同じ「」で書いています。
          </p>
        </header>

        {guides.map(guide => <GuideSection key={guide.id} guide={guide} />)}

        <section className="rounded-3xl border border-indigo-200 bg-indigo-50 p-6">
          <h2 className="flex items-center gap-2 text-lg font-bold text-indigo-950"><HelpCircle size={21} />問い合わせる前に</h2>
          <ul className="mt-4 space-y-2 text-sm font-bold leading-6 text-indigo-900">
            <li>1. 画面を再読み込みし、同じ操作を何度も押さない。</li>
            <li>2. 校舎・氏名・対象日・発生時刻・操作した画面と表示された文言を控える。</li>
            <li>3. パスワードやURL内の文字列が写った画像は共有しない。</li>
            <li>4. 生徒・保護者は校舎へ、職員は勤怠承認者・担当管理者へ、管理者はマスター管理者へ連絡する。</li>
          </ul>
        </section>

        <footer className="flex items-center justify-center gap-2 py-4 text-xs font-bold text-slate-500"><CheckCircle2 size={16} />操作のあとは、完了の表示や履歴で反映されたことを確認してください。</footer>
      </div>
    </main>
  );
}

function GuideSection({ guide }: { guide: ManualGuide }) {
  const tone = TONES[guide.tone];
  const Icon = guide.icon;
  return (
    <section id={guide.id} className={`scroll-mt-5 rounded-3xl border bg-white p-5 shadow-sm sm:p-7 ${tone.ring}`}>
      <div className="flex items-start gap-3">
        <div className={`grid h-12 w-12 shrink-0 place-items-center rounded-2xl text-white ${tone.icon}`}><Icon size={24} /></div>
        <div>
          <h2 className="text-xl font-black">{guide.title}</h2>
          <p className="mt-1 text-sm font-bold leading-6 text-slate-500">{guide.lead}</p>
        </div>
      </div>

      <nav aria-label={`${guide.title}の目次`} className="mt-5 flex flex-wrap gap-2">
        {guide.chapters.map((chapter, index) => (
          <a key={chapter.id} href={`#${guide.id}-${chapter.id}`} className={`rounded-full border px-3 py-1.5 text-xs font-bold ${tone.chip}`}>
            {index + 1}. {chapter.title}
          </a>
        ))}
      </nav>

      <div className="mt-6 space-y-5">
        {guide.chapters.map((chapter, index) => {
          const ChapterIcon = chapter.icon;
          return (
            <article key={chapter.id} id={`${guide.id}-${chapter.id}`} className="scroll-mt-5 rounded-2xl border border-slate-100 bg-slate-50/70 p-4 sm:p-5">
              <div className="flex flex-wrap items-center gap-2">
                <span className="grid h-7 w-7 place-items-center rounded-full bg-slate-900 text-xs font-bold text-white">{index + 1}</span>
                <h3 className="flex items-center gap-1.5 text-base font-bold text-slate-900"><ChapterIcon size={17} />{chapter.title}</h3>
                {chapter.optional && <span className="rounded-full bg-white px-2 py-0.5 text-[11px] font-bold text-slate-500 ring-1 ring-slate-200">表示されている場合</span>}
              </div>
              <p className="mt-1.5 pl-9 text-xs font-bold text-slate-500">開く場所：{chapter.where}</p>
              <ol className="mt-3 space-y-2 pl-9">
                {chapter.steps.map((step, stepIndex) => (
                  <li key={stepIndex} className="relative text-sm font-bold leading-6 text-slate-700">
                    <span className="absolute -left-5 top-0 text-xs font-bold text-slate-400">{stepIndex + 1}</span>{step}
                  </li>
                ))}
              </ol>
              {chapter.rules && (
                <div className="mt-3 ml-9 flex gap-2 rounded-xl bg-white p-3 ring-1 ring-slate-200">
                  <Info size={16} className="mt-0.5 shrink-0 text-indigo-500" />
                  <ul className="space-y-1 text-xs font-bold leading-6 text-slate-600">{chapter.rules.map(rule => <li key={rule}>{rule}</li>)}</ul>
                </div>
              )}
            </article>
          );
        })}
      </div>

      <div className="mt-5 flex gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4">
        <AlertTriangle className="mt-0.5 shrink-0 text-amber-600" size={19} />
        <div>
          <p className="text-xs font-bold text-amber-900">うまくいかないとき</p>
          <ul className="mt-1 space-y-1 text-xs font-bold leading-6 text-amber-800">{guide.trouble.map(item => <li key={item}>{item}</li>)}</ul>
        </div>
      </div>
    </section>
  );
}

function CommonLoginManual() {
  const steps = [
    { icon: LogIn, title: 'ログインする', body: 'ID書面の「ログインID」と「はじめのパスワード」を入力し、「ログイン」を押します。保護者のIDはお子さまのIDの末尾に「P」が付いたものです。全角・半角や大文字・小文字を確認してください。' },
    { icon: KeyRound, title: 'はじめてのパスワード変更', body: '初回ログイン後は「新しいパスワードを設定」画面が開きます。生徒・保護者・講師は6文字以上、管理者は10文字以上で、他の人に推測されないパスワードを設定します。' },
    { icon: HelpCircle, title: 'ログインできないとき', body: '画面を再読み込みし、通信を確認します。パスワードがわからない場合は「パスワードを忘れた方」を使うか、校舎へ連絡してください。' },
  ];
  return <main className="min-h-screen bg-slate-50 px-4 py-6 text-slate-900 sm:px-6"><div className="mx-auto max-w-3xl space-y-6">
    <header className="rounded-3xl bg-slate-950 p-6 text-white shadow-xl sm:p-9"><Link href="/" className="inline-flex items-center gap-1 text-xs font-bold text-slate-300"><ArrowLeft size={15} />ログイン画面へ</Link><p className="mt-7 text-xs font-bold tracking-[0.18em] text-indigo-300">SOZO GAKUEN APP</p><h1 className="mt-2 text-3xl font-black">共通 ログインマニュアル</h1><p className="mt-3 text-sm font-bold leading-7 text-slate-300">ログイン前は全員共通の手順だけを表示しています。生徒・保護者・講師・管理者ごとの操作マニュアルは、ログイン後にこのページで表示されます。</p></header>
    <section className="space-y-3">{steps.map((step, index) => { const Icon = step.icon; return <article key={step.title} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><div className="flex gap-4"><div className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-indigo-100 font-bold text-indigo-800">{index + 1}</div><div><h2 className="flex items-center gap-2 text-base font-bold"><Icon size={19} />{step.title}</h2><p className="mt-2 text-sm font-bold leading-7 text-slate-600">{step.body}</p></div></div></article>; })}</section>
    <div className="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm font-bold leading-7 text-amber-900"><p className="font-bold">問い合わせるときに伝える内容</p><p className="mt-1">校舎、氏名、種別（生徒・保護者・講師・管理者）、端末、発生時刻、表示された文言を伝えてください。パスワードやURL内の文字列は送らないでください。</p></div>
    <Link href="/" className="flex min-h-12 items-center justify-center rounded-xl bg-indigo-700 px-5 py-3 text-sm font-bold text-white">ログイン画面を開く</Link>
  </div></main>;
}
