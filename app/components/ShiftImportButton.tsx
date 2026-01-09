'use client';

import { useState } from 'react';
import { db } from '@/lib/firebase';
import { collection, getDocs, query, where, writeBatch, doc } from 'firebase/firestore';
import { FileUp, Loader2, Download, Settings, Calendar, Copy, AlertTriangle, Trash2, CheckSquare } from 'lucide-react';

interface ShiftImportButtonProps {
  onSuccess?: () => void;
}

export default function ShiftImportButton({ onSuccess }: ShiftImportButtonProps) {
  const [uploading, setUploading] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [encoding, setEncoding] = useState('UTF-8'); 
  const [progress, setProgress] = useState('');

  const [importMode, setImportMode] = useState<'date_match' | 'weekly_repeat'>('date_match');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [forceOverwrite, setForceOverwrite] = useState(false);

  const downloadTemplate = () => {
    const csvContent = '\uFEFF日付,曜日,時限,教科,クラス,単元,場所,ミーティングID,講師,サポート,枠外(全体サポート)\n12/1,月,1,中3理科,中3理科(生物),力と運動,手柄,123 456 7890,鈴木 先生,個安 佐藤 先生,田中 先生(全体)';
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = 'シフト登録テンプレート.csv';
    link.click();
  };

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

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (importMode === 'weekly_repeat' && (!startDate || !endDate)) {
      alert('期間指定モードの場合は、開始日と終了日を選択してください。');
      e.target.value = '';
      return;
    }

    const modeMsg = importMode === 'date_match' ? 'CSVの日付に合わせて登録' : `CSVの曜日で期間一括登録`;
    const overwriteMsg = forceOverwrite ? '⚠️ 重複は上書き' : '・重複はスキップ';

    if (!confirm(`「${file.name}」を取り込みますか？\n\n【モード】${modeMsg}\n${overwriteMsg}`)) {
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
        alert('インポート処理が完了しました！');
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
    if (!clean || clean === '未' || clean === '―' || clean === 'Nan' || clean.toLowerCase() === 'nan') return null;
    
    // Zoom ID (数字とスペースのみ) を除外
    if (/^[\d\s]+$/.test(clean)) return null;

    if (clean.includes('⇒')) clean = clean.split('⇒').pop()!.trim();

    if (map.has(clean)) return map.get(clean);

    for (const [registeredName, teacherData] of Array.from(map.entries())) {
      if (registeredName.length >= 2 && clean.includes(registeredName)) {
        return teacherData;
      }
      const noSpaceRegistered = registeredName.replace(/\s+/g, '');
      const noSpaceClean = clean.replace(/\s+/g, '');
      if (noSpaceClean.endsWith(noSpaceRegistered) || noSpaceClean === noSpaceRegistered) {
        return teacherData;
      }
    }
    return null; 
  };

  const processGridCSV = async (csvText: string) => {
    setProgress('講師データ照合中...');
    const teacherMap = new Map<string, {id: string, name: string}>();
    const snapUser = await getDocs(query(collection(db, 'users'), where('role', '==', 'teacher')));
    snapUser.forEach(d => {
      const data = d.data();
      const name = data.student_name || data.name || '';
      if (name) {
        const val = { id: d.id, name };
        teacherMap.set(name, val);
        teacherMap.set(name.replace(/\s+/g, ''), val);
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
        // 同じ名前に連番がついている場合も考慮してキーを作成
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
    
    type ColInfo = { grade: string, subject: string, detail: string, unit: string, place: string, meetingId: string, mainShiftId?: string };
    let colMap: (ColInfo | null)[] = [];
    
    // 同じ時限内での同名クラス出現回数をカウントするためのマップ
    // Key: "Date_Period_Grade_Subject_DetailName" -> Count
    const sessionClassCounter = new Map<string, number>();

    const unmatchedTeachers = new Set<string>();
    let batch = writeBatch(db);
    
    let count = 0;
    let skipCount = 0;
    let overwriteCount = 0;
    let batchCount = 0;

    for (let r = 0; r < rows.length; r++) {
      const row = rows[r];
      if (row.length === 0) continue;
      
      const col0 = row[0] || '';
      const col1 = (row[1] || '').trim();

      const dateMatch = col0.match(/(\d{1,2})[\/月](\d{1,2})/);
      if (dateMatch) {
        const month = parseInt(dateMatch[1]);
        const day = parseInt(dateMatch[2]);
        const year = month >= 3 ? 2025 : 2026; 
        currentDate = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        currentPeriod = 0; 
      }

      // 時限変更時にカウンタをリセット
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
      const isTeacherRow = col1.includes('講師');
      const isSupportRow = col1.includes('サポート');

      if (isSubjectRow) {
        colMap = new Array(row.length).fill(null);
        let lastGrade = '';
        let lastSubject = '';
        for (let c = 2; c < row.length; c++) {
          const val = row[c] || '';
          const norm = val.replace(/[０-９]/g, s => String.fromCharCode(s.charCodeAt(0) - 0xFEE0));
          if (norm) {
            if (norm.includes('中1')) lastGrade = '中1';
            else if (norm.includes('中2')) lastGrade = '中2';
            else if (norm.includes('中3')) lastGrade = '中3';
            if (norm.includes('理科')) lastSubject = '理科';
            else if (norm.includes('社会')) lastSubject = '社会';
          }
          if (lastGrade && lastSubject) {
            colMap[c] = { grade: lastGrade, subject: lastSubject, detail: '', unit: '', place: '', meetingId: '' };
          }
        }
        continue;
      }

      if (isClassRow) {
        for (let c = 2; c < row.length; c++) {
          if (colMap[c]) {
            const val = row[c] || '';
            // ★修正: 単純化せず、括弧とスペースを除去した名前をそのまま使う
            // これにより「公民①」「公民②」が区別される
            const detailName = val.replace(/[【】]/g, '').trim();
            colMap[c]!.detail = detailName;
          }
        }
        continue;
      }

      if (isUnitRow) {
        for (let c = 2; c < row.length; c++) {
          if (colMap[c]) colMap[c]!.unit = row[c] || '';
        }
        continue;
      }

      if (isPlaceRow) {
        for (let c = 2; c < row.length; c++) {
          if (colMap[c]) colMap[c]!.place = row[c] || '';
        }
        continue;
      }

      if (isZoomRow) {
        for (let c = 2; c < row.length; c++) {
          if (colMap[c]) colMap[c]!.meetingId = row[c] || '';
        }
        continue;
      }

      // --- 講師 & サポート行 ---
      if (isTeacherRow || isSupportRow) {
        // 行単位で重複回避カウンタを一時コピー（サブ講師などが同じセル参照するため）
        // ただし、講師行ごとにリセットするわけではない。時限ごとに管理。
        
        for (let c = 2; c < row.length; c++) {
          const rawName = row[c];
          if (!rawName) continue;

          const teacherInfo = resolveTeacherInfo(rawName, teacherMap);
          if (!teacherInfo) {
             if (rawName !== '未' && rawName !== '―' && !rawName.includes('NaN') && !/^[\d\s]+$/.test(rawName)) {
               unmatchedTeachers.add(rawName);
             }
             continue;
          }

          let targetDates = [currentDate];
          if (importMode === 'weekly_repeat') {
            const d = new Date(currentDate);
            const dayOfWeek = ['日','月','火','水','木','金','土'][d.getDay()];
            targetDates = getDatesInRange(startDate, endDate, dayOfWeek);
          }

          for (const targetDate of targetDates) {
            if (!targetDate || !currentPeriod) continue;

            if (colMap[c]) {
              // --- 枠内 (Main / Sub) ---
              const info = colMap[c]!;
              const roleType = isTeacherRow ? 'main' : 'sub';
              
              // ★修正: 同名の授業が複数ある場合の重複回避（ナンバリング）
              let uniqueDetail = info.detail;
              
              // メイン講師行のときだけカウンタをインクリメントして名前を決定
              if (roleType === 'main') {
                const counterKey = `${targetDate}_${currentPeriod}_${info.grade}_${info.subject}_${info.detail}`;
                const countVal = (sessionClassCounter.get(counterKey) || 0) + 1;
                sessionClassCounter.set(counterKey, countVal);
                
                if (countVal > 1) {
                  uniqueDetail = `${uniqueDetail}(${countVal})`;
                }
              } else {
                // サポート行は、直前のメイン行で決定された名前（またはID紐付け）を使うべきだが、
                // 簡易的に同じロジックで名前を解決しようとするとズレる可能性がある。
                // ただし、今回は `parent_id` (mainShiftId) を使って紐付けるため、
                // サポートデータの `target_detail_subject` はあくまで表示用。
                // メインIDがあればそれで紐づく。
              }

              let duplicateKey = '';
              let existingId: string | undefined = undefined;

              if (roleType === 'main') {
                duplicateKey = `${targetDate}_${currentPeriod}_${info.grade}_${info.subject}_${uniqueDetail}`;
                existingId = existingMainMap.get(duplicateKey);
              } else {
                duplicateKey = `${targetDate}_${currentPeriod}_${teacherInfo.id}_sub`;
                existingId = existingSubMap.get(duplicateKey);
              }

              const shiftData: any = {
                user_id: teacherInfo.id,
                teacher_name: teacherInfo.name,
                target_date: targetDate,
                role_type: roleType,
                target_grade: info.grade,
                target_subject: info.subject,
                target_detail_subject: uniqueDetail,
                target_place: info.place,
                target_meeting_id: info.meetingId,
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

            } else {
              // --- 枠外 (全体サポート) ---
              const roleType = 'general';
              const duplicateKey = `${targetDate}_${currentPeriod}_${teacherInfo.id}_general`;
              const existingId = existingGeneralMap.get(duplicateKey);

              const shiftData = {
                user_id: teacherInfo.id,
                teacher_name: teacherInfo.name,
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

    let msg = `完了: ${count}件 追加`;
    if (overwriteCount > 0) msg += `\n(上書き: ${overwriteCount}件)`;
    if (skipCount > 0) msg += `\n(スキップ: ${skipCount}件)`;
    if (unmatchedTeachers.size > 0) msg += `\n\n⚠️ 未登録講師:\n${Array.from(unmatchedTeachers).join(', ')}`;

    if (count === 0 && overwriteCount === 0 && skipCount === 0) {
      throw new Error('データが見つかりませんでした。');
    }
    alert(msg);
  };

  return (
    <div className="flex flex-col gap-4 p-4 bg-white border border-gray-200 rounded-xl shadow-sm">
      <div className="flex flex-col gap-2 border-b border-gray-100 pb-3">
        <label className="text-xs font-bold text-gray-500">インポート設定</label>
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