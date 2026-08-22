'use client';

import { useState } from 'react';
import { db, auth } from '@/lib/firebase';
import { doc, setDoc, serverTimestamp } from 'firebase/firestore';
import { Loader2, Coins, Sparkles, ExternalLink } from 'lucide-react';
import { normalizeZoomMeetingId } from '@/lib/zoom-url';

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
  userProfile?: any
}) {
  const { 
    url, 
    meetingId,
    label = "Zoomに参加する", 
    subLabel = "現在開催中の授業",
    color = "blue",
    startTime,
    endTime,
    classId,
    userProfile 
  } = props;

  const [loading, setLoading] = useState(false);

  const handleJoinClass = async () => {
    if (loading) return;
    const fallbackId = cleanMeetingId(meetingId || url);
    const fallbackUrl = fallbackId ? `https://zoom.us/j/${fallbackId}` : '';
    const baseUrl = url || fallbackUrl;
    if (!baseUrl) {
      alert('この授業のZoom情報がまだ準備できていません。時間をおいて再度お試しください。解決しない場合はサポートセンターへご連絡ください。');
      return;
    }

    if (!confirm(`${label}しますか？\n（参加ログとして記録されます）`)) return;

    setLoading(true);
    const today = new Date().toISOString().split('T')[0];

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
        const attendanceId = `${user.uid}_${today}`;
        const attendanceRef = doc(db, 'attendance', attendanceId);
        await setDoc(attendanceRef, {
          user_id: user.uid,
          target_date: today,
          type: 'present',
          contacted_by: 'student',
          reason: 'Zoom参加ボタンより自動登録',
          created_at: serverTimestamp(),
          updated_at: serverTimestamp()
        }, { merge: true });

        const token = await user.getIdToken();
        await fetch('/api/class-participation', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({
            target_date: today,
            class_id: classId || `${user.uid}_${today}`,
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

  const theme = color === 'blue' 
    ? {
        bg: 'bg-gradient-to-br from-cyan-500 to-blue-600',
        shadow: 'shadow-blue-200',
        iconText: 'text-blue-600',
        ctaText: 'text-blue-700'
      }
    : {
        bg: 'bg-gradient-to-br from-violet-500 to-fuchsia-600',
        shadow: 'shadow-purple-200',
        iconText: 'text-purple-600',
        ctaText: 'text-purple-700'
      };
  const timeLabel = [startTime, endTime].filter(Boolean).join(' - ');

  return (
    <div className="w-full py-1.5 sm:py-2">
      <button
        onClick={handleJoinClass}
        disabled={loading}
        className={`
          relative w-full overflow-hidden rounded-2xl sm:rounded-3xl ${theme.bg} text-white shadow-lg sm:shadow-xl ${theme.shadow}
          group transition-all duration-300 active:scale-[0.99] sm:hover:scale-[1.02] sm:active:scale-[0.98]
          disabled:opacity-70 disabled:cursor-not-allowed disabled:hover:scale-100
        `}
      >
        <div className="absolute top-0 right-0 -mt-4 -mr-4 w-32 h-32 bg-white opacity-10 rounded-full blur-2xl group-hover:opacity-20 transition-opacity"></div>
        <div className="absolute bottom-0 left-0 -mb-4 -ml-4 w-24 h-24 bg-black opacity-10 rounded-full blur-xl"></div>

        <div className="relative p-2 sm:p-1">
          <div className="flex flex-col gap-3 rounded-[18px] border border-white/20 bg-white/10 p-3 text-left backdrop-blur-[2px] sm:flex-row sm:items-stretch sm:rounded-[20px] sm:p-4">
            <div className="min-w-0 flex-1">
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-white/10 bg-white/20 px-2 py-1 text-[10px] font-black uppercase tracking-wider shadow-sm backdrop-blur-md">
                  <span className="relative flex h-2 w-2">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-red-500"></span>
                  </span>
                  Live
                </span>
                {timeLabel && (
                  <span className="rounded-full bg-black/10 px-2 py-1 text-[10px] font-black text-white/90">
                    {timeLabel}
                  </span>
                )}
              </div>
              <h3 className="text-lg font-black leading-tight tracking-tight drop-shadow-sm sm:text-2xl [overflow-wrap:anywhere]">
                {loading ? '準備中...' : label}
              </h3>
              <p className="mt-1.5 text-xs font-bold leading-relaxed text-white/85 sm:text-[11px] [overflow-wrap:anywhere]">
                {subLabel}
              </p>
            </div>
            <div className="flex items-center gap-2 sm:flex-col sm:items-center sm:justify-between sm:border-l sm:border-white/20 sm:pl-4">
              <div className="hidden rounded-full border border-white/30 bg-white/20 px-3 py-1 text-white shadow-lg transition-transform duration-300 group-hover:-translate-y-1 sm:flex sm:items-center sm:gap-1.5">
                <Coins size={14} className="fill-yellow-600 stroke-yellow-800" />
                <span className="text-xs font-black">ログ</span>
                <Sparkles size={12} className="text-yellow-700 animate-pulse" />
              </div>
              <div className={`
                flex min-h-[48px] flex-1 items-center justify-center gap-2 rounded-2xl bg-white px-4 text-sm font-black ${theme.ctaText} shadow-lg
                transition-colors group-hover:bg-white sm:h-12 sm:w-12 sm:min-h-0 sm:flex-none sm:rounded-full sm:px-0 ${theme.iconText}
              `}>
                {loading ? (
                  <>
                    <Loader2 size={20} className="animate-spin text-gray-400" />
                    <span className="sm:hidden">起動中</span>
                  </>
                ) : (
                  <>
                    <span className="sm:hidden">Zoomに参加</span>
                    <ExternalLink size={20} className="ml-0.5" strokeWidth={2.5} />
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
