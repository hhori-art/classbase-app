'use client';

import { useState } from 'react';
import { db } from '@/lib/firebase';
import { collection, getDocs, query, where, writeBatch, doc } from 'firebase/firestore';
import { Loader2, Download, Settings, Upload } from 'lucide-react';

export default function AccountImportButton({ role, onSuccess }: { role: 'student' | 'teacher', onSuccess: () => void }) {
  const [uploading, setUploading] = useState(false);
  const [encoding, setEncoding] = useState('UTF-8'); 

  // テンプレートCSVダウンロード
  const downloadTemplate = () => {
    const header = role === 'student' 
      ? '氏,名,生涯番号,パスワード,学年,所属教室,Ⅳ曜日,Ⅳ社,Ⅳ理'
      : '氏名,ID,パスワード';
    const example = role === 'student'
      ? '\n山田,太郎,20001234,class1234,中1,本校,月,地理,理科'
      : '\n鈴木 先生,90001,pass5678';
    
    const csvContent = '\uFEFF' + header + example; 
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `${role === 'student' ? '生徒' : '講師'}登録テンプレート.csv`;
    link.click();
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!confirm(`${role === 'student' ? '生徒' : '講師'}データをCSVから取り込みますか？\n(IDが一致するデータは上書き更新されます)`)) {
      e.target.value = '';
      return;
    }

    setUploading(true);
    const reader = new FileReader();
    reader.readAsText(file, encoding);

    reader.onload = async (event) => {
      try {
        const text = event.target?.result as string;
        await processCSV(text);
        alert('インポートが完了しました！');
        if (onSuccess) onSuccess();
      } catch (err: any) {
        console.error(err);
        alert('エラーが発生しました:\n' + err.message);
      } finally {
        setUploading(false);
        e.target.value = ''; 
      }
    };
  };

  // CSV解析ロジック
  const processCSV = async (csvText: string) => {
    // 1. 既存ユーザーのIDマップを作成 (ID重複による別ドキュメント作成を防止)
    const idMap = new Map<string, string>();
    const q = query(collection(db, 'users')); 
    const snap = await getDocs(q);
    snap.forEach(d => {
      const data = d.data();
      if (data.lifetime_id) {
        // IDを文字列・半角化してキーにする
        const key = String(data.lifetime_id).trim().replace(/[０-９]/g, s => String.fromCharCode(s.charCodeAt(0) - 0xFEE0));
        idMap.set(key, d.id);
      }
    });

    // 2. CSVを行に分割
    const lines = csvText.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');

    // ヘッダー行を探索
    let headerRowIndex = -1;
    let headers: string[] = [];

    for (let i = 0; i < Math.min(10, lines.length); i++) { 
      const row = lines[i].split(',').map(h => h.trim().replace(/"/g, ''));
      if (row.some(h => h.includes('生涯番号') || h.includes('ID') || h.includes('学番'))) {
        headerRowIndex = i;
        headers = row;
        break;
      }
    }

    if (headerRowIndex === -1) {
      throw new Error('ヘッダー行が見つかりません。「生涯番号」または「ID」列が含まれているか確認してください。');
    }

    // ▼▼▼ 列特定ロジック (重複検知防止) ▼▼▼
    const findCol = (keywords: string[], exclude: number[] = []) => {
      // 1. 完全一致優先
      let idx = headers.findIndex((h, i) => !exclude.includes(i) && keywords.some(k => h === k));
      if (idx !== -1) return idx;
      // 2. 部分一致
      return headers.findIndex((h, i) => !exclude.includes(i) && keywords.some(k => h.includes(k)));
    };

    // 先に「氏名（フルネーム）」列を特定
    const idxFullName = findCol(['氏名', '名前', 'フルネーム']);
    
    // 氏名列が見つかった場合、その列インデックスは「姓」「名」の探索から除外する
    const excludeForParts = idxFullName !== -1 ? [idxFullName] : [];

    const idxSei = findCol(['氏', '姓', '苗字'], excludeForParts);
    const idxMei = findCol(['名'], excludeForParts); // 「名前」を含めると氏名と被るが、除外リストで回避

    // その他の列
    const idxId = findCol(['生涯番号', 'ログインID', 'ID', '学番']);
    const idxPass = findCol(['パスワード', 'PWD']);
    const idxGrade = findCol(['学年']);
    const idxClassroom = findCol(['所属教室', '教室']);
    const idxDay = findCol(['Ⅳ曜日', 'IV曜日', '4曜日', '曜日']);
    const idxSubSoc = findCol(['Ⅳ社', 'IV社', '4社', '社会']);
    const idxSubSci = findCol(['Ⅳ理', 'IV理', '4理', '理科']);

    if (idxId === -1) {
      throw new Error(`必須列「生涯番号」が見つかりません。\n(検出された列名: ${headers.join(', ')})`);
    }
    // ▲▲▲ 列特定終了 ▲▲▲

    let batch = writeBatch(db);
    let count = 0;
    let batchCount = 0;

    for (let i = headerRowIndex + 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;

      const row = line.split(',').map(cell => cell.trim().replace(/"/g, '')); 
      
      let rawId = row[idxId];
      if (!rawId) continue;
      
      const lifetimeId = rawId.trim().replace(/[０-９]/g, s => String.fromCharCode(s.charCodeAt(0) - 0xFEE0));

      // ▼▼▼ 名前決定ロジック (修正版) ▼▼▼
      let name = '';
      
      // 姓と名の列が「別々に」存在し、値がある場合のみ結合
      if (idxSei !== -1 && idxMei !== -1 && idxSei !== idxMei) {
         const sei = row[idxSei];
         const mei = row[idxMei];
         if (sei && mei) {
             name = `${sei} ${mei}`.trim();
         }
      }
      
      // 上記で決まっておらず、フルネーム列がある場合
      if (!name && idxFullName !== -1) {
          name = row[idxFullName];
      }
      
      if (!name) name = '名称未設定';
      // ▲▲▲ 名前決定終了 ▲▲▲

      let docId = idMap.get(lifetimeId);
      let isNew = false;
      
      if (!docId) {
        docId = doc(collection(db, 'users')).id;
        idMap.set(lifetimeId, docId);
        isNew = true;
      }
      
      const userRef = doc(db, 'users', docId);

      const userData: any = {
        uid: docId,
        role: role,
        lifetime_id: lifetimeId,
        initial_password: (idxPass !== -1 && row[idxPass]) ? row[idxPass] : 'class1234',
        updated_at: new Date().toISOString()
      };

      if (role === 'student') {
        userData.student_name = name;
        userData.name = null;
        if (idxGrade !== -1) userData.grade = row[idxGrade] || '';
        if (idxClassroom !== -1) userData.classroom = row[idxClassroom] || '';
        if (idxDay !== -1) userData.day_of_week = row[idxDay] || '';
        if (idxSubSoc !== -1) userData.subject_social = row[idxSubSoc] || '';
        if (idxSubSci !== -1) userData.subject_science = row[idxSubSci] || '';
      } else {
        userData.name = name;
        userData.student_name = null;
        userData.grade = null;
        userData.classroom = null;
        userData.day_of_week = null;
      }

      if (isNew) {
        userData.created_at = new Date().toISOString();
      }

      batch.set(userRef, userData, { merge: true });
      count++;
      batchCount++;

      if (batchCount >= 400) {
        await batch.commit();
        batch = writeBatch(db);
        batchCount = 0;
      }
    }

    if (batchCount > 0) {
      await batch.commit();
    }
    
    if (count === 0) {
      throw new Error('データが見つかりませんでした。');
    }
  };

  return (
    <div className="flex flex-col gap-2 items-end">
      {/* テンプレートDL & 設定 */}
      <div className="flex gap-3 text-xs bg-gray-50 p-2 rounded-lg border border-gray-100">
        <button onClick={downloadTemplate} className="text-blue-600 hover:underline flex items-center gap-1">
          <Download size={12}/> テンプレート
        </button>
        <div className="flex items-center gap-1 text-gray-500 border-l pl-3 border-gray-300">
          <Settings size={12}/>
          <span className="mr-1">文字コード:</span>
          <select 
            value={encoding} 
            onChange={(e) => setEncoding(e.target.value)} 
            className="bg-transparent font-bold cursor-pointer text-gray-700 outline-none"
          >
            <option value="UTF-8">UTF-8 (推奨)</option>
            <option value="Shift_JIS">Shift_JIS (Excel)</option>
          </select>
        </div>
      </div>

      {/* アップロードボタン */}
      <div className="relative inline-block group">
        <input
          type="file"
          accept=".csv"
          onChange={handleFileUpload}
          className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
          disabled={uploading}
        />
        <button 
          disabled={uploading}
          className={`flex items-center gap-2 px-5 py-2.5 rounded-full font-bold transition-all shadow-md text-white ${
              role === 'student' 
                ? 'bg-green-600 hover:bg-green-700 shadow-green-200' 
                : 'bg-purple-600 hover:bg-purple-700 shadow-purple-200'
          } ${uploading ? 'opacity-70' : 'group-hover:scale-105'}`}
        >
          {uploading ? <Loader2 className="animate-spin" size={18}/> : <Upload size={18}/>}
          {role === 'student' ? '生徒' : '講師'}CSV一括登録
        </button>
      </div>
    </div>
  );
}