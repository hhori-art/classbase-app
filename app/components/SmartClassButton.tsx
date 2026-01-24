'use client';

import { useState, useEffect } from 'react';
import { db } from '@/lib/firebase';
import { collection, query, where, getDocs } from 'firebase/firestore';
import ZoomButton from './ZoomButton';

// ★テストモード: trueにすると時間外でもボタンを表示します
const TEST_MODE = true;

type Props = {
  profile: any;       // 生徒プロフ
  period: 1 | 2;      // 1限 or 2限
  startTime: string;  // "19:20"
  endTime: string;    // "20:25"
};

export default function SmartClassButton({ profile, period, startTime, endTime }: Props) {
  const [zoomUrl, setZoomUrl] = useState<string | null>(null);
  const [displayLabel, setDisplayLabel] = useState<string>('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchClassUrl = async () => {
      // 1. 生徒の登録科目を取得 (理科・社会の両方をチェック)
      // 前回のUserManagementで追加した subject_science / subject_social を参照
      const myScience = profile?.subject_science; // 例: "地学"
      const mySocial = profile?.subject_social;   // 例: "歴史A"

      console.log(`【${period}限】生徒データ確認:`, { myScience, mySocial });

      if (!myScience && !mySocial) {
        console.log(`【${period}限】生徒に科目が登録されていません`);
        setLoading(false);
        return;
      }

      try {
        const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
        
        // 2. 「今日」のシフトを全て取得
        const shiftsRef = collection(db, 'shift_assignments');
        const q = query(shiftsRef, where('target_date', '==', today));
        const snap = await getDocs(q);
        const allShifts = snap.docs.map(d => d.data());

        // 3. マッチング処理
        const periodStr = period === 1 ? '1限' : '2限';
        let matchedShift = null;
        let matchedSubjectName = '';

        // A. 「詳細科目」が完全一致するシフトを探す (最強のマッチング)
        // 例: シフトの「地学」 == 生徒の「地学」
        matchedShift = allShifts.find(s => {
          const isTimeMatch = s.note?.includes(periodStr); // メモに "1限" が含まれているか
          const isScienceMatch = myScience && s.target_detail_subject === myScience;
          const isSocialMatch = mySocial && s.target_detail_subject === mySocial;
          return isTimeMatch && (isScienceMatch || isSocialMatch);
        });

        // B. なければ「親科目(理科/社会)」と「メイン講師」で探す (詳細未設定の場合)
        if (!matchedShift) {
          matchedShift = allShifts.find(s => {
            const isTimeMatch = s.note?.includes(periodStr);
            const isMain = s.role_type === 'main';
            // 生徒が理科を持っていて、シフトが理科の場合
            const isScience = myScience && s.target_subject === '理科'; 
            // 生徒が社会を持っていて、シフトが社会の場合
            const isSocial = mySocial && s.target_subject === '社会';
            return isTimeMatch && isMain && (isScience || isSocial);
          });
        }

        console.log(`【${period}限】マッチング結果:`, matchedShift);

        // 4. URLと表示名の決定
        let foundUrl = null;

        if (matchedShift) {
          // 表示名を作成 (例: "理科 (地学)")
          const detail = matchedShift.target_detail_subject;
          const subject = matchedShift.target_subject;
          matchedSubjectName = detail ? `${subject} (${detail})` : subject;

          if (matchedShift.target_meeting_id) {
            // IDがあればZoomリンク生成
            foundUrl = `https://zoom.us/j/${matchedShift.target_meeting_id.replace(/\s/g, '')}`;
          } else {
            // IDがない場合はURLマスタ等を探す (今回は省略、必要なら追加)
            console.log("シフトは見つかりましたがZoomIDが空です");
          }
        }

        // C. シフトが見つからない場合のフォールバック (生徒プロフィールの固定URL)
        if (!foundUrl) {
          foundUrl = period === 1 ? profile?.zoom_url : profile?.zoom_url_2;
          // フォールバック時の表示名
          if (!matchedSubjectName) {
             // どちらの科目を表示すべきか推定 (曜日などで判定も可能だが、ここでは登録されているものを表示)
             matchedSubjectName = [myScience, mySocial].filter(Boolean).join('・');
          }
        }

        setZoomUrl(foundUrl);
        setDisplayLabel(matchedSubjectName || '授業');

      } catch (error) {
        console.error("URL取得エラー:", error);
      } finally {
        setLoading(false);
      }
    };

    if (profile) {
      fetchClassUrl();
    }
  }, [profile, period]);

  // URLが見つからない場合は非表示
  if (loading || !zoomUrl) return null;

  return (
    <ZoomButton
      url={zoomUrl}
      label={`${period}限目に参加`}
      subLabel={displayLabel} // 科目名を表示 (例: 社会 (地理))
      color={period === 1 ? 'blue' : 'purple'}
      // ★テストモードなら時間を無視(nullを渡すと常時表示)、本番なら時間を渡す
      startTime={TEST_MODE ? undefined : startTime}
      endTime={TEST_MODE ? undefined : endTime}
    />
  );
}