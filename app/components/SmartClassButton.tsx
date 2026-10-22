'use client';

import { useState, useEffect } from 'react';
import { auth } from '@/lib/firebase';
import Link from 'next/link';
import { ChevronDown, Loader2, CalendarX, Repeat, ClipboardEdit } from 'lucide-react';
import ZoomButton from './ZoomButton';
import TodayTransferModal from './student/TodayTransferModal';
import { Button, ButtonLink, EmptyState, ErrorState, Phrase } from '@/app/components/ui';

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
  course_name?: string;
  unit?: string;
  source?: string;
  match_reason?: string;
  participation_token?: string;
};

export default function SmartClassButton({ profile, period, startTime, endTime, previewMode = false, allowBetaTransfer = false }: Props) {
  const [classDataList, setClassDataList] = useState<ClassButtonData[]>([]);
  const [showPreviewButtons, setShowPreviewButtons] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [scheduleMissing, setScheduleMissing] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [transferOpen, setTransferOpen] = useState(false);

  useEffect(() => {
    const fetchClassUrls = async () => {
      setLoading(true);
      setLoadError(false);

      if (!profile) {
        setLoading(false);
        return;
      }

      try {
        const currentUser = auth.currentUser;
        if (!currentUser) {
          setClassDataList([]);
          setLoadError(true);
          return;
        }
        const token = await currentUser.getIdToken();
        const previewParam = previewMode ? '&preview=teacher' : '';
        const res = await fetch(`/api/student/today-classes?period=${period}${previewParam}`, {
          headers: { Authorization: `Bearer ${token}` },
          cache: 'no-store',
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || data.ok === false) throw new Error(data.error || 'class fetch failed');
        const normalClasses = Array.isArray(data.classes) ? data.classes : [];
        setClassDataList(normalClasses);
        setScheduleMissing(data.schedule_missing === true);
        setShowPreviewButtons(false);

      } catch (error: any) {
        console.error("SmartClassButton Error:", error);
        setClassDataList([]);
        setLoadError(true);
        setScheduleMissing(false);
      } finally {
        setLoading(false);
      }
    };

    fetchClassUrls();
  }, [profile, period, previewMode, allowBetaTransfer, reloadKey]);

  if (loading) {
    return (
      <div role="status" className="flex min-h-24 items-center justify-center gap-3 rounded-card border border-accent/20 bg-surface/70 px-4 py-6 text-sm font-bold text-accent">
        <Loader2 className="animate-spin" size={20} aria-hidden />
        本日の授業を確認中
      </div>
    );
  }

  if (loadError) {
    return (
      <ErrorState
        title="本日の授業情報を確認できません"
        message="通信状況を確認して、もう一度お試しください。"
        onRetry={() => setReloadKey(value => value + 1)}
      />
    );
  }

  // 表示するものがない場合
  if (classDataList.length === 0) {
    const title = scheduleMissing ? '本日の授業配置が未反映です' : `${period}限目の登録授業はありません`;
    const description = scheduleMissing ? '過去の配置では参加できません。校舎の先生に確認してください。' : '本日の受講登録と一致する授業がありません。';
    if (previewMode) {
      return (
        <EmptyState
          icon={CalendarX}
          title={title}
          description={description}
          className="w-full bg-surface/70"
          action={allowBetaTransfer ? (
            <ButtonLink href="/student/absence?mode=transfer" variant="secondary" icon={<Repeat size={16} aria-hidden />} className="no-underline">
              正式な振替候補を確認する
            </ButtonLink>
          ) : undefined}
        />
      );
    }
    // 生徒：自分の授業の参加ボタンが出ていないときは、今日の振替（同じ時限・同じ学年の授業から選んで参加）と受講登録へ案内する。
    // 今日の振替は、振替の画面の表示設定（allowBetaTransfer）に関係なく出す。ほかの日の振替の画面へのリンクだけ表示設定に従う。
    return (
      <>
        <EmptyState
          icon={CalendarX}
          title={title}
          description={description}
          className="w-full bg-surface/70"
          action={(
            <div className="flex w-full max-w-sm flex-col items-stretch gap-2">
              {!scheduleMissing && (
                <>
                  <Button icon={<Repeat size={16} aria-hidden />} onClick={() => setTransferOpen(true)}>
                    当日の振替はこちら
                  </Button>
                  <p className="text-xs text-fg-muted">
                    <Phrase>今日のこの時間の授業から選ぶと、その場で参加ボタンが出ます</Phrase>
                  </p>
                </>
              )}
              <ButtonLink href="/student/change-request" variant="secondary" icon={<ClipboardEdit size={16} aria-hidden />} className="mt-1 no-underline">
                受講講座を登録・変更する
              </ButtonLink>
              <p className="text-xs text-fg-muted">
                <Phrase>受講登録がまだの場合は、ここから登録すると参加ボタンが出ます</Phrase>
              </p>
              {allowBetaTransfer && (
                <Link href="/student/absence?mode=transfer" className="mt-1 text-xs font-bold text-accent underline underline-offset-2">
                  ほかの日の振替はこちら
                </Link>
              )}
            </div>
          )}
        />
        <TodayTransferModal
          open={transferOpen}
          onClose={() => setTransferOpen(false)}
          period={period}
          onRegistered={() => setReloadKey(value => value + 1)}
        />
      </>
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
        <div className="cb-card !border-emerald-100 p-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-xs font-bold text-emerald-600">講師テスト用</p>
              <h3 className="mt-1 text-base font-bold text-fg">{period}限目の参加確認</h3>
              <p className="mt-1 text-xs leading-relaxed text-fg-muted">
                当日の授業予定から参加確認できる候補をまとめています。必要な候補だけ開いて確認してください。
              </p>
            </div>
            <button
              type="button"
              onClick={() => setShowPreviewButtons(prev => !prev)}
              aria-expanded={showPreviewButtons}
              className="inline-flex min-h-11 items-center justify-center gap-2 rounded-btn bg-emerald-600 px-4 text-sm font-bold text-white shadow-lg shadow-emerald-100 hover:bg-emerald-700"
            >
              {showPreviewButtons ? '候補を閉じる' : `${classDataList.length}件の候補を表示`}
              <ChevronDown size={16} aria-hidden className={`transition-transform ${showPreviewButtons ? 'rotate-180' : ''}`} />
            </button>
          </div>
        </div>

        {showPreviewButtons && (
          <div className="space-y-3 rounded-card border border-emerald-100 bg-emerald-50/70 p-3">
            {Object.entries(groupedByGrade).map(([grade, items]) => (
              <section key={grade} className="rounded-btn bg-surface p-3 shadow-sm">
                <div className="mb-3 flex items-center justify-between gap-2">
                  <h4 className="text-sm font-bold text-fg">{grade}</h4>
                  <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-bold text-emerald-700">{items.length}件</span>
                </div>
                <div className="space-y-2">
                  {items.map((classData) => (
                    <ZoomButton
                      key={classData.id}
                      url={classData.url}
                      meetingId={classData.meeting_id}
                      label={`${period}限: ${classData.grade ? `${classData.grade} ` : ''}${classData.subject}`}
                      subLabel={`${classData.match_reason || 'テスト表示'}${classData.unit ? ` | ${classData.unit}` : ''}`}
                      color={period === 1 ? 'blue' : 'purple'}
                      startTime={startTime}
                      endTime={endTime}
                      classId={classData.id}
                      participationToken={classData.participation_token}
                      subject={classData.subject}
                      courseName={classData.course_name}
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
          label={`${period}限: ${classData.grade ? `${classData.grade} ` : ''}${classData.subject}`}
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
          participationToken={classData.participation_token}
          subject={classData.subject}
          courseName={classData.course_name}
          // ★重要: ここでプロフィールを渡すことで、ZoomButton側で名前を指定できます
          userProfile={profile}
        />
      ))}
    </div>
  );
}
