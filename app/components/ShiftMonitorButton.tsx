'use client';

import { useState } from 'react';
import { auth, db } from '@/lib/firebase';
import { collection, query, where, getDocs } from 'firebase/firestore';
import { Grid, Loader2 } from 'lucide-react';

// 親から渡されるProps（assignmentsは使いませんが、型定義エラー防止のため残しています）
type Props = {
  assignments?: any[]; 
  currentDate: string;
};

type ShiftData = {
  id: string;
  teacher_name: string;
  target_date: string;
  target_meeting_id?: string;
  target_password?: string;
  target_grade?: string;
  target_subject?: string;
  target_signin_address?: string;
  start_url?: string;
};

export default function ShiftMonitorButton({ currentDate }: Props) {
  const [loading, setLoading] = useState(false);
  const [statusMessage, setStatusMessage] = useState("");

  // ID正規化（全角→半角、数字以外削除）
  const normalizeMeetingId = (rawId: string | null | undefined): string => {
    if (!rawId) return "";
    return rawId
      .replace(/[０-９]/g, (s) => String.fromCharCode(s.charCodeAt(0) - 0xFEE0))
      .replace(/[^\d]/g, '');
  };

  const handleStartCCTV = async () => {
    const todayStr = currentDate;
    setLoading(true);
    setStatusMessage("データ確認中...");

    try {
      // 1. DBから最新のシフトを取得（画面の古いデータを使わない）
      const q = query(
        collection(db, 'shift_assignments'),
        where('target_date', '==', todayStr)
      );
      const snap = await getDocs(q);
      const latestShifts = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }) as ShiftData);

      // 2. データ整理（重複排除）
      const uniqueMeetings = new Map<string, ShiftData>();

      latestShifts.forEach((shift) => {
        const cleanId = normalizeMeetingId(shift.target_meeting_id);
        
        // 9桁未満（無効なID）は除外
        if (cleanId.length < 9) return;

        // 重複チェック: まだリストになければ追加
        if (!uniqueMeetings.has(cleanId)) {
          uniqueMeetings.set(cleanId, shift);
        }
      });

      const targetShifts = Array.from(uniqueMeetings.values());

      if (targetShifts.length === 0) {
        alert(`指定日(${todayStr})の有効な授業がDBに見つかりませんでした。`);
        setLoading(false);
        return;
      }

      if (!confirm(`【CCTVモード】\n日付: ${todayStr}\n対象: ${targetShifts.length}件\n\n最新データに基づき、全授業をAPI認証(ZAK)でホスト起動します。\n\n※「ポップアップ許可」が必要です。\n開始しますか？`)) {
        setLoading(false);
        return;
      }

      // 3. 順次起動
      // ブラウザ版Zoom (Web Client) の同時起動数制限を回避するため、少し間隔を空けます
      for (let i = 0; i < targetShifts.length; i++) {
        const shift = targetShifts[i];
        const countStr = `(${i + 1}/${targetShifts.length})`;
        
        setStatusMessage(`${countStr} 認証取得...`);

        const meetingId = normalizeMeetingId(shift.target_meeting_id);
        const email = shift.target_signin_address?.trim();
        const safeName = encodeURIComponent(`本部監視(${shift.teacher_name})`);
        
        let url = "";

        // A. APIでZAKトークンを取得 (ホスト権限付与)
        if (email) {
          try {
            const currentUser = auth.currentUser;
            if (!currentUser) throw new Error('not-authenticated');
            const token = await currentUser.getIdToken();
            const res = await fetch('/api/get-zoom-zak', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
              body: JSON.stringify({ email, meetingId, shiftId: shift.id })
            });
            const data = await res.json();

            if (data.success && (data.zak || data.start_url)) {
              // ZAK成功: パスワード不要でホスト開始
              url = data.start_url || data.app_start_url || (data.zak
                ? `https://zoom.us/s/${meetingId}?zak=${encodeURIComponent(data.zak)}`
                : '');
            } else {
              console.warn(`ZAK Error for ${email}:`, data.error);
            }
          } catch (e) {
            console.error("API Fetch Error:", e);
          }
        }

        // B. ZAK失敗時はパスワード方式 (ホスト開始できない可能性あり)
        if (!url) {
          const pwd = shift.target_password || '';
          url = shift.start_url || `https://zoom.us/j/${meetingId}?pwd=${pwd}&uname=${safeName}`;
        }

        setStatusMessage(`${countStr} 起動中...`);

        // 座標計算 (画面分割)
        const total = targetShifts.length;
        const cols = Math.ceil(Math.sqrt(total));
        const rows = Math.ceil(total / cols);
        const screenW = window.screen.availWidth;
        const screenH = window.screen.availHeight;
        const winW = Math.floor(screenW / cols) - 10;
        const winH = Math.floor(screenH / rows) - 10;
        const colIndex = i % cols;
        const rowIndex = Math.floor(i / cols);
        const left = colIndex * (winW + 5);
        const top = rowIndex * (winH + 5);

        // ウィンドウオープン
        const win = window.open(
          url,
          `cctv_${meetingId}`, // ウィンドウ名をID固定にして重複防止
          `width=${winW},height=${winH},left=${left},top=${top},menubar=no,toolbar=no,location=no,status=no,resizable=yes`
        );

        if (!win) {
          alert("ポップアップがブロックされました。\nブラウザの設定で許可してください。");
          break;
        }

        // ★待機時間: 3秒
        // APIコールの時間も含め、確実にセッションを分離するために長めに取ります
        await new Promise(resolve => setTimeout(resolve, 3000));
      }

    } catch (e) {
      console.error(e);
      alert("エラーが発生しました。");
    } finally {
      setLoading(false);
      setStatusMessage("");
    }
  };

  return (
    <button 
      onClick={handleStartCCTV} 
      disabled={loading}
      className="bg-indigo-700 hover:bg-indigo-600 text-white p-1.5 rounded-md transition-all shadow-sm active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5 ml-2 border border-indigo-600"
      title="CCTVモード: 最新シフトを取得して一斉監視"
    >
      {loading ? <Loader2 size={14} className="animate-spin text-indigo-200" /> : <Grid size={14} />}
      <span className="text-[10px] font-bold">
        {loading ? `処理中 ${statusMessage}` : "一斉監視(API)"}
      </span>
    </button>
  );
}
