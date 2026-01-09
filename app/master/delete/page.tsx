'use client';

import { useState, useEffect } from 'react';
import { db } from '@/lib/firebase';
import { collection, query, where, getDocs, writeBatch, doc } from 'firebase/firestore';
import { Trash2, Search, AlertTriangle, User, Users, CheckSquare, Square, Loader2, ArrowLeft, Filter } from 'lucide-react';
import Link from 'next/link';

export default function BulkDeletePage() {
  const [role, setRole] = useState<'student' | 'teacher'>('student');
  const [users, setUsers] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  
  // フィルター用
  const [searchName, setSearchName] = useState('');
  const [filterGrade, setFilterGrade] = useState('');

  // 処理状態
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState({ current: 0, total: 0 });
  const [statusMsg, setStatusMsg] = useState('');
  
  // 選択されたユーザーIDのセット
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // ユーザー取得
  useEffect(() => {
    fetchUsers();
    setSelectedIds(new Set());
    setFilterGrade('');
    setSearchName('');
  }, [role]);

  const fetchUsers = async () => {
    setLoading(true);
    try {
      // 全件取得 (クライアント側でフィルタリング)
      const q = query(collection(db, 'users'), where('role', '==', role));
      const snap = await getDocs(q);
      const list = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      setUsers(list);
    } catch (e) {
      console.error(e);
      alert('データ取得中にエラーが発生しました');
    } finally {
      setLoading(false);
    }
  };

  // フィルタリングロジック
  const filteredUsers = users.filter(u => {
    const matchName = 
      (u.student_name || '').includes(searchName) || 
      (u.name || '').includes(searchName) ||
      (u.lifetime_id || '').includes(searchName);
    
    const matchGrade = filterGrade ? u.grade === filterGrade : true;

    return matchName && matchGrade;
  });

  // チェックボックス操作
  const toggleSelect = (id: string) => {
    const newSet = new Set(selectedIds);
    if (newSet.has(id)) newSet.delete(id);
    else newSet.add(id);
    setSelectedIds(newSet);
  };

  const toggleAll = () => {
    if (selectedIds.size === filteredUsers.length) {
      setSelectedIds(new Set());
    } else {
      const newSet = new Set(filteredUsers.map(u => u.id));
      setSelectedIds(newSet);
    }
  };

  // ★一括削除実行ロジック (大量データ対応版)
  const handleBulkDelete = async () => {
    const total = selectedIds.size;
    if (total === 0) return;

    if (!confirm(`選択した ${total} 名のアカウントを削除します。\n\n【警告】\n・PFデータ(成績/出席)も完全に削除されます\n・チャット履歴も削除されます\n・この操作は取り消せません\n\n本当によろしいですか？`)) return;
    
    // ダブルチェック
    if (!confirm('本当に削除してよろしいですか？（最終確認）')) return;

    setIsProcessing(true);
    setProgress({ current: 0, total });
    setStatusMsg('削除処理を開始します...');

    try {
      // IDリストを配列化
      const targets = Array.from(selectedIds);
      
      let batch = writeBatch(db);
      let opCount = 0;
      let processedCount = 0;

      // 1人ずつ処理
      for (const uid of targets) {
        // --- 依存データの削除検索 ---
        const deletions = [];

        // 1. ユーザー本体
        deletions.push(doc(db, 'users', uid));

        if (role === 'student') {
          // 2. PFレコード (pf_records) - クエリが必要
          const pfQ = query(collection(db, 'pf_records'), where('student_id', '==', uid));
          const pfSnap = await getDocs(pfQ);
          pfSnap.forEach(d => deletions.push(d.ref));

          // 3. サブコレクション (pf_yearly)
          const subPfQ = collection(db, 'users', uid, 'pf_yearly');
          const subPfSnap = await getDocs(subPfQ);
          subPfSnap.forEach(d => deletions.push(d.ref));

          // 4. チャット (chats)
          const subChatQ = collection(db, 'users', uid, 'chats');
          const subChatSnap = await getDocs(subChatQ);
          subChatSnap.forEach(d => deletions.push(d.ref));
        
          // 5. テスト結果 (quiz_results)
          const quizQ = collection(db, 'users', uid, 'quiz_results');
          const quizSnap = await getDocs(quizQ);
          quizSnap.forEach(d => deletions.push(d.ref));
        }

        if (role === 'teacher') {
          // シフト・勤怠
          const shiftQ = query(collection(db, 'shift_assignments'), where('user_id', '==', uid));
          const shiftSnap = await getDocs(shiftQ);
          shiftSnap.forEach(d => deletions.push(d.ref));
          
          const workQ = query(collection(db, 'work_records'), where('teacher_id', '==', uid));
          const workSnap = await getDocs(workQ);
          workSnap.forEach(d => deletions.push(d.ref));
        }

        // バッチに追加
        for (const ref of deletions) {
          batch.delete(ref);
          opCount++;

          // Firestore制限 (500件) に近づいたらコミット
          if (opCount >= 400) {
            await batch.commit();
            batch = writeBatch(db);
            opCount = 0;
          }
        }

        processedCount++;
        // 進捗更新 (Reactの再レンダリング頻度を抑えるため、10件ごとまたは最後のみ更新でも良いが、今回は毎回更新)
        setProgress({ current: processedCount, total });
        setStatusMsg(`${processedCount} / ${total} 人完了...`);
      }

      // 残りをコミット
      if (opCount > 0) {
        await batch.commit();
      }

      setStatusMsg('完了しました！');
      alert(`${total}件の削除が完了しました`);
      setSelectedIds(new Set());
      fetchUsers();

    } catch (e) {
      console.error(e);
      alert('削除中にエラーが発生しました。一部のデータが残っている可能性があります。');
    } finally {
      setIsProcessing(false);
      setProgress({ current: 0, total: 0 });
      setStatusMsg('');
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 p-8 font-sans text-gray-800">
      <div className="max-w-6xl mx-auto">
        
        {/* ヘッダー */}
        <div className="flex items-center gap-4 mb-8">
          <Link href="/master" className="bg-white p-2 rounded-full shadow hover:bg-gray-100 text-gray-600"><ArrowLeft size={24} /></Link>
          <div>
            <h1 className="text-3xl font-bold text-gray-800 flex items-center gap-2">
              <Trash2 className="text-red-600" /> アカウント一括削除
            </h1>
            <p className="text-gray-500 mt-1">退塾者や卒業生のデータを、関連データごと安全に削除します。</p>
          </div>
        </div>

        {/* メインカード */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden">
          
          {/* 1. フィルター・操作エリア */}
          <div className="p-4 border-b border-gray-100 bg-gray-50 space-y-4">
            
            <div className="flex flex-wrap gap-4 justify-between items-center">
              {/* ロール切り替え */}
              <div className="flex bg-white rounded-lg p-1 border shadow-sm">
                <button onClick={() => setRole('student')} className={`px-4 py-2 rounded-md text-sm font-bold flex items-center gap-2 ${role === 'student' ? 'bg-green-100 text-green-700' : 'text-gray-500 hover:bg-gray-50'}`}>
                  <User size={16}/> 生徒
                </button>
                <button onClick={() => setRole('teacher')} className={`px-4 py-2 rounded-md text-sm font-bold flex items-center gap-2 ${role === 'teacher' ? 'bg-purple-100 text-purple-700' : 'text-gray-500 hover:bg-gray-50'}`}>
                  <Users size={16}/> 講師
                </button>
              </div>

              {/* 検索・絞り込み */}
              <div className="flex flex-wrap items-center gap-2">
                {role === 'student' && (
                  <div className="flex items-center gap-2 bg-white px-3 py-2 rounded-lg border">
                    <Filter size={16} className="text-gray-400"/>
                    <select 
                      value={filterGrade}
                      onChange={(e) => setFilterGrade(e.target.value)}
                      className="bg-transparent text-sm outline-none font-bold text-gray-600"
                    >
                      <option value="">全学年</option>
                      <option value="中1">中1</option>
                      <option value="中2">中2</option>
                      <option value="中3">中3</option>
                      <option value="高1">高1</option>
                      <option value="高2">高2</option>
                      <option value="高3">高3</option>
                      <option value="卒業">卒業</option>
                    </select>
                  </div>
                )}
                
                <div className="flex items-center gap-2 bg-white px-3 py-2 rounded-lg border w-64">
                  <Search size={16} className="text-gray-400"/>
                  <input 
                    type="text" 
                    placeholder="名前・IDで検索..." 
                    className="outline-none text-sm w-full"
                    value={searchName}
                    onChange={(e) => setSearchName(e.target.value)}
                  />
                </div>
              </div>
            </div>

            {/* 選択アクションバー */}
            <div className="flex justify-between items-center pt-2">
              <div className="text-sm font-bold text-gray-500 flex items-center gap-2">
                <button onClick={toggleAll} className="flex items-center gap-2 hover:text-gray-800 transition-colors">
                   {selectedIds.size > 0 && selectedIds.size === filteredUsers.length ? <CheckSquare size={20} className="text-blue-600"/> : <Square size={20}/>}
                   <span>表示中の {filteredUsers.length} 件をすべて選択</span>
                </button>
              </div>
              
              <button 
                onClick={handleBulkDelete} 
                disabled={isProcessing || selectedIds.size === 0}
                className="bg-red-600 text-white px-6 py-2.5 rounded-lg text-sm font-bold hover:bg-red-700 shadow-sm flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
              >
                {isProcessing ? <Loader2 className="animate-spin" size={18}/> : <Trash2 size={18}/>}
                <span>{selectedIds.size} 件を完全削除</span>
              </button>
            </div>
            
            {/* 進捗バー (処理中のみ表示) */}
            {isProcessing && (
              <div className="w-full bg-gray-200 rounded-full h-2.5 mb-2 overflow-hidden relative">
                <div 
                  className="bg-blue-600 h-2.5 rounded-full transition-all duration-300 ease-out" 
                  style={{ width: `${(progress.current / progress.total) * 100}%` }}
                ></div>
                <div className="absolute top-0 right-0 left-0 text-[10px] text-center text-gray-600 font-bold leading-none mt-[1px]">
                   {statusMsg}
                </div>
              </div>
            )}
          </div>

          {/* 2. ユーザーリスト (描画負荷対策: 最大100件のみ表示) */}
          <div className="max-h-[600px] overflow-y-auto relative">
            {loading ? (
              <div className="p-20 text-center text-gray-400"><Loader2 className="animate-spin mx-auto mb-2"/>読み込み中...</div>
            ) : filteredUsers.length === 0 ? (
              <div className="p-20 text-center text-gray-400">条件に一致するユーザーがいません</div>
            ) : (
              <>
                <table className="w-full text-left border-collapse">
                  <thead className="bg-white sticky top-0 z-10 text-xs font-bold text-gray-500 border-b">
                    <tr>
                      <th className="p-4 w-16 text-center">選択</th>
                      <th className="p-4">氏名 / 生涯ID</th>
                      <th className="p-4">属性 (学年・クラス・曜日)</th>
                      <th className="p-4 text-right">登録日</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 text-sm">
                    {/* ★重要: 3000件描画すると重いので、最初の100件だけ表示する (選択は全件に効く) */}
                    {filteredUsers.slice(0, 100).map(user => (
                      <tr key={user.id} className={`hover:bg-gray-50 transition-colors ${selectedIds.has(user.id) ? 'bg-blue-50/40' : ''}`}>
                        <td className="p-4 text-center">
                          <button onClick={() => toggleSelect(user.id)} className="text-gray-400 hover:text-blue-600 block mx-auto">
                            {selectedIds.has(user.id) ? <CheckSquare size={20} className="text-blue-600"/> : <Square size={20}/>}
                          </button>
                        </td>
                        <td className="p-4">
                          <div className="font-bold text-gray-800 text-base">{user.student_name || user.name}</div>
                          <div className="text-xs text-gray-400 font-mono mt-0.5">{user.lifetime_id || user.id}</div>
                        </td>
                        <td className="p-4">
                          {role === 'student' ? (
                            <div className="flex gap-2 items-center flex-wrap">
                              {user.grade && <span className="bg-gray-100 text-gray-600 px-2 py-1 rounded text-xs font-bold">{user.grade}</span>}
                              {user.classroom && <span className="bg-gray-100 text-gray-600 px-2 py-1 rounded text-xs">{user.classroom}</span>}
                              {user.day_of_week && <span className="bg-blue-50 text-blue-600 px-2 py-1 rounded text-xs">{user.day_of_week}</span>}
                            </div>
                          ) : (
                            <span className="bg-purple-50 text-purple-600 px-2 py-0.5 rounded text-xs font-bold">講師アカウント</span>
                          )}
                        </td>
                        <td className="p-4 text-right text-gray-400 text-xs font-mono">
                          {user.created_at ? new Date(user.created_at).toLocaleDateString() : '-'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                
                {/* 100件以上ある場合のメッセージ */}
                {filteredUsers.length > 100 && (
                  <div className="p-4 text-center text-xs text-gray-400 bg-gray-50 border-t">
                    他 {filteredUsers.length - 100} 件は省略されています（「すべて選択」でこれらも選択されます）
                  </div>
                )}
              </>
            )}
          </div>
        </div>

        {/* 注意書きフッター */}
        <div className="mt-6 flex items-start gap-3 text-sm text-gray-600 bg-orange-50 p-4 rounded-xl border border-orange-100">
          <AlertTriangle size={20} className="text-orange-600 shrink-0 mt-0.5"/>
          <div>
            <p className="font-bold text-orange-800 mb-1">削除を実行する前の注意点</p>
            <p>
              この操作を実行すると、該当ユーザーの<strong>ログイン権限、PF(成績・出席)、チャット履歴、小テスト結果</strong>がすべてデータベースから完全に削除されます。<br/>
              一度削除すると元に戻すことはできません。年度替わりの卒業生処理など、慎重に行ってください。
            </p>
          </div>
        </div>

      </div>
    </div>
  );
}