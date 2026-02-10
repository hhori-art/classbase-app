'use client';

import { useState, useEffect } from 'react';
import { db } from '@/lib/firebase';
import { collection, query, where, getDocs } from 'firebase/firestore';
import { Loader2, CalendarX } from 'lucide-react';
import ZoomButton from './ZoomButton';

type Props = {
  profile: any;
  period: 1 | 2;
  startTime: string;
  endTime: string;
};

type ClassButtonData = {
  id: string;
  url: string;
  subject: string;
  teacher: string;
};

export default function SmartClassButton({ profile, period, startTime, endTime }: Props) {
  const [classDataList, setClassDataList] = useState<ClassButtonData[]>([]);
  const [loading, setLoading] = useState(true);
  const [debugLog, setDebugLog] = useState<string[]>([]);

  useEffect(() => {
    const fetchClassUrls = async () => {
      setLoading(true);
      const logs: string[] = [];

      // 正規化関数
      const normalize = (str: string) => {
        if (!str) return "";
        return String(str)
          .replace(/[\s　]+/g, '')
          .toLowerCase()
          .replace(/[０-９]/g, (s) => String.fromCharCode(s.charCodeAt(0) - 0xFEE0))
          .replace(/[Ａ-Ｚａ-ｚ]/g, (s) => String.fromCharCode(s.charCodeAt(0) - 0xFEE0))
          .replace(/①/g, '1').replace(/②/g, '2').replace(/③/g, '3')
          .replace(/④/g, '4').replace(/⑤/g, '5').replace(/⑥/g, '6');
      };

      if (!profile) {
        setLoading(false);
        return;
      }

      // 生徒の科目リスト作成
      const rawSubjects: string[] = [];
      if (Array.isArray(profile.subjects)) rawSubjects.push(...profile.subjects);
      if (profile.subject_science) rawSubjects.push(profile.subject_science);
      if (profile.subject_social) rawSubjects.push(profile.subject_social);
      
      const uniqueSubjects = Array.from(new Set(rawSubjects.filter(s => s)));
      const normalizedStudentSubjects = uniqueSubjects.map(normalize);

      try {
        const d = new Date();
        const todayStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        
        // --- シフト取得 ---
        const shiftsRef = collection(db, 'shift_assignments');
        const qShift = query(shiftsRef, where('target_date', '==', todayStr));
        const snapShift = await getDocs(qShift);
        
        logs.push(`日付: ${todayStr}, 件数: ${snapShift.size}`);

        const matchedClasses: ClassButtonData[] = [];

        // 非同期処理(URLマスタ取得)を行うため for...of ループ
        for (const doc of snapShift.docs) {
          const shift = doc.data();

          // ★修正ポイント1: role_type="sub" を除外
          if (shift.role_type === 'sub') continue;

          // ★修正ポイント2: 講師名に「サポート」が含まれる場合も除外
          const teacherName = String(shift.teacher_name || "");
          if (teacherName.includes("サポート")) continue;

          // --- 時限判定 ---
          let isPeriodMatch = false;
          // A. periodフィールドがある場合
          if (shift.period !== undefined && shift.period !== null && shift.period !== "") {
             // eslint-disable-next-line eqeqeq
             if (shift.period == period) isPeriodMatch = true;
          } 
          // B. periodがない場合、note(備考)を見る
          else {
             const note = String(shift.note || "");
             if (note.includes(String(period))) isPeriodMatch = true;
             
             const detail = String(shift.target_detail_subject || "");
             const circleNum = period === 1 ? "①" : "②";
             if (detail.includes(circleNum)) isPeriodMatch = true;
          }

          if (!isPeriodMatch) continue;

          // --- 科目判定 ---
          const rawShiftSubject = shift.target_detail_subject || shift.target_subject || shift.subject;
          if (!rawShiftSubject) continue;

          const normalizedShiftSubject = normalize(rawShiftSubject);

          // 部分一致チェック
          const isSubjectMatch = normalizedStudentSubjects.some(studentSub => {
            return normalizedShiftSubject.includes(studentSub) || studentSub.includes(normalizedShiftSubject);
          });

          if (isSubjectMatch) {
            logs.push(`★一致: ${rawShiftSubject}`);

            // URL生成 (Meeting ID優先)
            let finalUrl = shift.zoom_url;
            if (!finalUrl && shift.target_meeting_id) {
              const cleanId = String(shift.target_meeting_id).replace(/[\s-]/g, '');
              finalUrl = `https://zoom.us/j/${cleanId}`;
              if (shift.target_password) {
                 finalUrl += `?pwd=${shift.target_password}`;
              }
            }

            // URLがない場合、科目マスタ(subject_urls)を見に行く
            if (!finalUrl) {
              const urlsRef = collection(db, 'subject_urls');
              let qUrl = query(urlsRef, where('subject', '==', rawShiftSubject));
              let snapUrl = await getDocs(qUrl);

              if (snapUrl.empty) {
                const fallbackSubject = shift.target_subject || shift.subject;
                if (fallbackSubject && fallbackSubject !== rawShiftSubject) {
                   qUrl = query(urlsRef, where('subject', '==', fallbackSubject));
                   snapUrl = await getDocs(qUrl);
                }
              }

              if (!snapUrl.empty) {
                finalUrl = snapUrl.docs[0].data().url;
                logs.push(` -> マスタからURL取得`);
              }
            }

            // URLがあれば採用
            if (finalUrl) {
              matchedClasses.push({
                id: doc.id,
                url: finalUrl,
                subject: rawShiftSubject,
                teacher: teacherName || '講師'
              });
            }
          }
        }

        setClassDataList(matchedClasses);
        setDebugLog(logs);

      } catch (error: any) {
        console.error("SmartClassButton Error:", error);
        logs.push(`Error: ${error.message}`);
        setDebugLog(logs);
      } finally {
        setLoading(false);
      }
    };

    fetchClassUrls();
  }, [profile, period]);

  if (loading) {
    return <div className="py-4 text-center"><Loader2 className="animate-spin inline text-indigo-300"/></div>;
  }

  // 表示するものがない場合
  if (classDataList.length === 0) {
    return (
      <div className="w-full flex flex-col gap-2">
        <div className="bg-white/50 border-2 border-dashed border-gray-300 rounded-3xl p-6 flex flex-col items-center justify-center text-gray-400 gap-2">
          <CalendarX size={32} className="opacity-50" />
          <div className="text-sm font-bold text-center">{period}限目の授業はありません</div>
        </div>
        {/* デバッグログ */}
        <div className="bg-black p-2 rounded text-[10px] text-green-400 font-mono max-h-40 overflow-y-auto">
          {debugLog.map((l, i) => <div key={i}>{l}</div>)}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4 w-full animate-in fade-in slide-in-from-bottom-2 duration-500">
      {classDataList.map((classData) => (
        <ZoomButton
          key={classData.id}
          url={classData.url}
          label={`${period}限: ${classData.subject}`}
          subLabel={`${profile.day_of_week}曜クラス | 担当: ${classData.teacher}`}
          color={period === 1 ? 'blue' : 'purple'}
          startTime={startTime}
          endTime={endTime}
          // ★重要: ここでプロフィールを渡すことで、ZoomButton側で名前を指定できます
          userProfile={profile}
        />
      ))}
    </div>
  );
}