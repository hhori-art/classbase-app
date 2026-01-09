'use client';

import { useState } from 'react';
import { db } from '@/lib/firebase';
import { collection, getDocs, query, where, writeBatch, doc } from 'firebase/firestore';
import { FileText, Loader2, Download, Settings } from 'lucide-react';

export default function PfImportButton({ onSuccess }: { onSuccess?: () => void }) {
  const [uploading, setUploading] = useState(false);
  const [encoding, setEncoding] = useState('Shift_JIS');

  const downloadTemplate = () => {
    const csv = '\uFEFFNo.,氏名,性別,生涯番号,学年,クラス,曜日,教室,数学,英語,国語,理科,社会\n1,山田 太郎,男,10001,中1,A,月,本校,80,75,90,85,70';
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = 'PFデータテンプレート.csv';
    link.click();
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    
    // ファイル名から年度を取得 (例: "2025_成績.csv" -> 2025)
    const yearMatch = file.name.match(/20[0-9]{2}/);
    const year = yearMatch ? yearMatch[0] : new Date().getFullYear().toString();

    if (!confirm(`${year}年度のPFデータを取り込みますか？\n(生徒の曜日・学年情報も更新されます)`)) {
      e.target.value = '';
      return;
    }

    setUploading(true);
    const reader = new FileReader();
    reader.readAsText(file, encoding);

    reader.onload = async (event) => {
      try {
        const text = event.target?.result as string;
        await processCSV(text, year);
        alert('インポート完了');
        if (onSuccess) onSuccess();
      } catch (err: any) {
        console.error(err);
        alert('エラー: ' + err.message);
      } finally {
        setUploading(false);
        e.target.value = '';
      }
    };
  };

  const processCSV = async (csvText: string, year: string) => {
    // 1. 生徒IDマップ作成 (生涯番号 -> DocID)
    const idMap = new Map<string, string>();
    const q = query(collection(db, 'users'), where('role', '==', 'student'));
    const snap = await getDocs(q);
    snap.forEach(d => {
      const data = d.data();
      if (data.lifetime_id) idMap.set(String(data.lifetime_id), d.id);
    });

    // 2. CSV解析
    const lines = csvText.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
    const headers = lines[0].split(',').map(h => h.trim());

    const idx = {
      lifetimeId: headers.indexOf('生涯番号'), // 必須
      name: headers.indexOf('氏名'),
      grade: headers.indexOf('学年'),
      day: headers.indexOf('曜日'),
      classroom: headers.findIndex(h => h.includes('教室')), // "教室名"などの表記ゆれ対応
      subjects: headers.filter(h => !['No.', '氏名', '性別', '生涯番号', '学年', 'クラス', '曜日', '教室'].includes(h) && h)
    };

    if (idx.lifetimeId === -1) throw new Error('「生涯番号」列が見つかりません');

    let batch = writeBatch(db);
    let count = 0;

    for (let i = 1; i < lines.length; i++) {
      const row = lines[i].split(',');
      if (row.length < 2) continue;

      const lifetimeId = row[idx.lifetimeId]?.trim();
      const studentDocId = idMap.get(lifetimeId);

      // 登録済みの生徒のみ処理
      if (!studentDocId) continue;

      // (A) PFデータ保存 (サブコレクション 'pf_yearly' に年度ごとに保存)
      const pfData: any = { year, updated_at: new Date().toISOString() };
      idx.subjects.forEach(subj => {
        const colIdx = headers.indexOf(subj);
        if (colIdx !== -1) pfData[subj] = row[colIdx]?.trim();
      });
      
      const pfRef = doc(db, 'users', studentDocId, 'pf_yearly', year);
      batch.set(pfRef, pfData, { merge: true });

      // (B) 生徒プロフィール更新 (曜日、学年、教室)
      // ★ここが重要: 常に最新のCSVに合わせてユーザー情報を更新します
      const userUpdate: any = {};
      if (idx.day !== -1 && row[idx.day]) userUpdate.day_of_week = row[idx.day].trim();
      if (idx.grade !== -1 && row[idx.grade]) userUpdate.grade = row[idx.grade].trim();
      if (idx.classroom !== -1 && row[idx.classroom]) userUpdate.classroom = row[idx.classroom].trim();
      
      if (Object.keys(userUpdate).length > 0) {
        batch.update(doc(db, 'users', studentDocId), userUpdate);
      }

      count++;
      if (count >= 400) { await batch.commit(); batch = writeBatch(db); count = 0; }
    }

    if (count > 0) await batch.commit();
  };

  return (
    <div className="flex flex-col gap-2 items-end">
      <div className="flex gap-3 text-xs">
        <button onClick={downloadTemplate} className="text-blue-600 hover:underline flex items-center gap-1"><Download size={12}/> テンプレートDL</button>
        <div className="flex items-center gap-1 text-gray-500"><Settings size={12}/>
          <select value={encoding} onChange={(e) => setEncoding(e.target.value)} className="bg-transparent font-bold cursor-pointer">
            <option value="Shift_JIS">Shift_JIS</option><option value="UTF-8">UTF-8</option>
          </select>
        </div>
      </div>
      <div className="relative inline-block">
        <input type="file" accept=".csv" onChange={handleFileUpload} className="absolute inset-0 w-full h-full opacity-0 cursor-pointer" disabled={uploading} />
        <button disabled={uploading} className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg font-bold hover:bg-blue-700 transition-colors shadow-sm disabled:opacity-50">
          {uploading ? <Loader2 className="animate-spin" size={18}/> : <FileText size={18}/>} PFデータ取込
        </button>
      </div>
    </div>
  );
}