'use client';

import { useState, useEffect } from 'react';
import { db } from '@/lib/firebase';
import { collection, query, where, getDocs } from 'firebase/firestore';
import ZoomButton from './ZoomButton';

type Props = {
  profile: any;
  period: 1 | 2;
  startTime: string;
  endTime: string;
};

export default function SmartClassButton({ profile, period, startTime, endTime }: Props) {
  const [zoomUrl, setZoomUrl] = useState<string | null>(null);
  const [displayLabel, setDisplayLabel] = useState<string>('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchClassUrl = async () => {
      // プロフィールがない、または曜日設定がない場合は処理しない
      if (!profile || !profile.day_of_week) {
        setLoading(false);
        return;
      }

      // 生徒の受講科目を特定
      const myScience = profile.subject_science; // 例: "地学"
      const mySocial = profile.subject_social;   // 例: "歴史A"

      // 科目が登録されていない場合は終了
      if (!myScience && !mySocial) {
        setLoading(false);
        return;
      }

      try {
        const today = new Date();
        const todayStr = today.toISOString().split('T')[0];
        let foundUrl = null;
        let subjectName = '';

        // --- A. 今日のシフト(shift_assignments)から探す ---
        // ※今日が授業日でない場合でも、振替などでシフトが入っている可能性を考慮して検索は行います
        const shiftsRef = collection(db, 'shift_assignments');
        const qShift = query(shiftsRef, where('target_date', '==', todayStr));
        const snapShift = await getDocs(qShift);
        const allShifts = snapShift.docs.map(d => d.data());

        const periodStr = period === 1 ? '1限' : '2限';

        // シフトの中から「自分の科目」かつ「今の時限」のものを探す
        const matchedShift = allShifts.find(s => {
          // noteに "1限" や "2限" が含まれているか確認
          const isTimeMatch = s.note?.includes(periodStr);
          // 科目が一致するか確認
          const isScienceMatch = myScience && (s.target_detail_subject === myScience || s.target_subject === myScience);
          const isSocialMatch = mySocial && (s.target_detail_subject === mySocial || s.target_subject === mySocial);
          
          return isTimeMatch && (isScienceMatch || isSocialMatch);
        });

        if (matchedShift) {
          subjectName = matchedShift.target_detail_subject || matchedShift.target_subject;
          
          // ZoomIDがあればURL生成
          if (matchedShift.target_meeting_id) {
            foundUrl = `https://zoom.us/j/${matchedShift.target_meeting_id.replace(/\s/g, '')}`;
          }
        }

        // --- B. シフトにURLがない場合、固定URL(subject_urls)から探す ---
        if (!foundUrl) {
          // 生徒が持っている科目のうち、シフトに該当するもの、なければ登録順で優先度付
          const targetSubject = matchedShift?.target_detail_subject || myScience || mySocial;
          
          if (targetSubject) {
            const urlsRef = collection(db, 'subject_urls');
            const qUrl = query(urlsRef, where('subject', '==', targetSubject));
            const snapUrl = await getDocs(qUrl);

            if (!snapUrl.empty) {
              const urlData = snapUrl.docs[0].data();
              foundUrl = urlData.url;
              if (!subjectName) subjectName = targetSubject;
            }
          }
        }

        // --- C. それでもなければプロフィールのデフォルトURL ---
        if (!foundUrl) {
          // 1限なら zoom_url, 2限なら zoom_url_2
          foundUrl = period === 1 ? profile.zoom_url : profile.zoom_url_2;
        }

        // URLが見つかった場合セット
        if (foundUrl) {
          setZoomUrl(foundUrl);
          setDisplayLabel(subjectName || (myScience || mySocial || '授業'));
        }

      } catch (error) {
        console.error("SmartClassButton Error:", error);
      } finally {
        setLoading(false);
      }
    };

    fetchClassUrl();
  }, [profile, period]);

  if (loading || !zoomUrl) return null;

  return (
    <ZoomButton
      url={zoomUrl}
      label={`${period}限目: ${displayLabel}`}
      subLabel={`${profile.day_of_week}曜クラス`}
      color={period === 1 ? 'blue' : 'purple'}
      startTime={startTime}
      endTime={endTime}
      classDay={profile.day_of_week} // ★重要: ここで曜日を渡してZoomButton側で表示制御する
    />
  );
}