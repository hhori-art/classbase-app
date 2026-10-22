'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { BookOpen, HelpCircle, X } from 'lucide-react';

const HELP: Array<{ match: string; title: string; steps: string[] }> = [
  { match: '/master/science-social', title: '校舎ダッシュボード', steps: ['赤・黄の項目から確認します。', '要確認の生徒は校舎別生徒管理で詳細を確認します。'] },
  { match: '/master/school-students', title: '校舎別生徒管理', steps: ['学年や氏名で絞り込みます。', '校舎管理者は自校舎の生徒情報を登録・変更できます。'] },
  { match: '/master/monthly-schedules', title: '月間予定', steps: ['月を切り替えて予定を確認します。', '校舎管理者は自校舎の予定を登録・変更できます。'] },
  { match: '/master/shifts', title: 'シフト配置', steps: ['日付を選ぶと当日の配置を確認できます。', '校舎管理者は閲覧のみです。配置の変更はマスター管理者へ依頼します。'] },
  { match: '/teacher/attendance', title: '勤怠・打刻', steps: ['「今日勤務する校舎」を選んでから打刻します。', '退勤後に勤務詳細（5分単位）と交通費を入力して「保存して完了」を押します。', '誤りは「打刻修正依頼」、打刻忘れは「打刻を忘れた日の申請をする」から送ります。'] },
  { match: '/student/change-request', title: '受講講座の登録', steps: ['期ごとに受講する講座を選びます。', '保存後、ホームの参加ボタンに反映されたことを確認します。'] },
  { match: '/student', title: '生徒画面', steps: ['授業の時間になると「N限」のボタンが出るので「Zoomに参加」を押します。', '宿題は「Monoxer 宿題に取り組む」から取り組みます。', '授業が出ない場合は受講講座と日付を確認します。'] },
];

export default function ContextHelp() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  if (pathname === '/manual' || pathname.startsWith('/manual/')) return null;
  // チャット画面は右下に送信ボタンがあり重なるので出さない（使い方はマニュアルから見られる）。
  if (pathname === '/student/chat' || pathname === '/teacher/chat') return null;
  const help = HELP.find(item => pathname.startsWith(item.match)) || {
    title: 'この画面の使い方',
    steps: ['画面上部から対象や期間を選びます。', '保存・送信後は完了表示を確認してください。'],
  };
  return (
    <div className="fixed bottom-24 right-4 z-[240] lg:right-5">
      {open ? (
        <div className="mb-3 w-[min(20rem,calc(100vw-2rem))] rounded-2xl border border-slate-200 bg-white p-4 shadow-2xl" role="dialog" aria-label={`${help.title}の使い方`}>
          <div className="flex items-start justify-between gap-3">
            <div><p className="text-xs font-bold text-indigo-600">使い方</p><h2 className="mt-1 text-base font-bold text-slate-900">{help.title}</h2></div>
            <button type="button" onClick={() => setOpen(false)} className="rounded-full p-1.5 text-slate-400 hover:bg-slate-100" aria-label="使い方を閉じる"><X size={18} /></button>
          </div>
          <ol className="mt-3 space-y-2">{help.steps.map((step, index) => <li key={step} className="flex gap-2 text-xs font-bold leading-5 text-slate-600"><span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-indigo-50 text-[11px] text-indigo-700">{index + 1}</span>{step}</li>)}</ol>
          <Link href="/manual" className="mt-4 flex items-center justify-center gap-2 rounded-xl bg-slate-900 px-3 py-2.5 text-xs font-bold text-white"><BookOpen size={15} />詳しい操作マニュアル</Link>
        </div>
      ) : null}
      <button type="button" onClick={() => setOpen(value => !value)} className="grid h-11 w-11 place-items-center rounded-full border-2 border-white bg-indigo-600 text-white shadow-lg transition hover:scale-105 hover:bg-indigo-700 focus:outline-none focus:ring-4 focus:ring-indigo-200" aria-label="この画面の使い方を見る" aria-expanded={open}>
        <HelpCircle size={23} />
      </button>
    </div>
  );
}
