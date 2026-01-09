'use client';

import { useState } from 'react';
import { 
  FileSpreadsheet, Upload, Trash2, Search, ArrowLeft, Users, 
  GraduationCap, UserPlus, Save, XCircle, RefreshCw, Settings, Loader2, AlertTriangle
} from 'lucide-react';
import Link from 'next/link';
import { db } from '@/lib/firebase';
import { collection, doc, writeBatch, setDoc, query, getDocs, where, deleteDoc } from 'firebase/firestore';

export default function AccountsPage() {
  const [activeTab, setActiveTab] = useState<'student' | 'teacher' | 'create'>('student');
  const [loading, setLoading] = useState(false);
  const [log, setLog] = useState<string[]>([]);
  
  // 文字コード設定 (デフォルトはExcel用のShift_JIS)
  const [encoding, setEncoding] = useState('Shift_JIS'); 
  
  // 検索・削除用
  const [searchQuery, setSearchQuery] = useState('');
  const [searchRole, setSearchRole] = useState<'student' | 'teacher'>('student');
  const [searchResults, setSearchResults] = useState<any[]>([]);

  // 個別作成フォーム
  const [singleForm, setSingleForm] = useState({
    role: 'student',
    lifetime_id: '',
    name: '',
    email: '',
    grade: '中1',
    password: 'class1234'
  });

  const addLog = (msg: string) => setLog(prev => [`${new Date().toLocaleTimeString()} : ${msg}`, ...prev]);

  // ----------------------------------------------------------------
  // CSVインポート
  // ----------------------------------------------------------------
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    
    if (!confirm(`【${activeTab === 'student' ? '生徒' : '講師'}】CSVを取り込みますか？\n\n現在の文字コード設定: ${encoding}\n(文字化けする場合は、設定を切り替えてやり直してください)`)) {
      e.target.value = '';
      return;
    }

    setLoading(true);
    setLog([]);
    addLog(`ファイル読み込み開始 (${encoding})...`);

    const reader = new FileReader();
    
    reader.onload = async (event) => {
      try {
        const text = event.target?.result as string;
        // 改行コード統一
        const rows = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
        
        if (activeTab === 'student') await importStudents(rows);
        else if (activeTab === 'teacher') await importTeachers(rows);
        
      } catch (err: any) {
        addLog(`❌ エラー: ${err.message}`);
        console.error(err);
      } finally {
        setLoading(false);
        e.target.value = '';
        
        // 更新
        if (activeTab === 'student' || activeTab === 'teacher') {
          setSearchRole(activeTab);
          setTimeout(() => handleFetchAll(activeTab), 500);
        }
      }
    };

    reader.readAsText(file, encoding);
  };

  // 生徒インポート (列自動判定 & 学年整形)
  const importStudents = async (rows: string[]) => {
    // 既存IDのマップを作成（重複チェック用）
    const idMap = new Map<string, string>();
    const snap = await getDocs(query(collection(db, 'users'), where('role', '==', 'student')));
    snap.forEach(d => {
      const data = d.data();
      if (data.lifetime_id) idMap.set(String(data.lifetime_id), d.id);
    });

    let batch = writeBatch(db);
    let count = 0;
    let batchCount = 0;
    
    // 1. ヘッダー行を探す
    let headerIndex = -1;
    for (let i = 0; i < Math.min(20, rows.length); i++) {
      if (rows[i].includes('生涯番号')) { headerIndex = i; break; }
    }
    
    if (headerIndex === -1) {
      addLog('⚠️ ヘッダー行("生涯番号")が見つかりません。処理を中断します。');
      return;
    }

    // 2. 列のインデックスを特定
    const headerRow = rows[headerIndex].split(',').map(c => c.replace(/^"|"$/g, '').trim());
    const idx = {
      id: headerRow.findIndex(h => h.includes('生涯番号')),
      grade: headerRow.findIndex(h => h.includes('学年')),
      classroom: headerRow.findIndex(h => h.includes('所属教室') || h.includes('教室')),
      lastName: headerRow.indexOf('氏'),
      firstName: headerRow.indexOf('名'),
      phone: headerRow.findIndex(h => h.includes('電話'))
    };

    if (idx.id === -1) {
      addLog('❌ エラー: "生涯番号" 列が見つかりません。');
      return;
    }

    addLog(`ヘッダー検出: 行${headerIndex + 1} (ID列:${idx.id}, 氏名列:${idx.lastName},${idx.firstName})`);

    // 3. データ登録
    for (let i = headerIndex + 1; i < rows.length; i++) {
      const row = rows[i];
      if (!row.trim()) continue;
      
      const cols = row.split(',').map(c => c.replace(/^"|"$/g, '').trim());
      const lifetimeId = cols[idx.id]; 
      
      if (!lifetimeId || isNaN(Number(lifetimeId))) continue; 
      
      // 名前結合
      let fullName = '名称不明';
      if (idx.lastName !== -1 && idx.firstName !== -1) {
        fullName = `${cols[idx.lastName] || ''} ${cols[idx.firstName] || ''}`.trim();
      } else {
        const nameIdx = headerRow.findIndex(h => h.includes('氏名') || h.includes('名前'));
        if (nameIdx !== -1) fullName = cols[nameIdx];
      }
      if (!fullName) fullName = '名称不明';

      // 学年の自動整形
      let rawGrade = (idx.grade !== -1 ? cols[idx.grade] : '') || '';
      let cleanGrade = rawGrade.replace(/[★☆◆◇●○\s]/g, '');
      cleanGrade = cleanGrade.replace(/[Ａ-Ｚａ-ｚ０-９]/g, (s) => {
        return String.fromCharCode(s.charCodeAt(0) - 0xFEE0);
      });

      // 既存IDがあればそのドキュメントIDを使う、なければ新規
      let docId = idMap.get(lifetimeId);
      if (!docId) docId = doc(collection(db, 'users')).id;

      const userRef = doc(db, 'users', docId);
      
      const userData: any = {
        role: 'student',
        lifetime_id: lifetimeId,
        student_name: fullName,
        grade: cleanGrade, 
        classroom: (idx.classroom !== -1 ? cols[idx.classroom] : '') || '', 
        phone_number: (idx.phone !== -1 ? cols[idx.phone] : '') || '', 
        initial_password: 'class1234',
        updated_at: new Date().toISOString()
      };

      // 新規作成時のみ設定
      if (!idMap.has(lifetimeId)) {
        userData.created_at = new Date().toISOString();
        userData.uid = docId;
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

    if (batchCount > 0) await batch.commit();

    if (count > 0) { 
      addLog(`✅ 完了: ${count}件の生徒データを登録しました`); 
    } else { 
      addLog('⚠️ 登録対象データがありませんでした。'); 
    }
  };

  // 講師インポート
  const importTeachers = async (rows: string[]) => {
    let batch = writeBatch(db);
    let count = 0;
    let batchCount = 0;
    
    let headerIndex = -1;
    for (let i = 0; i < Math.min(20, rows.length); i++) {
      if (rows[i].includes('生涯番号') || rows[i].includes('氏')) { headerIndex = i; break; }
    }
    if (headerIndex === -1) headerIndex = 0;

    for (let i = headerIndex + 1; i < rows.length; i++) {
      const row = rows[i];
      if (!row.trim()) continue;
      const cols = row.split(',').map(c => c.replace(/^"|"$/g, '').trim());
      
      const col0 = cols[0]; // おそらくID
      const col1 = cols[1]; // おそらく名前

      let id = '';
      let name = '';
      
      // 簡易判定
      if (!isNaN(Number(col0)) && col0.length > 4) {
        id = col0;
        name = col1 || '名称未設定';
      } else {
        name = col0;
      }
      
      if (!name) continue;

      const userRef = doc(collection(db, 'users'));
      batch.set(userRef, {
        uid: userRef.id,
        role: 'teacher',
        lifetime_id: id,
        name: name,
        email: '',
        initial_password: 'class1234',
        created_at: new Date().toISOString()
      });
      count++;
      batchCount++;

      if (batchCount >= 400) {
        await batch.commit();
        batch = writeBatch(db);
        batchCount = 0;
      }
    }
    
    if (batchCount > 0) await batch.commit();

    if (count > 0) { 
      addLog(`✅ 完了: ${count}件の講師データを登録しました`); 
    }
  };

  // 個別作成
  const handleSingleCreate = async () => {
    if (!singleForm.name) return alert('名前は必須です');
    if (!singleForm.lifetime_id) return alert('ログインIDは必須です');
    
    setLoading(true);
    try {
      const userRef = doc(collection(db, 'users'));
      const userData: any = {
        uid: userRef.id,
        role: singleForm.role,
        lifetime_id: singleForm.lifetime_id,
        initial_password: singleForm.password,
        created_at: new Date().toISOString()
      };
      
      if (singleForm.role === 'student') {
        userData.student_name = singleForm.name;
        // 個別作成時も整形
        userData.grade = singleForm.grade.replace(/[★☆\s]/g, '').replace(/[Ａ-Ｚａ-ｚ０-９]/g, s => String.fromCharCode(s.charCodeAt(0) - 0xFEE0));
      } else {
        userData.name = singleForm.name;
        userData.email = singleForm.email;
      }
      await setDoc(userRef, userData);
      alert('作成しました！');
      setSingleForm({ ...singleForm, name: '', lifetime_id: '', email: '' });
      
      if (singleForm.role === 'student' || singleForm.role === 'teacher') {
        setSearchRole(singleForm.role);
        handleFetchAll(singleForm.role); 
      }
    } catch (e: any) { alert('エラー: ' + e.message); } 
    finally { setLoading(false); }
  };

  // ----------------------------------------------------------------
  // 検索・全件表示・削除機能
  // ----------------------------------------------------------------
  const handleFetchAll = async (roleOverride?: 'student' | 'teacher') => {
    const targetRole = roleOverride || searchRole;
    setLoading(true);
    setSearchResults([]);
    try {
      const q = query(collection(db, 'users'), where('role', '==', targetRole));
      const snapshot = await getDocs(q);
      const results: any[] = [];
      snapshot.forEach(doc => {
        results.push({ uid: doc.id, ...doc.data() });
      });
      setSearchResults(results);
      if (results.length === 0) addLog('データが見つかりませんでした');
    } catch (e: any) { alert('エラー: ' + e.message); } 
    finally { setLoading(false); }
  };

  const handleSearch = async () => {
    if (!searchQuery.trim()) return handleFetchAll();
    setLoading(true);
    setSearchResults([]);
    try {
      const q = query(collection(db, 'users'), where('role', '==', searchRole));
      const snapshot = await getDocs(q);
      const results: any[] = [];
      snapshot.forEach(doc => {
        const d = doc.data();
        const str = JSON.stringify(d).toLowerCase();
        if (str.includes(searchQuery.toLowerCase())) {
          results.push({ uid: doc.id, ...d });
        }
      });
      setSearchResults(results);
    } catch (e: any) { alert('エラー: ' + e.message); } 
    finally { setLoading(false); }
  };

  const handleBulkDelete = async () => {
    const count = searchResults.length;
    if (count === 0) return;
    if (!confirm(`【危険】表示されている ${count} 件のデータを全て削除しますか？`)) return;

    setLoading(true);
    try {
      const chunks = [];
      for (let i = 0; i < searchResults.length; i += 400) {
        chunks.push(searchResults.slice(i, i + 400));
      }
      for (const chunk of chunks) {
        const batch = writeBatch(db);
        chunk.forEach((user: any) => batch.delete(doc(db, 'users', user.uid)));
        await batch.commit();
      }
      alert(`完了: ${count} 件を削除しました。`);
      setSearchResults([]);
    } catch (e: any) { alert('一括削除エラー: ' + e.message); } 
    finally { setLoading(false); }
  };

  const handleDelete = async (uid: string) => {
    if (!confirm(`このデータを削除しますか？`)) return;
    try {
      await deleteDoc(doc(db, 'users', uid));
      setSearchResults(prev => prev.filter(u => u.uid !== uid));
    } catch (e: any) { alert('削除エラー: ' + e.message); }
  };

  return (
    <div className="min-h-screen bg-gray-50 p-8 pb-40">
      <div className="max-w-5xl mx-auto">
        <div className="flex items-center gap-4 mb-8">
          <Link href="/master" className="bg-white p-2 rounded-full shadow hover:bg-gray-50 text-gray-600">
            <ArrowLeft size={24} />
          </Link>
          <h1 className="text-2xl font-bold text-gray-800 flex items-center gap-2">
            <FileSpreadsheet className="text-blue-600" /> アカウント発行・管理
          </h1>
        </div>

        {/* CSVインポートエリア */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden mb-8">
          <div className="flex border-b overflow-x-auto">
            <button onClick={() => setActiveTab('student')} className={`flex-1 py-4 font-bold flex items-center justify-center gap-2 min-w-[140px] ${activeTab === 'student' ? 'bg-green-50 text-green-700 border-b-2 border-green-500' : 'text-gray-500 hover:bg-gray-50'}`}>
              <GraduationCap size={20}/> 生徒CSV
            </button>
            <button onClick={() => setActiveTab('teacher')} className={`flex-1 py-4 font-bold flex items-center justify-center gap-2 min-w-[140px] ${activeTab === 'teacher' ? 'bg-purple-50 text-purple-700 border-b-2 border-purple-500' : 'text-gray-500 hover:bg-gray-50'}`}>
              <Users size={20}/> 講師CSV
            </button>
            <button onClick={() => setActiveTab('create')} className={`flex-1 py-4 font-bold flex items-center justify-center gap-2 min-w-[140px] ${activeTab === 'create' ? 'bg-orange-50 text-orange-700 border-b-2 border-orange-500' : 'text-gray-500 hover:bg-gray-50'}`}>
              <UserPlus size={20}/> 個別作成
            </button>
          </div>

          <div className="p-8">
            {activeTab === 'create' ? (
              // 個別作成フォーム
              <div className="max-w-lg mx-auto space-y-4">
                <h3 className="text-lg font-bold text-gray-800 text-center mb-6">アカウント手動作成</h3>
                <div className="flex gap-4 p-4 bg-gray-50 rounded-lg justify-center">
                  <label className="flex items-center gap-2 cursor-pointer"><input type="radio" checked={singleForm.role === 'student'} onChange={() => setSingleForm({...singleForm, role: 'student'})} /> 生徒</label>
                  <label className="flex items-center gap-2 cursor-pointer"><input type="radio" checked={singleForm.role === 'teacher'} onChange={() => setSingleForm({...singleForm, role: 'teacher'})} /> 講師</label>
                </div>
                <input type="text" placeholder="ログインID (生涯番号)" className="w-full p-3 border rounded font-mono" value={singleForm.lifetime_id} onChange={e => setSingleForm({...singleForm, lifetime_id: e.target.value})} />
                <input type="text" placeholder="氏名" className="w-full p-3 border rounded" value={singleForm.name} onChange={e => setSingleForm({...singleForm, name: e.target.value})} />
                <button onClick={handleSingleCreate} disabled={loading} className="w-full bg-orange-500 text-white font-bold py-3 rounded-lg hover:bg-orange-600 flex items-center justify-center gap-2">
                  <Save size={20}/> 保存する
                </button>
              </div>
            ) : (
              // CSVアップロード
              <>
                <div className="flex flex-col md:flex-row justify-between items-center mb-4 gap-4">
                  <div className="text-sm font-bold text-gray-600">
                    {activeTab === 'student' ? '生徒データ' : '講師データ'}をインポート
                  </div>
                  
                  {/* 文字コード選択 */}
                  <div className="flex items-center gap-2 bg-yellow-50 border border-yellow-200 px-4 py-2 rounded-lg">
                    <Settings size={16} className="text-yellow-600"/>
                    <span className="text-xs font-bold text-gray-600">文字コード:</span>
                    <select 
                      value={encoding} 
                      onChange={(e) => setEncoding(e.target.value)} 
                      className="text-sm bg-transparent border-none outline-none font-bold text-blue-600 cursor-pointer"
                    >
                      <option value="Shift_JIS">Shift_JIS (Excel作成など)</option>
                      <option value="UTF-8">UTF-8 (Googleなど)</option>
                    </select>
                  </div>
                </div>

                <div className="border-2 border-dashed border-gray-300 rounded-xl p-8 text-center bg-gray-50 hover:bg-gray-100 transition-colors relative group">
                  <input 
                    type="file" 
                    accept=".csv" 
                    onChange={handleFileUpload} 
                    className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10" 
                    disabled={loading} 
                  />
                  <div className="flex flex-col items-center gap-3 group-hover:scale-105 transition-transform">
                    {loading ? <Loader2 className="animate-spin text-blue-600" size={48} /> : <Upload size={48} className="text-gray-400 group-hover:text-blue-500" />}
                    <h3 className="text-lg font-bold text-gray-700">
                      {loading ? '処理中...' : 'ここにCSVをドラッグ＆ドロップ'}
                    </h3>
                    <p className="text-xs text-gray-400">またはクリックしてファイルを選択</p>
                  </div>
                </div>
                
                <div className="mt-4 bg-gray-900 text-green-400 p-4 rounded-xl text-xs font-mono h-32 overflow-y-auto">
                  {log.length === 0 ? '> 待機中...' : log.map((l, i) => <div key={i}>{l}</div>)}
                </div>
              </>
            )}
          </div>
        </div>

        {/* データ検索・削除エリア */}
        <div className="bg-white rounded-2xl shadow-sm border border-red-100 overflow-hidden">
          <div className="bg-red-50 p-4 border-b border-red-100 flex justify-between items-center">
            <h2 className="font-bold text-red-800 flex items-center gap-2"><AlertTriangle size={20}/> データメンテナンス</h2>
          </div>
          <div className="p-6">
            <div className="flex flex-col md:flex-row gap-2 mb-6">
              <select className="p-3 border rounded-lg bg-gray-50 font-bold text-gray-700" value={searchRole} onChange={(e) => setSearchRole(e.target.value as any)}>
                <option value="student">生徒データを検索</option>
                <option value="teacher">講師データを検索</option>
              </select>
              
              <button 
                onClick={() => handleFetchAll()} 
                disabled={loading} 
                className="bg-gray-200 text-gray-700 px-4 py-3 rounded-lg font-bold hover:bg-gray-300 transition-colors flex items-center justify-center gap-2 whitespace-nowrap"
              >
                <RefreshCw size={16}/> 全件表示
              </button>

              <div className="flex-1 relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18}/>
                <input 
                  type="text" 
                  className="w-full pl-10 pr-4 py-3 border rounded-lg outline-none focus:ring-2 focus:ring-blue-500" 
                  placeholder="名前やIDで検索..." 
                  value={searchQuery} 
                  onChange={e => setSearchQuery(e.target.value)} 
                  onKeyDown={e => e.key === 'Enter' && handleSearch()} 
                />
              </div>
              <button onClick={handleSearch} disabled={loading} className="bg-gray-800 text-white px-6 rounded-lg font-bold hover:bg-black transition-colors">検索</button>
            </div>

            {/* 結果リスト */}
            {searchResults.length > 0 && (
              <div className="border rounded-xl overflow-hidden">
                <div className="bg-red-50 p-3 flex justify-between items-center border-b border-red-100">
                  <span className="text-sm font-bold text-red-800 ml-2">{searchResults.length} 件 ヒット</span>
                  
                  <button 
                    onClick={handleBulkDelete}
                    className="bg-red-600 text-white px-4 py-2 rounded text-sm font-bold hover:bg-red-700 flex items-center gap-2 shadow-sm"
                  >
                    <Trash2 size={16}/> 全て削除する
                  </button>
                </div>
                
                <div className="max-h-80 overflow-y-auto">
                  <table className="w-full text-left text-sm">
                    <thead className="bg-gray-100 text-gray-600 sticky top-0 z-10">
                      <tr>
                        <th className="p-3">属性</th>
                        <th className="p-3">名前 (確認)</th>
                        <th className="p-3">ID (生涯番号)</th>
                        <th className="p-3 text-right">操作</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {searchResults.map((user) => (
                        <tr key={user.uid} className="hover:bg-gray-50 transition-colors">
                          <td className="p-3">
                            <span className={`px-2 py-1 rounded text-xs font-bold ${user.role === 'student' ? 'bg-green-100 text-green-700' : 'bg-purple-100 text-purple-700'}`}>
                              {user.role === 'student' ? user.grade || '生徒' : '講師'}
                            </span>
                          </td>
                          <td className="p-3 font-bold text-gray-800">
                            {user.student_name || user.name || '---'}
                          </td>
                          <td className="p-3 text-gray-500 font-mono">{user.lifetime_id || '---'}</td>
                          <td className="p-3 text-right">
                            <button onClick={() => handleDelete(user.uid)} className="text-gray-400 hover:text-red-600 p-2 hover:bg-red-50 rounded-full transition-colors"><XCircle size={18} /></button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}