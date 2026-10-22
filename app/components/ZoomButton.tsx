'use client';

import { useEffect, useState } from 'react';
import { auth } from '@/lib/firebase';
import { Loader2, ClipboardCheck, ExternalLink } from 'lucide-react';
import { normalizeZoomMeetingId } from '@/lib/zoom-url';
import { classLiveStatus } from '@/lib/class-live-status';
import { useConfirm, useToast } from '@/app/components/ui';

// 画像に基づいた校舎名の略称変換ロジック
const getSchoolAbbreviation = (schoolName: string | undefined): string => {
  if (!schoolName) return "未";

  // 部分一致で判定するため、重複する名前（例:「西神」と「西神南」）は
  // より長い・特殊な方を先に判定する必要があります。
  const rules: [string, string][] = [
    // --- 2文字以上の略称 or 特殊な判定が必要なもの (優先度高) ---
    ["六甲アイランド", "アイ"],
    ["北鈴", "北鈴"],
    ["北神", "北神"],
    ["西神南", "南"],      // 「西神」より先に判定
    ["西神", "西神"],      // 「西神本部」など
    ["舞多聞", "舞多"],
    ["舞子", "舞子"],      // 「舞子坂」
    ["西明石", "西明"],    // 「明石」より先に判定
    ["東加古川", "東加"],  // 「加古川」より先に判定
    ["加古川", "加"],      // 「加古川本部」
    ["高砂", "高砂"],      // 「高丘」と混ざらないよう注意
    ["高丘", "高丘"],
    ["ひめじ別所", "別"],
    ["姫路白浜", "白"],    // 「姫路」より先に判定
    ["西飾磨", "飾"],
    ["HAT", "H"],
    ["オンライン", "オ"],

    // --- 1文字の略称 (順不同でOKだが念のため網羅) ---
    ["本山", "本"],
    ["六甲", "六"],
    ["御影", "御"],
    ["甲南", "甲"],
    ["東山", "東"],
    ["名谷", "名"],
    ["学園", "学"],
    ["伊川谷", "伊"],
    ["板宿", "板"],
    ["霞", "霞"],
    ["須磨", "須"],
    ["青山", "青"],
    ["垂水", "垂"],
    ["明石", "明"],
    ["魚住", "魚"],
    ["大久保", "大"],
    ["播磨", "播"],
    ["浜の宮", "浜"],
    ["野口", "野"],
    ["土山", "土"],
    ["小野", "小"],
    ["宝殿", "宝"],
    ["曽根", "曽"],
    ["手柄", "手"],
    ["姫路", "姫"], // 姫路白浜は上で除外済み
    ["安室", "安"],
    ["花北", "花"],
    ["三田", "三"],
    ["摩耶", "摩"],
    ["猪名川", "猪"],
    ["元町", "元"]
  ];

  for (const [key, abbr] of rules) {
    if (schoolName.includes(key)) {
      return abbr;
    }
  }

  // ルールになければ頭文字を返す
  return schoolName.charAt(0);
};

const DEFAULT_LABEL = 'Zoomに参加する';

const isMobileOrTablet = () => {
  if (typeof navigator === 'undefined') return false;
  return /iPhone|iPad|iPod|Android|Mobile|Tablet|Line|CriOS|FxiOS|EdgiOS/i.test(navigator.userAgent);
};

const cleanMeetingId = normalizeZoomMeetingId;

const extractMeetingId = (value: string, fallback?: string | null) => {
  const fallbackId = cleanMeetingId(fallback);
  if (fallbackId) return fallbackId;

  const text = String(value || '');
  const match = text.match(/(?:\/j\/|\/wc\/join\/|confno=)(\d{6,})/i) || text.match(/(\d{9,})/);
  return cleanMeetingId(match?.[1]);
};

const withStudentName = (rawUrl: string, formattedName?: string) => {
  if (!rawUrl || !formattedName) return rawUrl;
  try {
    const url = new URL(rawUrl);
    url.searchParams.set('uname', formattedName);
    return url.toString();
  } catch {
    return rawUrl;
  }
};

const buildZoomTargets = (baseUrl: string, meetingId?: string | null, formattedName?: string) => {
  const id = extractMeetingId(baseUrl, meetingId);
  const webUrl = withStudentName(baseUrl || (id ? `https://zoom.us/j/${id}` : ''), formattedName);
  if (!id) return { webUrl, appUrl: '' };

  let pwd = '';
  try {
    const urlObj = new URL(webUrl);
    pwd = urlObj.searchParams.get('pwd') || '';
  } catch {
    const pwdMatch = baseUrl.match(/[?&]pwd=([^&]+)/);
    pwd = pwdMatch ? decodeURIComponent(pwdMatch[1]) : '';
  }

  const params = new URLSearchParams({ confno: id });
  if (formattedName) params.set('uname', formattedName);
  if (pwd) params.set('pwd', pwd);
  return {
    webUrl,
    appUrl: `zoommtg://zoom.us/join?${params.toString()}`,
  };
};

const openWithAppFallback = (appUrl: string, webUrl: string) => {
  if (!appUrl) {
    window.location.href = webUrl;
    return;
  }

  let completed = false;
  let timer: number;
  const cleanup = () => {
    completed = true;
    window.clearTimeout(timer);
    window.removeEventListener('pagehide', cleanup);
    document.removeEventListener('visibilitychange', handleVisibilityChange);
  };
  const handleVisibilityChange = () => {
    if (document.hidden) cleanup();
  };
  timer = window.setTimeout(() => {
    if (!completed && !document.hidden) window.location.href = webUrl;
  }, isMobileOrTablet() ? 1500 : 2200);

  window.addEventListener('pagehide', cleanup, { once: true });
  document.addEventListener('visibilitychange', handleVisibilityChange);
  window.location.href = appUrl;
};

export default function ZoomButton(props: { 
  url?: string | null, 
  meetingId?: string | null,
  label?: string,
  subLabel?: string,
  color?: "blue" | "purple",
  startTime?: string,
  endTime?: string,
  classDay?: string,
  classId?: string,
  participationToken?: string,
  subject?: string,
  courseName?: string,
  userProfile?: any
}) {
  const { 
    url, 
    meetingId,
    label = DEFAULT_LABEL, 
    subLabel = "現在開催中の授業",
    color = "blue",
    startTime,
    endTime,
    classId,
    participationToken,
    subject,
    courseName,
    userProfile 
  } = props;

  const [loading, setLoading] = useState(false);
  const toast = useToast();
  const confirm = useConfirm();
  // 開始前／授業中の表示を時刻に合わせて切り替える（日本時間）。初回描画はサーバーとずれないよう、マウント後に判定する。
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date());
    const timer = window.setInterval(() => setNow(new Date()), 30 * 1000);
    return () => window.clearInterval(timer);
  }, []);
  const liveStatus = now ? classLiveStatus(startTime, endTime, now) : 'unknown';

  const handleJoinClass = async () => {
    if (loading) return;
    const fallbackId = cleanMeetingId(meetingId || url);
    const fallbackUrl = fallbackId ? `https://zoom.us/j/${fallbackId}` : '';
    const baseUrl = url || fallbackUrl;
    if (!baseUrl) {
      toast.error('この授業のZoom情報がまだ準備できていません。時間をおいて再度お試しください。解決しない場合はサポートセンターへご連絡ください。');
      return;
    }

    const confirmTitle = label === DEFAULT_LABEL ? 'Zoomに参加しますか？' : `「${label}」に参加しますか？`;
    if (!(await confirm({ title: confirmTitle, message: '参加ログとして記録されます。', confirmLabel: '参加する' }))) return;

    setLoading(true);
    const today = new Intl.DateTimeFormat('sv-SE', {
      timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(new Date());

    try {
      const user = auth.currentUser;
      
      // ログインしていない場合は通常のURLへ
      if (!user) {
        window.location.href = baseUrl;
        return;
      }

      // --- 1. Zoom URLの生成 (名前指定ロジック) ---
      let formattedName = '';

      // 親から渡されたプロフィールが存在する場合のみ名前処理を行う
      if (userProfile) {
        // 画像のルールに基づいて略称を取得
        const schoolPrefix = getSchoolAbbreviation(userProfile.school);
        const studentName = userProfile.student_name_kana || userProfile.student_name || "名無し";
        formattedName = `${schoolPrefix} ${studentName}`;
      }
      const zoomTargets = buildZoomTargets(baseUrl, meetingId, formattedName);

      // --- 2. 出席・参加ログ（失敗してもZoom起動は止めない） ---
      try {
        const token = await user.getIdToken();
        await fetch('/api/class-participation', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({
            target_date: today,
            participation_token: participationToken || '',
            ...(classId ? { class_id: classId } : {}),
          }),
        });
      } catch (logError) {
        console.warn('Zoom participation log failed:', logError);
      }

      // --- 3. Zoom起動 ---
      // 授業参加は埋め込みを使わず、Zoomアプリ起動を優先し、失敗した場合はブラウザ参加に切り替える。
      openWithAppFallback(zoomTargets.appUrl, zoomTargets.webUrl || baseUrl);

    } catch (err) { 
      console.error(err);
      // エラー時でも最低限Zoomには飛ばす
      window.location.href = baseUrl;
    } finally {
      setLoading(false);
    }
  };

  // 1限・2限の見分けは濃さで付ける（色はアプリの差し色に合わせる）。
  const theme = color === 'blue'
    ? {
        bg: 'bg-accent bg-gradient-to-br from-white/10 to-transparent',
        shadow: 'shadow-accent/20',
        iconText: 'text-accent',
        ctaText: 'text-accent'
      }
    : {
        bg: 'bg-accent bg-gradient-to-br from-transparent to-black/25',
        shadow: 'shadow-accent/20',
        iconText: 'text-accent',
        ctaText: 'text-accent'
      };
  const timeLabel = [startTime, endTime].filter(Boolean).join(' - ');

  return (
    <div className="w-full py-1.5 sm:py-2">
      <button
        type="button"
        onClick={handleJoinClass}
        disabled={loading}
        className={`
          relative w-full overflow-hidden rounded-card ${theme.bg} text-accent-ink shadow-lg sm:shadow-xl ${theme.shadow}
          group transition-all duration-300 active:scale-[0.99] sm:hover:scale-[1.02] sm:active:scale-[0.98]
          disabled:opacity-70 disabled:cursor-not-allowed disabled:hover:scale-100
        `}
      >
        <div aria-hidden className="absolute top-0 right-0 -mt-4 -mr-4 w-32 h-32 bg-white opacity-10 rounded-full blur-2xl group-hover:opacity-20 transition-opacity"></div>
        <div aria-hidden className="absolute bottom-0 left-0 -mb-4 -ml-4 w-24 h-24 bg-black opacity-10 rounded-full blur-xl"></div>

        <div className="relative p-2 sm:p-1">
          <div className="flex flex-col gap-3 rounded-btn border border-white/20 bg-white/10 p-3 text-left backdrop-blur-[2px] sm:flex-row sm:items-stretch sm:p-4">
            <div className="min-w-0 flex-1">
              <div className="mb-2 flex flex-wrap items-center gap-2">
                {liveStatus === 'live' && (
                  <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-white/10 bg-white/20 px-2 py-1 text-xs font-bold shadow-sm backdrop-blur-md">
                    <span className="relative flex h-2 w-2">
                      <span className="motion-safe:animate-ping absolute inline-flex h-full w-full rounded-full bg-rose-400 opacity-75"></span>
                      <span className="relative inline-flex rounded-full h-2 w-2 bg-rose-500"></span>
                    </span>
                    授業中
                  </span>
                )}
                {liveStatus === 'before' && (
                  <span className="inline-flex shrink-0 items-center rounded-full border border-white/10 bg-white/20 px-2 py-1 text-xs font-bold shadow-sm backdrop-blur-md">
                    開始前
                  </span>
                )}
                {liveStatus === 'ended' && (
                  <span className="inline-flex shrink-0 items-center rounded-full border border-white/10 bg-black/15 px-2 py-1 text-xs font-bold">
                    授業終了
                  </span>
                )}
                {timeLabel && (
                  <span className="rounded-full bg-black/10 px-2 py-1 text-xs font-bold opacity-90">
                    {timeLabel}
                  </span>
                )}
              </div>
              <h3 className="text-lg font-black leading-tight tracking-tight drop-shadow-sm sm:text-2xl [overflow-wrap:anywhere]">
                {loading ? '準備中...' : label}
              </h3>
              <p className="mt-1.5 text-xs font-medium leading-relaxed opacity-85 [overflow-wrap:anywhere]">
                {subLabel}
              </p>
            </div>
            <div className="flex items-center gap-2 sm:flex-col sm:items-center sm:justify-between sm:border-l sm:border-white/20 sm:pl-4">
              <div className="hidden rounded-full border border-white/30 bg-white/20 px-3 py-1 shadow-lg transition-transform duration-300 group-hover:-translate-y-1 sm:flex sm:items-center sm:gap-1.5">
                <ClipboardCheck size={14} aria-hidden />
                <span className="text-xs font-bold">参加を記録</span>
              </div>
              <div className={`
                flex min-h-[48px] flex-1 items-center justify-center gap-2 rounded-btn bg-surface px-4 text-sm font-bold ${theme.ctaText} shadow-lg
                transition-colors group-hover:bg-surface sm:h-12 sm:w-12 sm:min-h-0 sm:flex-none sm:rounded-full sm:px-0 ${theme.iconText}
              `}>
                {loading ? (
                  <>
                    <Loader2 size={20} className="animate-spin text-slate-400" aria-hidden />
                    <span className="sm:hidden">起動中</span>
                  </>
                ) : (
                  <>
                    <span className="sm:hidden">Zoomに参加</span>
                    <ExternalLink size={20} className="ml-0.5" strokeWidth={2.5} aria-hidden />
                    <span className="sr-only">Zoomに参加</span>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      </button>
    </div>
  );
}
