'use client';

import { useState, useRef } from 'react';
import { Upload, Loader2, FileUp, CheckCircle, AlertCircle } from 'lucide-react';
import { db } from '@/lib/firebase';
import { collection, query, where, getDocs, writeBatch, doc } from 'firebase/firestore';

interface Props {
  role: 'student' | 'teacher';
  onSuccess: () => void;
}

export default function AccountImportButton({ role, onSuccess }: Props) {
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<'idle' | 'success' | 'error'>('idle');
  const [msg, setMsg] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setLoading(true);
    setStatus('idle');
    setMsg('ファイルを読み込み中...');

    const reader = new FileReader();
    reader.onload = async (event) => {
      try {
        const text = event.target?.result as string;
        await processCSV(text);
      } catch (err: any) {
        console.error(err);
        setStatus('error');
        setMsg(`エラー: ${err.message}`);
        setLoading(false);
      }
    };
    reader.readAsText(file); // UTF-8を想定
  };

  const processCSV = async (csvText: string) => {
    const lines = csvText.split(/\r\n|\n/).filter(line => line.trim() !== '');
    if (lines.length < 2) throw new Error('データが見つかりません');

    // ヘッダー行の処理
    const headers = lines[0].split(',').map(h => h.trim());
    const dataLines = lines.slice(1);

    setMsg(`${dataLines.length}件のデータを処理中...`);

    const batchSize = 400; // Firestoreのバッチ制限考慮
    let processedCount = 0;
    let batch = writeBatch(db);
    let opCount = 0;

    for (const line of dataLines) {
      // 簡易CSVパース（カンマ区切り）
      const cols = line.split(',').map(c => c.trim());
      
      let userData: any = null;
      let lifetimeId = '';

      if (role === 'teacher') {
        // 講師CSV形式: 校舎番号, 職員番号, 所属校, 契約書種別, 氏名
        // インデックス: 0:校舎番号, 1:職員番号, 2:所属校, 3:契約書種別, 4:氏名
        
        // ヘッダーチェック（簡易）
        const staffIdIndex = headers.indexOf('職員番号');
        const nameIndex = headers.indexOf('氏名');
        
        // ヘッダーが見つからない場合は固定インデックスで試行
        const staffId = staffIdIndex > -1 ? cols[staffIdIndex] : cols[1];
        const name = nameIndex > -1 ? cols[nameIndex] : cols[4];
        const schoolId = headers.indexOf('校舎番号') > -1 ? cols[headers.indexOf('校舎番号')] : cols[0];
        const schoolName = headers.indexOf('所属校') > -1 ? cols[headers.indexOf('所属校')] : cols[2];
        const contractType = headers.indexOf('契約書種別') > -1 ? cols[headers.indexOf('契約書種別')] : cols[3];

        if (!staffId || !name) continue; // 必須項目なし

        lifetimeId = staffId;
        userData = {
          role: 'teacher',
          name: name,
          lifetime_id: staffId, // 職員番号をIDとして使用
          school_id: schoolId,
          school_name: schoolName,
          contract_type: contractType,
          initial_password: staffId, // 初期パスワードはIDと同じ
          email: `${staffId}@sozogakuen.co.jp`, // ダミーメール（Auth用）
          updated_at: new Date().toISOString()
        };

      } else {
        // 生徒用ロジック（既存想定: 氏名, ID, パスワード...）
        // ※生徒用CSVの仕様に合わせて適宜調整してください。ここでは簡易実装です。
        const name = cols[0];
        const id = cols[1];
        const pass = cols[2];
        
        if (!name || !id) continue;

        lifetimeId = id;
        userData = {
          role: 'student',
          name: name,
          lifetime_id: id,
          initial_password: pass || id,
          updated_at: new Date().toISOString()
        };
      }

      if (userData && lifetimeId) {
        // 既存データのチェック (lifetime_id で検索)
        const q = query(collection(db, 'users'), where('lifetime_id', '==', lifetimeId));
        const snap = await getDocs(q);
        
        let docRef;
        if (!snap.empty) {
          // 既存があれば更新
          docRef = doc(db, 'users', snap.docs[0].id);
        } else {
          // 新規作成 (IDは自動生成またはlifetimeIdを使用可能だが、Auth連携のため自動生成推奨)
          // ここでは一旦新規ドキュメントを作成
          docRef = doc(collection(db, 'users'));
          userData.created_at = new Date().toISOString();
        }

        batch.set(docRef, userData, { merge: true });
        opCount++;
      }

      // バッチ書き込み実行
      if (opCount >= batchSize) {
        await batch.commit();
        batch = writeBatch(db);
        opCount = 0;
      }
      processedCount++;
    }

    if (opCount > 0) {
      await batch.commit();
    }

    setStatus('success');
    setMsg(`${processedCount}件のインポートが完了しました`);
    setLoading(false);
    if (onSuccess) onSuccess();
    
    // 3秒後にリセット
    setTimeout(() => {
      setStatus('idle');
      setMsg('');
      if (fileInputRef.current) fileInputRef.current.value = '';
    }, 3000);
  };

  return (
    <div>
      <input
        type="file"
        accept=".csv"
        className="hidden"
        ref={fileInputRef}
        onChange={handleFileUpload}
        disabled={loading}
      />
      
      {status === 'idle' && (
        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={loading}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg font-bold text-white transition-all shadow-md active:scale-95 ${
            role === 'teacher' 
              ? 'bg-purple-600 hover:bg-purple-700 shadow-purple-200' 
              : 'bg-green-600 hover:bg-green-700 shadow-green-200'
          }`}
        >
          {loading ? <Loader2 className="animate-spin" size={20} /> : <FileUp size={20} />}
          CSVを選択
        </button>
      )}

      {status === 'success' && (
        <div className="flex items-center gap-2 text-green-600 font-bold bg-green-50 px-4 py-2 rounded-lg border border-green-200 animate-in fade-in slide-in-from-bottom-2">
          <CheckCircle size={20} />
          {msg}
        </div>
      )}

      {status === 'error' && (
        <div className="flex items-center gap-2 text-red-600 font-bold bg-red-50 px-4 py-2 rounded-lg border border-red-200 animate-in fade-in slide-in-from-bottom-2">
          <AlertCircle size={20} />
          {msg}
        </div>
      )}
      
      {loading && status !== 'error' && status !== 'success' && (
        <div className="mt-2 text-xs text-gray-500 font-bold animate-pulse">
          {msg}
        </div>
      )}
    </div>
  );
}