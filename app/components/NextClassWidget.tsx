'use client';

import { useEffect, useState } from 'react';
import { db } from '@/lib/firebase';
import { collection, query, where, getDocs, limit } from 'firebase/firestore';
import { CalendarClock, Video, BookOpen, MonitorPlay } from 'lucide-react';
import { useAuth } from '@/app/context/AuthContext';
import { Button, EmptyState, ErrorState, Skeleton, useConfirm, useToast } from '@/app/components/ui';
import { formatDate, jstDateKey } from '@/lib/format';
import {
  NEXT_CLASS_LOOKAHEAD_DAYS,
  isValidZoomSigninAddress,
  nextClassDateKeys,
  pickNextClasses,
  type NextClassShift,
} from '@/lib/next-class';
import { launchZoomUrl, prepareZoomWindow, requestZoomHostStart } from '@/lib/zoom-host-start';

const normalizeMeetingId = (value?: string | null) => String(value || '').normalize('NFKC').replace(/[^\d]/g, '');

const jstNowHHMM = () => new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Tokyo', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
}).format(new Date());

export default function NextClassWidget({ profile }: { profile: any }) {
  const { user } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  const [nextClasses, setNextClasses] = useState<NextClassShift[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [startingId, setStartingId] = useState('');

  const userId = String(user?.uid || profile?.uid || profile?.id || '');

  useEffect(() => {
    let cancelled = false;
    const fetchNext = async () => {
      if (!userId) {
        setLoading(false);
        return;
      }
      setLoading(true);
      setLoadError(false);
      try {
        const today = jstDateKey();
        // 自分の配置だけを、今日（JST）から一定期間に限って読む（他の講師の配置は読まない）。
        const snap = await getDocs(query(
          collection(db, 'shift_assignments'),
          where('user_id', '==', userId),
          where('target_date', 'in', nextClassDateKeys(today)),
          limit(60),
        ));
        const shifts = snap.docs.map(item => ({ id: item.id, ...item.data() } as NextClassShift));
        if (!cancelled) setNextClasses(pickNextClasses(shifts, userId, today, jstNowHHMM()));
      } catch (error) {
        console.error('NextClass fetch error:', error);
        if (!cancelled) setLoadError(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    fetchNext();
    return () => { cancelled = true; };
  }, [userId, reloadKey]);

  if (loading) {
    return <Skeleton className="mb-6 h-[88px] w-full rounded-card" />;
  }

  if (loadError) {
    return (
      <ErrorState
        className="mb-6"
        title="次回担当授業を読み込めませんでした"
        onRetry={() => setReloadKey(key => key + 1)}
      />
    );
  }

  if (nextClasses.length === 0) {
    return (
      <EmptyState
        className="mb-6"
        icon={CalendarClock}
        title="次回担当授業はありません"
        description={`今日から${NEXT_CLASS_LOOKAHEAD_DAYS}日以内に、あなたが担当する授業は登録されていません。`}
      />
    );
  }

  const firstClass = nextClasses[0];
  const isToday = firstClass.target_date === jstDateKey();
  const myName = profile?.student_name || profile?.name || '講師';

  const handleJoin = (cls: NextClassShift) => {
    // 合併された授業は、合併先の会議に参加者として入る。
    const merged = Boolean(cls.merge_host_shift_id && cls.merge_meeting_id);
    const confno = normalizeMeetingId(merged ? cls.merge_meeting_id : cls.target_meeting_id);
    if (!confno) { toast.error('ミーティングIDが未設定です'); return; }
    const params = new URLSearchParams({ confno });
    const password = merged ? cls.merge_password : cls.target_password;
    if (password) params.set('pwd', String(password).normalize('NFKC').trim());
    window.open(`zoommtg://zoom.us/join?${params.toString()}`, '_self');
  };

  // 講師ホームの授業カードと同じ ZAK によるホスト開始。API が「今日の自分の授業」かを確認する。
  const handleHostStart = async (cls: NextClassShift) => {
    const confno = normalizeMeetingId(cls.target_meeting_id);
    const email = String(cls.target_signin_address || '').trim();
    if (!confno || !user) { toast.error('ミーティングIDが未設定です'); return; }
    const popup = prepareZoomWindow();
    setStartingId(cls.id);
    try {
      const token = await user.getIdToken();
      const result = await requestZoomHostStart({ token, email, meetingId: confno, shiftId: cls.id, name: myName });
      if (result.ok) {
        launchZoomUrl(result.url, popup);
        return;
      }
      if (popup && !popup.closed) popup.close();
      const joinNormally = await confirm({
        title: 'ホスト権限の取得に失敗しました',
        message: <span className="whitespace-pre-line">{`理由: ${result.error}${result.detail ? `\n詳細: ${result.detail}` : ''}\n参加者として開きますか？`}</span>,
        confirmLabel: '参加者として開く',
      });
      if (joinNormally) handleJoin(cls);
    } catch (error) {
      if (popup && !popup.closed) popup.close();
      console.error(error);
      toast.error('通信エラーが発生しました。');
    } finally {
      setStartingId('');
    }
  };

  return (
    <div className="relative mb-6 overflow-hidden rounded-hero bg-accent p-4 text-accent-ink shadow-card">
      <div className="relative">
        <div className="mb-3 flex items-center gap-3 border-b border-white/15 pb-2">
          <div className="shrink-0 rounded-btn bg-white/20 p-2">
            <CalendarClock size={20} aria-hidden />
          </div>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="text-sm font-bold opacity-85">次回担当授業</span>
            <span className="text-lg font-bold">{formatDate(firstClass.target_date, { withWeekday: true })}</span>
            {isToday && (
              <span className="rounded-full bg-danger px-2 py-0.5 text-xs font-bold text-white shadow-sm">今日</span>
            )}
          </div>
        </div>

        <div className="flex flex-col gap-2">
          {nextClasses.map((cls) => {
            const merged = Boolean(cls.merge_host_shift_id && cls.merge_meeting_id);
            const hasMeeting = Boolean(normalizeMeetingId(merged ? cls.merge_meeting_id : cls.target_meeting_id));
            // ホスト開始は当日の授業のみ（ZAK は当日の配置でしか発行されない）。合併された授業は合併先が開始する。
            const canHostStart = !merged && hasMeeting && isToday && isValidZoomSigninAddress(cls.target_signin_address);
            return (
              <div key={cls.id} className="flex flex-col justify-between gap-3 rounded-card border border-white/10 bg-white/10 p-3 sm:flex-row sm:items-center">
                <div className="flex items-start gap-3 overflow-hidden">
                  <div className="mt-0.5 shrink-0 whitespace-nowrap rounded-input bg-black/25 px-2 py-1 text-xs font-bold">
                    {cls.note?.match(/【.*?】/)?.[0] || '時間未定'}
                  </div>
                  <div className="min-w-0">
                    <div className="mb-0.5 flex items-center gap-2 text-sm font-bold">
                      <span>{cls.target_grade}</span>
                      <span className="opacity-50">|</span>
                      <span>{cls.target_subject}</span>
                    </div>
                    <div className="flex items-center gap-1 truncate text-xs opacity-85">
                      <BookOpen size={12} className="shrink-0 opacity-70" aria-hidden />
                      <span className="truncate">{cls.unit || '単元設定なし'}</span>
                    </div>
                    {merged && <p className="mt-1 text-xs font-bold opacity-90">合併：{cls.merge_host_label || '合併先の授業'}に集約（参加者として入ります）</p>}
                  </div>
                </div>

                {hasMeeting && (
                  <div className="flex w-full shrink-0 flex-col gap-2 sm:w-auto sm:flex-row">
                    {canHostStart && (
                      <Button
                        onClick={() => handleHostStart(cls)}
                        loading={startingId === cls.id}
                        icon={<MonitorPlay size={16} aria-hidden />}
                        className="w-full !bg-white !text-accent hover:!bg-accent-soft sm:w-auto"
                      >
                        ホストで開始
                      </Button>
                    )}
                    <button
                      type="button"
                      onClick={() => handleJoin(cls)}
                      className={canHostStart
                        ? 'flex min-h-11 w-full items-center justify-center gap-1.5 whitespace-nowrap rounded-btn border border-white/40 px-4 text-sm font-bold text-accent-ink transition-colors hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white sm:w-auto'
                        : 'flex min-h-11 w-full items-center justify-center gap-1.5 whitespace-nowrap rounded-btn bg-white px-4 text-sm font-bold text-accent shadow-sm transition-colors hover:bg-accent-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white sm:w-auto'}
                    >
                      <Video size={16} aria-hidden /> {merged ? '合併先に参加' : '参加'}
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
