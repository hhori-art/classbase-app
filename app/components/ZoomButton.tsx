'use client';

import { useState } from 'react';
import { db, auth } from '@/lib/firebase';
import { doc, setDoc, updateDoc, increment, serverTimestamp, arrayUnion } from 'firebase/firestore';
import { Loader2, Coins, Sparkles, ExternalLink } from 'lucide-react';

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

export default function ZoomButton(props: { 
  url?: string | null, 
  label?: string,
  subLabel?: string,
  color?: "blue" | "purple",
  startTime?: string,
  endTime?: string,
  classDay?: string,
  userProfile?: any
}) {
  const { 
    url, 
    label = "Zoomに参加する", 
    subLabel = "現在開催中の授業",
    color = "blue",
    userProfile 
  } = props;

  const [loading, setLoading] = useState(false);

  // URLがない場合は非表示
  if (!url) return null;

  const handleJoinClass = async () => {
    if (!url) return;
    if (loading) return;

    if (!confirm(`${label}しますか？\n（出席として記録され、コインを獲得します！）`)) return;

    setLoading(true);
    const today = new Date().toISOString().split('T')[0];

    try {
      const user = auth.currentUser;
      
      // ログインしていない場合は通常のURLへ
      if (!user) {
        window.location.href = url;
        return;
      }

      // --- 1. Zoom URLの生成 (名前指定ロジック) ---
      let targetLink = url;

      // 親から渡されたプロフィールが存在する場合のみ名前処理を行う
      if (userProfile) {
        // 画像のルールに基づいて略称を取得
        const schoolPrefix = getSchoolAbbreviation(userProfile.school);
        const studentName = userProfile.student_name_kana || userProfile.student_name || "名無し";
        const formattedName = `${schoolPrefix} ${studentName}`;
        
        try {
          // httpのURLからZoomアプリ用スキーム(zoommtg)に変換
          const urlObj = new URL(url);
          const meetingId = urlObj.pathname.split('/').pop();
          const pwd = urlObj.searchParams.get('pwd');

          if (meetingId) {
            const encodedName = encodeURIComponent(formattedName);
            // unameパラメータで名前を強制指定
            targetLink = `zoommtg://zoom.us/join?confno=${meetingId}&uname=${encodedName}`;
            if (pwd) targetLink += `&pwd=${pwd}`;
            
            console.log("Generated Deep Link:", targetLink);
          }
        } catch (e) {
          console.warn("URL Parse Error:", e);
          // エラー時は元のhttpリンクを使用
        }
      }

      // --- 2. 出席記録 (Firebase) ---
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
      
      // --- 3. ゲーミフィケーション処理 ---
      await updateDoc(doc(db, 'users', user.uid), {
        coins: increment(30),
        total_coins: increment(30),
        attendance_count: increment(1),
        earned_badges: arrayUnion('badge_1') 
      });

      // --- 4. Zoomアプリ起動 ---
      window.location.href = targetLink;

    } catch (err) { 
      console.error(err);
      // エラー時でも最低限Zoomには飛ばす
      window.location.href = url;
    } finally {
      setLoading(false);
    }
  };

  const theme = color === 'blue' 
    ? {
        bg: 'bg-gradient-to-br from-cyan-500 to-blue-600',
        shadow: 'shadow-blue-200',
        iconBg: 'bg-blue-500'
      }
    : {
        bg: 'bg-gradient-to-br from-violet-500 to-fuchsia-600',
        shadow: 'shadow-purple-200',
        iconBg: 'bg-purple-500'
      };

  return (
    <div className="w-full py-2">
      <button
        onClick={handleJoinClass}
        disabled={loading}
        className={`
          relative w-full overflow-hidden rounded-3xl ${theme.bg} text-white shadow-xl ${theme.shadow}
          group transition-all duration-300 hover:scale-[1.02] active:scale-[0.98]
          disabled:opacity-70 disabled:cursor-not-allowed disabled:hover:scale-100
        `}
      >
        <div className="absolute top-0 right-0 -mt-4 -mr-4 w-32 h-32 bg-white opacity-10 rounded-full blur-2xl group-hover:opacity-20 transition-opacity"></div>
        <div className="absolute bottom-0 left-0 -mb-4 -ml-4 w-24 h-24 bg-black opacity-10 rounded-full blur-xl"></div>

        <div className="relative p-1">
          <div className="flex items-stretch bg-white/10 backdrop-blur-[2px] rounded-[20px] border border-white/20 p-4">
            <div className="flex-1 flex flex-col justify-center text-left mr-4">
              <div className="flex items-center gap-2 mb-2">
                <span className="flex items-center gap-1.5 bg-white/20 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider backdrop-blur-md shadow-sm border border-white/10">
                  <span className="relative flex h-2 w-2">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-red-500"></span>
                  </span>
                  Live Class
                </span>
                <span className="text-[10px] opacity-80 font-medium truncate">{subLabel}</span>
              </div>
              <div className="flex items-center gap-2">
                <h3 className="text-xl sm:text-2xl font-black tracking-tight drop-shadow-sm">
                  {loading ? '準備中...' : label}
                </h3>
              </div>
            </div>
            <div className="flex flex-col items-center justify-between gap-2 pl-4 border-l border-white/20">
              <div className="bg-yellow-400 text-yellow-950 px-3 py-1 rounded-full flex items-center gap-1.5 shadow-lg transform group-hover:-translate-y-1 transition-transform duration-300 border-2 border-white/30">
                <Coins size={14} className="fill-yellow-600 stroke-yellow-800" />
                <span className="text-xs font-black">+30</span>
                <Sparkles size={12} className="text-yellow-700 animate-pulse" />
              </div>
              <div className={`
                w-10 h-10 rounded-full bg-white text-gray-800 flex items-center justify-center shadow-lg
                group-hover:bg-white group-hover:text-${color === 'blue' ? 'blue' : 'purple'}-600 transition-colors
              `}>
                {loading ? (
                  <Loader2 size={20} className="animate-spin text-gray-400" />
                ) : (
                  <ExternalLink size={20} className="ml-0.5" strokeWidth={2.5} />
                )}
              </div>
            </div>
          </div>
        </div>
      </button>
    </div>
  );
}