'use client';

import { useState } from 'react';
import { db } from '@/lib/firebase';
import { collection, getDocs, query, where, writeBatch, doc } from 'firebase/firestore';
import { FileUp, Loader2, Settings, Calendar, Copy, AlertTriangle, Trash2 } from 'lucide-react';

interface ShiftImportButtonProps {
  onSuccess?: () => void;
}

// Zoom API呼び出し関数
const createZoomMeeting = async (topic: string, startTime: string, duration: number = 75) => {
  try {
    const res = await fetch('/api/create-zoom-meeting', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ topic, startTime, duration }),
    });
    
    if (!res.ok) {
      console.error("❌ APIエラー Status:", res.status);
      return null;
    }

    const data = await res.json();
    if (data.success) {
      return { 
        meetingId: data.meeting_id, 
        startUrl: data.start_url,
        joinUrl: data.join_url
      };
    }
    console.error("❌ Zoom作成失敗:", data.error);
    return null;
  } catch (e) {
    console.error("❌ 通信エラー:", e);
    return null;
  }
};

export default function ShiftImportButton({ onSuccess }: ShiftImportButtonProps) {
  const [uploading, setUploading] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [encoding, setEncoding] = useState('UTF-8'); 
  const [progress, setProgress] = useState('');

  const [importMode, setImportMode] = useState<'date_match' | 'weekly_repeat'>('date_match');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  // ★追加: ターゲット年度の選択
  const [targetYear, setTargetYear] = useState<number>(new Date().getFullYear());
  const [forceOverwrite, setForceOverwrite] = useState(false);

  // テンプレートDL
  const downloadTemplate = () => {
    const csvContent = '\uFEFF日付,曜日,時限,教科,クラス,単元,場所,ｻｲﾝｲﾝｱﾄﾞﾚｽ,ミーティングID,講師,サポート,枠外(全体サポート)\n12/1,月,1,中3理科,中3理科(生物),力と運動,手柄,sozo_kyoumu@example.com,,鈴木 先生,個安 佐藤 先生,田中 先生(全体)';
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = 'シフト登録テンプレート.csv';
    link.click();
  };

  // 一括削除
  const handleBulkDelete = async () => {
    if (!startDate || !endDate) {
      alert('削除する期間（開始日・終了日）を指定してください。');
      return;
    }
    if (!confirm(`⚠️ 警告 ⚠️\n\n${startDate} ～ ${endDate} の期間に含まれる\n【すべてのシフトデータ】を削除します。\n\n本当によろしいですか？`)) {
      return;
    }

    setDeleting(true);
    setProgress('データ削除中...');

    try {
      const q = query(
        collection(db, 'shift_assignments'), 
        where('target_date', '>=', startDate),
        where('target_date', '<=', endDate)
      );
      const snap = await getDocs(q);
      
      if (snap.empty) {
        alert('指定された期間にデータは見つかりませんでした。');
        setDeleting(false);
        setProgress('');
        return;
      }

      if (!confirm(`対象データ: ${snap.size}件\n\nこれらをすべて削除します。実行しますか？`)) {
        setDeleting(false);
        setProgress('');
        return;
      }

      let batch = writeBatch(db);
      let count = 0;
      let totalDeleted = 0;

      for (const docSnap of snap.docs) {
        batch.delete(doc(db, 'shift_assignments', docSnap.id));
        count++;
        totalDeleted++;

        if (count >= 400) {
          await batch.commit();
          batch = writeBatch(db);
          count = 0;
        }
      }
      if (count > 0) await batch.commit();

      alert(`${totalDeleted}件のデータを削除しました。`);
      if (onSuccess) onSuccess();

    } catch (e: any) {
      console.error(e);
      alert('削除エラー: ' + e.message);
    } finally {
      setDeleting(false);
      setProgress('');
    }
  };

  // ファイル選択時
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (importMode === 'weekly_repeat' && (!startDate || !endDate)) {
      alert('期間指定モードの場合は、開始日と終了日を選択してください。');
      e.target.value = '';
      return;
    }

    if (!confirm(`「${file.name}」を取り込みますか？\n対象年度: ${targetYear}年`)) {
      e.target.value = '';
      return;
    }

    setUploading(true);
    setProgress('ファイル読み込み中...');
    const reader = new FileReader();
    reader.readAsText(file, encoding);

    reader.onload = async (event) => {
      try {
        const text = event.target?.result as string;
        await processGridCSV(text);
        if (onSuccess) onSuccess();
      } catch (err: any) {
        console.error(err);
        alert('インポート失敗:\n' + err.message);
      } finally {
        setUploading(false);
        setProgress('');
        e.target.value = '';
      }
    };
  };

  const parseCSVRows = (text: string) => {
    const result: string[][] = [];
    let row: string[] = [];
    let inQuote = false;
    let cell = '';
    const cleanText = text.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');

    for (let i = 0; i < cleanText.length; i++) {
      const c = cleanText[i];
      if (inQuote) {
        if (c === '"') {
          if (i + 1 < cleanText.length && cleanText[i + 1] === '"') { cell += '"'; i++; } 
          else { inQuote = false; }
        } else { cell += c; }
      } else {
        if (c === '"') { inQuote = true; } 
        else if (c === ',') { row.push(cell.trim()); cell = ''; } 
        else if (c === '\n') { row.push(cell.trim()); result.push(row); row = []; cell = ''; } 
        else { cell += c; }
      }
    }
    if (cell || row.length > 0) { row.push(cell.trim()); result.push(row); }
    return result;
  };

  const getDatesInRange = (start: string, end: string, targetDayOfWeek: string) => {
    const dates: string[] = [];
    const d = new Date(start);
    const e = new Date(end);
    const days = ['日', '月', '火', '水', '木', '金', '土'];
    const targetDay = targetDayOfWeek.replace('曜日', '').trim();
    while (d <= e) {
      if (days[d.getDay()] === targetDay) dates.push(d.toISOString().split('T')[0]);
      d.setDate(d.getDate() + 1);
    }
    return dates;
  };

  const resolveTeacherInfo = (rawName: string, map: Map<string, {id: string, name: string}>) => {
    let clean = rawName.trim();
    if (!clean || ['未', '―', 'Nan', 'nan'].includes(clean) || /^[\d\s]+$/.test(clean)) return null;
    if (clean.includes('⇒')) clean = clean.split('⇒').pop()!.trim();
    if (map.has(clean)) return map.get(clean);
    for (const [regName, data] of Array.from(map.entries())) {
      if (regName.length >= 2 && clean.includes(regName)) return data;
      if (clean.replace(/\s+/g, '') === regName.replace(/\s+/g, '')) return data;
    }
    return null; 
  };

  const processGridCSV = async (csvText: string) => {
    console.clear();
    console.log("🚀 インポート処理開始");
    
    setProgress('講師データ照合中...');
    const teacherMap = new Map<string, {id: string, name: string}>();
    const snapUser = await getDocs(query(collection(db, 'users'), where('role', '==', 'teacher')));
    snapUser.forEach(d => {
      const data = d.data();
      const name = data.student_name || data.name || '';
      if (name) {
        teacherMap.set(name, { id: d.id, name });
        teacherMap.set(name.replace(/\s+/g, ''), { id: d.id, name });
      }
    });

    const rows = parseCSVRows(csvText);
    
    setProgress('既存データの確認中...');
    const existingMainMap = new Map<string, string>(); 
    const existingSubMap = new Map<string, string>(); 
    const existingGeneralMap = new Map<string, string>();

    const snapShift = await getDocs(query(collection(db, 'shift_assignments')));
    snapShift.forEach(d => {
      const data = d.data();
      let period = 0;
      if (data.note?.includes('1限') || data.note?.includes('１限')) period = 1;
      if (data.note?.includes('2限') || data.note?.includes('２限')) period = 2;

      if (data.role_type === 'main') {
        const key = `${data.target_date}_${period}_${data.target_grade}_${data.target_subject}_${data.target_detail_subject}`;
        existingMainMap.set(key, d.id);
      } else if (data.role_type === 'sub') {
        const key = `${data.target_date}_${period}_${data.user_id}_sub`;
        existingSubMap.set(key, d.id);
      } else if (data.role_type === 'general') {
        const key = `${data.target_date}_${period}_${data.user_id}_general`;
        existingGeneralMap.set(key, d.id);
      }
    });

    setProgress('データ登録中...');
    let currentDate = '';
    let currentPeriod = 0;
    
    type ColInfo = { grade: string, subject: string, detail: string, unit: string, place: string, meetingId: string, signinAddress: string, mainShiftId?: string };
    let colMap: (ColInfo | null)[] = [];
    
    const sessionClassCounter = new Map<string, number>();

    let batch = writeBatch(db);
    let count = 0;
    let skipCount = 0;
    let overwriteCount = 0;
    let batchCount = 0;
    let zoomSuccessCount = 0;
    let zoomFailCount = 0;
    let missingTeacherCount = 0;

    for (let r = 0; r < rows.length; r++) {
      const row = rows[r];
      if (row.length === 0) continue;
      
      const col0 = row[0] || '';
      const col1 = (row[1] || '').trim();

      // 日付・時限判定
      const dateMatch = col0.match(/(\d{1,2})[\/月](\d{1,2})/);
      if (dateMatch) {
        const month = parseInt(dateMatch[1]);
        const day = parseInt(dateMatch[2]);
        // ★修正: 選択された targetYear を使用。ただし月が小さくなったタイミングで年を越したとみなす簡易ロジックを入れるか、単純に選択年を使うか。
        // ここでは「選択された年」を基準とし、もし3月までの予定なら翌年扱いにする等のロジックも考えられるが、
        // 単純に「選択された年」を使うのが最も確実（例: 2026年を選べばすべて2026年になる）
        // ただし、年度跨ぎ(3月->4月)のファイルの場合に困るため、
        // 「ファイル内の月が4月以上なら選択年(2025)、3月以下なら選択年+1(2026)」のような年度ロジックを採用
        
        let year = targetYear;
        // 例: ターゲットが2025年度の場合、1~3月は2026年とする
        if (month <= 3) {
           year = targetYear + 1;
        }

        currentDate = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        currentPeriod = 0; 
      }

      const oldPeriod = currentPeriod;
      if (col0.includes('1時間目') || col0.includes('１時間目') || col0.includes('19：20')) currentPeriod = 1;
      else if (col0.includes('2時間目') || col0.includes('２時間目') || col0.includes('20：35')) currentPeriod = 2;
      
      if (currentPeriod !== oldPeriod) {
        sessionClassCounter.clear();
      }

      const isSubjectRow = col1.includes('教科');
      const isClassRow = col1.includes('クラス');
      const isUnitRow = col1.includes('単元');
      const isPlaceRow = col1.includes('場所'); 
      const isZoomRow = col1.includes('ﾐｰﾃｨﾝｸﾞID') || col1.includes('ミーティングID');
      const isSigninRow = col1.includes('ｻｲﾝｲﾝｱﾄﾞﾚｽ') || col1.includes('サインインアドレス');
      const isTeacherRow = col1.includes('講師');
      const isSupportRow = col1.includes('サポート');

      const maxCol = Math.min(row.length, 10); 

      // メタ情報収集
      if (isSubjectRow) {
        colMap = new Array(row.length).fill(null);
        let lastGrade = '';
        let lastSubject = '';
        for (let c = 2; c < maxCol; c++) {
          const val = row[c] || '';
          const norm = val.replace(/[０-９]/g, s => String.fromCharCode(s.charCodeAt(0) - 0xFEE0));
          
          if (norm) {
            if (norm.startsWith('中1') || norm.startsWith('中１')) lastGrade = '中1';
            else if (norm.startsWith('中2') || norm.startsWith('中２')) lastGrade = '中2';
            else if (norm.startsWith('中3') || norm.startsWith('中３')) lastGrade = '中3';
            
            if (norm.includes('理科')) lastSubject = '理科';
            else if (norm.includes('社会')) lastSubject = '社会';
          }
          if (lastGrade && lastSubject) {
            colMap[c] = { grade: lastGrade, subject: lastSubject, detail: '', unit: '', place: '', meetingId: '', signinAddress: '' };
          }
        }
        continue;
      }

      if (isClassRow) { for (let c = 2; c < maxCol; c++) if (colMap[c]) colMap[c]!.detail = (row[c] || '').replace(/[【】]/g, '').trim(); continue; }
      if (isUnitRow) { for (let c = 2; c < maxCol; c++) if (colMap[c]) colMap[c]!.unit = row[c] || ''; continue; }
      if (isPlaceRow) { for (let c = 2; c < maxCol; c++) if (colMap[c]) colMap[c]!.place = row[c] || ''; continue; }
      
      if (isZoomRow) { 
        for (let c = 2; c < maxCol; c++) {
          if (colMap[c]) {
            const val = (row[c] || '').trim();
            colMap[c]!.meetingId = val;
          }
        }
        continue; 
      }
      if (isSigninRow) { for (let c = 2; c < maxCol; c++) if (colMap[c]) colMap[c]!.signinAddress = (row[c] || '').replace(/\s+/g, '').trim(); continue; }

      if (isTeacherRow || isSupportRow) {
        for (let c = 2; c < maxCol; c++) {
          const rawName = (row[c] || '').trim();
          const info = colMap[c];

          if (!info && !rawName) continue;

          let teacherInfo = resolveTeacherInfo(rawName, teacherMap);
          let teacherName = teacherInfo ? teacherInfo.name : rawName;
          let userId = teacherInfo ? teacherInfo.id : '';

          if (isTeacherRow && rawName && !userId && !['未', '―'].includes(rawName)) {
             missingTeacherCount++;
          }

          if (!teacherName || ['未', '―'].includes(teacherName)) {
             if (info) {
               teacherName = '未定';
               userId = ''; 
             } else {
               continue;
             }
          }

          let targetDates = [currentDate];
          if (importMode === 'weekly_repeat') {
            const d = new Date(currentDate);
            const dayOfWeek = ['日','月','火','水','木','金','土'][d.getDay()];
            targetDates = getDatesInRange(startDate, endDate, dayOfWeek);
          }

          for (const targetDate of targetDates) {
            if (!targetDate || !currentPeriod) continue;

            if (info) {
              const roleType = isTeacherRow ? 'main' : 'sub';
              let uniqueDetail = info.detail;
              
              if (roleType === 'main') {
                const counterKey = `${targetDate}_${currentPeriod}_${info.grade}_${info.subject}_${info.detail}`;
                const countVal = (sessionClassCounter.get(counterKey) || 0) + 1;
                sessionClassCounter.set(counterKey, countVal);
                if (countVal > 1) {
                  uniqueDetail = `${uniqueDetail}(${countVal})`;
                }
              }

              let duplicateKey = '';
              let existingId: string | undefined = undefined;

              if (roleType === 'main') {
                duplicateKey = `${targetDate}_${currentPeriod}_${info.grade}_${info.subject}_${uniqueDetail}`;
                existingId = existingMainMap.get(duplicateKey);
              } else {
                const subKeyId = userId || teacherName;
                duplicateKey = `${targetDate}_${currentPeriod}_${subKeyId}_sub`;
                existingId = existingSubMap.get(duplicateKey);
              }

              let zoomInfo = { startUrl: '', joinUrl: '' };
              if (roleType === 'main' && userId) {
                if (!info.meetingId) {
                  const startTimeISO = currentPeriod === 1 
                    ? `${targetDate}T19:20:00` 
                    : `${targetDate}T20:35:00`;
                  
                  setProgress(`Zoom作成中... ${teacherName} @ ${targetDate}`);
                  
                  const created = await createZoomMeeting(
                    `${info.grade}${info.subject} (${teacherName}先生)`, 
                    startTimeISO
                  );
                  
                  if (created) {
                    info.meetingId = String(created.meetingId);
                    zoomInfo.startUrl = created.startUrl;
                    zoomInfo.joinUrl = created.joinUrl;
                    zoomSuccessCount++;
                  } else {
                    zoomFailCount++;
                  }
                }
              }

              const shiftData: any = {
                user_id: userId,
                teacher_name: teacherName,
                target_date: targetDate,
                role_type: roleType,
                target_grade: info.grade,
                target_subject: info.subject,
                target_detail_subject: uniqueDetail,
                target_place: info.place,
                target_meeting_id: info.meetingId,
                target_signin_address: info.signinAddress, 
                start_url: zoomInfo.startUrl || null,
                target_recording_url: zoomInfo.joinUrl || null,
                unit: roleType === 'main' ? info.unit : null,
                parent_id: roleType === 'sub' && targetDate === currentDate ? (info.mainShiftId || null) : null,
                note: `【${currentPeriod}限】`,
                created_at: new Date().toISOString()
              };

              if (existingId) {
                if (forceOverwrite) {
                  batch.set(doc(db, 'shift_assignments', existingId), shiftData, { merge: true });
                  overwriteCount++;
                  if (roleType === 'main' && targetDate === currentDate) info.mainShiftId = existingId;
                } else {
                  skipCount++;
                  if (roleType === 'main' && targetDate === currentDate) info.mainShiftId = existingId;
                }
              } else {
                const newRef = doc(collection(db, 'shift_assignments'));
                batch.set(newRef, shiftData);
                count++;
                if (roleType === 'main') {
                  existingMainMap.set(duplicateKey, newRef.id);
                  if (targetDate === currentDate) info.mainShiftId = newRef.id;
                } else {
                  existingSubMap.set(duplicateKey, newRef.id);
                }
              }

            } else if (userId) {
              const roleType = 'general';
              const duplicateKey = `${targetDate}_${currentPeriod}_${userId}_general`;
              const existingId = existingGeneralMap.get(duplicateKey);

              const shiftData = {
                user_id: userId,
                teacher_name: teacherName,
                target_date: targetDate,
                role_type: roleType,
                target_grade: null,
                target_subject: null,
                target_detail_subject: null,
                target_place: null,
                unit: null,
                parent_id: null,
                note: `【${currentPeriod}限】`,
                created_at: new Date().toISOString()
              };

              if (existingId) {
                if (forceOverwrite) {
                  batch.set(doc(db, 'shift_assignments', existingId), shiftData, { merge: true });
                  overwriteCount++;
                } else {
                  skipCount++;
                }
              } else {
                const newRef = doc(collection(db, 'shift_assignments'));
                batch.set(newRef, shiftData);
                count++;
                existingGeneralMap.set(duplicateKey, newRef.id);
              }
            }

            batchCount++;
            if (batchCount >= 400) { await batch.commit(); batch = writeBatch(db); batchCount = 0; }
          }
        }
      }
    }

    if (batchCount > 0) await batch.commit();

    console.log(`🏁 処理完了: ${count}件追加`);
    
    let msg = `完了: ${count}件 追加`;
    if (overwriteCount > 0) msg += `\n(上書き: ${overwriteCount}件)`;
    if (skipCount > 0) msg += `\n(スキップ: ${skipCount}件)`;
    
    if (zoomSuccessCount > 0) msg += `\n\n🎉 Zoom作成成功: ${zoomSuccessCount}件`;
    if (zoomFailCount > 0) msg += `\n⚠️ Zoom作成失敗: ${zoomFailCount}件`;
    if (missingTeacherCount > 0) msg += `\n⚠️ 講師名不一致: ${missingTeacherCount}件`;

    alert(msg);
  };

  return (
    <div className="flex flex-col gap-4 p-4 bg-white border border-gray-200 rounded-xl shadow-sm">
      <div className="flex flex-col gap-2 border-b border-gray-100 pb-3">
        <label className="text-xs font-bold text-gray-500">インポート設定</label>
        
        {/* ★追加: 年度選択 */}
        <div className="flex items-center gap-2 mb-2">
          <span className="text-xs font-bold text-gray-700">対象年度:</span>
          <select 
            value={targetYear} 
            onChange={(e) => setTargetYear(Number(e.target.value))}
            className="bg-gray-50 border border-gray-200 rounded px-2 py-1 text-xs font-bold"
          >
            <option value={2024}>2024年度 (～2025/3)</option>
            <option value={2025}>2025年度 (～2026/3)</option>
            <option value={2026}>2026年度 (～2027/3)</option>
          </select>
        </div>

        <div className="flex gap-4">
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="radio" name="mode" checked={importMode === 'date_match'} onChange={() => setImportMode('date_match')} className="text-purple-600"/>
            <span className="text-xs font-bold">日付一致 (通常)</span>
          </label>
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="radio" name="mode" checked={importMode === 'weekly_repeat'} onChange={() => setImportMode('weekly_repeat')} className="text-purple-600"/>
            <span className="text-xs font-bold">期間一括 (曜日展開)</span>
          </label>
        </div>
      </div>

      {importMode === 'weekly_repeat' && (
        <div className="space-y-3 animate-in fade-in slide-in-from-top-2">
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1 bg-gray-50 px-2 py-1 rounded border">
              <Calendar size={14} className="text-gray-400"/>
              <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} className="bg-transparent text-xs font-bold outline-none"/>
            </div>
            <span className="text-gray-400 text-xs">～</span>
            <div className="flex items-center gap-1 bg-gray-50 px-2 py-1 rounded border">
              <Calendar size={14} className="text-gray-400"/>
              <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} className="bg-transparent text-xs font-bold outline-none"/>
            </div>
          </div>
          <div className="flex justify-end">
             <button 
                onClick={handleBulkDelete}
                disabled={deleting || uploading}
                className="text-xs font-bold text-red-500 hover:bg-red-50 px-3 py-1.5 rounded flex items-center gap-1 border border-red-100 transition-colors shadow-sm"
              >
                {deleting ? <Loader2 className="animate-spin" size={12}/> : <Trash2 size={12}/>}
                指定期間のシフトを一括削除
              </button>
          </div>
        </div>
      )}

      <div className="flex items-center gap-2 mt-2">
        <input 
          type="checkbox" 
          id="overwrite" 
          checked={forceOverwrite} 
          onChange={e => setForceOverwrite(e.target.checked)}
          className="w-4 h-4 text-purple-600 rounded focus:ring-purple-500 cursor-pointer"
        />
        <label htmlFor="overwrite" className="text-xs font-bold text-gray-600 cursor-pointer select-none flex items-center gap-1">
          <AlertTriangle size={12} className="text-orange-500"/>
          重複データを上書きする
        </label>
      </div>

      <div className="flex justify-between items-center pt-2 mt-2 border-t border-gray-100">
        <div className="flex items-center gap-2 text-xs text-gray-500">
          <Settings size={12}/>
          <select value={encoding} onChange={(e) => setEncoding(e.target.value)} className="bg-transparent font-bold cursor-pointer outline-none">
            <option value="UTF-8">UTF-8</option>
            <option value="Shift_JIS">Shift_JIS</option>
          </select>
        </div>
        
        <div className="relative inline-block">
          <input type="file" accept=".csv" onChange={handleFileUpload} className="absolute inset-0 w-full h-full opacity-0 cursor-pointer" disabled={uploading || deleting} />
          <button disabled={uploading || deleting} className={`flex items-center gap-2 px-4 py-2 rounded-lg font-bold text-xs shadow-sm transition-all text-white ${importMode === 'weekly_repeat' ? 'bg-indigo-600 hover:bg-indigo-700' : 'bg-purple-600 hover:bg-purple-700'}`}>
            {uploading ? <Loader2 className="animate-spin" size={14}/> : importMode === 'weekly_repeat' ? <Copy size={14}/> : <FileUp size={14}/>}
            {uploading ? progress || '処理中' : (importMode === 'weekly_repeat' ? '一括登録' : 'CSV取込')}
          </button>
        </div>
      </div>

      <div className="text-[10px] text-right text-gray-400 mt-1">
        <button onClick={downloadTemplate} className="hover:underline hover:text-blue-500">テンプレートDL</button>
      </div>
    </div>
  );
}