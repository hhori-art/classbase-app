'use client';

import Link from 'next/link';
import {
  AlertTriangle,
  ArrowRight,
  BriefcaseBusiness,
  CheckCircle2,
  ChevronDown,
  Clock3,
  FilePenLine,
  LogIn,
  Loader2,
  LogOut,
} from 'lucide-react';
import { useAuth } from '@/app/context/AuthContext';

const workTypes = [
  ['授業', '授業を担当した時間'],
  ['事務', '授業以外の事務作業を行った時間'],
  ['サブ（サポート）', 'サポート業務を行った時間（給与上は「サブ」）'],
  ['その他', '上記に当てはまらない業務。具体的な内容も入力します'],
  ['休憩', '勤務時間に含まれない休憩時間'],
];

export default function AttendanceManualPage() {
  const { user, profile, loading } = useAuth();
  if (loading) return <main className="grid min-h-screen place-items-center bg-slate-50"><div className="flex items-center gap-3 text-sm font-black text-slate-600"><Loader2 className="animate-spin" />マニュアルを確認しています</div></main>;
  if (!user || profile?.role !== 'teacher') return <main className="grid min-h-screen place-items-center bg-slate-50 px-5"><div className="max-w-md rounded-2xl border border-slate-200 bg-white p-7 text-center shadow-sm"><h1 className="text-xl font-black text-slate-950">ログイン後に表示されます</h1><p className="mt-3 text-sm font-bold leading-7 text-slate-600">勤怠登録マニュアルは講師・職員用です。ログイン前は共通ログインマニュアルをご覧ください。</p><Link href="/manual" className="mt-5 inline-flex min-h-12 items-center justify-center rounded-xl bg-indigo-700 px-5 py-3 text-sm font-black text-white">共通マニュアルへ</Link></div></main>;
  return (
    <main className="min-h-screen bg-slate-50 text-slate-900">
      <header className="border-b border-cyan-100 bg-gradient-to-br from-cyan-700 via-blue-700 to-indigo-800 text-white">
        <div className="mx-auto max-w-3xl px-5 py-9 sm:px-8 sm:py-12">
          <p className="text-xs font-black tracking-[0.2em] text-cyan-100">SOZO GAKUEN APP</p>
          <h1 className="mt-2 font-black leading-tight">
            <span className="block text-2xl sm:text-3xl">講師向け</span>
            <span className="mt-1 block whitespace-nowrap text-[29px] sm:text-4xl">勤怠登録マニュアル</span>
          </h1>
          <p className="mt-2 text-lg font-black text-cyan-100 sm:text-xl">創造学園 共通</p>
          <p className="mt-4 max-w-2xl text-sm font-bold leading-relaxed text-blue-100 sm:text-base">
            創造学園での打刻・勤務詳細・交通費を登録する共通アプリです。初めての方は「1 初回ログイン」から順に進んでください。
          </p>
        </div>
      </header>

      <div className="mx-auto max-w-3xl px-5 py-7 sm:px-8 sm:py-10">
        <Link href="/manual" className="mb-5 inline-flex items-center gap-2 text-sm font-black text-indigo-700"><ArrowRight className="rotate-180" size={17} />あなたのマニュアルへ戻る</Link>
        <section className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-4 sm:px-5">
          <div className="flex items-start gap-3">
            <CheckCircle2 className="mt-0.5 shrink-0 text-emerald-600" size={22} />
            <div>
              <h2 className="text-base font-black text-emerald-950">登録の流れは通常の勤怠システムと同じです</h2>
              <p className="mt-1 text-xs font-bold leading-relaxed text-emerald-800 sm:text-sm">下の手順を押すと、詳しい操作方法が開きます。</p>
            </div>
          </div>
        </section>

        <section className="mt-5 space-y-3" aria-label="勤怠登録の手順">
          <ManualStep number="1" icon={<LogIn size={22} />} title="初回ログイン" summary="職員番号と初期パスワードでログインします">
            <ol className="space-y-3">
              <DetailItem number="1">案内書面の「ログインID（職員番号）」と「初期パスワード」を準備します。</DetailItem>
              <DetailItem number="2">下の「ログイン画面を開く」を押し、職員番号と初期パスワードを入力します。</DetailItem>
              <DetailItem number="3">ログイン後は自動的にパスワード変更画面へ進みます。自分だけが分かる新しいパスワードを設定してください。</DetailItem>
            </ol>
            <Link href="/" className="mt-5 inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-blue-700 px-5 py-3 text-sm font-black text-white shadow-sm transition hover:bg-blue-800 sm:w-auto">
              ログイン画面を開く <ArrowRight size={17} />
            </Link>
          </ManualStep>

          <ManualStep number="2" icon={<LogIn size={22} />} title="出勤する" summary="勤務を始める直前に打刻します">
            <p>勤務を始める直前に勤怠画面を開き、「出勤する」を押します。確認画面で確定すると、その時刻が記録されます。</p>
          </ManualStep>

          <ManualStep number="3" icon={<LogOut size={22} />} title="退勤する" summary="すべての勤務が終わったら打刻します">
            <p>すべての勤務が終わった時点で「退勤する」を押します。押し忘れを防ぐため、帰宅前に記録を確認してください。</p>
          </ManualStep>

          <ManualStep number="4" icon={<BriefcaseBusiness size={22} />} title="勤務詳細・交通費を入力" summary="退勤後に業務区分と時間を登録します">
            <p>当日の履歴にある「詳細・交通費を入力」を押し、業務ごとの開始・終了時刻と区分を入力します。</p>
            <p className="mt-3">交通費がある場合は、交通機関、経路、出発・到着、片道・往復と金額を入力します。</p>
          </ManualStep>

          <ManualStep number="5" icon={<CheckCircle2 size={22} />} title="確認して保存" summary="時間の空白・重複がないか確認します">
            <p>入力した業務時間に空白や重複がないことを確認し、「保存して完了」を押します。保存完了の表示が出るまで確認してください。</p>
          </ManualStep>
        </section>

        <section className="mt-8">
          <h2 className="mb-3 text-sm font-black tracking-wide text-slate-500">必要なときに確認</h2>
          <div className="space-y-3">
            <ReferenceDetails icon={<Clock3 size={21} />} title="業務区分の選び方">
              <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
                {workTypes.map(([label, description], index) => (
                  <div key={label} className={`grid gap-1 px-4 py-3 sm:grid-cols-[170px_1fr] ${index > 0 ? 'border-t border-slate-100' : ''}`}>
                    <p className="text-sm font-black text-blue-800">{label}</p>
                    <p className="text-sm font-bold leading-relaxed text-slate-600">{description}</p>
                  </div>
                ))}
              </div>
              <p className="mt-3 text-xs font-bold leading-relaxed text-slate-500">突破ゼミ勤務の場合は、勤務詳細で突破ゼミの区分を選び、授業または事務を登録してください。</p>
            </ReferenceDetails>

            <ReferenceDetails icon={<FilePenLine size={21} />} title="打刻を間違えた・忘れた">
              <p>履歴の「打刻修正依頼」から正しい時刻と理由を送信します。勤務記録自体がない日は「打刻を忘れた日の申請」を使用してください。</p>
            </ReferenceDetails>

            <ReferenceDetails icon={<AlertTriangle size={21} />} title="登録時の注意" tone="amber">
              <ul className="space-y-2">
                <li>・出勤と退勤は、原則として勤務当日に本人が操作してください。</li>
                <li>・休憩時間は「休憩」で登録し、「その他」は具体的な業務内容も入力してください。</li>
                <li>・承認済みの勤怠は講師側で変更できません。必要な場合は管理者へ連絡してください。</li>
                <li>・23時以降は打刻できません。修正依頼または打刻忘れ申請を使用してください。</li>
              </ul>
            </ReferenceDetails>
          </div>
        </section>
      </div>
    </main>
  );
}

function ManualStep({ number, icon, title, summary, children }: { number: string; icon: React.ReactNode; title: string; summary: string; children: React.ReactNode }) {
  return (
    <details className="group overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm open:border-blue-200 open:shadow-md">
      <summary className="flex min-h-[76px] cursor-pointer list-none items-center gap-3 px-4 py-3 marker:hidden sm:px-5 [&::-webkit-details-marker]:hidden">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-blue-700 text-base font-black text-white">{number}</span>
        <span className="shrink-0 text-blue-600">{icon}</span>
        <span className="min-w-0 flex-1">
          <span className="block text-base font-black text-slate-950 sm:text-lg">{title}</span>
          <span className="mt-0.5 block text-xs font-bold leading-relaxed text-slate-500 sm:text-sm">{summary}</span>
        </span>
        <ChevronDown className="shrink-0 text-slate-400 transition-transform group-open:rotate-180" size={22} />
      </summary>
      <div className="border-t border-slate-100 bg-slate-50/70 px-5 py-5 text-sm font-bold leading-7 text-slate-700 sm:px-16">
        {children}
      </div>
    </details>
  );
}

function DetailItem({ number, children }: { number: string; children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-3">
      <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-blue-100 text-xs font-black text-blue-800">{number}</span>
      <span>{children}</span>
    </li>
  );
}

function ReferenceDetails({ icon, title, tone = 'blue', children }: { icon: React.ReactNode; title: string; tone?: 'blue' | 'amber'; children: React.ReactNode }) {
  const colorClass = tone === 'amber' ? 'text-amber-700' : 'text-indigo-600';
  return (
    <details className="group overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <summary className="flex min-h-14 cursor-pointer list-none items-center gap-3 px-4 py-3 marker:hidden [&::-webkit-details-marker]:hidden">
        <span className={colorClass}>{icon}</span>
        <span className="flex-1 text-sm font-black text-slate-900 sm:text-base">{title}</span>
        <ChevronDown className="shrink-0 text-slate-400 transition-transform group-open:rotate-180" size={20} />
      </summary>
      <div className="border-t border-slate-100 bg-slate-50/70 px-5 py-5 text-sm font-bold leading-7 text-slate-700">{children}</div>
    </details>
  );
}
