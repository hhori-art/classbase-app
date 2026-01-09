'use client';

import { useState, useEffect } from 'react';
import { db } from '@/lib/firebase';
import { collection, getDocs, doc, setDoc, deleteDoc, query, orderBy, writeBatch, where } from 'firebase/firestore';
import { Users, Search, Plus, Edit, Trash2, ArrowLeft, GraduationCap, UserCheck, Save, X, Loader2, FileUp, AlertTriangle } from 'lucide-react';
import Link from 'next/link';

// ユーザー型定義
interface UserData {
  id: string; // Firestore Doc ID
  uid?: string;
  role: 'student' | 'teacher' | 'master';
  student_name?: string; // 生徒用
  name?: string;         // 講師用
  lifetime_id: string;   // ログインID
  grade?: string;
  classroom?: string;
  day_of_week?: string;
  initial_password?: string;
  created_at?: string;
}

export default function UserManagementPage() {
  const [users, setUsers] = useState<UserData[]>([]);
  const [filteredUsers, setFilteredUsers] = useState<UserData[]>([]);
  const [loading, setLoading] = useState(true);
  
  const [activeTab, setActiveTab] = useState<'student' | 'teacher'>('student');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isBulkDeleting, setIsBulkDeleting] = useState(false);
  const [isImporting, setIsImporting] = useState(false);

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<UserData | null>(null);
  
  // フォーム用 (表示名は displayName で一元管理)
  const [formData, setFormData] = useState<Partial<UserData> & { displayName: string }>({
    role: 'student',
    displayName: '',
    lifetime_id: '',
    initial_password: 'class1234',
    grade: '',
    classroom: '',
    day_of_week: ''
  });

  // データ取得
  const fetchUsers = async () => {
    setLoading(true);
    try {
      const q = query(collection(db, 'users'), orderBy('created_at', 'desc'));
      const snap = await getDocs(q);
      const list = snap.docs.map(d => ({ id: d.id, ...d.data() } as UserData));
      setUsers(list);
    } catch (e) { console.error(e); } finally { setLoading(false); }
  };

  useEffect(() => { fetchUsers(); }, []);

  // フィルタリング
  useEffect(() => {
    let result = users.filter(u => u.role === activeTab);
    if (searchQuery) {
      const lower = searchQuery.toLowerCase();
      result = result.filter(u => 
        (u.student_name || u.name || '').toLowerCase().includes(lower) ||
        String(u.lifetime_id).includes(lower) ||
        (u.grade || '').includes(lower) ||
        (u.classroom || '').includes(lower)
      );
    }
    setFilteredUsers(result);
    setSelectedIds(new Set());
  }, [users, activeTab, searchQuery]);

  // ▼▼▼ 重複削除機能 ▼▼▼
  const handleDeduplicate = async () => {
    if (!confirm('氏名とIDが同一の重複データを検索し、最新の1件を残して削除しますか？')) return;
    
    setLoading(true);
    try {
      const uniqueMap = new Map<string, UserData>();
      const duplicates: string[] = [];

      // 最新順にソートされている前提で、Mapにセット（後勝ち＝最新が残る、あるいは先勝ち＝最古が残る。ここではID重複を排除）
      // ID (lifetime_id) をキーにして重複判定
      users.forEach(u => {
        if (!u.lifetime_id) return;
        if (uniqueMap.has(u.lifetime_id)) {
          // 既に登録済みなら、今のデータ(u)は重複とみなす（リストは作成日降順なので、uはより古いデータ）
          duplicates.push(u.id);
        } else {
          uniqueMap.set(u.lifetime_id, u);
        }
      });

      if (duplicates.length === 0) {
        alert('重複データは見つかりませんでした。');
      } else {
        const batch = writeBatch(db);
        duplicates.forEach(id => batch.delete(doc(db, 'users', id)));
        await batch.commit();
        alert(`${duplicates.length} 件の重複データを削除しました。`);
        fetchUsers();
      }
    } catch (e: any) {
      alert('エラー: ' + e.message);
    } finally {
      setLoading(false);
    }
  };

  // ▼▼▼ CSVインポート機能 ▼▼▼
  const handleCSVImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!confirm(`「${file.name}」を取り込みますか？\n既存のIDは上書き更新されます。`)) {
      e.target.value = ''; return;
    }

    setIsImporting(true);
    const reader = new FileReader();
    reader.readAsText(file, 'UTF-8'); // 作成したCSVはUTF-8

    reader.onload = async (event) => {
      try {
        const text = event.target?.result as string;
        const rows = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
        const headers = rows[0].split(',').map(h => h.trim());
        
        const idxName = headers.findIndex(h => h.includes('氏名'));
        const idxID = headers.findIndex(h => h.includes('ID'));
        const idxPass = headers.findIndex(h => h.includes('パスワード'));

        if (idxName === -1 || idxID === -1) throw new Error('CSVヘッダーに「氏名」「ID」が必要です');

        const batch = writeBatch(db);
        let count = 0;

        // 既存ユーザーをIDで検索するためのマップ
        const existingUserMap = new Map(users.map(u => [u.lifetime_id, u.id]));

        for (let i = 1; i < rows.length; i++) {
          const cols = rows[i].split(',');
          if (cols.length < 2) continue;

          const name = cols[idxName]?.trim();
          const loginId = cols[idxID]?.trim();
          const pass = idxPass !== -1 ? cols[idxPass]?.trim() : 'class1234';

          if (!name || !loginId) continue;

          // 既存があればそのドキュメントID、なければ新規ID
          const docId = existingUserMap.get(loginId) || doc(collection(db, 'users')).id;
          const docRef = doc(db, 'users', docId);

          const isStudent = activeTab === 'student';
          
          const data: any = {
            role: activeTab, // 現在のタブのロールで登録
            lifetime_id: loginId,
            initial_password: pass,
            uid: docId,
            updated_at: new Date().toISOString()
          };

          if (isStudent) {
            data.student_name = name;
            data.name = null;
          } else {
            data.name = name;
            data.student_name = null;
          }

          if (!existingUserMap.has(loginId)) {
            data.created_at = new Date().toISOString();
          }

          batch.set(docRef, data, { merge: true });
          count++;
        }

        await batch.commit();
        alert(`${count} 件のユーザーをインポート/更新しました`);
        fetchUsers();
      } catch (e: any) {
        alert('インポートエラー: ' + e.message);
      } finally {
        setIsImporting(false);
        e.target.value = '';
      }
    };
  };

  // 保存処理 (正規化対応)
  const handleSave = async () => {
    if (!formData.displayName || !formData.lifetime_id) return alert('名前とログインIDは必須です');
    
    if (!editingUser) {
      const exists = users.some(u => u.lifetime_id === formData.lifetime_id);
      if (exists) return alert('このIDは既に使用されています');
    }

    try {
      const docId = editingUser ? editingUser.id : doc(collection(db, 'users')).id;
      const docRef = doc(db, 'users', docId);

      const saveData: any = {
        role: formData.role,
        lifetime_id: formData.lifetime_id,
        initial_password: formData.initial_password,
        updated_at: new Date().toISOString()
      };

      // 名前フィールドの正規化 (片方のみ保存)
      if (formData.role === 'student') {
        saveData.student_name = formData.displayName;
        saveData.name = null;
        saveData.grade = formData.grade;
        saveData.classroom = formData.classroom;
        saveData.day_of_week = formData.day_of_week;
      } else {
        saveData.name = formData.displayName;
        saveData.student_name = null;
        saveData.grade = null;
        saveData.classroom = null;
        saveData.day_of_week = null;
      }
      
      if (!editingUser) {
        saveData.created_at = new Date().toISOString();
        saveData.uid = docId; 
      }

      await setDoc(docRef, saveData, { merge: true });
      alert(editingUser ? '更新しました' : '登録しました');
      setIsModalOpen(false);
      fetchUsers();
    } catch (e: any) { alert('保存エラー: ' + e.message); }
  };

  // その他ハンドラ
  const handleOpenModal = (user?: UserData) => {
    if (user) {
      setEditingUser(user);
      setFormData({ ...user, displayName: user.student_name || user.name || '' });
    } else {
      setEditingUser(null);
      setFormData({ role: activeTab, displayName: '', lifetime_id: '', initial_password: 'class1234', grade: activeTab === 'student' ? '中1' : '', classroom: '', day_of_week: '' });
    }
    setIsModalOpen(true);
  };
  const handleSelectAll = (c: boolean) => setSelectedIds(c ? new Set(filteredUsers.map(u => u.id)) : new Set());
  const handleSelectOne = (id: string, c: boolean) => { const n = new Set(selectedIds); c ? n.add(id) : n.delete(id); setSelectedIds(n); };
  const handleBulkDelete = async () => {
    if (!confirm(`${selectedIds.size}件削除しますか？`)) return;
    setIsBulkDeleting(true);
    const batch = writeBatch(db);
    selectedIds.forEach(id => batch.delete(doc(db, 'users', id)));
    await batch.commit();
    setUsers(prev => prev.filter(u => !selectedIds.has(u.id)));
    setSelectedIds(new Set());
    setIsBulkDeleting(false);
  };
  const handleDelete = async (id: string) => { if(confirm('削除しますか？')) { await deleteDoc(doc(db, 'users', id)); setUsers(prev => prev.filter(u => u.id !== id)); }};

  return (
    <div className="min-h-screen bg-gray-50 p-6 pb-20">
      <div className="max-w-6xl mx-auto">
        
        {/* ヘッダー */}
        <div className="flex flex-col md:flex-row items-center justify-between mb-8 gap-4">
          <div className="flex items-center gap-4 w-full md:w-auto">
            <Link href="/master" className="bg-white p-2 rounded-full shadow hover:bg-gray-100 text-gray-600 transition-colors">
              <ArrowLeft size={20} />
            </Link>
            <div>
              <h1 className="text-2xl font-bold text-gray-800 flex items-center gap-2">
                <Users className="text-blue-600" /> 生徒・講師管理
              </h1>
              <p className="text-xs text-gray-500">ユーザー情報の登録・インポート・重複削除</p>
            </div>
          </div>

          <div className="flex gap-2 w-full md:w-auto items-center">
             {/* CSVインポートボタン */}
             <div className="relative">
               <input type="file" accept=".csv" onChange={handleCSVImport} className="absolute inset-0 w-full h-full opacity-0 cursor-pointer" disabled={isImporting}/>
               <button disabled={isImporting} className="bg-green-600 text-white px-4 py-2 rounded-full font-bold hover:bg-green-700 shadow flex items-center gap-2 text-sm whitespace-nowrap">
                 {isImporting ? <Loader2 className="animate-spin" size={16}/> : <FileUp size={16}/>} CSV一括登録
               </button>
             </div>

             <div className="relative flex-1 md:w-64">
               <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={16}/>
               <input 
                 type="text" 
                 placeholder="名前・ID・校舎で検索" 
                 className="w-full pl-9 pr-4 py-2 border rounded-full focus:ring-2 focus:ring-blue-500 outline-none"
                 value={searchQuery}
                 onChange={e => setSearchQuery(e.target.value)}
               />
             </div>
             <button 
               onClick={() => handleOpenModal()} 
               className="bg-blue-600 text-white px-4 py-2 rounded-full font-bold hover:bg-blue-700 shadow flex items-center gap-2 whitespace-nowrap"
             >
               <Plus size={18}/> 新規
             </button>
          </div>
        </div>

        {/* タブ & アクション */}
        <div className="flex flex-col sm:flex-row justify-between items-end sm:items-center mb-4 gap-4 border-b border-gray-200 pb-2">
          <div className="flex gap-2">
            <button onClick={() => setActiveTab('student')} className={`px-6 py-3 font-bold text-sm flex items-center gap-2 border-b-2 -mb-2.5 transition-colors ${activeTab === 'student' ? 'border-blue-600 text-blue-600 bg-blue-50/50' : 'border-transparent text-gray-500'}`}>
              <GraduationCap size={18}/> 生徒 ({users.filter(u => u.role === 'student').length})
            </button>
            <button onClick={() => setActiveTab('teacher')} className={`px-6 py-3 font-bold text-sm flex items-center gap-2 border-b-2 -mb-2.5 transition-colors ${activeTab === 'teacher' ? 'border-purple-600 text-purple-600 bg-purple-50/50' : 'border-transparent text-gray-500'}`}>
              <UserCheck size={18}/> 講師 ({users.filter(u => u.role === 'teacher').length})
            </button>
          </div>
          
          <div className="flex gap-2">
            {/* 重複チェックボタン */}
            <button onClick={handleDeduplicate} className="text-orange-600 hover:bg-orange-50 px-3 py-1 rounded text-xs font-bold flex items-center gap-1 border border-orange-200">
              <AlertTriangle size={14}/> 重複チェック・削除
            </button>

            {selectedIds.size > 0 && (
              <button onClick={handleBulkDelete} disabled={isBulkDeleting} className="bg-red-50 text-red-600 border border-red-200 px-4 py-1 rounded-full font-bold text-sm hover:bg-red-100 flex items-center gap-2">
                {isBulkDeleting ? <Loader2 className="animate-spin" size={16}/> : <Trash2 size={16}/>} {selectedIds.size}件削除
              </button>
            )}
          </div>
        </div>

        {/* リスト表示 */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
          {loading ? (
            <div className="p-20 flex justify-center"><Loader2 className="animate-spin text-gray-400"/></div>
          ) : filteredUsers.length === 0 ? (
            <div className="p-10 text-center text-gray-400">データが見つかりません</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm text-left">
                <thead className="bg-gray-50 text-gray-600 font-bold border-b border-gray-200">
                  <tr>
                    <th className="p-4 w-10"><input type="checkbox" className="w-4 h-4" onChange={(e) => handleSelectAll(e.target.checked)} checked={filteredUsers.length > 0 && selectedIds.size === filteredUsers.length}/></th>
                    <th className="p-4">氏名</th>
                    <th className="p-4">ログインID</th>
                    <th className="p-4">パスワード</th>
                    {activeTab === 'student' && <><th className="p-4">学年</th><th className="p-4">教室</th></>}
                    <th className="p-4 text-center">操作</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {filteredUsers.map((user) => (
                    <tr key={user.id} className={`hover:bg-gray-50 transition-colors ${selectedIds.has(user.id) ? 'bg-blue-50/30' : ''}`}>
                      <td className="p-4"><input type="checkbox" className="w-4 h-4 cursor-pointer" checked={selectedIds.has(user.id)} onChange={(e) => handleSelectOne(user.id, e.target.checked)}/></td>
                      <td className="p-4 font-bold text-gray-800 flex items-center gap-2">
                        <div className={`w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-bold ${user.role === 'student' ? 'bg-blue-400' : 'bg-purple-400'}`}>
                          {(user.student_name || user.name || '?')[0]}
                        </div>
                        {/* 名前表示ロジック: どちらか一方のみを表示 */}
                        {user.student_name || user.name || <span className="text-gray-400">未設定</span>}
                      </td>
                      <td className="p-4 font-mono text-gray-600">{user.lifetime_id}</td>
                      <td className="p-4 text-gray-400 text-xs">{user.initial_password || '********'}</td>
                      {activeTab === 'student' && <><td className="p-4"><span className="px-2 py-1 rounded bg-gray-100 text-xs font-bold text-gray-600">{user.grade || '-'}</span></td><td className="p-4 text-gray-600">{user.classroom || '-'}</td></>}
                      <td className="p-4 flex justify-center gap-2">
                        <button onClick={() => handleOpenModal(user)} className="p-2 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded"><Edit size={16}/></button>
                        <button onClick={() => handleDelete(user.id)} className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded"><Trash2 size={16}/></button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* モーダル */}
      {isModalOpen && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl w-full max-w-lg shadow-xl overflow-hidden">
            <div className="bg-gray-800 text-white p-4 flex justify-between items-center">
              <h2 className="font-bold flex items-center gap-2">{editingUser ? '編集' : '新規登録'}</h2>
              <button onClick={() => setIsModalOpen(false)}><X size={20}/></button>
            </div>
            <div className="p-6 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-xs font-bold text-gray-500">権限</label>
                  <select className="w-full p-2 border rounded mt-1 bg-gray-50" value={formData.role} onChange={e => setFormData({...formData, role: e.target.value as any})} disabled={!!editingUser}>
                    <option value="student">生徒</option><option value="teacher">講師</option><option value="master">管理者</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs font-bold text-gray-500">ID</label>
                  <input className="w-full p-2 border rounded mt-1 font-mono" value={formData.lifetime_id} onChange={e => setFormData({...formData, lifetime_id: e.target.value})}/>
                </div>
              </div>
              <div>
                <label className="text-xs font-bold text-gray-500">氏名</label>
                <input className="w-full p-2 border rounded mt-1" value={formData.displayName} onChange={e => setFormData({...formData, displayName: e.target.value})}/>
              </div>
              <div>
                <label className="text-xs font-bold text-gray-500">パスワード</label>
                <input className="w-full p-2 border rounded mt-1 font-mono bg-gray-50" value={formData.initial_password} onChange={e => setFormData({...formData, initial_password: e.target.value})}/>
              </div>
              {formData.role === 'student' && (
                <div className="grid grid-cols-2 gap-4">
                   <div><label className="text-xs font-bold text-gray-500">学年</label><select className="w-full p-2 border rounded mt-1" value={formData.grade} onChange={e => setFormData({...formData, grade: e.target.value})}><option value="">選択</option><option>中1</option><option>中2</option><option>中3</option></select></div>
                   <div><label className="text-xs font-bold text-gray-500">教室</label><input className="w-full p-2 border rounded mt-1" value={formData.classroom} onChange={e => setFormData({...formData, classroom: e.target.value})}/></div>
                </div>
              )}
              <button onClick={handleSave} className="w-full bg-blue-600 text-white py-3 rounded-lg font-bold hover:bg-blue-700 shadow mt-4 flex justify-center items-center gap-2"><Save size={18}/> 保存</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}