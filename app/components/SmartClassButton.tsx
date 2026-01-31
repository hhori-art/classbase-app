'use client';

import { useState, useEffect } from 'react';
import { db } from '@/lib/firebase';
import { collection, query, where, getDocs } from 'firebase/firestore';
import ZoomButton from './ZoomButton';

// ★テストモード: trueにすると曜日・時間外でも強制表示
const TEST_MODE = true; 

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
      if (!profile) return;

      // 1. 曜日のチェック (テストモードなら無視)
      const days = ['日', '月', '火', '水', '木', '金', '土'];
      const today = new Date();
      const todayDayStr = days[today.getDay()];

      if (!TEST_MODE && profile.day_of_week !== todayDayStr) {
        setLoading(false);
        return; // 曜日が違うなら表示しない
      }

      // 2. 生徒の受講科目を特定
      const myScience = profile.subject_science; // 例: "地学"
      const mySocial = profile.subject_social;   // 例: "歴史A"

      // 科目が登録されていない場合は終了
      if (!myScience && !mySocial) {
        setLoading(false);
        return;
      }

      try {
        const todayStr = today.toISOString().split('T')[0];
        let foundUrl = null;
        let subjectName = '';

        // --- A. 今日のシフト(shift_assignments)から探す ---
        const shiftsRef = collection(db, 'shift_assignments');
        const qShift = query(shiftsRef, where('target_date', '==', todayStr));
        const snapShift = await getDocs(qShift);
        const allShifts = snapShift.docs.map(d => d.data());

        const periodStr = period === 1 ? '1限' : '2限';

        // シフトの中から「自分の科目」かつ「今の時限」のものを探す
        const matchedShift = allShifts.find(s => {
          const isTimeMatch = s.note?.includes(periodStr);
          const isScienceMatch = myScience && s.target_detail_subject === myScience;
          const isSocialMatch = mySocial && s.target_detail_subject === mySocial;
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
          // 生徒が持っている科目のうち、シフトに該当するもの、なければ登録順で検索
          const targetSubject = matchedShift?.target_detail_subject || myScience || mySocial;
          
          if (targetSubject) {
            // subject_urls コレクションから "地学_月" のようなID または subjectフィールドで検索
            const urlsRef = collection(db, 'subject_urls');
            // シンプルに科目名で検索 (複数の曜日がある場合はさらに絞り込みが必要ですが、簡易実装として科目名一致を見ます)
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
          // 1限なら zoom_url, 2限なら zoom_url_2 (または両方チェック)
          foundUrl = period === 1 ? profile.zoom_url : profile.zoom_url_2;
        }

        // URLが見つかった場合のみセット
        if (foundUrl) {
          setZoomUrl(foundUrl);
          setDisplayLabel(subjectName || (myScience || mySocial || '授業'));
        }

      } catch (error) {
        // エラー時は何もしない（ボタンを表示しない）
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
      subLabel={profile.day_of_week ? `${profile.day_of_week}曜クラス` : '授業に参加'}
      color={period === 1 ? 'blue' : 'purple'}
      startTime={TEST_MODE ? undefined : startTime}
      endTime={TEST_MODE ? undefined : endTime}
    />
  );
}