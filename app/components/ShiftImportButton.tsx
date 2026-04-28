'use client';

import { useState } from 'react';
import { db } from '@/lib/firebase';
import { collection, getDocs, query, where, writeBatch, doc } from 'firebase/firestore';
import { FileUp, Loader2, Settings, Calendar, Copy, AlertTriangle, Trash2 } from 'lucide-react';

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
  const [targetYear, setTargetYear] = useState<number>(new Date().getFullYear());
  const [forceOverwrite, setForceOverwrite] = useState(false);

  // 2026年度の講師配置CSVは C〜J 列が授業枠、K列以降が欄外の全体サポート欄。
  // K列以降を授業クラスとして読まないよう、列境界を明示する。
  const LESSON_COLUMN_START = 2; // C列
  const GENERAL_SUPPORT_COLUMN_START = 10; // K列

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
        await processCSV(text); 
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

  const normalizeSupportName = (rawName: string) => {
    return rawName
      .replace(/\r?\n/g, ' ')
      .replace(/\s+/g, ' ')
      .replace(/^【遠】/, '')
      .trim();
  };

  const isIgnorableSupportCell = (rawName: string) => {
    const value = normalizeSupportName(rawName);
    if (!value) return true;
    if (['未', '―', '-', 'ー', '全体サポート', '枠外', 'Nan', 'nan'].includes(value)) return true;
    if (/^[\d\s]+$/.test(value)) return true;
    if (value.includes('@')) return true;
    if (value.includes('ﾐｰﾃｨﾝｸﾞID') || value.includes('ミーティングID')) return true;
    if (value.includes('ｻｲﾝｲﾝｱﾄﾞﾚｽ') || value.includes('サインインアドレス')) return true;
    return false;
  };

  const getGeneralSupportNamesFromOutOfRangeColumns = (row: string[]) => {
    return row
      .slice(GENERAL_SUPPORT_COLUMN_START)
      .map(normalizeSupportName)
      .filter(name => !isIgnorableSupportCell(name));
  };

  const processCSV = async (csvText: string) => {
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
    if (rows.length === 0) return;
    
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
    let batch = writeBatch(db);
    let count = 0;
    let skipCount = 0;
    let overwriteCount = 0;
    let batchCount = 0;
    let missingTeacherCount = 0;

    const commitBatch = async () => {
      if (batchCount > 0) {
        await batch.commit();
        batch = writeBatch(db);
        batchCount = 0;
      }
    };

    const firstRow = rows[0] || [];
    const isListFormat = firstRow.includes('日付') && firstRow.includes('曜日') && firstRow.includes('教科') && firstRow.includes('時限');

    if (isListFormat) {
      console.log("📝 テンプレート(リスト)形式で処理します");
      
      const colIdx = {
        date: firstRow.indexOf('日付'),
        period: firstRow.indexOf('時限'),
        subject: firstRow.indexOf('教科'),
        detail: firstRow.indexOf('クラス'),
        unit: firstRow.indexOf('単元'),
        place: firstRow.indexOf('場所'),
        signin: firstRow.indexOf('ｻｲﾝｲﾝｱﾄﾞﾚｽ') !== -1 ? firstRow.indexOf('ｻｲﾝｲﾝｱﾄﾞﾚｽ') : firstRow.indexOf('サインインアドレス'),
        meeting: firstRow.indexOf('ミーティングID') !== -1 ? firstRow.indexOf('ミーティングID') : firstRow.indexOf('ﾐｰﾃｨﾝｸﾞID'),
        teacher: firstRow.indexOf('講師'),
        support: firstRow.indexOf('サポート'),
        general: firstRow.indexOf('枠外(全体サポート)') !== -1 ? firstRow.indexOf('枠外(全体サポート)') : firstRow.indexOf('枠外')
      };

      for (let r = 1; r < rows.length; r++) {
        const row = rows[r];
        if (row.length < 4 || !row[colIdx.date]) continue;

        const rawDate = row[colIdx.date];
        let currentDate = '';
        const dateMatch = rawDate.match(/(\d{1,2})[\/月](\d{1,2})/);
        if (dateMatch) {
          const month = parseInt(dateMatch[1]);
          const day = parseInt(dateMatch[2]);
          let year = targetYear; // 指定年度のまま処理する
          currentDate = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        } else {
          continue;
        }

        let period = 0;
        const pStr = row[colIdx.period] || '';
        if (pStr.includes('1') || pStr.includes('１')) period = 1;
        else if (pStr.includes('2') || pStr.includes('２')) period = 2;
        if (period === 0) continue;

        const subjectFull = row[colIdx.subject] || '';
        let grade = '', subject = '';
        const normFull = subjectFull.replace(/[０-９]/g, s => String.fromCharCode(s.charCodeAt(0) - 0xFEE0));
        if (normFull.startsWith('中1') || normFull.startsWith('中１')) grade = '中1';
        else if (normFull.startsWith('中2') || normFull.startsWith('中２')) grade = '中2';
        else if (normFull.startsWith('中3') || normFull.startsWith('中３')) grade = '中3';
        
        if (normFull.includes('理科')) subject = '理科';
        else if (normFull.includes('社会')) subject = '社会';

        const detail = colIdx.detail >= 0 ? row[colIdx.detail] || '' : '';
        const unit = colIdx.unit >= 0 ? row[colIdx.unit] || '' : '';
        const place = colIdx.place >= 0 ? row[colIdx.place] || '' : '';
        const signin = colIdx.signin >= 0 ? row[colIdx.signin] || '' : '';
        let meetingId = colIdx.meeting >= 0 ? row[colIdx.meeting] || '' : '';

        const rawTeacher = colIdx.teacher >= 0 ? row[colIdx.teacher] || '' : '';
        const rawSupport = colIdx.support >= 0 ? row[colIdx.support] || '' : '';
        const rawGeneral = colIdx.general >= 0 ? row[colIdx.general] || '' : '';

        let targetDates = [currentDate];
        if (importMode === 'weekly_repeat') {
          const d = new Date(currentDate);
          const dayOfWeek = ['日','月','火','水','木','金','土'][d.getDay()];
          targetDates = getDatesInRange(startDate, endDate, dayOfWeek);
        }

        const insertShift = async (rawName: string, roleType: 'main'|'sub'|'general', mainShiftId?: string) => {
          if (!rawName) return null;
          let teacherInfo = resolveTeacherInfo(rawName, teacherMap);
          let teacherName = teacherInfo ? teacherInfo.name : rawName;
          let userId = teacherInfo ? teacherInfo.id : '';

          if (rawName && !userId && !['未', '―'].includes(rawName)) missingTeacherCount++;
          if (!teacherName || ['未', '―'].includes(teacherName)) {
            if (roleType === 'main') { teacherName = '未定'; userId = ''; }
            else return null;
          }

          let createdMainId: string | undefined = undefined;

          for (const tDate of targetDates) {
            let duplicateKey = '';
            let existingId: string | undefined = undefined;

            if (roleType === 'main') {
              duplicateKey = `${tDate}_${period}_${grade}_${subject}_${detail}`;
              existingId = existingMainMap.get(duplicateKey);
            } else if (roleType === 'sub') {
              const subKeyId = userId || teacherName;
              duplicateKey = `${tDate}_${period}_${subKeyId}_sub`;
              existingId = existingSubMap.get(duplicateKey);
            } else {
              if (!userId) continue;
              duplicateKey = `${tDate}_${period}_userId_general`;
              existingId = existingGeneralMap.get(duplicateKey);
            }

            const shiftData: any = {
              user_id: userId,
              teacher_name: teacherName,
              target_date: tDate,
              role_type: roleType,
              target_grade: roleType !== 'general' ? grade : null,
              target_subject: roleType !== 'general' ? subject : null,
              target_detail_subject: roleType !== 'general' ? detail : null,
              target_place: roleType !== 'general' ? place : null,
              target_meeting_id: roleType === 'main' ? meetingId : null,
              target_signin_address: roleType === 'main' ? signin : null,
              start_url: null,
              target_recording_url: null,
              unit: roleType === 'main' ? unit : null,
              parent_id: roleType === 'sub' && tDate === currentDate ? (mainShiftId || null) : null,
              note: `【${period}限】`,
              created_at: new Date().toISOString()
            };

            let currentDocId = existingId;

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
              currentDocId = newRef.id;

              if (roleType === 'main') existingMainMap.set(duplicateKey, currentDocId);
              else if (roleType === 'sub') existingSubMap.set(duplicateKey, currentDocId);
              else existingGeneralMap.set(duplicateKey, currentDocId);
            }

            if (roleType === 'main' && tDate === currentDate) createdMainId = currentDocId;

            batchCount++;
            if (batchCount >= 400) await commitBatch();
          }
          return createdMainId;
        };

        const mId = await insertShift(rawTeacher, 'main');
        await insertShift(rawSupport, 'sub', mId || undefined);
        await insertShift(rawGeneral, 'general');
      }

    } else {
      console.log("📊 マトリクス(グリッド)形式で処理します");
      
      let currentDate = '';
      let currentPeriod = 0;
      type ColInfo = { grade: string, subject: string, detail: string, unit: string, place: string, meetingId: string, signinAddress: string, mainShiftId?: string };
      let colMap: (ColInfo | null)[] = [];
      const sessionClassCounter = new Map<string, number>();

      let globalZoomIds: string[] = [];
      let globalSigninAddresses: string[] = [];

      for (let r = 0; r < rows.length; r++) {
        const row = rows[r];
        if (row.length === 0) continue;
        
        const col0 = row[0] || '';
        const col1 = (row[1] || '').trim();

        const dateMatch = col0.match(/(\d{1,2})[\/月](\d{1,2})/);
        if (dateMatch) {
          const month = parseInt(dateMatch[1]);
          const day = parseInt(dateMatch[2]);
          let year = targetYear; // 指定年度のまま処理する
          currentDate = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
          currentPeriod = 0; 
        }

        const oldPeriod = currentPeriod;
        // 時刻や数字の表記ゆれ対策
        const normCol0 = col0.replace(/[：]/g, ':').replace(/[０-９]/g, s => String.fromCharCode(s.charCodeAt(0) - 0xFEE0));
        if (normCol0.includes('1時間目') || normCol0.includes('19:20') || normCol0.includes('19:30')) currentPeriod = 1;
        else if (normCol0.includes('2時間目') || normCol0.includes('20:35') || normCol0.includes('20:40')) currentPeriod = 2;
        
        if (currentPeriod !== oldPeriod) {
          sessionClassCounter.clear();
        }

        const isSubjectRow = col1.includes('教科');
        const isClassRow = col1.includes('クラス');
        const isUnitRow = col1.includes('単元');
        const isPlaceRow = col1.includes('場所'); 
        const isZoomRow = col1.includes('ﾐｰﾃｨﾝｸﾞID') || col1.includes('ミーティングID');
        const isSigninRow = col1.includes('ｻｲﾝｲﾝｱﾄﾞﾚｽ') || col1.includes('サインインアドレス');
        const isTeacherRow = col1.includes('講師') || col1.includes('メイン');
        const isSupportRow = col1.includes('サポート') || col1.includes('サブ');
        const isGeneralRow = col1.includes('全体サポート') || col1.includes('枠外');

        const maxCol = row.length;
        const lessonEndCol = Math.min(maxCol, GENERAL_SUPPORT_COLUMN_START);

        const insertGeneralSupport = async (rawName: string, period: number) => {
          const normalizedName = normalizeSupportName(rawName);
          if (isIgnorableSupportCell(normalizedName)) return;

          const teacherInfo = resolveTeacherInfo(normalizedName, teacherMap);
          const teacherName = teacherInfo ? teacherInfo.name : normalizedName;
          const userId = teacherInfo ? teacherInfo.id : '';

          if (normalizedName && !userId) missingTeacherCount++;

          let targetDates = [currentDate];
          if (importMode === 'weekly_repeat') {
            const d = new Date(currentDate);
            const dayOfWeek = ['日','月','火','水','木','金','土'][d.getDay()];
            targetDates = getDatesInRange(startDate, endDate, dayOfWeek);
          }

          for (const targetDate of targetDates) {
            if (!targetDate || !period) continue;

            const duplicateKey = `${targetDate}_${period}_${userId || teacherName}_general`;
            const existingId = existingGeneralMap.get(duplicateKey);
            const shiftData = {
              user_id: userId,
              teacher_name: teacherName,
              target_date: targetDate,
              role_type: 'general',
              target_grade: null,
              target_subject: null,
              target_detail_subject: null,
              target_place: null,
              unit: null,
              parent_id: null,
              note: `【${period}限】全体サポート`,
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

            batchCount++;
            if (batchCount >= 400) await commitBatch();
          }
        };

        const outOfRangeSupportNames = getGeneralSupportNamesFromOutOfRangeColumns(row);
        if (outOfRangeSupportNames.length > 0 && currentDate) {
          const supportPeriod =
            currentPeriod ||
            (col0.includes('集会') || col0.includes('準備') ? 1 : 0);
          if (supportPeriod) {
            for (const supportName of outOfRangeSupportNames) {
              await insertGeneralSupport(supportName, supportPeriod);
            }
          }
        }

        // 全体（ブロック外）に設定されているミーティングIDなどを保持・反映
        if (isZoomRow) { 
          for (let c = LESSON_COLUMN_START; c < lessonEndCol; c++) {
            if (row[c] && row[c].trim()) {
              globalZoomIds[c] = row[c].trim();
              if (colMap[c]) colMap[c]!.meetingId = globalZoomIds[c];
            }
          }
          continue; 
        }
        if (isSigninRow) { 
          for (let c = LESSON_COLUMN_START; c < lessonEndCol; c++) {
            if (row[c] && row[c].trim()) {
              globalSigninAddresses[c] = row[c].replace(/\s+/g, '').trim();
              if (colMap[c]) colMap[c]!.signinAddress = globalSigninAddresses[c];
            }
          }
          continue; 
        }

        // 教科行が見つかったら、このブロックの「ミーティングID」「サインインアドレス」を先読みして設定する
        if (isSubjectRow) {
          colMap = new Array(row.length).fill(null);
          let lastGrade = '';
          let lastSubject = '';
          
          let blockZoomIds: string[] = [];
          let blockSigninAddresses: string[] = [];

          // 下の行を先読みして、現在のブロックのIDとアドレスを取得（行の順番に依存しない）
          for (let scan = r + 1; scan < rows.length; scan++) {
            const scanRow = rows[scan];
            if (!scanRow || scanRow.length === 0) continue;
            const scanCol1 = (scanRow[1] || '').trim();
            if (scanCol1.includes('教科')) break; // 次のブロックに入ったら探索終了
            
            if (scanCol1.includes('ﾐｰﾃｨﾝｸﾞID') || scanCol1.includes('ミーティングID')) {
              const scanEndCol = Math.min(scanRow.length, GENERAL_SUPPORT_COLUMN_START);
              for (let c = LESSON_COLUMN_START; c < scanEndCol; c++) {
                if (scanRow[c] && scanRow[c].trim()) blockZoomIds[c] = scanRow[c].trim();
              }
            }
            if (scanCol1.includes('ｻｲﾝｲﾝｱﾄﾞﾚｽ') || scanCol1.includes('サインインアドレス')) {
              const scanEndCol = Math.min(scanRow.length, GENERAL_SUPPORT_COLUMN_START);
              for (let c = LESSON_COLUMN_START; c < scanEndCol; c++) {
                if (scanRow[c] && scanRow[c].trim()) blockSigninAddresses[c] = scanRow[c].replace(/\s+/g, '').trim();
              }
            }
          }

          for (let c = LESSON_COLUMN_START; c < lessonEndCol; c++) {
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
              colMap[c] = { 
                grade: lastGrade, 
                subject: lastSubject, 
                detail: '', 
                unit: '', 
                place: '', 
                // 先読みしたブロック情報、なければグローバル情報の順に適用
                meetingId: blockZoomIds[c] || globalZoomIds[c] || '', 
                signinAddress: blockSigninAddresses[c] || globalSigninAddresses[c] || '' 
              };
            }
          }
          continue;
        }

        if (isClassRow) { for (let c = LESSON_COLUMN_START; c < lessonEndCol; c++) if (colMap[c]) colMap[c]!.detail = (row[c] || '').replace(/[【】]/g, '').trim(); continue; }
        if (isUnitRow) { for (let c = LESSON_COLUMN_START; c < lessonEndCol; c++) if (colMap[c]) colMap[c]!.unit = row[c] || ''; continue; }
        if (isPlaceRow) { for (let c = LESSON_COLUMN_START; c < lessonEndCol; c++) if (colMap[c]) colMap[c]!.place = row[c] || ''; continue; }

        if (isTeacherRow || isSupportRow || isGeneralRow) {
          const startCol = LESSON_COLUMN_START;
          const endCol = isGeneralRow ? maxCol : lessonEndCol;

          for (let c = startCol; c < endCol; c++) {
            const rawName = (row[c] || '').trim();
            const info = colMap[c];

            if (!info && !rawName) continue;

            let teacherInfo = resolveTeacherInfo(rawName, teacherMap);
            let teacherName = teacherInfo ? teacherInfo.name : rawName;
            let userId = teacherInfo ? teacherInfo.id : '';

            if ((isTeacherRow || isGeneralRow) && rawName && !userId && !['未', '―'].includes(rawName)) {
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

              if (info && !isGeneralRow) {
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
                  start_url: null,
                  target_recording_url: null,
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

              } else if (userId || isGeneralRow) {
                const roleType = 'general';
                const duplicateKey = `${targetDate}_${currentPeriod}_${userId || teacherName}_general`;
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
              if (batchCount >= 400) await commitBatch();
            }
          }
        }
      }
    }

    await commitBatch();

    console.log(`🏁 処理完了: ${count}件追加`);
    
    let msg = `完了: ${count}件 追加`;
    if (overwriteCount > 0) msg += `\n(上書き: ${overwriteCount}件)`;
    if (skipCount > 0) msg += `\n(スキップ: ${skipCount}件)`;
    if (missingTeacherCount > 0) msg += `\n⚠️ 講師名不一致: ${missingTeacherCount}件`;

    alert(msg);
  };

  return (
    <div className="flex flex-col gap-4 p-4 bg-white border border-gray-200 rounded-xl shadow-sm">
      <div className="flex flex-col gap-2 border-b border-gray-100 pb-3">
        <label className="text-xs font-bold text-gray-500">インポート設定</label>
        
        <div className="flex items-center gap-2 mb-2">
          <span className="text-xs font-bold text-gray-700">対象年度:</span>
          <select 
            value={targetYear} 
            onChange={(e) => setTargetYear(Number(e.target.value))}
            className="bg-gray-50 border border-gray-200 rounded px-2 py-1 text-xs font-bold"
          >
            <option value={2024}>2024年度</option>
            <option value={2025}>2025年度</option>
            <option value={2026}>2026年度</option>
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
