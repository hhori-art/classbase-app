'use client';

import { useState, useEffect } from 'react';
import { auth } from '@/lib/firebase';
import { ChevronDown, Loader2, CalendarX, Repeat } from 'lucide-react';
import Link from 'next/link';
import ZoomButton from './ZoomButton';

type Props = {
  profile: any;
  period: 1 | 2;
  startTime: string;
  endTime: string;
  previewMode?: boolean;
  allowBetaTransfer?: boolean;
};

type ClassButtonData = {
  id: string;
  url?: string;
  meeting_id?: string;
  grade?: string;
  subject: string;
  unit?: string;
  source?: string;
  match_reason?: string;
};

export default function SmartClassButton({ profile, period, startTime, endTime, previewMode = false, allowBetaTransfer = false }: Props) {
  const [classDataList, setClassDataList] = useState<ClassButtonData[]>([]);
  const [betaTransferList, setBetaTransferList] = useState<ClassButtonData[]>([]);
  const [showBetaTransfer, setShowBetaTransfer] = useState(false);
  const [showPreviewButtons, setShowPreviewButtons] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchClassUrls = async () => {
      setLoading(true);

      if (!profile) {
        setLoading(false);
        return;
      }

      try {
        const currentUser = auth.currentUser;
        if (!currentUser) {
          setClassDataList([]);
          return;
        }
        const token = await currentUser.getIdToken();
        const previewParam = previewMode ? '&preview=teacher' : '';
        const res = await fetch(`/api/student/today-classes?period=${period}${previewParam}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || data.ok === false) throw new Error(data.error || 'class fetch failed');
        const normalClasses = Array.isArray(data.classes) ? data.classes : [];
        setClassDataList(normalClasses);
        setShowBetaTransfer(false);
        setShowPreviewButtons(false);
        setBetaTransferList([]);

        if (!previewMode && normalClasses.length === 0) {
          const transferRes = await fetch(`/api/student/today-classes?period=${period}&beta_transfer=1`, {
            headers: { Authorization: `Bearer ${token}` },
          });
          const transferData = await transferRes.json().catch(() => ({}));
          if (transferRes.ok && transferData.ok !== false) {
            setBetaTransferList(Array.isArray(transferData.classes) ? transferData.classes : []);
          }
        }

      } catch (error: any) {
        console.error("SmartClassButton Error:", error);
        setClassDataList([]);
        setBetaTransferList([]);
        setShowBetaTransfer(false);
      } finally {
        setLoading(false);
      }
    };

    fetchClassUrls();
  }, [profile, period, previewMode, allowBetaTransfer]);

  if (loading) {
    return (
      <div className="flex min-h-24 items-center justify-center gap-3 rounded-3xl border border-indigo-100 bg-white/70 px-4 py-6 text-sm font-black text-indigo-400">
        <Loader2 className="animate-spin" size={20} />
        本日の授業を確認中
      </div>
    );
  }

  // 表示するものがない場合
  if (classDataList.length === 0) {
    const hasTransferOptions = betaTransferList.length > 0;
    return (
      <div className="w-full flex flex-col gap-2">
        <div className="bg-white/70 border-2 border-dashed border-indigo-100 rounded-3xl p-6 flex flex-col items-center justify-center text-slate-500 gap-2">
          <CalendarX size={32} className="text-indigo-300" />
          <div className="text-sm font-black text-center">{period}限目の登録授業はありません</div>
          <p className="max-w-sm text-center text-xs font-bold leading-relaxed text-slate-400">
            本日の受講登録と一致する授業がありません。
          </p>
          <div className="mt-1 rounded-2xl bg-indigo-50 px-4 py-3 text-center text-xs font-black leading-relaxed text-indigo-700">
            振替で参加する場合は、同じ学年で現在実施中の授業から選択できます。
          </div>
          {hasTransferOptions && (
            <button
              type="button"
              onClick={() => setShowBetaTransfer(prev => !prev)}
              className="mt-2 inline-flex items-center gap-2 rounded-2xl bg-indigo-600 px-4 py-3 text-sm font-black text-white shadow-lg shadow-indigo-100"
            >
              <Repeat size={16} />
              {showBetaTransfer ? '振替候補を閉じる' : '振替参加を選ぶ'}
            </button>
          )}
          {!hasTransferOptions && (
            <div className="mt-2 rounded-2xl bg-slate-50 px-4 py-3 text-center text-xs font-black text-slate-400">
              現在選べる振替候補はありません
            </div>
          )}
          {!hasTransferOptions && allowBetaTransfer && (
            <Link
              href="/student/absence"
              className="mt-1 inline-flex items-center gap-2 rounded-2xl border border-indigo-100 bg-white px-4 py-3 text-sm font-black text-indigo-600 no-underline"
            >
              <Repeat size={16} />
              振替登録ページを開く
            </Link>
          )}
        </div>
        {showBetaTransfer && hasTransferOptions && (
          <div className="space-y-3 rounded-3xl border border-indigo-100 bg-indigo-50/70 p-3">
            <p className="px-1 text-xs font-black text-indigo-700">
              振替参加できる授業です。同じ学年で現在実施中の授業から選べます。
            </p>
            {betaTransferList.map((classData) => (
              <ZoomButton
                key={classData.id}
                url={classData.url}
                meetingId={classData.meeting_id}
                label={`振替 ${period}限: ${classData.subject}`}
                subLabel={`${classData.match_reason || '振替参加候補'}${classData.unit ? ` | ${classData.unit}` : ''}`}
                color={period === 1 ? 'blue' : 'purple'}
                startTime={startTime}
                endTime={endTime}
                classId={classData.id}
                userProfile={profile}
              />
            ))}
          </div>
        )}
      </div>
    );
  }

  if (previewMode) {
    const groupedByGrade = classDataList.reduce((acc: Record<string, ClassButtonData[]>, item) => {
      const grade = item.grade || '学年未設定';
      if (!acc[grade]) acc[grade] = [];
      acc[grade].push(item);
      return acc;
    }, {});

    return (
      <div className="w-full space-y-3 animate-in fade-in slide-in-from-bottom-2 duration-500">
        <div className="rounded-3xl border border-emerald-100 bg-white p-4 shadow-sm">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-xs font-black text-emerald-600">講師テスト用</p>
              <h3 className="mt-1 text-base font-black text-slate-900">{period}限目の参加確認</h3>
              <p className="mt-1 text-xs font-bold leading-relaxed text-slate-500">
                当日の授業予定から参加確認できる候補をまとめています。必要な候補だけ開いて確認してください。
              </p>
            </div>
            <button
              type="button"
              onClick={() => setShowPreviewButtons(prev => !prev)}
              className="inline-flex items-center justify-center gap-2 rounded-2xl bg-emerald-600 px-4 py-3 text-sm font-black text-white shadow-lg shadow-emerald-100"
            >
              {showPreviewButtons ? '候補を閉じる' : `${classDataList.length}件の候補を表示`}
              <ChevronDown size={16} className={`transition-transform ${showPreviewButtons ? 'rotate-180' : ''}`} />
            </button>
          </div>
        </div>

        {showPreviewButtons && (
          <div className="space-y-3 rounded-3xl border border-emerald-100 bg-emerald-50/70 p-3">
            {Object.entries(groupedByGrade).map(([grade, items]) => (
              <section key={grade} className="rounded-2xl bg-white p-3 shadow-sm">
                <div className="mb-3 flex items-center justify-between gap-2">
                  <h4 className="text-sm font-black text-slate-800">{grade}</h4>
                  <span className="rounded-full bg-emerald-50 px-3 py-1 text-[11px] font-black text-emerald-700">{items.length}件</span>
                </div>
                <div className="space-y-2">
                  {items.map((classData) => (
                    <ZoomButton
                      key={classData.id}
                      url={classData.url}
                      meetingId={classData.meeting_id}
                      label={`${period}限: ${classData.subject}`}
                      subLabel={`${classData.match_reason || 'テスト表示'}${classData.unit ? ` | ${classData.unit}` : ''}`}
                      color={period === 1 ? 'blue' : 'purple'}
                      startTime={startTime}
                      endTime={endTime}
                      classId={classData.id}
                      userProfile={profile}
                    />
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-4 w-full animate-in fade-in slide-in-from-bottom-2 duration-500">
      {classDataList.map((classData) => (
        <ZoomButton
          key={classData.id}
          url={classData.url}
          meetingId={classData.meeting_id}
          label={`${period}限: ${classData.subject}`}
          subLabel={
            classData.source === 'teacher_preview'
              ? `講師テスト表示${classData.unit ? ` | ${classData.unit}` : ''}`
              : classData.source === 'transfer'
                ? `振替登録済み${classData.unit ? ` | ${classData.unit}` : ''}`
                : `${classData.match_reason || '受講登録と一致'}${classData.unit ? ` | ${classData.unit}` : ''}`
          }
          color={period === 1 ? 'blue' : 'purple'}
          startTime={startTime}
          endTime={endTime}
          classId={classData.id}
          // ★重要: ここでプロフィールを渡すことで、ZoomButton側で名前を指定できます
          userProfile={profile}
        />
      ))}
    </div>
  );
}
